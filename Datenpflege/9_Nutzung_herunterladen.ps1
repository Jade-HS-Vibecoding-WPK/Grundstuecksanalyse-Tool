param(
  [string]$Zielordner = (Join-Path $PSScriptRoot 'rohdaten_nutzung'),
  [int]$Anzahl = 4
)

# Laedt die Flaechen fuer die Ebenen "Wohnen", "Gewerbe und Handel", "Industrie" und "Gemeinbedarf und Bildung"
# von OpenStreetMap herunter, in Teilen (das Stadtgebiet wird in Kacheln zerlegt).
# Danach 10_Nutzung_umwandeln.ps1 ausfuehren.

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Zielordner | Out-Null
$log = Join-Path $Zielordner "_log.txt"
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
$dLat = ($nord - $sued) / $Anzahl
$dLon = ($ost - $west) / $Anzahl
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

# Wohnen, Gewerbe und Handel, Industrie, Gemeinbedarf und Bildung (jeweils Flaechen und Mehrteil-Flaechen)
$landuse = '^(residential|commercial|retail|industrial|port|railway|institutional|education|religious)$'
$amenity = '^(school|college|university|hospital|kindergarten|place_of_worship|townhall|courthouse|police|fire_station|community_centre)$'
$leisure = '^(sports_centre|stadium)$'

for ($i = 0; $i -lt $Anzahl; $i++) {
  for ($j = 0; $j -lt $Anzahl; $j++) {
    $s = [Math]::Round($sued + $i * $dLat, 5); $n = [Math]::Round($sued + ($i + 1) * $dLat, 5)
    $w = [Math]::Round($west + $j * $dLon, 5); $o = [Math]::Round($west + ($j + 1) * $dLon, 5)
    $ziel = Join-Path $Zielordner ("teil_{0}_{1}.json" -f $i, $j)
    if ((Test-Path $ziel) -and ((Get-Item $ziel).Length -gt 1000)) { "teil_${i}_${j}: schon vorhanden" | Add-Content $log; continue }

    $b = "($s,$w,$n,$o)"
    $q = "[out:json][timeout:240][maxsize:1073741824];(" +
         "way[""landuse""~""$landuse""]$b;relation[""landuse""~""$landuse""]$b;" +
         "way[""amenity""~""$amenity""]$b;relation[""amenity""~""$amenity""]$b;" +
         "way[""leisure""~""$leisure""]$b;relation[""leisure""~""$leisure""]$b;" +
         ");out geom qt;"
    $ok = $false
    for ($versuch = 1; $versuch -le 4 -and -not $ok; $versuch++) {
      try {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ("data=" + [uri]::EscapeDataString($q)) `
             -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 300
        $bytes = $r.RawContentStream.ToArray()
        $anfang = [System.Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min(300, $bytes.Length))
        if ($anfang -notmatch '"elements"') { throw "unbrauchbare Antwort: " + $anfang.Substring(0, [Math]::Min(80, $anfang.Length)) }
        [System.IO.File]::WriteAllBytes($ziel, $bytes)
        "teil_${i}_${j}: OK, {0} KB, {1} s, Versuch {2}" -f [int]($bytes.Length / 1024), [int]($sw.Elapsed.TotalSeconds), $versuch | Add-Content $log
        $ok = $true
      } catch {
        "teil_${i}_${j}: Versuch $versuch fehlgeschlagen: " + $_.Exception.Message | Add-Content $log
        Start-Sleep -Seconds (10 * $versuch)
      }
    }
    if (-not $ok) { "teil_${i}_${j}: AUFGEGEBEN" | Add-Content $log }
    Start-Sleep -Seconds 4
  }
}
"Ende $(Get-Date -Format 'HH:mm:ss')" | Add-Content $log
Get-Content $log
