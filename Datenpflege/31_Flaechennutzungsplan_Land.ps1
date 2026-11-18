# Holt den Flaechennutzungsplan (FNP) einer Stadt aus dem Landesportal PlanDigital Niedersachsen und schreibt ihn in die Datei
# Standortanalyse\staedte\<Stadt>\fnp.js (Ebenen "Flaechennutzungsplan" der App). Fuer Oldenburg gibt es das Programm 23 (anderer Dienst).
#
# Quelle: Landesportal PlanDigital, Dienst https://testportal-plandigital.de/ows/<AGS>/fplan (WFS 2.0, "Zusammenzeichnung" des
# rechtswirksamen Plans mit allen Aenderungen). Lizenz laut Dienst: Datenlizenz Deutschland - Zero - Version 2.0
# (dl-zero-de/2.0, https://www.govdata.de/dl-de/zero-2-0), also ohne Pflicht zur Namensnennung. Die App nennt die Stadt trotzdem.
# Der Dienst liefert nur GML in UTM32 (EPSG:25832); die Umrechnung in Laenge und Breite macht dieses Programm selbst.
# Rechtlich verbindlich ist nur die Auskunft der Stadt als Traegerin der Planung.
#
# Ein Schritt, dauert je nach Stadt 1 bis 3 Minuten. Es entsteht eine kleine Datei.

