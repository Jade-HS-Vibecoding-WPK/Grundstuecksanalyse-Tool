# Holt den Flaechennutzungsplan (FNP) der Stadt Oldenburg und schreibt ihn in die Datei Standortanalyse\staedte\<Stadt>\fnp.js
# (Ebenen "Flaechennutzungsplan" der App).
#
# Quelle: Stadt Oldenburg (Oldb), INSPIRE-Downloaddienst (WFS 2.0) "Flaechennutzungsplan Stadt Oldenburg INSPIRE"
# (Stand der Daten: Aenderungen und Berichtigungen bis 05.07.2024, rechtswirksam), erreichbar ueber inspire.govconnect.de.
# Lizenz laut Dienst: Datenlizenz Deutschland - Zero - Version 2.0 (dl-zero-de/2.0, https://www.govdata.de/dl-de/zero-2-0),
# also ohne Pflicht zur Namensnennung. Die App nennt die Stadt trotzdem.
# Wichtig: Der gleiche Plan mit neuerem Stand (20.12.2024) steht als WMS/WFS mit "Nutzungsbedingungen unbekannt" bereit.
# Deshalb wird hier der Dienst mit eindeutiger Lizenz benutzt.
#
# Ein Schritt. Der Dienst ist langsam (je Flaechenart etwa 10 bis 40 Sekunden). Es entsteht eine kleine Datei (unter 1 MB).

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\fnp.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt
if ($Stadt -ne 'oldenburg') { throw 'Dieses Programm holt Daten, die nur die Stadt Oldenburg anbietet. Fuer andere Staedte gibt es ein eigenes Programm (siehe LIESMICH.txt, Neue Stadt).' }

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dienst = 'https://inspire.govconnect.de/ows/services/org.53.019885a7-e4bc-4f48-a23e-925ac8b1d89f_wfs/org.53.e871ee2c-1877-43ba-85ab-e68a20509eda'

# Was geholt wird: Typ im Dienst, Feld zum Aufteilen (leer = keins) und die Zuordnung der Werte zu Gruppen der App.
# allgArtDerBaulNutzung (XPlanung): 1000 Wohnbauflaeche, 2000 Gemischte Baufläche, 3000 Gewerbliche Baufläche, 4000 Sonderbaufläche
$quellen = @(
  @{ Typ = 'FP_BebauungsFlaeche'; Feld = 'allgArtDerBaulNutzung'; Gruppen = @{ '1000' = 'fnp_wohnen'; '2000' = 'fnp_gemischt'; '3000' = 'fnp_gewerbe'; '4000' = 'fnp_sonder' } },
  @{ Typ = 'FP_Gemeinbedarf';     Feld = '';                     Gruppen = @{ '*' = 'fnp_gemeinbedarf' } },
  @{ Typ = 'FP_Gruen';            Feld = '';                     Gruppen = @{ '*' = 'fnp_gruen' } },
  @{ Typ = 'FP_WaldFlaeche';      Feld = '';                     Gruppen = @{ '*' = 'fnp_wald' } },
  @{ Typ = 'FP_Gewaesser';        Feld = '';                     Gruppen = @{ '*' = 'fnp_wasser' } },
  @{ Typ = 'FP_Landwirtschaft';   Feld = '';                     Gruppen = @{ '*' = 'fnp_landwirtschaft' } }
)
$reihenfolge = @('fnp_wohnen', 'fnp_gemischt', 'fnp_gewerbe', 'fnp_sonder', 'fnp_gemeinbedarf', 'fnp_gruen', 'fnp_wald', 'fnp_wasser', 'fnp_landwirtschaft')

$ci = [Globalization.CultureInfo]::InvariantCulture
$daten = @{}
foreach ($id in $reihenfolge) { $daten[$id] = New-Object System.Collections.ArrayList }

