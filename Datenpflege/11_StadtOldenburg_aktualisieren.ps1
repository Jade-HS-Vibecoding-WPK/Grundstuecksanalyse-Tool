# Holt offene Geodaten der Stadt Oldenburg und schreibt sie in die Datei Standortanalyse\staedte\<Stadt>\stadt.js
# (Ebenen "Laerm", "Bebauungsplaene", "Naturschutz" und "Stadtbezirke" der App).
#
# Quelle: Stadt Oldenburg (Oldb), Offene Daten (https://opendata.oldenburg.de) und der dortige ArcGIS-Dienst
# (https://opengeodata-stadt-oldenburg-gis4ol.hub.arcgis.com). Lizenz: Datenlizenz Deutschland - Namensnennung -
# Version 2.0 (dl-de/by-2-0, https://www.govdata.de/dl-de/by-2-0). Die Quelle muss genannt werden (macht die App).
#
# Die Daten sind klein, deshalb geht alles in einem Schritt.

# Es entstehen zwei Dateien: stadt.js (Bebauungsplaene, Naturschutz, Stadtbezirke, klein) und
# laerm.js (Laermkartierung, ca. 4 MB, wird von der App erst geladen, wenn die Laermebene eingeschaltet wird).

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\stadt.js"),
  [string]$AusgabeLaerm = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\laerm.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt
if ($Stadt -ne 'oldenburg') { throw 'Dieses Programm holt Daten, die nur die Stadt Oldenburg anbietet. Fuer andere Staedte gibt es ein eigenes Programm (siehe LIESMICH.txt, Neue Stadt).' }

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions
$kennung = 'Standortanalyse-Studienprojekt/1.0'
$dienstBasis = 'https://services5.arcgis.com/kqBnwL0FsBhsJf2P/arcgis/rest/services/'

# Der Dienstname enthaelt ein "oe" mit Umlaut (Untere_Naturschutzbehoerde). Hier ohne Sonderzeichen im Programmtext geschrieben.
$naturschutz = 'Untere_Naturschutzbeh' + [char]0x00F6 + 'rde'

# Was geholt wird. Offset = Vereinfachung der Linien in Grad (0.00003 ca. 3 m), damit die Dateien klein bleiben.
# Attr = Feld, das als Beschriftung/Klasse mitgenommen wird (leer = keins).
# Mindest = kleinste Ausdehnung eines Teilstuecks in Grad (0.00006 ca. 6 m); kleinere Splitter werden weggelassen.
$quellen = @(
  @{ Id = 'laerm_lden';     Dienst = 'Laermkartierung'; Ebene = 1; Offset = '0.00003';  Mindest = 0.00006; Attr = 'category' },
  @{ Id = 'laerm_nacht';    Dienst = 'Laermkartierung'; Ebene = 0; Offset = '0.00003';  Mindest = 0.00006; Attr = 'category' },
  @{ Id = 'bplan';          Dienst = 'Umringe_Bplan';   Ebene = 0; Offset = '0.000004'; Mindest = 0;       Attr = 'Name'; Zusatz = @('Planverfahren', 'Name', 'rechtsverbindlich', 'BauNVO') },
  @{ Id = 'nsg';           Dienst = $naturschutz;      Ebene = 5; Offset = '0.000004'; Mindest = 0;       Attr = 'Name' },
  @{ Id = 'lsg';            Dienst = $naturschutz;      Ebene = 2; Offset = '0.000004'; Mindest = 0;       Attr = 'Name' },
  @{ Id = 'biotope';        Dienst = $naturschutz;      Ebene = 0; Offset = '0.000004'; Mindest = 0;       Attr = 'Gebietsbez' },
  @{ Id = 'wallhecken';     Dienst = $naturschutz;      Ebene = 1; Offset = '0.000004'; Mindest = 0;       Attr = '' },
  @{ Id = 'naturdenkmale';  Dienst = $naturschutz;      Ebene = 3; Offset = '0';        Mindest = 0;       Attr = 'Name' }
)
$bezirkeUrl = 'https://opendata.oldenburg.de/sites/default/files/Statistikbezirke_WGS84.json'

$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$serializer.RecursionLimit = 200