param(
  [string]$Stadt = 'osnabrueck',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\fnp.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt
if ($Stadt -eq 'oldenburg') { throw 'Fuer Oldenburg gilt das Programm 23_Flaechennutzungsplan_aktualisieren.ps1.' }
if (-not $StadtInfo.Ags) { throw 'In staedte.js fehlt der amtliche Gemeindeschluessel (ags).' }

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ags = $StadtInfo.Ags.TrimStart('0')
$dienst = 'https://testportal-plandigital.de/ows/' + $ags + '/fplan'

Add-Type -TypeDefinition @'
using System;
using System.Text;
public static class Utm32
{
    // UTM-Zone 32 (ETRS89) -> Breite, Laenge in Grad (Krueger-Reihe)
    public static void Zurueck(double E, double N, out double lat, out double lon)
    {
        double a = 6378137.0, f = 1 / 298.257222101, k0 = 0.9996, E0 = 500000.0, lon0 = 9.0 * Math.PI / 180;
        double n = f / (2 - f);
        double A = a / (1 + n) * (1 + n * n / 4 + n * n * n * n / 64);
        double[] beta = { n / 2 - 2 * n * n / 3 + 37 * n * n * n / 96 - n * n * n * n / 360, n * n / 48 + n * n * n / 15 - 437 * n * n * n * n / 1440, 17 * n * n * n / 480 - 37 * n * n * n * n / 840, 4397 * n * n * n * n / 161280 };
        double[] delta = { 2 * n - 2 * n * n / 3 - 2 * n * n * n, 7 * n * n / 3 - 8 * n * n * n / 5, 56 * n * n * n / 15 };
        double xi = N / (k0 * A), eta = (E - E0) / (k0 * A);
        double xi2 = xi, eta2 = eta;
        for (int j = 1; j <= 4; j++)
        {
            xi2 -= beta[j - 1] * Math.Sin(2 * j * xi) * Math.Cosh(2 * j * eta);
            eta2 -= beta[j - 1] * Math.Cos(2 * j * xi) * Math.Sinh(2 * j * eta);
        }
        double chi = Math.Asin(Math.Sin(xi2) / Math.Cosh(eta2));
        double phi = chi;
        for (int j = 1; j <= 3; j++) phi += delta[j - 1] * Math.Sin(2 * j * chi);
        lat = phi * 180 / Math.PI;
        lon = (lon0 + Math.Atan2(Math.Sinh(eta2), Math.Cos(xi2))) * 180 / Math.PI;
    }
    // "E N E N ..." (UTM) -> "[Breite, Laenge, Delta, Delta, ...]" in Millionstel Grad; der Schlusspunkt (= erster) entfaellt, null = zu klein
    public static string Ring(string posList)
    {
        string[] t = posList.Split(new char[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        int np = t.Length / 2;
        if (np > 1 && t[0] == t[2 * (np - 1)] && t[1] == t[2 * (np - 1) + 1]) np--;
        var sb = new StringBuilder(); long la0 = 0, lo0 = 0; int zaehl = 0;
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        for (int i = 0; i < np; i++)
        {
            double lat, lon;
            Zurueck(double.Parse(t[2 * i], inv), double.Parse(t[2 * i + 1], inv), out lat, out lon);
            long la = (long)Math.Round(lat * 1e6), lo = (long)Math.Round(lon * 1e6);
            if (i > 0 && la == la0 && lo == lo0) continue;
            if (zaehl > 0) sb.Append(',');
            sb.Append((la - la0).ToString(inv)).Append(',').Append((lo - lo0).ToString(inv));
            la0 = la; lo0 = lo; zaehl++;
        }
        if (zaehl < 3) return null;
        return "[" + sb.ToString() + "]";
    }
}
'@

# Welche Ebenen es im Dienst dieser Stadt gibt
$kopf = Invoke-WebRequest -Uri ($dienst + '?Service=WFS&Request=GetCapabilities&Version=2.0.0') -UseBasicParsing -TimeoutSec 120
$caps = [Text.Encoding]::UTF8.GetString($kopf.RawContentStream.ToArray())
$vorhanden = @{}
foreach ($m in [regex]::Matches($caps, '<Name>ms:([^<]+)</Name>')) { $vorhanden[$m.Groups[1].Value] = $true }
if ($vorhanden.Count -eq 0) { foreach ($m in [regex]::Matches($caps, '<(?:wfs:)?Name>ms:([^<]+)<')) { $vorhanden[$m.Groups[1].Value] = $true } }
Write-Host ('Ebenen im Dienst: ' + $vorhanden.Count)

# Was geholt wird: Typ im Dienst, Feld (kleingeschrieben) zum Aufteilen (leer = keins), Zuordnung der Werte zu Gruppen der App.
# allgArtDerBaulNutzung (XPlanung): 1000 Wohnbauflaeche, 2000 Gemischte Baufläche, 3000 Gewerbliche Baufläche, 4000 Sonderbaufläche
$quellen = @(
  @{ Typ = 'fp_bebauungsflaeche_polygons'; Feld = 'allgartderbaulnutzung'; Gruppen = @{ '1000' = 'fnp_wohnen'; '2000' = 'fnp_gemischt'; '3000' = 'fnp_gewerbe'; '4000' = 'fnp_sonder' } },
  @{ Typ = 'fp_gemeinbedarf_polygons';     Feld = ''; Gruppen = @{ '*' = 'fnp_gemeinbedarf' } },
  @{ Typ = 'fp_gruen_polygons';            Feld = ''; Gruppen = @{ '*' = 'fnp_gruen' } },
  @{ Typ = 'fp_waldflaeche_polygons';      Feld = ''; Gruppen = @{ '*' = 'fnp_wald' } },
  @{ Typ = 'fp_gewaesser_polygons';        Feld = ''; Gruppen = @{ '*' = 'fnp_wasser' } },
  @{ Typ = 'fp_landwirtschaft_polygons';   Feld = ''; Gruppen = @{ '*' = 'fnp_landwirtschaft' } }
)
$reihenfolge = @('fnp_wohnen', 'fnp_gemischt', 'fnp_gewerbe', 'fnp_sonder', 'fnp_gemeinbedarf', 'fnp_gruen', 'fnp_wald', 'fnp_wasser', 'fnp_landwirtschaft')
$daten = @{}
foreach ($id in $reihenfolge) { $daten[$id] = New-Object System.Collections.ArrayList }

foreach ($q in $quellen) {
  if (-not $vorhanden.ContainsKey($q.Typ)) { Write-Host ($q.Typ + ': in diesem Dienst nicht vorhanden - uebersprungen'); continue }
  $start = 0; $seite = 2000; $anzahl = 0
  while ($true) {
    $adresse = $dienst + '?Service=WFS&Version=2.0.0&Request=GetFeature&typeNames=ms:' + $q.Typ + '&count=' + $seite + '&STARTINDEX=' + $start
    $ok = $false; $text = $null
    for ($versuch = 1; $versuch -le 3 -and -not $ok; $versuch++) {
      try {
        Write-Host ('Hole ' + $q.Typ + ' ab ' + $start + ' (Versuch ' + $versuch + ') ...')
        $r = Invoke-WebRequest $adresse -UseBasicParsing -TimeoutSec 300
        $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()); $ok = $true
      } catch { Write-Host ('  Fehler: ' + $_.Exception.Message); Start-Sleep -Seconds 5 }
    }
    if (-not $ok) { throw ('Der Dienst lieferte ' + $q.Typ + ' nicht.') }
    $xml = New-Object System.Xml.XmlDocument; $xml.LoadXml($text)
    $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('wfs', 'http://www.opengis.net/wfs/2.0'); $ns.AddNamespace('gml', 'http://www.opengis.net/gml/3.2'); $ns.AddNamespace('ms', 'http://mapserver.gis.umn.edu/mapserver')
    $mitglieder = $xml.SelectNodes('//wfs:member/*', $ns)
    foreach ($mg in $mitglieder) {
      $schl = '*'
      if ($q.Feld) {
        $kn = $mg.SelectSingleNode('ms:' + $q.Feld, $ns); $schl = if ($kn) { $kn.InnerText.Trim() } else { '' }
        if (-not $q.Gruppen.ContainsKey($schl)) { continue }
      }
      $gruppe = $q.Gruppen[$schl]
      foreach ($poly in $mg.SelectNodes('.//gml:Polygon', $ns)) {
        $ringe = @()
        foreach ($pl in $poly.SelectNodes('.//gml:posList', $ns)) { $z = [Utm32]::Ring($pl.InnerText); if ($z) { $ringe += $z } }
        if ($ringe.Count -gt 0) { [void]$daten[$gruppe].Add('[' + ($ringe -join ',') + ']'); $anzahl++ }
      }
    }
    $gelesen = $mitglieder.Count
    if ($gelesen -lt $seite) { break }
    $start += $gelesen
  }
  Write-Host ('  ' + $anzahl + ' Flaechen')
}

$gruppenText = New-Object System.Collections.ArrayList
foreach ($id in $reihenfolge) { [void]$gruppenText.Add('"' + $id + '":{"f":[' + ($daten[$id] -join ',') + ']}') }
$inhalt = '// Flaechennutzungsplan der Stadt ' + $StadtInfo.Ascii + ': Wohn-, gemischte, gewerbliche und Sonderbauflaechen, Gemeinbedarf, Gruen, Wald, Wasser, Landwirtschaft.' + "`n" +
          '// Quelle: Landesportal PlanDigital Niedersachsen (' + $dienst + '), Zusammenzeichnung des rechtswirksamen Flaechennutzungsplans, Datenlizenz Deutschland - Zero - Version 2.0 (https://www.govdata.de/dl-de/zero-2-0).' + "`n" +
          '// Erzeugt mit Datenpflege\31_Flaechennutzungsplan_Land.ps1. f = Flaechen (Ringe als [Breite, Laenge, Delta, ...] in Millionstel Grad).' + "`n" +
          'var FNP_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","gruppen":{' + ($gruppenText -join ',') + '}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ('Fertig: ' + $Ausgabe + ' (' + [Math]::Round($inhalt.Length / 1024) + ' KB)')
