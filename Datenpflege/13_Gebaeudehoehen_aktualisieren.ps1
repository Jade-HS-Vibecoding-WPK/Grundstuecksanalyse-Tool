# Holt die amtlichen 3D-Gebaeudemodelle (LoD2) des Landesamts fuer Geoinformation und Landesvermessung Niedersachsen (LGLN)
# fuer das Stadtgebiet Oldenburg und schreibt Grundriss und Hoehe jedes Gebaeudes in die Datei
# Standortanalyse\hoehen_oldenburg.js (3D-Ansicht der App).
#
# Quelle: LGLN, 3D-Gebaeudemodell LoD2, Open Data, Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.de).
# Quellenvermerk in der App: "Gebaeudehoehen: LGLN (Jahr), CC BY 4.0".
#
# Ablauf: 1) Aus den vorhandenen Gebaeudeumrissen (gebaeude_oldenburg.js) wird ermittelt, welche 1-x-1-km-Kacheln gebraucht werden.
#         2) Jede Kachel (ca. 1,7 MB, Shape-Datei als ZIP) wird heruntergeladen (zusammen etwa 300 MB, dauert einige Minuten).
#         3) Aus jeder Kachel werden Grundriss (Boden-Flaeche) und Hoehen (Traufe, First) der Gebaeude gelesen und in
#            Laengen-/Breitengrad umgerechnet.
# Der Zwischenordner "rohdaten_hoehen" wird am Ende geloescht. Bei einem Abbruch einfach noch einmal starten:
# schon geladene Kacheln werden uebernommen.

param(
  [string]$Zielordner = (Join-Path $PSScriptRoot 'rohdaten_hoehen'),
  [string]$Gebaeude = (Join-Path $PSScriptRoot '..\Standortanalyse\gebaeude_oldenburg.js'),
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\hoehen_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [int]$Hoechstens = 0,            # nur zum Testen: nur so viele Kacheln verarbeiten (0 = alle)
  [switch]$Behalten                # nur zum Testen: Zwischenordner nicht loeschen
)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force $Zielordner | Out-Null
$log = Join-Path $Zielordner '_log.txt'
"Start $(Get-Date -Format 'HH:mm:ss')" | Set-Content $log -Encoding UTF8
$kennung = 'Standortanalyse-Studienprojekt/1.0'

$quelle = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;

public static class LodWerkzeug
{
    const double A = 6378137.0;
    const double F = 1.0 / 298.257222101;
    const double K0 = 0.9996;

    static double N() { return F / (2.0 - F); }
    static double Aq() { double n = N(); return A / (1.0 + n) * (1.0 + n * n / 4.0 + Math.Pow(n, 4) / 64.0); }

    // Laengen-/Breitengrad (Grad) -> UTM Zone 32 (Rechtswert, Hochwert in Metern)
    public static void Vorwaerts(double breite, double laenge, out double ost, out double nord)
    {
        double n = N(), aq = Aq();
        double a1 = n / 2 - 2 * n * n / 3 + 5 * Math.Pow(n, 3) / 16 + 41 * Math.Pow(n, 4) / 180;
        double a2 = 13 * n * n / 48 - 3 * Math.Pow(n, 3) / 5 + 557 * Math.Pow(n, 4) / 1440;
        double a3 = 61 * Math.Pow(n, 3) / 240 - 103 * Math.Pow(n, 4) / 140;
        double a4 = 49561 * Math.Pow(n, 4) / 161280;
        double phi = breite * Math.PI / 180.0, dl = (laenge - 9.0) * Math.PI / 180.0;
        double q = 2 * Math.Sqrt(n) / (1 + n);
        double sp = Math.Sin(phi);
        double t = Math.Sinh(Atanh(sp) - q * Atanh(q * sp));
        double xi = Math.Atan2(t, Math.Cos(dl));
        double eta = Atanh(Math.Sin(dl) / Math.Sqrt(1 + t * t));
        ost = 500000.0 + K0 * aq * (eta + a1 * Math.Cos(2 * xi) * Math.Sinh(2 * eta) + a2 * Math.Cos(4 * xi) * Math.Sinh(4 * eta) + a3 * Math.Cos(6 * xi) * Math.Sinh(6 * eta) + a4 * Math.Cos(8 * xi) * Math.Sinh(8 * eta));
        nord = K0 * aq * (xi + a1 * Math.Sin(2 * xi) * Math.Cosh(2 * eta) + a2 * Math.Sin(4 * xi) * Math.Cosh(4 * eta) + a3 * Math.Sin(6 * xi) * Math.Cosh(6 * eta) + a4 * Math.Sin(8 * xi) * Math.Cosh(8 * eta));
    }

