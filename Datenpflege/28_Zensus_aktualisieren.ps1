# Holt die Ergebnisse des Zensus 2022 im 100-m-Gitter (Statistisches Bundesamt, Statistische Aemter des Bundes und der Laender)
# fuer das Stadtgebiet Oldenburg und schreibt sie in die Datei Standortanalyse\zensus_oldenburg.js
# (Ebenen "Zensus ..." der App, Abschnitt "Wer wohnt dort?"). Alles geht in einem Schritt.
#
# Was passiert: Acht ZIP-Dateien (zusammen ca. 130 MB, bundesweit) werden heruntergeladen, die Zellen in und um Oldenburg herausgesucht
# (die Gitterkoordinaten sind ETRS89-LAEA, EPSG:3035, und werden hier in Laengen- und Breitengrad umgerechnet) und alles in einer kleinen
# Datei gesammelt. Die ZIP-Dateien werden danach geloescht. Dauer: je nach Verbindung etwa 3 bis 8 Minuten.
#
# Lizenz: Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0), Quelle: Statistische Aemter des Bundes und der Laender, Zensus 2022
# (Stichtag 15. Mai 2022, Gitterdaten Version 2 vom 30.09.2024). Die Zahlen sind durch ein Geheimhaltungsverfahren leicht veraendert.
#
# Je Zelle eine Zeile: [Breite, Laenge, Einwohner, Durchschnittsalter, Anteil unter 18 (%), Anteil ab 65 (%), Haushaltsgroesse, Nettokaltmiete (EUR/m2),
#                       Leerstandsquote (%), Eigentuemerquote (%), Klammer-Merkmale]. -1 = keine Angabe. Breite/Laenge der Zellmitte in Millionstel
#                       Grad (erste Zelle absolut, danach Unterschiede zur vorigen). Klammer-Merkmale: Bitmaske der Werte, die das Bundesamt in Klammern
#                       ausweist (kleine Fallzahl, eingeschraenkt aussagekraeftig): 1 Alter, 2 unter 18, 4 ab 65, 8 Haushaltsgroesse, 16 Miete,
#                       32 Leerstand, 64 Eigentuemer.

param(
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\zensus_oldenburg.js'),
  [string]$Arbeitsordner = (Join-Path $env:TEMP 'zensus_oldenburg_roh'),
  [switch]$Behalten
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

public static class ZensusKonv {
  const double A = 6378137.0;
  static readonly double E2 = 2 * (1.0 / 298.257222101) - (1.0 / 298.257222101) * (1.0 / 298.257222101);
  static readonly double E = Math.Sqrt(2 * (1.0 / 298.257222101) - (1.0 / 298.257222101) * (1.0 / 298.257222101));
  const double LAT0 = 52.0 * Math.PI / 180.0, LON0 = 10.0 * Math.PI / 180.0, FE = 4321000.0, FN = 3210000.0;

  static double Q(double s) { return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.Log((1 - E * s) / (1 + E * s))); }
  static double QP() { return Q(1.0); }
  static double Beta(double lat) { return Math.Asin(Q(Math.Sin(lat)) / QP()); }
  static double Rq() { return A * Math.Sqrt(QP() / 2); }
  static double B1() { return Beta(LAT0); }
  static double D() { double m1 = Math.Cos(LAT0) / Math.Sqrt(1 - E2 * Math.Sin(LAT0) * Math.Sin(LAT0)); return A * m1 / (Rq() * Math.Cos(B1())); }

  // Breite/Laenge (Grad) -> Gitterkoordinaten ETRS89-LAEA (Meter)
  public static void Vor(double latGrad, double lonGrad, out double x, out double y) {
    double lat = latGrad * Math.PI / 180.0, lon = lonGrad * Math.PI / 180.0;
    double b = Beta(lat), b1 = B1(), d = D(), rq = Rq(), dl = lon - LON0;
    double bb = rq * Math.Sqrt(2.0 / (1 + Math.Sin(b1) * Math.Sin(b) + Math.Cos(b1) * Math.Cos(b) * Math.Cos(dl)));
    x = FE + bb * d * Math.Cos(b) * Math.Sin(dl);
    y = FN + (bb / d) * (Math.Cos(b1) * Math.Sin(b) - Math.Sin(b1) * Math.Cos(b) * Math.Cos(dl));
  }

  // Gitterkoordinaten (Meter) -> Breite/Laenge (Grad)
  public static void Rueck(double xm, double ym, out double latGrad, out double lonGrad) {
    double x = xm - FE, y = ym - FN, b1 = B1(), d = D(), rq = Rq();
    double rho = Math.Sqrt((x / d) * (x / d) + (d * y) * (d * y));
    double ce = 2 * Math.Asin(rho / (2 * rq));
    double bs = Math.Asin(Math.Cos(ce) * Math.Sin(b1) + (d * y * Math.Sin(ce) * Math.Cos(b1)) / rho);
    double lon = LON0 + Math.Atan2(x * Math.Sin(ce), d * rho * Math.Cos(b1) * Math.Cos(ce) - d * d * y * Math.Sin(b1) * Math.Sin(ce));
    double e4 = E2 * E2, e6 = e4 * E2;
    double lat = bs + (E2 / 3 + 31 * e4 / 180 + 517 * e6 / 5040) * Math.Sin(2 * bs) + (23 * e4 / 360 + 251 * e6 / 3780) * Math.Sin(4 * bs) + (761 * e6 / 45360) * Math.Sin(6 * bs);
    latGrad = lat * 180.0 / Math.PI; lonGrad = lon * 180.0 / Math.PI;
  }

  // Liest eine 100-m-CSV (Kopfzeile; GITTER_ID;x;y;Wert;Zeichen) und gibt die Zeilen im Rechteck zurueck: Schluessel x*10000000+y, Wert = { Wert, Zeichen }
  public static Dictionary<long, string[]> Lies(string datei, double x0, double x1, double y0, double y1) {
    Dictionary<long, string[]> aus = new Dictionary<long, string[]>();
    using (StreamReader r = new StreamReader(datei, new UTF8Encoding(false))) {
      string zeile = r.ReadLine();
      while ((zeile = r.ReadLine()) != null) {
        string[] t = zeile.Split(';');
        if (t.Length < 4) { continue; }
        double x, y;
        if (!double.TryParse(t[1], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out x)) { continue; }
        if (x < x0 || x > x1) { continue; }
        if (!double.TryParse(t[2], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out y)) { continue; }
        if (y < y0 || y > y1) { continue; }
        aus[(long)x * 10000000L + (long)y] = new string[] { t[3], t.Length > 4 ? t[4] : "" };
      }
    }
    return aus;
  }
}
'@

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345

