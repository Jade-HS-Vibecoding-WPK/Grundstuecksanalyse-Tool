# Holt die Gelaendehoehen fuer das Stadtgebiet und schreibt sie in die Ordner Standortanalyse\staedte\<Stadt>\gelaende (Kacheln von 2,5 x 2,5 km)
# (Gelaende der 3D-Ansicht).
#
# Quelle: Landesamt fuer Geoinformation und Landesvermessung Niedersachsen (LGLN), Digitales Gelaendemodell 1 m (DGM1), Open Data,
# Lizenz CC BY 4.0. Das DGM1 liegt in Kacheln von 1 x 1 km vor (je ca. 3,4 MB, zusammen mehr als 1 GB). Dieses Programm liest aus jeder
# Kachel nur die grobe Fassung ("Uebersicht" mit 2 m Raster, ca. 0,5 bis 0,8 MB) per Teilabruf, rechnet auf ein 5-m-Raster um und
# fasst alles zu einer Datei fuer die ganze Stadt zusammen (Hoehen in Dezimetern, Zeile fuer Zeile als Differenzen, gepackt).
# Insgesamt werden etwa 250 MB uebertragen, nichts wird auf der Festplatte gesammelt. Mit -MaxMinuten wird abgebrochen,
# wenn es zu lange dauert; nach einem Abbruch einfach noch einmal starten.

param(
  [string]$Stadt = 'oldenburg',
  [string]$Ausgabe = (Join-Path $PSScriptRoot "..\Standortanalyse\staedte\$Stadt\gelaende"),   # Ordner mit den Kacheln
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [int]$MaxMinuten = 25,
  [int]$Parallel = 6,
  [int]$Hoechstens = 0            # nur zum Testen: nur so viele Kacheln lesen (0 = alle)
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); . (Join-Path $PSScriptRoot 'kacheln.ps1'); $StadtInfo = Hole-Stadt $Stadt

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::DefaultConnectionLimit = 32
$kennung = 'Standortanalyse-Studienprojekt/1.0'

# ---- 1) Kachelliste (neueste Befliegung je Kachel) ----
Write-Host 'Hole die Kachelliste des Landes ...'
$bb = [string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0},{1},{2},{3}', $StadtInfo.West, $StadtInfo.Sued, $StadtInfo.Ost, $StadtInfo.Nord)
$suche = 'https://dgm.stac.lgln.niedersachsen.de/search?collections=dgm1&bbox=' + $bb + '&limit=1000'
$antwort = Invoke-RestMethod -Uri $suche -UserAgent $kennung -TimeoutSec 180
$beste = @{}
foreach ($f in $antwort.features) {
  if ($f.id -match '^dgm1_32_(\d+)_(\d+)_1_ni_(\d+)') {
    $schl = $Matches[1] + '_' + $Matches[2]; $jahr = [int]$Matches[3]
    $a = $f.assets.'dgm1-tif'
    if ($a -and (-not $beste.ContainsKey($schl) -or $beste[$schl].Jahr -lt $jahr)) { $beste[$schl] = [pscustomobject]@{ Jahr = $jahr; Adresse = $a.href; E = [int]$Matches[1]; N = [int]$Matches[2] } }
  }
}
$liste = @($beste.Values | Sort-Object E, N)
Write-Host ("{0} Kacheln (neueste Befliegung je Kachel)." -f $liste.Count)
if ($liste.Count -eq 0) { throw 'Keine Kacheln gefunden.' }
if ($Hoechstens -gt 0) { $liste = @($liste | Select-Object -First $Hoechstens) }

