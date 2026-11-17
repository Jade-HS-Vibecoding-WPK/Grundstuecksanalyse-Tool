# Holt die Luftmessstationen im Stadtgebiet Oldenburg und ihre Jahresmittelwerte (Stickstoffdioxid, Feinstaub PM10 und PM2,5)
# vom Umweltbundesamt (Luftdaten-Schnittstelle, Daten der Messnetze der Laender und des Bundes) und schreibt sie in die Datei
# Standortanalyse\luft_oldenburg.js (Ebene "Luftmessstation" der App).
#
# Quelle: Umweltbundesamt mit Daten der Messnetze der Laender und des Bundes (https://luftdaten.umweltbundesamt.de).
# Die Datenmenge ist winzig, deshalb geht alles in einem Schritt. Aufgenommen werden alle Stationen im Stadtgebiet
# (zur Zeit nur "Oldenburg Heiligengeistwall", eine Station am Verkehr) und die letzten sieben abgeschlossenen Jahre.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\luft_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = [int]::MaxValue
$ci = [Globalization.CultureInfo]::InvariantCulture
$basis = 'https://luftdaten.umweltbundesamt.de/api-proxy'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

function Hole([string]$pfad) {
  for ($versuch = 1; $versuch -le 3; $versuch++) {
    try {
      $r = Invoke-WebRequest -Uri ($basis + '/' + $pfad) -UseBasicParsing -UserAgent $kennung -TimeoutSec 90
      return $serializer.DeserializeObject([System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))
    } catch { Write-Host ('  fehlgeschlagen: ' + $_.Exception.Message); Start-Sleep -Seconds (6 * $versuch) }
  }
  throw 'Das Umweltbundesamt hat nicht geantwortet. Bitte spaeter noch einmal versuchen.'
}

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345

$heute = Get-Date
$meta = Hole ('meta/json?use=airquality&lang=de&date_from=' + $heute.AddDays(-5).ToString('yyyy-MM-dd') + '&time_from=1&date_to=' + $heute.AddDays(-4).ToString('yyyy-MM-dd') + '&time_to=24')
$stationen = New-Object System.Collections.Generic.List[object]
foreach ($e in $meta['stations'].GetEnumerator()) {
  $v = $e.Value
  # Felder: id, Code, Name, Ort, Kurzname, aktiv von, aktiv bis, Laenge, Breite, Netz, ..., Gebietstyp, Gebiet, Stationsart, Strasse
  $lon = [double]::Parse([string]$v[7], $ci); $lat = [double]::Parse([string]$v[8], $ci)
  if ($lat -lt $sued -or $lat -gt $nord -or $lon -lt $west -or $lon -gt $ost) { continue }
  if ([string]$v[6] -ne '') { continue }            # nicht mehr in Betrieb
  $stationen.Add([pscustomobject]@{ Id = [string]$v[0]; Code = [string]$v[1]; Name = [string]$v[2]; Lat = $lat; Lon = $lon; Gebiet = [string]$v[14]; Art = [string]$v[16]; Strasse = [string]$v[17]; Seit = [string]$v[5] })
}
Write-Host ("{0} Station(en) im Stadtgebiet." -f $stationen.Count)
if (-not $stationen.Count) { throw 'Keine Station gefunden.' }

$letztes = $heute.Year - 1
$jahre = ($letztes - 6)..$letztes
$komponenten = @(@{ Id = 5; Name = 'no2' }, @{ Id = 1; Name = 'pm10' }, @{ Id = 9; Name = 'pm25' })
$werte = @{}      # Stations-Id -> Jahr -> Komponente -> @(Mittel, Ueberschreitungen)
foreach ($k in $komponenten) {
  foreach ($j in $jahre) {
    Write-Host ("Jahresmittel {0} {1} ..." -f $k.Name, $j)
    $a = Hole ('annualbalances/json?lang=de&component=' + $k.Id + '&year=' + $j)
    foreach ($z in $a['data']) {
      $st = $stationen | Where-Object { $_.Id -eq [string]$z[0] }
      if (-not $st) { continue }
      if (-not $werte.ContainsKey($st.Id)) { $werte[$st.Id] = @{} }
      if (-not $werte[$st.Id].ContainsKey($j)) { $werte[$st.Id][$j] = @{} }
      $mittel = $null; if ([string]$z[1] -ne '') { $mittel = [double]::Parse([string]$z[1], $ci) }
      $ueber = $null; if ([string]$z[2] -ne '') { $ueber = [int]$z[2] }
      $werte[$st.Id][$j][$k.Name] = @($mittel, $ueber)
    }
  }
}

function Text-Sicher($s) { return ([string]$s).Replace('\', '').Replace('"', "'") }
$teile = New-Object System.Collections.Generic.List[string]
foreach ($st in $stationen) {
  $jz = New-Object System.Collections.Generic.List[string]
  foreach ($j in $jahre) {
    if (-not $werte.ContainsKey($st.Id) -or -not $werte[$st.Id].ContainsKey($j)) { continue }
    $w = $werte[$st.Id][$j]
    function Zahl($k, $i) { if ($w.ContainsKey($k) -and $null -ne $w[$k][$i]) { return ([string]([double]$w[$k][$i])).Replace(',', '.') } else { return 'null' } }
    $jz.Add('[' + $j + ',' + (Zahl 'no2' 0) + ',' + (Zahl 'pm10' 0) + ',' + (Zahl 'pm25' 0) + ',' + (Zahl 'pm10' 1) + ']')
  }
  $teile.Add('[' + [long][Math]::Round($st.Lat * 1e6) + ',' + [long][Math]::Round($st.Lon * 1e6) + ',"' + (Text-Sicher $st.Name) + '","' + (Text-Sicher $st.Code) + '","' + (Text-Sicher $st.Art) + '","' + (Text-Sicher $st.Strasse) + '","' + (Text-Sicher $st.Seit) + '",[' + ($jz -join ',') + ']]')
}

$inhalt = '// Luftmessstationen in Oldenburg mit Jahresmittelwerten. Quelle: Umweltbundesamt mit Daten der Messnetze der Laender und des Bundes. Erzeugt mit Datenpflege\20_Luft_aktualisieren.ps1' + "`n" +
          '// Jede Station = [Breite, Laenge (Millionstel Grad), Name, Code, Art, Strasse, in Betrieb seit, [[Jahr, NO2, PM10, PM2,5 (Jahresmittel in ug/m3), Tage ueber 50 ug/m3 (PM10)], ...]]' + "`n" +
          'var LUFT_OLDENBURG = {"stand":"' + $Stand + '","einheit":1e-6,"stationen":[' + "`n" + ($teile -join ",`n") + "`n" + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} geschrieben." -f $Ausgabe)
