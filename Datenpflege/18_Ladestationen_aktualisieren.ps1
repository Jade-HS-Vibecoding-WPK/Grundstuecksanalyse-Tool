# Holt die oeffentlichen Ladestationen fuer Elektroautos im Stadtgebiet Oldenburg aus dem Ladesaeulenregister der
# Bundesnetzagentur und traegt sie in die Datei Standortanalyse\mobilitaet_oldenburg.js ein (Ebenen "Ladestationen" und
# "Schnelllader" der App). Die uebrigen Teile der Datei (Radwege, Parken, Sharing, aus 17_Mobilitaet_aktualisieren_OSM.ps1)
# bleiben erhalten. Zuerst also 17_..., dann dieses Programm.
#
# Quelle: Bundesnetzagentur, Ladesaeulenregister (CSV, etwa 55 MB, Lizenz CC BY 4.0, Quellenangabe "Bundesnetzagentur.de").
# Die Datei wird einmal heruntergeladen und am Ende geloescht. Es werden nur Ladestationen "In Betrieb" im Stadtgebiet
# uebernommen. Eine Station = ein Standort (mehrere Eintraege am selben Ort werden zusammengefasst).
# Schnelllader = laut Register "Schnellladeeinrichtung" (Gleichstrom, meist 50 kW und mehr je Ladepunkt).

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\mobilitaet_oldenburg.js'),
  [string]$Zielordner = (Join-Path $PSScriptRoot 'rohdaten_ladestationen'),
  [string]$Csv = '',
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [switch]$Behalten
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName Microsoft.VisualBasic
New-Item -ItemType Directory -Force $Zielordner | Out-Null

if (-not $Csv) {
  $Csv = Join-Path $Zielordner 'ladesaeulen.csv'
  if (-not (Test-Path $Csv) -or (Get-Item $Csv).Length -lt 1MB) {
    # Die Seite der Bundesnetzagentur nennt die aktuelle Datei (der Dateiname enthaelt das Datum)
    Write-Host 'Suche die aktuelle Datei ...'
    $seite = Invoke-WebRequest -Uri 'https://www.bundesnetzagentur.de/DE/Fachthemen/ElektrizitaetundGas/E-Mobilitaet/DownloadundKontakt.html' -UseBasicParsing -UserAgent 'Standortanalyse-Studienprojekt/1.0' -TimeoutSec 120
    $link = $seite.Links | Where-Object { $_.href -match 'Ladesaeulenregister_BNetzA_[0-9-]+\.csv' } | Select-Object -First 1
    if (-not $link) { throw 'Die Datei wurde auf der Seite der Bundesnetzagentur nicht gefunden.' }
    Write-Host ('Lade ' + $link.href + ' (ca. 55 MB) ...')
    Invoke-WebRequest -Uri $link.href -OutFile $Csv -UseBasicParsing -UserAgent 'Standortanalyse-Studienprojekt/1.0' -TimeoutSec 900
  }
}

# Stadtgebiet Oldenburg (kreisfreie Stadt) mit etwas Rand
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345
$ci = [Globalization.CultureInfo]::InvariantCulture
function Zahl($s) { $d = 0.0; if ([double]::TryParse(([string]$s).Replace(',', '.'), [Globalization.NumberStyles]::Float, $ci, [ref]$d)) { return $d } else { return 0.0 } }

$parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser($Csv, [Text.Encoding]::GetEncoding(1252))
$parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
$parser.SetDelimiters(';')
$parser.HasFieldsEnclosedInQuotes = $true
$kopf = $null
while (-not $parser.EndOfData) {
  $f = $parser.ReadFields()
  if ($f -contains 'Breitengrad') { $kopf = @{}; for ($i = 0; $i -lt $f.Length; $i++) { $kopf[$f[$i]] = $i }; break }
}
if (-not $kopf) { throw 'Die Kopfzeile der Datei wurde nicht gefunden.' }
$iBetreiber = $kopf['Betreiber']; $iStatus = $kopf['Status']; $iAnzahl = $kopf['Anzahl Ladepunkte']; $iKw = $kopf['Nennleistung Ladeeinrichtung [kW]']
$iLat = $kopf['Breitengrad']; $iLon = $kopf['Längengrad']; $iKreis = $kopf['Kreis/kreisfreie Stadt']
$iStr = $kopf['Straße']; $iNr = $kopf['Hausnummer']; $iArt = $kopf['Art der Ladeeinrichtung']

