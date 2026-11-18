param(
  [string]$Stadt = 'oldenburg',
  [string]$Zielordner = (Join-Path $PSScriptRoot "rohdaten_flaechen_$Stadt"),
  [int]$Anzahl = 4
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

# Laedt die Flaechen fuer die Ebenen "Parks und Gruenflaechen", "Wald und Gehoelz", "Gewaesser" und
# "Plaetze und Freiraeume" von OpenStreetMap herunter, in Teilen (das Stadtgebiet wird in Kacheln zerlegt).
# Danach 8_Flaechen_umwandeln.ps1 ausfuehren.

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Zielordner | Out-Null
$log = Join-Path $Zielordner "_log.txt"
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

# Stadtgebiet mit etwas Rand: Sued, West, Nord, Ost
$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
$dLat = ($nord - $sued) / $Anzahl
$dLon = ($ost - $west) / $Anzahl
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

# Parks und Gruenflaechen, Wald und Gehoelz, Wasser, Plaetze (jeweils Flaechen und Mehrteil-Flaechen)
$leisure = '^(park|garden|playground|recreation_ground|common|pitch|golf_course)$'
$landuse = '^(grass|meadow|cemetery|recreation_ground|village_green|allotments|orchard|forest|reservoir)$'
$natural = '^(wood|scrub|grassland|wetland|heath|water)$'

for ($i = 0; $i -lt $Anzahl; $i++) {
  for ($j = 0; $j -lt $Anzahl; $j++) {
    $s = [Math]::Round($sued + $i * $dLat, 5); $n = [Math]::Round($sued + ($i + 1) * $dLat, 5)
    $w = [Math]::Round($west + $j * $dLon, 5); $o = [Math]::Round($west + ($j + 1) * $dLon, 5)
    $ziel = Join-Path $Zielordner ("teil_{0}_{1}.json" -f $i, $j)
    if ((Test-Path $ziel) -and ((Get-Item $ziel).Length -gt 1000)) { "teil_${i}_${j}: schon vorhanden" | Add-Content $log; continue }

    $b = "($s,$w,$n,$o)"
    $q = "[out:json][timeout:240][maxsize:1073741824];(" +
         "way[""leisure""~""$leisure""]$b;relation[""leisure""~""$leisure""]$b;" +
         "way[""landuse""~""$landuse""]$b;relation[""landuse""~""$landuse""]$b;" +
         "way[""natural""~""$natural""]$b;relation[""natural""~""$natural""]$b;" +
         "way[""place""=""square""]$b;relation[""place""=""square""]$b;" +
         "way[""amenity""=""marketplace""]$b;relation[""amenity""=""marketplace""]$b;" +
         "way[""highway""=""pedestrian""][""area""=""yes""]$b;relation[""highway""=""pedestrian""][""area""=""yes""]$b;" +
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
