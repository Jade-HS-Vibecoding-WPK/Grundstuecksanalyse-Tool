# Gemeinsame Hilfen fuer die Programme 30 und 32: Geometrien in das Format der App umschreiben und Schutzgebiete des Landes holen.
# Einbinden mit: . (Join-Path $PSScriptRoot 'landdaten.ps1')   (vorher stadt.ps1 einbinden und $StadtInfo setzen)

Add-Type -AssemblyName System.Web.Extensions
$script:serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:serializer.MaxJsonLength = [int]::MaxValue
$script:serializer.RecursionLimit = 200
$script:kennung = 'Standortanalyse-Studienprojekt/1.0'

function Json-Text($s) {
  if ($null -eq $s) { return '""' }
  return $script:serializer.Serialize([string]$s)
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

# Aus einer Liste von Wegstuecken (je Liste von [Laenge, Breite]) geschlossene Ringe zusammensetzen (Verwaltungsgrenzen aus OpenStreetMap)
function Baue-Ringe($segmente) {
  $rest = New-Object System.Collections.Generic.List[object]
  foreach ($s in $segmente) { if ($s.Count -ge 2) { $rest.Add($s) } }
  $ringe = New-Object System.Collections.Generic.List[object]
  function Schl($p) { return ([Math]::Round([double]$p[0] * 1e7)).ToString() + ',' + ([Math]::Round([double]$p[1] * 1e7)).ToString() }
  while ($rest.Count -gt 0) {
    $ring = New-Object System.Collections.Generic.List[object]
    foreach ($p in $rest[0]) { $ring.Add($p) }
    $rest.RemoveAt(0)
    $fortschritt = $true
    while ($fortschritt -and (Schl $ring[0]) -ne (Schl $ring[$ring.Count - 1])) {
      $fortschritt = $false
      $ende = Schl $ring[$ring.Count - 1]
      for ($i = 0; $i -lt $rest.Count; $i++) {
        $s = $rest[$i]
        if ((Schl $s[0]) -eq $ende) { for ($k = 1; $k -lt $s.Count; $k++) { $ring.Add($s[$k]) }; $rest.RemoveAt($i); $fortschritt = $true; break }
        elseif ((Schl $s[$s.Count - 1]) -eq $ende) { for ($k = $s.Count - 2; $k -ge 0; $k--) { $ring.Add($s[$k]) }; $rest.RemoveAt($i); $fortschritt = $true; break }
      }
    }
    if ((Schl $ring[0]) -eq (Schl $ring[$ring.Count - 1]) -and $ring.Count -ge 4) { $ringe.Add($ring) }
  }
  return ,$ringe   # Komma: sonst packt PowerShell einen einzelnen Ring aus und gibt seine Punkte statt des Rings zurueck
}

function Hole-Json($url) {
  for ($versuch = 1; $versuch -le 3; $versuch++) {
    try {
      $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 120 -UserAgent $script:kennung
      $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
      return $script:serializer.DeserializeObject($text)
    } catch {
      Write-Host ('  Versuch ' + $versuch + ' fehlgeschlagen: ' + $_.Exception.Message)
      Start-Sleep -Seconds (5 * $versuch)
    }
  }
  throw "Konnte $url nicht laden."
}

# Alle Objekte einer Ebene eines ArcGIS-Dienstes im Rechteck holen (seitenweise). $rechteck = Sued, West, Nord, Ost
function Hole-ArcGisObjekte($ebeneUrl, $rechteck, $offset) {
  $alle = New-Object System.Collections.Generic.List[object]
  $start = 0
  $geo = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0},{1},{2},{3}', $rechteck[1], $rechteck[0], $rechteck[3], $rechteck[2])   # West, Sued, Ost, Nord
  while ($true) {
    $url = $ebeneUrl + '/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=6&geometry=' + $geo + '&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&resultOffset=' + $start + '&resultRecordCount=500&f=geojson'
    if ($offset -and $offset -ne '0') { $url += '&maxAllowableOffset=' + $offset }
    $s = Hole-Json $url
    $n = $s['features'].Count
    foreach ($f in $s['features']) { $alle.Add($f) }
    if ($n -eq 0 -or -not ($s.ContainsKey('exceededTransferLimit') -and $s['exceededTransferLimit'])) { break }
    $start += $n
  }
  return $alle
}

