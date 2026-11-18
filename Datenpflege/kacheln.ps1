# Gemeinsame Hilfe fuer die Programme 13 (Gebaeudehoehen), 22 (Gelaende) und 29 (Umbau): schreibt Hoehen und Gelaende in Kacheln.
# Die App laedt dann nur die Kacheln, die sie fuer den gewaehlten Ausschnitt braucht (statt einer Datei fuer die ganze Stadt).
#
# Hoehen:  Standortanalyse\staedte\<Stadt>\hoehen\index.js  und  hoehen\<i>_<j>.js   (Gitter aus Breiten-/Laengengrad-Zellen)
# Gelaende: Standortanalyse\staedte\<Stadt>\gelaende\index.js  und  gelaende\<c>_<r>.js (Bloecke von 500 x 500 Rasterzellen = 2,5 km)

$HOEHEN_DLAT = 0.01
$HOEHEN_DLON = 0.0165

function Loesche-KachelOrdner([string]$ordner) {
  New-Item -ItemType Directory -Force $ordner | Out-Null
  Get-ChildItem $ordner -Filter '*.js' -ErrorAction SilentlyContinue | Remove-Item -Force
}

# $eintraege = Liste der Gebaeude-Eintraege (je ein Text "[Traufe,First,Klasse,Winkel,[Ring],...]", erster Ring beginnt mit Breite, Laenge in Millionstel Grad)
function Schreibe-HoehenKacheln($eintraege, [string]$ordner, [string]$stand, [string]$kopf) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  $gruppen = New-Object 'System.Collections.Generic.Dictionary[string,System.Collections.Generic.List[string]]'
  $re = [regex]'^\[-?\d+,-?\d+,\d+,\d+,\[(-?\d+),(-?\d+)'
  foreach ($e in $eintraege) {
    $m = $re.Match($e)
    if (-not $m.Success) { throw ('Unerwartetes Format eines Gebaeudes: ' + $e.Substring(0, [Math]::Min(60, $e.Length))) }
    $la = [double]$m.Groups[1].Value / 1e6; $lo = [double]$m.Groups[2].Value / 1e6
    $schl = ([int][Math]::Floor($la / $HOEHEN_DLAT)).ToString() + '_' + ([int][Math]::Floor($lo / $HOEHEN_DLON)).ToString()
    if (-not $gruppen.ContainsKey($schl)) { $gruppen[$schl] = New-Object 'System.Collections.Generic.List[string]' }
    $gruppen[$schl].Add($e)
  }
  Loesche-KachelOrdner $ordner
  $zaehler = @()
  foreach ($schl in ($gruppen.Keys | Sort-Object)) {
    $liste = $gruppen[$schl]
    $inh = 'HOEHEN_KACHEL("' + $schl + '",{"einheit":1e-6,"version":2,"anzahl":' + $liste.Count + ',"gebaeude":[' + "`n" + ($liste -join ",`n") + "`n" + ']});' + "`n"
    [IO.File]::WriteAllText((Join-Path $ordner ($schl + '.js')), $inh, $enc)
    $zaehler += ('"' + $schl + '":' + $liste.Count)
  }
  $gesamt = 0; foreach ($l in $gruppen.Values) { $gesamt += $l.Count }
  $idx = $kopf + "`n" + 'var HOEHEN_INDEX = {"einheit":1e-6,"version":2,"stand":"' + $stand + '","anzahl":' + $gesamt + ',"dlat":' + $HOEHEN_DLAT.ToString([Globalization.CultureInfo]::InvariantCulture) + ',"dlon":' + $HOEHEN_DLON.ToString([Globalization.CultureInfo]::InvariantCulture) + ',"kacheln":{' + ($zaehler -join ',') + '}};' + "`n"
  [IO.File]::WriteAllText((Join-Path $ordner 'index.js'), $idx, $enc)
  Write-Host ("{0} Gebaeude in {1} Kacheln geschrieben ({2})." -f $gesamt, $gruppen.Count, $ordner)
}

