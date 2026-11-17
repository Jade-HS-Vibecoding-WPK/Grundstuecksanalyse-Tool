# Rechnet fuer alle Haltestellen im Stadtgebiet Oldenburg aus, wie oft sie an einem normalen Werktag bedient werden und
# welche Linien dort halten. Ergebnis: Standortanalyse\fahrplan_oldenburg.js (Ebene "Haltestellen nach Takt" und die Angaben,
# die erscheinen, wenn man in der Karte eine Haltestelle anklickt).
#
# Quelle: gtfs.de, "Local Transit Germany" (Fahrplandaten des oeffentlichen Nahverkehrs, Daten bereitgestellt von DELFI e.V.,
# Lizenz CC BY 4.0). Die Datei ist etwa 250 MB gross, wird einmal heruntergeladen und am Ende geloescht.
# Das Programm liest die riesige Fahrtenliste (stop_times.txt, ca. 2 GB) direkt aus der ZIP-Datei, ohne sie zu entpacken.
# Dauer: einige Minuten. Mit -MaxMinuten wird abgebrochen, wenn es zu lange dauert.
#
# Gezaehlt werden die Abfahrten an einem Dienstag (dem ersten Dienstag ab morgen) zwischen 6 und 20 Uhr. Das ist ein normaler
# Schulwerktag; Ferien und Feiertage koennen abweichen. Endhaltestellen (kein Einstieg) werden nicht mitgezaehlt.

