# Holt alle Bushaltestellen, Bahnhoefe und Haltepunkte im Stadtgebiet von OpenStreetMap
# und schreibt sie in die Datei Standortanalyse\staedte\<Stadt>\oepnv.js (Ebene "OePNV" der App).
# Die Datenmenge ist klein, deshalb geht alles in einem Schritt.
#
# In OpenStreetMap ist dieselbe Haltestelle oft mehrfach eingetragen (als Haltestellen-Punkt, als Bahnsteig-Linie
# und als Halteposition der Busse). Das Programm nimmt zuerst die Haltestellen-Punkte, ergaenzt Bahnsteige und
# Haltepositionen, die dort noch fehlen, und lässt Doppelte (naeher als 25 m zusammen) weg.

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\oepnv.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [double]$MindestabstandMeter = 25
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Stop'

# Stadtgebiet mit etwas Rand: Sued, West, Nord, Ost
$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
$bereich = "($sued,$west,$nord,$ost)"
$kennung = 'Standortanalyse-Studienprojekt/1.0'

# Mehrere frei nutzbare Dienste, falls einer ueberlastet ist
$dienste = @(
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
)

# 1. Bushaltestellen (Punkte)   2. Bahnhoefe, Haltepunkte, Strassenbahnhaltestellen
# 3. Bahnsteige der Busse (Linien, es wird deren Mitte genommen)   4. Haltepositionen der Busse
$abfrage = '[out:json][timeout:120];(' +
           'node["highway"="bus_stop"]' + $bereich + ';' +
           'node["railway"~"^(station|halt|tram_stop)$"]' + $bereich + ';' +
           'way["public_transport"="platform"]["bus"="yes"]' + $bereich + ';' +
           'node["public_transport"="stop_position"]["bus"="yes"]' + $bereich + ';' +
           ');out center;'

$antwort = $null
foreach ($dienst in $dienste) {
  for ($versuch = 1; $versuch -le 3 -and -not $antwort; $versuch++) {
    try {
      Write-Host "Frage $dienst ab (Versuch $versuch) ..."
      $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ('data=' + [uri]::EscapeDataString($abfrage)) `
           -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } `
           -UseBasicParsing -UserAgent $kennung -TimeoutSec 150
      $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
      if ($text -notmatch '"elements"') { throw 'unbrauchbare Antwort' }
      $antwort = $text | ConvertFrom-Json
    } catch {
      Write-Host ('  fehlgeschlagen: ' + $_.Exception.Message)
      Start-Sleep -Seconds (8 * $versuch)
    }
  }
  if ($antwort) { break }
}
if (-not $antwort) { throw 'Kein Dienst hat geantwortet. Bitte spaeter noch einmal versuchen.' }

# Jeden Eintrag einer Rangstufe zuordnen: 0 = Bahnhof/Haltepunkt, 1 = Haltestellen-Punkt, 2 = Bahnsteig-Linie, 3 = Halteposition
$kandidaten = New-Object System.Collections.Generic.List[object]
foreach ($e in $antwort.elements) {
  if ($e.type -eq 'way') { $lat = [double]$e.center.lat; $lon = [double]$e.center.lon } else { $lat = [double]$e.lat; $lon = [double]$e.lon }
  if ($e.tags.railway) { $rang = 0; $art = 1 }
  elseif ($e.type -eq 'way') { $rang = 2; $art = 0 }
  elseif ($e.tags.highway -eq 'bus_stop') { $rang = 1; $art = 0 }
  else { $rang = 3; $art = 0 }
  $kandidaten.Add([pscustomobject]@{ Rang = $rang; Art = $art; Lat = $lat; Lon = $lon })
}

# Doppelte erkennen: ein Raster mit Zellen von etwa 40 m, geprueft wird in der Zelle und ihren Nachbarn
$meterProGradBreite = 111195.0
$meterProGradLaenge = 111195.0 * [Math]::Cos($StadtInfo.Breite * [Math]::PI / 180)
$zelleLat = 0.0004; $zelleLon = 0.0007
$raster = @{}
$punkte = New-Object System.Collections.Generic.List[object]

foreach ($k in ($kandidaten | Sort-Object Rang)) {
  $zi = [int][Math]::Floor($k.Lat / $zelleLat); $zj = [int][Math]::Floor($k.Lon / $zelleLon)
  $doppelt = $false
  # Bahnhoefe und Haltestellen-Punkte bleiben alle erhalten (auch zwei gegenueberliegende Haltestellen einer Strasse),
  # nur genau uebereinanderliegende werden zusammengefasst. Bahnsteige und Haltepositionen kommen nur dazu,
  # wenn in den naechsten 25 m noch nichts ist.
  if ($k.Rang -le 1) { $grenze = 1.0 } else { $grenze = $MindestabstandMeter }
  for ($di = -1; $di -le 1 -and -not $doppelt; $di++) {
    for ($dj = -1; $dj -le 1 -and -not $doppelt; $dj++) {
      $schluessel = '{0}_{1}' -f ($zi + $di), ($zj + $dj)
      if (-not $raster.ContainsKey($schluessel)) { continue }
      foreach ($p in $raster[$schluessel]) {
        $dx = ($k.Lon - $p.Lon) * $meterProGradLaenge; $dy = ($k.Lat - $p.Lat) * $meterProGradBreite
        if ([Math]::Sqrt($dx * $dx + $dy * $dy) -lt $grenze) { $doppelt = $true; break }
      }
    }
  }
  if ($doppelt) { continue }
  $eigener = '{0}_{1}' -f $zi, $zj
  if (-not $raster.ContainsKey($eigener)) { $raster[$eigener] = New-Object System.Collections.Generic.List[object] }
  $raster[$eigener].Add($k)
  $punkte.Add($k)
}

# Breite und Laenge in Millionstel Grad, Art 0 = Bushaltestelle, 1 = Bahnhof/Haltepunkt
$zeilen = New-Object System.Collections.Generic.List[string]
foreach ($p in $punkte) {
  $lat = [long][Math]::Round($p.Lat * 1e6)
  $lon = [long][Math]::Round($p.Lon * 1e6)
  $zeilen.Add("[$lat,$lon,$($p.Art)]")
}

$inhalt = '// Haltestellen und Bahnhoefe in ' + $StadtInfo.Ascii + ' (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\5_OePNV_aktualisieren.ps1' + "`n" +
          'var OEPNV_DATEN = {"stand":"' + $Stand + '","einheit":1e-6,"punkte":[' + ($zeilen -join ',') + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))

$bahn = @($punkte | Where-Object { $_.Art -eq 1 }).Count
Write-Host ("Eintraege von OpenStreetMap: {0}, nach Entfernen der Doppelten: {1}" -f $kandidaten.Count, $punkte.Count)
Write-Host ("Fertig: {0} Punkte ({1} Bahnhoefe/Haltepunkte, {2} Bushaltestellen) in {3}" -f $punkte.Count, $bahn, ($punkte.Count - $bahn), $Ausgabe)