# C#-Teil fuer das Gelaende (wird an den C#-Text des jeweiligen Programms angehaengt; kommt ohne "using" aus)
$KachelQuelle = @'
public static class KachelWerkzeug
{
    // Schreibt das Raster (Dezimeter ueber NHN, short.MinValue = kein Wert) in Bloecke von K x K Zellen.
    // Luecken werden zeilenweise von links her aufgefuellt. Rueckgabe: Meldung.
    public static string GelaendeSchreiben(short[] gitter, int W, int H, double e0, double n1, double schritt, string ordner, string stand, int K, string kopf)
    {
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        int nc = (W + K - 1) / K, nr = (H + K - 1) / K;
        var echt = new int[nc * nr]; int unten = 0; short mn = short.MaxValue, mx = short.MinValue;
        for (int j = 0; j < H; j++) for (int i = 0; i < W; i++)
        {
            short v = gitter[(long)j * W + i];
            if (v == short.MinValue) { unten++; continue; }
            echt[(j / K) * nc + (i / K)]++;
            if (v < mn) mn = v; if (v > mx) mx = v;
        }
        for (int j = 0; j < H; j++)
        {
            short vor = short.MinValue;
            for (int i = 0; i < W; i++) { long k = (long)j * W + i; if (gitter[k] != short.MinValue) { vor = gitter[k]; break; } }
            if (vor == short.MinValue) vor = 0;
            for (int i = 0; i < W; i++) { long k = (long)j * W + i; if (gitter[k] == short.MinValue) gitter[k] = vor; else vor = gitter[k]; }
        }
        var enc = new System.Text.UTF8Encoding(false);
        var namen = new System.Collections.Generic.List<string>(); long bytesGesamt = 0;
        for (int r = 0; r < nr; r++) for (int c = 0; c < nc; c++)
        {
            if (echt[r * nc + c] == 0) continue;
            int w = System.Math.Min(K, W - c * K), h = System.Math.Min(K, H - r * K);
            var diff = new byte[w * h * 2]; int p = 0;
            for (int j = 0; j < h; j++)
            {
                short vor = 0;
                for (int i = 0; i < w; i++) { short v = gitter[(long)(r * K + j) * W + (c * K + i)]; int d = v - vor; vor = v; diff[p++] = (byte)(d & 255); diff[p++] = (byte)((d >> 8) & 255); }
            }
            byte[] gepackt;
            using (var ms = new System.IO.MemoryStream())
            {
                using (var ds = new System.IO.Compression.DeflateStream(ms, System.IO.Compression.CompressionLevel.Optimal, true)) ds.Write(diff, 0, diff.Length);
                gepackt = ms.ToArray();
            }
            string name = c + "_" + r;
            System.IO.File.WriteAllText(System.IO.Path.Combine(ordner, name + ".js"), "GELAENDE_KACHEL(\"" + name + "\",\"" + System.Convert.ToBase64String(gepackt) + "\");\n", enc);
            namen.Add("\"" + name + "\""); bytesGesamt += gepackt.Length;
        }
        string idx = kopf + "\nvar GELAENDE_INDEX = {\"stand\":\"" + stand + "\",\"e0\":" + e0.ToString("0", inv) + ",\"n1\":" + n1.ToString("0", inv) + ",\"schritt\":" + schritt.ToString(inv) +
                     ",\"breite\":" + W + ",\"hoehe\":" + H + ",\"kachel\":" + K + ",\"min\":" + (mn / 10.0).ToString(inv) + ",\"max\":" + (mx / 10.0).ToString(inv) + ",\"kacheln\":[" + string.Join(",", namen.ToArray()) + "]};\n";
        System.IO.File.WriteAllText(System.IO.Path.Combine(ordner, "index.js"), idx, enc);
        return "Gitter " + W + " x " + H + ", " + namen.Count + " Kacheln, Hoehen " + (mn / 10.0).ToString(inv) + " bis " + (mx / 10.0).ToString(inv) + " m, ohne Wert " + unten + " Zellen, gepackt " + bytesGesamt / 1024 + " KB";
    }
}
'@
