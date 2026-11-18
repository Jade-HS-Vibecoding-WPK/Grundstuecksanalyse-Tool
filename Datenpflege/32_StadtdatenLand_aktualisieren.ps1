# Erzeugt die Datei Standortanalyse\staedte\<Stadt>\stadt.js fuer Staedte OHNE eigene offene Stadtdaten (Hannover, Braunschweig):
#   - Naturschutzgebiete, Landschaftsschutzgebiete und Naturdenkmale aus dem Kartendienst des Landes Niedersachsen
#     (Umweltkarten Niedersachsen, Dienst Natur_wms, NLWKN; Quelle "NLWKN Niedersachsen"),
#   - Stadtbezirke aus OpenStreetMap (Verwaltungsgrenzen, admin_level 9; Quelle "OpenStreetMap-Mitwirkende").
# Fuer Osnabrueck dient 30_StadtOsnabrueck_aktualisieren.ps1 (das auch die Naturschutzgebiete des Landes ergaenzt), fuer Oldenburg 11.
#
# Lizenzhinweis: Der Dienst des Landes nennt in den Metadaten nur den Quellennachweis "(c) 2026, daten@nlwkn.niedersachsen.de".
# Die Gebietsgrenzen sind keine rechtsverbindliche Auskunft ("Geometrien nur auf Grundlage der DTK25 aussagekraeftig").
# Ein Schritt, dauert etwa 1 Minute.

param(
  [string]$Stadt = 'hannover',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\stadt.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$BezirkStufe = '9'
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt
. (Join-Path $PSScriptRoot 'landdaten.ps1')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$gruppen = New-Object System.Collections.Generic.List[string]
foreach ($g in (Hole-LandSchutzGruppen $StadtInfo)) { $gruppen.Add($g) }

# ---- Stadtbezirke aus OpenStreetMap ----
Write-Host ('bezirke (OpenStreetMap, admin_level ' + $BezirkStufe + ')')
$box = '{0},{1},{2},{3}' -f $StadtInfo.Sued, $StadtInfo.West, $StadtInfo.Nord, $StadtInfo.Ost
if ($StadtInfo.Ags) {   # nur Bezirke innerhalb der Gemeinde (Gemeindeschluessel), nicht die der Nachbarorte im Rechteck
  $q = '[out:json][timeout:180];area["de:amtlicher_gemeindeschluessel"="' + $StadtInfo.Ags + '"]["boundary"="administrative"]->.s;rel(area.s)["boundary"="administrative"]["admin_level"="' + $BezirkStufe + '"];out geom;'
} else {
  $q = '[out:json][timeout:180];rel["boundary"="administrative"]["admin_level"="' + $BezirkStufe + '"](' + $box + ');out geom;'
}
$antwort = $null
for ($versuch = 1; $versuch -le 4 -and -not $antwort; $versuch++) {
  try {
    $r = Invoke-WebRequest -Uri 'https://overpass.openstreetmap.fr/api/interpreter' -Method Post -Body ('data=' + [uri]::EscapeDataString($q)) -ContentType 'application/x-www-form-urlencoded' -UseBasicParsing -UserAgent 'Standortanalyse-Studienprojekt/1.0' -TimeoutSec 240
    $antwort = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()) | ConvertFrom-Json
  } catch { Write-Host ('  Versuch ' + $versuch + ' fehlgeschlagen: ' + $_.Exception.Message); Start-Sleep -Seconds (10 * $versuch) }
}
if (-not $antwort) { throw 'Overpass lieferte keine Antwort.' }
$flaechen = New-Object System.Collections.Generic.List[string]; $namen = New-Object System.Collections.Generic.List[string]
foreach ($el in $antwort.elements) {
  if ($el.type -ne 'relation' -or -not $el.tags.name) { continue }
  $segmente = New-Object System.Collections.Generic.List[object]
  foreach ($m in $el.members) { if ($m.type -eq 'way' -and $m.role -eq 'outer' -and $m.geometry) { $segmente.Add(@($m.geometry | ForEach-Object { ,@([double]$_.lon, [double]$_.lat) })) } }
  $ringe = Baue-Ringe $segmente
  if ($ringe.Count -eq 0) { Write-Host ('  ' + $el.tags.name + ': kein geschlossener Ring - uebersprungen'); continue }
  $texte = New-Object System.Collections.Generic.List[string]
  foreach ($ring in $ringe) { $texte.Add((Ring-Text $ring)) }
  # Liegt der Mittelpunkt des ersten Rings im Rechteck der Stadt?
  $r0 = $ringe[0]; $mla = ($r0 | ForEach-Object { $_[1] } | Measure-Object -Average).Average; $mlo = ($r0 | ForEach-Object { $_[0] } | Measure-Object -Average).Average
  if ($mla -lt $StadtInfo.Sued -or $mla -gt $StadtInfo.Nord -or $mlo -lt $StadtInfo.West -or $mlo -gt $StadtInfo.Ost) { continue }
  $flaechen.Add('[' + ($texte -join ',') + ']'); $namen.Add((Json-Text $el.tags.name))
}
Write-Host ('  ' + $flaechen.Count + ' Bezirke')
$gruppen.Add('"bezirke":{"f":[' + ($flaechen -join ',') + '],"a":[' + ($namen -join ',') + ']}')

$inhalt = '// Offene Daten fuer ' + $StadtInfo.Ascii + ': Naturschutzgebiete, Landschaftsschutzgebiete, Naturdenkmale (Land Niedersachsen, NLWKN), Stadtbezirke (OpenStreetMap).' + "`n" +
          '// Quellen: NLWKN Niedersachsen (Umweltkarten Niedersachsen, Dienst Natur_wms); (c) OpenStreetMap-Mitwirkende (ODbL, https://www.openstreetmap.org/copyright).' + "`n" +
          '// Erzeugt mit Datenpflege\32_StadtdatenLand_aktualisieren.ps1. f = Flaechen (Ringe als [Breite, Laenge, Delta, ...] in Millionstel Grad), p = Punkte, a = Beschriftung je Eintrag.' + "`n" +
          'var STADT_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","gruppen":{' + ($gruppen -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} KB in {1}" -f [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
