# Holt die Bodenrichtwerte (Bauland) der Stadt Oldenburg vom Landesamt LGLN (BORIS Niedersachsen, WFS 2.0) und schreibt sie in die Datei
# Standortanalyse\staedte\<Stadt>\bodenrichtwerte.js (Ebene "Bodenrichtwerte" und Wirtschaftlichkeit in der Grundstuecksanalyse der App).
#
# Quelle: LGLN / Gutachterausschuss, BORIS Niedersachsen "BORIS 2026 WFS" (https://opendata.lgln.niedersachsen.de/doorman/noauth/boris_wfs).
# Lizenz: Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0, Quelle GDI-NI). Die Quelle muss genannt werden (macht die App).
# Die Daten sind klein, deshalb geht alles in einem Schritt (etwa 1 Minute).
#
# Es werden nur Bodenrichtwertzonen fuer Bauland (Entwicklungszustand B) im Gemeindegebiet der Stadt uebernommen.
# Land- und Forstwirtschaft (Acker, Gruenland, Wald) liegt als riesige Flaeche unter allem und waere in der Karte nutzlos.

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\bodenrichtwerte.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [double]$Toleranz = 1.0      # Vereinfachung der Linien in Metern
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$cCode = @'
using System;
using System.Collections.Generic;
using System.Globalization;
public static class BrzRing {
  // posList (Breite Laenge Breite Laenge ...) -> vereinfachter Ring als [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad
  public static long[] Ring(string posList, double tolMeter) {
    string[] t = posList.Split(new char[] { ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries);
    int n = t.Length / 2;
    double[] la = new double[n], lo = new double[n];
    for (int i = 0; i < n; i++) {
      la[i] = double.Parse(t[2 * i], CultureInfo.InvariantCulture);
      lo[i] = double.Parse(t[2 * i + 1], CultureInfo.InvariantCulture);
    }
    // letzter Punkt = erster Punkt: weglassen
    if (n > 1 && la[0] == la[n - 1] && lo[0] == lo[n - 1]) { n--; }
    double fy = 111195.0, fx = 111195.0 * Math.Cos(__BREITE__ * Math.PI / 180);
    bool[] keep = new bool[n];
    keep[0] = true; keep[n - 1] = true;
    Stack<int[]> st = new Stack<int[]>();
    st.Push(new int[] { 0, n - 1 });
    while (st.Count > 0) {
      int[] s = st.Pop(); int a = s[0], b = s[1];
      if (b <= a + 1) continue;
      double ax = lo[a] * fx, ay = la[a] * fy, bx = lo[b] * fx, by = la[b] * fy;
      double dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, dmax = -1; int imax = -1;
      for (int i = a + 1; i < b; i++) {
        double px = lo[i] * fx, py = la[i] * fy, d;
        if (len2 == 0) { d = Math.Sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay)); }
        else {
          double u = ((px - ax) * dx + (py - ay) * dy) / len2; if (u < 0) u = 0; if (u > 1) u = 1;
          double qx = ax + u * dx, qy = ay + u * dy; d = Math.Sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
        }
        if (d > dmax) { dmax = d; imax = i; }
      }
      if (dmax > tolMeter) { keep[imax] = true; st.Push(new int[] { a, imax }); st.Push(new int[] { imax, b }); }
    }
    List<long> res = new List<long>();
    long pla = 0, plo = 0; int kept = 0;
    for (int i = 0; i < n; i++) {
      if (!keep[i]) continue;
      long ila = (long)Math.Round(la[i] * 1e6), ilo = (long)Math.Round(lo[i] * 1e6);
      res.Add(ila - pla); res.Add(ilo - plo); pla = ila; plo = ilo; kept++;
    }
    if (kept < 3) { return new long[0]; }
    return res.ToArray();
  }
}
'@
Add-Type -TypeDefinition $cCode.Replace('__BREITE__', $StadtInfo.Breite.ToString([Globalization.CultureInfo]::InvariantCulture))

$dienst = 'https://opendata.lgln.niedersachsen.de/doorman/noauth/boris_wfs'
# Rechteck um die Stadt mit etwas Rand: Sued, West, Nord, Ost
$url = $dienst + '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=boris:BR_BodenrichtwertZonal&SRSNAME=urn:ogc:def:crs:EPSG::4326&COUNT=2000' +
       '&BBOX=' + [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0},{1},{2},{3}', $StadtInfo.Sued, $StadtInfo.West, $StadtInfo.Nord, $StadtInfo.Ost) + ',urn:ogc:def:crs:EPSG::4326'
Write-Host 'Frage das Landesamt (BORIS Niedersachsen) ab ...'
$r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 400 -UserAgent 'Standortanalyse-Studienprojekt/1.0'
$text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
if ($text -notmatch 'FeatureCollection') { throw 'unbrauchbare Antwort' }
$xml = New-Object System.Xml.XmlDocument
$xml.LoadXml($text)
$zonen = $xml.SelectNodes("//*[local-name()='BR_BodenrichtwertZonal']")
Write-Host ("{0} Zonen erhalten" -f $zonen.Count)