    // UTM Zone 32 (Meter) -> Breite, Laenge in Grad
    public static void Rueckwaerts(double ost, double nord, out double breite, out double laenge)
    {
        double n = N(), aq = Aq();
        double b1 = n / 2 - 2 * n * n / 3 + 37 * Math.Pow(n, 3) / 96 - Math.Pow(n, 4) / 360;
        double b2 = n * n / 48 + Math.Pow(n, 3) / 15 - 437 * Math.Pow(n, 4) / 1440;
        double b3 = 17 * Math.Pow(n, 3) / 480 - 37 * Math.Pow(n, 4) / 840;
        double b4 = 4397 * Math.Pow(n, 4) / 161280;
        double d1 = 2 * n - 2 * n * n / 3 - 2 * Math.Pow(n, 3) + 116 * Math.Pow(n, 4) / 45;
        double d2 = 7 * n * n / 3 - 8 * Math.Pow(n, 3) / 5 - 227 * Math.Pow(n, 4) / 45;
        double d3 = 56 * Math.Pow(n, 3) / 15 - 136 * Math.Pow(n, 4) / 35;
        double d4 = 4279 * Math.Pow(n, 4) / 630;
        double xi0 = nord / (K0 * aq), eta0 = (ost - 500000.0) / (K0 * aq);
        double xi = xi0 - (b1 * Math.Sin(2 * xi0) * Math.Cosh(2 * eta0) + b2 * Math.Sin(4 * xi0) * Math.Cosh(4 * eta0) + b3 * Math.Sin(6 * xi0) * Math.Cosh(6 * eta0) + b4 * Math.Sin(8 * xi0) * Math.Cosh(8 * eta0));
        double eta = eta0 - (b1 * Math.Cos(2 * xi0) * Math.Sinh(2 * eta0) + b2 * Math.Cos(4 * xi0) * Math.Sinh(4 * eta0) + b3 * Math.Cos(6 * xi0) * Math.Sinh(6 * eta0) + b4 * Math.Cos(8 * xi0) * Math.Sinh(8 * eta0));
        double chi = Math.Asin(Math.Sin(xi) / Math.Cosh(eta));
        double phi = chi + d1 * Math.Sin(2 * chi) + d2 * Math.Sin(4 * chi) + d3 * Math.Sin(6 * chi) + d4 * Math.Sin(8 * chi);
        double lam = Math.Atan2(Math.Sinh(eta), Math.Cos(xi));
        breite = phi * 180.0 / Math.PI;
        laenge = 9.0 + lam * 180.0 / Math.PI;
    }

    static double Atanh(double x) { return 0.5 * Math.Log((1 + x) / (1 - x)); }

