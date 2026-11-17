# Holt alle als Baum erfassten Punkte (natural=tree) im Stadtgebiet Oldenburg von OpenStreetMap und schreibt sie in die Datei
# Standortanalyse\baeume_oldenburg.js (Baeume der 3D-Ansicht).
#
# Pro Baum werden gespeichert: Breite, Laenge (Millionstel Grad), Hoehe in Dezimetern (0 = unbekannt, die App schaetzt),
# Kronenbreite in Dezimetern (0 = unbekannt) und ob der Baum immergruen ist (1 = Nadelbaum oder immergruen).
#
# Hinweis: OpenStreetMap kennt nicht alle Baeume (vor allem Strassenbaeume fehlen oft). Die Daten sind ein Stand vom Tag des Herunterladens.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\baeume_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions
$kennung = 'Standortanalyse-Studienprojekt/1.0'
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$q = '[out:json][timeout:240][maxsize:536870912];node["natural"="tree"](53.05,8.06,53.225,8.345);out body;'

$antwort = $null
for ($versuch = 1; $versuch -le 4 -and -not $antwort; $versuch++) {
  try {
    $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ('data=' + [uri]::EscapeDataString($q)) -ContentType 'application/x-www-form-urlencoded' `
         -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 300
    $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    if ($text -notmatch '"elements"') { throw 'unbrauchbare Antwort' }
    $antwort = $text
  } catch {
    Write-Host ("Versuch $versuch fehlgeschlagen: " + $_.Exception.Message)
    Start-Sleep -Seconds (10 * $versuch)
  }
}
if (-not $antwort) { Write-Host 'Die Baeume konnten nicht geladen werden. Bitte spaeter noch einmal starten.'; exit 1 }

$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$wurzel = $serializer.DeserializeObject($antwort)
$inv = [Globalization.CultureInfo]::InvariantCulture

function Zahl($text) {
  if ($null -eq $text) { return 0 }
  $m = [regex]::Match([string]$text, '^\s*(\d+(?:[.,]\d+)?)')
  if (-not $m.Success) { return 0 }
  return [double]::Parse($m.Groups[1].Value.Replace(',', '.'), $inv)
}

$zeilen = New-Object System.Collections.Generic.List[string]
$mitHoehe = 0; $mitKrone = 0; $immergruen = 0
foreach ($e in $wurzel['elements']) {
  if ($e['type'] -ne 'node') { continue }
  $t = $e['tags']
  $h = 0; $k = 0; $ig = 0
  if ($t) {
    $hh = Zahl $t['height']; if ($hh -ge 1 -and $hh -le 60) { $h = [int][Math]::Round($hh * 10); $mitHoehe++ }
    $kk = Zahl $t['diameter_crown']; if ($kk -ge 1 -and $kk -le 40) { $k = [int][Math]::Round($kk * 10); $mitKrone++ }
    if ($t['leaf_type'] -eq 'needleleaved' -or $t['leaf_cycle'] -eq 'evergreen') { $ig = 1; $immergruen++ }
  }
  $la = [long][Math]::Round([double]$e['lat'] * 1e6); $lo = [long][Math]::Round([double]$e['lon'] * 1e6)
  $zeilen.Add("[$la,$lo,$h,$k,$ig]")
}

$inhalt = '// Baeume in Oldenburg (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\14_Baeume_aktualisieren.ps1.' + "`n" +
          '// Jeder Baum = [Breite, Laenge (Millionstel Grad), Hoehe in dm (0 = unbekannt), Kronenbreite in dm (0 = unbekannt), immergruen (0/1)].' + "`n" +
          'var BAEUME_OLDENBURG = {"einheit":1e-6,"stand":"' + $Stand + '","anzahl":' + $zeilen.Count + ',"baeume":[' + "`n" + ($zeilen -join ",`n") + "`n" + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} Baeume ({1} mit Hoehe, {2} mit Kronenbreite, {3} immergruen), {4} KB in {5}" -f $zeilen.Count, $mitHoehe, $mitKrone, $immergruen, [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
