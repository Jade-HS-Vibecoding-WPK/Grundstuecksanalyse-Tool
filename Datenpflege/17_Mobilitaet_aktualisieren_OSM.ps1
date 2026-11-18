# Holt Radwege, Strassen mit Radfahrstreifen, Fahrradabstellanlagen, Parkhaeuser, Parkplaetze sowie Carsharing- und Leihrad-
# Stationen im Stadtgebiet von OpenStreetMap und schreibt sie in die Datei
# Standortanalyse\staedte\<Stadt>\mobilitaet.js (Ebenen unter "Verkehr und Mobilitaet" der App).
# (Die Ladestationen kommen aus einem eigenen Schritt, 18_Ladestationen_aktualisieren.ps1, und werden in dieselbe Datei geschrieben.)
#
# Es ist nur dieser eine Schritt noetig. Die Datenmenge ist klein. Das Programm liest eine vorhandene Datei, behaelt darin die
# Ladestationen und ersetzt nur die OpenStreetMap-Teile.

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\mobilitaet.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions

# Stadtgebiet mit etwas Rand: Sued, West, Nord, Ost
$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
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

# ---- 1. Linien: Radwege, Fahrradstrassen, Strassen mit Radfahrstreifen ----
$strassen = '^(residential|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|unclassified|living_street)$'
$radSeite = '^(lane|track|shared_busway|opposite_lane|opposite_track)$'
$q1 = '[out:json][timeout:240];(' +
      'way["highway"="cycleway"]' + $b + ';' +
      'way["bicycle_road"="yes"]' + $b + ';' +
      'way["highway"~"^(path|footway)$"]["bicycle"="designated"]' + $b + ';' +
      'way["highway"~"' + $strassen + '"]["cycleway"~"' + $radSeite + '"]' + $b + ';' +
      'way["highway"~"' + $strassen + '"]["cycleway:left"~"' + $radSeite + '"]' + $b + ';' +
      'way["highway"~"' + $strassen + '"]["cycleway:right"~"' + $radSeite + '"]' + $b + ';' +
      'way["highway"~"' + $strassen + '"]["cycleway:both"~"' + $radSeite + '"]' + $b + ';' +
      ');out geom qt;'
$w1 = Hole-Overpass $q1

function Ist-Rad($tags) {
  foreach ($k in 'cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both') {
    if ($tags.ContainsKey($k) -and ($tags[$k] -match $radSeite)) { return $true }
  }
  return $false
}

$radwege = New-Object System.Collections.Generic.List[string]
$radstreifen = New-Object System.Collections.Generic.List[string]
$gesehen = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($e in $w1['elements']) {
  if ($e['type'] -ne 'way') { continue }
  if (-not $gesehen.Add([string]$e['id'])) { continue }
  $geo = $e['geometry']; if (-not $geo -or $geo.Count -lt 2) { continue }
  $tags = $e['tags']; if (-not $tags) { continue }
  $eigener = ($tags['highway'] -eq 'cycleway') -or ($tags['bicycle_road'] -eq 'yes') -or ($tags['bicycle'] -eq 'designated' -and $tags['highway'] -match '^(path|footway)$')
  if (-not $eigener -and -not (Ist-Rad $tags)) { continue }
  $teile = New-Object System.Collections.Generic.List[string]
  $la0 = 0L; $lo0 = 0L; $erster = $true
  foreach ($p in $geo) {
    $la = [long][Math]::Round([double]$p['lat'] * 1e6); $lo = [long][Math]::Round([double]$p['lon'] * 1e6)
    if (-not $erster -and $la -eq $la0 -and $lo -eq $lo0) { continue }
    if ($erster) { $teile.Add("$la"); $teile.Add("$lo"); $erster = $false } else { $teile.Add([string]($la - $la0)); $teile.Add([string]($lo - $lo0)) }
    $la0 = $la; $lo0 = $lo
  }
  if ($teile.Count -lt 4) { continue }
  $zeile = '[' + ($teile -join ',') + ']'
  if ($eigener) { $radwege.Add($zeile) } else { $radstreifen.Add($zeile) }
}
Write-Host ("Radwege und Fahrradstrassen: {0}, Strassen mit Radfahrstreifen: {1}" -f $radwege.Count, $radstreifen.Count)

# ---- 2. Punkte: Abstellanlagen, Parken, Sharing ----
$q2 = '[out:json][timeout:240];(' +
      'nwr["amenity"="bicycle_parking"]' + $b + ';' +
      'nwr["amenity"="parking"]["access"!~"^(private|no)$"]["parking"!~"^(lane|street_side|on_kerb|half_on_kerb)$"]' + $b + ';' +
      'nwr["amenity"~"^(car_sharing|bicycle_rental|kick-scooter_rental)$"]' + $b + ';' +
      ');out center tags qt;'
$w2 = Hole-Overpass $q2