$gelaendeCode = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public class GelaendeWerkzeug
{
    static byte[] Bereich(string url, long von, long bis)
    {
        for (int v = 1; v <= 4; v++)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "Standortanalyse-Studienprojekt/1.0"; req.Timeout = 120000; req.ReadWriteTimeout = 120000;
                req.AddRange(von, bis);
                using (var resp = req.GetResponse())
                using (var s = resp.GetResponseStream())
                using (var ms = new MemoryStream()) { s.CopyTo(ms); return ms.ToArray(); }
            }
            catch (Exception) { if (v == 4) throw; Thread.Sleep(2000 * v); }
        }
        return null;
    }

    // TIFF-LZW (MSB zuerst, "early change")
    static byte[] Lzw(byte[] ein, int erwartet)
    {
        var aus = new byte[erwartet]; int ap = 0;
        var tabelle = new byte[4096][]; for (int i = 0; i < 256; i++) tabelle[i] = new byte[] { (byte)i };
        int naechster = 258, bits = 9, puffer = 0, anzahl = 0, ep = 0; byte[] alt = null;
        while (ap < erwartet)
        {
            while (anzahl < bits) { if (ep >= ein.Length) return aus; puffer = (puffer << 8) | ein[ep++]; anzahl += 8; }
            int code = (puffer >> (anzahl - bits)) & ((1 << bits) - 1); anzahl -= bits; puffer &= (1 << anzahl) - 1;
            if (code == 257) break;
            if (code == 256) { naechster = 258; bits = 9; alt = null; continue; }
            byte[] eintrag;
            if (code < naechster && tabelle[code] != null) eintrag = tabelle[code];
            else if (alt != null) { eintrag = new byte[alt.Length + 1]; Array.Copy(alt, eintrag, alt.Length); eintrag[alt.Length] = alt[0]; }
            else return aus;
            int n = Math.Min(eintrag.Length, erwartet - ap); Array.Copy(eintrag, 0, aus, ap, n); ap += n;
            if (alt != null && naechster < 4096) { var neu = new byte[alt.Length + 1]; Array.Copy(alt, neu, alt.Length); neu[alt.Length] = eintrag[0]; tabelle[naechster++] = neu; }
            if (naechster + 1 >= 4096) bits = 12; else if (naechster + 1 >= 2048) bits = 12; else if (naechster + 1 >= 1024) bits = 11; else if (naechster + 1 >= 512) bits = 10; else bits = 9;
            alt = eintrag;
        }
        return aus;
    }

    class Ifd { public long Breite, Hoehe, Kachel; public long[] Offsets, Zaehler; public double[] Skala, Punkt; }

    static long Wert(byte[] b, int typ, int pos) { return typ == 3 ? BitConverter.ToUInt16(b, pos) : (typ == 4 ? BitConverter.ToUInt32(b, pos) : b[pos]); }

    static List<Ifd> LiesIfds(byte[] b)
    {
        var liste = new List<Ifd>(); long off = BitConverter.ToUInt32(b, 4); int n = 0;
        while (off > 0 && off + 2 < b.Length && n < 6)
        {
            int cnt = BitConverter.ToUInt16(b, (int)off); int p = (int)off + 2; var d = new Ifd();
            for (int i = 0; i < cnt; i++)
            {
                int e = p + i * 12; int tag = BitConverter.ToUInt16(b, e), typ = BitConverter.ToUInt16(b, e + 2); long c = BitConverter.ToUInt32(b, e + 4);
                int vp = e + 8; long grosse = (typ == 3 ? 2 : (typ == 12 ? 8 : 4)) * c;
                if (grosse > 4) vp = (int)BitConverter.ToUInt32(b, e + 8);
                if (tag == 256) d.Breite = Wert(b, typ, e + 8); else if (tag == 257) d.Hoehe = Wert(b, typ, e + 8); else if (tag == 322) d.Kachel = Wert(b, typ, e + 8);
                else if (tag == 324 || tag == 325)
                {
                    var arr = new long[c]; for (int k = 0; k < c; k++) arr[k] = typ == 3 ? BitConverter.ToUInt16(b, vp + 2 * k) : BitConverter.ToUInt32(b, vp + 4 * k);
                    if (tag == 324) d.Offsets = arr; else d.Zaehler = arr;
                }
                else if (tag == 33550) { d.Skala = new double[3]; for (int k = 0; k < 3; k++) d.Skala[k] = BitConverter.ToDouble(b, vp + 8 * k); }
                else if (tag == 33922) { d.Punkt = new double[6]; for (int k = 0; k < 6; k++) d.Punkt[k] = BitConverter.ToDouble(b, vp + 8 * k); }
            }
            liste.Add(d);
            off = BitConverter.ToUInt32(b, p + cnt * 12); n++;
        }
        return liste;
    }

    public static bool Rechne(string[] urls, int[] ekm, int[] nkm, double schritt, int maxMinuten, int parallel, string ordner, string stand, string dateikopf, out string meldung)
    {
        int eMin = int.MaxValue, eMax = int.MinValue, nMin = int.MaxValue, nMax = int.MinValue;
        for (int i = 0; i < urls.Length; i++) { eMin = Math.Min(eMin, ekm[i]); eMax = Math.Max(eMax, ekm[i]); nMin = Math.Min(nMin, nkm[i]); nMax = Math.Max(nMax, nkm[i]); }
        double e0 = eMin * 1000.0, n0 = nMin * 1000.0, n1 = (nMax + 1) * 1000.0;       // Kachelname = unterer linker Eckpunkt in km
        int W = (int)Math.Round(((eMax + 1) * 1000.0 - e0) / schritt), H = (int)Math.Round((n1 - n0) / schritt);
        var gitter = new short[(long)W * H]; for (long i = 0; i < gitter.LongLength; i++) gitter[i] = short.MinValue;
        int fertig = 0, fehler = 0; var sw = System.Diagnostics.Stopwatch.StartNew(); bool abbruch = false; object sperre = new object();
        string fehlertext = "";
        Parallel.For(0, urls.Length, new ParallelOptions { MaxDegreeOfParallelism = parallel }, delegate (int ix)
        {
            if (abbruch) return;
            if (sw.Elapsed.TotalMinutes > maxMinuten) { abbruch = true; return; }
            try
            {
                var kopf = Bereich(urls[ix], 0, 49151);
                var ifds = LiesIfds(kopf);
                Ifd ue = null, voll = ifds[0];
                foreach (var d in ifds) if (d.Breite >= 200 && d.Breite < voll.Breite && (ue == null || d.Breite > ue.Breite)) ue = d;
                if (ue == null) { ue = voll; }
                if (ue.Offsets == null || ue.Offsets.Length != 1) throw new Exception("Uebersicht nicht in einem Stueck: " + urls[ix]);
                double pixel = voll.Skala[0] * voll.Breite / ue.Breite;            // Pixelgroesse der Uebersicht in m
                double x0 = voll.Punkt[3], y0 = voll.Punkt[4];                       // oberer linker Eckpunkt
                var roh = Bereich(urls[ix], ue.Offsets[0], ue.Offsets[0] + ue.Zaehler[0] - 1);
                int tb = (int)ue.Kachel; var bytes = Lzw(roh, tb * tb * 4);
                var f = new float[tb * tb]; Buffer.BlockCopy(bytes, 0, f, 0, bytes.Length);
                int bw = (int)ue.Breite, bh = (int)ue.Hoehe;
                // Zellen dieser Kachel im Gesamtgitter
                int ci0 = (int)Math.Floor((x0 - e0) / schritt), cj0 = (int)Math.Floor((n1 - y0) / schritt);
                int cn = (int)Math.Round(voll.Breite * voll.Skala[0] / schritt);
                for (int cj = 0; cj < cn; cj++)
                {
                    for (int ci = 0; ci < cn; ci++)
                    {
                        double E = x0 + (ci + 0.5) * schritt, N = y0 - (cj + 0.5) * schritt;
                        double px = (E - x0) / pixel - 0.5, py = (y0 - N) / pixel - 0.5;
                        int ix0 = (int)Math.Floor(px), iy0 = (int)Math.Floor(py); double fx = px - ix0, fy = py - iy0;
                        double s = 0, gw = 0;
                        for (int dy = 0; dy <= 1; dy++) for (int dx = 0; dx <= 1; dx++)
                        {
                            int xx = Math.Max(0, Math.Min(bw - 1, ix0 + dx)), yy = Math.Max(0, Math.Min(bh - 1, iy0 + dy));
                            float v = f[yy * tb + xx]; if (v < -1000f || float.IsNaN(v)) continue;
                            double w = (dx == 0 ? 1 - fx : fx) * (dy == 0 ? 1 - fy : fy); s += v * w; gw += w;
                        }
                        if (gw < 0.5) continue;
                        int gi = ci0 + ci, gj = cj0 + cj; if (gi < 0 || gi >= W || gj < 0 || gj >= H) continue;
                        gitter[(long)gj * W + gi] = (short)Math.Round(s / gw * 10.0);
                    }
                }
                lock (sperre) { fertig++; if (fertig % 20 == 0) Console.WriteLine("  " + fertig + " von " + urls.Length + " Kacheln, " + (int)sw.Elapsed.TotalSeconds + " s"); }
            }
            catch (Exception ex) { lock (sperre) { fehler++; fehlertext = ex.Message; } }
        });
        meldung = fertig + " Kacheln gelesen, " + fehler + " Fehler" + (fehler > 0 ? " (" + fehlertext + ")" : "") + (abbruch ? ", ABGEBROCHEN (Zeitgrenze)" : "") + ", " + (int)sw.Elapsed.TotalSeconds + " s";
        if (abbruch || fehler > 0) return false;
        meldung += "; " + KachelWerkzeug.GelaendeSchreiben(gitter, W, H, e0, n1, schritt, ordner, stand, 500, dateikopf);
        return true;
    }
}
'@
Add-Type -ReferencedAssemblies 'System.Net', 'System.Core' -TypeDefinition ($gelaendeCode + $KachelQuelle)

