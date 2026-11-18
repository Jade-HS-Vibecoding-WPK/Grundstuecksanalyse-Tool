param([string]$Stadt = 'oldenburg')
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt
$ErrorActionPreference = 'Continue'
$basis = Join-Path $PSScriptRoot "rohdaten_gebaeude_$Stadt"
New-Item -ItemType Directory -Force $basis | Out-Null
$log = Join-Path $basis "_log.txt"
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

# Stadtgebiet mit etwas Rand: Süd, West, Nord, Ost
$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
$anzahl = 4
$dLat = ($nord - $sued) / $anzahl
$dLon = ($ost - $west) / $anzahl
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

for ($i = 0; $i -lt $anzahl; $i++) {
  for ($j = 0; $j -lt $anzahl; $j++) {
    $s = [Math]::Round($sued + $i * $dLat, 5); $n = [Math]::Round($sued + ($i + 1) * $dLat, 5)
    $w = [Math]::Round($west + $j * $dLon, 5); $o = [Math]::Round($west + ($j + 1) * $dLon, 5)
    $ziel = Join-Path $basis ("teil_{0}_{1}.json" -f $i, $j)
    if ((Test-Path $ziel) -and ((Get-Item $ziel).Length -gt 1000)) { "teil_${i}_${j}: schon vorhanden" | Add-Content $log; continue }
    if ((Get-ChildItem $basis -Filter ("teil_{0}_{1}_*.json" -f $i, $j) | Where-Object { $_.Length -gt 1000 }).Count -ge 4) { "teil_${i}_${j}: schon in vier kleinen Teilen vorhanden" | Add-Content $log; continue }

    $box = "$s,$w,$n,$o"
    $q = "[out:json][timeout:180][maxsize:1073741824];(way[""building""]($box);relation[""building""]($box););out skel geom qt;"
    $ok = $false
    for ($versuch = 1; $versuch -le 4 -and -not $ok; $versuch++) {
      try {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ("data=" + [uri]::EscapeDataString($q)) `
             -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 240
        $bytes = $r.RawContentStream.ToArray()
        # Prüfen, ob es wirklich Daten sind und kein Fehlertext (Anfang der Datei ansehen)
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
        $box2 = (($v | ForEach-Object { [Math]::Round($_, 5).ToString([Globalization.CultureInfo]::InvariantCulture) }) -join ',')
        $q2 = $q.Replace($box, $box2)
        $ziel2 = Join-Path $basis ("teil_{0}_{1}_{2}.json" -f $i, $j, $k)
        $ok2 = $false
        for ($versuch = 1; $versuch -le 4 -and -not $ok2; $versuch++) {
          try {
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ("data=" + [uri]::EscapeDataString($q2)) `
                 -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 240
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
    Start-Sleep -Seconds 4   # Pause, damit wir den Dienst nicht bedrängen
  }
}
"Ende $(Get-Date -Format 'HH:mm:ss')" | Add-Content $log