param(
  [string]$Zielordner = (Join-Path $PSScriptRoot 'rohdaten_fahrplan'),
  [string]$Ausgabe = (Join-Path $PSScriptRoot '..\Standortanalyse\fahrplan_oldenburg.js'),
  [string]$Stand = (Get-Date -Format 'yyyy-MM-dd'),
  [string]$Zip = '',
  [int]$MaxMinuten = 20,
  [switch]$Behalten
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force $Zielordner | Out-Null
if (-not $Zip) { $Zip = Join-Path $Zielordner 'gtfs_nv.zip' }
if (-not (Test-Path $Zip) -or (Get-Item $Zip).Length -lt 1MB) {
  Write-Host 'Lade die Fahrplandaten herunter (ca. 250 MB) ...'
  Invoke-WebRequest -Uri 'https://download.gtfs.de/germany/nv_free/latest.zip' -OutFile $Zip -UseBasicParsing -UserAgent 'Standortanalyse-Studienprojekt/1.0' -TimeoutSec 1200
}

# Stadtgebiet Oldenburg mit etwas Rand: Sued, West, Nord, Ost
$sued = 53.050; $nord = 53.225; $west = 8.060; $ost = 8.345

# Erster Dienstag ab morgen
$tag = (Get-Date).Date.AddDays(1)
while ($tag.DayOfWeek -ne [DayOfWeek]::Tuesday) { $tag = $tag.AddDays(1) }
$datum = $tag.ToString('yyyyMMdd')
Write-Host ("Gezaehlt wird der " + $tag.ToString('dd.MM.yyyy') + " (Dienstag), 6 bis 20 Uhr.")

Add-Type -ReferencedAssemblies 'System.IO.Compression', 'System.IO.Compression.FileSystem' -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Diagnostics;

public class Haltestelle { public string Name; public double Lat, Lon; public int[] Std = new int[24]; public HashSet<string> Routen = new HashSet<string>(); public string Eltern; }

public class FahrplanWerkzeug
{
    public static string[] Teile(string zeile)      // einfache CSV-Zeile mit Anfuehrungszeichen
    {
        var liste = new List<string>(); var sb = new StringBuilder(); bool innen = false;
        for (int i = 0; i < zeile.Length; i++)
        {
            char c = zeile[i];
            if (innen) { if (c == '"') { if (i + 1 < zeile.Length && zeile[i + 1] == '"') { sb.Append('"'); i++; } else innen = false; } else sb.Append(c); }
            else if (c == '"') innen = true;
            else if (c == ',') { liste.Add(sb.ToString()); sb.Length = 0; }
            else sb.Append(c);
        }
        liste.Add(sb.ToString());
        return liste.ToArray();
    }

    static Dictionary<string, int> Kopf(string zeile)
    {
        var d = new Dictionary<string, int>(); var t = Teile(zeile);
        for (int i = 0; i < t.Length; i++) d[t[i].TrimStart((char)0xFEFF)] = i;
        return d;
    }

    public static string Rechne(string zipPfad, string datum, double sued, double nord, double west, double ost, int maxMinuten, out string meldung)
    {
        var uhr = Stopwatch.StartNew();
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        string dow = new DateTime(int.Parse(datum.Substring(0, 4)), int.Parse(datum.Substring(4, 2)), int.Parse(datum.Substring(6, 2))).DayOfWeek.ToString().ToLower();
        using (var zip = ZipFile.OpenRead(zipPfad))
        {
            // 1. Haltestellen im Gebiet
            var stops = new Dictionary<string, Haltestelle>(); var eltern = new Dictionary<string, string>(); var namen = new Dictionary<string, string>();
            using (var sr = new StreamReader(zip.GetEntry("stops.txt").Open(), Encoding.UTF8))
            {
                var k = Kopf(sr.ReadLine()); string z;
                while ((z = sr.ReadLine()) != null)
                {
                    var t = Teile(z); if (t.Length <= k["stop_lon"]) continue;
                    double la, lo; if (!double.TryParse(t[k["stop_lat"]], System.Globalization.NumberStyles.Float, ci, out la) || !double.TryParse(t[k["stop_lon"]], System.Globalization.NumberStyles.Float, ci, out lo)) continue;
                    if (la < sued || la > nord || lo < west || lo > ost) continue;
                    string id = t[k["stop_id"]]; string lt = k.ContainsKey("location_type") ? t[k["location_type"]] : "";
                    string par = k.ContainsKey("parent_station") ? t[k["parent_station"]] : "";
                    namen[id] = t[k["stop_name"]];
                    if (lt == "1") continue;                       // Sammelhaltestelle: nur der Name wird gebraucht
                    stops[id] = new Haltestelle { Name = t[k["stop_name"]], Lat = la, Lon = lo, Eltern = par };
                }
            }
            // Namen der Sammelhaltestellen nachholen (liegen evtl. ausserhalb der Pruefung oben, deshalb schon beim Lesen gemerkt)
            // 2. Dienste, die am Tag fahren
            var aktiv = new HashSet<string>();
            using (var sr = new StreamReader(zip.GetEntry("calendar.txt").Open(), Encoding.UTF8))
            {
                var k = Kopf(sr.ReadLine()); string z;
                while ((z = sr.ReadLine()) != null)
                {
                    var t = Teile(z); if (t.Length < 10) continue;
                    if (string.CompareOrdinal(t[k["start_date"]], datum) <= 0 && string.CompareOrdinal(t[k["end_date"]], datum) >= 0 && t[k[dow]] == "1") aktiv.Add(t[k["service_id"]]);
                }
            }
            using (var sr = new StreamReader(zip.GetEntry("calendar_dates.txt").Open(), Encoding.UTF8))
            {
                var k = Kopf(sr.ReadLine()); string z;
                while ((z = sr.ReadLine()) != null)
                {
                    var t = Teile(z); if (t.Length < 3 || t[k["date"]] != datum) continue;
                    if (t[k["exception_type"]] == "1") aktiv.Add(t[k["service_id"]]); else if (t[k["exception_type"]] == "2") aktiv.Remove(t[k["service_id"]]);
                }
            }
            // 3. Fahrten an diesem Tag: Fahrt -> Linie
            var fahrtLinie = new Dictionary<string, string>();
            using (var sr = new StreamReader(zip.GetEntry("trips.txt").Open(), Encoding.UTF8))
            {
                var k = Kopf(sr.ReadLine()); string z;
                while ((z = sr.ReadLine()) != null)
                {
                    var t = Teile(z); if (t.Length < 3) continue;
                    if (aktiv.Contains(t[k["service_id"]])) fahrtLinie[t[k["trip_id"]]] = t[k["route_id"]];
                }
            }
            var linienName = new Dictionary<string, string>();
            using (var sr = new StreamReader(zip.GetEntry("routes.txt").Open(), Encoding.UTF8))
            {
                var k = Kopf(sr.ReadLine()); string z;
                while ((z = sr.ReadLine()) != null)
                {
                    var t = Teile(z); if (t.Length <= k["route_id"]) continue;
                    string n = t[k["route_short_name"]]; if (n == "") n = t[k["route_long_name"]];
                    linienName[t[k["route_id"]]] = n;
                }
            }
            // 4. Die riesige Fahrtenliste: nur Zeilen an unseren Haltestellen auswerten
            long zeilen = 0, treffer = 0;
            using (var sr = new StreamReader(zip.GetEntry("stop_times.txt").Open(), Encoding.UTF8, false, 1 << 20))
            {
                string kopfzeile = sr.ReadLine(); var kp = Kopf(kopfzeile);
                bool mitPickup = kp.ContainsKey("pickup_type");
                string z;
                while ((z = sr.ReadLine()) != null)
                {
                    zeilen++;
                    if ((zeilen & 0xFFFFF) == 0 && uhr.Elapsed.TotalMinutes > maxMinuten) { meldung = "ABGEBROCHEN nach " + maxMinuten + " Minuten (" + zeilen + " Zeilen gelesen)"; return null; }
                    // trip_id,arrival_time,departure_time,stop_id,stop_sequence,... (die ersten fuenf Felder enthalten keine Anfuehrungszeichen)
                    int a = z.IndexOf(','); if (a < 0) continue;
                    int b = z.IndexOf(',', a + 1); if (b < 0) continue;
                    int c = z.IndexOf(',', b + 1); if (c < 0) continue;
                    int d = z.IndexOf(',', c + 1); if (d < 0) continue;
                    string stopId = z.Substring(c + 1, d - c - 1);
                    Haltestelle h; if (!stops.TryGetValue(stopId, out h)) continue;
                    string fahrt = z.Substring(0, a);
                    string linie; if (!fahrtLinie.TryGetValue(fahrt, out linie)) continue;
                    if (mitPickup)
                    {
                        int l1 = z.LastIndexOf(','); int l2 = l1 > 0 ? z.LastIndexOf(',', l1 - 1) : -1;
                        if (l2 > 0 && z.Substring(l2 + 1, l1 - l2 - 1) == "1") continue;       // kein Einstieg (Endhaltestelle)
                    }
                    string zeit = z.Substring(b + 1, c - b - 1); if (zeit.Length < 2) zeit = z.Substring(a + 1, b - a - 1);
                    int std; if (zeit.Length < 2 || !int.TryParse(zeit.Substring(0, 2), out std)) continue;
                    if (std >= 24) std -= 24;
                    h.Std[std]++; treffer++;
                    string ln; h.Routen.Add(linienName.TryGetValue(linie, out ln) ? ln : linie);
                }
            }
            // 5. Haltestellen mit gleichem Namen in der Naehe zusammenfassen (Steige, beide Richtungen)
            var gruppen = new List<List<Haltestelle>>();
            foreach (var h in stops.Values)
            {
                int summe = 0; for (int i = 0; i < 24; i++) summe += h.Std[i];
                if (summe == 0) continue;
                string name = h.Name; string par; if (!string.IsNullOrEmpty(h.Eltern) && namen.TryGetValue(h.Eltern, out par) && par != "") name = par;
                h.Name = name;
                List<Haltestelle> ziel = null;
                foreach (var g in gruppen)
                {
                    if (g[0].Name != name) continue;
                    double dy = (g[0].Lat - h.Lat) * 111195.0, dx = (g[0].Lon - h.Lon) * 111195.0 * 0.6;
                    if (dx * dx + dy * dy < 150.0 * 150.0) { ziel = g; break; }
                }
                if (ziel == null) { ziel = new List<Haltestelle>(); gruppen.Add(ziel); }
                ziel.Add(h);
            }
            var sb = new StringBuilder(); int n2 = 0;
            foreach (var g in gruppen)
            {
                double la = 0, lo = 0; int[] std = new int[24]; var routen = new HashSet<string>();
                foreach (var h in g) { la += h.Lat; lo += h.Lon; for (int i = 0; i < 24; i++) std[i] += h.Std[i]; foreach (var r in h.Routen) routen.Add(r); }
                la /= g.Count; lo /= g.Count;
                int abf = 0, spitze = 0; for (int i = 6; i < 20; i++) { abf += std[i]; if (std[i] > spitze) spitze = std[i]; }
                var rl = new List<string>(routen);
                rl.Sort(delegate (string x, string y) { int xi, yi; bool xn = int.TryParse(x, out xi), yn = int.TryParse(y, out yi); if (xn && yn) return xi.CompareTo(yi); if (xn != yn) return xn ? -1 : 1; return string.CompareOrdinal(x, y); });
                if (sb.Length > 0) sb.Append(",\n");
                sb.Append('[').Append(((long)Math.Round(la * 1e6)).ToString(ci)).Append(',').Append(((long)Math.Round(lo * 1e6)).ToString(ci)).Append(',')
                  .Append('"').Append(g[0].Name.Replace("\\", "").Replace("\"", "'")).Append('"').Append(',').Append(abf).Append(',').Append(spitze).Append(',')
                  .Append('"').Append(string.Join(", ", rl.ToArray()).Replace("\\", "").Replace("\"", "'")).Append("\"]");
                n2++;
            }
            meldung = n2 + " Haltestellen mit Abfahrten, " + treffer + " Abfahrten gezaehlt, " + zeilen + " Zeilen gelesen, " + (int)uhr.Elapsed.TotalSeconds + " s";
            return sb.ToString();
        }
    }
}
'@

$meldung = ''
$ergebnis = [FahrplanWerkzeug]::Rechne($Zip, $datum, $sued, $nord, $west, $ost, $MaxMinuten, [ref]$meldung)
Write-Host $meldung
if (-not $ergebnis) { Write-Host 'Es wurde nichts geschrieben. Mit -MaxMinuten kann man mehr Zeit erlauben.'; exit 1 }

$inhalt = '// Haltestellen in Oldenburg mit Abfahrten (Dienstag, 6 bis 20 Uhr) und Linien. Quelle: gtfs.de (Local Transit Germany), Daten bereitgestellt von DELFI e.V., CC BY 4.0. Erzeugt mit Datenpflege\19_Fahrplan_aktualisieren.ps1' + "`n" +
          '// Jede Haltestelle = [Breite, Laenge (Millionstel Grad), Name, Abfahrten 6 bis 20 Uhr, meiste Abfahrten in einer Stunde, Linien]' + "`n" +
          'var FAHRPLAN_OLDENBURG = {"stand":"' + $Stand + '","tag":"' + $tag.ToString('yyyy-MM-dd') + '","einheit":1e-6,"haltestellen":[' + "`n" + $ergebnis + "`n" + ']};' + "`n"
[System.IO.File]::WriteAllText($Ausgabe, $inhalt, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("Fertig: in {0} geschrieben ({1} KB)." -f $Ausgabe, [int]((Get-Item $Ausgabe).Length / 1024))
if (-not $Behalten) { Remove-Item -Recurse -Force $Zielordner -Confirm:$false }