$punkte = @{ radstellplatz = @(); parkhaus = @(); parkplatz = @(); sharing = @() }
foreach ($e in $w2['elements']) {
  $tags = $e['tags']; if (-not $tags) { continue }
  if ($e['type'] -eq 'node') { $lat = [double]$e['lat']; $lon = [double]$e['lon']; $flaeche = 0 }
  else { if (-not $e['center']) { continue }; $lat = [double]$e['center']['lat']; $lon = [double]$e['center']['lon']; $flaeche = 1 }
  $a = $tags['amenity']
  if ($a -eq 'bicycle_parking') { $g = 'radstellplatz' }
  elseif ($a -eq 'parking') { if ($tags['parking'] -match '^(multi-storey|underground)$') { $g = 'parkhaus' } else { $g = 'parkplatz' } }
  else { $g = 'sharing' }
  $punkte[$g] += [pscustomobject]@{ Lat = $lat; Lon = $lon; Flaeche = $flaeche }
}

# Doppelte erkennen: Punkte bis auf 6 m (Abstellanlagen) bzw. 30 m (Flaechen) zusammenfassen
$mLat = 111195.0; $mLon = 111195.0 * [Math]::Cos($StadtInfo.Breite * [Math]::PI / 180)
function Ohne-Doppelte($liste, [double]$grenzePunkt, [double]$grenzeFlaeche) {
  $raster = @{}; $aus = New-Object System.Collections.Generic.List[object]
  foreach ($k in ($liste | Sort-Object Flaeche)) {
    $zi = [int][Math]::Floor($k.Lat / 0.0004); $zj = [int][Math]::Floor($k.Lon / 0.0007)
    $grenze = if ($k.Flaeche -eq 0) { $grenzePunkt } else { $grenzeFlaeche }
    $doppelt = $false
    for ($di = -1; $di -le 1 -and -not $doppelt; $di++) { for ($dj = -1; $dj -le 1 -and -not $doppelt; $dj++) {
      $s = '{0}_{1}' -f ($zi + $di), ($zj + $dj)
      if (-not $raster.ContainsKey($s)) { continue }
      foreach ($p in $raster[$s]) {
        $dx = ($k.Lon - $p.Lon) * $mLon; $dy = ($k.Lat - $p.Lat) * $mLat
        if ([Math]::Sqrt($dx * $dx + $dy * $dy) -lt $grenze) { $doppelt = $true; break }
      }
    } }
    if ($doppelt) { continue }
    $e = '{0}_{1}' -f $zi, $zj
    if (-not $raster.ContainsKey($e)) { $raster[$e] = New-Object System.Collections.Generic.List[object] }
    $raster[$e].Add($k); $aus.Add($k)
  }
  return $aus
}

$teileJs = New-Object System.Collections.Generic.List[string]
$teileJs.Add('"radweg":{"l":[' + ($radwege -join ',') + ']}')
$teileJs.Add('"radstreifen":{"l":[' + ($radstreifen -join ',') + ']}')
foreach ($g in 'radstellplatz', 'parkhaus', 'parkplatz', 'sharing') {
  $gr = if ($g -eq 'radstellplatz') { 5.0 } else { 15.0 }
  $liste = Ohne-Doppelte $punkte[$g] $gr 30.0
  $zeilen = $liste | ForEach-Object { '[' + [long][Math]::Round($_.Lat * 1e6) + ',' + [long][Math]::Round($_.Lon * 1e6) + ']' }
  $teileJs.Add('"' + $g + '":{"p":[' + ($zeilen -join ',') + ']}')
  Write-Host ("  {0}: {1}" -f $g, @($liste).Count)
}

# Vorhandene Ladestationen aus der alten Datei uebernehmen (sie kommen aus einem anderen Schritt)
$laden = $null
if (Test-Path $Ausgabe) {
  $alt = [System.IO.File]::ReadAllText($Ausgabe, [System.Text.Encoding]::UTF8)
  $m = [regex]::Match($alt, '"lader":\{"p":\[.*?\]\}(?=[,}])', 'Singleline')
  if ($m.Success) { $laden = $m.Value }
  $m2 = [regex]::Match($alt, '"schnelllader":\{"p":\[.*?\]\}(?=[,}])', 'Singleline')
  if ($laden -and $m2.Success) { $laden += ',' + $m2.Value }
}
if ($laden) { $teileJs.Add($laden) }

$inhalt = '// Radwege, Parken und Sharing in ' + $StadtInfo.Ascii + ' (c) OpenStreetMap-Mitwirkende, ODbL; Ladestationen: Bundesnetzagentur, CC BY 4.0. Erzeugt mit Datenpflege\17_Mobilitaet_aktualisieren_OSM.ps1 und 18_Ladestationen_aktualisieren.ps1' + "`n" +
          'var MOBILITAET_DATEN = {"stand":"' + $Stand + '","einheit":1e-6,"gruppen":{' + ($teileJs -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} geschrieben ({1} KB)." -f $Ausgabe, [int]((Get-Item $Ausgabe).Length / 1024))
