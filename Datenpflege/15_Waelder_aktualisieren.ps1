# Holt alle Waelder (landuse=forest, natural=wood) im Stadtgebiet von OpenStreetMap und schreibt sie in die Datei
# Standortanalyse\staedte\<Stadt>\waelder.js (Waelder der 3D-Ansicht, dort als Baumbloecke).
#
# Das Herunterladen dauert einige Minuten (16 Kacheln). Der Zwischenordner "rohdaten_waelder" wird am Ende geloescht.
# Bei einem Abbruch einfach noch einmal starten: schon geladene Kacheln werden uebernommen.

param(
  [string]$Stadt = 'oldenburg',
  [string]$Zielordner = (Join-Path $PSScriptRoot "rohdaten_waelder_$Stadt"),
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\waelder.js"),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [int]$Anzahl = 4,
  [switch]$Behalten
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force $Zielordner | Out-Null
$log = Join-Path $Zielordner '_log.txt'
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8

$sued = $StadtInfo.Sued; $nord = $StadtInfo.Nord; $west = $StadtInfo.West; $ost = $StadtInfo.Ost
$dLat = ($nord - $sued) / $Anzahl
$dLon = ($ost - $west) / $Anzahl
$dienst = 'https://overpass.openstreetmap.fr/api/interpreter'
$kennung = 'Standortanalyse-Studienprojekt/1.0'

for ($i = 0; $i -lt $Anzahl; $i++) {
  for ($j = 0; $j -lt $Anzahl; $j++) {
    $s = [Math]::Round($sued + $i * $dLat, 5); $n = [Math]::Round($sued + ($i + 1) * $dLat, 5)
    $w = [Math]::Round($west + $j * $dLon, 5); $o = [Math]::Round($west + ($j + 1) * $dLon, 5)
    $ziel = Join-Path $Zielordner ("teil_{0}_{1}.json" -f $i, $j)
    if ((Test-Path $ziel) -and ((Get-Item $ziel).Length -gt 500)) { continue }
    $b = "($s,$w,$n,$o)"
    $q = "[out:json][timeout:240][maxsize:1073741824];(" +
         "way[""landuse""=""forest""]$b;relation[""landuse""=""forest""]$b;" +
         "way[""natural""=""wood""]$b;relation[""natural""=""wood""]$b;" +
         ");out geom qt;"
    $ok = $false
    for ($versuch = 1; $versuch -le 4 -and -not $ok; $versuch++) {
      try {
        $r = Invoke-WebRequest -Uri $dienst -Method Post -Body ("data=" + [uri]::EscapeDataString($q)) `
             -ContentType 'application/x-www-form-urlencoded' -Headers @{ Accept = '*/*' } -UseBasicParsing -UserAgent $kennung -TimeoutSec 300
        $bytes = $r.RawContentStream.ToArray()
        $anfang = [System.Text.Encoding]::UTF8.GetString($bytes, 0, [Math]::Min(300, $bytes.Length))
        if ($anfang -notmatch '"elements"') { throw "unbrauchbare Antwort" }
        [System.IO.File]::WriteAllBytes($ziel, $bytes)
        $ok = $true
      } catch {
        "teil_${i}_${j}: Versuch $versuch fehlgeschlagen: " + $_.Exception.Message | Add-Content $log
        Start-Sleep -Seconds (10 * $versuch)
      }
    }
    if (-not $ok) { Write-Host "Kachel $i/$j konnte nicht geladen werden. Bitte spaeter noch einmal starten."; exit 1 }
    Start-Sleep -Seconds 4
  }
}

$code = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

public static class WaldWandler
{
    struct P { public long a, b; public P(long a, long b) { this.a = a; this.b = b; } }
    static double D(object o) { return Convert.ToDouble(o, System.Globalization.CultureInfo.InvariantCulture); }
    static bool Gleich(P x, P y) { return x.a == y.a && x.b == y.b; }
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
        double px = p.b * 0.6, py = p.a, ax = a.b * 0.6, ay = a.a, bx = b.b * 0.6, by = b.a, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
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
    static bool Innen(List<P> ring, P pt)
    {
        bool c = false;
        for (int i = 0, j = ring.Count - 1; i < ring.Count; j = i++)
        {
            var a = ring[i]; var b = ring[j];
            if (((a.a > pt.a) != (b.a > pt.a)) && ((double)pt.b < (double)(b.b - a.b) * (pt.a - a.a) / (double)(b.a - a.a) + a.b)) c = !c;
        }
        return c;
    }
    static void Folge(StringBuilder sb, List<P> pts)
    {
        long la = 0, lo = 0;
        for (int i = 0; i < pts.Count; i++)
        {
            var p = pts[i]; if (i > 0) sb.Append(',');
            if (i == 0) sb.Append(p.a).Append(',').Append(p.b); else sb.Append(p.a - la).Append(',').Append(p.b - lo);
            la = p.a; lo = p.b;
        }
    }
    static void SchreibeFlaeche(StringBuilder sb, List<List<P>> ringe)
    {
        sb.Append('[');
        for (int k = 0; k < ringe.Count; k++) { if (k > 0) sb.Append(','); sb.Append('['); Folge(sb, ringe[k]); sb.Append(']'); }
        sb.Append("],\n");
    }
    static string Tag(Dictionary<string, object> tags, string key) { return (tags == null || !tags.ContainsKey(key)) ? "" : Convert.ToString(tags[key]); }

    public static string Umwandeln(string[] dateien, string ausgabe, string stand)
    {
        var ser = new JavaScriptSerializer(); ser.MaxJsonLength = int.MaxValue; ser.RecursionLimit = 200;
        var gesehen = new HashSet<string>(); var sb = new StringBuilder(); int anzahl = 0, uebersprungen = 0;
        foreach (var datei in dateien)
        {
            var wurzel = (Dictionary<string, object>)ser.DeserializeObject(File.ReadAllText(datei, Encoding.UTF8));
            foreach (var eo in (object[])wurzel["elements"])
            {
                var e = (Dictionary<string, object>)eo; string typ = (string)e["type"];
                if (!gesehen.Add(typ + Convert.ToString(e["id"]))) continue;
                var ringe = new List<List<List<P>>>();
                if (typ == "way")
                {
                    var pts = Punkte(e.ContainsKey("geometry") ? e["geometry"] : null);
                    if (pts.Count < 4 || !Gleich(pts[0], pts[pts.Count - 1])) { uebersprungen++; continue; }
                    var r = Bereinige(pts);
                    if (r.Count < 3 || FlaecheQm(r) < 200) { uebersprungen++; continue; }
                    ringe.Add(new List<List<P>> { VereinfacheRing(r, 8) });
                }
                else if (typ == "relation")
                {
                    var aussenSeg = new List<List<P>>(); var innenSeg = new List<List<P>>();
                    foreach (var mo in (object[])e["members"])
                    {
                        var m = (Dictionary<string, object>)mo;
                        if ((string)m["type"] != "way" || !m.ContainsKey("geometry")) continue;
                        var pts = Punkte(m["geometry"]); if (pts.Count < 2) continue;
                        string rolle = m.ContainsKey("role") ? (string)m["role"] : "";
                        if (rolle == "inner") innenSeg.Add(pts); else if (rolle == "outer" || rolle == "") aussenSeg.Add(pts);
                    }
                    var aussen = Verbinde(aussenSeg).ConvertAll(x => Bereinige(x));
                    var innen = Verbinde(innenSeg).ConvertAll(x => Bereinige(x));
                    aussen.RemoveAll(x => x.Count < 3 || FlaecheQm(x) < 200); innen.RemoveAll(x => x.Count < 3 || FlaecheQm(x) < 200);
                    if (aussen.Count == 0) { uebersprungen++; continue; }
                    foreach (var a in aussen)
                    {
                        var fl = new List<List<P>> { VereinfacheRing(a, 8) };
                        foreach (var h in innen) { if (aussen.Count == 1 || Innen(a, h[0])) fl.Add(VereinfacheRing(h, 8)); }
                        ringe.Add(fl);
                    }
                }
                foreach (var fl in ringe) { SchreibeFlaeche(sb, fl); anzahl++; }
            }
        }
        var o = new StringBuilder();
        o.Append("// Waelder im Stadtgebiet (landuse=forest, natural=wood) fuer die 3D-Ansicht\n");
        o.Append("// Daten: (c) OpenStreetMap-Mitwirkende, Lizenz ODbL (https://www.openstreetmap.org/copyright). Stand: " + stand + "\n");
        o.Append("// Format: Flaeche = Liste von Ringen (erster Ring = Aussenkante, weitere = Lichtungen), Ring = [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad.\n");
        o.Append("var WAELDER_DATEN = { einheit: 1e-6, stand: \"" + stand + "\", wald: [\n").Append(sb).Append("]};\n");
        File.WriteAllText(ausgabe, o.ToString(), new UTF8Encoding(false));
        return string.Format("Waelder: {0} Flaechen, uebersprungen: {1}", anzahl, uebersprungen);
    }
}
'@
Add-Type -ReferencedAssemblies 'System.Web.Extensions' -TypeDefinition $code -Language CSharp
$dateien = Get-ChildItem $Zielordner -Filter 'teil_*.json' | ForEach-Object { $_.FullName }
[WaldWandler]::Umwandeln($dateien, $Ausgabe, $Stand)
Write-Host ("Fertig: {0} KB in {1}" -f [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
if (-not $Behalten) { Remove-Item -Recurse -Force $Zielordner -Confirm:$false }
