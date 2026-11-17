# Holt alle zu Fuss begehbaren Wege und Strassen im Stadtgebiet Oldenburg von OpenStreetMap und schreibt sie in die Datei
# Standortanalyse\wegenetz_oldenburg.js (Ebenen "5 / 10 Min. nach Wegenetz" der App).
#
# Die App rechnet damit selbst aus, wie weit man in 5 bzw. 10 Minuten zu Fuss kommt (80 m pro Minute entlang der Wege).
# Mitgenommen werden: Gehwege, Fusswege, Fussgaengerzonen, Treppen, Pfade, verkehrsberuhigte Bereiche, Wohn- und
# Nebenstrassen, Erschliessungswege, Wirtschaftswege und alle Strassen bis zu den Hauptstrassen. Nicht mitgenommen:
# Autobahnen und Schnellstrassen, Wege mit Fussverbot oder privatem Zugang, Radwege ohne Fusserlaubnis, Zufahrten.
#
# Das Herunterladen dauert einige Minuten (der Dienst wird in 16 Kacheln abgefragt). Zwischenstand liegt im Ordner
# "rohdaten_wegenetz", der am Ende geloescht wird; bei einem Abbruch kann man das Programm einfach noch einmal starten.

param(
  [string]$Zielordner = (Join-Path $PSScriptRoot 'rohdaten_wegenetz'),
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\wegenetz_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [int]$Anzahl = 4
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions
New-Item -ItemType Directory -Force $Zielordner | Out-Null
$log = Join-Path $Zielordner '_log.txt'
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
$dLat = ($nord - $sued) / $Anzahl
$dLon = ($ost - $west) / $Anzahl
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

$begehbar = '^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|track|road)$'
$filter = '["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"]["area"!="yes"]["service"!="driveway"]'

for ($i = 0; $i -lt $Anzahl; $i++) {
  for ($j = 0; $j -lt $Anzahl; $j++) {
    $s = [Math]::Round($sued + $i * $dLat, 5); $n = [Math]::Round($sued + ($i + 1) * $dLat, 5)
    $w = [Math]::Round($west + $j * $dLon, 5); $o = [Math]::Round($west + ($j + 1) * $dLon, 5)
    $ziel = Join-Path $Zielordner ("teil_{0}_{1}.json" -f $i, $j)
    if ((Test-Path $ziel) -and ((Get-Item $ziel).Length -gt 1000)) { "teil_${i}_${j}: schon vorhanden" | Add-Content $log; continue }

    $b = "($s,$w,$n,$o)"
    $q = "[out:json][timeout:240][maxsize:1073741824];(" +
         "way[""highway""~""$begehbar""]$filter$b;" +
         "way[""highway""=""cycleway""][""foot""~""^(yes|designated|permissive)$""]$b;" +
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
    if (-not $ok) { "teil_${i}_${j}: AUFGEGEBEN" | Add-Content $log; Write-Host "Teil $i/$j konnte nicht geladen werden. Bitte das Programm spaeter noch einmal starten."; exit 1 }
    Start-Sleep -Seconds 4
  }
}

# ---- Umwandeln: alle Wege als Zahlenfolge [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad ----
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$serializer.RecursionLimit = 200
$gesehen = New-Object 'System.Collections.Generic.HashSet[string]'
$wege = New-Object System.Collections.Generic.List[string]
$punkte = 0
foreach ($datei in (Get-ChildItem $Zielordner -Filter 'teil_*.json')) {
  Write-Host ("lese " + $datei.Name)
  $wurzel = $serializer.DeserializeObject([System.IO.File]::ReadAllText($datei.FullName, [System.Text.Encoding]::UTF8))
  foreach ($e in $wurzel['elements']) {
    if ($e['type'] -ne 'way') { continue }
    if (-not $gesehen.Add([string]$e['id'])) { continue }
    $geo = $e['geometry']; if (-not $geo -or $geo.Count -lt 2) { continue }
    $teile = New-Object System.Collections.Generic.List[string]
    $la0 = 0L; $lo0 = 0L; $erster = $true; $vorherLa = $null; $vorherLo = $null; $anzahl = 0
    foreach ($p in $geo) {
      $la = [long][Math]::Round([double]$p['lat'] * 1e6); $lo = [long][Math]::Round([double]$p['lon'] * 1e6)
      if (-not $erster -and $la -eq $la0 -and $lo -eq $lo0) { continue }   # doppelte Punkte weglassen
      if ($erster) { $teile.Add("$la"); $teile.Add("$lo"); $erster = $false }
      else { $teile.Add([string]($la - $la0)); $teile.Add([string]($lo - $lo0)) }
      $la0 = $la; $lo0 = $lo; $anzahl++
    }
    if ($anzahl -lt 2) { continue }
    $punkte += $anzahl
    $wege.Add('[' + ($teile -join ',') + ']')
  }
}

$inhalt = '// Begehbares Wegenetz in Oldenburg (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\12_Wegenetz_aktualisieren.ps1.' + "`n" +
          '// Jeder Weg = [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad. Kreuzungen erkennt die App an gleichen Punkten.' + "`n" +
          'var WEGENETZ_OLDENBURG = {"einheit":1e-6,"stand":"' + $Stand + '","wege":[' + ($wege -join ',') + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} Wege, {1} Punkte, {2} KB in {3}" -f $wege.Count, $punkte, [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
Remove-Item -Recurse -Force $Zielordner -Confirm:$false
