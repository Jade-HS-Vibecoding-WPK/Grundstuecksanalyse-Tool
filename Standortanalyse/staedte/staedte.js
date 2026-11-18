/* =====================================================================
   STÄDTE
   Hier steht, welche Städte die App kennt und was für jede Stadt gilt.
   Die Daten jeder Stadt liegen in einem eigenen Ordner: staedte/<id>/
   (zum Beispiel staedte/oldenburg/karte.js).

   Welche Stadt gerade gilt, bestimmt die Internetadresse: index.html?stadt=hannover
   (ohne Angabe: die zuletzt gewählte Stadt, sonst Oldenburg). Beim Wechsel der Stadt wird
   die Seite neu geladen, dann gelten überall die Dateien und Einstellungen der neuen Stadt.

   Neue Stadt hinzufügen:
   1. Eintrag unten ergänzen (Mitte, Grenzen, Suchbereich, Quellen).
   2. Daten mit den Programmen in Datenpflege/ erzeugen (siehe LIESMICH.txt, "Neue Stadt").
   3. "bereit: true" setzen, dann erscheint die Stadt in der Auswahl.
   ===================================================================== */

var STAEDTE = {
  oldenburg: {
    id: "oldenburg",
    name: "Oldenburg",
    langname: "Oldenburg (Oldb)",
    bereit: true,
    mitte: [53.1435, 8.2146],            // Startansicht (Innenstadt)
    zoom: 14,
    grenzen: [[53.03, 8.03], [53.245, 8.375]],     // so weit lässt sich die Karte bewegen (Stadtgebiet plus etwa 2 km)
    suchbereich: [8.08, 53.06, 8.34, 53.22],        // Adresssuche: West, Süd, Ost, Nord
    breite: 53.14,                       // mittlere Breite (zum Umrechnen von Längengraden in Meter)
    ags: "03403000",                     // amtlicher Gemeindeschlüssel
    ladekreis: "^Oldenburg \\(Oldb\\)",     // Datenprogramme: so heißt die Stadt in der Spalte "Kreis" des Ladesäulenregisters
    borisgemeinde: "^Oldenburg \\(Oldb\\)", // Datenprogramme: so heißt die Stadt in den Bodenrichtwerten (BORIS)
    datenrechteck: [53.050, 8.060, 53.225, 8.345],  // Süd, West, Nord, Ost: dieses Rechteck erfassen die Datenprogramme (Stadtgebiet plus Rand)
    ortszusatz: "Oldenburg",             // wird bei der Adresssuche angehängt
    haltestellenVorsatz: /^Oldenburg\(Oldb\)\s*/,   // so beginnen die Haltestellennamen im Fahrplan (wird weggelassen)
    stadtQuelle: "Stadt Oldenburg (Oldb), Datenlizenz Deutschland – Namensnennung 2.0",
    fnpQuelle: "Flächennutzungsplan: Stadt Oldenburg (Oldb), Stand Änderungen bis 05.07.2024, Datenlizenz Deutschland – Zero 2.0",
    bezirkWort: "Bezirk",
    // Dateien mit Daten, die nur die Stadt selbst liefert (fehlt eine Datei, bleibt die Ebene für diese Stadt weg)
    hat: { stadt: true, laerm: true, fnp: true, bodenrichtwerte: true, luft: true }
  },
  hannover: {
    id: "hannover",
    name: "Hannover",
    langname: "Hannover",
    bereit: true,
    mitte: [52.3759, 9.7320],
    zoom: 14,
    grenzen: [[52.285, 9.575], [52.474, 9.949]],
    suchbereich: [9.60, 52.30, 9.925, 52.46],
    breite: 52.38,
    ags: "03241001",
    datenrechteck: [52.280, 9.565, 52.480, 9.960],
    ladekreis: "Hannover",
    borisgemeinde: "^Hannover",
    ortszusatz: "Hannover",
    haltestellenVorsatz: /^Hannover\s*/,
    stadtGruppen: ["nsg", "lsg", "naturdenkmale", "bezirke"],   // welche Gruppen stadt.js hat (Bebauungspläne und Lärm fehlen)
    stadtQuelle: "Schutzgebiete und Naturdenkmale: NLWKN Niedersachsen; Stadtbezirke: © OpenStreetMap-Mitwirkende",
    fnpQuelle: "Flächennutzungsplan: Landeshauptstadt Hannover (Landesportal PlanDigital Niedersachsen), Datenlizenz Deutschland – Zero 2.0",
    bezirkWort: "Stadtbezirk",
    hat: { stadt: true, fnp: true, bodenrichtwerte: true, luft: true }
  },
  osnabrueck: {
    id: "osnabrueck",
    name: "Osnabrück",
    langname: "Osnabrück",
    bereit: true,
    mitte: [52.2799, 8.0472],
    zoom: 14,
    grenzen: [[52.198, 7.900], [52.357, 8.211]],
    suchbereich: [7.925, 52.213, 8.186, 52.343],
    breite: 52.28,
    ags: "03404000",
    datenrechteck: [52.190, 7.890, 52.365, 8.220],
    borisgemeinde: "^Osnabr",
    stadtGruppen: ["bplan", "nsg", "lsg", "biotope", "naturdenkmale", "bezirke"],   // welche Gruppen stadt.js hat (ohne Angabe: alle)
    ortszusatz: "Osnabrück",
    haltestellenVorsatz: /^Osnabrück\s*/,
    stadtQuelle: "Stadt Osnabrück, Fachdienst Geodaten, dl-de/by-2-0; Naturschutzgebiete: NLWKN Niedersachsen",
    fnpQuelle: "Flächennutzungsplan: Stadt Osnabrück (Landesportal PlanDigital Niedersachsen), Datenlizenz Deutschland – Zero 2.0",
    bezirkWort: "Stadtteil",
    hat: { stadt: true, fnp: true, bodenrichtwerte: true, luft: true }
  },
  braunschweig: {
    id: "braunschweig",
    name: "Braunschweig",
    langname: "Braunschweig",
    bereit: true,
    mitte: [52.2689, 10.5268],
    zoom: 14,
    grenzen: [[52.167, 10.382], [52.378, 10.673]],
    suchbereich: [10.407, 52.182, 10.648, 52.363],
    breite: 52.27,
    ags: "03101000",
    datenrechteck: [52.160, 10.370, 52.385, 10.685],
    ladekreis: "Braunschweig",
    borisgemeinde: "^Braunschweig",
    ortszusatz: "Braunschweig",
    haltestellenVorsatz: /^Braunschweig\s*/,
    stadtGruppen: ["nsg", "lsg", "naturdenkmale", "bezirke"],   // welche Gruppen stadt.js hat (Bebauungspläne und Lärm fehlen)
    stadtQuelle: "Schutzgebiete und Naturdenkmale: NLWKN Niedersachsen; Stadtbezirke: © OpenStreetMap-Mitwirkende",
    fnpQuelle: "Flächennutzungsplan: Stadt Braunschweig (Landesportal PlanDigital Niedersachsen), Datenlizenz Deutschland – Zero 2.0",
    bezirkWort: "Stadtbezirk",
    hat: { stadt: true, fnp: true, bodenrichtwerte: true, luft: true }
  }
};

