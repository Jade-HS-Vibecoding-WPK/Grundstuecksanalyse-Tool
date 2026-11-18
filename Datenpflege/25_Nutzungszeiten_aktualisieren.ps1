# Holt Orte mit Nutzung im Stadtgebiet Oldenburg (Gastronomie, Laeden, Buero, Schulen, Aerzte, Hotels, Kultur, Sport u. a.)
# von OpenStreetMap, samt den Oeffnungszeiten (opening_hours), und schreibt sie in die Datei Standortanalyse\zeiten_oldenburg.js
# (Ebenen "Tagsueber aktiv", "Abends aktiv", "Nachts aktiv" der App, Abschnitt "Tag- und Nachtnutzung").
# Die Einteilung in tagsueber, abends und nachts macht die App selbst: nach den Oeffnungszeiten, wo es welche gibt,
# sonst nach der Art des Ortes. Hier wird nur gesammelt. Alles geht in einem Schritt (etwa 1 Minute).
#
# Dieselbe Einrichtung ist oft doppelt eingetragen (als Punkt und als Gebaeude-Flaeche). Punkte werden alle uebernommen,
# Flaechen (es wird deren Mitte genommen) nur, wenn in den naechsten 25 m noch kein Punkt der gleichen Art liegt.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\zeiten_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
$bereich = "($sued,$west,$nord,$ost)"
$kennung = 'Standortanalyse-Studienprojekt/1.0'

$dienste = @(
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
)

# Was gesammelt wird: Schluessel -> Kuerzel in der Datei, Wertliste (null = alle Werte)
$arten = @(
  @{ Schluessel = 'amenity'; Kurz = 'a'; Werte = '^(restaurant|cafe|bar|pub|biergarten|fast_food|nightclub|casino|stripclub|cinema|theatre|arts_centre|library|school|kindergarten|childcare|college|university|doctors|dentist|clinic|hospital|pharmacy|bank|post_office|townhall|courthouse|police|fire_station|community_centre|social_facility|marketplace|fuel|ice_cream|public_bath)$' },
  @{ Schluessel = 'shop';    Kurz = 's'; Werte = $null },
  @{ Schluessel = 'office';  Kurz = 'o'; Werte = $null },
  @{ Schluessel = 'tourism'; Kurz = 't'; Werte = '^(hotel|hostel|guest_house|motel|museum|gallery)$' },
  @{ Schluessel = 'leisure'; Kurz = 'l'; Werte = '^(fitness_centre|sports_centre|stadium|swimming_pool|dance)$' }
)

$teile = New-Object System.Collections.Generic.List[string]
foreach ($a in $arten) {
  if ($a.Werte) { $teile.Add('nwr["' + $a.Schluessel + '"~"' + $a.Werte + '"]' + $bereich + ';') }
  else { $teile.Add('nwr["' + $a.Schluessel + '"]' + $bereich + ';') }
}
$abfrage = '[out:json][timeout:180];(' + ($teile -join '') + ');out center tags;'

