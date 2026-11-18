# Holt die oeffentlich nutzbaren Gruenflaechen im Stadtgebiet von OpenStreetMap und schreibt sie in die Datei
# Standortanalyse\staedte\<Stadt>\gruenversorgung.js (Ebene "Gruenversorgung" der App: Wohngebiete ohne Park, Spielplatz oder Wald
# in 300 m Fussweg). Alles geht in einem Schritt (etwa 1 Minute).
#
# Was gesammelt wird (jeweils ohne privaten oder gesperrten Zugang):
#   Art 0 = Park und Gruenflaeche (leisure=park, common; landuse=village_green, recreation_ground), ab 1.000 m2
#   Art 1 = Spielplatz (leisure=playground), ab 100 m2
#   Art 2 = Wald (natural=wood, landuse=forest), ab 10.000 m2
# Je Flaeche eine Zeile [Art, Breite, Laenge, Delta, Delta, ...] (nur die Aussenkante, Millionstel Grad, danach Unterschiede).

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\gruenversorgung.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
$b = "($sued,$west,$nord,$ost)"
$kennung = 'Standortanalyse-Studienprojekt/1.0'
$dienste = @(
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
)
$zugang = '["access"!~"^(private|no)$"]'
$abfrage = '[out:json][timeout:240];(' +
  'way["leisure"~"^(park|common|playground)$"]' + $zugang + $b + ';relation["leisure"~"^(park|common|playground)$"]' + $zugang + $b + ';' +
  'way["landuse"~"^(village_green|recreation_ground)$"]' + $zugang + $b + ';relation["landuse"~"^(village_green|recreation_ground)$"]' + $zugang + $b + ';' +
  'way["natural"="wood"]' + $zugang + $b + ';relation["natural"="wood"]' + $zugang + $b + ';' +
  'way["landuse"="forest"]' + $zugang + $b + ';relation["landuse"="forest"]' + $zugang + $b + ';' +
  ');out geom qt;'