// Die gewählte Stadt: ?stadt=... in der Adresse, sonst die zuletzt gewählte (im Browser gemerkt), sonst Oldenburg
var STADT = (function () {
  var param = null, gemerkt = null;
  try { param = new URLSearchParams(location.search).get("stadt"); } catch (e) { /* alte Browser */ }
  try { gemerkt = localStorage.getItem("standortanalyse_stadt"); } catch (e) { /* Speicher gesperrt */ }
  if (param && STAEDTE[param]) { return STAEDTE[param]; }                                       // ausdrücklich gewählt (auch eine noch nicht fertige Stadt zum Testen)
  if (gemerkt && STAEDTE[gemerkt] && STAEDTE[gemerkt].bereit) { return STAEDTE[gemerkt]; }       // zuletzt gewählte
  return STAEDTE.oldenburg;
})();

// Adresse einer Datendatei der gewählten Stadt: stadtDatei("karte") -> "staedte/oldenburg/karte.js"
function stadtDatei(name) { return "staedte/" + STADT.id + "/" + name + ".js"; }

// Name ohne Umlaute (für PDF-Kopfdaten und DXF-Kommentare, die nur einfache Zeichen kennen)
STADT.ascii = STADT.name.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss");

document.title = "Standortanalyse " + STADT.name;
