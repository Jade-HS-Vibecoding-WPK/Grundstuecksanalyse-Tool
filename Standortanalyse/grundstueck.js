// Grundstücke (Flurstücke) aus dem Kataster des Landesamts LGLN und die Grundstücksanalyse (GRZ, GFZ, Baufeld).
// Wird erst geladen, wenn man den Abschnitt "13 Grundstück" öffnet oder eine der Grundstücks-Ebenen einschaltet.
//
// Quelle der Daten: LGLN, ALKIS "vereinfacht" als Online-Dienst (WFS), Lizenz CC BY 4.0, ohne Eigentümerdaten:
// https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_einfach
// Der Dienst erlaubt den Abruf aus dem Browser (CORS offen). Die Daten werden kachelweise geholt und im Speicher gehalten.
//
// Greift auf Variablen und Funktionen der Hauptseite zu (karte, marker, FLST, zeichnung, zeichenNeu, zuPixel, ...).
(function () {
  "use strict";

  var DIENST = "https://opendata.lgln.niedersachsen.de/doorman/noauth/alkis_wfs_einfach";
  var KACHEL_LA = 0.004, KACHEL_LO = 0.0066;      // eine Kachel ist etwa 440 m x 440 m groß
  var MIN_ZOOM = 16;                              // darunter wären es zu viele Grundstücke
  var MAX_KACHELN_BILD = 36;                      // für das gespeicherte Bild höchstens so viele Kacheln (etwa 2,6 x 2,6 km)
  var M_LA = 111195;                              // Meter pro Breitengrad
  var GESCHOSSHOEHE = 3.0;                        // Meter je Geschoss (für Schätzung und Baukörper)
  var UMGEBUNG_RADIUS = 80;                       // Meter: "nähere Umgebung" für die Vergleichswerte
  var jahr = new Date().getFullYear();

  var flst = new Map();            // Flurstücke: Kennung -> Flurstück
  var gebAlle = new Map();         // Gebäude und Bauwerke: Kennung -> Gebäude
  var gebRaster = new Map();       // grobes Raster (0,001 Grad), damit man Gebäude in einem Rechteck schnell findet
  var RASTER = 0.001;

  // Bebauungsdichte (BauNVO § 17, Obergrenzen) je Gebietsart: GRZ und GFZ
  var GEBIETE = {
    WS:   { n: "Kleinsiedlungsgebiet (WS)",        grz: 0.2, gfz: 0.4 },
    WR:   { n: "Reines Wohngebiet (WR)",           grz: 0.4, gfz: 1.2 },
    WA:   { n: "Allgemeines Wohngebiet (WA)",      grz: 0.4, gfz: 1.2 },
    WB:   { n: "Besonderes Wohngebiet (WB)",       grz: 0.6, gfz: 1.6 },
    MD:   { n: "Dorfgebiet (MD)",                  grz: 0.6, gfz: 1.2 },
    MI:   { n: "Mischgebiet (MI)",                 grz: 0.6, gfz: 1.2 },
    MU:   { n: "Urbanes Gebiet (MU)",              grz: 0.8, gfz: 3.0 },
    MK:   { n: "Kerngebiet (MK)",                  grz: 1.0, gfz: 3.0 },
    GE:   { n: "Gewerbegebiet (GE)",               grz: 0.8, gfz: 2.4 },
    GI:   { n: "Industriegebiet (GI)",             grz: 0.8, gfz: 2.4 },
    SO:   { n: "Sonstiges Sondergebiet (SO)",      grz: 0.8, gfz: 2.4 },
    FREI: { n: "Eigene Werte aus dem Bebauungsplan", grz: 0.4, gfz: 1.2 }
  };
  // Einfärbung nach vorhandener Überbauung (Gebäude geteilt durch Grundstücksfläche)
  var GRZ_KLASSEN = [
    { bis: 0.0001, farbe: "#e9efe3", text: "unbebaut" },
    { bis: 0.1,    farbe: "#fff7bc", text: "bis 0,1" },
    { bis: 0.2,    farbe: "#fee391", text: "0,1 bis 0,2" },
    { bis: 0.3,    farbe: "#fec44f", text: "0,2 bis 0,3" },
    { bis: 0.4,    farbe: "#fe9929", text: "0,3 bis 0,4" },
    { bis: 0.6,    farbe: "#d95f0e", text: "0,4 bis 0,6" },
    { bis: 99,     farbe: "#993404", text: "über 0,6" }
  ];
  function grzKlasse(g) { for (var i = 0; i < GRZ_KLASSEN.length; i++) { if (g < GRZ_KLASSEN[i].bis) { return GRZ_KLASSEN[i]; } } return GRZ_KLASSEN[GRZ_KLASSEN.length - 1]; }

  // ---------- kleine Hilfen ----------
  function el(id) { return document.getElementById(id); }
  function zahlDe(n, stellen) { return (n === null || n === undefined || isNaN(n)) ? "–" : Number(n).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen }); }
  function qm(n) { return zahlDe(Math.round(n), 0) + " m²"; }
  function lesenZahl(id) { var v = parseFloat(String(el(id).value).replace(",", ".")); return isFinite(v) ? v : null; }
  function median(liste) {
    if (!liste.length) { return null; }
    var a = liste.slice().sort(function (x, y) { return x - y; }), m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function textVon(e, name) { var x = e.getElementsByTagNameNS("*", name)[0]; return x ? x.textContent : ""; }

  // ---------- Dienst abrufen und lesen ----------
  function holeGml(typ, s, w, n, o) {
    var url = DIENST + "?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ave:" + typ +
      "&BBOX=" + s.toFixed(6) + "," + w.toFixed(6) + "," + n.toFixed(6) + "," + o.toFixed(6) + ",urn:ogc:def:crs:EPSG::4326" +
      "&SRSNAME=urn:ogc:def:crs:EPSG::4326&COUNT=10000" +
      "&PROPERTYNAME=" + (typ === "Flurstueck" ? "(idflurst,lagebeztxt,gemarkung,flur,flstnrzae,flstnrnen,flaeche,tntxt,geometrie)" : "(oid,gebnutzbez,funktion,geometrie)");
    var abbruch = typeof AbortController !== "undefined" ? new AbortController() : null;
    var frist = setTimeout(function () { if (abbruch) { abbruch.abort(); } }, 45000);
    return fetch(url, abbruch ? { signal: abbruch.signal } : {}).then(function (r) {
      if (!r.ok) { throw new Error("Dienst antwortet mit " + r.status); }
      return r.text();
    }).then(function (txt) {
      clearTimeout(frist);
      var doc = new DOMParser().parseFromString(txt, "text/xml");
      if (doc.getElementsByTagName("parsererror").length || doc.getElementsByTagNameNS("*", "ExceptionReport").length) { throw new Error("Unerwartete Antwort des Dienstes"); }
      return doc;
    }, function (x) { clearTimeout(frist); throw x; });
  }
  function ringAusText(e) {
    var a = e.textContent.trim().split(/\s+/).map(Number), r = [];
    for (var i = 0; i + 1 < a.length; i += 2) { r.push([a[i], a[i + 1]]); }      // [Breite, Länge]
    return r;
  }
  function polygoneVon(e) {
    var aus = [], ps = e.getElementsByTagNameNS("*", "Polygon");
    for (var i = 0; i < ps.length; i++) {
      var ext = ps[i].getElementsByTagNameNS("*", "exterior")[0];
      if (!ext) { continue; }
      var pl = ext.getElementsByTagNameNS("*", "posList")[0];
      if (!pl) { continue; }
      var innen = [], ints = ps[i].getElementsByTagNameNS("*", "interior");
      for (var k = 0; k < ints.length; k++) { var ip = ints[k].getElementsByTagNameNS("*", "posList")[0]; if (ip) { innen.push(ringAusText(ip)); } }
      var a = ringAusText(pl);
      if (a.length >= 4) { aus.push({ a: a, i: innen }); }
    }
    return aus;
  }
  function umriss(polys) {
    var s = 90, w = 180, n = -90, o = -180;
    polys.forEach(function (p) { p.a.forEach(function (q) { if (q[0] < s) { s = q[0]; } if (q[0] > n) { n = q[0]; } if (q[1] < w) { w = q[1]; } if (q[1] > o) { o = q[1]; } }); });
    return [s, w, n, o];
  }
  function flaecheGrad(ring) {       // Fläche eines [Breite, Länge]-Rings in m²
    var la0 = ring[0][0], kx = M_LA * Math.cos(la0 * Math.PI / 180), s = 0;
    for (var i = 0; i < ring.length - 1; i++) {
      var x1 = (ring[i][1]) * kx, y1 = ring[i][0] * M_LA, x2 = (ring[i + 1][1]) * kx, y2 = ring[i + 1][0] * M_LA;
      s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
  }
  function leseFlst(doc) {
    var liste = [], els = doc.getElementsByTagNameNS("*", "Flurstueck");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], id = textVon(e, "idflurst");
      if (!id) { continue; }
      var polys = polygoneVon(e);
      if (!polys.length) { continue; }
      var f = {
        id: id, adr: textVon(e, "lagebeztxt"), gem: textVon(e, "gemarkung"), flur: parseInt(textVon(e, "flur"), 10) || 0,
        zae: parseInt(textVon(e, "flstnrzae"), 10) || 0, nen: parseInt(textVon(e, "flstnrnen"), 10) || 0,
        flaeche: parseFloat(textVon(e, "flaeche")) || 0, nutz: textVon(e, "tntxt"), akt: textVon(e, "aktualit"), polys: polys
      };
      f.bb = umriss(polys);
      f.mitte = [(f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2];
      var gross = polys[0], gf = -1;
      polys.forEach(function (p) { var fl = flaecheGrad(p.a); if (fl > gf) { gf = fl; gross = p; } });
      // Schwerpunkt des größten Teils (reicht für Beschriftung und Abstände)
      var sx = 0, sy = 0, sa = 0, a = gross.a;
      for (var k = 0; k < a.length - 1; k++) {
        var c = a[k][1] * a[k + 1][0] - a[k + 1][1] * a[k][0];
        sa += c; sx += (a[k][1] + a[k + 1][1]) * c; sy += (a[k][0] + a[k + 1][0]) * c;
      }
      if (Math.abs(sa) > 1e-18) { f.mitte = [sy / (3 * sa), sx / (3 * sa)]; }
      if (!(f.mitte[0] > f.bb[0] && f.mitte[0] < f.bb[2] && f.mitte[1] > f.bb[1] && f.mitte[1] < f.bb[3])) { f.mitte = [(f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2]; }
      f.nr = f.zae + (f.nen > 0 ? "/" + f.nen : "");
      liste.push(f);
    }
    return liste;
  }
  function fuegeFlst(liste) { liste.forEach(function (f) { if (!flst.has(f.id)) { flst.set(f.id, f); } }); }
  var NEBEN = /garage|parkhaus|carport|stellplatz|schuppen|gartenhaus|laube|stall|scheune|geräte|nebengeb|abstell|gewächshaus|pavillon|unterstand|trafo|umspann|pumpwerk|wetterschutz|fahrradhaus|bootshaus|kiosk/i;
  function leseGeb(doc) {
    var liste = [], els = doc.getElementsByTagNameNS("*", "GebaeudeBauwerk");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], id = textVon(e, "oid") || e.getAttribute("gml:id");
      if (!id) { continue; }
      var nutz = textVon(e, "gebnutzbez"), fkt = textVon(e, "funktion");
      var art;
      if (nutz === "Gebäude") { art = "haupt"; }
      else if (/^Sonstiges/.test(nutz)) { art = "sonst"; }
      else { continue; }                                   // Bauteile (Arkaden, Vorsprünge) liegen schon im Gebäude
      var polys = polygoneVon(e);
      if (!polys.length) { continue; }
      var fl = 0; polys.forEach(function (p) { fl += flaecheGrad(p.a); });
      if (art === "haupt" && (NEBEN.test(fkt) || fl < 15)) { art = "neben"; }
      liste.push({ id: id, art: art, fkt: fkt, polys: polys, fl: fl, bb: umriss(polys) });
    }
    return liste;
  }
  function fuegeGeb(liste) {
    liste.forEach(function (b) {
      if (gebAlle.has(b.id)) { return; }
      gebAlle.set(b.id, b);
      for (var ci = Math.floor(b.bb[0] / RASTER); ci <= Math.floor(b.bb[2] / RASTER); ci++) {
        for (var cj = Math.floor(b.bb[1] / RASTER); cj <= Math.floor(b.bb[3] / RASTER); cj++) {
          var key = ci + "," + cj, l = gebRaster.get(key);
          if (!l) { l = []; gebRaster.set(key, l); }
          l.push(b);
        }
      }
    });
  }
  function gebInRechteck(s, w, n, o) {
    var aus = [], gesehen = new Set();
    for (var ci = Math.floor(s / RASTER); ci <= Math.floor(n / RASTER); ci++) {
      for (var cj = Math.floor(w / RASTER); cj <= Math.floor(o / RASTER); cj++) {
        var l = gebRaster.get(ci + "," + cj);
        if (!l) { continue; }
        l.forEach(function (b) {
          if (gesehen.has(b.id)) { return; }
          gesehen.add(b.id);
          if (b.bb[2] >= s && b.bb[0] <= n && b.bb[3] >= w && b.bb[1] <= o) { aus.push(b); }
        });
      }
    }
    return aus;
  }
  function flstInRechteck(s, w, n, o) {
    var aus = [];
    flst.forEach(function (f) { if (f.bb[2] >= s && f.bb[0] <= n && f.bb[3] >= w && f.bb[1] <= o) { aus.push(f); } });
    return aus;
  }

  // ---------- Kacheln laden: Warteschlange, Zwischenspeicher im Browser ----------
  // Gemessen: Der Dienst ist der Engpass. Eine dichte Kachel (Innenstadt) hat 0,6 bis 0,8 MB und braucht 0,5 bis 1,5 s; viele gleichzeitige
  // Anfragen machen ihn nicht schneller, sondern eher langsamer (12 Anfragen zugleich: 10 bis 20 s). Mehr Threads in der App helfen deshalb
  // beim Laden nicht. Was hilft: höchstens 3 Anfragen zugleich, die Kacheln in der Mitte des Fensters zuerst, nur die nötigen Eigenschaften,
  // Gebäude nur wenn sie gebraucht werden und jede Kachel für 14 Tage im Browser merken (IndexedDB), dann ist ein zweiter Besuch sofort da.
  var MAX_PARALLEL = 3, laufend = 0, wartend = [], fokus = { lat: STADT.mitte[0], lng: STADT.mitte[1] };
  var kachelF = new Map(), kachelG = new Map(), bereitG = new Set();
  function kachelMitte(i, j) { return { lat: (i + 0.5) * KACHEL_LA, lng: (j + 0.5) * KACHEL_LO }; }
  function kachelAbstand(i, j) { var m = kachelMitte(i, j); return Math.pow(m.lat - fokus.lat, 2) + Math.pow((m.lng - fokus.lng) * 0.6, 2); }
  function einreihen(aufgabe, i, j) {
    return new Promise(function (ok, fehler) { wartend.push({ a: aufgabe, ok: ok, fehler: fehler, i: i, j: j }); weiter(); });
  }
  function weiter() {
    while (laufend < MAX_PARALLEL && wartend.length) {
      var bestIdx = 0, bestD = Infinity;
      for (var q = 0; q < wartend.length; q++) { var d = kachelAbstand(wartend[q].i, wartend[q].j); if (d < bestD) { bestD = d; bestIdx = q; } }
      var e = wartend.splice(bestIdx, 1)[0];
      laufend++;
      (function (e) {
        e.a().then(function (r) { laufend--; e.ok(r); weiter(); }, function (x) { laufend--; e.fehler(x); weiter(); });
      })(e);
    }
  }
  var DB_NAME = "standortanalyse_grundstuecke", CACHE_TAGE = 14, CACHE_MAX = 600, dbVorgang = null;
  function dbOeffnen() {
    if (!dbVorgang) {
      dbVorgang = new Promise(function (ok, fehler) {
        if (!window.indexedDB) { fehler(new Error("kein IndexedDB")); return; }
        var a = indexedDB.open(DB_NAME, 1);
        a.onupgradeneeded = function () { a.result.createObjectStore("kacheln"); };
        a.onsuccess = function () {
          var db = a.result;
          try {      // zu viele gemerkte Kacheln: alles verwerfen (bleibt klein)
            var z = db.transaction("kacheln", "readonly").objectStore("kacheln").count();
            z.onsuccess = function () { if (z.result > CACHE_MAX) { db.transaction("kacheln", "readwrite").objectStore("kacheln").clear(); } };
          } catch (x) { /* egal */ }
          ok(db);
        };
        a.onerror = function () { fehler(a.error); };
      });
      dbVorgang.catch(function () { /* ohne Zwischenspeicher geht es auch */ });
    }
    return dbVorgang;
  }
  function cacheLies(key) {
    return dbOeffnen().then(function (db) {
      return new Promise(function (ok) {
        try {
          var r = db.transaction("kacheln", "readonly").objectStore("kacheln").get(key);
          r.onsuccess = function () { var v = r.result; ok(v && Date.now() - v.z < CACHE_TAGE * 864e5 ? v.d : null); };
          r.onerror = function () { ok(null); };
        } catch (x) { ok(null); }
      });
    }, function () { return null; });
  }
  function cacheSchreibe(key, d) {
    dbOeffnen().then(function (db) { try { db.transaction("kacheln", "readwrite").objectStore("kacheln").put({ z: Date.now(), d: d }, key); } catch (x) { /* egal */ } }, function () { /* egal */ });
  }
  // Eine Kachel eines Typs ("F" Flurstücke, "G" Gebäude): erst der Zwischenspeicher, sonst der Dienst
  function ladeKachelTyp(typ, i, j) {
    var map = typ === "F" ? kachelF : kachelG, key = i + "," + j;
    if (map.has(key)) { return map.get(key); }
    var s = i * KACHEL_LA, w = j * KACHEL_LO, n = s + KACHEL_LA, o = w + KACHEL_LO, pl = typ === "G" ? 0.0004 : 0, po = typ === "G" ? 0.0007 : 0;
    var p = cacheLies("v2|" + typ + "|" + key).then(function (d) {
      if (d) { return d; }
      return einreihen(function () { return holeGml(typ === "F" ? "Flurstueck" : "GebaeudeBauwerk", s - pl, w - po, n + pl, o + po); }, i, j).then(function (doc) {
        var liste = typ === "F" ? leseFlst(doc) : leseGeb(doc);
        cacheSchreibe("v2|" + typ + "|" + key, liste);
        return liste;
      });
    }).then(function (liste) {
      if (typ === "F") { fuegeFlst(liste); } else { fuegeGeb(liste); bereitG.add(key); }
    });
    map.set(key, p);
    p.catch(function () { map.delete(key); });     // beim nächsten Mal noch einmal versuchen
    return p;
  }
  function kachelnFuer(s, w, n, o) {
    var liste = [];
    for (var i = Math.floor(s / KACHEL_LA); i <= Math.floor(n / KACHEL_LA); i++) { for (var j = Math.floor(w / KACHEL_LO); j <= Math.floor(o / KACHEL_LO); j++) { liste.push([i, j]); } }
    return liste;
  }
  // Lädt alle Kacheln des Rechtecks (die mittleren zuerst). "mitGeb": auch die Gebäude. "beiKachel(i, j)" wird gerufen, sobald eine Kachel fertig ist.
  function ladeBereich(s, w, n, o, mitGeb, beiKachel) {
    fokus = { lat: (s + n) / 2, lng: (w + o) / 2 };
    return Promise.all(kachelnFuer(s, w, n, o).map(function (k) {
      var teile = [ladeKachelTyp("F", k[0], k[1])];
      if (mitGeb) { teile.push(ladeKachelTyp("G", k[0], k[1])); }
      return Promise.all(teile).then(function () { if (beiKachel) { beiKachel(k[0], k[1]); } });
    }));
  }
  // Sind die Gebäude für dieses Grundstück da (alle Kacheln, die es berührt)?
  function gebaeudeBereit(f) { return kachelnFuer(f.bb[0], f.bb[1], f.bb[2], f.bb[3]).every(function (k) { return bereitG.has(k[0] + "," + k[1]); }); }
  // ---------- Geometrie in Metern (Ursprung = Mitte des Grundstücks) ----------
  function lokalRing(ring, la0, lo0, kx) {
    var a = new Float64Array(ring.length * 2);
    for (var i = 0; i < ring.length; i++) { a[2 * i] = (ring[i][1] - lo0) * kx; a[2 * i + 1] = (ring[i][0] - la0) * M_LA; }
    return a;
  }
  function flaecheLokal(a) { var s = 0, n = a.length / 2; for (var i = 0, j = n - 1; i < n; j = i++) { s += a[2 * j] * a[2 * i + 1] - a[2 * i] * a[2 * j + 1]; } return Math.abs(s) / 2; }
  function pip(x, y, a) {
    var n = a.length / 2, c = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = a[2 * i], yi = a[2 * i + 1], xj = a[2 * j], yj = a[2 * j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) { c = !c; }
    }
    return c;
  }
  function imPoly(x, y, p) {
    if (x < p.bb[0] || x > p.bb[2] || y < p.bb[1] || y > p.bb[3]) { return false; }
    if (!pip(x, y, p.a)) { return false; }
    for (var i = 0; i < p.i.length; i++) { if (pip(x, y, p.i[i])) { return false; } }
    return true;
  }
  function imGrundstueck(x, y, L0) { for (var i = 0; i < L0.polys.length; i++) { if (imPoly(x, y, L0.polys[i])) { return true; } } return false; }
  function bbLokal(a) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < a.length; i += 2) { if (a[i] < x0) { x0 = a[i]; } if (a[i] > x1) { x1 = a[i]; } if (a[i + 1] < y0) { y0 = a[i + 1]; } if (a[i + 1] > y1) { y1 = a[i + 1]; } }
    return [x0, y0, x1, y1];
  }
  // Das Grundstück in lokalen Koordinaten (Meter, x = Ost, y = Nord)
  function lok(f) {
    if (f._lok) { return f._lok; }
    var la0 = f.mitte[0], lo0 = f.mitte[1], kx = M_LA * Math.cos(la0 * Math.PI / 180);
    var polys = f.polys.map(function (p) {
      var a = lokalRing(p.a, la0, lo0, kx);
      return { a: a, i: p.i.map(function (r) { return lokalRing(r, la0, lo0, kx); }), bb: bbLokal(a) };
    });
    var bb = [Infinity, Infinity, -Infinity, -Infinity], A = 0;
    polys.forEach(function (p) {
      bb = [Math.min(bb[0], p.bb[0]), Math.min(bb[1], p.bb[1]), Math.max(bb[2], p.bb[2]), Math.max(bb[3], p.bb[3])];
      A += flaecheLokal(p.a); p.i.forEach(function (r) { A -= flaecheLokal(r); });
    });
    f._lok = { la0: la0, lo0: lo0, kx: kx, polys: polys, bb: bb, A: A };
    return f._lok;
  }
  function gebLokal(b, L0) {
    return b.polys.map(function (p) { var a = lokalRing(p.a, L0.la0, L0.lo0, L0.kx); return { a: a, bb: bbLokal(a) }; });
  }

  // Fläche des Gebäudes, die auf dem Grundstück liegt. Schnelle Vorprüfung in Grad (ohne Umrechnen): liegen alle Ecken im Grundstück, zählt die
  // volle Fläche; liegt keine Ecke darin und nichts berührt sich, ist es 0 (typisch für Straßen-Flurstücke mit riesigem umschließendem Rechteck,
  // die vorher jedes Gebäude darin abgetastet haben: das war der Hauptgrund für die lange Rechenzeit). Nur Gebäude, die die Grenze wirklich
  // schneiden, werden abgetastet.
  function flachGrad(ring) { var a = new Float64Array(ring.length * 2); for (var i = 0; i < ring.length; i++) { a[2 * i] = ring[i][1]; a[2 * i + 1] = ring[i][0]; } return a; }
  function gradDaten(f) {
    if (f._deg) { return f._deg; }
    var polys = f.polys.map(function (p) { var a = flachGrad(p.a); return { a: a, i: p.i.map(flachGrad), bb: bbLokal(a) }; });
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach(function (p) { bb = [Math.min(bb[0], p.bb[0]), Math.min(bb[1], p.bb[1]), Math.max(bb[2], p.bb[2]), Math.max(bb[3], p.bb[3])]; });
    f._deg = { polys: polys, bb: bb };
    return f._deg;
  }
  function gebGrad(b) { if (!b._d) { var a = flachGrad(b.polys[0].a); b._d = { a: a, bb: bbLokal(a) }; } return b._d; }
  function strecken(ax, ay, bx, by, cx, cy, dx, dy) {       // schneiden sich die Strecken ab und cd?
    function o(px, py, qx, qy, rx, ry) { return (qx - px) * (ry - py) - (qy - py) * (rx - px); }
    var d1 = o(ax, ay, bx, by, cx, cy), d2 = o(ax, ay, bx, by, dx, dy), d3 = o(cx, cy, dx, dy, ax, ay), d4 = o(cx, cy, dx, dy, bx, by);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function beruehrenSich(D, gd) {        // Grundstücksgrenze und Gebäude, wenn keine Gebäudeecke im Grundstück liegt
    var ga = gd.a, gb = gd.bb, ringe = [];
    D.polys.forEach(function (p) { ringe.push(p.a); p.i.forEach(function (r) { ringe.push(r); }); });
    for (var q = 0; q < ringe.length; q++) {
      var r = ringe[q], n = r.length / 2;
      for (var i = 0; i < n; i++) {                       // liegt eine Ecke des Grundstücks im Gebäude?
        var x = r[2 * i], y = r[2 * i + 1];
        if (x >= gb[0] && x <= gb[2] && y >= gb[1] && y <= gb[3] && pip(x, y, ga)) { return true; }
      }
      for (var k = 0, j = n - 1; k < n; j = k++) {        // schneiden sich Kanten?
        var ax = r[2 * j], ay = r[2 * j + 1], bx = r[2 * k], by = r[2 * k + 1];
        if (Math.max(ax, bx) < gb[0] || Math.min(ax, bx) > gb[2] || Math.max(ay, by) < gb[1] || Math.min(ay, by) > gb[3]) { continue; }
        for (var u = 0, v = ga.length / 2 - 1; u < ga.length / 2; v = u++) {
          if (strecken(ax, ay, bx, by, ga[2 * v], ga[2 * v + 1], ga[2 * u], ga[2 * u + 1])) { return true; }
        }
      }
    }
    return false;
  }
  function innenFlaeche(b, f, L0) {
    var D = gradDaten(f), gd = gebGrad(b);
    if (gd.bb[2] < D.bb[0] || gd.bb[0] > D.bb[2] || gd.bb[3] < D.bb[1] || gd.bb[1] > D.bb[3]) { return 0; }
    var n = gd.a.length / 2, innen = 0;
    for (var i = 0; i < n; i++) { if (imGrundstueck(gd.a[2 * i], gd.a[2 * i + 1], D)) { innen++; } }
    if (innen === n) { return b.fl; }
    if (innen === 0 && !beruehrenSich(D, gd)) { return 0; }
    // Das Gebäude schneidet die Grundstücksgrenze: Fläche durch Abtasten
    var gp = gebLokal(b, L0), g0 = gp[0];
    var x0 = Math.max(g0.bb[0], L0.bb[0]), y0 = Math.max(g0.bb[1], L0.bb[1]), x1 = Math.min(g0.bb[2], L0.bb[2]), y1 = Math.min(g0.bb[3], L0.bb[3]);
    if (x1 <= x0 || y1 <= y0) { return 0; }
    var schritt = Math.max(0.2, Math.sqrt((x1 - x0) * (y1 - y0) / 5000)), z = 0;
    for (var y = y0 + schritt / 2; y < y1; y += schritt) {
      for (var x = x0 + schritt / 2; x < x1; x += schritt) {
        var inG = false;
        for (var q = 0; q < gp.length; q++) { if (pip(x, y, gp[q].a)) { inG = true; break; } }
        if (inG && imGrundstueck(x, y, L0)) { z++; }
      }
    }
    return z * schritt * schritt;
  }  // Überbaute Fläche eines Grundstücks, getrennt nach Hauptgebäuden, Garagen und Nebengebäuden, sonstigen Bauwerken (Überdachungen)
  function bebauung(f) {
    var L0 = lok(f), erg = { haupt: 0, neben: 0, sonst: 0, nHaupt: 0, teile: [] };
    gebInRechteck(f.bb[0], f.bb[1], f.bb[2], f.bb[3]).forEach(function (b) {
      var a = innenFlaeche(b, f, L0);
      if (a < 0.5) { return; }
      erg[b.art] += a;
      if (b.art === "haupt") { erg.nHaupt++; }
      erg.teile.push({ b: b, a: a });
    });
    return erg;
  }
  function grzGebaeude(f) {          // für die Einfärbung: alle Gebäude (ohne Überdachungen) geteilt durch die Grundstücksfläche
    if (f._grz === undefined) {
      var A = lok(f).A;
      if (A < 20) { f._grz = null; } else { var b = bebauung(f); f._grz = (b.haupt + b.neben) / A; }
    }
    return f._grz;
  }

  // ---------- Gebäudehöhen (LGLN) für die Schätzung der Geschosse ----------
  // Die Höhen werden in Kacheln geladen, und zwar nur für die Umgebung des Grundstücks (bb = [Süd, West, Nord, Ost]); hoehenIdx ist dann gesetzt.
  // Wählt man später ein Grundstück außerhalb des geladenen Bereichs, werden dort die Kacheln nachgeladen.
  var hoehenIdx = null, hoehenSchon = null, hoehenBereiche = [];
  function hoehenBox(bb) { return { s: bb[0] - 0.004, w: bb[1] - 0.006, n: bb[2] + 0.004, o: bb[3] + 0.006 }; }
  function hoehenGedeckt(bb) {
    if (!hoehenIdx || !bb) { return false; }
    var b = hoehenBox(bb);
    return hoehenBereiche.some(function (r) { return r.s <= b.s && r.n >= b.n && r.w <= b.w && r.o >= b.o; });
  }
  function holeHoehen(bb) {
    bb = bb || (S.f ? S.f.bb : null);
    if (!bb) { return Promise.reject(new Error("Kein Grundstück gewählt")); }
    if (hoehenGedeckt(bb)) { return Promise.resolve(hoehenIdx); }
    var box = hoehenBox(bb);
    return window.ladeAnsicht3d().then(function () { return window.ansicht3d.daten.gebaeude(box); }).then(function (liste) {
      if (!hoehenIdx) { hoehenIdx = new Map(); hoehenSchon = new Set(); }
      liste.forEach(function (g) {
        if (hoehenSchon.has(g)) { return; }
        hoehenSchon.add(g);
        var key = Math.floor(g.lat / RASTER) + "," + Math.floor(g.lng / RASTER), l = hoehenIdx.get(key);
        if (!l) { l = []; hoehenIdx.set(key, l); }
        l.push(g);
      });
      hoehenBereiche.push(box);
      return hoehenIdx;
    });
  }  function pipGrad(lat, lng, ring) {
    var c = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) { c = !c; }
    }
    return c;
  }
  // Traufhöhe (m über Boden) des Gebäudes aus den LGLN-Höhen; gibt null zurück, wenn kein passendes Gebäude gefunden wurde
  function traufhoehe(b) {
    if (b._t !== undefined) { return b._t; }
    var best = null;
    for (var ci = Math.floor(b.bb[0] / RASTER); ci <= Math.floor(b.bb[2] / RASTER); ci++) {
      for (var cj = Math.floor(b.bb[1] / RASTER); cj <= Math.floor(b.bb[3] / RASTER); cj++) {
        var l = hoehenIdx.get(ci + "," + cj);
        if (!l) { continue; }
        l.forEach(function (g) {
          if (g.lat < b.bb[0] || g.lat > b.bb[2] || g.lng < b.bb[1] || g.lng > b.bb[3]) { return; }
          if (pipGrad(g.lat, g.lng, b.polys[0].a) && (best === null || g.t > best)) { best = g.t; }
        });
      }
    }
    b._t = best;
    return best;
  }
  function geschosse(b) {
    var t = traufhoehe(b);
    return t === null ? null : Math.max(1, Math.min(12, Math.round(t / GESCHOSSHOEHE)));
  }
  // Geschossfläche des Bestands (Schätzung): Hauptgebäude mit geschätzter Geschosszahl, Nebengebäude mit einem Geschoss
  function geschossflaeche(ber, vorgabe) {
    var gf = 0, unbekannt = 0;
    ber.teile.forEach(function (t) {
      if (t.b.art === "haupt") {
        var n = vorgabe > 0 ? vorgabe : (hoehenIdx ? geschosse(t.b) : null);
        if (n === null) { unbekannt++; n = 1; }
        gf += t.a * n;
      }
    });
    return { gf: gf, unbekannt: unbekannt };
  }

  // ---------- Baufeld: Grundstück verkleinert um den Abstand zur Grenze ----------
  function abstandsFeld(f, L0) {
    var bb = L0.bb, W = bb[2] - bb[0], H = bb[3] - bb[1];
    var zelle = Math.max(0.5, Math.max(W, H) / 280);
    var nx = Math.ceil(W / zelle) + 3, ny = Math.ceil(H / zelle) + 3, x0 = bb[0] - zelle, y0 = bb[1] - zelle;
    // alle Kanten der Grundstücksgrenze (außen und innen)
    var kanten = [];
    L0.polys.forEach(function (p) {
      [p.a].concat(p.i).forEach(function (a) { var n = a.length / 2; for (var i = 0, j = n - 1; i < n; j = i++) { kanten.push(a[2 * j], a[2 * j + 1], a[2 * i], a[2 * i + 1]); } });
    });
    var s = new Float32Array(nx * ny);
    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var x = x0 + i * zelle, y = y0 + j * zelle, d = Infinity;
        for (var k = 0; k < kanten.length; k += 4) {
          var ax = kanten[k], ay = kanten[k + 1], bx = kanten[k + 2], by = kanten[k + 3], dx = bx - ax, dy = by - ay;
          var l2 = dx * dx + dy * dy, t = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          var ex = ax + t * dx - x, ey = ay + t * dy - y, dd = ex * ex + ey * ey;
          if (dd < d) { d = dd; }
        }
        d = Math.sqrt(d);
        s[j * nx + i] = imGrundstueck(x, y, L0) ? d : -d;
      }
    }
    return { s: s, nx: nx, ny: ny, x0: x0, y0: y0, zelle: zelle };
  }
  // Höhenlinie (Marching Squares) der Abstandskarte beim Abstand "level": geschlossene Linienzüge in Metern
  function kontur(F, level) {
    var s = F.s, nx = F.nx, ny = F.ny, zelle = F.zelle, x0 = F.x0, y0 = F.y0;
    var segmente = [], punkte = {};
    function pH(i, j) { var a = s[j * nx + i] - level, b = s[j * nx + i + 1] - level, t = a / (a - b); return [x0 + (i + t) * zelle, y0 + j * zelle]; }
    function pV(i, j) { var a = s[j * nx + i] - level, b = s[(j + 1) * nx + i] - level, t = a / (a - b); return [x0 + i * zelle, y0 + (j + t) * zelle]; }
    function kante(art, i, j) { var key = art + i + "," + j; if (!punkte[key]) { punkte[key] = art === "h" ? pH(i, j) : pV(i, j); } return key; }
    var TAB = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]] };
    for (var j = 0; j < ny - 1; j++) {
      for (var i = 0; i < nx - 1; i++) {
        var v0 = s[j * nx + i] >= level, v1 = s[j * nx + i + 1] >= level, v2 = s[(j + 1) * nx + i + 1] >= level, v3 = s[(j + 1) * nx + i] >= level;
        var fall = (v0 ? 1 : 0) | (v1 ? 2 : 0) | (v2 ? 4 : 0) | (v3 ? 8 : 0);
        if (fall === 0 || fall === 15) { continue; }
        var paare;
        if (fall === 5 || fall === 10) {
          var mitteInnen = (s[j * nx + i] + s[j * nx + i + 1] + s[(j + 1) * nx + i + 1] + s[(j + 1) * nx + i]) / 4 >= level;
          if (fall === 5) { paare = mitteInnen ? [[3, 2], [0, 1]] : [[3, 0], [1, 2]]; }
          else { paare = mitteInnen ? [[3, 0], [1, 2]] : [[3, 2], [0, 1]]; }
        } else { paare = TAB[fall]; }
        var keys = [kante("h", i, j), kante("v", i + 1, j), kante("h", i, j + 1), kante("v", i, j)];     // unten, rechts, oben, links
        paare.forEach(function (p) { segmente.push([keys[p[0]], keys[p[1]]]); });
      }
    }
    // Segmente zu Linienzügen verbinden
    var nachbar = {};
    segmente.forEach(function (sg, idx) { sg.forEach(function (k) { (nachbar[k] = nachbar[k] || []).push(idx); }); });
    var benutzt = new Array(segmente.length), ringe = [];
    for (var a = 0; a < segmente.length; a++) {
      if (benutzt[a]) { continue; }
      var ring = [], start = segmente[a][0], aktuell = segmente[a][1], seg = a;
      benutzt[a] = true; ring.push(punkte[start]);
      var schutz = 0;
      while (aktuell !== start && schutz++ < 200000) {
        ring.push(punkte[aktuell]);
        var weiter = (nachbar[aktuell] || []).filter(function (q) { return !benutzt[q]; })[0];
        if (weiter === undefined) { break; }
        benutzt[weiter] = true; seg = weiter;
        aktuell = segmente[weiter][0] === aktuell ? segmente[weiter][1] : segmente[weiter][0];
      }
      if (ring.length >= 3) { ringe.push(ring); }
    }
    return ringe.map(function (r) { return vereinfache(r, 0.15); });
  }
  function vereinfache(r, tol) {        // Douglas-Peucker für einen geschlossenen Linienzug
    if (r.length < 5) { return r; }
    function abstandPunktStrecke(p, a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
    }
    function dp(p, von, bis, behalten) {
      var maxd = 0, idx = -1;
      for (var i = von + 1; i < bis; i++) { var d = abstandPunktStrecke(p[i], p[von], p[bis]); if (d > maxd) { maxd = d; idx = i; } }
      if (maxd > tol && idx > 0) { behalten[idx] = true; dp(p, von, idx, behalten); dp(p, idx, bis, behalten); }
    }
    // am weitesten entfernten Punkt als zweiten Ankerpunkt nehmen
    var h = 0, md = 0; for (var i = 1; i < r.length; i++) { var d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > md) { md = d; h = i; } }
    var b1 = {}, b2 = {}; b1[0] = true; b1[h] = true; b2[h] = true;
    var teil1 = r.slice(0, h + 1), teil2 = r.slice(h).concat([r[0]]);
    var k1 = {}, k2 = {}; k1[0] = true; k1[teil1.length - 1] = true; k2[0] = true; k2[teil2.length - 1] = true;
    dp(teil1, 0, teil1.length - 1, k1); dp(teil2, 0, teil2.length - 1, k2);
    var aus = [];
    teil1.forEach(function (p, i) { if (k1[i]) { aus.push(p); } });
    teil2.forEach(function (p, i) { if (i > 0 && i < teil2.length - 1 && k2[i]) { aus.push(p); } });
    return aus;
  }
  function ringeFlaeche(ringe) { var s = 0; ringe.forEach(function (r) { var a = new Float64Array(r.length * 2); r.forEach(function (p, i) { a[2 * i] = p[0]; a[2 * i + 1] = p[1]; }); s += flaecheLokal(a); }); return s; }
  // Baufeld bei einem Abstand; ist die Fläche größer als "maxFl" (GRZ), wird der Abstand erhöht, bis es passt
  function baufeld(F, abstand, maxFl) {
    var ringe = kontur(F, abstand), fl = ringeFlaeche(ringe), voll = fl, d = abstand;
    if (maxFl > 0 && fl > maxFl) {
      var lo = abstand, hi = abstand, maxS = 0; for (var i = 0; i < F.s.length; i++) { if (F.s[i] > maxS) { maxS = F.s[i]; } }
      hi = maxS;
      for (var it = 0; it < 14; it++) {
        var mid = (lo + hi) / 2, r = kontur(F, mid), a = ringeFlaeche(r);
        if (a > maxFl) { lo = mid; } else { hi = mid; ringe = r; fl = a; d = mid; }
      }
      if (ringe.length === 0 || ringeFlaeche(ringe) > maxFl * 1.02) { ringe = kontur(F, hi); fl = ringeFlaeche(ringe); d = hi; }
    }
    return { ringe: ringe, flaeche: fl, voll: voll, abstand: d };
  }
  function ringeInGrad(ringe, L0) {
    return ringe.map(function (r) { return r.map(function (p) { return [L0.la0 + p[1] / M_LA, L0.lo0 + p[0] / L0.kx]; }); });
  }
  // Wie viel vom Baufeld ist noch frei (ohne Bestand)?
  function freiImBaufeld(F, L0, abstand, ber) {
    var gp = ber.teile.map(function (t) { return gebLokal(t.b, L0); }), n = 0;
    for (var j = 0; j < F.ny; j++) {
      for (var i = 0; i < F.nx; i++) {
        if (F.s[j * F.nx + i] < abstand) { continue; }
        var x = F.x0 + i * F.zelle, y = F.y0 + j * F.zelle, belegt = false;
        for (var q = 0; q < gp.length && !belegt; q++) { for (var r = 0; r < gp[q].length; r++) { if (pip(x, y, gp[q][r].a)) { belegt = true; break; } } }
        if (!belegt) { n++; }
      }
    }
    return n * F.zelle * F.zelle;
  }

  // ---------- Zustand der Analyse ----------
  var S = { f: null, ber: null, umg: null, bau: null, token: 0, zeigeBaufeld: false };
  var auswahlEbene = null, baufeldPoly = null, auswahlPoly = null;

  function nutzText(f) { return String(f.nutz || "").split("|").map(function (s) { return s.replace(/;\d+$/, ""); }).join(", "); }
  function bezeichnung(f) { return (f.adr || "ohne Lagebezeichnung") + " (" + f.gem + ", Flur " + f.flur + ", Flurstück " + f.nr + ")"; }
  function gebietVorschlag(f) {
    var t = f.nutz || "";
    if (/Handel und Dienstleistung/i.test(t)) { return "MK"; }
    if (/Wohnbau/i.test(t)) { return "WA"; }
    if (/gemischt/i.test(t)) { return "MI"; }
    if (/Industrie|Gewerbe/i.test(t)) { return "GE"; }
    if (/besonderer funktionaler/i.test(t)) { return "SO"; }
    return "WA";
  }
  function setzeMeldung(text, fehler) { var m = el("grundMeldung"); m.textContent = text || ""; m.className = "meldung" + (fehler ? " fehler" : ""); }

  function zeile(behaelter, name, wert, hervor) {
    var z = document.createElement("div"); z.className = "grundZeile" + (hervor ? " hervor" : "") + (String(wert).length > 34 ? " lang" : "");
    var a = document.createElement("span"); a.textContent = name;
    var b = document.createElement("strong"); b.textContent = wert;
    z.appendChild(a); z.appendChild(b); behaelter.appendChild(z);
    return z;
  }
  function absatz(behaelter, text) { var p = document.createElement("p"); p.className = "hinweis"; p.style.margin = "4px 0"; p.textContent = text; behaelter.appendChild(p); return p; }

  // ---------- Auswahl eines Grundstücks ----------
  function ebeneAuswahl() {
    if (!auswahlEbene) { auswahlEbene = L.layerGroup().addTo(karte); }
    return auswahlEbene;
  }
  function zeigeAuswahl() {
    var e = ebeneAuswahl(); e.clearLayers(); auswahlPoly = null; baufeldPoly = null;
    if (!S.f) { return; }
    auswahlPoly = L.polygon(S.f.polys.map(function (p) { return [p.a].concat(p.i); }), { renderer: renderer("grundLinienPane"), color: "#c0392b", weight: 3, fill: false, interactive: false }).addTo(e);
    if (S.zeigeBaufeld && S.bau && S.bau.ringeGrad && S.bau.ringeGrad.length) {
      baufeldPoly = L.polygon(S.bau.ringeGrad, { renderer: renderer("grundLinienPane"), color: "#c0392b", weight: 2, dashArray: "6 4", fillColor: "#c0392b", fillOpacity: 0.25, interactive: false }).addTo(e);
    }
  }
  function waehleGrundstueck(f, optionen) {
    optionen = optionen || {};
    var token = ++S.token;
    S.f = f; S.ber = null; S.umg = null; S.bau = null; S.g = null; S.feld = null; S.pot = null;
    S.eigeneWerte = !!optionen.behalteWerte;      // true: Werte kommen vom Nutzer (zum Beispiel aus einem Projekt), nicht überschreiben
    el("grundDaten").hidden = false;
    if (!optionen.behalteWerte) {
      var g = gebietVorschlag(f);
      el("grundGebiet").value = g;
      el("grundGrz").value = String(GEBIETE[g].grz).replace(".", ",");
      el("grundGfz").value = String(GEBIETE[g].gfz).replace(".", ",");
      el("grundGeschosse").value = ""; el("grundAbstand").value = ""; el("grundBestandGeschosse").value = "";
    }
    setzeMeldung("");
    zeigeAuswahl();
    // Gebäude rund um das Grundstück laden (auch die der Nachbarn für den Vergleich)
    var ra = 0.0012, ro = 0.002;
    ladeBereich(f.bb[0] - ra, f.bb[1] - ro, f.bb[2] + ra, f.bb[3] + ro, true).then(function () {
      return hoehenIdx ? holeHoehen(f.bb).catch(function () { /* ohne Höhen bleibt die GFZ ungeschätzt */ }) : null;      // schon geladene Höhen: für das neue Grundstück nachladen
    }).then(function () {
      if (token !== S.token) { return; }
      S.ber = bebauung(f);
      aktualisiereAnzeige();
      umgebungRechnen(token);
    }).catch(function (x) { if (token === S.token) { setzeMeldung("Die Gebäude des Katasters konnten nicht geladen werden (kein Internet oder der Dienst ist gerade nicht erreichbar).", true); if (window.console) { console.error(x); } } });
    aktualisiereAnzeige();
    potenzialLaden(token);
  }
  function umgebungRechnen(token) {
    var f = S.f; if (!f) { return; }
    var kx = M_LA * Math.cos(f.mitte[0] * Math.PI / 180);
    var nachbarn = flstInRechteck(f.mitte[0] - UMGEBUNG_RADIUS / M_LA - 0.0005, f.mitte[1] - UMGEBUNG_RADIUS / kx - 0.0008, f.mitte[0] + UMGEBUNG_RADIUS / M_LA + 0.0005, f.mitte[1] + UMGEBUNG_RADIUS / kx + 0.0008).filter(function (n) {
      if (n === f) { return false; }
      var dx = (n.mitte[1] - f.mitte[1]) * kx, dy = (n.mitte[0] - f.mitte[0]) * M_LA;
      return Math.sqrt(dx * dx + dy * dy) <= UMGEBUNG_RADIUS && lok(n).A >= 100;
    }).slice(0, 60);
    var grz = [], grzH = [], ges = [], n = 0;
    nachbarn.forEach(function (nb) {
      var b = bebauung(nb);
      if (b.haupt <= 0) { return; }
      n++;
      var A = lok(nb).A;
      grz.push((b.haupt + b.neben) / A); grzH.push(b.haupt / A);
      if (hoehenIdx) { b.teile.forEach(function (t) { if (t.b.art === "haupt") { var g = geschosse(t.b); if (g !== null) { ges.push(g); } } }); }
    });
    if (token !== S.token) { return; }
    S.umg = { n: n, grz: grz, grzH: grzH, ges: ges };
    aktualisiereAnzeige();
  }

  // ---------- Bodenrichtwert, Planung, Lärm und Schutzgebiete am Grundstück ----------
  var POT_IDS = ["bodenrichtwerte", "bplan", "nsg", "lsg", "biotope", "wallhecken", "laerm_lden", "laerm_nacht"];
  // Nutzungskürzel der Bodenrichtwertzonen -> Gebietsart der App (nur wo eindeutig) und Klartext
  var BRW_NUTZUNG = {
    W: ["WA", "Wohnbaufläche"], WEFH: ["WA", "Wohnbaufläche (Ein- und Zweifamilienhäuser)"], WMFH: ["WA", "Wohnbaufläche (Mehrfamilienhäuser)"],
    WA: ["WA", "Allgemeines Wohngebiet"], WAEFH: ["WA", "Allgemeines Wohngebiet (Ein- und Zweifamilienhäuser)"], WASB: ["WA", "Allgemeines Wohngebiet"],
    WR: ["WR", "Reines Wohngebiet"], WREFH: ["WR", "Reines Wohngebiet (Ein- und Zweifamilienhäuser)"], WS: ["WS", "Kleinsiedlungsgebiet"], WB: ["WB", "Besonderes Wohngebiet"],
    M: ["MI", "gemischte Baufläche"], MI: ["MI", "Mischgebiet"], MD: ["MD", "Dorfgebiet"], MU: ["MU", "Urbanes Gebiet"], MK: ["MK", "Kerngebiet"],
    G: ["GE", "gewerbliche Baufläche"], GE: ["GE", "Gewerbegebiet"], GI: ["GI", "Industriegebiet"],
    SO: ["SO", "Sondergebiet"], SOEKZ: ["SO", "Sondergebiet (Einkaufszentrum)"], GB: [null, "Fläche für den Gemeinbedarf"]
  };
  // Was die Baunutzungsverordnung je Gebietsart allgemein zulässt (verkürzt) und was nur ausnahmsweise geht
  var NUTZUNG_ZULAESSIG = {
    WS:  ["Kleinsiedlungen mit Gärten, Wohngebäude, Läden und nicht störende Handwerksbetriebe zur Versorgung", "Betriebe des Beherbergungsgewerbes, sonstige nicht störende Gewerbebetriebe, Gartenbau"],
    WR:  ["Wohngebäude, Anlagen zur Kinderbetreuung für den Bedarf des Gebiets", "kleine Beherbergungsbetriebe, Anlagen für soziale, kulturelle, gesundheitliche und sportliche Zwecke"],
    WA:  ["Wohngebäude, der Versorgung dienende Läden, Schank- und Speisewirtschaften, nicht störende Handwerksbetriebe, Anlagen für kirchliche, kulturelle, soziale, gesundheitliche und sportliche Zwecke", "Beherbergungsbetriebe, sonstige nicht störende Gewerbebetriebe, Verwaltungen, Gartenbaubetriebe, Tankstellen"],
    WB:  ["Wohngebäude, Läden, Betriebe des Beherbergungsgewerbes, sonstige Gewerbebetriebe, Verwaltungen, Anlagen für kirchliche, kulturelle, soziale, gesundheitliche und sportliche Zwecke", "Vergnügungsstätten, Tankstellen"],
    MD:  ["Wohngebäude, land- und forstwirtschaftliche Betriebe, Einzelhandel, Gastronomie, Beherbergung, sonstige Gewerbebetriebe, Verwaltungen, Anlagen für soziale und kulturelle Zwecke", "Gartenbaubetriebe, Tankstellen, Vergnügungsstätten"],
    MI:  ["Wohngebäude, Geschäfts- und Bürogebäude, Einzelhandel, Gastronomie, Beherbergung, sonstige nicht wesentlich störende Gewerbebetriebe, Verwaltungen, Anlagen für kirchliche, kulturelle, soziale, gesundheitliche und sportliche Zwecke, Gartenbaubetriebe, Tankstellen", "Vergnügungsstätten (nur in überwiegend gewerblich geprägten Teilen)"],
    MU:  ["Wohnen, Geschäfts- und Bürogebäude, Einzelhandel, Gastronomie, Beherbergung, sonstige Gewerbebetriebe, Verwaltungen, Anlagen für soziale, kulturelle, gesundheitliche und sportliche Zwecke", "Vergnügungsstätten, Tankstellen"],
    MK:  ["Geschäfts-, Verwaltungs- und Bürogebäude, Einzelhandel, Gastronomie, Beherbergung, Vergnügungsstätten, Anlagen für kirchliche, kulturelle, soziale, gesundheitliche und sportliche Zwecke, Tankstellen", "Wohnungen (nur wie im Bebauungsplan festgesetzt oder ab einem bestimmten Geschoss)"],
    GE:  ["Gewerbebetriebe aller Art (nicht erheblich belästigend), Lagerhäuser, öffentliche Betriebe, Geschäfts-, Büro- und Verwaltungsgebäude, Tankstellen, Anlagen für sportliche Zwecke", "Wohnungen für Aufsichts- und Bereitschaftspersonen, Anlagen für soziale, kirchliche, kulturelle und gesundheitliche Zwecke"],
    GI:  ["Gewerbebetriebe aller Art, besonders erheblich belästigende Betriebe, Lagerhäuser, Tankstellen", "Wohnungen für Aufsichts- und Bereitschaftspersonen"],
    SO:  ["nur, was im Bebauungsplan für das Sondergebiet festgesetzt ist (zum Beispiel Handel, Hochschule, Hafen, Erholung)", ""],
    FREI: ["nach den Festsetzungen im Bebauungsplan", ""]
  };
  function imRing(lat, lng, ring) {          // Strahlverfahren für einen Ring [Breite, Länge, Breite, Länge, ...]
    var c = false;
    for (var i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      var yi = ring[i], xi = ring[i + 1], yj = ring[j], xj = ring[j + 1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) { c = !c; }
    }
    return c;
  }
  function imFlaeche(fl, lat, lng) {         // Außenring und Löcher: ungerade Zahl von Ringen = innen
    if (lat < fl.s || lat > fl.n || lng < fl.w || lng > fl.o) { return false; }
    var n = 0; fl.ringe.forEach(function (r) { if (imRing(lat, lng, r)) { n++; } });
    return n % 2 === 1;
  }
  // Einige Punkte innerhalb des Grundstücks (Mitte zuerst), für die Abfragen "liegt auf dem Grundstück"
  function probePunkte(f) {
    var L0 = lok(f), pts = [], bb = f.bb, N = 6;
    var mx = (f.mitte[1] - L0.lo0) * L0.kx, my = (f.mitte[0] - L0.la0) * M_LA;
    if (imGrundstueck(mx, my, L0)) { pts.push([f.mitte[0], f.mitte[1]]); }
    for (var i = 0; i < N; i++) {
      for (var j = 0; j < N; j++) {
        var la = bb[0] + (bb[2] - bb[0]) * (i + 0.5) / N, lo = bb[1] + (bb[3] - bb[1]) * (j + 0.5) / N;
        if (imGrundstueck((lo - L0.lo0) * L0.kx, (la - L0.la0) * M_LA, L0)) { pts.push([la, lo]); }
      }
    }
    if (!pts.length) { pts.push([f.mitte[0], f.mitte[1]]); }
    return pts;
  }
  var potVorgang = null;
  function potenzialLaden(token) {
    var f = S.f; if (!f) { return Promise.resolve(); }
    var gruppen = FLAECHEN.filter(function (g) { return POT_IDS.indexOf(g.id) >= 0 || g.fnp; });
    S.pot = null;
    return ladeFlaechenDaten(gruppen).then(function (daten) {
      if (token !== S.token) { return; }
      var P = probePunkte(f), pot = { fnp: [], laerm: {}, schutz: {}, bplan: false, brw: null, brwAndere: 0, hat: {} };
      // Welche Daten gibt es für die gewählte Stadt überhaupt? (Fehlende Ebenen sind nicht in FLAECHEN, siehe staedte.js)
      POT_IDS.forEach(function (id) { pot.hat[id] = FLAECHEN.some(function (g) { return g.id === id; }); });
      function trifft(id, punkte) { return (daten[id] || []).some(function (fl) { return punkte.some(function (p) { return imFlaeche(fl, p[0], p[1]); }); }); }
      // Bodenrichtwertzone: die kleinste Zone, die die Grundstücksmitte enthält (sonst irgendeinen Probepunkt)
      var zonen = [];
      for (var k = 0; k < P.length && !zonen.length; k++) { zonen = (daten.bodenrichtwerte || []).filter(function (fl) { return imFlaeche(fl, P[k][0], P[k][1]); }); }
      if (zonen.length) {
        zonen.sort(function (a, b) { return (a.n - a.s) * (a.o - a.w) - (b.n - b.s) * (b.o - b.w); });
        pot.brw = zonen[0].z; pot.brwAndere = zonen.length - 1;
      }
      pot.bplan = trifft("bplan", P.slice(0, 1));
      FLAECHEN.forEach(function (g) { if (g.fnp && trifft(g.id, P.slice(0, 1))) { pot.fnp.push(g.name); } });
      ["nsg", "lsg", "biotope", "wallhecken"].forEach(function (id) { pot.schutz[id] = trifft(id, P); });
      // Lärm: höchste Klasse auf einem der Probepunkte (höchstens 12 Punkte, die Dateien sind groß)
      ["laerm_lden", "laerm_nacht"].forEach(function (id) {
        var gr = FLAECHEN.filter(function (g) { return g.id === id; })[0];
        if (!gr) { pot.laerm[id] = null; return; }     // keine Lärmdaten für diese Stadt
        var keys = Object.keys(gr.klassen), best = -1, pp = P.length > 12 ? P.filter(function (p, i) { return i % Math.ceil(P.length / 12) === 0; }) : P;
        (daten[id] || []).forEach(function (fl) {
          var ix = keys.indexOf(fl.a); if (ix <= best) { return; }
          if (pp.some(function (p) { return imFlaeche(fl, p[0], p[1]); })) { best = ix; }
        });
        pot.laerm[id] = best >= 0 ? { text: gr.klassen[keys[best]][1], stufe: best } : null;
      });
      S.pot = pot;
      brwGebietUebernehmen();
      aktualisiereAnzeige();
    }).catch(function (x) { if (token === S.token) { S.pot = { fehler: true }; aktualisiereAnzeige(); } if (window.console) { console.error(x); } });
  }
  // Die Gebietsart aus der Bodenrichtwertzone vorschlagen, solange der Nutzer nichts selbst eingestellt hat
  function brwGebiet(pot) {
    if (!pot || !pot.brw) { return null; }
    var e = BRW_NUTZUNG[pot.brw[3]]; return e && e[0] ? e[0] : null;
  }
  function brwGebietUebernehmen() {
    if (S.eigeneWerte || !S.pot) { return; }
    var g = brwGebiet(S.pot);
    if (g && GEBIETE[g] && el("grundGebiet").value !== g) {
      el("grundGebiet").value = g;
      el("grundGrz").value = String(GEBIETE[g].grz).replace(".", ","); el("grundGfz").value = String(GEBIETE[g].gfz).replace(".", ",");
      el("grundGeschosse").value = ""; el("grundAbstand").value = "";
    }
  }

  function amPunkt(still) {
    if (!marker) { if (!still) { setzeMeldung("Bitte zuerst eine Adresse suchen (Abschnitt 01). Dann ist das Grundstück am roten Punkt gewählt.", true); } return Promise.resolve(); }
    var ll = marker.getLatLng();
    return suche(ll, still);
  }
  function suche(ll, still) {
    setzeMeldung("Grundstück wird gesucht …");
    var kl = Math.floor(ll.lat / KACHEL_LA), kj = Math.floor(ll.lng / KACHEL_LO);
    return ladeKachelTyp("F", kl, kj).then(function () {
      var treffer = null;
      flstInRechteck(ll.lat - 1e-6, ll.lng - 1e-6, ll.lat + 1e-6, ll.lng + 1e-6).forEach(function (f) {
        var L0 = lok(f), x = (ll.lng - L0.lo0) * L0.kx, y = (ll.lat - L0.la0) * M_LA;
        if (!treffer && imGrundstueck(x, y, L0)) { treffer = f; }
      });
      if (!treffer) { if (!still) { setzeMeldung("An dieser Stelle wurde kein Grundstück gefunden (zum Beispiel Straße oder außerhalb von Niedersachsen).", true); } else { setzeMeldung(""); } return; }
      waehleGrundstueck(treffer);
    }).catch(function () { setzeMeldung("Der Katasterdienst ist gerade nicht erreichbar (Internet prüfen).", true); });
  }

  // Auswahl per Klick in die Karte
  function klickStarten() {
    if (typeof zeichenSetzeWerkzeug === "function") { zeichenSetzeWerkzeug("auswahl"); }
    if (typeof planWahl !== "undefined" && planWahl) { planAbbrechenWahl(); }
    if (typeof fotoWahl !== "undefined" && fotoWahl) { fotoWahlBeenden(true); }
    grundWahl = true;
    document.getElementById("karte").classList.add("plan-wahl");
    setzeKartenStatus("Klicke auf das Grundstück, das du untersuchen möchtest (Esc bricht ab).");
  }
  function klickBeenden() {
    if (!grundWahl) { return; }
    grundWahl = false;
    document.getElementById("karte").classList.remove("plan-wahl");
    setzeKartenStatus("");
  }
  karte.on("click", function (ereignis) {
    if (!grundWahl) { return; }
    klickBeenden();
    if (karte.getZoom() < MIN_ZOOM) { karte.setView(ereignis.latlng, MIN_ZOOM); }
    suche(ereignis.latlng, false);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && grundWahl) { klickBeenden(); } });

  // ---------- Anzeige der Ergebnisse ----------
  function rechne() {
    var f = S.f, ber = S.ber;
    if (!f) { return null; }
    var L0 = lok(f), A = f.flaeche > 0 ? f.flaeche : L0.A;
    var g = {};
    g.A = A;
    g.grz = lesenZahl("grundGrz"); g.gfz = lesenZahl("grundGfz");
    if (g.grz === null || g.grz <= 0) { g.grz = null; }
    if (g.gfz === null || g.gfz <= 0) { g.gfz = null; }
    g.grz2 = g.grz === null ? null : Math.min(0.8, g.grz * 1.5);              // BauNVO § 19 Abs. 4: bis 50 % mehr für Garagen, Stellplätze, Nebenanlagen, höchstens 0,8
    if (ber) {
      g.bestHaupt = ber.haupt; g.bestNeben = ber.neben; g.bestSonst = ber.sonst;
      g.grzHaupt = ber.haupt / A; g.grzGeb = (ber.haupt + ber.neben) / A; g.grzAlles = (ber.haupt + ber.neben + ber.sonst) / A;
      var vorgabe = lesenZahl("grundBestandGeschosse");
      var gf = geschossflaeche(ber, vorgabe);
      g.gfBestand = gf.gf + ber.neben * 1; g.gfHaupt = gf.gf; g.gfUnbekannt = gf.unbekannt;
      g.gfzBestand = gf.gf / A;
    }
    // Baukörper-Studie
    if (g.grz !== null) {
      var nAuto = Math.max(1, g.gfz !== null ? Math.round(g.gfz / g.grz) : 2);
      var n = lesenZahl("grundGeschosse"); n = (n !== null && n >= 1) ? Math.round(n) : Math.min(nAuto, 8);
      var H = n * GESCHOSSHOEHE;
      var abstand = lesenZahl("grundAbstand"); var abstandAuto = abstand === null;
      if (abstand === null || abstand < 0) { abstand = Math.max(3, 0.5 * H); }
      g.n = n; g.H = H; g.abstand = abstand; g.abstandAuto = abstandAuto;
      if (!S.feld) { S.feld = abstandsFeld(f, L0); }
      var maxGrund = g.grz * A;
      var bf = baufeld(S.feld, abstand, maxGrund);
      g.baufeldVoll = bf.voll; g.baufeld = bf.flaeche; g.baufeldAbstand = bf.abstand;
      g.grundflaecheBau = bf.flaeche;
      g.gfBau = g.gfz !== null ? Math.min(bf.flaeche * n, g.gfz * A) : bf.flaeche * n;
      g.bauRingeGrad = ringeInGrad(bf.ringe, L0);
      g.bauRinge = bf.ringe;
      g.frei = ber ? freiImBaufeld(S.feld, L0, abstand, ber) : null;
    }
    return g;
  }
  // ---------- Potenzial und Einschränkungen (regelbasiert aus den Zahlen der App, Orientierung) ----------
  var WF_FAKTOR = 0.75, WE_GROESSE = 70;          // Wohnfläche = 75 % der Geschossfläche (Faustzahl), eine Wohnung = 70 m² Wohnfläche
  var WOHNGEBIETE = ["WS", "WR", "WA", "WB", "MD", "MI", "MU"];
  function eur(n) { return zahlDe(Math.abs(n) >= 20000 ? Math.round(n / 1000) * 1000 : Math.round(n), 0) + " €"; }
  function prozentDe(a, b) { return b > 0 ? zahlDe(Math.round(100 * a / b), 0) + " %" : "–"; }
  function potenzialBerechnen() {
    var f = S.f, g = S.g, ber = S.ber, pot = S.pot;
    if (!f || !g) { return null; }
    var A = g.A, gk = el("grundGebiet").value, gebiet = GEBIETE[gk] || GEBIETE.FREI, wohn = WOHNGEBIETE.indexOf(gk) >= 0 || gk === "MK";
    var gfBekannt = !!(ber && (hoehenIdx || lesenZahl("grundBestandGeschosse") > 0));
    var zulGrund = g.grz !== null ? g.grz * A : null, zulGF = g.gfz !== null ? g.gfz * A : null;
    var restGrund = (zulGrund !== null && ber) ? zulGrund - g.bestHaupt : null;
    var restGF = (zulGF !== null && gfBekannt) ? zulGF - g.gfHaupt : null;
    var zone = pot && pot.brw ? pot.brw : null;      // [Nummer, Name, Wert, Nutzung, GFZ, Geschosse, Bauweise, Verfahren, Richtfläche, Zustand]
    var miete = lesenZahl("grundMiete"), bauk = lesenZahl("grundBaukosten");
    var medGes = S.umg && S.umg.ges && S.umg.ges.length ? median(S.umg.ges) : null, medGrz = S.umg && S.umg.n ? median(S.umg.grz) : null;
    var bestGes = (gfBekannt && g.bestHaupt > 0) ? g.gfHaupt / g.bestHaupt : null;
    var abs = [], staerken = [], achten = [], kenn = {};
    var wePot = restGF !== null && restGF > 0 ? Math.floor(restGF * WF_FAKTOR / WE_GROESSE) : null;

    // 1. Was darf gebaut werden
    var a1 = { titel: "Was darf gebaut werden?", zeilen: [], liste: [] };
    var herkunft = brwGebiet(pot) === gk ? " (passt zur Bodenrichtwertzone: " + (BRW_NUTZUNG[zone[3]] || [0, zone[3]])[1] + ")" : (pot && pot.brw ? "" : " (nach der Katasternutzung vermutet)");
    a1.zeilen.push(["Gebietsart (Annahme)", gebiet.n + herkunft]);
    var zul = NUTZUNG_ZULAESSIG[gk];
    if (zul) {
      a1.liste.push("Allgemein zulässig (Baunutzungsverordnung, verkürzt): " + zul[0] + ".");
      if (zul[1]) { a1.liste.push("Ausnahmsweise möglich: " + zul[1] + "."); }
    }
    if (g.grz !== null) { a1.zeilen.push(["Maß der Nutzung (Annahme)", "GRZ " + zahlDe(g.grz, 2) + " (mit Nebenanlagen bis " + zahlDe(g.grz2, 2) + ")" + (g.gfz !== null ? ", GFZ " + zahlDe(g.gfz, 2) : "")]); }
    if (zone) {
      var zt = [];
      var roemisch = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8" };
      if (zone[5]) { zt.push((roemisch[zone[5]] || zone[5]) + (zone[5] === "I" ? " Geschoss" : " Geschosse")); }
      if (zone[4] > 0) { zt.push("GFZ " + zahlDe(zone[4], 2)); }
      var bw = { o: "offene Bauweise", g: "geschlossene Bauweise", a: "abweichende Bauweise", rh: "Reihenhäuser" }[zone[6]];
      if (zone[6]) { zt.push(bw || "Bauweise " + zone[6]); }
      if (zt.length) { a1.zeilen.push(["Typische Bebauung der Bodenrichtwertzone", zt.join(", ")]); }
    }
    if (!pot) { a1.zeilen.push(["Planungsrecht", "wird geprüft …"]); }
    else if (pot.fehler) { a1.zeilen.push(["Planungsrecht", "konnte nicht geprüft werden (Datei fehlt oder ist beschädigt)"]); }
    else {
      a1.zeilen.push(["Bebauungsplan", pot.bplan ? "Das Grundstück liegt im Umriss eines Bebauungsplans. Seine Festsetzungen (Art, Maß, Baugrenzen) gehen den Annahmen hier vor." : "Kein Bebauungsplan-Umriss in den Daten: dann gilt meist § 34 BauGB (Einfügen in die Umgebung) oder, außerhalb der Bebauung, § 35."]);
      a1.zeilen.push(["Flächennutzungsplan", pot.fnp.length ? pot.fnp.join(", ") : "keine Darstellung in den Daten"]);
    }
    if (pot && !pot.bplan && !pot.fehler && S.umg && S.umg.n) {
      a1.liste.push("Ohne Bebauungsplan muss sich ein Vorhaben nach Art, Maß, Bauweise und überbauter Fläche in die Umgebung einfügen: Dort liegt die GRZ der Gebäude im Median bei " + zahlDe(medGrz, 2) + (medGes !== null ? " und die Zahl der Geschosse bei " + zahlDe(medGes, 0) : "") + ".");
    }
    abs.push(a1);

    // 2. Zusätzlich oder alternativ
    var a2 = { titel: "Was könnte zusätzlich oder alternativ gebaut werden?", zeilen: [], liste: [] }, o = a2.liste;
    if (ber && ber.haupt <= 0) { o.push("Das Grundstück ist (nach dem Kataster) unbebaut: ein Neubau bis zur zulässigen Grundfläche von " + (zulGrund !== null ? qm(zulGrund) : "–") + " ist denkbar" + (g.baufeldVoll ? ", das Baufeld nach Abstand ist " + qm(g.baufeldVoll) + " groß" : "") + "."); }
    if (restGrund !== null && restGrund < 0) { o.push("Die Hauptgebäude liegen schon über der angenommenen Grundfläche: weitere Verdichtung ist nach diesen Annahmen nicht möglich. Bleiben Umbau, Modernisierung oder Dachausbau im Bestand (Bestandsschutz klären)."); }
    if (g.frei !== null && g.frei !== undefined && g.frei >= 60 && (restGrund === null || restGrund > 20)) { o.push("Anbau oder Nebengebäude: Im Baufeld sind etwa " + qm(g.frei) + " frei vom Bestand (Garage, Carport, Anbau, Gartenhaus)."); }
    if (g.frei >= 150 && A >= 500 && wohn && restGrund !== null && restGrund > 60) { o.push("Zweites Gebäude im Hinterland (zweite Reihe): Platz wäre da; Erschließung, Feuerwehrzufahrt, Abstandsflächen und Stellplätze müssten gelöst werden."); }
    if (restGF !== null && restGF > 40 && ber && ber.haupt > 0 && (restGrund === null || restGrund >= -5)) {
      o.push("Aufstockung oder Dachausbau: bis zu etwa " + qm(Math.min(restGF, g.bestHaupt)) + " zusätzliche Geschossfläche pro Geschoss, insgesamt höchstens " + qm(restGF) + "" + (medGes !== null && bestGes !== null && bestGes < medGes ? " (die Nachbarn haben im Median mehr Geschosse: " + zahlDe(medGes, 0) + " gegenüber etwa " + zahlDe(bestGes, 1) + " hier)" : "") + ".");
    }
    if (restGF !== null && restGF > 150 && wohn && wePot > 1) { o.push("Mehrfamilienhaus oder Ersatzneubau: rechnerisch Platz für etwa " + zahlDe(wePot, 0) + " zusätzliche Wohnungen (bei " + zahlDe(WE_GROESSE, 0) + " m² Wohnfläche je Wohnung und 75 % Wohnfläche an der Geschossfläche)."); }
    if (!gfBekannt && ber && ber.haupt > 0) { o.push("Für Aufstockung und zusätzliche Geschossfläche fehlen die Gebäudehöhen: „Gebäudehöhen laden“ in „Bestand“ klicken."); }
    var alt = { WS: "Einfamilienhaus, Doppelhaus oder Kleinsiedlung mit Garten", WR: "Einfamilienhaus, Doppelhaus, Mehrfamilienhaus oder eine Kita", WA: "Einfamilienhaus, Doppel- oder Reihenhaus, Mehrfamilienhaus, Wohngruppe oder Kita; im Erdgeschoss Praxis oder Laden",
      WB: "Wohnen mit Läden und Büros im Erdgeschoss", MD: "Wohnen mit Handwerk, Gastronomie oder Hofladen", MI: "Wohnen mit Büro, Praxis, Laden oder Gastronomie im Erdgeschoss", MU: "Wohnen, Büro, Praxis und Handel in einem Haus",
      MK: "Büro, Praxis, Handel und Gastronomie; Wohnen nur, wenn der Plan es zulässt", GE: "Büro- und Verwaltungsgebäude, Lager, Handwerksbetriebe oder Werkstätten", GI: "Produktion, Lager, Logistik", SO: "was der Bebauungsplan für das Sondergebiet festlegt" };
    if (alt[gk]) { o.push("Alternative Nutzungen in diesem Gebiet: " + alt[gk] + "."); }
    if (!o.length) { o.push("Mit den angenommenen Werten sind keine zusätzlichen Möglichkeiten erkennbar."); }
    abs.push(a2);

    // 3. Wie intensiv
    var a3 = { titel: "Wie intensiv kann das Grundstück genutzt werden?", zeilen: [], liste: [] };
    if (zulGrund !== null && ber) { a3.zeilen.push(["Grundfläche ausgenutzt", prozentDe(g.bestHaupt, zulGrund) + " (" + qm(g.bestHaupt) + " von " + qm(zulGrund) + ")"]); }
    if (zulGF !== null && gfBekannt) { a3.zeilen.push(["Geschossfläche ausgenutzt (Schätzung)", prozentDe(g.gfHaupt, zulGF) + " (" + qm(g.gfHaupt) + " von " + qm(zulGF) + ")"]); }
    if (zulGF !== null) { a3.zeilen.push(["Insgesamt zulässige Geschossfläche", qm(zulGF) + (wohn ? ", etwa " + zahlDe(Math.floor(zulGF * WF_FAKTOR / WE_GROESSE), 0) + " Wohnungen" : "")]); }
    if (restGF !== null) { a3.zeilen.push(["Noch möglich", restGF > 0 ? qm(restGF) + " Geschossfläche" + (wePot ? ", etwa " + zahlDe(wePot, 0) + " Wohnungen" : "") : "nichts mehr, der Bestand liegt " + qm(-restGF) + " darüber"]); }
    if (medGrz !== null && ber) { a3.zeilen.push(["Umgebung (GRZ der Gebäude)", "Median " + zahlDe(medGrz, 2) + ", hier " + zahlDe(g.grzGeb, 2)]); }
    if (medGes !== null) { a3.zeilen.push(["Umgebung (Geschosse)", "Median " + zahlDe(medGes, 0) + (bestGes !== null ? ", hier etwa " + zahlDe(bestGes, 1) : "")]); }
    if (zulGF !== null && gfBekannt) {
      var u = g.gfHaupt / zulGF;
      a3.liste.push(u < 0.5 ? "Die Geschossfläche ist erst zu weniger als der Hälfte ausgenutzt: es gibt deutlichen Spielraum." : u < 0.9 ? "Die Ausnutzung ist mittel: ein Teil des Baurechts ist noch frei." : u <= 1.05 ? "Das Baurecht ist weitgehend ausgeschöpft." : "Der Bestand liegt über den angenommenen Obergrenzen (vermutlich älterer Bestand oder abweichende Festsetzungen).");
    }
    abs.push(a3);

    // 4. Wirtschaftliche Potenziale
    var a4 = { titel: "Wirtschaftliche Potenziale (grobe Faustrechnung)", zeilen: [], liste: [] };
    var bodenwert = null;
    if (zone) {
      bodenwert = zone[2] * A;
      a4.zeilen.push(["Bodenrichtwert", zahlDe(zone[2], 0) + " €/m² (Zone " + zone[0] + ", " + zone[1] + ", Stichtag 01.01.2026)"]);
      a4.zeilen.push(["Bodenwert des Grundstücks", "ca. " + eur(bodenwert) + " (Richtwert mal Fläche, nur Boden ohne Gebäude)"]);
      if (zone[4] > 0) { a4.zeilen.push(["Bodenrichtwert je m² Geschossfläche", zahlDe(zone[2] / zone[4], 0) + " €/m² (Richtwert geteilt durch die Zonen-GFZ " + zahlDe(zone[4], 2) + ")"]); }
      if (zulGF) { a4.zeilen.push(["Bodenwert je m² zulässiger Geschossfläche", zahlDe(bodenwert / zulGF, 0) + " €/m²"]); }
      if (restGF !== null && restGF > 0 && zulGF) { a4.zeilen.push(["Wert des ungenutzten Baurechts (anteilig)", "ca. " + eur(bodenwert * restGF / zulGF) + " (Bodenwert mal ungenutzter Anteil der Geschossfläche)"]); }
      if (pot.brwAndere > 0) { a4.liste.push("An dieser Stelle überlagern sich " + (pot.brwAndere + 1) + " Bodenrichtwertzonen; angezeigt ist die kleinste."); }
      if (zone[8] > 0 && Math.abs(A - zone[8]) / zone[8] > 0.4) { a4.liste.push("Das Richtgrundstück der Zone hat " + qm(zone[8]) + ", dieses Grundstück " + qm(A) + ": Größe und Zuschnitt weichen deutlich ab, der Wert kann entsprechend abweichen."); }
    } else if (pot && !pot.fehler) { a4.zeilen.push(["Bodenrichtwert", "keine Zone für Bauland gefunden (zum Beispiel Außenbereich oder Fläche ohne Richtwert)"]); }
    else if (!pot) { a4.zeilen.push(["Bodenrichtwert", "wird geladen …"]); }
    if (restGF !== null && restGF > 0 && bauk > 0 && miete > 0) {
      var invest = restGF * bauk, jahr1 = restGF * WF_FAKTOR * miete * 12;
      a4.zeilen.push(["Zusätzliche Geschossfläche", qm(restGF)]);
      a4.zeilen.push(["Baukosten (Annahme " + zahlDe(bauk, 0) + " €/m² Geschossfläche)", "ca. " + eur(invest)]);
      a4.zeilen.push(["Mieteinnahmen (Annahme " + zahlDe(miete, 2) + " €/m² Wohnfläche im Monat)", "ca. " + eur(jahr1) + " im Jahr (kalt)"]);
      a4.zeilen.push(["Bruttoanfangsrendite des Zusatzes", zahlDe(100 * jahr1 / invest, 1) + " %"]);
      kenn.invest = invest; kenn.jahresmiete = jahr1; kenn.rendite = jahr1 / invest;
      a4.liste.push("Faustrechnung ohne Grundstückskosten (das Baurecht liegt auf dem eigenen Grundstück), ohne Finanzierung, Leerstand, Bewirtschaftung und Steuern. Baukosten und Miete sind Annahmen und lassen sich darunter ändern.");
    } else if (restGF === null && ber && ber.haupt > 0) { a4.liste.push("Für die Rechnung zum Zusatz fehlen die Gebäudehöhen („Gebäudehöhen laden“ in „Bestand“)."); }
    else if (restGF !== null && restGF <= 0) { a4.liste.push("Es gibt nach den Annahmen keine zusätzliche Geschossfläche, deshalb keine Rechnung zum Zusatz."); }
    a4.liste.push("Der Bodenrichtwert ist ein Durchschnittswert für ein typisches Grundstück der Zone und kein Verkehrswert. Eine Wertermittlung ersetzt das nicht.");
    abs.push(a4);

    // 5. Einschränkungen
    var a5 = { titel: "Einschränkungen, die eine optimale Nutzung verhindern können", zeilen: [], liste: [] }, e = a5.liste;
    if (restGrund !== null && restGrund < 0) { e.push("Überbauung über der angenommenen GRZ: nur Bestandsschutz, kein weiteres Wachstum."); achten.push("Die Hauptgebäude (" + qm(g.bestHaupt) + ") liegen über der angenommenen Grundfläche (" + qm(zulGrund) + ")."); }
    if (zulGrund !== null && g.baufeldVoll && g.baufeldVoll < zulGrund * 0.85) { e.push("Die Abstände zur Grenze (" + zahlDe(g.abstand, 1) + " m) lassen nur " + qm(g.baufeldVoll) + " Baufeld; das ist weniger als die zulässige Grundfläche (" + qm(zulGrund) + "). Zuschnitt und Abstandsflächen begrenzen hier stärker als die GRZ."); achten.push("Zuschnitt und Abstandsflächen begrenzen die Bebauung stärker als die GRZ (Baufeld " + qm(g.baufeldVoll) + ")."); }
    if (A < 350) { e.push("Das Grundstück ist mit " + qm(A) + " klein: Abstandsflächen, Stellplätze und Gartenanteil begrenzen die Möglichkeiten."); }
    if (pot && !pot.fehler) {
      if (pot.bplan) { e.push("Bebauungsplan: Baugrenzen, Geschosszahl, Dachform und weitere Festsetzungen können die Werte oben stark verändern (nicht in den App-Daten, beim Planungsamt klären)."); achten.push("Im Umriss eines Bebauungsplans: Festsetzungen beim Planungsamt prüfen."); }
      var ld = pot.laerm.laerm_lden, ln = pot.laerm.laerm_nacht;
      if (ld) { e.push("Straßenlärm (ganzer Tag): " + ld.text + " auf dem Grundstück" + (ld.stufe >= 2 ? ". Schallschutz (Grundrisse, Fenster, Lärmschutzwand) ist einzuplanen; für ein Allgemeines Wohngebiet gelten als Orientierungswerte tags 55 dB und nachts 45 dB (DIN 18005)." : ". Die Orientierungswerte für ein Wohngebiet liegen tags bei 55 dB und nachts bei 45 dB (DIN 18005).")); achten.push("Straßenlärm " + ld.text + " (ganzer Tag) auf dem Grundstück."); }
      if (ln && !ld) { e.push("Straßenlärm nachts: " + ln.text + " auf dem Grundstück."); }
      var hatLaerm = !!(pot.hat && (pot.hat.laerm_lden || pot.hat.laerm_nacht));
      if (!hatLaerm) { e.push("Straßenlärm: Für diese Stadt liegt keine Lärmkartierung in den App-Daten vor, bitte bei der Stadt oder im Lärmportal des Landes prüfen."); }
      else if (!ld && !ln) { e.push("Kein Straßenlärm ab 55 dB (Tag) bzw. 50 dB (Nacht) in der Lärmkartierung der Stadt (die Karte erfasst nur Hauptverkehrsstraßen)."); }
      var sn = { nsg: "Naturschutzgebiet", lsg: "Landschaftsschutzgebiet", biotope: "geschütztes Biotop", wallhecken: "Wallhecke" };
      Object.keys(sn).forEach(function (id) { if (pot.schutz[id]) { e.push("Das Grundstück liegt ganz oder teilweise in einem Bereich mit Schutzstatus (" + sn[id] + "): Eingriffe sind genehmigungspflichtig oder verboten."); achten.push("Schutzstatus: " + sn[id] + " auf dem Grundstück."); } });
      var geprueft = Object.keys(sn).filter(function (id) { return pot.hat && pot.hat[id]; });
      if (geprueft.length && !geprueft.some(function (id) { return pot.schutz[id]; })) { e.push("Kein geschütztes Gebiet auf dem Grundstück (geprüft: " + geprueft.map(function (id) { return sn[id]; }).join(", ") + "; nach den Daten der Stadt)."); }
      if (geprueft.length < Object.keys(sn).length) { e.push("Nicht in den Daten dieser Stadt und deshalb nicht geprüft: " + Object.keys(sn).filter(function (id) { return !(pot.hat && pot.hat[id]); }).map(function (id) { return sn[id]; }).join(", ") + "."); }
    }
    e.push("Nicht geprüft, weil nicht in den App-Daten: Baulasten und Grunddienstbarkeiten, Denkmalschutz, Altlasten, Grundwasserstand und Baugrund, Hochwasser und Starkregen, Leitungen, Baumschutz, Artenschutz, Erschließung und Stellplatznachweis. Altlasten, Baugrund, Grundwasser und Starkregen kannst du als Ebenen in „04 Analysedaten“ ansehen.");
    abs.push(a5);

    // Stärken für das Standortprofil
    if (wePot >= 2) { staerken.push("Rechnerisch Platz für etwa " + wePot + " zusätzliche Wohnungen (bei " + WE_GROESSE + " m² Wohnfläche je Wohnung)."); }
    if (zone) { kenn.brw = zone[2]; kenn.brwName = zone[1]; kenn.brwNutzung = (BRW_NUTZUNG[zone[3]] || [0, zone[3]])[1]; kenn.bodenwert = bodenwert; }
    kenn.restGF = restGF; kenn.we = wePot; kenn.restGrund = restGrund;
    return { abschnitte: abs, staerken: staerken, achten: achten, kenn: kenn };
  }
  function potenzialAnzeigen() {
    var b = el("grundPotenzial"); if (!b) { return; }
    b.textContent = "";
    var p = potenzialBerechnen(); S.potErgebnis = p;
    if (!p) { return; }
    p.abschnitte.forEach(function (a) {
      var t = document.createElement("div"); t.className = "gruppentitel"; t.style.marginTop = "10px"; t.textContent = a.titel; b.appendChild(t);
      a.zeilen.forEach(function (z) { zeile(b, z[0], z[1]); });
      a.liste.forEach(function (x) { absatz(b, "• " + x); });
    });
  }

  function aktualisiereAnzeige() {
    var f = S.f;
    if (!f) { return; }
    var kopf = el("grundKopf"); kopf.textContent = "";
    zeile(kopf, "Lage", f.adr || "keine Lagebezeichnung");
    zeile(kopf, "Flurstück", f.gem + ", Flur " + f.flur + ", " + f.nr);
    zeile(kopf, "Fläche (amtlich)", qm(f.flaeche > 0 ? f.flaeche : lok(f).A), true);
    zeile(kopf, "Nutzung im Kataster", nutzText(f) || "–");
    var g = rechne(); S.g = g;
    if (g && g.bauRingeGrad) { S.bau = { ringeGrad: g.bauRingeGrad }; }
    // Bestand
    var best = el("grundBestand"); best.textContent = "";
    if (!S.ber) { absatz(best, "Gebäude werden geladen …"); }
    else {
      zeile(best, "Hauptgebäude (" + S.ber.nHaupt + ")", qm(g.bestHaupt) + "  ·  GRZ " + zahlDe(g.grzHaupt, 2));
      zeile(best, "Garagen und Nebengebäude", qm(g.bestNeben));
      zeile(best, "Überdachungen, sonstige Bauwerke", qm(g.bestSonst));
      zeile(best, "Gebäude insgesamt", "GRZ " + zahlDe(g.grzGeb, 2), true);
      var gfz = g.gfzBestand;
      zeile(best, "Geschossfläche (Schätzung)", hoehenIdx || lesenZahl("grundBestandGeschosse") > 0 ? qm(g.gfHaupt) + "  ·  GFZ " + zahlDe(gfz, 2) : "noch nicht geschätzt", true);
      if (g.gfUnbekannt > 0 && hoehenIdx) { absatz(best, g.gfUnbekannt + " Gebäude ohne Höhenangabe: dort ist ein Geschoss angenommen."); }
      var hk = el("grundHoehenKnopf"); hk.hidden = !!hoehenIdx;
      if (!hoehenIdx) { absatz(best, "Die Geschosszahl wird aus den Gebäudehöhen des Landesamts geschätzt (Traufhöhe geteilt durch " + zahlDe(GESCHOSSHOEHE, 1) + " m). Dafür müssen die Höhen der Umgebung (einige MB) geladen werden."); }
    }
    // Umgebung
    var umg = el("grundUmgebung"); umg.textContent = "";
    if (!S.umg) { absatz(umg, S.ber ? "wird berechnet …" : ""); }
    else if (!S.umg.n) { absatz(umg, "In " + UMGEBUNG_RADIUS + " m Umkreis gibt es keine Vergleichsgrundstücke mit Gebäuden."); }
    else {
      var q = function (l, p) { var a = l.slice().sort(function (x, y) { return x - y; }); return a[Math.max(0, Math.min(a.length - 1, Math.round(p * (a.length - 1))))]; };
      zeile(umg, "Vergleichsgrundstücke", String(S.umg.n));
      zeile(umg, "GRZ (Gebäude), Median", zahlDe(median(S.umg.grz), 2) + "  (" + zahlDe(q(S.umg.grz, 0.1), 2) + " bis " + zahlDe(q(S.umg.grz, 0.9), 2) + ")", true);
      if (S.umg.ges.length) { zeile(umg, "Geschosse, Median", zahlDe(median(S.umg.ges), 0) + "  (" + zahlDe(q(S.umg.ges, 0.1), 0) + " bis " + zahlDe(q(S.umg.ges, 0.9), 0) + ")", true); }
      else { absatz(umg, "Die Geschosse der Umgebung erscheinen, sobald die Gebäudehöhen geladen sind."); }
      absatz(umg, "Ohne Bebauungsplan gilt meist das Einfügen in die Umgebung (§ 34 BauGB); diese Werte sind eine Orientierung dafür.");
    }
    // Ergebnis
    var erg = el("grundErgebnis"); erg.textContent = "";
    if (!g || g.grz === null) { absatz(erg, "Bitte eine GRZ eintragen."); el("grundUebernehmen").disabled = true; }
    else {
      zeile(erg, "Zulässige Grundfläche (GRZ " + zahlDe(g.grz, 2) + ")", qm(g.grz * g.A), true);
      zeile(erg, "mit Garagen, Nebenanlagen (bis " + zahlDe(g.grz2, 2) + ")", qm(g.grz2 * g.A));
      if (S.ber) {
        var rest = g.grz * g.A - g.bestHaupt;
        zeile(erg, "Noch nicht ausgenutzt", (rest >= 0 ? qm(rest) : "–  (Bestand liegt " + qm(-rest) + " darüber)"), true);
      }
      if (g.gfz !== null) {
        zeile(erg, "Zulässige Geschossfläche (GFZ " + zahlDe(g.gfz, 2) + ")", qm(g.gfz * g.A), true);
        if (S.ber && (hoehenIdx || lesenZahl("grundBestandGeschosse") > 0)) {
          var rg = g.gfz * g.A - g.gfHaupt;
          zeile(erg, "Noch nicht ausgenutzt (Schätzung)", rg >= 0 ? qm(rg) : "–  (Bestand liegt " + qm(-rg) + " darüber)");
        }
      }
      zeile(erg, "Abstand zur Grenze" + (g.abstandAuto ? " (Annahme)" : ""), zahlDe(g.abstand, 1) + " m");
      zeile(erg, "Baufeld nach Abstand", qm(g.baufeldVoll));
      if (g.frei !== null && g.frei !== undefined) { zeile(erg, "davon noch frei (ohne Bestand)", qm(g.frei)); }
      zeile(erg, "Baukörper-Studie", qm(g.grundflaecheBau) + " Grundfläche, " + g.n + " Geschoss" + (g.n === 1 ? "" : "e") + ", " + zahlDe(g.H, 1) + " m", true);
      zeile(erg, "Geschossfläche der Studie", qm(g.gfBau));
      if (g.baufeldVoll > g.grz * g.A * 1.02) { absatz(erg, "Das Baufeld ist größer als die zulässige Grundfläche; die Studie ist deshalb kleiner gemacht (die GRZ begrenzt)."); }
      el("grundUebernehmen").disabled = !(g.bauRinge && g.bauRinge.length);
    }
    zeigeAuswahl();
    S.g = g;
    potenzialAnzeigen();
  }

  function uebernehmen() {
    var g = S.g, f = S.f;
    if (!g || !f || !g.bauRingeGrad || !g.bauRingeGrad.length) { return; }
    var alt = { name: zeichenEigenschaften.name, hoehe: zeichenEigenschaften.hoehe };
    var neu = 0;
    g.bauRingeGrad.forEach(function (ring) {
      if (ring.length < 3) { return; }
      zeichenEigenschaften.name = "Baukörper-Studie " + (f.adr || ("Flurstück " + f.nr));
      zeichenEigenschaften.hoehe = g.H;
      zeichenNeu("flaeche", ring.map(function (p) { return L.latLng(p[0], p[1]); }), false);
      neu++;
    });
    zeichenEigenschaften.name = alt.name; zeichenEigenschaften.hoehe = alt.hoehe;
    zeichneAlles();
    setzeMeldung(neu ? "Das Baufeld ist als Baukörper in „06 Zeichnen“ übernommen (Höhe " + zahlDe(g.H, 1) + " m). Es erscheint auch im gespeicherten Bild und in der 3D-Ansicht." : "Es gab kein Baufeld zum Übernehmen.");
  }

  // ---------- Ebenen in der Karte ----------
  var renderer_ = {};
  function renderer(pane) {
    if (!karte.getPane(pane)) { karte.createPane(pane); karte.getPane(pane).style.zIndex = pane === "grundFuellPane" ? 230 : 415; if (pane === "grundFuellPane") { karte.getPane(pane).style.pointerEvents = "none"; } }
    if (pane === "grundLinienPane" && typeof klickRenderer !== "undefined") { return klickRenderer; }   // gemeinsame Leinwand mit Haltestellen u. a. (siehe index.html)
    if (!renderer_[pane]) { renderer_[pane] = L.canvas({ pane: pane, padding: 0.3 }); }
    return renderer_[pane];
  }
  var ladeNr = 0;
  function leereKarte() { FLST.forEach(function (g) { g.ebene.clearLayers(); }); ladeNr++; }
  function popupInhalt(f) {
    var d = document.createElement("div"); d.style.maxWidth = "240px";
    popupZeile(d, f.adr || "Grundstück", true);
    popupZeile(d, f.gem + ", Flur " + f.flur + ", Flurstück " + f.nr).style.marginTop = "2px";
    popupZeile(d, "Fläche: " + qm(f.flaeche > 0 ? f.flaeche : lok(f).A));
    var t = nutzText(f); if (t) { popupZeile(d, "Nutzung: " + t); }
    var g = grzGebaeude(f);
    if (g !== null) { popupZeile(d, "Überbaut: GRZ " + zahlDe(g, 2) + " (Gebäude)"); }
    var k = document.createElement("button"); k.type = "button"; k.textContent = "Dieses Grundstück analysieren"; k.style.marginTop = "8px";
    k.addEventListener("click", function () { karte.closePopup(); var ab = el("grundAbschnitt"); if (ab) { ab.open = true; } waehleGrundstueck(f); });
    d.appendChild(k);
    return d;
  }
  // Zeichnet die Grundstücke des Kartenfensters. Jede Kachel wird gezeichnet, sobald sie da ist (die mittleren zuerst), man wartet nicht auf alle.
  // Die Einfärbung braucht auch die Gebäude; die Grenzen allein brauchen nur die Flurstücke (halb so viele Daten).
  function zeichneKarte() {
    var grenzen = FLST[0], farbig = FLST[1];
    var an1 = karte.hasLayer(grenzen.ebene), an2 = karte.hasLayer(farbig.ebene);
    leereKarte();
    if (!an1 && !an2) { return; }
    if (karte.getZoom() < MIN_ZOOM) { setzeKartenStatus("Die Grundstücke erscheinen erst in der Nahansicht (ab Zoomstufe " + MIN_ZOOM + "). Bitte weiter hineinzoomen."); return; }
    var nr = ++ladeNr, b = karte.getBounds().pad(0.03), zoom = karte.getZoom();
    var kacheln = kachelnFuer(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()), fertig = 0, gezeichnet = new Set();
    setzeKartenStatus("Grundstücke werden geladen (0 von " + kacheln.length + " Kacheln) …");
    function zeichne(f) {
      var ringe = f.polys.map(function (p) { return [p.a].concat(p.i); });
      if (an2) {
        var gz = grzGebaeude(f);
        if (gz !== null) { L.polygon(ringe, { renderer: renderer("grundFuellPane"), stroke: false, fillColor: grzKlasse(gz).farbe, fillOpacity: farbig.deckkraft, interactive: false }).addTo(farbig.ebene); }
      }
      if (an1) {
        var p = L.polygon(ringe, { renderer: renderer("grundLinienPane"), color: grenzen.farbe, weight: 1.2, fill: true, fillOpacity: 0, interactive: true }).addTo(grenzen.ebene);
        p.bringToBack();   // hinter Haltestellen u. a. auf derselben Leinwand, damit deren Klick vorgeht
        p.on("click", function (ev) { if (grundWahl) { return; } zeigePopup(p, popupInhalt(f), ev.latlng); });
        if (zoom >= 18 && f.flaeche > 0) {
          L.marker(f.mitte, { icon: L.divIcon({ className: "grundLabel", html: "<span>" + zahlDe(Math.round(f.flaeche), 0) + " m²</span>", iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(grenzen.ebene);
        }
      }
    }
    // Die Grundstücke werden in kleinen Portionen gezeichnet (höchstens etwa 25 ms am Stück), damit die Karte dabei nicht stehen bleibt
    var offen = [], laeuft = false;
    function portion() {
      if (nr !== ladeNr) { offen = []; laeuft = false; return; }
      var t0 = performance.now();
      while (offen.length && performance.now() - t0 < 25) { zeichne(offen.shift()); }
      if (offen.length) { setTimeout(portion, 0); } else { laeuft = false; }
    }
    function zeichneNeue() {
      if (nr !== ladeNr) { return; }
      flstInRechteck(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).forEach(function (f) {
        if (gezeichnet.has(f.id) || (an2 && !gebaeudeBereit(f))) { return; }
        gezeichnet.add(f.id); offen.push(f);
      });
      if (offen.length && !laeuft) { laeuft = true; setTimeout(portion, 0); }
    }
    ladeBereich(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), an2, function () {
      if (nr !== ladeNr) { return; }
      fertig++;
      zeichneNeue();
      setzeKartenStatus(fertig < kacheln.length ? "Grundstücke werden geladen (" + fertig + " von " + kacheln.length + " Kacheln) …" : "");
    }).catch(function (x) {
      if (nr !== ladeNr) { return; }
      setzeKartenStatus("Die Grundstücke konnten nicht (alle) geladen werden (Internet prüfen oder später noch einmal versuchen).", true);
      if (window.console) { console.error(x); }
    });
  }
  // ---------- Gespeichertes Bild ----------
  var bildDaten = null;
  function bildBereich(plan, mitte) {
    var dB = plan.hoeheM / 2 * 1.03 / 110574, dL = plan.breiteM / 2 * 1.03 / (111320 * Math.cos(mitte.lat * Math.PI / 180));
    return [mitte.lat - dB, mitte.lng - dL, mitte.lat + dB, mitte.lng + dL];
  }
  function sichtbarImBild() { return FLST.filter(function (g) { return karte.hasLayer(g.ebene); }); }
  function vorbereitenBild(plan, mitte) {
    var bb = bildBereich(plan, mitte);
    bildDaten = null;
    var ebenen = sichtbarImBild();
    if (!ebenen.length) { bildDaten = null; return Promise.resolve(null); }
    if (kachelnFuer(bb[0], bb[1], bb[2], bb[3]).length > MAX_KACHELN_BILD) {
      bildDaten = null;
      return Promise.reject(new Error("Der Bildausschnitt ist für die Grundstücke zu groß (höchstens etwa 2,5 × 2,5 km)."));
    }
    return ladeBereich(bb[0], bb[1], bb[2], bb[3], ebenen.indexOf(FLST[1]) >= 0).then(function () {
      bildDaten = { bb: bb, ebenen: ebenen, liste: flstInRechteck(bb[0], bb[1], bb[2], bb[3]) };
      return bildDaten;
    });
  }
  function pfadRing(c, ring, k, zuP) {
    ring.forEach(function (q, i) { var p = zuP(q[0], q[1], k.z), x = (p.x - k.links) * k.f, y = (p.y - k.oben) * k.f; if (i === 0) { c.moveTo(x, y); } else { c.lineTo(x, y); } });
    c.closePath();
  }
  // schicht "fuell" (unter den Gebäuden) oder "linien" (über den Gebäuden: Grenzen, Flächenangaben, gewähltes Grundstück)
  function zeichneInBild(c, plan, k, pxProMm, schicht) {
    var zuP = window.zuPixel;
    c.save();
    if (bildDaten) {
      var grenzen = bildDaten.ebenen.indexOf(FLST[0]) >= 0, farbig = bildDaten.ebenen.indexOf(FLST[1]) >= 0;
      if (schicht === "fuell" && farbig) {
        bildDaten.liste.forEach(function (f) {
          var gz = grzGebaeude(f); if (gz === null) { return; }
          c.beginPath(); f.polys.forEach(function (p) { pfadRing(c, p.a, k, zuP); p.i.forEach(function (r) { pfadRing(c, r, k, zuP); }); });
          c.globalAlpha = FLST[1].deckkraft; c.fillStyle = grzKlasse(gz).farbe; c.fill("evenodd"); c.globalAlpha = 1;
        });
      }
      if (schicht === "linien" && grenzen) {
        c.strokeStyle = FLST[0].farbe; c.lineWidth = 0.25 * pxProMm; c.lineJoin = "round";
        bildDaten.liste.forEach(function (f) {
          c.beginPath(); f.polys.forEach(function (p) { pfadRing(c, p.a, k, zuP); p.i.forEach(function (r) { pfadRing(c, r, k, zuP); }); }); c.stroke();
        });
        // Flächenangabe, wenn das Grundstück im Bild groß genug ist (mindestens 11 x 5 mm)
        var schrift = 2.1 * pxProMm;
        c.font = schrift + "px Segoe UI, Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        bildDaten.liste.forEach(function (f) {
          if (!(f.flaeche > 0)) { return; }
          var a = zuP(f.bb[0], f.bb[1], k.z), b = zuP(f.bb[2], f.bb[3], k.z);
          var breite = Math.abs(b.x - a.x) * k.f, hoehe = Math.abs(b.y - a.y) * k.f;
          if (breite < 11 * pxProMm || hoehe < 5 * pxProMm) { return; }
          var p = zuP(f.mitte[0], f.mitte[1], k.z), x = (p.x - k.links) * k.f, y = (p.y - k.oben) * k.f;
          if (x < 0 || x > plan.B || y < 0 || y > plan.H) { return; }
          var text = zahlDe(Math.round(f.flaeche), 0) + " m²";
          c.lineWidth = 0.7 * pxProMm; c.strokeStyle = "rgba(255,255,255,0.9)"; c.strokeText(text, x, y);
          c.fillStyle = FLST[0].farbe; c.fillText(text, x, y);
        });
      }
    }
    if (schicht === "linien" && S.f) {
      c.beginPath(); S.f.polys.forEach(function (p) { pfadRing(c, p.a, k, zuP); p.i.forEach(function (r) { pfadRing(c, r, k, zuP); }); });
      c.lineWidth = 0.9 * pxProMm; c.strokeStyle = "#c0392b"; c.stroke();
      if (S.zeigeBaufeld && S.g && S.g.bauRingeGrad) {
        c.beginPath(); S.g.bauRingeGrad.forEach(function (r) { pfadRing(c, r, k, zuP); });
        c.globalAlpha = 0.25; c.fillStyle = "#c0392b"; c.fill("evenodd"); c.globalAlpha = 1;
        c.setLineDash([2 * pxProMm, 1.3 * pxProMm]); c.lineWidth = 0.6 * pxProMm; c.stroke(); c.setLineDash([]);
      }
    }
    c.restore();
  }
  // live = true: Legende für die Karte auf dem Bildschirm (nach den eingeschalteten Ebenen), sonst für das gespeicherte Bild
  function legende(live) {
    var e = [];
    var an = function (g) { return live ? karte.hasLayer(g.ebene) : !!bildDaten && bildDaten.ebenen.indexOf(g) >= 0; };
    if (live || bildDaten) {
      if (an(FLST[0])) { e.push({ art: "linie", farbe: FLST[0].farbe, text: FLST[0].legende }); }
      if (an(FLST[1])) { GRZ_KLASSEN.forEach(function (k, i) { e.push({ art: "flaeche", farbe: k.farbe, deckkraft: 0.9, text: (i === 0 ? "Überbauung der Grundstücke (GRZ der Gebäude): " : "GRZ: ") + k.text }); }); }
    }
    if (S.f) { e.push({ art: "linie", farbe: "#c0392b", text: "Gewähltes Grundstück" }); }
    if (S.f && S.zeigeBaufeld && S.g && S.g.bauRingeGrad) { e.push({ art: "flaeche", farbe: "#c0392b", deckkraft: 0.4, rand: "#c0392b", text: "Baufeld (Studie: Abstand zur Grenze und GRZ)" }); }
    return e;
  }
  function imBild() { return !!bildDaten || !!S.f; }
  function quelle() { return (bildDaten || S.f) ? "  ·  Grundstücke und Gebäude: © LGLN (" + jahr + "), CC BY 4.0" : ""; }

  // ---------- Datenblatt für die Entwurfsstrategie ----------
  // Zahlen als Objekt (für Kacheln, Stärken und Hinweise im Standortprofil)
  function daten() {
    var f = S.f, g = S.g;
    if (!f || !g) { return null; }
    var d = { adr: f.adr || "", nr: f.nr, gem: f.gem, flur: f.flur, A: g.A, nutzung: nutzText(f), gebiet: el("grundGebiet").value, grz: g.grz, gfz: g.gfz, grz2: g.grz2 };
    var gebiet = GEBIETE[d.gebiet]; d.gebietName = gebiet ? gebiet.n : "";
    if (S.ber) {
      d.nHaupt = S.ber.nHaupt; d.bestHaupt = g.bestHaupt; d.bestNeben = g.bestNeben; d.bestSonst = g.bestSonst; d.grzHaupt = g.grzHaupt; d.grzGeb = g.grzGeb;
      if (hoehenIdx || lesenZahl("grundBestandGeschosse") > 0) { d.gfzBestand = g.gfzBestand; d.gfHaupt = g.gfHaupt; }
    }
    if (S.umg && S.umg.n) { d.umgN = S.umg.n; d.umgGrz = median(S.umg.grz); d.umgGeschosse = S.umg.ges.length ? median(S.umg.ges) : null; }
    if (g.grz !== null) {
      d.zulGrund = g.grz * g.A; d.zulGrund2 = g.grz2 * g.A; if (g.gfz !== null) { d.zulGF = g.gfz * g.A; }
      if (S.ber) { d.restGrund = g.grz * g.A - g.bestHaupt; if (g.gfz !== null && d.gfHaupt !== undefined) { d.restGF = g.gfz * g.A - g.gfHaupt; } }
      d.abstand = g.abstand; d.baufeld = g.baufeldVoll; d.frei = g.frei; d.n = g.n; d.H = g.H; d.grundBau = g.grundflaecheBau; d.gfBau = g.gfBau;
    }
    var pe = potenzialBerechnen();
    if (pe) { d.pot = pe.kenn; d.potStaerken = pe.staerken; d.potAchten = pe.achten; }
    return d;
  }
  // Zeilen im Format des KI-Textes: Überschrift, darunter "  - Merkmal: Wert"
  function datenblatt() {
    var d = daten(), f = S.f;
    if (!d) { return null; }
    var z = ["Grundstück (amtliches Kataster, LGLN):"];
    function p(l, w) { z.push("  - " + l + ": " + w); }
    p("Lage", bezeichnung(f));
    p("Fläche", qm(d.A));
    p("Nutzung im Kataster", d.nutzung || "nicht angegeben");
    if (d.bestHaupt !== undefined) {
      p("Bestand: Hauptgebäude", d.nHaupt + " Gebäude, " + qm(d.bestHaupt));
      p("Bestand: Garagen und Nebengebäude", qm(d.bestNeben));
      p("Bestand: Überdachungen und sonstige Bauwerke", qm(d.bestSonst));
      p("Bestand GRZ (Hauptgebäude)", zahlDe(d.grzHaupt, 2) + "; mit Garagen und Nebengebäuden " + zahlDe(d.grzGeb, 2));
      if (d.gfzBestand !== undefined) { p("Bestand GFZ (Schätzung aus den Gebäudehöhen, Traufhöhe geteilt durch " + zahlDe(GESCHOSSHOEHE, 1) + " m je Geschoss)", zahlDe(d.gfzBestand, 2) + " (Geschossfläche etwa " + qm(d.gfHaupt) + ")"); }
    }
    if (d.umgN) { p("Umgebung (" + UMGEBUNG_RADIUS + " m, " + d.umgN + " Grundstücke mit Gebäuden)", "GRZ der Gebäude im Median " + zahlDe(d.umgGrz, 2) + (d.umgGeschosse !== null ? ", Geschosse im Median " + zahlDe(d.umgGeschosse, 0) : "")); }
    if (d.grz !== null) {
      p("Angenommene Obergrenzen (nicht aus einem Bebauungsplan, vom Nutzer einstellbar)", (d.gebietName || "eigene Werte") + ": GRZ " + zahlDe(d.grz, 2) + (d.gfz !== null ? ", GFZ " + zahlDe(d.gfz, 2) : ""));
      p("Zulässige Grundfläche", qm(d.zulGrund) + " (mit Garagen und Nebenanlagen bis GRZ " + zahlDe(d.grz2, 2) + ": " + qm(d.zulGrund2) + ")");
      if (d.restGrund !== undefined) { p("Noch nicht ausgenutzte Grundfläche", d.restGrund >= 0 ? qm(d.restGrund) : "keine, der Bestand liegt " + qm(-d.restGrund) + " darüber"); }
      if (d.zulGF !== undefined) { p("Zulässige Geschossfläche", qm(d.zulGF) + (d.restGF !== undefined ? "; noch nicht ausgenutzt (Schätzung) " + (d.restGF >= 0 ? qm(d.restGF) : "keine") : "")); }
      p("Baufeld bei " + zahlDe(d.abstand, 1) + " m Abstand zur Grundstücksgrenze", qm(d.baufeld) + (d.frei !== null && d.frei !== undefined ? ", davon frei vom Bestand " + qm(d.frei) : ""));
      p("Baukörper-Studie", qm(d.grundBau) + " Grundfläche, " + d.n + " Geschosse, " + zahlDe(d.H, 1) + " m Höhe, Geschossfläche " + qm(d.gfBau));
    }
    z.push("  - (Orientierungswerte, keine amtliche Auskunft; Baugrenzen und Festsetzungen des Bebauungsplans, Baulasten, Abstände zur Straße und Sonderregeln der Bauordnung sind nicht berücksichtigt)");
    // Potenzial und Einschränkungen: je Frage eine Überschrift, Zahlen als "Merkmal: Wert", Aussagen als eigene Zeilen
    var pe = potenzialBerechnen();
    if (pe) {
      z.push("Potenzial und Einschränkungen des Grundstücks (regelbasiert aus den App-Daten, Orientierung ohne Rechtsauskunft):");
      pe.abschnitte.forEach(function (a) {
        z.push("  - " + a.titel);
        a.zeilen.forEach(function (r) { z.push("  - " + r[0] + ": " + r[1]); });
        a.liste.forEach(function (x) { z.push("  - " + x); });
      });
    }
    return z;
  }
  // Wartet, bis die Gebäude des Grundstücks geladen sind (und auf Wunsch die Gebäudehöhen für die GFZ), damit der Entwurfstext vollständig ist
  function bereit(mitHoehen) {
    if (!S.f) { return Promise.resolve(); }
    var f = S.f, start = Date.now();
    function warteBestand() {
      if (S.f !== f || (S.ber && S.pot) || Date.now() - start > 15000) { return Promise.resolve(); }
      return new Promise(function (ok) { setTimeout(ok, 150); }).then(warteBestand);
    }
    return warteBestand().then(function () {
      if (!mitHoehen || hoehenGedeckt(f.bb)) { return null; }
      return holeHoehen(f.bb).then(function () { if (S.f === f) { aktualisiereAnzeige(); } return umgebungRechnen(S.token); }).catch(function () { /* ohne Höhen bleibt die GFZ ungeschätzt */ });
    });
  }
  // ---------- Oberfläche ----------
  function zustandSpeichern() {
    if (!S.f) { return null; }
    return {
      id: S.f.id, bbox: S.f.bb, baufeld: !!S.zeigeBaufeld,
      werte: { gebiet: el("grundGebiet").value, grz: el("grundGrz").value, gfz: el("grundGfz").value, geschosse: el("grundGeschosse").value, abstand: el("grundAbstand").value, bestand: el("grundBestandGeschosse").value,
               miete: el("grundMiete").value, baukosten: el("grundBaukosten").value }
    };
  }
  function stelleWiederHer(z) {
    if (!z || !z.id) { return Promise.resolve(); }
    var bb = z.bbox;
    return ladeBereich(bb[0], bb[1], bb[2], bb[3], false).then(function () {
      var f = flst.get(z.id);
      if (f) {
        var w = z.werte || {};
        if (w.gebiet && GEBIETE[w.gebiet]) { el("grundGebiet").value = w.gebiet; }
        el("grundGrz").value = w.grz || el("grundGrz").value; el("grundGfz").value = w.gfz || el("grundGfz").value;
        el("grundGeschosse").value = w.geschosse || ""; el("grundAbstand").value = w.abstand || ""; el("grundBestandGeschosse").value = w.bestand || "";
        if (w.miete) { el("grundMiete").value = w.miete; } if (w.baukosten) { el("grundBaukosten").value = w.baukosten; }
        el("grundBaufeldZeigen").checked = !!z.baufeld; S.zeigeBaufeld = !!z.baufeld;
        waehleGrundstueck(f, { behalteWerte: true });
      }
    }).catch(function () { /* ohne Internet bleibt die Auswahl leer */ });
  }
  function loesche() { S.token++; S.f = null; S.ber = null; S.umg = null; S.g = null; S.feld = null; S.pot = null; S.potErgebnis = null; zeigeAuswahl(); el("grundDaten").hidden = true; }

  function neuRechnen() { if (S.f) { aktualisiereAnzeige(); } }
  function initUi() {
    var sel = el("grundGebiet");
    Object.keys(GEBIETE).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = GEBIETE[k].n; sel.appendChild(o); });
    sel.value = "WA";
    el("grundGrz").value = "0,4"; el("grundGfz").value = "1,2";
    sel.addEventListener("change", function () {
      S.eigeneWerte = true;
      var g = GEBIETE[sel.value];
      el("grundGrz").value = String(g.grz).replace(".", ","); el("grundGfz").value = String(g.gfz).replace(".", ",");
      el("grundGeschosse").value = ""; el("grundAbstand").value = "";
      neuRechnen();
    });
    ["grundGrz", "grundGfz", "grundGeschosse", "grundAbstand", "grundBestandGeschosse"].forEach(function (id) {
      el(id).addEventListener("input", function () { if (id === "grundGrz" || id === "grundGfz") { S.eigeneWerte = true; } clearTimeout(initUi.t); initUi.t = setTimeout(neuRechnen, 300); });
    });
    ["grundMiete", "grundBaukosten"].forEach(function (id) {
      el(id).addEventListener("input", function () { clearTimeout(initUi.t); initUi.t = setTimeout(neuRechnen, 300); });
    });
    el("grundBaufeldZeigen").addEventListener("change", function () { S.zeigeBaufeld = el("grundBaufeldZeigen").checked; zeigeAuswahl(); });
    el("grundAmPunkt").addEventListener("click", function () { amPunkt(false); });
    el("grundKlick").addEventListener("click", function () { klickStarten(); });
    el("grundUebernehmen").addEventListener("click", uebernehmen);
    el("grundHoehenKnopf").addEventListener("click", function () {
      var k = el("grundHoehenKnopf"); k.disabled = true; setzeMeldung("Gebäudehöhen werden geladen (für die Umgebung des Grundstücks, einige MB) …");
      holeHoehen(S.f ? S.f.bb : null).then(function () { k.disabled = false; setzeMeldung(""); if (S.f) { aktualisiereAnzeige(); umgebungRechnen(S.token); } })
        .catch(function () { k.disabled = false; setzeMeldung("Die Gebäudehöhen konnten nicht geladen werden (Internet prüfen).", true); });
    });
    el("grundZuEntwurf").addEventListener("click", function () {
      var g = S.g; if (!g || g.grz === null) { return; }
      var fl = el("entwurfFlaeche"), ge = el("entwurfGeschosse");
      fl.value = String(Math.round(g.gfBau)); ge.value = g.n + " Geschosse (Studie, " + zahlDe(g.H, 1).replace(",0", "") + " m)";
      fl.dispatchEvent(new Event("input")); ge.dispatchEvent(new Event("input"));
      setzeMeldung("Geschossfläche und Geschosszahl der Studie stehen jetzt in „11 Entwurfsstrategie“. Das Grundstück selbst steht dort ohnehin im Standortteil.");
    });
    el("grundLoeschen").addEventListener("click", loesche);
    el("grundDatenblatt").addEventListener("click", function () {
      var z = datenblatt(); if (!z) { return; }
      var text = z.join("\n");
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { setzeMeldung("Das Datenblatt ist in der Zwischenablage."); }, function () { setzeMeldung("Das Kopieren hat nicht geklappt.", true); }); }
    });
  }
  initUi();

  window.grundstueck = {
    zeichneKarte: zeichneKarte, leereKarte: leereKarte, amPunkt: amPunkt, waehle: waehleGrundstueck, stelleWiederHer: stelleWiederHer, zustand: zustandSpeichern, loesche: loesche,
    vorbereitenBild: vorbereitenBild, zeichneInBild: zeichneInBild, legende: legende, imBild: imBild, quelle: quelle, datenblatt: datenblatt, daten: daten, bereit: bereit,
    klickBeenden: klickBeenden, ausgewaehlt: function () { return S.f; },
    // für Tests
    _intern: { kachelF: kachelF, kachelG: kachelG, bereitG: bereitG, warteschlange: function () { return { laufend: laufend, wartend: wartend.length }; }, flst: flst, gebAlle: gebAlle, bebauung: bebauung, lok: lok, abstandsFeld: abstandsFeld, baufeld: baufeld, kontur: kontur, S: S, holeHoehen: holeHoehen, geschosse: geschosse }
  };
})();
