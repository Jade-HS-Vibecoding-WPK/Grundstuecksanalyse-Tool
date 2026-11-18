param(
  [string]$Stadt = 'oldenburg',
  [string]$Zielordner = (Join-Path $PSScriptRoot "rohdaten_karte_$Stadt"),
  [int]$Anzahl = 4
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force $Zielordner | Out-Null
$log = Join-Path $Zielordner "_log.txt"
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

# Stadtgebiet mit etwas Rand: Süd, West, Nord, Ost
$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
$dLat = ($nord - $sued) / $Anzahl
$dLon = ($ost - $west) / $Anzahl
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

# Was wir brauchen: Straßen, Bahnlinien, Gewässer, Grünflächen (jeweils Linien und Flächen)
$gruenLeisure = '^(park|garden|playground|recreation_ground|common|nature_reserve|golf_course|pitch)$'
$gruenLanduse = '^(grass|forest|meadow|cemetery|recreation_ground|village_green|allotments|orchard)$'
$gruenNatural = '^(wood|scrub|grassland|wetland|heath)$'
$strassenAusschluss = 'proposed|construction|razed|abandoned|platform|bus_stop|elevator|corridor|via_ferrata|raceway|emergency_access_point'

for ($i = 0; $i -lt $Anzahl; $i++) {
  for ($j = 0; $j -lt $Anzahl; $j++) {
    $s = [Math]::Round($sued + $i * $dLat, 5); $n = [Math]::Round($sued + ($i + 1) * $dLat, 5)
    $w = [Math]::Round($west + $j * $dLon, 5); $o = [Math]::Round($west + ($j + 1) * $dLon, 5)
    $ziel = Join-Path $Zielordner ("teil_{0}_{1}.json" -f $i, $j)
    if ((Test-Path $ziel) -and ((Get-Item $ziel).Length -gt 1000)) { "teil_${i}_${j}: schon vorhanden" | Add-Content $log; continue }
    if ((Get-ChildItem $Zielordner -Filter ("teil_{0}_{1}_*.json" -f $i, $j) | Where-Object { $_.Length -gt 1000 }).Count -ge 4) { "teil_${i}_${j}: schon in vier kleinen Teilen vorhanden" | Add-Content $log; continue }

    $b = "($s,$w,$n,$o)"
    $q = "[out:json][timeout:240][maxsize:1073741824];(" +
         "way[""highway""][""highway""!~""$strassenAusschluss""]$b;" +
         "way[""railway""~""^(rail|light_rail|tram|narrow_gauge)$""]$b;" +
         "way[""waterway""~""^(river|stream|canal|ditch|drain)$""]$b;" +
         "way[""natural""=""water""]$b;relation[""natural""=""water""]$b;" +
         "way[""landuse""=""reservoir""]$b;" +
         "way[""leisure""~""$gruenLeisure""]$b;relation[""leisure""~""$gruenLeisure""]$b;" +
         "way[""landuse""~""$gruenLanduse""]$b;relation[""landuse""~""$gruenLanduse""]$b;" +
         "way[""natural""~""$gruenNatural""]$b;relation[""natural""~""$gruenNatural""]$b;" +
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
    if (-not $ok) {
      # Zu viele Daten fuer eine Anfrage (typisch in dichten Innenstaedten): in vier kleinere Teile zerlegen
      "teil_${i}_${j}: zu gross oder Dienst ueberlastet, versuche vier kleinere Teile" | Add-Content $log
      $sm = ($s + $n) / 2; $wm = ($w + $o) / 2
      $viertel = @(@($s, $w, $sm, $wm), @($s, $wm, $sm, $o), @($sm, $w, $n, $wm), @($sm, $wm, $n, $o))
      for ($k = 0; $k -lt 4; $k++) {
        $v = $viertel[$k]
        $b2 = "(" + (($v | ForEach-Object { [Math]::Round($_, 5).ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ',') + ")"
        $q2 = $q.Replace($b, $b2)
        $ziel2 = Join-Path $Zielordner ("teil_{0}_{1}_{2}.json" -f $i, $j, $k)
        $ok2 = $false
        for ($versuch = 1; $versuch -le 4 -and -not $ok2; $versuch++) {
          try {
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ("data=" + [uri]::EscapeDataString($q2)) `
                 -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 300
            $bytes = $r.RawContentStream.ToArray()
            $anfang = [System.Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min(300, $bytes.Length))
            if ($anfang -notmatch '"elements"') { throw "unbrauchbare Antwort" }
            [System.IO.File]::WriteAllBytes($ziel2, $bytes)
            "teil_${i}_${j}_${k}: OK, {0} KB, {1} s, Versuch {2}" -f [int]($bytes.Length / 1024), [int]($sw.Elapsed.TotalSeconds), $versuch | Add-Content $log
            $ok2 = $true
          } catch {
            "teil_${i}_${j}_${k}: Versuch $versuch fehlgeschlagen: " + $_.Exception.Message | Add-Content $log
            Start-Sleep -Seconds (10 * $versuch)
          }
        }
        if (-not $ok2) { "teil_${i}_${j}_${k}: AUFGEGEBEN" | Add-Content $log }
        Start-Sleep -Seconds 4
      }
    }
    Start-Sleep -Seconds 4
  }
}
"Ende $(Get-Date -Format 'HH:mm:ss')" | Add-Content $log