# Probe der Umrechnung: hin und zurueck muss denselben Punkt ergeben
$px = 0.0; $py = 0.0; $la = 0.0; $lo = 0.0
[ZensusKonv]::Vor(53.1405, 8.2135, [ref]$px, [ref]$py)
[ZensusKonv]::Rueck($px, $py, [ref]$la, [ref]$lo)
if ([Math]::Abs($la - 53.1405) -gt 1e-7 -or [Math]::Abs($lo - 8.2135) -gt 1e-7) { throw 'Umrechnung der Gitterkoordinaten stimmt nicht.' }
Write-Host ("Probe: Oldenburg Mitte liegt bei E {0:n0}, N {1:n0} (ETRS89-LAEA)." -f $px, $py)

# Rechteck im Gitter, das das Stadtgebiet sicher enthaelt
$xs = @(); $ys = @()
foreach ($b in @($sued, $nord)) { foreach ($l in @($west, $ost)) { [ZensusKonv]::Vor($b, $l, [ref]$px, [ref]$py); $xs += $px; $ys += $py } }
$x0 = ($xs | Measure-Object -Minimum).Minimum - 500; $x1 = ($xs | Measure-Object -Maximum).Maximum + 500
$y0 = ($ys | Measure-Object -Minimum).Minimum - 500; $y1 = ($ys | Measure-Object -Maximum).Maximum + 500