# Objekte in Flaechen (Ringlisten), Punkte und Beschriftungen umwandeln. Flaechen ohne Punkt-Mittelpunkt: $alsPunkte = Mittelpunkt des Umrisses als Punkt
function Wandle-Objekte($objekte, $attr, [bool]$alsPunkte = $false) {
  $flaechen = New-Object System.Collections.Generic.List[string]
  $punkte = New-Object System.Collections.Generic.List[string]
  $attribute = New-Object System.Collections.Generic.List[string]
  foreach ($f in $objekte) {
    $g = $f['geometry']; if (-not $g) { continue }
    $a = ''
    if ($attr -and $f['properties'].ContainsKey($attr) -and $null -ne $f['properties'][$attr]) { $a = [string]$f['properties'][$attr] }
    if ($a -eq '<Null>') { $a = '' }
    $teile = @()
    switch ($g['type']) {
      'Polygon'      { $teile = @(,$g['coordinates']) }
      'MultiPolygon' { $teile = @($g['coordinates']) }
      'Point'        { $punkte.Add('[' + [long][Math]::Round([double]$g['coordinates'][1] * 1e6) + ',' + [long][Math]::Round([double]$g['coordinates'][0] * 1e6) + ']'); $attribute.Add((Json-Text $a)); continue }
      'MultiPoint'   { foreach ($p in $g['coordinates']) { $punkte.Add('[' + [long][Math]::Round([double]$p[1] * 1e6) + ',' + [long][Math]::Round([double]$p[0] * 1e6) + ']'); $attribute.Add((Json-Text $a)) }; continue }
      default        { continue }
    }
    foreach ($polygon in $teile) {
      if ($alsPunkte) {
        $sx = 0.0; $sy = 0.0; $c = 0
        foreach ($pt in $polygon[0]) { $sx += [double]$pt[0]; $sy += [double]$pt[1]; $c++ }
        if ($c -gt 0) { $punkte.Add('[' + [long][Math]::Round($sy / $c * 1e6) + ',' + [long][Math]::Round($sx / $c * 1e6) + ']'); $attribute.Add((Json-Text $a)) }
        continue
      }
      $ringe = New-Object System.Collections.Generic.List[string]
      foreach ($ring in $polygon) { if ($ring.Count -ge 3) { $ringe.Add((Ring-Text $ring)) } }
      if ($ringe.Count -gt 0) { $flaechen.Add('[' + ($ringe -join ',') + ']'); $attribute.Add((Json-Text $a)) }
    }
  }
  return @{ Flaechen = $flaechen; Punkte = $punkte; Attribute = $attribute }
}

# Naturschutzgebiete, Landschaftsschutzgebiete und Naturdenkmale des Landes (NLWKN) im Rechteck der Stadt.
# Liefert eine Liste von Texten der Form "id":{...} fuer stadt.js. $ids = welche Gruppen ('nsg', 'lsg', 'naturdenkmale')
function Hole-LandSchutzGruppen($StadtInfo, $ids = @('nsg', 'lsg', 'naturdenkmale')) {
  $basis = 'https://www.umweltkarten-niedersachsen.de/arcgis/rest/services/Natur_wms/MapServer/'
  $rechteck = @($StadtInfo.Sued, $StadtInfo.West, $StadtInfo.Nord, $StadtInfo.Ost)
  $erg = New-Object System.Collections.Generic.List[string]
  if ($ids -contains 'nsg') {
    Write-Host 'nsg (Land Niedersachsen, Naturschutzgebiete)'
    $w = Wandle-Objekte (Hole-ArcGisObjekte ($basis + '4') $rechteck '0.000004') 'name'
    $erg.Add('"nsg":{"f":[' + ($w.Flaechen -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']}'); Write-Host ('  ' + $w.Flaechen.Count + ' Flaechen')
  }
  if ($ids -contains 'lsg') {
    Write-Host 'lsg (Land Niedersachsen, Landschaftsschutzgebiete)'
    $w = Wandle-Objekte (Hole-ArcGisObjekte ($basis + '8') $rechteck '0.000004') 'name'
    $erg.Add('"lsg":{"f":[' + ($w.Flaechen -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']}'); Write-Host ('  ' + $w.Flaechen.Count + ' Flaechen')
  }
  if ($ids -contains 'naturdenkmale') {
    Write-Host 'naturdenkmale (Land Niedersachsen, als Punkte)'
    $p = New-Object System.Collections.Generic.List[string]; $a = New-Object System.Collections.Generic.List[string]
    $w1 = Wandle-Objekte (Hole-ArcGisObjekte ($basis + '190') $rechteck '0') 'name' $true   # Flaechen: Mittelpunkt
    $w2 = Wandle-Objekte (Hole-ArcGisObjekte ($basis + '7') $rechteck '0') 'name'            # Punkte
    foreach ($x in $w1.Punkte) { $p.Add($x) }; foreach ($x in $w1.Attribute) { $a.Add($x) }
    foreach ($x in $w2.Punkte) { $p.Add($x) }; foreach ($x in $w2.Attribute) { $a.Add($x) }
    $erg.Add('"naturdenkmale":{"p":[' + ($p -join ',') + '],"a":[' + ($a -join ',') + ']}'); Write-Host ('  ' + $p.Count + ' Punkte')
  }
  return $erg
}
