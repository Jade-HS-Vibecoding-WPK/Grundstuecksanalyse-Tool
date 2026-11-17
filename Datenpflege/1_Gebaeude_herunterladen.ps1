$ErrorActionPreference = 'Continue'
$basis = Join-Path $PSScriptRoot "rohdaten"
New-Item -ItemType Directory -Force $basis | Out-Null
$log = Join-Path $basis "_log.txt"
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

# Stadtgebiet Oldenburg mit etwas Rand: Süd, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
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
    if (-not $ok) { "teil_${i}_${j}: AUFGEGEBEN" | Add-Content $log }
    Start-Sleep -Seconds 4   # Pause, damit wir den Dienst nicht bedrängen
  }
}
"Ende $(Get-Date -Format 'HH:mm:ss')" | Add-Content $log
