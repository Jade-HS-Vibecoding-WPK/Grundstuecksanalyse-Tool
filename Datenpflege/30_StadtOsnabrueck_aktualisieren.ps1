# Holt offene Geodaten der Stadt Osnabrueck und schreibt sie in die Datei Standortanalyse\staedte\osnabrueck\stadt.js
# (Ebenen "Bebauungsplaene", "Landschaftsschutz", "Biotope", "Naturdenkmale" und "Stadtteile" der App).
#
# Quelle: Stadt Osnabrueck, Fachdienst Geodaten, Geodatenportal https://geo.osnabrueck.de/geodatenportal/ (ArcGIS-Dienste).
# Lizenz: Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0, https://www.govdata.de/dl-de/by-2-0).
# Quellenvermerk laut Nutzungsbedingungen: "Datenquelle: dl-de/by-2-0: Stadt Osnabrueck, Fachdienst Geodaten" (macht die App).
# Die Daten sind klein, alles geht in einem Schritt. Nur fuer Osnabrueck.

param(
  [string]$Stadt = 'osnabrueck',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\stadt.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt
if ($Stadt -ne 'osnabrueck') { throw 'Dieses Programm holt Daten, die nur die Stadt Osnabrueck anbietet.' }

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions
$kennung = 'Standortanalyse-Studienprojekt/1.0'
$basis = 'https://geo.osnabrueck.de/arcgis/rest/services/'

# Was geholt wird. Offset = Vereinfachung der Linien in Grad (0.000004 ca. 0,4 m), Attr = Feld fuer die Beschriftung.
$quellen = @(
  @{ Id = 'bplan';         Dienst = 'Bebauungsplaene';      Ebene = 0; Offset = '0.000004'; Attr = 'B_PLAN_NR' },
  @{ Id = 'lsg';           Dienst = 'schutzgebiete';        Ebene = 5; Offset = '0.000004'; Attr = 'BEZEICHNUN' },
  @{ Id = 'biotope';       Dienst = 'schutzgebiete';        Ebene = 1; Offset = '0.000004'; Attr = 'Lage' },
  @{ Id = 'naturdenkmale'; Dienst = 'schutzgebiete';        Ebene = 0; Offset = '0';        Attr = 'Name' },
  @{ Id = 'bezirke';       Dienst = 'WFS/wfs_statistik';    Ebene = 2; Offset = '0.000004'; Attr = 'Stadtteilname' }
)

$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$serializer.RecursionLimit = 200

function Hole-Json($url) {
  for ($versuch = 1; $versuch -le 3; $versuch++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 120 -UserAgent $kennung
      $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
      return $serializer.DeserializeObject($text)
    } catch {
      Write-Host ('  Versuch ' + $versuch + ' fehlgeschlagen: ' + $_.Exception.Message)
      Start-Sleep -Seconds (5 * $versuch)
    }
  }
  throw "Konnte $url nicht laden."
}

# Ein Ring (Liste von [Laenge, Breite]) als Zahlenfolge [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad
function Ring-Text($ring) {
  $teile = New-Object System.Collections.Generic.List[string]
  $la0 = 0L; $lo0 = 0L; $erster = $true; $n = $ring.Count
  if ($n -gt 1) {
    $a = $ring[0]; $z = $ring[$n - 1]
    if ([Math]::Round([double]$a[0] * 1e6) -eq [Math]::Round([double]$z[0] * 1e6) -and [Math]::Round([double]$a[1] * 1e6) -eq [Math]::Round([double]$z[1] * 1e6)) { $n-- }
  }
  for ($i = 0; $i -lt $n; $i++) {
    $lo = [long][Math]::Round([double]$ring[$i][0] * 1e6)
    $la = [long][Math]::Round([double]$ring[$i][1] * 1e6)
    if ($erster) { $teile.Add("$la"); $teile.Add("$lo"); $erster = $false }
    else { $teile.Add([string]($la - $la0)); $teile.Add([string]($lo - $lo0)) }
    $la0 = $la; $lo0 = $lo
  }
  return '[' + ($teile -join ',') + ']'
}

function Json-Text($s) {
  if ($null -eq $s) { return '""' }
  return $serializer.Serialize([string]$s)
}

