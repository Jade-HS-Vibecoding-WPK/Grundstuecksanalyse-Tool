# Einmaliger Umbau: zerlegt die alten Gesamtdateien hoehen.js und gelaende.js einer Stadt in Kacheln
# (Ordner hoehen\ und gelaende\ in Standortanalyse\staedte\<Stadt>\). Die App laedt danach nur noch die Kacheln, die sie braucht.
# Die alten Dateien werden nach Datenpflege\_download\alt\<Stadt>\ verschoben (der Ordner steht nicht im Repository).
# Neue Daten erzeugen die Programme 13 und 22 jetzt direkt als Kacheln; dieses Programm braucht man nur fuer Altbestand.

param(
  [string]$Stadt = 'oldenburg'
)
. (Join-Path $PSScriptRoot 'stadt.ps1'); . (Join-Path $PSScriptRoot 'kacheln.ps1'); $StadtInfo = Hole-Stadt $Stadt
$ErrorActionPreference = 'Stop'

$ordner = $StadtInfo.Ordner
$alt = Join-Path $PSScriptRoot ('_download\alt\' + $Stadt)
New-Item -ItemType Directory -Force $alt | Out-Null
$hoehenAlt = Join-Path $ordner 'hoehen.js'
$gelAlt = Join-Path $ordner 'gelaende.js'

# ---- Hoehen ----
if (Test-Path $hoehenAlt) {
  Write-Host 'Lese hoehen.js ...'
  $zeilen = [IO.File]::ReadAllLines($hoehenAlt, [Text.Encoding]::UTF8)
  $stand = ([regex]::Match(($zeilen | Where-Object { $_ -like 'var HOEHEN_DATEN*' } | Select-Object -First 1), '"stand":"([^"]*)"')).Groups[1].Value
  $eintraege = New-Object 'System.Collections.Generic.List[string]'
  foreach ($z in $zeilen) {
    if ($z.StartsWith('[')) { $eintraege.Add($z.TrimEnd(',')) }
  }
  Write-Host ("{0} Gebaeude gelesen." -f $eintraege.Count)
  $kopf = '// Gebaeudehoehen der Stadt ' + $StadtInfo.Ascii + ': LGLN, 3D-Gebaeudemodell LoD2, Open Data, Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.de). Aus der frueheren Gesamtdatei in Kacheln zerlegt (29_Kacheln_umbauen.ps1).' + "`n" +
          '// Jedes Gebaeude = [Traufhoehe, Firsthoehe, Dachklasse (0 flach, 1 Sattel, 2 Walm, 3 Zelt/Pyramide, 4 Pult), Winkel (Firstrichtung 0 bis 179 bzw. Neigungsrichtung beim Pultdach, Grad von Norden im Uhrzeigersinn), Ring, Ring, ...], Hoehen in Dezimetern ueber NHN (nicht ueber Grund!); Ring = [Breite, Laenge, Delta, Delta, ...] in Millionstel Grad (erster Ring = Aussenkante, weitere = Innenhoefe).' + "`n" +
          '// Die Gebaeude liegen in Kacheln (hoehen\<i>_<j>.js, Zelle = Breite / dlat, Laenge / dlon), index.js nennt die vorhandenen Kacheln.'
  Schreibe-HoehenKacheln $eintraege (Join-Path $ordner 'hoehen') $stand $kopf
  Move-Item $hoehenAlt (Join-Path $alt 'hoehen.js') -Force
} else { Write-Host 'hoehen.js nicht vorhanden - uebersprungen.' }

# ---- Gelaende ----
if (Test-Path $gelAlt) {
  Write-Host 'Lese gelaende.js ...'
  $code = @'
using System;
using System.IO;
using System.IO.Compression;
using System.Text.RegularExpressions;
public static class GelaendeLeser
{
    public static string Umbauen(string datei, string ordner)
    {
        string t = File.ReadAllText(datei);
        Func<string, string> feld = delegate (string n) { var m = Regex.Match(t, "\"" + n + "\":\"?([^\",}]*)"); if (!m.Success) throw new Exception("Feld fehlt: " + n); return m.Groups[1].Value; };
        var inv = System.Globalization.CultureInfo.InvariantCulture;
        int W = int.Parse(feld("breite")), H = int.Parse(feld("hoehe"));
        double e0 = double.Parse(feld("e0"), inv), n1 = double.Parse(feld("n1"), inv), schritt = double.Parse(feld("schritt"), inv);
        string stand = feld("stand"), daten = feld("daten");
        byte[] gepackt = Convert.FromBase64String(daten), roh = new byte[(long)W * H * 2];
        using (var ms = new MemoryStream(gepackt)) using (var ds = new DeflateStream(ms, CompressionMode.Decompress))
        {
            int gelesen = 0, n; while (gelesen < roh.Length && (n = ds.Read(roh, gelesen, roh.Length - gelesen)) > 0) gelesen += n;
            if (gelesen != roh.Length) throw new Exception("Gelaendedaten haben nicht die erwartete Groesse");
        }
        var gitter = new short[(long)W * H];
        for (int j = 0; j < H; j++) { int s = 0; for (int i = 0; i < W; i++) { long k = (long)j * W + i; s = (short)(s + (short)(roh[k * 2] | (roh[k * 2 + 1] << 8))); gitter[k] = (short)s; } }
        string kopf = "// Gelaendehoehen: LGLN, Digitales Gelaendemodell 1 m (DGM1), Open Data, Lizenz CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/deed.de). Aus der frueheren Gesamtdatei in Kacheln zerlegt (29_Kacheln_umbauen.ps1).\n" +
                      "// Raster in UTM32 (ETRS89): e0 = Rechtswert der linken Kante, n1 = Hochwert der oberen Kante, schritt in m (Zellmitten), Zeilen von Norden nach Sueden. Kacheln: Bloecke von \"kachel\" x \"kachel\" Zellen, Name = Spalte_Zeile des Blocks.\n" +
                      "// Jede Kachel = Base64 von \"deflate-raw\" ueber 16-Bit-Werte (kleinstes Byte zuerst): Hoehe in Dezimetern ueber NHN, je Zeile als Differenz zum linken Nachbarn.";
        return KachelWerkzeug.GelaendeSchreiben(gitter, W, H, e0, n1, schritt, ordner, stand, 500, kopf);
    }
}
'@
  Add-Type -TypeDefinition ($code + $KachelQuelle)
  $gOrdner = Join-Path $ordner 'gelaende'
  Loesche-KachelOrdner $gOrdner
  Write-Host ([GelaendeLeser]::Umbauen($gelAlt, $gOrdner))
  Move-Item $gelAlt (Join-Path $alt 'gelaende.js') -Force
} else { Write-Host 'gelaende.js nicht vorhanden - uebersprungen.' }
Write-Host ('Fertig. Die alten Gesamtdateien liegen jetzt in ' + $alt)