$orte = @{}
$zeilen = 0
while (-not $parser.EndOfData) {
  $f = $parser.ReadFields(); $zeilen++
  if ($f.Length -le $iLon) { continue }
  $lat = Zahl $f[$iLat]; $lon = Zahl $f[$iLon]
  if ($lat -lt $sued -or $lat -gt $nord -or $lon -lt $west -or $lon -gt $ost) { continue }
  if ($f[$iKreis] -notmatch 'Oldenburg \(Oldb\)') { continue }
  if ($f[$iStatus] -ne 'In Betrieb') { continue }
  $schl = '{0:0.0000}_{1:0.0000}' -f $lat, $lon
  $kw = Zahl $f[$iKw]; $n = [int](Zahl $f[$iAnzahl]); if ($n -lt 1) { $n = 1 }
  if (-not $orte.ContainsKey($schl)) {
    $orte[$schl] = [pscustomobject]@{ Lat = $lat; Lon = $lon; Kw = 0.0; Schnell = $false; N = 0; Betreiber = $f[$iBetreiber]; Adresse = (($f[$iStr] + ' ' + $f[$iNr]).Trim()) }
  }
  $o = $orte[$schl]
  if ($kw -gt $o.Kw) { $o.Kw = $kw }
  if ($f[$iArt] -match 'Schnell') { $o.Schnell = $true }
  $o.N += $n
}
$parser.Close()
Write-Host ("{0} Zeilen gelesen, {1} Standorte in Oldenburg." -f $zeilen, $orte.Count)

function Text-Sicher($s) { return ([string]$s).Replace('\', '').Replace('"', "'").Replace('[', '(').Replace(']', ')').Replace("`r", ' ').Replace("`n", ' ') }
$normal = New-Object System.Collections.Generic.List[string]
$schnell = New-Object System.Collections.Generic.List[string]
foreach ($o in ($orte.Values | Sort-Object Lat, Lon)) {
  $z = '[' + [long][Math]::Round($o.Lat * 1e6) + ',' + [long][Math]::Round($o.Lon * 1e6) + ',' + [int][Math]::Round($o.Kw) + ',' + $o.N + ',"' + (Text-Sicher $o.Betreiber) + '","' + (Text-Sicher $o.Adresse) + '"]'
  if ($o.Schnell) { $schnell.Add($z) } else { $normal.Add($z) }
}
Write-Host ("Ladestationen: {0}, Schnelllader: {1}" -f $normal.Count, $schnell.Count)
$neu = '"lader":{"p":[' + ($normal -join ',') + ']},"schnelllader":{"p":[' + ($schnell -join ',') + ']}'

# In die Datei einsetzen: alles ab einer vorhandenen Ladestationen-Gruppe ersetzen, sonst vor dem Ende anhaengen
if (-not (Test-Path $Ausgabe)) { throw 'Die Datei mobilitaet_oldenburg.js fehlt. Bitte zuerst 17_Mobilitaet_aktualisieren_OSM.ps1 ausfuehren.' }
$text = [System.IO.File]::ReadAllText($Ausgabe, [System.Text.Encoding]::UTF8)
$ende = '}};'
$pos = $text.IndexOf(',"lader":{')
if ($pos -lt 0) { $pos = $text.LastIndexOf($ende) }
if ($pos -lt 0) { throw 'Die Datei mobilitaet_oldenburg.js hat ein unerwartetes Format.' }
$text = $text.Substring(0, $pos) + ',' + $neu + $ende + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $text, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} eingetragen." -f $Ausgabe)
if (-not $Behalten -and $Zielordner -like '*rohdaten_ladestationen') { Remove-Item -Recurse -Force $Zielordner -Confirm:$false }