function Wert($z, $name) {
  $e = $z.SelectSingleNode("*[local-name()='$name']")
  if ($e) { return ($e.InnerText -replace '\s+', ' ').Trim() } else { return '' }
}
function InnerWert($z, $name) {
  $e = $z.SelectSingleNode("*[local-name()='$name']//*[local-name()='wert']")
  if ($e) { return $e.InnerText.Trim() } else { return '' }
}
$inv = [Globalization.CultureInfo]::InvariantCulture
function JsText($s) { return '"' + ($s -replace '[\x00-\x1f  ]', ' ').Replace('\', '\\').Replace('"', '\"') + '"' }

$flaechen = New-Object System.Collections.Generic.List[string]
$attribute = New-Object System.Collections.Generic.List[string]
$werte = New-Object System.Collections.Generic.List[double]
$klassenListe = New-Object System.Collections.Generic.List[string]
$ohneNutzung = 0
foreach ($z in $zonen) {
  $gem = $z.SelectSingleNode("*[local-name()='gemeinde']//*[local-name()='name']")
  if (-not $gem -or ($StadtInfo.Gemeinde -and $gem.InnerText -notmatch $StadtInfo.Gemeinde)) { continue }
  if ((Wert $z 'entwicklungszustand') -ne 'B') { continue }
  $w = [double]::Parse((Wert $z 'bodenrichtwert'), $inv)
  if ($w -le 0) { continue }
  # Geometrie: alle Polygone der Zone, jeder Ring (aussen und innen) vereinfacht
  $ringe = New-Object System.Collections.Generic.List[string]
  foreach ($pl in $z.SelectNodes("*[local-name()='position']//*[local-name()='posList']")) {
    $flach = [BrzRing]::Ring($pl.InnerText, $Toleranz)
    if ($flach.Length -ge 6) { $ringe.Add('[' + ($flach -join ',') + ']') }
  }
  if ($ringe.Count -eq 0) { continue }
  $nutzung = (Wert $z 'nutzung'); if (-not $nutzung) { $ohneNutzung++ }
  $gfz = InnerWert $z 'wertrelevanteGeschossflaechenzahl'; if (-not $gfz) { $gfz = '0' }
  $gesch = InnerWert $z 'geschosszahl'
  $flRichtwert = InnerWert $z 'flaeche'; if (-not $flRichtwert) { $flRichtwert = '0' }
  $wtext = $w.ToString('0.##', $inv)
  $verf = Wert $z 'verfahrensart'
  # Klasse nach der Hoehe des Richtwerts (Euro je Quadratmeter Boden)
  if ($w -lt 150) { $k = 'brw1' } elseif ($w -lt 250) { $k = 'brw2' } elseif ($w -lt 350) { $k = 'brw3' } elseif ($w -lt 500) { $k = 'brw4' } elseif ($w -lt 700) { $k = 'brw5' } else { $k = 'brw6' }
  $flaechen.Add('[' + ($ringe -join ',') + ']')
  $klassenListe.Add('"' + $k + '"')
  $werte.Add($w)
  # Eigenschaften je Zone: [Nummer, Name, Wert, Nutzung, GFZ, Geschosse (roemisch), Bauweise, Verfahren, Richtgrundstuecksflaeche, Entwicklungszustand]
  $attribute.Add('[' + (JsText (Wert $z 'bodenrichtwertNummer')) + ',' + (JsText (Wert $z 'bodenrichtwertzoneName')) + ',' + $wtext + ',' +
                 (JsText $nutzung) + ',' + $gfz + ',' + (JsText $gesch) + ',' + (JsText (Wert $z 'bauweise')) + ',' + (JsText $verf) + ',' + $flRichtwert + ',"B"]')
}
if ($flaechen.Count -eq 0) { throw 'Keine Zonen fuer die Stadt gefunden' }

$sortiert = $werte | Sort-Object
Write-Host ("{0} Zonen fuer {4} (Bauland), Richtwerte von {1} bis {2} Euro/m2, Median {3}" -f $flaechen.Count, $sortiert[0], $sortiert[-1], $sortiert[[int]($sortiert.Count / 2)], $StadtInfo.Ascii)
Write-Host ("  Klassen: " + (($klassenListe | Group-Object | Sort-Object Name | ForEach-Object { $_.Name.Trim('"') + '=' + $_.Count }) -join ', '))
Write-Host ("  ohne Nutzungsangabe: {0}" -f $ohneNutzung)

$kopf = '// Bodenrichtwerte (Bauland) der Stadt ' + $StadtInfo.Ascii + '. Quelle: LGLN / Gutachterausschuss, BORIS Niedersachsen (WFS), Datenlizenz Deutschland - Namensnennung - Version 2.0 (dl-de/by-2-0).' + "`n" +
        '// Erzeugt mit Datenpflege\24_Bodenrichtwerte_aktualisieren.ps1. f = Flaechen (Ringe als [Breite, Laenge, Delta, ...] in Millionstel Grad), a = Wertklasse, z = Eigenschaften je Zone' + "`n" +
        '// [Nummer, Name, Euro je m2, Nutzung (Kuerzel), GFZ (0 = keine Angabe), Geschosse (roemisch), Bauweise, Verfahren, Richtgrundstuecksflaeche m2, Entwicklungszustand].' + "`n"
$inhalt = $kopf + 'var BODENRICHTWERTE_DATEN = {"einheit":1e-6,"stand":"' + $Stand + '","stichtag":"2026-01-01","gruppen":{"bodenrichtwerte":{"f":[' + ($flaechen -join ',') +
          '],"a":[' + ($klassenListe -join ',') + '],"z":[' + ($attribute -join ',') + ']}}};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0:n0} Byte in {1} geschrieben." -f $inhalt.Length, $Ausgabe)
