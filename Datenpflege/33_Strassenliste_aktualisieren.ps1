# Erzeugt die Strassenliste fuer die Autokorrektur der Adresssuche: Standortanalyse\staedte\<Stadt>\strassen.js
# Die Namen kommen aus der schon erzeugten Datei karte.js (Programm 4), es wird also nichts neu heruntergeladen.
# Voraussetzung: 4_Karte_umwandeln.ps1 lief fuer die Stadt. Dauert wenige Sekunden.
# Quelle: OpenStreetMap-Mitwirkende, Lizenz ODbL.

param(
  [string]$Stadt = 'osnabrueck',
  [string]$Stand = (Get-Date -Format 'dd.MM.yyyy')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $S = Hole-Stadt $Stadt
$ErrorActionPreference = 'Stop'

$karte = Join-Path $S.Ordner 'karte.js'
if (-not (Test-Path $karte)) { throw "karte.js fehlt in $($S.Ordner). Zuerst Programm 3 und 4 ausfuehren." }
$text = [IO.File]::ReadAllText($karte, [Text.Encoding]::UTF8)
$m = [regex]::Match($text, 'namen:\s*(\[[^\]]*\])')
if (-not $m.Success) { throw 'In karte.js wurde die Namensliste nicht gefunden.' }

Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = [int]::MaxValue
$namen = $ser.DeserializeObject($m.Groups[1].Value)
$liste = @($namen | Where-Object { $_ -and $_.Trim().Length -gt 0 } | Sort-Object -Unique -Culture 'de-DE')
Write-Host ("{0} Namen in karte.js, {1} verschiedene" -f $namen.Count, $liste.Count)

$json = '[' + (($liste | ForEach-Object { $ser.Serialize([string]$_) }) -join ',') + ']'
$inhalt = '// Strassennamen der Stadt ' + $S.Name + ' - Daten: OpenStreetMap-Mitwirkende, Lizenz ODbL (openstreetmap.org/copyright)' + "`n" +
          '// Abgerufen am ' + $Stand + '. Wird fuer die Autokorrektur der Adresssuche genutzt. Erzeugt mit Datenpflege\33_Strassenliste_aktualisieren.ps1.' + "`n" +
          'var STRASSEN_DATEN = ' + $json + ';' + "`n"
$ziel = Join-Path $S.Ordner 'strassen.js'
[IO.File]::WriteAllText($ziel, $inhalt, (New-Object Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} KB in {1}" -f [int]((Get-Item $ziel).Length / 1024), $ziel)