function Wandle-Sammlung($sammlung, $attr) {
  $flaechen = New-Object System.Collections.Generic.List[string]
  $punkte = New-Object System.Collections.Generic.List[string]
  $attribute = New-Object System.Collections.Generic.List[string]
  foreach ($f in $sammlung) {
    $g = $f['geometry']; if (-not $g) { continue }
    $a = ''
    if ($attr -and $f['properties'].ContainsKey($attr) -and $null -ne $f['properties'][$attr]) { $a = [string]$f['properties'][$attr] }
    if ($a -eq '<Null>') { $a = '' }
    $teile = @()
    switch ($g['type']) {
      'Polygon'      { $teile = @(,$g['coordinates']) }
      'MultiPolygon' { $teile = @($g['coordinates']) }
      'Point'        { $punkte.Add('[' + [long][Math]::Round([double]$g['coordinates'][1] * 1e6) + ',' + [long][Math]::Round([double]$g['coordinates'][0] * 1e6) + ']'); $attribute.Add((Json-Text $a)); continue }
      default        { continue }
    }
    foreach ($polygon in $teile) {
      $ringe = New-Object System.Collections.Generic.List[string]
      foreach ($ring in $polygon) { if ($ring.Count -ge 3) { $ringe.Add((Ring-Text $ring)) } }
      if ($ringe.Count -gt 0) { $flaechen.Add('[' + ($ringe -join ',') + ']'); $attribute.Add((Json-Text $a)) }
    }
  }
  return @{ Flaechen = $flaechen; Punkte = $punkte; Attribute = $attribute }
}

$gruppen = New-Object System.Collections.Generic.List[string]
foreach ($q in $quellen) {
  Write-Host ("{0} ({1}, Ebene {2})" -f $q.Id, $q.Dienst, $q.Ebene)
  $alle = New-Object System.Collections.Generic.List[object]
  $offset = 0
  while ($true) {   # seitenweise holen (der Dienst liefert je Anfrage nur eine begrenzte Zahl)
    $url = $basis + $q.Dienst + '/MapServer/' + $q.Ebene + '/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=6&resultOffset=' + $offset + '&resultRecordCount=500&f=geojson'
    if ($q.Offset -ne '0') { $url += '&maxAllowableOffset=' + $q.Offset }
    $s = Hole-Json $url
    $n = $s['features'].Count
    foreach ($f in $s['features']) { $alle.Add($f) }
    if ($n -eq 0 -or -not ($s.ContainsKey('exceededTransferLimit') -and $s['exceededTransferLimit'])) { break }
    $offset += $n
  }
  $w = Wandle-Sammlung $alle $q.Attr
  if ($w.Punkte.Count -gt 0) { $eintrag = '"' + $q.Id + '":{"p":[' + ($w.Punkte -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']}' }
  else { $eintrag = '"' + $q.Id + '":{"f":[' + ($w.Flaechen -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']}' }
  $gruppen.Add($eintrag)
  Write-Host ("  {0} Objekte, {1} Flaechen, {2} Punkte" -f $alle.Count, $w.Flaechen.Count, $w.Punkte.Count)
}

# Naturschutzgebiete gibt es im Dienst der Stadt nicht: sie kommen aus dem Kartendienst des Landes (NLWKN)
. (Join-Path $PSScriptRoot 'landdaten.ps1')
foreach ($g in (Hole-LandSchutzGruppen $StadtInfo @('nsg'))) { $gruppen.Add($g) }

$inhalt = '// Offene Geodaten der Stadt Osnabrueck: Bebauungsplaene (Umringe), Landschaftsschutzgebiete, gesetzlich geschuetzte Biotope, Naturdenkmale, Stadtteile; dazu Naturschutzgebiete des Landes Niedersachsen (NLWKN).' + "`n" +
          '// Quelle: Stadt Osnabrueck, Fachdienst Geodaten, Datenlizenz Deutschland - Namensnennung - Version 2.0 (https://www.govdata.de/dl-de/by-2-0); Naturschutzgebiete: NLWKN Niedersachsen.' + "`n" +
          '// Erzeugt mit Datenpflege\30_StadtOsnabrueck_aktualisieren.ps1. f = Flaechen (Ringe als [Breite, Laenge, Delta, ...] in Millionstel Grad), p = Punkte, a = Beschriftung je Eintrag.' + "`n" +
          'var STADT_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","gruppen":{' + ($gruppen -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} KB in {1}" -f [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
