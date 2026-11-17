# Holt Spielplaetze (als Flaechen) sowie Bewegungsorte (Fussball- und Bolzplaetze, Basketball, Tischtennis, Skateanlagen,
# Fitnessgeraete, Hundewiesen) im Stadtgebiet Oldenburg von OpenStreetMap und schreibt sie in die Datei
# Standortanalyse\spielplaetze_oldenburg.js (Ebenen unter "Gruen und Freiraeume / Spielen und Bewegen" der App).
# Die Datenmenge ist klein, deshalb geht alles in einem Schritt. Hinweis: Die Stadt Oldenburg bietet keine offenen
# Spielplatzdaten an; in OpenStreetMap haben nur etwa 15 % der Spielplaetze einen Namen.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\spielplaetze_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$serializer.RecursionLimit = 200
$ci = [Globalization.CultureInfo]::InvariantCulture

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
$b = "($sued,$west,$nord,$ost)"
$kennung = 'Standortanalyse-Studienprojekt/1.0'
$dienste = @(
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
)
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
      } catch { Write-Host ('  fehlgeschlagen: ' + $_.Exception.Message); Start-Sleep -Seconds (8 * $versuch) }
    }
  }
  throw 'Kein Dienst hat geantwortet. Bitte spaeter noch einmal versuchen.'
}
function Text-Sicher($s) { return ([string]$s).Replace('\', '').Replace('"', "'").Replace("`r", ' ').Replace("`n", ' ') }
$mLat = 111195.0; $mLon = 111195.0 * [Math]::Cos(53.14 * [Math]::PI / 180)

# ---- 1. Spielplaetze: Flaechen mit Umriss, sonst Punkte ----
$w1 = Hole-Overpass ('[out:json][timeout:240];nwr["leisure"="playground"]' + $b + ';out geom tags qt;')
$spiel = New-Object System.Collections.Generic.List[string]
$anzFlaeche = 0; $anzPunkt = 0
foreach ($e in $w1['elements']) {
  $tags = $e['tags']; if (-not $tags) { $tags = @{} }
  $name = ''; if ($tags.ContainsKey('name')) { $name = Text-Sicher $tags['name'] }
  $zugang = 0; if ($tags.ContainsKey('access') -and $tags['access'] -match '^(private|customers|no)$') { $zugang = 1 }
  $ring = $null
  if ($e['type'] -eq 'node') { $lat = [double]$e['lat']; $lon = [double]$e['lon']; $flaeche = 0 }
  elseif ($e['type'] -eq 'way' -and $e['geometry'] -and $e['geometry'].Count -ge 4) {
    $pts = @($e['geometry'])
    $sx = 0.0; $sy = 0.0; $a = 0.0
    for ($i = 0; $i -lt $pts.Count; $i++) {
      $p = $pts[$i]; $q = $pts[($i + 1) % $pts.Count]
      $x1 = [double]$p['lon'] * $mLon; $y1 = [double]$p['lat'] * $mLat; $x2 = [double]$q['lon'] * $mLon; $y2 = [double]$q['lat'] * $mLat
      $a += ($x1 * $y2 - $x2 * $y1)
      $sx += [double]$p['lat']; $sy += [double]$p['lon']
    }
    $flaeche = [int][Math]::Abs($a / 2)
    $lat = $sx / $pts.Count; $lon = $sy / $pts.Count
    $teile = New-Object System.Collections.Generic.List[string]
    $la0 = 0L; $lo0 = 0L; $erster = $true
    foreach ($p in $pts) {
      $la = [long][Math]::Round([double]$p['lat'] * 1e6); $lo = [long][Math]::Round([double]$p['lon'] * 1e6)
      if (-not $erster -and $la -eq $la0 -and $lo -eq $lo0) { continue }
      if ($erster) { $teile.Add("$la"); $teile.Add("$lo"); $erster = $false } else { $teile.Add([string]($la - $la0)); $teile.Add([string]($lo - $lo0)) }
      $la0 = $la; $lo0 = $lo
    }
    $ring = '[' + ($teile -join ',') + ']'
  }
  elseif ($e['bounds']) { $bd = $e['bounds']; $lat = ([double]$bd['minlat'] + [double]$bd['maxlat']) / 2; $lon = ([double]$bd['minlon'] + [double]$bd['maxlon']) / 2; $flaeche = 0 }
  else { continue }
  if ($ring) { $anzFlaeche++ } else { $anzPunkt++ }
  if (-not $ring) { $ring = '0' }
  $spiel.Add('[' + [long][Math]::Round($lat * 1e6) + ',' + [long][Math]::Round($lon * 1e6) + ',"' + $name + '",' + $zugang + ',' + $flaeche + ',' + $ring + ']')
}
Write-Host ("Spielplaetze: {0} mit Umriss, {1} als Punkt." -f $anzFlaeche, $anzPunkt)

# ---- 2. Bewegungsorte (Punkte, bei Flaechen die Mitte) ----
$q2 = '[out:json][timeout:240];(' +
      'nwr["leisure"="pitch"]["sport"~"^(soccer|basketball|table_tennis|skateboard)$"]' + $b + ';' +
      'nwr["leisure"="skatepark"]' + $b + ';' +
      'nwr["leisure"="fitness_station"]' + $b + ';' +
      'nwr["leisure"="dog_park"]' + $b + ';' +
      ');out center tags qt;'
$w2 = Hole-Overpass $q2
$orte = @{ fussball = New-Object System.Collections.Generic.List[object]; ball2 = New-Object System.Collections.Generic.List[object]; skate = New-Object System.Collections.Generic.List[object]; hund = New-Object System.Collections.Generic.List[object] }
foreach ($e in $w2['elements']) {
  $tags = $e['tags']; if (-not $tags) { continue }
  if ($e['type'] -eq 'node') { $lat = [double]$e['lat']; $lon = [double]$e['lon']; $fl = 0 }
  else { if (-not $e['center']) { continue }; $lat = [double]$e['center']['lat']; $lon = [double]$e['center']['lon']; $fl = 1 }
  $sport = [string]$tags['sport']
  if ($tags['leisure'] -eq 'dog_park') { $g = 'hund' }
  elseif ($tags['leisure'] -eq 'skatepark' -or $tags['leisure'] -eq 'fitness_station' -or $sport -match 'skateboard') { $g = 'skate' }
  elseif ($sport -match 'basketball|table_tennis') { $g = 'ball2' }
  elseif ($sport -match 'soccer') { $g = 'fussball' }
  else { continue }
  $art = switch ($true) { ($tags['leisure'] -eq 'fitness_station') { 'Fitnessgeräte' } ($tags['leisure'] -eq 'dog_park') { 'Hundewiese' } ($sport -match 'skateboard' -or $tags['leisure'] -eq 'skatepark') { 'Skateanlage' } ($sport -match 'table_tennis') { 'Tischtennis' } ($sport -match 'basketball') { 'Basketball' } default { 'Fußball' } }
  $orte[$g].Add([pscustomobject]@{ Lat = $lat; Lon = $lon; Art = $art; Name = (Text-Sicher $tags['name']); Fl = $fl })
}
# Doppelte (derselbe Ort als Punkt und Flaeche) bis auf 12 m zusammenfassen
function Ohne-Doppelte($liste) {
  $raster = @{}; $aus = New-Object System.Collections.Generic.List[object]
  foreach ($k in ($liste | Sort-Object Fl)) {
    $zi = [int][Math]::Floor($k.Lat / 0.0004); $zj = [int][Math]::Floor($k.Lon / 0.0007); $doppelt = $false
    for ($di = -1; $di -le 1 -and -not $doppelt; $di++) { for ($dj = -1; $dj -le 1 -and -not $doppelt; $dj++) {
      $s = '{0}_{1}' -f ($zi + $di), ($zj + $dj); if (-not $raster.ContainsKey($s)) { continue }
      foreach ($p in $raster[$s]) { $dx = ($k.Lon - $p.Lon) * $mLon; $dy = ($k.Lat - $p.Lat) * $mLat; if ($p.Art -eq $k.Art -and [Math]::Sqrt($dx * $dx + $dy * $dy) -lt 12) { $doppelt = $true; break } }
    } }
    if ($doppelt) { continue }
    $e = '{0}_{1}' -f $zi, $zj; if (-not $raster.ContainsKey($e)) { $raster[$e] = New-Object System.Collections.Generic.List[object] }
    $raster[$e].Add($k); $aus.Add($k)
  }
  return $aus
}
$orteJs = New-Object System.Collections.Generic.List[string]
foreach ($g in 'fussball', 'ball2', 'skate', 'hund') {
  $liste = Ohne-Doppelte $orte[$g]
  $zeilen = $liste | ForEach-Object { '[' + [long][Math]::Round($_.Lat * 1e6) + ',' + [long][Math]::Round($_.Lon * 1e6) + ',"' + $_.Art + '","' + $_.Name + '"]' }
  $orteJs.Add('"' + $g + '":[' + ($zeilen -join ',') + ']')
  Write-Host ("  {0}: {1}" -f $g, @($liste).Count)
}

$inhalt = '// Spielplaetze und Bewegungsorte in Oldenburg (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\21_Spielplaetze_aktualisieren.ps1' + "`n" +
          '// Spielplatz = [Breite, Laenge (Mitte, Millionstel Grad), Name, Zugang (0 oeffentlich, 1 eingeschraenkt), Flaeche in m2, Umriss [Breite, Laenge, Delta, Delta, ...] oder 0]' + "`n" +
          '// Ort = [Breite, Laenge, Art, Name]' + "`n" +
          'var SPIEL_OLDENBURG = {"stand":"' + $Stand + '","einheit":1e-6,"spielplaetze":[' + "`n" + ($spiel -join ",`n") + "`n" + '],"orte":{' + ($orteJs -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} geschrieben ({1} KB)." -f $Ausgabe, [int]((Get-Item $Ausgabe).Length / 1024))