# Die Themen: Schluessel, ZIP, Datei, Art (e = ganze Zahl, w = Zahl, a = Anteil: "-" heisst 0), Bit fuer "Klammern"
$base = 'https://www.destatis.de/static/DE/zensus/gitterdaten/'
$themen = @(
  @{ Name = 'einw';  Zip = 'Zensus2022_Bevoelkerungszahl.zip';                       Csv = 'Zensus2022_Bevoelkerungszahl_100m-Gitter.csv';       Art = 'e'; Bit = 0 },
  @{ Name = 'alter'; Zip = 'Durchschnittsalter_in_Gitterzellen.zip';                 Csv = 'Zensus2022_Durchschnittsalter_100m-Gitter.csv';      Art = 'w'; Bit = 1 },
  @{ Name = 'u18';   Zip = 'Anteil_unter_18-jaehrige_in_Gitterzellen.zip';           Csv = 'Zensus2022_Anteil_unter_18_100m-Gitter.csv';         Art = 'a'; Bit = 2 },
  @{ Name = 'o65';   Zip = 'Anteil_ab_65-jaehrige_in_Gitterzellen.zip';              Csv = 'Zensus2022_Anteil_ueber_65_100m-Gitter.csv';         Art = 'a'; Bit = 4 },
  @{ Name = 'hh';    Zip = 'Durchschnittliche_Haushaltsgroesse_in_Gitterzellen.zip'; Csv = 'Zensus2022_Durchschn_Haushaltsgroesse_100m-Gitter.csv'; Art = 'w'; Bit = 8 },
  @{ Name = 'miete'; Zip = 'Zensus2022_Durchschn_Nettokaltmiete.zip';                Csv = 'Zensus2022_Durchschn_Nettokaltmiete_100m-Gitter.csv'; Art = 'w'; Bit = 16 },
  @{ Name = 'leer';  Zip = 'Leerstandsquote_in_Gitterzellen.zip';                    Csv = 'Zensus2022_Leerstandsquote_100m-Gitter.csv';         Art = 'a'; Bit = 32 },
  @{ Name = 'eigen'; Zip = 'Eigentuemerquote_in_Gitterzellen.zip';                   Csv = 'Zensus2022_Eigentuemerquote_100m-Gitter.csv';        Art = 'a'; Bit = 64 }
)

New-Item -ItemType Directory -Force $Arbeitsordner | Out-Null
$de = [Globalization.CultureInfo]::GetCultureInfo('de-DE')
$daten = @{}
foreach ($t in $themen) {
  $zip = Join-Path $Arbeitsordner $t.Zip
  if (-not (Test-Path $zip)) {
    Write-Host ("Lade {0} ..." -f $t.Zip)
    Invoke-WebRequest -Uri ($base + $t.Zip) -OutFile $zip -UseBasicParsing -TimeoutSec 900
  }
  $ordner = Join-Path $Arbeitsordner ([IO.Path]::GetFileNameWithoutExtension($t.Zip))
  $csv = Join-Path $ordner $t.Csv
  if (-not (Test-Path $csv)) {
    # nur die 100-m-Datei auspacken (die anderen werden nicht gebraucht)
    New-Item -ItemType Directory -Force $ordner | Out-Null
    $z = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
      $eintrag = $z.Entries | Where-Object { $_.Name -eq $t.Csv } | Select-Object -First 1
      if (-not $eintrag) { throw ('In ' + $t.Zip + ' fehlt ' + $t.Csv) }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($eintrag, $csv, $true)
    } finally { $z.Dispose() }
  }
  Write-Host ("Lese {0} ..." -f $t.Csv)
  $daten[$t.Name] = [ZensusKonv]::Lies($csv, $x0, $x1, $y0, $y1)
  Write-Host ("  {0} Zellen im Rechteck" -f $daten[$t.Name].Count)
}

# Alle Zellen, die in irgendeinem Thema vorkommen
$schluessel = New-Object 'System.Collections.Generic.HashSet[long]'
foreach ($t in $themen) { foreach ($k in $daten[$t.Name].Keys) { [void]$schluessel.Add($k) } }
$liste = [long[]]@($schluessel) | Sort-Object { [long]($_ % 10000000L) }, { [long][Math]::Floor($_ / 10000000L) }