$temp = Join-Path ([IO.Path]::GetTempPath()) 'gruenversorgung_roh.json'
$ok = $false
foreach ($dienst in $dienste) {
  for ($versuch = 1; $versuch -le 3 -and -not $ok; $versuch++) {
    try {
      Write-Host "Frage $dienst ab (Versuch $versuch) ..."
      $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ('data=' + [uri]::EscapeDataString($abfrage)) `
           -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 300
      $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
      if ($text -notmatch '"elements"') { throw 'unbrauchbare Antwort' }
      [IO.File]::WriteAllText($temp, $text, (New-Object System.Text.UTF8Encoding($false)))
      $ok = $true
    } catch {
      Write-Host ('  fehlgeschlagen: ' + $_.Exception.Message)
      Start-Sleep -Seconds (8 * $versuch)
    }
  }
  if ($ok) { break }
}
if (-not $ok) { throw 'Kein Dienst hat geantwortet. Bitte spaeter noch einmal versuchen.' }

$code = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class GruenWandler
{
    struct P { public long a, b; public P(long a, long b) { this.a = a; this.b = b; } }
    static double D(object o) { return Convert.ToDouble(o, System.Globalization.CultureInfo.InvariantCulture); }
    static bool Gleich(P x, P y) { return x.a == y.a && x.b == y.b; }
    static string Tag(Dictionary<string, object> tags, string key) { if (tags == null || !tags.ContainsKey(key)) return ""; return Convert.ToString(tags[key]); }

    static List<P> Punkte(object geom)
    {
        var l = new List<P>(); var arr = geom as object[]; if (arr == null) return l;
        foreach (var o in arr) { var d = (Dictionary<string, object>)o; l.Add(new P((long)Math.Round(D(d["lat"]) * 1e6), (long)Math.Round(D(d["lon"]) * 1e6))); }
        return l;
    }
    static List<P> Bereinige(List<P> r)
    {
        var o = new List<P>();
        foreach (var p in r) { if (o.Count == 0 || !Gleich(o[o.Count - 1], p)) o.Add(p); }
        if (o.Count > 1 && Gleich(o[0], o[o.Count - 1])) o.RemoveAt(o.Count - 1);
        return o;
    }
    static double FlaecheQm(List<P> r)
    {
        double s = 0;
        for (int i = 0; i < r.Count; i++) { var p = r[i]; var q = r[(i + 1) % r.Count]; s += (double)p.b * q.a - (double)q.b * p.a; }
        return Math.Abs(s) / 2 * 0.111 * 0.0669;
    }
    static double Abstand(P p, P a, P b)
    {
        double px = p.b * 0.6, py = p.a, ax = a.b * 0.6, ay = a.a, bx = b.b * 0.6, by = b.a;
        double dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        if (l2 == 0) return Math.Sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
        double t = Math.Max(0, Math.Min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        double cx = ax + t * dx, cy = ay + t * dy;
        return Math.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    }
    static List<P> Vereinfache(List<P> pts, double tol)
    {
        if (pts.Count < 3) return pts;
        var behalten = new bool[pts.Count]; behalten[0] = true; behalten[pts.Count - 1] = true;
        var stapel = new Stack<int[]>(); stapel.Push(new int[] { 0, pts.Count - 1 });
        while (stapel.Count > 0)
        {
            var seg = stapel.Pop(); double maxD = 0; int idx = -1;
            for (int i = seg[0] + 1; i < seg[1]; i++) { double d = Abstand(pts[i], pts[seg[0]], pts[seg[1]]); if (d > maxD) { maxD = d; idx = i; } }
            if (idx >= 0 && maxD > tol) { behalten[idx] = true; stapel.Push(new int[] { seg[0], idx }); stapel.Push(new int[] { idx, seg[1] }); }
        }
        var o = new List<P>(); for (int i = 0; i < pts.Count; i++) if (behalten[i]) o.Add(pts[i]);
        return o;
    }
    static List<P> VereinfacheRing(List<P> ring, double tol)
    {
        if (ring.Count < 5) return ring;
        var offen = new List<P>(ring); offen.Add(ring[0]);
        var v = Vereinfache(offen, tol); v.RemoveAt(v.Count - 1);
        return v.Count >= 3 ? v : ring;
    }
    static List<List<P>> Verbinde(List<List<P>> segmente)
    {
        var fertig = new List<List<P>>(); var offen = new List<List<P>>(segmente);
        while (offen.Count > 0)
        {
            var ring = new List<P>(offen[0]); offen.RemoveAt(0); bool weiter = true;
            while (weiter && !Gleich(ring[0], ring[ring.Count - 1]))
            {
                weiter = false;
                for (int i = 0; i < offen.Count; i++)
                {
                    var s = offen[i]; var rueck = new List<P>(s); rueck.Reverse();
                    if (Gleich(ring[ring.Count - 1], s[0])) { ring.AddRange(s.GetRange(1, s.Count - 1)); }
                    else if (Gleich(ring[ring.Count - 1], s[s.Count - 1])) { ring.AddRange(rueck.GetRange(1, rueck.Count - 1)); }
                    else if (Gleich(ring[0], s[s.Count - 1])) { ring.InsertRange(0, s.GetRange(0, s.Count - 1)); }
                    else if (Gleich(ring[0], s[0])) { ring.InsertRange(0, rueck.GetRange(0, rueck.Count - 1)); }
                    else continue;
                    offen.RemoveAt(i); weiter = true; break;
                }
            }
            if (ring.Count >= 4 && Gleich(ring[0], ring[ring.Count - 1])) fertig.Add(ring);
        }
        return fertig;
    }
    static void Folge(StringBuilder sb, List<P> pts)
    {
        long la = 0, lo = 0;
        for (int i = 0; i < pts.Count; i++)
        {
            var p = pts[i]; sb.Append(',');
            if (i == 0) sb.Append(p.a).Append(',').Append(p.b); else sb.Append(p.a - la).Append(',').Append(p.b - lo);
            la = p.a; lo = p.b;
        }
    }
    // Art: 0 Park/Gruen, 1 Spielplatz, 2 Wald; -1 = nicht verwendet
    static int Art(Dictionary<string, object> tags)
    {
        string leisure = Tag(tags, "leisure"), landuse = Tag(tags, "landuse"), natural = Tag(tags, "natural");
        if (leisure == "playground") return 1;
        if (natural == "wood" || landuse == "forest") return 2;
        if (leisure == "park" || leisure == "common" || landuse == "village_green" || landuse == "recreation_ground") return 0;
        return -1;
    }
    static double[] MinQm = new double[] { 1000, 100, 10000 };

    public static string Umwandeln(string datei, string ausgabe, string stand)
    {
        var ser = new JavaScriptSerializer(); ser.MaxJsonLength = int.MaxValue; ser.RecursionLimit = 200;
        var wurzel = (Dictionary<string, object>)ser.DeserializeObject(File.ReadAllText(datei, Encoding.UTF8));
        var gesehen = new HashSet<string>(); var zeilen = new List<string>(); var anzahl = new int[3]; double[] qm = new double[3];
        foreach (var eo in (object[])wurzel["elements"])
        {
            var e = (Dictionary<string, object>)eo; string typ = (string)e["type"];
            if (!gesehen.Add(typ + Convert.ToString(e["id"]))) continue;
            var tags = e.ContainsKey("tags") ? (Dictionary<string, object>)e["tags"] : null;
            int art = Art(tags); if (art < 0) continue;
            var ringe = new List<List<P>>();
            if (typ == "way")
            {
                var pts = Punkte(e.ContainsKey("geometry") ? e["geometry"] : null);
                if (pts.Count < 4 || !Gleich(pts[0], pts[pts.Count - 1])) continue;
                ringe.Add(Bereinige(pts));
            }
            else if (typ == "relation")
            {
                var seg = new List<List<P>>();
                foreach (var mo in (object[])e["members"])
                {
                    var m = (Dictionary<string, object>)mo;
                    if ((string)m["type"] != "way" || !m.ContainsKey("geometry")) continue;
                    string rolle = m.ContainsKey("role") ? (string)m["role"] : "";
                    if (rolle == "inner") continue;
                    var pts = Punkte(m["geometry"]); if (pts.Count >= 2) seg.Add(pts);
                }
                foreach (var r in Verbinde(seg)) ringe.Add(Bereinige(r));
            }
            foreach (var r in ringe)
            {
                if (r.Count < 3) continue;
                double f = FlaecheQm(r); if (f < MinQm[art]) continue;
                var sb = new StringBuilder(); sb.Append('[').Append(art); Folge(sb, VereinfacheRing(r, 2)); sb.Append(']');
                zeilen.Add(sb.ToString()); anzahl[art]++; qm[art] += f;
            }
        }
        var o = new StringBuilder();
        o.Append("// Oeffentlich nutzbare Gruenflaechen im Stadtgebiet (c) OpenStreetMap-Mitwirkende, ODbL. Erzeugt mit Datenpflege\\27_Gruenversorgung_aktualisieren.ps1\n");
        o.Append("// f = [Art (0 Park/Gruen, 1 Spielplatz, 2 Wald), Breite, Laenge, Delta, Delta, ...] (nur Aussenkante, Millionstel Grad)\n");
        o.Append("var GRUENVERSORGUNG_DATEN = {\"stand\":\"" + stand + "\",\"einheit\":1e-6,\"f\":[" + string.Join(",", zeilen.ToArray()) + "]};\n");
        File.WriteAllText(ausgabe, o.ToString(), new UTF8Encoding(false));
        return string.Format("Park/Gruen: {0} ({1} ha) | Spielplaetze: {2} ({3} ha) | Wald: {4} ({5} ha)", anzahl[0], (int)(qm[0] / 10000), anzahl[1], (int)(qm[1] / 10000), anzahl[2], (int)(qm[2] / 10000));
    }
}
'@

Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition $code -Language CSharp
$meldung = [GruenWandler]::Umwandeln($temp, $Ausgabe, $Stand)
Remove-Item $temp -ErrorAction SilentlyContinue
$meldung
Write-Host ("Fertig: in {0} geschrieben ({1} KB)." -f $Ausgabe, [int]((Get-Item $Ausgabe).Length / 1024))
