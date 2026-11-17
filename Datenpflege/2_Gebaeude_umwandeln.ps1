param(
  [string[]]$Dateien = (Get-ChildItem (Join-Path $PSScriptRoot 'rohdaten') -Filter 'teil_*.json' | ForEach-Object { $_.FullName }),
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\gebaeude_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd')
)

$code = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class GebaeudeWandler
{
    struct P { public long a, b; public P(long a, long b) { this.a = a; this.b = b; } }

    static double D(object o) { return Convert.ToDouble(o, System.Globalization.CultureInfo.InvariantCulture); }
    static bool Gleich(P x, P y) { return x.a == y.a && x.b == y.b; }

    // Punkte aus der Antwort lesen, auf Millionstel Grad runden (ca. 0,1 m)
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

    // Doppelte Nachbarpunkte und den schließenden Endpunkt entfernen
    static List<P> Bereinige(List<P> r)
    {
        var o = new List<P>();
        foreach (var p in r) { if (o.Count == 0 || !Gleich(o[o.Count - 1], p)) o.Add(p); }
        if (o.Count > 1 && Gleich(o[0], o[o.Count - 1])) o.RemoveAt(o.Count - 1);
        return o;
    }

    // Fläche in Quadratmetern (grob, für Filter): 1 Mikrograd = 0,111 m Breite, 0,0669 m Länge bei 53 Grad Nord
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

    // Zerstückelte Wege zu geschlossenen Ringen zusammensetzen
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

    static void Schreibe(StringBuilder sb, List<List<P>> ringe)
    {
        sb.Append('[');
        for (int k = 0; k < ringe.Count; k++)
        {
            if (k > 0) sb.Append(',');
            sb.Append('[');
            long la = 0, lo = 0;
            for (int i = 0; i < ringe[k].Count; i++)
            {
                var p = ringe[k][i];
                if (i == 0) sb.Append(p.a).Append(',').Append(p.b);
                else sb.Append(',').Append(p.a - la).Append(',').Append(p.b - lo);
                la = p.a; lo = p.b;
            }
            sb.Append(']');
        }
        sb.Append("],\n");
    }

    public static string Umwandeln(string[] dateien, string ausgabe, string stand)
    {
        var ser = new JavaScriptSerializer();
        ser.MaxJsonLength = int.MaxValue;
        ser.RecursionLimit = 200;

        var gesehen = new HashSet<string>();
        var sb = new StringBuilder();
        int anzahl = 0, wege = 0, relationen = 0, ungeschlossen = 0, zuKlein = 0, doppelt = 0, relOhneRing = 0, innenHoefe = 0;

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

                if (typ == "way")
                {
                    wege++;
                    var pts = Punkte(e.ContainsKey("geometry") ? e["geometry"] : null);
                    if (pts.Count < 4 || !Gleich(pts[0], pts[pts.Count - 1])) { ungeschlossen++; continue; }
                    var r = Bereinige(pts);
                    if (r.Count < 3 || FlaecheQm(r) < 2) { zuKlein++; continue; }
                    Schreibe(sb, new List<List<P>> { r });
                    anzahl++;
                }
                else if (typ == "relation")
                {
                    relationen++;
                    var aussenSeg = new List<List<P>>();
                    var innenSeg = new List<List<P>>();
                    foreach (var mo in (object[])e["members"])
                    {
                        var m = (Dictionary<string, object>)mo;
                        if ((string)m["type"] != "way" || !m.ContainsKey("geometry")) continue;
                        var pts = Punkte(m["geometry"]);
                        if (pts.Count < 2) continue;
                        string rolle = m.ContainsKey("role") ? (string)m["role"] : "";
                        if (rolle == "inner") innenSeg.Add(pts);
                        else if (rolle == "outer" || rolle == "") aussenSeg.Add(pts);
                    }
                    var aussen = Verbinde(aussenSeg).ConvertAll(x => Bereinige(x));
                    var innen = Verbinde(innenSeg).ConvertAll(x => Bereinige(x));
                    aussen.RemoveAll(x => x.Count < 3 || FlaecheQm(x) < 2);
                    innen.RemoveAll(x => x.Count < 3);
                    if (aussen.Count == 0) { relOhneRing++; continue; }

                    foreach (var a in aussen)
                    {
                        var ringe = new List<List<P>> { a };
                        foreach (var h in innen)
                        {
                            // Innenhof gehört zum Außenring, der seinen ersten Punkt enthält (bei nur einem Außenring immer)
                            if (aussen.Count == 1 || Innen(a, h[0])) { ringe.Add(h); innenHoefe++; }
                        }
                        Schreibe(sb, ringe);
                        anzahl++;
                    }
                }
            }
        }

        var kopf = new StringBuilder();
        kopf.Append("// Gebäudeumrisse der Stadt Oldenburg (Oldb) und Umgebung\n");
        kopf.Append("// Daten: © OpenStreetMap-Mitwirkende, Lizenz ODbL (https://www.openstreetmap.org/copyright). Stand: " + stand + "\n");
        kopf.Append("// Format: Jedes Gebäude = Liste von Ringen (erster Ring = Außenkante, weitere = Innenhöfe).\n");
        kopf.Append("// Jeder Ring = [Breite, Länge, Δ Breite, Δ Länge, ...] in Millionstel Grad; ab dem zweiten Punkt als Abstand zum vorigen Punkt.\n");
        kopf.Append("var GEBAEUDE_OLDENBURG = { einheit: 1e-6, stand: \"" + stand + "\", anzahl: " + anzahl + ", gebaeude: [\n");
        File.WriteAllText(ausgabe, kopf.ToString() + sb.ToString() + "]};\n", new UTF8Encoding(false));

        return string.Format("Gebäude geschrieben: {0} | Wege: {1} (nicht geschlossen: {2}, zu klein: {3}) | Relationen: {4} (ohne Ring: {5}, Innenhöfe: {6}) | doppelt übersprungen: {7}",
            anzahl, wege, ungeschlossen, zuKlein, relationen, relOhneRing, innenHoefe, doppelt);
    }
}
'@

Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition $code -Language CSharp
$sw = [Diagnostics.Stopwatch]::StartNew()
$meldung = [GebaeudeWandler]::Umwandeln($Dateien, $Ausgabe, $Stand)
$meldung
"Dauer: {0} s, Datei: {1} KB" -f [int]$sw.Elapsed.TotalSeconds, [int]((Get-Item $Ausgabe).Length / 1024)