# Das Bundesamt schreibt "genau Null oder auf Null geaendert" als einzelnen Strich (Gedankenstrich); hier: ein einzelnes Zeichen, das keine Ziffer ist
function IstStrich($s) { return ($s.Length -eq 1 -and -not [char]::IsDigit($s[0])) }
function Zahl($text, $art) {
  $s = $text.Trim().Trim('(', ')')
  if (IstStrich $s) { if ($art -eq 'a') { return 0.0 } else { return $null } }
  $v = 0.0
  if ([double]::TryParse($s, [Globalization.NumberStyles]::Float, $de, [ref]$v)) { return $v }
  return $null
}
$fremd = @{}
$zeilen = New-Object System.Collections.Generic.List[string]
$vLa = 0L; $vLo = 0L; $summeEinw = 0; $mitEinw = 0
foreach ($k in $liste) {
  $x = [Math]::Floor($k / 10000000L); $y = $k % 10000000L
  $la = 0.0; $lo = 0.0
  [ZensusKonv]::Rueck([double]$x, [double]$y, [ref]$la, [ref]$lo)
  if ($la -lt $sued -or $la -gt $nord -or $lo -lt $west -or $lo -gt $ost) { continue }
  $werte = @(); $klammer = 0
  foreach ($t in $themen) {
    $e = $daten[$t.Name][$k]
    if (-not $e) { $werte += '-1'; continue }
    $zeichen = $e[1]
    if ($zeichen -and $zeichen -ne 'KLAMMERN') { $fremd[$zeichen] = 1 + [int]$fremd[$zeichen] }
    $v = Zahl $e[0] $t.Art
    if ($null -eq $v) { $werte += '-1'; if (-not (IstStrich $e[0].Trim())) { $fremd['Wert:' + $e[0]] = 1 + [int]$fremd['Wert:' + $e[0]] }; continue }
    if ($zeichen -eq 'KLAMMERN' -and $t.Bit) { $klammer = $klammer -bor $t.Bit }
    if ($t.Art -eq 'e') { $werte += [string][int]$v; $summeEinw += [int]$v; if ($v -gt 0) { $mitEinw++ } }
    else { $werte += $v.ToString('0.##', [Globalization.CultureInfo]::InvariantCulture) }
  }
  $nLa = [long][Math]::Round($la * 1e6); $nLo = [long][Math]::Round($lo * 1e6)
  $zeilen.Add('[' + ($nLa - $vLa) + ',' + ($nLo - $vLo) + ',' + ($werte -join ',') + ',' + $klammer + ']')
  $vLa = $nLa; $vLo = $nLo
}
Write-Host ("{0} Zellen, davon {1} mit Einwohnern, zusammen {2:n0} Einwohner" -f $zeilen.Count, $mitEinw, $summeEinw)
if ($fremd.Count) { Write-Host ('Andere Zeichen in den Dateien: ' + (($fremd.Keys | ForEach-Object { "$_=" + $fremd[$_] }) -join ', ')) }

# Gitterrichtung in der Stadtmitte: so verschieben sich Breite und Laenge (Millionstel Grad) je 100 m nach Osten (gx) und nach Norden (gy)
$mx = 0.0; $my = 0.0; $a1 = 0.0; $o1 = 0.0; $a2 = 0.0; $o2 = 0.0
[ZensusKonv]::Vor(53.1405, 8.2135, [ref]$mx, [ref]$my)
[ZensusKonv]::Rueck($mx, $my, [ref]$a1, [ref]$o1)
[ZensusKonv]::Rueck($mx + 100, $my, [ref]$a2, [ref]$o2)
$gx = '[' + [Math]::Round(($a2 - $a1) * 1e6, 1).ToString([Globalization.CultureInfo]::InvariantCulture) + ',' + [Math]::Round(($o2 - $o1) * 1e6, 1).ToString([Globalization.CultureInfo]::InvariantCulture) + ']'
[ZensusKonv]::Rueck($mx, $my + 100, [ref]$a2, [ref]$o2)
$gy = '[' + [Math]::Round(($a2 - $a1) * 1e6, 1).ToString([Globalization.CultureInfo]::InvariantCulture) + ',' + [Math]::Round(($o2 - $o1) * 1e6, 1).ToString([Globalization.CultureInfo]::InvariantCulture) + ']'
Write-Host ("Gitter: 100 m nach Osten = {0}, 100 m nach Norden = {1} (Millionstel Grad Breite, Laenge)" -f $gx, $gy)

$inhalt = '// Zensus 2022, 100-m-Gitter fuer Oldenburg (c) Statistische Aemter des Bundes und der Laender, 2024. Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0). Erzeugt mit Datenpflege\28_Zensus_aktualisieren.ps1' + "`n" +
          '// z = [Breite, Laenge (Zellmitte, Millionstel Grad, ab der zweiten Zelle Unterschiede), Einwohner, Durchschnittsalter, Anteil unter 18 %, Anteil ab 65 %, Haushaltsgroesse, Nettokaltmiete EUR/m2, Leerstand %, Eigentuemer %, Klammer-Bits]; -1 = keine Angabe' + "`n" +
          'var ZENSUS_OLDENBURG = {"stand":"2022-05-15","einheit":1e-6,"gx":' + $gx + ',"gy":' + $gy + ',"z":[' + ($zeilen -join ',') + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} geschrieben ({1} KB)." -f $Ausgabe, [int]((Get-Item $Ausgabe).Length / 1024))

if (-not $Behalten) { Remove-Item -Recurse -Force $Arbeitsordner; Write-Host 'Die heruntergeladenen Dateien wurden geloescht.' }
