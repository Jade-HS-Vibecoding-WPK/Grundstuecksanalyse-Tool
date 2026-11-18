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
    bereit: false,
    mitte: [52.3759, 9.7320],
    zoom: 14,
    grenzen: [[52.27, 9.57], [52.48, 9.95]],
    suchbereich: [9.60, 52.29, 9.92, 52.46],
    breite: 52.37,
    ortszusatz: "Hannover",
    haltestellenVorsatz: /^Hannover\s*/,
    stadtQuelle: "Landeshauptstadt Hannover",
    fnpQuelle: "Flächennutzungsplan: Landeshauptstadt Hannover",
    bezirkWort: "Stadtbezirk",
    hat: {}
  },
  osnabrueck: {
    id: "osnabrueck",
    name: "Osnabrück",
    langname: "Osnabrück",
    bereit: false,
    mitte: [52.2799, 8.0472],
    zoom: 14,
    grenzen: [[52.18, 7.90], [52.39, 8.18]],
    suchbereich: [7.93, 52.21, 8.15, 52.36],
    breite: 52.28,
    ortszusatz: "Osnabrück",
    haltestellenVorsatz: /^Osnabrück\s*/,
    stadtQuelle: "Stadt Osnabrück",
    fnpQuelle: "Flächennutzungsplan: Stadt Osnabrück",
    bezirkWort: "Stadtteil",
    hat: {}
  },
  braunschweig: {
    id: "braunschweig",
    name: "Braunschweig",
    langname: "Braunschweig",
    bereit: false,
    mitte: [52.2689, 10.5268],
    zoom: 14,
    grenzen: [[52.17, 10.33], [52.37, 10.70]],
    suchbereich: [10.38, 52.20, 10.66, 52.34],
    breite: 52.27,
    ortszusatz: "Braunschweig",
    haltestellenVorsatz: /^Braunschweig\s*/,
    stadtQuelle: "Stadt Braunschweig",
    fnpQuelle: "Flächennutzungsplan: Stadt Braunschweig",
    bezirkWort: "Stadtbezirk",
    hat: {}
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
