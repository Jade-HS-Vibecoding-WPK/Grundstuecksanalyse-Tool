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
  var kachelVorgang = new Map();   // "i,j" -> Versprechen
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
      "&SRSNAME=urn:ogc:def:crs:EPSG::4326&COUNT=10000";
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
  function parseFlst(doc) {
    var els = doc.getElementsByTagNameNS("*", "Flurstueck");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], id = textVon(e, "idflurst");
      if (!id || flst.has(id)) { continue; }
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
      flst.set(id, f);
    }
  }
  var NEBEN = /garage|parkhaus|carport|stellplatz|schuppen|gartenhaus|laube|stall|scheune|geräte|nebengeb|abstell|gewächshaus|pavillon|unterstand|trafo|umspann|pumpwerk|wetterschutz|fahrradhaus|bootshaus|kiosk/i;
  function parseGeb(doc) {
    var els = doc.getElementsByTagNameNS("*", "GebaeudeBauwerk");
    for (var i = 0; i < els.length; i++) {
      var e = els[i], id = textVon(e, "oid") || e.getAttribute("gml:id");
      if (!id || gebAlle.has(id)) { continue; }
      var nutz = textVon(e, "gebnutzbez"), fkt = textVon(e, "funktion");
      var art;
      if (nutz === "Gebäude") { art = "haupt"; }
      else if (/^Sonstiges/.test(nutz)) { art = "sonst"; }
      else { continue; }                                   // Bauteile (Arkaden, Vorsprünge) liegen schon im Gebäude
      var polys = polygoneVon(e);
      if (!polys.length) { continue; }
      var fl = 0; polys.forEach(function (p) { fl += flaecheGrad(p.a); });
      if (art === "haupt" && (NEBEN.test(fkt) || fl < 15)) { art = "neben"; }
      var b = { id: id, art: art, fkt: fkt, polys: polys, fl: fl, bb: umriss(polys) };
      gebAlle.set(id, b);
      for (var ci = Math.floor(b.bb[0] / RASTER); ci <= Math.floor(b.bb[2] / RASTER); ci++) {
        for (var cj = Math.floor(b.bb[1] / RASTER); cj <= Math.floor(b.bb[3] / RASTER); cj++) {
          var key = ci + "," + cj, l = gebRaster.get(key);
          if (!l) { l = []; gebRaster.set(key, l); }
          l.push(b);
        }
      }
    }
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

  function ladeKachel(i, j) {
    var key = i + "," + j;
    if (kachelVorgang.has(key)) { return kachelVorgang.get(key); }
    var s = i * KACHEL_LA, w = j * KACHEL_LO, n = s + KACHEL_LA, o = w + KACHEL_LO, pl = 0.0004, po = 0.0007;
    var p = Promise.all([holeGml("Flurstueck", s, w, n, o), holeGml("GebaeudeBauwerk", s - pl, w - po, n + pl, o + po)]).then(function (r) {
      parseFlst(r[0]); parseGeb(r[1]);
    });
    kachelVorgang.set(key, p);
    p.catch(function () { kachelVorgang.delete(key); });     // beim nächsten Mal noch einmal versuchen
    return p;
  }
  function kachelnFuer(s, w, n, o) {
    var liste = [];
    for (var i = Math.floor(s / KACHEL_LA); i <= Math.floor(n / KACHEL_LA); i++) { for (var j = Math.floor(w / KACHEL_LO); j <= Math.floor(o / KACHEL_LO); j++) { liste.push([i, j]); } }
    return liste;
  }
  function ladeBereich(s, w, n, o) {
    return Promise.all(kachelnFuer(s, w, n, o).map(function (k) { return ladeKachel(k[0], k[1]); }));
  }

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

  // Fläche des Gebäudes, die auf dem Grundstück liegt: liegt es ganz darin, zählt seine volle Fläche, sonst wird abgetastet
  function innenFlaeche(b, L0) {
    var gp = gebLokal(b, L0), g0 = gp[0];
    var x0 = Math.max(g0.bb[0], L0.bb[0]), y0 = Math.max(g0.bb[1], L0.bb[1]), x1 = Math.min(g0.bb[2], L0.bb[2]), y1 = Math.min(g0.bb[3], L0.bb[3]);
    if (x1 <= x0 || y1 <= y0) { return 0; }
    var alle = true;
    for (var i = 0; i < g0.a.length; i += 2) { if (!imGrundstueck(g0.a[i], g0.a[i + 1], L0)) { alle = false; break; } }
    if (alle) { return b.fl; }
    var schritt = Math.max(0.2, Math.sqrt((x1 - x0) * (y1 - y0) / 5000)), n = 0;
    for (var y = y0 + schritt / 2; y < y1; y += schritt) {
      for (var x = x0 + schritt / 2; x < x1; x += schritt) {
        var inG = false;
        for (var q = 0; q < gp.length; q++) { if (pip(x, y, gp[q].a)) { inG = true; break; } }
        if (inG && imGrundstueck(x, y, L0)) { n++; }
      }
    }
    return n * schritt * schritt;
  }
  // Überbaute Fläche eines Grundstücks, getrennt nach Hauptgebäuden, Garagen und Nebengebäuden, sonstigen Bauwerken (Überdachungen)
  function bebauung(f) {
    var L0 = lok(f), erg = { haupt: 0, neben: 0, sonst: 0, nHaupt: 0, teile: [] };
    gebInRechteck(f.bb[0], f.bb[1], f.bb[2], f.bb[3]).forEach(function (b) {
      var a = innenFlaeche(b, L0);
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
  var hoehenIdx = null, hoehenVorgang = null;
  function holeHoehen() {
    if (hoehenIdx) { return Promise.resolve(hoehenIdx); }
    if (hoehenVorgang) { return hoehenVorgang; }
    hoehenVorgang = window.ladeAnsicht3d().then(function () { return window.ansicht3d.daten.gebaeude(); }).then(function (liste) {
      var idx = new Map();
      liste.forEach(function (g) {
        var key = Math.floor(g.lat / RASTER) + "," + Math.floor(g.lng / RASTER), l = idx.get(key);
        if (!l) { l = []; idx.set(key, l); }
        l.push(g);
      });
      hoehenIdx = idx;
      return idx;
    }, function (x) { hoehenVorgang = null; throw x; });
    return hoehenVorgang;
  }
  function pipGrad(lat, lng, ring) {
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
    var z = document.createElement("div"); z.className = "grundZeile" + (hervor ? " hervor" : "");
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
    S.f = f; S.ber = null; S.umg = null; S.bau = null; S.g = null; S.feld = null;
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
    ladeBereich(f.bb[0] - ra, f.bb[1] - ro, f.bb[2] + ra, f.bb[3] + ro).then(function () {
      if (token !== S.token) { return; }
      S.ber = bebauung(f);
      aktualisiereAnzeige();
      umgebungRechnen(token);
    }).catch(function (x) { if (token === S.token) { setzeMeldung("Die Gebäude des Katasters konnten nicht geladen werden (kein Internet oder der Dienst ist gerade nicht erreichbar).", true); if (window.console) { console.error(x); } } });
    aktualisiereAnzeige();

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

  function amPunkt(still) {
    if (!marker) { if (!still) { setzeMeldung("Bitte zuerst eine Adresse suchen (Abschnitt 01). Dann ist das Grundstück am roten Punkt gewählt.", true); } return Promise.resolve(); }
    var ll = marker.getLatLng();
    return suche(ll, still);
  }
  function suche(ll, still) {
    setzeMeldung("Grundstück wird gesucht …");
    var kl = Math.floor(ll.lat / KACHEL_LA), kj = Math.floor(ll.lng / KACHEL_LO);
    return ladeKachel(kl, kj).then(function () {
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
      if (!hoehenIdx) { absatz(best, "Die Geschosszahl wird aus den Gebäudehöhen des Landesamts geschätzt (Traufhöhe geteilt durch " + zahlDe(GESCHOSSHOEHE, 1) + " m). Dafür müssen einmalig etwa 13 MB geladen werden."); }
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
  function zeichneKarte() {
    var grenzen = FLST[0], farbig = FLST[1];
    var an1 = karte.hasLayer(grenzen.ebene), an2 = karte.hasLayer(farbig.ebene);
    leereKarte();
    if (!an1 && !an2) { return; }
    if (karte.getZoom() < MIN_ZOOM) { setzeKartenStatus("Die Grundstücke erscheinen erst in der Nahansicht (ab Zoomstufe " + MIN_ZOOM + "). Bitte weiter hineinzoomen."); return; }
    var nr = ++ladeNr, b = karte.getBounds().pad(0.1);
    setzeKartenStatus("Grundstücke werden geladen …");
    ladeBereich(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).then(function () {
      if (nr !== ladeNr) { return; }
      setzeKartenStatus("");
      var liste = flstInRechteck(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).slice(0, 7000);
      var zoom = karte.getZoom();
      liste.forEach(function (f) {
        var ringe = f.polys.map(function (p) { return [p.a].concat(p.i); });
        if (an2) {
          var gz = grzGebaeude(f);
          if (gz !== null) { L.polygon(ringe, { renderer: renderer("grundFuellPane"), stroke: false, fillColor: grzKlasse(gz).farbe, fillOpacity: farbig.deckkraft, interactive: false }).addTo(farbig.ebene); }
        }
        if (an1) {
          var p = L.polygon(ringe, { renderer: renderer("grundLinienPane"), color: grenzen.farbe, weight: 1.2, fill: true, fillOpacity: 0, interactive: true }).addTo(grenzen.ebene);
          p.on("click", function (ev) { if (grundWahl) { return; } zeigePopup(p, popupInhalt(f), ev.latlng); });
          if (zoom >= 18 && f.flaeche > 0) {
            L.marker(f.mitte, { icon: L.divIcon({ className: "grundLabel", html: "<span>" + zahlDe(Math.round(f.flaeche), 0) + " m²</span>", iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(grenzen.ebene);
          }
        }
      });
    }).catch(function (x) {
      if (nr !== ladeNr) { return; }
      setzeKartenStatus("Die Grundstücke konnten nicht geladen werden (Internet prüfen oder später noch einmal versuchen).", true);
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
    return ladeBereich(bb[0], bb[1], bb[2], bb[3]).then(function () {
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
  function legende() {
    var e = [];
    if (bildDaten) {
      if (bildDaten.ebenen.indexOf(FLST[0]) >= 0) { e.push({ art: "linie", farbe: FLST[0].farbe, text: FLST[0].legende }); }
      if (bildDaten.ebenen.indexOf(FLST[1]) >= 0) { GRZ_KLASSEN.forEach(function (k, i) { e.push({ art: "flaeche", farbe: k.farbe, deckkraft: 0.9, text: (i === 0 ? "Überbauung der Grundstücke (GRZ der Gebäude): " : "GRZ: ") + k.text }); }); }
    }
    if (S.f) { e.push({ art: "linie", farbe: "#c0392b", text: "Gewähltes Grundstück" }); }
    if (S.f && S.zeigeBaufeld && S.g && S.g.bauRingeGrad) { e.push({ art: "flaeche", farbe: "#c0392b", deckkraft: 0.4, rand: "#c0392b", text: "Baufeld (Studie: Abstand zur Grenze und GRZ)" }); }
    return e;
  }
  function imBild() { return !!bildDaten || !!S.f; }
  function quelle() { return (bildDaten || S.f) ? "  ·  Grundstücke und Gebäude: © LGLN (" + jahr + "), CC BY 4.0" : ""; }

  // ---------- Datenblatt für die Entwurfsstrategie ----------
  function datenblatt() {
    var f = S.f, g = S.g;
    if (!f || !g) { return null; }
    var z = [];
    z.push("Grundstück (amtliches Kataster, LGLN): " + bezeichnung(f));
    z.push("  Fläche: " + qm(g.A) + "; Nutzung im Kataster: " + (nutzText(f) || "nicht angegeben"));
    if (S.ber) {
      z.push("  Bestand: Hauptgebäude " + S.ber.nHaupt + " (" + qm(g.bestHaupt) + "), Garagen und Nebengebäude " + qm(g.bestNeben) + ", Überdachungen und sonstige Bauwerke " + qm(g.bestSonst));
      z.push("  Bestand GRZ (Hauptgebäude): " + zahlDe(g.grzHaupt, 2) + "; GRZ mit Nebengebäuden: " + zahlDe(g.grzGeb, 2));
      if (hoehenIdx || lesenZahl("grundBestandGeschosse") > 0) { z.push("  Bestand GFZ (Schätzung aus Gebäudehöhen, Traufhöhe geteilt durch " + zahlDe(GESCHOSSHOEHE, 1) + " m): " + zahlDe(g.gfzBestand, 2) + " (Geschossfläche etwa " + qm(g.gfHaupt) + ")"); }
    }
    if (S.umg && S.umg.n) {
      z.push("  Umgebung (" + UMGEBUNG_RADIUS + " m, " + S.umg.n + " Grundstücke mit Gebäuden): GRZ der Gebäude im Median " + zahlDe(median(S.umg.grz), 2) + (S.umg.ges.length ? ", Geschosse im Median " + zahlDe(median(S.umg.ges), 0) : ""));
    }
    if (g.grz !== null) {
      var gebiet = GEBIETE[el("grundGebiet").value];
      z.push("  Angenommene Obergrenzen (" + (gebiet ? gebiet.n : "eigene Werte") + "; vom Nutzer einstellbar, nicht aus einem Bebauungsplan abgeleitet): GRZ " + zahlDe(g.grz, 2) + (g.gfz !== null ? ", GFZ " + zahlDe(g.gfz, 2) : ""));
      z.push("  Zulässige Grundfläche " + qm(g.grz * g.A) + " (mit Garagen und Nebenanlagen bis GRZ " + zahlDe(g.grz2, 2) + ": " + qm(g.grz2 * g.A) + ")" + (g.gfz !== null ? "; zulässige Geschossfläche " + qm(g.gfz * g.A) : ""));
      z.push("  Baufeld bei " + zahlDe(g.abstand, 1) + " m Abstand zur Grundstücksgrenze: " + qm(g.baufeldVoll) + (g.frei !== null && g.frei !== undefined ? ", davon frei vom Bestand " + qm(g.frei) : ""));
      z.push("  Baukörper-Studie: " + qm(g.grundflaecheBau) + " Grundfläche, " + g.n + " Geschosse, " + zahlDe(g.H, 1) + " m Höhe, Geschossfläche " + qm(g.gfBau));
    }
    z.push("  Hinweis: Orientierungswerte; Baugrenzen, Baulasten, Abstände zur Straße und Sonderregeln der Bauordnung sind nicht berücksichtigt.");
    return z;
  }

  // ---------- Oberfläche ----------
  function zustandSpeichern() {
    if (!S.f) { return null; }
    return {
      id: S.f.id, bbox: S.f.bb, baufeld: !!S.zeigeBaufeld,
      werte: { gebiet: el("grundGebiet").value, grz: el("grundGrz").value, gfz: el("grundGfz").value, geschosse: el("grundGeschosse").value, abstand: el("grundAbstand").value, bestand: el("grundBestandGeschosse").value }
    };
  }
  function stelleWiederHer(z) {
    if (!z || !z.id) { return Promise.resolve(); }
    var bb = z.bbox;
    return ladeBereich(bb[0], bb[1], bb[2], bb[3]).then(function () {
      var f = flst.get(z.id);
      if (f) {
        var w = z.werte || {};
        if (w.gebiet && GEBIETE[w.gebiet]) { el("grundGebiet").value = w.gebiet; }
        el("grundGrz").value = w.grz || el("grundGrz").value; el("grundGfz").value = w.gfz || el("grundGfz").value;
        el("grundGeschosse").value = w.geschosse || ""; el("grundAbstand").value = w.abstand || ""; el("grundBestandGeschosse").value = w.bestand || "";
        el("grundBaufeldZeigen").checked = !!z.baufeld; S.zeigeBaufeld = !!z.baufeld;
        waehleGrundstueck(f, { behalteWerte: true });
      }
    }).catch(function () { /* ohne Internet bleibt die Auswahl leer */ });
  }
  function loesche() { S.token++; S.f = null; S.ber = null; S.umg = null; S.g = null; S.feld = null; zeigeAuswahl(); el("grundDaten").hidden = true; }

  function neuRechnen() { if (S.f) { aktualisiereAnzeige(); } }
  function initUi() {
    var sel = el("grundGebiet");
    Object.keys(GEBIETE).forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = GEBIETE[k].n; sel.appendChild(o); });
    sel.value = "WA";
    el("grundGrz").value = "0,4"; el("grundGfz").value = "1,2";
    sel.addEventListener("change", function () {
      var g = GEBIETE[sel.value];
      el("grundGrz").value = String(g.grz).replace(".", ","); el("grundGfz").value = String(g.gfz).replace(".", ",");
      el("grundGeschosse").value = ""; el("grundAbstand").value = "";
      neuRechnen();
    });
    ["grundGrz", "grundGfz", "grundGeschosse", "grundAbstand", "grundBestandGeschosse"].forEach(function (id) {
      el(id).addEventListener("input", function () { clearTimeout(initUi.t); initUi.t = setTimeout(neuRechnen, 300); });
    });
    el("grundBaufeldZeigen").addEventListener("change", function () { S.zeigeBaufeld = el("grundBaufeldZeigen").checked; zeigeAuswahl(); });
    el("grundAmPunkt").addEventListener("click", function () { amPunkt(false); });
    el("grundKlick").addEventListener("click", function () { klickStarten(); });
    el("grundUebernehmen").addEventListener("click", uebernehmen);
    el("grundHoehenKnopf").addEventListener("click", function () {
      var k = el("grundHoehenKnopf"); k.disabled = true; setzeMeldung("Gebäudehöhen werden geladen (einmalig etwa 13 MB) …");
      holeHoehen().then(function () { k.disabled = false; setzeMeldung(""); if (S.f) { aktualisiereAnzeige(); umgebungRechnen(S.token); } })
        .catch(function () { k.disabled = false; setzeMeldung("Die Gebäudehöhen konnten nicht geladen werden (Internet prüfen).", true); });
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
    vorbereitenBild: vorbereitenBild, zeichneInBild: zeichneInBild, legende: legende, imBild: imBild, quelle: quelle, datenblatt: datenblatt,
    klickBeenden: klickBeenden, ausgewaehlt: function () { return S.f; },
    // für Tests
    _intern: { flst: flst, gebAlle: gebAlle, bebauung: bebauung, lok: lok, abstandsFeld: abstandsFeld, baufeld: baufeld, kontur: kontur, S: S, holeHoehen: holeHoehen, geschosse: geschosse }
  };
})();