function Hole-Json($url) {
  for ($versuch = 1; $versuch -le 3; $versuch++) {
    try {
      Write-Host "  lade $url"
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
  # den doppelten Schlusspunkt weglassen
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

# Aus einer GeoJSON-Sammlung die Flaechen (Polygon und MultiPolygon, jedes Teilpolygon einzeln) und Punkte holen
# Ein Feld als Text fuer die Zusatzangaben (Datumsfelder kommen als Millisekunden seit 1970, werden zu TT.MM.JJJJ)
function Zusatz-Text($wert) {
  if ($null -eq $wert) { return '' }
  if ($wert -is [long] -or $wert -is [int] -or $wert -is [double] -or $wert -is [decimal]) {
    # Datum (auch vor 1970: negative Werte); Jahreszahlen wie 1990 bleiben Zahlen
    if ([Math]::Abs([double]$wert) -gt 1e8) { return ([DateTime]'1970-01-01').AddMilliseconds([double]$wert).ToString('dd.MM.yyyy') }
    return ([string]$wert)
  }
  return ([string]$wert).Trim()
}

# $zusatz = Liste von Feldnamen: je Teilstueck kommen diese Werte als Textliste in "z" (z. B. Plannummer, Name, Datum fuer das Klickfenster)
function Wandle-Sammlung($sammlung, $attr, $mindest = 0, $zusatz = $null) {
  $flaechen = New-Object System.Collections.Generic.List[string]
  $punkte = New-Object System.Collections.Generic.List[string]
  $attribute = New-Object System.Collections.Generic.List[string]
  $zusaetze = New-Object System.Collections.Generic.List[string]
  foreach ($f in $sammlung['features']) {
    $g = $f['geometry']; if (-not $g) { continue }
    $a = ''
    if ($attr -and $f['properties'].ContainsKey($attr) -and $null -ne $f['properties'][$attr]) { $a = [string]$f['properties'][$attr] }
    $zText = ''
    if ($zusatz) {
      $werte = foreach ($feld in $zusatz) { $v = $null; if ($f['properties'].ContainsKey($feld)) { $v = $f['properties'][$feld] }; Json-Text (Zusatz-Text $v) }
      $zText = '[' + ($werte -join ',') + ']'
    }
    $teile = @()
    switch ($g['type']) {
      'Polygon'      { $teile = @(,$g['coordinates']) }
      'MultiPolygon' { $teile = @($g['coordinates']) }
      'Point'        { $punkte.Add('[' + [long][Math]::Round([double]$g['coordinates'][1] * 1e6) + ',' + [long][Math]::Round([double]$g['coordinates'][0] * 1e6) + ']'); $attribute.Add((Json-Text $a)); continue }
      'MultiPoint'   { foreach ($p in $g['coordinates']) { $punkte.Add('[' + [long][Math]::Round([double]$p[1] * 1e6) + ',' + [long][Math]::Round([double]$p[0] * 1e6) + ']'); $attribute.Add((Json-Text $a)) }; continue }
      default        { continue }
    }
    foreach ($polygon in $teile) {
      if ($mindest -gt 0) {   # winzige Splitter weglassen: Ausdehnung des aeusseren Rings pruefen
        $min0 = 1e9; $max0 = -1e9; $min1 = 1e9; $max1 = -1e9
        foreach ($pt in $polygon[0]) {
          $x = [double]$pt[0]; $y = [double]$pt[1]
          if ($x -lt $min0) { $min0 = $x }; if ($x -gt $max0) { $max0 = $x }
          if ($y -lt $min1) { $min1 = $y }; if ($y -gt $max1) { $max1 = $y }
        }
        if (($max0 - $min0) -lt $mindest -and ($max1 - $min1) -lt $mindest) { continue }
      }
      $ringe = New-Object System.Collections.Generic.List[string]
      foreach ($ring in $polygon) { if ($ring.Count -ge 3) { $ringe.Add((Ring-Text $ring)) } }
      if ($ringe.Count -gt 0) { $flaechen.Add('[' + ($ringe -join ',') + ']'); $attribute.Add((Json-Text $a)); if ($zusatz) { $zusaetze.Add($zText) } }
    }
  }
  return @{ Flaechen = $flaechen; Punkte = $punkte; Attribute = $attribute; Zusaetze = $zusaetze }
}

$gruppen = New-Object System.Collections.Generic.List[string]
$gruppenLaerm = New-Object System.Collections.Generic.List[string]
foreach ($q in $quellen) {
  Write-Host ("{0} ({1}, Ebene {2})" -f $q.Id, $q.Dienst, $q.Ebene)
  $url = $dienstBasis + [uri]::EscapeDataString($q.Dienst) + '/FeatureServer/' + $q.Ebene +
         '/query?where=1%3D1&outFields=*&outSR=4326&geometryPrecision=6&resultRecordCount=2000&f=geojson'
  if ($q.Offset -ne '0') { $url += '&maxAllowableOffset=' + $q.Offset }
  $sammlung = Hole-Json $url
  if ($sammlung.ContainsKey('exceededTransferLimit') -and $sammlung['exceededTransferLimit']) { throw "$($q.Id): mehr als 2000 Objekte, bitte das Programm anpassen." }
  $w = Wandle-Sammlung $sammlung $q.Attr $q.Mindest $q.Zusatz
  if ($w.Punkte.Count -gt 0) {
    $eintrag = '"' + $q.Id + '":{"p":[' + ($w.Punkte -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']}'
  } else {
    $eintrag = '"' + $q.Id + '":{"f":[' + ($w.Flaechen -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']'
    if ($q.Zusatz) { $eintrag += ',"z":[' + ($w.Zusaetze -join ',') + ']' }
    $eintrag += '}'
  }
  if ($q.Id -like 'laerm*') { $gruppenLaerm.Add($eintrag) } else { $gruppen.Add($eintrag) }
  Write-Host ("  {0} Flaechen, {1} Punkte" -f $w.Flaechen.Count, $w.Punkte.Count)
}

# Statistische Bezirke (fertige Datei im Open-Data-Portal, Beschriftung "Bezirk <Nummer>")
Write-Host 'bezirke (Offene Daten Oldenburg)'
$bz = Hole-Json $bezirkeUrl
foreach ($f in $bz['features']) { $f['properties']['Beschriftung'] = 'Bezirk ' + $f['properties']['Stadtbezirk'] }
$w = Wandle-Sammlung $bz 'Beschriftung'
$gruppen.Add('"bezirke":{"f":[' + ($w.Flaechen -join ',') + '],"a":[' + ($w.Attribute -join ',') + ']}')
Write-Host ("  {0} Flaechen" -f $w.Flaechen.Count)

$inhalt = '// Offene Geodaten der Stadt Oldenburg (Oldb): Laermkartierung, Bebauungsplaene, Naturschutz, Stadtbezirke.' + "`n" +
          '// Quelle: Stadt Oldenburg (Oldb), Datenlizenz Deutschland - Namensnennung - Version 2.0 (https://www.govdata.de/dl-de/by-2-0).' + "`n" +
          '// Erzeugt mit Datenpflege\11_StadtOldenburg_aktualisieren.ps1. f = Flaechen (Ringe als [Breite, Laenge, Delta, ...] in Millionstel Grad), p = Punkte, a = Beschriftung/Klasse je Eintrag.' + "`n" +
          'var STADT_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","gruppen":{' + ($gruppen -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))

$inhaltLaerm = '// Laermkartierung Strassenverkehr 2022 der Stadt Oldenburg (Oldb): L_DEN (ganzer Tag) und L_Night (Nacht), Klassen in dB.' + "`n" +
               '// Quelle: Stadt Oldenburg (Oldb), Datenlizenz Deutschland - Namensnennung - Version 2.0 (https://www.govdata.de/dl-de/by-2-0).' + "`n" +
               '// Erzeugt mit Datenpflege\11_StadtOldenburg_aktualisieren.ps1. Aufbau wie stadt.js.' + "`n" +
               'var LAERM_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","gruppen":{' + ($gruppenLaerm -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($AusgabeLaerm, $inhaltLaerm, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ("Fertig: {0} KB in {1}" -f [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
Write-Host ("Fertig: {0} KB in {1}" -f [int]((Get-Item $AusgabeLaerm).Length / 1024), $AusgabeLaerm)