$urls = [string[]]($liste | ForEach-Object { $_.Adresse })
$ekm = [int[]]($liste | ForEach-Object { $_.E })
$nkm = [int[]]($liste | ForEach-Object { $_.N })
Write-Host ("Lese {0} Kacheln (Teilabrufe, {1} gleichzeitig, hoechstens {2} Minuten) ..." -f $urls.Length, $Parallel, $MaxMinuten)
$meldung = ''
Loesche-KachelOrdner $Ausgabe
$kopf = '// Gelaendehoehen der Stadt ' + $StadtInfo.Ascii + ': LGLN, Digitales Gelaendemodell 1 m (DGM1), Open Data, Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.de). Erzeugt mit Datenpflege\22_Gelaende_aktualisieren.ps1.' + "`n" +
        '// Raster in UTM32 (ETRS89): e0 = Rechtswert der linken Kante, n1 = Hochwert der oberen Kante, schritt in m (Zellmitten), Zeilen von Norden nach Sueden. Kacheln: Bloecke von "kachel" x "kachel" Zellen, Name = Spalte_Zeile des Blocks.' + "`n" +
        '// Jede Kachel = Base64 von "deflate-raw" ueber 16-Bit-Werte (kleinstes Byte zuerst): Hoehe in Dezimetern ueber NHN, je Zeile als Differenz zum linken Nachbarn.'
$ok = [GelaendeWerkzeug]::Rechne($urls, $ekm, $nkm, 5.0, $MaxMinuten, $Parallel, $Ausgabe, $Stand, $kopf, [ref]$meldung)
Write-Host $meldung
if (-not $ok) { Write-Host 'Es wurde nichts (vollstaendig) geschrieben. Bitte noch einmal starten (mit -MaxMinuten mehr Zeit erlauben).'; exit 1 }
Write-Host ("Fertig: Kacheln in {0}" -f $Ausgabe)