$antwort = $null
foreach ($dienst in $dienste) {
  for ($versuch = 1; $versuch -le 3 -and -not $antwort; $versuch++) {
    try {
      Write-Host "Frage $dienst ab (Versuch $versuch) ..."
      $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ('data=' + [uri]::EscapeDataString($abfrage)) `
           -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } `
           -UseBasicParsing -UserAgent $kennung -TimeoutSec 200
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

# Jeden Ort einer Art zuordnen (Reihenfolge der Schluessel = Vorrang)
$alle = New-Object System.Collections.Generic.List[object]
foreach ($e in $antwort.elements) {
  if ($e.type -eq 'node') { $lat = [double]$e.lat; $lon = [double]$e.lon; $flaeche = 0 }
  else { if (-not $e.center) { continue }; $lat = [double]$e.center.lat; $lon = [double]$e.center.lon; $flaeche = 1 }
  $typ = $null
  foreach ($a in $arten) {
    $wert = $e.tags.($a.Schluessel)
    if (-not $wert) { continue }
    $wert = [string]$wert
    if ($a.Werte -and ($wert -notmatch $a.Werte)) { continue }
    if ($wert -in @('yes', 'vacant', 'no')) { if ($a.Schluessel -eq 'shop' -and $wert -ne 'yes') { continue } }
    $typ = $a.Kurz + ':' + $wert; break
  }
  if (-not $typ) { continue }
  $bez = ''; if ($e.tags.name) { $bez = [string]$e.tags.name }
  $oh = ''; if ($e.tags.opening_hours) { $oh = [string]$e.tags.opening_hours }
  $alle.Add([pscustomobject]@{ Typ = $typ; Flaeche = $flaeche; Lat = $lat; Lon = $lon; Bez = $bez; Oh = $oh })
}

# Doppelte erkennen (Raster mit Zellen von etwa 40 m, geprueft wird in der Zelle und ihren Nachbarn), nur gleiche Art
$meterProGradBreite = 111195.0
$meterProGradLaenge = 111195.0 * [Math]::Cos(53.14 * [Math]::PI / 180)
$zelleLat = 0.0004; $zelleLon = 0.0007
$raster = @{}
$ergebnis = New-Object System.Collections.Generic.List[object]
foreach ($k in ($alle | Sort-Object Flaeche)) {
  $zi = [int][Math]::Floor($k.Lat / $zelleLat); $zj = [int][Math]::Floor($k.Lon / $zelleLon)
  if ($k.Flaeche -eq 0) { $grenze = 1.0 } else { $grenze = 25.0 }
  $doppelt = $false
  for ($di = -1; $di -le 1 -and -not $doppelt; $di++) {
    for ($dj = -1; $dj -le 1 -and -not $doppelt; $dj++) {
      $schluessel = '{0}_{1}' -f ($zi + $di), ($zj + $dj)
      if (-not $raster.ContainsKey($schluessel)) { continue }
      foreach ($p in $raster[$schluessel]) {
        if ($p.Typ -ne $k.Typ) { continue }
        $dx = ($k.Lon - $p.Lon) * $meterProGradLaenge; $dy = ($k.Lat - $p.Lat) * $meterProGradBreite
        if ([Math]::Sqrt($dx * $dx + $dy * $dy) -lt $grenze) { $doppelt = $true; break }
      }
    }
  }
  if ($doppelt) { continue }
  $eigener = '{0}_{1}' -f $zi, $zj
  if (-not $raster.ContainsKey($eigener)) { $raster[$eigener] = New-Object System.Collections.Generic.List[object] }
  $raster[$eigener].Add($k)
  $ergebnis.Add($k)
}

function JsText($s) { return '"' + (($s -replace '[\x00-\x1f]', ' ').Replace('\', '\\').Replace('"', '\"')) + '"' }
$zeilen = New-Object System.Collections.Generic.List[string]
$mitZeiten = 0
foreach ($p in $ergebnis) {
  # [Breite, Laenge (Millionstel Grad), Art, Name, Oeffnungszeiten]; Name und Zeiten entfallen, wenn OpenStreetMap keine hat
  $z = '[' + [long][Math]::Round($p.Lat * 1e6) + ',' + [long][Math]::Round($p.Lon * 1e6) + ',"' + $p.Typ + '"'
  if ($p.Bez -or $p.Oh) {
    $z += ',' + (JsText $p.Bez)
    if ($p.Oh) { $oh = $p.Oh; if ($oh.Length -gt 240) { $oh = $oh.Substring(0, 240) }; $z += ',' + (JsText $oh); $mitZeiten++ }
  }
  $zeilen.Add($z + ']')
}
Write-Host ("{0} Orte, davon {1} mit Oeffnungszeiten" -f $zeilen.Count, $mitZeiten)
$nachArt = $ergebnis | Group-Object { $_.Typ.Substring(0, 1) } | ForEach-Object { $_.Name + '=' + $_.Count }
Write-Host ("  nach Schluessel: " + ($nachArt -join ', '))

$inhalt = '// Orte mit Nutzung in Oldenburg samt Oeffnungszeiten (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\25_Nutzungszeiten_aktualisieren.ps1' + "`n" +
          '// p = [Breite, Laenge, Art (Kuerzel:Wert, a = amenity, s = shop, o = office, t = tourism, l = leisure), Name, opening_hours]' + "`n" +
          'var ZEITEN_OLDENBURG = {"stand":"' + $Stand + '","einheit":1e-6,"p":[' + ($zeilen -join ',') + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0:n0} Zeichen in {1} geschrieben." -f $inhalt.Length, $Ausgabe)