    // Welche 1-km-Kacheln ("Ost_Nord" in km) werden von den Gebaeuden der Datei beruehrt?
    public static string[] Kacheln(string gebaeudeDatei)
    {
        HashSet<string> menge = new HashSet<string>();
        Regex re = new Regex(@"^\[\[(-?\d+),(-?\d+)");
        foreach (string zeile in File.ReadLines(gebaeudeDatei, Encoding.UTF8))
        {
            Match m = re.Match(zeile);
            if (!m.Success) continue;
            double b = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) * 1e-6;
            double l = double.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) * 1e-6;
            double o, nn;
            Vorwaerts(b, l, out o, out nn);
            menge.Add(((int)Math.Floor(o / 1000.0)).ToString() + "_" + ((int)Math.Floor(nn / 1000.0)).ToString());
        }
        string[] erg = new string[menge.Count];
        menge.CopyTo(erg);
        Array.Sort(erg);
        return erg;
    }

    static int BE32(byte[] b, int o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }

    static byte[] LiesEintrag(ZipArchive z, string endung)
    {
        foreach (ZipArchiveEntry e in z.Entries)
        {
            if (e.FullName.EndsWith(endung, StringComparison.OrdinalIgnoreCase))
            {
                using (Stream s = e.Open())
                using (MemoryStream ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }
        return null;
    }

    class Gebaeude
    {
        public double Trauf = double.NaN, First = double.NaN, Mess = double.NaN, MinZ = double.MaxValue;
        public int Rt = 0;                                    // Dachform laut Landesdaten (roofType)
        public double C2 = 0, S2 = 0, Vx = 0, Vy = 0, W = 0;  // Summen ueber die geneigten Dachflaechen (doppelter Winkel fuer die Firstachse, einfacher fuer die Neigungsrichtung)
        public List<double[]> Boden = new List<double[]>();   // Ringe: x,y,z,x,y,z,...
        public List<int> Art = new List<int>();               // Teiltyp des Rings
    }

    static double Zahl(byte[] db, int o, int len)
    {
        string t = Encoding.ASCII.GetString(db, o, len).Trim();
        double d;
        if (t.Length == 0) return double.NaN;
        if (double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
        return double.NaN;
    }

    // Liest eine Kachel (ZIP mit .shp und .dbf). Haengt je Gebaeude einen Eintrag an "aus" an. Gibt die Anzahl zurueck.
    public static int LiesKachel(string zipDatei, HashSet<string> gesehen, List<string> aus)
    {
        byte[] shp, dbf;
        using (ZipArchive z = ZipFile.OpenRead(zipDatei))
        {
            shp = LiesEintrag(z, ".shp");
            dbf = LiesEintrag(z, ".dbf");
        }
        if (shp == null || dbf == null) throw new Exception("shp/dbf fehlt in " + zipDatei);

        int n = BitConverter.ToInt32(dbf, 4);
        int kopf = BitConverter.ToInt16(dbf, 8);
        int satz = BitConverter.ToInt16(dbf, 10);
        int oGml = -1, lGml = 0, oTr = -1, lTr = 0, oFi = -1, lFi = 0, oMe = -1, lMe = 0, oRt = -1, lRt = 0;
        int off = 1;
        for (int p = 32; dbf[p] != 0x0D; p += 32)
        {
            string name = Encoding.ASCII.GetString(dbf, p, 11).TrimEnd((char)0);
            int len = dbf[p + 16];
            if (name == "gml_id") { oGml = off; lGml = len; }
            else if (name == "Traufhoehe") { oTr = off; lTr = len; }
            else if (name == "Firsthoehe") { oFi = off; lFi = len; }
            else if (name == "measHeight") { oMe = off; lMe = len; }
            else if (name == "roofType") { oRt = off; lRt = len; }
            off += len;
        }
        if (oGml < 0 || oTr < 0 || oFi < 0 || oMe < 0) throw new Exception("Felder fehlen in " + zipDatei);

        Dictionary<string, Gebaeude> alle = new Dictionary<string, Gebaeude>();
        List<string> reihenfolge = new List<string>();
        int pos = 100;
        for (int rec = 0; rec < n && pos + 8 <= shp.Length; rec++)
        {
            int laenge = BE32(shp, pos + 4);
            int c = pos + 8;
            pos = c + 2 * laenge;
            if (BitConverter.ToInt32(shp, c) != 31) continue;
            int np = BitConverter.ToInt32(shp, c + 36), npt = BitConverter.ToInt32(shp, c + 40);
            int po = c + 44, to = po + 4 * np, xo = to + 4 * np, zo = xo + 16 * npt + 16;
            int ro = kopf + rec * satz;
            string id = Encoding.ASCII.GetString(dbf, ro + oGml, lGml).Trim();
            Gebaeude g;
            if (!alle.TryGetValue(id, out g))
            {
                g = new Gebaeude();
                g.Trauf = Zahl(dbf, ro + oTr, lTr);
                g.First = Zahl(dbf, ro + oFi, lFi);
                g.Mess = Zahl(dbf, ro + oMe, lMe);
                if (oRt >= 0) { double rtz = Zahl(dbf, ro + oRt, lRt); g.Rt = double.IsNaN(rtz) ? 0 : (int)rtz; }
                alle[id] = g;
                reihenfolge.Add(id);
            }
            for (int i = 0; i < np; i++)
            {
                int a = BitConverter.ToInt32(shp, po + 4 * i);
                int e = (i + 1 < np) ? BitConverter.ToInt32(shp, po + 4 * (i + 1)) : npt;
                int art = BitConverter.ToInt32(shp, to + 4 * i);
                if (art < 2 || e - a < 4) { continue; }   // nur Ringe
                double[] ring = new double[(e - a) * 3];
                double zmin = double.MaxValue, zmax = double.MinValue;
                for (int k = a; k < e; k++)
                {
                    int j = (k - a) * 3;
                    ring[j] = BitConverter.ToDouble(shp, xo + 16 * k);
                    ring[j + 1] = BitConverter.ToDouble(shp, xo + 16 * k + 8);
                    double zz = BitConverter.ToDouble(shp, zo + 8 * k);
                    ring[j + 2] = zz;
                    if (zz < zmin) zmin = zz;
                    if (zz > zmax) zmax = zz;
                }
                if (zmin < g.MinZ) g.MinZ = zmin;
                if (zmax - zmin >= 0.03)
                {
                    // geneigte Flaeche? Dann Neigungsrichtung (Aspekt) aus der Flaechennormale (Newell) bestimmen
                    double nx = 0, ny = 0, nz = 0; int pn0 = ring.Length / 3;
                    for (int k = 0; k < pn0; k++)
                    {
                        int k2 = (k + 1) % pn0; double x1 = ring[k * 3], y1 = ring[k * 3 + 1], z1 = ring[k * 3 + 2], x2 = ring[k2 * 3], y2 = ring[k2 * 3 + 1], z2 = ring[k2 * 3 + 2];
                        nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2);
                    }
                    double nl = Math.Sqrt(nx * nx + ny * ny + nz * nz);
                    if (nl > 1e-6)
                    {
                        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
                        double uz = nz / nl, hl = Math.Sqrt(nx * nx + ny * ny);
                        if (uz >= 0.15 && uz < 0.985 && hl > 1e-9)
                        {
                            double w = nl / 2, th = Math.Atan2(nx, ny);          // Himmelsrichtung im Uhrzeigersinn von Norden
                            g.C2 += w * Math.Cos(2 * th); g.S2 += w * Math.Sin(2 * th); g.Vx += w * nx / hl; g.Vy += w * ny / hl; g.W += w;
                        }
                    }
                }
                if (zmax - zmin < 0.03) { g.Boden.Add(ring); g.Art.Add(art); }   // flache Ringe: Boden- oder Dachflaeche
            }
        }

        int neu = 0;
        CultureInfo ci = CultureInfo.InvariantCulture;
        foreach (string id in reihenfolge)
        {
            Gebaeude g = alle[id];
            if (gesehen.Contains(id)) continue;
            // Bodenringe: flach und auf der tiefsten Hoehe des Gebaeudes
            List<double[]> ringe = new List<double[]>();
            for (int i = 0; i < g.Boden.Count; i++)
            {
                double[] r = g.Boden[i];
                if (Math.Abs(r[2] - g.MinZ) > 0.05) continue;
                ringe.Add(r);
            }
            if (ringe.Count == 0) continue;
            double tr = g.Trauf, fi = g.First, me = g.Mess;
            if (double.IsNaN(me) || me <= 0) me = !double.IsNaN(fi) ? fi : 0;
            if (double.IsNaN(fi) || fi <= 0) fi = me;
            if (double.IsNaN(tr) || tr <= 0 || tr > fi) tr = fi;
            if (fi <= 0.5) continue;
            StringBuilder sb = new StringBuilder();
            // Dachklasse: 0 flach, 1 Satteldach, 2 Walmdach, 3 Zelt-/Pyramidendach, 4 Pultdach; Winkel: Firstrichtung (0 bis 179 Grad, von Norden im Uhrzeigersinn)
            // bzw. beim Pultdach die Richtung, in die das Dach nach unten geneigt ist (0 bis 359)
            int klasse = 0, winkel = 0;
            if (g.W > 0.5 && fi - tr >= 0.3)
            {
                switch (g.Rt)
                {
                    case 1000: klasse = 0; break;
                    case 3100: klasse = 1; break;
                    case 3200: case 3300: klasse = 2; break;
                    case 3500: case 4000: klasse = 3; break;
                    case 2100: klasse = 4; break;
                    default: klasse = 1; break;      // Mischformen, Mansard- und sonstige Daecher: als Satteldach angenaehert
                }
                if (klasse == 4) { double asp = Math.Atan2(g.Vx, g.Vy) * 180.0 / Math.PI; if (asp < 0) asp += 360; winkel = (int)Math.Round(asp) % 360; }
                else if (klasse > 0) { double ach = 0.5 * Math.Atan2(g.S2, g.C2) * 180.0 / Math.PI; double fz = ach + 90; fz = ((fz % 180) + 180) % 180; winkel = (int)Math.Round(fz) % 180; }
            }
            sb.Append('[').Append(((int)Math.Round(tr * 10)).ToString(ci)).Append(',').Append(((int)Math.Round(fi * 10)).ToString(ci)).Append(',').Append(klasse).Append(',').Append(winkel);
            foreach (double[] r in ringe)
            {
                sb.Append(",[");
                long la0 = 0, lo0 = 0; bool erster = true; int punkte = 0;
                int pn = r.Length / 3;
                // letzter Punkt = erster Punkt -> weglassen
                for (int k = 0; k < pn - 1; k++)
                {
                    double b, l;
                    Rueckwaerts(r[k * 3], r[k * 3 + 1], out b, out l);
                    long la = (long)Math.Round(b * 1e6), lo = (long)Math.Round(l * 1e6);
                    if (!erster && la == la0 && lo == lo0) continue;
                    if (erster) { sb.Append(la.ToString(ci)).Append(',').Append(lo.ToString(ci)); erster = false; }
                    else { sb.Append(',').Append((la - la0).ToString(ci)).Append(',').Append((lo - lo0).ToString(ci)); }
                    la0 = la; lo0 = lo; punkte++;
                }
                sb.Append(']');
            }
            sb.Append(']');
            gesehen.Add(id);
            aus.Add(sb.ToString());
            neu++;
        }
        return neu;
    }
}
'@
Add-Type -TypeDefinition $quelle -Language CSharp -ReferencedAssemblies 'System.IO.Compression', 'System.IO.Compression.FileSystem'

# ---- 1) Kacheln bestimmen ----
Write-Host 'Welche Kacheln werden gebraucht? ...'
$kacheln = [LodWerkzeug]::Kacheln((Resolve-Path $Gebaeude).Path)
Write-Host ("{0} Kacheln (je 1 x 1 km) beruehren Gebaeude." -f $kacheln.Count)
if ($kacheln.Count -eq 0) { Write-Host 'Keine Kacheln gefunden. Abbruch.'; exit 1 }

# Kachelliste des Landes holen (Adressen der ZIP-Dateien)
$suche = 'https://lod.stac.lgln.niedersachsen.de/search?collections=lod2&bbox=8.04,53.03,8.36,53.24&limit=1000'
$antwort = Invoke-RestMethod -Uri $suche -UserAgent $kennung -TimeoutSec 120
$adressen = @{}
foreach ($f in $antwort.features) {
  if ($f.id -match '^LoD2_32_(\d+)_(\d+)_') {
    $a = $f.assets.'lod2-shp'
    if ($a) { $adressen[$Matches[1] + '_' + $Matches[2]] = $a.href }
  }
}
$liste = @($kacheln | Where-Object { $adressen.ContainsKey($_) })
$fehlend = @($kacheln | Where-Object { -not $adressen.ContainsKey($_) })
if ($fehlend.Count -gt 0) { Write-Host ("Hinweis: fuer {0} Kacheln gibt es keine LoD2-Daten: {1}" -f $fehlend.Count, ($fehlend -join ', ')) }
if ($Hoechstens -gt 0) { $liste = @($liste | Select-Object -First $Hoechstens) }
Write-Host ("{0} Kacheln werden verarbeitet." -f $liste.Count)

# ---- 2) und 3) Herunterladen und lesen ----
$gesehen = New-Object 'System.Collections.Generic.HashSet[string]'
$eintraege = New-Object 'System.Collections.Generic.List[string]'
$nr = 0
foreach ($k in $liste) {
  $nr++
  $datei = Join-Path $Zielordner ("LoD2_" + $k + ".zip")
  if (-not ((Test-Path $datei) -and ((Get-Item $datei).Length -gt 1000))) {
    $ok = $false
    for ($versuch = 1; $versuch -le 4 -and -not $ok; $versuch++) {
      try {
        Invoke-WebRequest -Uri $adressen[$k] -OutFile $datei -UserAgent $kennung -UseBasicParsing -TimeoutSec 300
        $ok = $true
      } catch {
        "Kachel ${k}: Versuch $versuch fehlgeschlagen: " + $_.Exception.Message | Add-Content $log
        Start-Sleep -Seconds (5 * $versuch)
      }
    }
    if (-not $ok) { Write-Host "Kachel $k konnte nicht geladen werden. Bitte das Programm spaeter noch einmal starten."; exit 1 }
  }
  try {
    $neu = [LodWerkzeug]::LiesKachel($datei, $gesehen, $eintraege)
  } catch {
    "Kachel ${k}: Fehler beim Lesen: " + $_.Exception.Message | Add-Content $log
    Write-Host ("Kachel ${k}: Fehler beim Lesen: " + $_.Exception.Message)
    Remove-Item $datei -Force -ErrorAction SilentlyContinue
    exit 1
  }
  Write-Host ("[{0}/{1}] Kachel {2}: {3} Gebaeude" -f $nr, $liste.Count, $k, $neu)
}

$inhalt = '// Gebaeudehoehen der Stadt Oldenburg (Oldb): LGLN, 3D-Gebaeudemodell LoD2, Open Data, Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.de). Erzeugt mit Datenpflege\13_Gebaeudehoehen_aktualisieren.ps1.' + "`n" +
          '// Jedes Gebaeude = [Traufhoehe, Firsthoehe, Dachklasse (0 flach, 1 Sattel, 2 Walm, 3 Zelt/Pyramide, 4 Pult), Winkel (Firstrichtung 0 bis 179 bzw. Neigungsrichtung beim Pultdach, Grad von Norden im Uhrzeigersinn), Ring, Ring, ...] ueber Grund, Hoehen in Dezimetern; Ring = [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad (erster Ring = Aussenkante, weitere = Innenhoefe).' + "`n" +
          'var HOEHEN_OLDENBURG = {"einheit":1e-6,"version":2,"stand":"' + $Stand + '","anzahl":' + $eintraege.Count + ',"gebaeude":[' + "`n" + ($eintraege -join ",`n") + "`n" + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: {0} Gebaeude, {1} KB in {2}" -f $eintraege.Count, [int]((Get-Item $Ausgabe).Length / 1024), $Ausgabe)
if (-not $Behalten) { Remove-Item -Recurse -Force $Zielordner -Confirm:$false }
