param(
  [string[]]$Dateien = (Get-ChildItem (Join-Path $PSScriptRoot 'rohdaten_flaechen') -Filter 'teil_*.json' | ForEach-Object { $_.FullName }),
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\flaechen_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

# Wandelt die heruntergeladenen Flaechen (7_Flaechen_herunterladen.ps1) in die kompakte Datei
# Standortanalyse\flaechen_oldenburg.js um. Vier Gruppen: parks, wald, wasser, plaetze.

$code = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class FlaechenWandler
{
    struct P { public long a, b; public P(long a, long b) { this.a = a; this.b = b; } }

    static double D(object o) { return Convert.ToDouble(o, System.Globalization.CultureInfo.InvariantCulture); }
    static bool Gleich(P x, P y) { return x.a == y.a && x.b == y.b; }

    static string Tag(Dictionary<string, object> tags, string key)
    {
        if (tags == null || !tags.ContainsKey(key)) return "";
        return Convert.ToString(tags[key]);
    }

    static List<P> Punkte(object geom)
    {
        var l = new List<P>();
        var arr = geom as object[];
        if (arr == null) return l;
        foreach (var o in arr)
        {
            var d = (Dictionary<string, object>)o;
            l.Add(new P((long)Math.Round(D(d["lat"]) * 1e6), (long)Math.Round(D(d["lon"]) * 1e6)));
        }
        return l;
    }

    static List<P> OhneDoppelte(List<P> r)
    {
        var o = new List<P>();
        foreach (var p in r) { if (o.Count == 0 || !Gleich(o[o.Count - 1], p)) o.Add(p); }
        return o;
    }

    static List<P> Bereinige(List<P> r)
    {
        var o = OhneDoppelte(r);
        if (o.Count > 1 && Gleich(o[0], o[o.Count - 1])) o.RemoveAt(o.Count - 1);
        return o;
    }

    static double FlaecheQm(List<P> r)
    {
        double s = 0;
        for (int i = 0; i < r.Count; i++)
        {
            var p = r[i]; var q = r[(i + 1) % r.Count];
            s += (double)p.b * q.a - (double)q.b * p.a;
        }
        return Math.Abs(s) / 2 * 0.111 * 0.0669;
    }

    static double Abstand(P p, P a, P b)
    {
        double px = p.b * 0.6, py = p.a, ax = a.b * 0.6, ay = a.a, bx = b.b * 0.6, by = b.a;
        double dx = bx - ax, dy = by - ay;
        double l2 = dx * dx + dy * dy;
        if (l2 == 0) return Math.Sqrt((px - ax) * (px - ax) + (py - ay) * (py - ay));
        double t = ((px - ax) * dx + (py - ay) * dy) / l2;
        t = Math.Max(0, Math.Min(1, t));
        double cx = ax + t * dx, cy = ay + t * dy;
        return Math.Sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    }

    static List<P> Vereinfache(List<P> pts, double tol)
    {
        if (pts.Count < 3) return pts;
        var behalten = new bool[pts.Count];
        behalten[0] = true; behalten[pts.Count - 1] = true;
        var stapel = new Stack<int[]>();
        stapel.Push(new int[] { 0, pts.Count - 1 });
        while (stapel.Count > 0)
        {
            var seg = stapel.Pop();
            double maxD = 0; int idx = -1;
            for (int i = seg[0] + 1; i < seg[1]; i++)
            {
                double d = Abstand(pts[i], pts[seg[0]], pts[seg[1]]);
                if (d > maxD) { maxD = d; idx = i; }
            }
            if (idx >= 0 && maxD > tol)
            {
                behalten[idx] = true;
                stapel.Push(new int[] { seg[0], idx });
                stapel.Push(new int[] { idx, seg[1] });
            }
        }
        var o = new List<P>();
        for (int i = 0; i < pts.Count; i++) if (behalten[i]) o.Add(pts[i]);
        return o;
    }

    static List<P> VereinfacheRing(List<P> ring, double tol)
    {
        if (ring.Count < 5) return ring;
        var offen = new List<P>(ring); offen.Add(ring[0]);
        var v = Vereinfache(offen, tol);
        v.RemoveAt(v.Count - 1);
        return v.Count >= 3 ? v : ring;
    }

    static List<List<P>> Verbinde(List<List<P>> segmente)
    {
        var fertig = new List<List<P>>();
        var offen = new List<List<P>>(segmente);
        while (offen.Count > 0)
        {
            var ring = new List<P>(offen[0]);
            offen.RemoveAt(0);
            bool weiter = true;
            while (weiter && !Gleich(ring[0], ring[ring.Count - 1]))
            {
                weiter = false;
                for (int i = 0; i < offen.Count; i++)
                {
                    var s = offen[i];
                    var rueck = new List<P>(s); rueck.Reverse();
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

    static bool Innen(List<P> ring, P pt)
    {
        bool c = false;
        for (int i = 0, j = ring.Count - 1; i < ring.Count; j = i++)
        {
            var a = ring[i]; var b = ring[j];
            if (((a.a > pt.a) != (b.a > pt.a)) &&
                ((double)pt.b < (double)(b.b - a.b) * (pt.a - a.a) / (double)(b.a - a.a) + a.b)) c = !c;
        }
        return c;
    }

    static void Folge(StringBuilder sb, List<P> pts)
    {
        long la = 0, lo = 0;
        for (int i = 0; i < pts.Count; i++)
        {
            var p = pts[i];
            if (i > 0) sb.Append(',');
            if (i == 0) sb.Append(p.a).Append(',').Append(p.b);
            else sb.Append(p.a - la).Append(',').Append(p.b - lo);
            la = p.a; lo = p.b;
        }
    }

    static void SchreibeFlaeche(StringBuilder sb, List<List<P>> ringe)
    {
        sb.Append('[');
        for (int k = 0; k < ringe.Count; k++)
        {
            if (k > 0) sb.Append(',');
            sb.Append('['); Folge(sb, ringe[k]); sb.Append(']');
        }
        sb.Append("],\n");
    }

    // Gruppe einer Flaeche: 0 = Parks und Gruenflaechen, 1 = Wald und Gehoelz, 2 = Gewaesser, 3 = Plaetze und Freiraeume
    static int Gruppe(Dictionary<string, object> tags)
    {
        string landuse = Tag(tags, "landuse"), natural = Tag(tags, "natural");
        if (natural == "water" || landuse == "reservoir") return 2;
        if (Tag(tags, "place") == "square" || Tag(tags, "amenity") == "marketplace" ||
            (Tag(tags, "highway") == "pedestrian" && Tag(tags, "area") == "yes")) return 3;
        if (landuse == "forest" || natural == "wood" || natural == "scrub" || natural == "heath" || natural == "wetland") return 1;
        if (Tag(tags, "leisure") != "" || landuse != "" || natural == "grassland") return 0;
        return -1;
    }

    public static string Umwandeln(string[] dateien, string ausgabe, string stand)
    {
        var ser = new JavaScriptSerializer();
        ser.MaxJsonLength = int.MaxValue;
        ser.RecursionLimit = 200;

        var gesehen = new HashSet<string>();
        var sb = new StringBuilder[] { new StringBuilder(), new StringBuilder(), new StringBuilder(), new StringBuilder() };
        var anzahl = new int[4];
        int doppelt = 0, ohneRing = 0, uebersprungen = 0;

        foreach (var datei in dateien)
        {
            var wurzel = (Dictionary<string, object>)ser.DeserializeObject(File.ReadAllText(datei, Encoding.UTF8));
            var elemente = (object[])wurzel["elements"];
            foreach (var eo in elemente)
            {
                var e = (Dictionary<string, object>)eo;
                string typ = (string)e["type"];
                string schluessel = typ + Convert.ToString(e["id"]);
                if (!gesehen.Add(schluessel)) { doppelt++; continue; }
                var tags = e.ContainsKey("tags") ? (Dictionary<string, object>)e["tags"] : null;
                int gruppe = Gruppe(tags);
                if (gruppe < 0) { uebersprungen++; continue; }

                var ringe = new List<List<List<P>>>();   // Liste von Flaechen, jede = Liste von Ringen
                if (typ == "way")
                {
                    var pts = Punkte(e.ContainsKey("geometry") ? e["geometry"] : null);
                    if (pts.Count < 4 || !Gleich(pts[0], pts[pts.Count - 1])) { uebersprungen++; continue; }
                    var r = Bereinige(pts);
                    if (r.Count < 3 || FlaecheQm(r) < 20) { uebersprungen++; continue; }
                    ringe.Add(new List<List<P>> { VereinfacheRing(r, 3) });
                }
                else if (typ == "relation")
                {
                    var aussenSeg = new List<List<P>>(); var innenSeg = new List<List<P>>();
                    foreach (var mo in (object[])e["members"])
                    {
                        var m = (Dictionary<string, object>)mo;
                        if ((string)m["type"] != "way" || !m.ContainsKey("geometry")) continue;
                        var pts = Punkte(m["geometry"]);
                        if (pts.Count < 2) continue;
                        string rolle = m.ContainsKey("role") ? (string)m["role"] : "";
                        if (rolle == "inner") innenSeg.Add(pts); else if (rolle == "outer" || rolle == "") aussenSeg.Add(pts);
                    }
                    var aussen = Verbinde(aussenSeg).ConvertAll(x => Bereinige(x));
                    var innen = Verbinde(innenSeg).ConvertAll(x => Bereinige(x));
                    aussen.RemoveAll(x => x.Count < 3 || FlaecheQm(x) < 20);
                    innen.RemoveAll(x => x.Count < 3);
                    if (aussen.Count == 0) { ohneRing++; continue; }
                    foreach (var a in aussen)
                    {
                        var fl = new List<List<P>> { VereinfacheRing(a, 3) };
                        foreach (var h in innen) { if (aussen.Count == 1 || Innen(a, h[0])) fl.Add(VereinfacheRing(h, 3)); }
                        ringe.Add(fl);
                    }
                }
                else { continue; }

                foreach (var fl in ringe) { SchreibeFlaeche(sb[gruppe], fl); anzahl[gruppe]++; }
            }
        }

        var o = new StringBuilder();
        o.Append("// Flaechen in Oldenburg (Parks, Wald, Gewaesser, Plaetze) fuer die Ebenen der Analyse\n");
        o.Append("// Daten: (c) OpenStreetMap-Mitwirkende, Lizenz ODbL (https://www.openstreetmap.org/copyright). Stand: " + stand + "\n");
        o.Append("// Format: Flaeche = Liste von Ringen (erster Ring = Aussenkante, weitere = Innenhoefe), Ring = [Breite, Laenge, Delta, Delta, ...].\n");
        o.Append("// Alle Werte in Millionstel Grad; ab dem zweiten Punkt als Abstand zum vorigen.\n");
        o.Append("var FLAECHEN_OLDENBURG = { einheit: 1e-6, stand: \"" + stand + "\",\n");
        o.Append("parks: [\n").Append(sb[0]).Append("],\n");
        o.Append("wald: [\n").Append(sb[1]).Append("],\n");
        o.Append("wasser: [\n").Append(sb[2]).Append("],\n");
        o.Append("plaetze: [\n").Append(sb[3]).Append("]\n};\n");
        File.WriteAllText(ausgabe, o.ToString(), new UTF8Encoding(false));

        return string.Format("Parks/Gruen: {0} | Wald/Gehoelz: {1} | Wasser: {2} | Plaetze: {3} | Relationen ohne Ring: {4} | uebersprungen: {5} | doppelt: {6}",
            anzahl[0], anzahl[1], anzahl[2], anzahl[3], ohneRing, uebersprungen, doppelt);
    }
}
'@

Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition $code -Language CSharp
$sw = [Diagnostics.Stopwatch]::StartNew()
$meldung = [FlaechenWandler]::Umwandeln($Dateien, $Ausgabe, $Stand)
$meldung
"Dauer: {0} s, Datei: {1} KB" -f [int]$sw.Elapsed.TotalSeconds, [int]((Get-Item $Ausgabe).Length / 1024)