# Ein Ring (Liste von [Laenge, Breite]) als Zahlen [Breite, Laenge, Delta, Delta ...] in Millionstel Grad.
# Der letzte Punkt (= erster) wird weggelassen.
function Ring-Zahlen($ring) {
  $teile = New-Object System.Collections.ArrayList
  $la0 = 0; $lo0 = 0; $n = $ring.Count
  if ($n -gt 1 -and $ring[0][0] -eq $ring[$n - 1][0] -and $ring[0][1] -eq $ring[$n - 1][1]) { $n-- }
  for ($i = 0; $i -lt $n; $i++) {
    $la = [long][Math]::Round([double]$ring[$i][1] * 1e6)
    $lo = [long][Math]::Round([double]$ring[$i][0] * 1e6)
    if ($i -gt 0 -and $la -eq $la0 -and $lo -eq $lo0) { continue }
    [void]$teile.Add(($la - $la0).ToString($ci)); [void]$teile.Add(($lo - $lo0).ToString($ci))
    $la0 = $la; $lo0 = $lo
  }
  if ($teile.Count -lt 6) { return $null }
  return '[' + ($teile -join ',') + ']'
}

foreach ($q in $quellen) {
  $adresse = $dienst + '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=xplan:' + $q.Typ + '&OUTPUTFORMAT=application/geo%2Bjson&SRSNAME=EPSG:4326'
  $tmp = Join-Path $env:TEMP ('fnp_' + $q.Typ + '.json')
  $ok = $false
  for ($versuch = 1; $versuch -le 3 -and -not $ok; $versuch++) {
    try {
      Write-Host ('Hole ' + $q.Typ + ' (Versuch ' + $versuch + ') ...')
      Invoke-WebRequest $adresse -OutFile $tmp -UseBasicParsing -TimeoutSec 240
      $ok = $true
    } catch { Write-Host ('  Fehler: ' + $_.Exception.Message); Start-Sleep -Seconds 5 }
  }
  if (-not $ok) { throw ('Der Dienst lieferte ' + $q.Typ + ' nicht.') }
  $json = Get-Content $tmp -Raw -Encoding UTF8 | ConvertFrom-Json
  $anzahl = 0
  foreach ($f in $json.features) {
    $schl = '*'
    if ($q.Feld) { $schl = [string]$f.properties.($q.Feld); if (-not $q.Gruppen.ContainsKey($schl)) { continue } }
    $gruppe = $q.Gruppen[$schl]
    $polys = @()
    if ($f.geometry.type -eq 'Polygon') { $polys = @(, $f.geometry.coordinates) }
    elseif ($f.geometry.type -eq 'MultiPolygon') { $polys = $f.geometry.coordinates }
    foreach ($poly in $polys) {
      $ringe = @()
      foreach ($ring in $poly) { $z = Ring-Zahlen $ring; if ($z) { $ringe += $z } }
      if ($ringe.Count -gt 0) { [void]$daten[$gruppe].Add('[' + ($ringe -join ',') + ']'); $anzahl++ }
    }
  }
  Write-Host ('  ' + $anzahl + ' Flaechen')
  Remove-Item $tmp -ErrorAction SilentlyContinue
}

$gruppenText = New-Object System.Collections.ArrayList
foreach ($id in $reihenfolge) { [void]$gruppenText.Add('"' + $id + '":{"f":[' + ($daten[$id] -join ',') + ']}') }
$inhalt = '// Flaechennutzungsplan der Stadt Oldenburg (Oldb): Wohn-, gemischte, gewerbliche und Sonderbauflaechen, Gemeinbedarf, Gruen, Wald, Wasser, Landwirtschaft.' + "`n" +
          '// Quelle: Stadt Oldenburg (Oldb), INSPIRE-Downloaddienst Flaechennutzungsplan (Stand: Aenderungen bis 05.07.2024), Datenlizenz Deutschland - Zero - Version 2.0 (https://www.govdata.de/dl-de/zero-2-0).' + "`n" +
          '// Erzeugt mit Datenpflege\23_Flaechennutzungsplan_aktualisieren.ps1. f = Flaechen (Ringe als [Breite, Laenge, Delta, ...] in Millionstel Grad).' + "`n" +
          'var FNP_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","gruppen":{' + ($gruppenText -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('Fertig: ' + $Ausgabe + ' (' + [Math]::Round($inhalt.Length / 1024) + ' KB)')
