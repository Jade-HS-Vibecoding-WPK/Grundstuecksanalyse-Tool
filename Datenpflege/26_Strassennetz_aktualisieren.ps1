# Holt das Strassennetz fuer Kraftfahrzeuge im Stadtgebiet Oldenburg (Autobahn bis Wohnstrasse, Fussgaengerzonen) von OpenStreetMap
# samt Hoechstgeschwindigkeit (maxspeed) und schreibt es in die Datei Standortanalyse\strassennetz_oldenburg.js
# (Ebenen "Strassen nach Hoechstgeschwindigkeit" und "Strassen nach Strassenart" der App, Abschnitt "Verkehr und Mobilitaet").
# Alles geht in einem Schritt (etwa 1 Minute).
#
# Je Strasse eine Zeile: [Tempo, Art, Breite, Laenge, Delta, Delta, ...] (Breite/Laenge in Millionstel Grad, danach Unterschiede).
#   Tempo: Hoechstgeschwindigkeit in km/h, 7 = Schrittgeschwindigkeit, 999 = keine Begrenzung, 0 = in OpenStreetMap nicht angegeben.
#   Art:   1 Autobahn, 2 Schnellstrasse/Kraftfahrstrasse, 3 Hauptstrasse (primary), 4 Strasse zweiter Ordnung (secondary),
#          5 Verbindungsstrasse (tertiary), 6 Wohn- und Anliegerstrasse (residential, unclassified), 7 verkehrsberuhigter Bereich
#          (living_street), 8 Fussgaengerzone (pedestrian).
# Wirtschaftswege, Zufahrten (service), Rad- und Fusswege gehoeren nicht dazu.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\strassennetz_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
$b = "($sued,$west,$nord,$ost)"
$kennung = 'Standortanalyse-Studienprojekt/1.0'
$dienste = @(
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
)
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$serializer.RecursionLimit = 200

function Hole-Overpass([string]$abfrage) {
  foreach ($dienst in $dienste) {
    for ($versuch = 1; $versuch -le 3; $versuch++) {
      try {
        Write-Host "Frage $dienst ab (Versuch $versuch) ..."
        $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ('data=' + [uri]::EscapeDataString($abfrage)) `
             -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 300
        $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
        if ($text -notmatch '"elements"') { throw 'unbrauchbare Antwort' }
        return $serializer.DeserializeObject($text)
      } catch {
        Write-Host ('  fehlgeschlagen: ' + $_.Exception.Message)
        Start-Sleep -Seconds (8 * $versuch)
      }
    }
  }
  throw 'Kein Dienst hat geantwortet. Bitte spaeter noch einmal versuchen.'
}

$arten = @{
  'motorway' = 1; 'motorway_link' = 1; 'trunk' = 2; 'trunk_link' = 2; 'primary' = 3; 'primary_link' = 3;
  'secondary' = 4; 'secondary_link' = 4; 'tertiary' = 5; 'tertiary_link' = 5; 'unclassified' = 6; 'residential' = 6;
  'living_street' = 7; 'pedestrian' = 8
}
$klassen = '^(' + (($arten.Keys | Sort-Object) -join '|') + ')$'
$w = Hole-Overpass ('[out:json][timeout:240];way["highway"~"' + $klassen + '"]' + $b + ';out geom qt;')

# Hoechstgeschwindigkeit aus den Angaben lesen: Zahl, "50 km/h", Kennungen wie DE:urban; sonst 0
function Lies-Tempo($tags) {
  $roh = $null
  foreach ($k in 'maxspeed', 'maxspeed:forward', 'maxspeed:backward', 'zone:maxspeed', 'source:maxspeed') {
    if ($tags.ContainsKey($k) -and $tags[$k]) { $roh = [string]$tags[$k]; if ($k -ne 'source:maxspeed') { break } }
  }
  if (-not $roh) { if ($tags['highway'] -eq 'living_street') { return 7 } else { return 0 } }
  $roh = $roh.ToLower()
  if ($roh -match '^(\d{1,3})(\s*km/h)?$') { return [int]$Matches[1] }
  if ($roh -match 'zone:?(\d{2})') { return [int]$Matches[1] }
  if ($roh -match '^de:(\d{2,3})$') { return [int]$Matches[1] }
  if ($roh -match 'living_street|walk') { return 7 }
  if ($roh -match 'urban') { return 50 }
  if ($roh -match 'rural') { return 100 }
  if ($roh -match 'none|motorway') { return 999 }
  if ($roh -match '(\d{1,3})') { return [int]$Matches[1] }
  if ($tags['highway'] -eq 'living_street') { return 7 }
  return 0
}

$zeilen = New-Object System.Collections.Generic.List[string]
$nachTempo = @{}; $nachArt = @{}
foreach ($e in $w['elements']) {
  if ($e['type'] -ne 'way') { continue }
  $geo = $e['geometry']; if (-not $geo -or $geo.Count -lt 2) { continue }
  $tags = $e['tags']; if (-not $tags) { continue }
  $art = $arten[[string]$tags['highway']]; if (-not $art) { continue }
  $tempo = Lies-Tempo $tags
  $teile = New-Object System.Collections.Generic.List[string]
  $teile.Add([string]$tempo); $teile.Add([string]$art)
  $la0 = 0L; $lo0 = 0L; $erster = $true; $punkte = 0
  foreach ($p in $geo) {
    $la = [long][Math]::Round([double]$p['lat'] * 1e6); $lo = [long][Math]::Round([double]$p['lon'] * 1e6)
    if (-not $erster -and $la -eq $la0 -and $lo -eq $lo0) { continue }
    if ($erster) { $teile.Add("$la"); $teile.Add("$lo"); $erster = $false } else { $teile.Add([string]($la - $la0)); $teile.Add([string]($lo - $lo0)) }
    $la0 = $la; $lo0 = $lo; $punkte++
  }
  if ($punkte -lt 2) { continue }
  $zeilen.Add('[' + ($teile -join ',') + ']')
  $nachTempo[$tempo] = 1 + [int]$nachTempo[$tempo]
  $nachArt[$art] = 1 + [int]$nachArt[$art]
}
Write-Host ("{0} Strassenabschnitte" -f $zeilen.Count)
Write-Host ("  nach Art:   " + (($nachArt.Keys | Sort-Object | ForEach-Object { "$_=" + $nachArt[$_] }) -join ', '))
Write-Host ("  nach Tempo: " + (($nachTempo.Keys | Sort-Object { [int]$_ } | ForEach-Object { "$_=" + $nachTempo[$_] }) -join ', '))

$inhalt = '// Strassennetz in Oldenburg mit Hoechstgeschwindigkeit (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\26_Strassennetz_aktualisieren.ps1' + "`n" +
          '// w = [Tempo (km/h, 7 Schritt, 999 unbegrenzt, 0 unbekannt), Art (1 Autobahn ... 8 Fussgaengerzone), Breite, Laenge, Delta, Delta, ...] in Millionstel Grad' + "`n" +
          'var STRASSENNETZ_OLDENBURG = {"stand":"' + $Stand + '","einheit":1e-6,"w":[' + ($zeilen -join ',') + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} geschrieben ({1} KB)." -f $Ausgabe, [int]((Get-Item $Ausgabe).Length / 1024))
