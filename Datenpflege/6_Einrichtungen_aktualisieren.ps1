# Holt Laeden, Schulen, Aerzte/Apotheken sowie Freizeit- und Kultureinrichtungen im Stadtgebiet Oldenburg
# von OpenStreetMap und schreibt sie in die Datei Standortanalyse\einrichtungen_oldenburg.js
# (Ebenen "Laeden", "Schulen und Kitas", "Aerzte und Apotheken", "Freizeit und Kultur" der App).
# Die Datenmenge ist klein, deshalb geht alles in einem Schritt.
#
# Dieselbe Einrichtung ist in OpenStreetMap oft doppelt eingetragen (als Punkt und als Gebaeude-Flaeche).
# Punkte werden alle uebernommen, Flaechen (es wird deren Mitte genommen) nur, wenn in den naechsten 30 m
# in derselben Gruppe noch kein Punkt liegt.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\einrichtungen_oldenburg.js'),
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

# Was zu welcher Gruppe gehoert (Reihenfolge = Vorrang, falls etwas zu mehreren passt)
$gruppen = @(
  @{ Name = 'aerzte';   Tags = @{ amenity = '^(doctors|dentist|clinic|hospital|pharmacy)$' } },
  @{ Name = 'schulen';  Tags = @{ amenity = '^(school|kindergarten|childcare|college|university)$' } },
  @{ Name = 'laeden';   Tags = @{ shop = '^(supermarket|convenience|bakery|butcher|greengrocer|chemist|department_store|mall)$' } },
  @{ Name = 'freizeit'; Tags = @{ amenity = '^(restaurant|cafe|bar|pub|biergarten|fast_food|library|theatre|cinema|arts_centre)$';
                                  leisure = '^(playground|sports_centre|fitness_centre|stadium)$';
                                  tourism = '^(museum|gallery)$' } }
)

# Eine Abfrage mit allen Gruppen (Punkte und Flaechen, bei Flaechen die Mitte)
$teile = New-Object System.Collections.Generic.List[string]
foreach ($g in $gruppen) {
  foreach ($schluessel in $g.Tags.Keys) {
    $wert = $g.Tags[$schluessel]
    $teile.Add('nwr["' + $schluessel + '"~"' + $wert + '"]' + $bereich + ';')
  }
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

# Jede Einrichtung genau einer Gruppe zuordnen
$alle = New-Object System.Collections.Generic.List[object]
foreach ($e in $antwort.elements) {
  if ($e.type -eq 'node') { $lat = [double]$e.lat; $lon = [double]$e.lon; $flaeche = 0 }
  else { if (-not $e.center) { continue }; $lat = [double]$e.center.lat; $lon = [double]$e.center.lon; $flaeche = 1 }
  $gruppe = $null; $art = ''
  foreach ($g in $gruppen) {
    foreach ($schluessel in $g.Tags.Keys) {
      $wert = $e.tags.$schluessel
      if ($wert -and ($wert -match $g.Tags[$schluessel])) { $gruppe = $g.Name; $art = [string]$wert; break }
    }
    if ($gruppe) { break }
  }
  if (-not $gruppe) { continue }
  $bez = ''
  if ($e.tags.name) { $bez = [string]$e.tags.name }
  $alle.Add([pscustomobject]@{ Gruppe = $gruppe; Flaeche = $flaeche; Lat = $lat; Lon = $lon; Art = $art; Bez = $bez })
}

# Name und Art kommen mit in die Datei (fuer das Fenster beim Anklicken in der App)
# Doppelte erkennen (Raster mit Zellen von etwa 40 m, geprueft wird in der Zelle und ihren Nachbarn)
$meterProGradBreite = 111195.0
$meterProGradLaenge = 111195.0 * [Math]::Cos(53.14 * [Math]::PI / 180)
$zelleLat = 0.0004; $zelleLon = 0.0007
$ergebnis = [ordered]@{}
foreach ($g in $gruppen) { $ergebnis[$g.Name] = New-Object System.Collections.Generic.List[object] }

foreach ($g in $gruppen) {
  $raster = @{}
  foreach ($k in ($alle | Where-Object { $_.Gruppe -eq $g.Name } | Sort-Object Flaeche)) {
    $zi = [int][Math]::Floor($k.Lat / $zelleLat); $zj = [int][Math]::Floor($k.Lon / $zelleLon)
    if ($k.Flaeche -eq 0) { $grenze = 2.0 } else { $grenze = 30.0 }
    $doppelt = $false
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
    $ergebnis[$g.Name].Add($k)
  }
}

# Breite und Laenge in Millionstel Grad
$teileJs = New-Object System.Collections.Generic.List[string]
foreach ($name in $ergebnis.Keys) {
  $zeilen = New-Object System.Collections.Generic.List[string]
  foreach ($p in $ergebnis[$name]) {
    # [Breite, Laenge, Art (OpenStreetMap-Wert, z. B. bakery), Name]; der Name entfaellt, wenn OpenStreetMap keinen hat
    $z = '[' + [long][Math]::Round($p.Lat * 1e6) + ',' + [long][Math]::Round($p.Lon * 1e6) + ',"' + $p.Art + '"'
    if ($p.Bez) {
      $bez = ($p.Bez -replace '[\x00-\x1f  ]', ' ').Replace('\', '\\').Replace('"', '\"')
      $z += ',"' + $bez + '"'
    }
    $zeilen.Add($z + ']')
  }
  $teileJs.Add('"' + $name + '":[' + ($zeilen -join ',') + ']')
  Write-Host ("  {0}: {1}" -f $name, $zeilen.Count)
}

$inhalt = '// Einrichtungen in Oldenburg (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\6_Einrichtungen_aktualisieren.ps1' + "`n" +
          'var EINRICHTUNGEN_OLDENBURG = {"stand":"' + $Stand + '","einheit":1e-6,"gruppen":{' + ($teileJs -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} Eintraege von OpenStreetMap, in {1} geschrieben." -f $alle.Count, $Ausgabe)
