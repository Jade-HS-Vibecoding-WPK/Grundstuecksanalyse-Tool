// Schnitt durch die Umgebung (Abschnitt "14 Schnitt" der Seitenleiste).
// Wird erst geladen, wenn man im Abschnitt "14 Schnitt" einen Knopf drückt oder ein Projekt mit Schnittlinie öffnet.
// Man zieht eine Linie (A–A') über die Karte; darunter erscheint der Schnitt: Gelände, Gebäude (mit Dachform), Bäume, Wälder und
// eigene Baukörper, geschnitten (dunkel) und dahinter als Ansicht (hell). Speichern als PNG, PDF oder SVG.
// Daten: Gelände und Gebäudehöhen kommen aus den Dateien der 3D-Ansicht (window.ansicht3d.daten), Bäume aus der Hauptseite.
(function () {
  "use strict";

  var M_LAT = 111195;                                   // Meter je Grad Breite
  var MAX_LAENGE = 3000;                                // längste Schnittlinie in Metern
  var HIMMEL = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];
  var QUELLE_GELAENDE = "Gelände: LGLN (DGM1), CC BY 4.0";
  var QUELLE_HOEHEN = "Gebäudehöhen: LGLN (2024), CC BY 4.0";
  var QUELLE_OSM = "Bäume, Wälder: © OpenStreetMap-Mitwirkende";
  var ROT = "#c0392b";

  // ---------- Zustand (wird mit dem Projekt gespeichert) ----------
  var Z = { punkte: [], blick: "rechts", tiefe: 40, ueber: 1, gebaeude: true, baeume: true, wald: true, eigene: true, ausblenden: true, waldHoehe: 18 };

  var zeichnet = false, neuePunkte = [], gummi = null;
  var linie = null, griffe = [], pfeil = null, positionMarke = null;
  var panel = null, ergebnis = null, svgInfo = null, timer = null, rechnungNr = 0, datenGeladen = false;

  function el(id) { return document.getElementById(id); }
  function z1(v, d) { return Number(v).toLocaleString("de-DE", { minimumFractionDigits: d === undefined ? 1 : d, maximumFractionDigits: d === undefined ? 1 : d }); }
  function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function info(text, fehler) { var e = el("schnittInfo"); if (e) { e.textContent = text || ""; e.style.color = fehler ? "var(--fehler)" : ""; } }

  // ---------- Geometrie ----------
  function lokal() {
    var p0 = Z.punkte[0], mLng = M_LAT * Math.cos(p0[0] * Math.PI / 180);
    return { lat0: p0[0], lng0: p0[1], mLng: mLng, pts: Z.punkte.map(function (p) { return [(p[1] - p0[1]) * mLng, (p[0] - p0[0]) * M_LAT]; }) };
  }
  function segmenteAus(pts) {
    var s = [], acc = 0;
    for (var i = 0; i + 1 < pts.length; i++) {
      var dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.01) { continue; }
      s.push({ ax: pts[i][0], ay: pts[i][1], bx: pts[i + 1][0], by: pts[i + 1][1], len: len, ux: dx / len, uy: dy / len, s0: acc });
      acc += len;
    }
    return { segs: s, L: acc };
  }
  function imVieleck(x, y, r) {
    var innen = false;
    for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      var xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) { innen = !innen; }
    }
    return innen;
  }
  function imRinge(x, y, ringe) {                          // Außenring und Höfe, gerade/ungerade
    var n = 0;
    for (var i = 0; i < ringe.length; i++) { if (imVieleck(x, y, ringe[i])) { n++; } }
    return (n & 1) === 1;
  }
  // Wo liegt die Schnittlinie im Vieleck? Liste von { si (Segment), a, b (Strecke gemessen ab A) }
  function schnittMit(ringe, segs) {
    var res = [];
    segs.forEach(function (sg, si) {
      var ts = [0, sg.len], k;
      ringe.forEach(function (r) {
        for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
          var x1 = r[j], y1 = r[j + 1], ex = r[i] - x1, ey = r[i + 1] - y1, den = sg.ux * ey - sg.uy * ex;
          if (Math.abs(den) < 1e-12) { continue; }
          var wx = x1 - sg.ax, wy = y1 - sg.ay, t = (wx * ey - wy * ex) / den, v = (sg.uy * wx - sg.ux * wy) / den;
          if (v >= 0 && v < 1 && t > 0 && t < sg.len) { ts.push(t); }
        }
      });
      ts.sort(function (p, q) { return p - q; });
      var letzter = null;
      for (k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 0.02) { continue; }
        var m = (ts[k] + ts[k + 1]) / 2;
        if (!imRinge(sg.ax + sg.ux * m, sg.ay + sg.uy * m, ringe)) { letzter = null; continue; }
        if (letzter && Math.abs(letzter.u1 - ts[k]) < 0.03) { letzter.u1 = ts[k + 1]; letzter.b = sg.s0 + ts[k + 1]; }
        else { letzter = { si: si, u0: ts[k], u1: ts[k + 1], a: sg.s0 + ts[k], b: sg.s0 + ts[k + 1] }; res.push(letzter); }
      }
    });
    return res;
  }
  // nächstes Segment zu einem Punkt: { sg, u (Position entlang), d (Abstand links positiv), abstand (zum Segment) }
  function naechstes(segs, x, y) {
    var best = null;
    segs.forEach(function (sg) {
      var wx = x - sg.ax, wy = y - sg.ay, u = wx * sg.ux + wy * sg.uy, d = -wx * sg.uy + wy * sg.ux;
      var uc = Math.max(0, Math.min(sg.len, u)), ex = wx - sg.ux * uc, ey = wy - sg.uy * uc, ab = Math.sqrt(ex * ex + ey * ey);
      if (!best || ab < best.abstand) { best = { sg: sg, u: u, d: d, abstand: ab }; }
    });
    return best;
  }

  // ---------- Daten ----------
  // Rechteck um die Schnittlinie (Grad), mit Rand für die Ansicht dahinter (Höhen und Gelände werden nur für dieses Rechteck geladen)
  function linienBox() {
    var la = Z.punkte.map(function (p) { return p[0]; }), lo = Z.punkte.map(function (p) { return p[1]; });
    var s = Math.min.apply(null, la), n = Math.max.apply(null, la), w = Math.min.apply(null, lo), o = Math.max.apply(null, lo);
    var dLat = 400 / M_LAT, dLng = 400 / (M_LAT * Math.cos((s + n) / 2 * Math.PI / 180));
    return { s: s - dLat, n: n + dLat, w: w - dLng, o: o + dLng };
  }
  function ladeDaten() {
    var box = linienBox();
    return ladeAnsicht3d().then(function () {
      var D = window.ansicht3d && window.ansicht3d.daten;
      if (!D) { throw new Error("Die Höhen- und Geländedaten der 3D-Ansicht fehlen."); }
      return Promise.all([
        D.gelaende(box), D.gebaeude(box),
        D.waelder().catch(function () { return []; }),
        ladeBaeumeDaten().catch(function () { return []; })
      ]).then(function (r) {
        datenGeladen = true;
        return { G: r[0], geb: r[1], wald: r[2], baeume: r[3], utm32: D.utm32, dach: D.dach };
      });
    });
  }
  // Gelände in Metern über NHN an einem Punkt in lokalen Metern (x = Ost, y = Nord um den ersten Punkt der Linie)
  function gelaendeFunktion(daten, lo) {
    var G = daten.G, o = daten.utm32(lo.lat0, lo.lng0), oe = daten.utm32(lo.lat0, lo.lng0 + 1000 / lo.mLng), on = daten.utm32(lo.lat0 + 1000 / M_LAT, lo.lng0);
    var a11 = (oe.e - o.e) / 1000, a21 = (oe.n - o.n) / 1000, a12 = (on.e - o.e) / 1000, a22 = (on.n - o.n) / 1000, h = G.h, W = G.W, H = G.H;
    return function (x, y) {
      var c = ((o.e + a11 * x + a12 * y) - G.e0) / G.schritt - 0.5, r = (G.n1 - (o.n + a21 * x + a22 * y)) / G.schritt - 0.5;
      var c0 = Math.floor(c), r0 = Math.floor(r), fx = c - c0, fy = r - r0, c1 = c0 + 1, r1 = r0 + 1;
      c0 = c0 < 0 ? 0 : (c0 > W - 1 ? W - 1 : c0); c1 = c1 < 0 ? 0 : (c1 > W - 1 ? W - 1 : c1);
      r0 = r0 < 0 ? 0 : (r0 > H - 1 ? H - 1 : r0); r1 = r1 < 0 ? 0 : (r1 > H - 1 ? H - 1 : r1);
      var v = (h[r0 * W + c0] * (1 - fx) + h[r0 * W + c1] * fx) * (1 - fy) + (h[r1 * W + c0] * (1 - fx) + h[r1 * W + c1] * fx) * fy;
      return v * 0.1;
    };
  }

  // ---------- Rechnung ----------
  function rechne(daten) {
    var lo = lokal(), sg = segmenteAus(lo.pts), segs = sg.segs, L = sg.L;
    if (!segs.length || L < 3) { throw new Error("Die Schnittlinie ist zu kurz."); }
    var gz = gelaendeFunktion(daten, lo);
    var tiefe = Z.tiefe > 0 ? Z.tiefe : 0, rand = tiefe + 60, side = Z.blick === "links" ? 1 : -1;
    var xs = lo.pts.map(function (p) { return p[0]; }), ys = lo.pts.map(function (p) { return p[1]; });
    var bx0 = Math.min.apply(null, xs) - rand, bx1 = Math.max.apply(null, xs) + rand, by0 = Math.min.apply(null, ys) - rand, by1 = Math.max.apply(null, ys) + rand;
    var lat0 = lo.lat0, lng0 = lo.lng0, mLng = lo.mLng;
    function inBox(lat, lng) { var x = (lng - lng0) * mLng, y = (lat - lat0) * M_LAT; return x >= bx0 && x <= bx1 && y >= by0 && y <= by1; }
    function ringLokal(r) { var a = new Float64Array(r.length); for (var i = 0; i < r.length; i += 2) { a[i] = (r[i + 1] - lng0) * mLng; a[i + 1] = (r[i] - lat0) * M_LAT; } return a; }

    // Gelände
    var schritt = Math.max(0.5, L / 1200), n = Math.ceil(L / schritt), terr = [], i, k;
    function punktBei(s) {
      var sgm = segs[segs.length - 1];
      for (var q = 0; q < segs.length; q++) { if (s <= segs[q].s0 + segs[q].len + 1e-9) { sgm = segs[q]; break; } }
      var u = Math.max(0, Math.min(sgm.len, s - sgm.s0));
      return { x: sgm.ax + sgm.ux * u, y: sgm.ay + sgm.uy * u, sg: sgm };
    }
    for (i = 0; i <= n; i++) { var ss = Math.min(L, i * schritt), pp = punktBei(ss); terr.push([ss, gz(pp.x, pp.y)]); }

    var schnitte = [], hinten = [], zmin = 1e9, zmax = -1e9;
    function merke(zv) { if (zv < zmin) { zmin = zv; } if (zv > zmax) { zmax = zv; } }
    terr.forEach(function (t) { merke(t[1]); });

    // Grundlage eines Körpers: mittlere Geländehöhe an den Ecken (Bezug für die Höhen) und tiefste Ecke minus 20 cm (Wandfuß), wie in der 3D-Ansicht
    function gruendung(ring) {
      var s = 0, np = ring.length / 2, tief = 1e9, v;
      for (var q = 0; q < ring.length; q += 2) { v = gz(ring[q], ring[q + 1]); s += v; if (v < tief) { tief = v; } }
      return { y0: s / np, yb: tief - 0.2 };
    }
    // Umriss der Ansicht eines Körpers hinter der Linie (Rechteck, bei geneigtem Dach mit Dachlinie); null, wenn er nicht auf der Blickseite liegt
    function hintenLage(ringe, dichtesDach) {
      var r = ringe[0], cx = 0, cy = 0, np = r.length / 2;
      for (var q = 0; q < r.length; q += 2) { cx += r[q]; cy += r[q + 1]; }
      var nb = naechstes(segs, cx / np, cy / np), sgm = nb.sg, smin = 1e9, smax = -1e9, dmin = 1e9;
      for (q = 0; q < r.length; q += 2) {
        var wx = r[q] - sgm.ax, wy = r[q + 1] - sgm.ay, u = wx * sgm.ux + wy * sgm.uy, d = side * (-wx * sgm.uy + wy * sgm.ux);
        if (u < smin) { smin = u; } if (u > smax) { smax = u; } if (d < dmin) { dmin = d; }
      }
      if (nb.d * side <= 0 || dmin < -0.5 || dmin > tiefe) { return null; }
      var a = Math.max(0, sgm.s0 + smin), b = Math.min(L, sgm.s0 + smax);
      if (b - a < 0.3) { return null; }
      return { a: a, b: b, dist: Math.max(0, dmin) };
    }

    // eigene Baukörper aus der Zeichnung
    var eigene = [];
    if (Z.eigene && typeof zeichnung !== "undefined") {
      zeichnung.forEach(function (o) {
        if (!(o.hoehe > 0) || !o.punkte || !o.punkte.length) { return; }
        var ring = [];
        if (o.art === "flaeche" && !o.mass && o.punkte.length >= 3) { o.punkte.forEach(function (p) { ring.push(p.lat, p.lng); }); }
        else if (o.art === "punkt") {
          var rad = (o.durchmesser > 0 ? o.durchmesser : 2) / 2, p0 = o.punkte[0];
          for (var w = 0; w < 32; w++) { var wi = w / 32 * 2 * Math.PI; ring.push(p0.lat + Math.sin(wi) * rad / M_LAT, p0.lng + Math.cos(wi) * rad / mLng); }
        } else { return; }
        eigene.push({ o: o, ring: ringLokal(ring) });
      });
    }
    function ausgeblendet(g, ringe) {                          // Bestandsgebäude unter einem eigenen Baukörper (gleiche Regel wie in der 3D-Ansicht)
      if (!Z.ausblenden || !eigene.length) { return false; }
      var cx = (g.lng - lng0) * mLng, cy = (g.lat - lat0) * M_LAT;
      for (var q = 0; q < eigene.length; q++) {
        var em = eigene[q].ring, ex = 0, ey = 0, np = em.length / 2;
        if (imVieleck(cx, cy, em)) { return true; }
        for (var w = 0; w < em.length; w += 2) { ex += em[w]; ey += em[w + 1]; }
        if (imVieleck(ex / np, ey / np, ringe[0])) { return true; }
      }
      return false;
    }

    // Gebäude
    var dLat = rand / M_LAT, dLng = rand / mLng, zaehler = { geb: 0, gebHinten: 0, baeume: 0, wald: 0, eigen: 0 };
    if (Z.gebaeude) {
      var mitteLat = (lat0 + (by0 + by1) / 2 / M_LAT), mitteLng = lng0 + (bx0 + bx1) / 2 / mLng, halbLat = (by1 - by0) / 2 / M_LAT + 0.0005, halbLng = (bx1 - bx0) / 2 / mLng + 0.0007;
      daten.geb.forEach(function (g) {
        if (Math.abs(g.lat - mitteLat) > halbLat || Math.abs(g.lng - mitteLng) > halbLng) { return; }
        var ringe = g.ringe.map(ringLokal);
        if (ausgeblendet(g, ringe)) { return; }
        var gr = gruendung(ringe[0]), dach = null;
        if (g.t >= 1.5) { dach = daten.dach(ringe, g.t, g.f, g.cls, g.ang); }
        var flachH = Math.max(1.5, (g.t + g.f) / 2);
        var iv = schnittMit(ringe, segs);
        if (iv.length) {
          iv.forEach(function (v) {
            var sgm = segs[v.si], pts = [[v.a, gr.yb]], np = Math.max(2, Math.min(260, Math.ceil((v.b - v.a) / 0.4))), top = -1e9, q;
            for (q = 0; q <= np; q++) {
              var u = v.u0 + (v.u1 - v.u0) * q / np, hh = dach ? dach.hf(sgm.ax + sgm.ux * u, sgm.ay + sgm.uy * u) : flachH, zt = gr.y0 + hh;
              if (q === 0 || q === np || !dach || Math.abs(zt - pts[pts.length - 1][1]) > 0.04) { pts.push([sgm.s0 + u, zt]); }
              if (zt > top) { top = zt; }
            }
            pts.push([v.b, gr.yb]);
            merke(gr.yb); merke(top);
            schnitte.push({ typ: "geb", pts: pts, a: v.a, b: v.b, text: z1(top - gr.y0) + " m", hoehe: top - gr.y0 });
          });
          zaehler.geb++;
        } else if (Z.tiefe > 0) {
          var lage = hintenLage(ringe);
          if (!lage) { return; }
          var zt0 = gr.y0 + g.t, zt1 = gr.y0 + g.f, w = lage.b - lage.a, pts2;
          if (dach && g.f - g.t >= 0.3 && w > 3) { pts2 = [[lage.a, gr.yb], [lage.a, zt0], [lage.a + w * 0.3, zt1], [lage.b - w * 0.3, zt1], [lage.b, zt0], [lage.b, gr.yb]]; merke(zt1); }
          else { var zf = gr.y0 + flachH; pts2 = [[lage.a, gr.yb], [lage.a, zf], [lage.b, zf], [lage.b, gr.yb]]; merke(zf); }
          merke(gr.yb);
          hinten.push({ typ: "geb", pts: pts2, dist: lage.dist });
          zaehler.gebHinten++;
        }
      });
    }

    // Wälder (Blöcke wie in der 3D-Ansicht)
    if (Z.wald) {
      daten.wald.forEach(function (f) {
        var r0 = f.ringe[0], cla = 0, clo = 0, np = r0.length / 2, q;
        for (q = 0; q < r0.length; q += 2) { cla += r0[q]; clo += r0[q + 1]; }
        if (!inBox(cla / np, clo / np)) { return; }
        var ringe = f.ringe.map(ringLokal), gr = gruendung(ringe[0]), top = gr.y0 + Z.waldHoehe;
        var iv = schnittMit(ringe, segs);
        if (iv.length) {
          iv.forEach(function (v) { merke(gr.yb); merke(top); schnitte.push({ typ: "wald", pts: [[v.a, gr.yb], [v.a, top], [v.b, top], [v.b, gr.yb]], a: v.a, b: v.b }); });
          zaehler.wald++;
        } else if (Z.tiefe > 0) {
          var lage = hintenLage(ringe);
          if (!lage) { return; }
          merke(top); merke(gr.yb);
          hinten.push({ typ: "wald", pts: [[lage.a, gr.yb], [lage.a, top], [lage.b, top], [lage.b, gr.yb]], dist: lage.dist });
        }
      });
    }

    // eigene Baukörper
    eigene.forEach(function (e) {
      var ring = e.ring, gr = gruendung(ring), top = gr.y0 + e.o.hoehe, farbe = e.o.farbe || ROT, iv = schnittMit([ring], segs);
      if (iv.length) {
        iv.forEach(function (v) { merke(gr.yb); merke(top); schnitte.push({ typ: "eigen", pts: [[v.a, gr.yb], [v.a, top], [v.b, top], [v.b, gr.yb]], a: v.a, b: v.b, farbe: farbe, text: (e.o.name ? e.o.name + " · " : "") + z1(e.o.hoehe) + " m", hoehe: e.o.hoehe }); });
        zaehler.eigen++;
      } else if (Z.tiefe > 0) {
        var lage = hintenLage([ring]);
        if (!lage) { return; }
        merke(top); merke(gr.yb);
        hinten.push({ typ: "eigen", pts: [[lage.a, gr.yb], [lage.a, top], [lage.b, top], [lage.b, gr.yb]], dist: lage.dist, farbe: farbe });
      }
    });

    // Bäume (Kronen als Ellipsen, Stamm als Strich): Einzelbäume aus OpenStreetMap und eigene Bäume
    if (Z.baeume) {
      var liste = [];
      daten.baeume.forEach(function (b) {
        if (!inBox(b.lat, b.lng)) { return; }
        if (typeof baumAus !== "undefined" && baumAus[Math.round(b.lat * 1e6) + "," + Math.round(b.lng * 1e6)]) { return; }
        var h = b.h > 0 ? b.h : 12;
        liste.push({ x: (b.lng - lng0) * mLng, y: (b.lat - lat0) * M_LAT, h: h, kr: baumKroneBreite(b), ig: b.ig });
      });
      if (typeof zeichnung !== "undefined") {
        zeichnung.forEach(function (o) {
          if (o.art !== "baum" || !(o.hoehe > 0) || !o.punkte || !o.punkte.length) { return; }
          var p = o.punkte[0];
          liste.push({ x: (p.lng - lng0) * mLng, y: (p.lat - lat0) * M_LAT, h: o.hoehe, kr: o.krone > 0 ? o.krone : Math.max(3, o.hoehe * 0.65), ig: !!o.immergruen, eigen: true });
        });
      }
      liste.forEach(function (b) {
        var nb = naechstes(segs, b.x, b.y), a = b.kr / 2, stamm = b.ig ? 0.12 * b.h : 0.3 * b.h, y0 = gz(b.x, b.y), hk = (b.h - stamm) / 2, cy = y0 + stamm + hk;
        var s = nb.sg.s0 + nb.u;
        if (s < -a || s > L + a) { return; }
        var ad = Math.abs(nb.d), baum = { typ: "baum", s: s, cy: cy, rx: a, ry: hk, y0: y0, stammH: stamm, ig: b.ig, eigen: !!b.eigen };
        if (ad < a && nb.u >= 0 && nb.u <= nb.sg.len) {
          var f = Math.sqrt(1 - (ad / a) * (ad / a));
          baum.rx = a * f; baum.ry = hk * f;
          baum.stammGetroffen = ad < 0.3;
          merke(y0); merke(cy + baum.ry);
          schnitte.push(baum); zaehler.baeume++;
        } else if (Z.tiefe > 0 && nb.d * side > 0 && ad - a <= tiefe) {
          baum.dist = Math.max(0, ad - a);
          merke(y0); merke(cy + hk);
          hinten.push(baum);
        }
      });
    }

    // Standort (roter Punkt), falls nahe an der Linie
    var standort = null;
    if (typeof marker !== "undefined" && marker) {
      var ml = marker.getLatLng(), mx = (ml.lng - lng0) * mLng, my = (ml.lat - lat0) * M_LAT, nm = naechstes(segs, mx, my);
      if (nm.abstand <= 30 && nm.u >= 0 && nm.u <= nm.sg.len) { standort = { s: nm.sg.s0 + nm.u, z: gz(mx, my), abstand: nm.abstand }; }
    }
    // Knickpunkte der Linie (Strecke ab A)
    var knicke = [];
    for (i = 1; i < segs.length; i++) { knicke.push(segs[i].s0); }

    hinten.sort(function (p, q) { return q.dist - p.dist; });
    return { L: L, terr: terr, schnitte: schnitte, hinten: hinten, zmin: zmin, zmax: zmax, standort: standort, knicke: knicke, zaehler: zaehler, lo: lo, segs: segs, gz: gz };
  }

  // ---------- Zeichnung (SVG) ----------
  function schoenerSchritt(bereich, ziel) {
    var roh = bereich / ziel, basis = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (var i = 0; i < basis.length; i++) { if (basis[i] >= roh) { return basis[i]; } }
    return 1000;
  }
  function mische(a, b, t) {
    function h(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }
    var x = h(a), y = h(b), r = [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); });
    return "#" + r.map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
  }
  function himmelsrichtung(dx, dy) { var grad = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; return HIMMEL[Math.round(grad / 45) % 8]; }

  function baueSvg(R) {
    var W = 1400, ml = 78, mr = 34, mt = 74, mb = 118, plotB = W - ml - mr;
    var L = R.L, sx = plotB / L, sy = sx * Z.ueber;
    var zlo = Math.floor((R.zmin - 2) / 2) * 2, zhi = Math.ceil((R.zmax + 3) / 2) * 2;
    var plotH = Math.max(150, (zhi - zlo) * sy);
    if (plotH > (zhi - zlo) * sy) { zhi = zlo + plotH / sy; }
    var H = Math.round(mt + plotH + mb);
    function X(s) { return +(ml + s * sx).toFixed(2); }
    function Y(zv) { return +(mt + (zhi - zv) * sy).toFixed(2); }
    function poly(pts) { return pts.map(function (p) { return X(p[0]) + "," + Y(p[1]); }).join(" "); }

    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" font-family="Bahnschrift, \'Segoe UI\', Arial, sans-serif">');
    o.push('<defs><pattern id="sBoden" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#bcb5a4" stroke-width="1"/></pattern>' +
           '<pattern id="sWald" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#1d5a2b" stroke-width="1.2"/></pattern></defs>');
    o.push('<rect width="' + W + '" height="' + H + '" fill="#f5f3ee"/>');

    // Titel
    var s1 = R.segs[0], einzeln = R.segs.length === 1;
    var blickText = einzeln ? "Blick nach " + himmelsrichtung(Z.blick === "links" ? -s1.uy : s1.uy, Z.blick === "links" ? s1.ux : -s1.ux) : "Blick nach " + Z.blick + " der Linie";
    o.push('<text x="' + ml + '" y="30" font-size="22" font-weight="700" letter-spacing="1.5" fill="#1a1a1a">SCHNITT A–A′</text>');
    o.push('<text x="' + ml + '" y="52" font-size="13" fill="#77746d">Länge ' + z1(L, 0) + ' m · ' + (Z.tiefe > 0 ? blickText + ", Ansicht bis " + Z.tiefe + " m dahinter" : "nur der Schnitt, keine Ansicht dahinter") + ' · Überhöhung ' + (Z.ueber === 1 ? "keine (1:1)" : Z.ueber + "-fach") + '</text>');

    // Raster und Höhenachse
    var zs = schoenerSchritt(zhi - zlo, 7), zz;
    o.push('<rect x="' + ml + '" y="' + mt + '" width="' + plotB + '" height="' + plotH.toFixed(1) + '" fill="#fbfaf7" stroke="#cdc9c0"/>');
    for (zz = Math.ceil(zlo / zs) * zs; zz <= zhi + 1e-9; zz += zs) {
      o.push('<line x1="' + ml + '" y1="' + Y(zz) + '" x2="' + (ml + plotB) + '" y2="' + Y(zz) + '" stroke="#e7e4dc"/>');
      o.push('<text x="' + (ml - 8) + '" y="' + (Y(zz) + 4) + '" font-size="12" text-anchor="end" fill="#55524b">' + z1(zz, 0) + '</text>');
    }
    o.push('<text x="' + (ml - 8) + '" y="' + (mt - 10) + '" font-size="11" text-anchor="end" fill="#77746d">m ü. NHN</text>');
    var xs = schoenerSchritt(L, 10), s;
    for (s = 0; s <= L + 1e-9; s += xs) {
      o.push('<line x1="' + X(s) + '" y1="' + mt + '" x2="' + X(s) + '" y2="' + (mt + plotH).toFixed(1) + '" stroke="#e7e4dc"/>');
      o.push('<line x1="' + X(s) + '" y1="' + (mt + plotH).toFixed(1) + '" x2="' + X(s) + '" y2="' + (mt + plotH + 6).toFixed(1) + '" stroke="#1a1a1a"/>');
      o.push('<text x="' + X(s) + '" y="' + (mt + plotH + 20).toFixed(1) + '" font-size="12" text-anchor="middle" fill="#55524b">' + z1(s, 0) + (s === 0 ? " m" : "") + '</text>');
    }

    // Ansicht dahinter (von hinten nach vorn)
    var dmax = Math.max(1, Z.tiefe);
    R.hinten.forEach(function (e) {
      var t = Math.min(1, e.dist / dmax);
      if (e.typ === "geb") { o.push('<polygon points="' + poly(e.pts) + '" fill="' + mische("#bfbab0", "#e8e5dd", t) + '" stroke="' + mische("#8f8a7f", "#c9c5bb", t) + '" stroke-width="0.8"/>'); }
      else if (e.typ === "wald") { o.push('<polygon points="' + poly(e.pts) + '" fill="' + mische("#8fbf92", "#d3e6d2", t) + '" stroke="' + mische("#5f9a66", "#b6d3b6", t) + '" stroke-width="0.8"/>'); }
      else if (e.typ === "eigen") { o.push('<polygon points="' + poly(e.pts) + '" fill="' + e.farbe + '" fill-opacity="' + (0.55 - 0.3 * t).toFixed(2) + '" stroke="' + e.farbe + '" stroke-opacity="0.7" stroke-width="0.8"/>'); }
      else if (e.typ === "baum") {
        var fc = e.ig ? mische("#5f9a73", "#cfe2d6", t) : mische("#8cc785", "#d9ecd6", t);
        o.push('<line x1="' + X(e.s) + '" y1="' + Y(e.y0) + '" x2="' + X(e.s) + '" y2="' + Y(e.y0 + e.stammH) + '" stroke="' + mische("#8a7a66", "#cfc7b9", t) + '" stroke-width="1.2"/>');
        o.push('<ellipse cx="' + X(e.s) + '" cy="' + Y(e.cy) + '" rx="' + (e.rx * sx).toFixed(2) + '" ry="' + (e.ry * sy).toFixed(2) + '" fill="' + fc + '" stroke="' + mische("#5f9a66", "#b6d3b6", t) + '" stroke-width="0.7"/>');
      }
    });

    // Gelände: Füllung unter der Linie
    var terrPts = R.terr.map(function (t) { return [t[0], t[1]]; });
    var boden = [[0, zlo]].concat(terrPts).concat([[L, zlo]]);
    o.push('<polygon points="' + poly(boden) + '" fill="#efece4"/>');
    o.push('<polygon points="' + poly(boden) + '" fill="url(#sBoden)" opacity="0.8"/>');

    // geschnittene Teile
    var ordnung = { wald: 0, baum: 1, geb: 2, eigen: 3 };
    R.schnitte.slice().sort(function (p, q) { return ordnung[p.typ] - ordnung[q.typ]; }).forEach(function (e) {
      if (e.typ === "geb") { o.push('<polygon points="' + poly(e.pts) + '" fill="#262626" stroke="#ffffff" stroke-width="0.6" stroke-linejoin="round"/>'); }
      else if (e.typ === "wald") { o.push('<polygon points="' + poly(e.pts) + '" fill="#2f7d3c" stroke="#1d5a2b" stroke-width="0.8"/><polygon points="' + poly(e.pts) + '" fill="url(#sWald)" opacity="0.5"/>'); }
      else if (e.typ === "eigen") { o.push('<polygon points="' + poly(e.pts) + '" fill="' + e.farbe + '" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/>'); }
      else if (e.typ === "baum") {
        if (e.stammGetroffen) { o.push('<line x1="' + X(e.s) + '" y1="' + Y(e.y0) + '" x2="' + X(e.s) + '" y2="' + Y(e.y0 + e.stammH) + '" stroke="#6b4e2e" stroke-width="2.4"/>'); }
        else { o.push('<line x1="' + X(e.s) + '" y1="' + Y(e.y0) + '" x2="' + X(e.s) + '" y2="' + Y(e.y0 + e.stammH) + '" stroke="#8a7a66" stroke-width="1.2" stroke-dasharray="3 2"/>'); }
        o.push('<ellipse cx="' + X(e.s) + '" cy="' + Y(e.cy) + '" rx="' + (e.rx * sx).toFixed(2) + '" ry="' + (e.ry * sy).toFixed(2) + '" fill="' + (e.ig ? "#2f6b3e" : "#4f9d47") + '" fill-opacity="0.92" stroke="#2f6b3e" stroke-width="1"/>');
      }
    });
    // Geländelinie über allem
    o.push('<polyline points="' + poly(terrPts) + '" fill="none" stroke="#1a1a1a" stroke-width="1.8" stroke-linejoin="round"/>');

    // Höhenangaben an den geschnittenen Gebäuden und Baukörpern (nur wenn genug Platz ist)
    R.schnitte.forEach(function (e) {
      if ((e.typ !== "geb" && e.typ !== "eigen") || !e.text || (e.b - e.a) * sx < 34) { return; }
      var top = -1e9; e.pts.forEach(function (p) { if (p[1] > top) { top = p[1]; } });
      o.push('<text x="' + X((e.a + e.b) / 2) + '" y="' + (Y(top) - 5) + '" font-size="11" text-anchor="middle" fill="#1a1a1a" stroke="#f5f3ee" stroke-width="3" paint-order="stroke">' + esc(e.text) + '</text>');
    });

    // Knickpunkte und Standort
    R.knicke.forEach(function (k) { o.push('<line x1="' + X(k) + '" y1="' + mt + '" x2="' + X(k) + '" y2="' + (mt + plotH).toFixed(1) + '" stroke="' + ROT + '" stroke-dasharray="6 3" stroke-width="1"/>'); });
    if (R.standort) {
      var sx0 = X(R.standort.s), sy0 = Y(R.standort.z);
      o.push('<polygon points="' + sx0 + ',' + (sy0 - 2) + ' ' + (sx0 - 7) + ',' + (sy0 - 16) + ' ' + (sx0 + 7) + ',' + (sy0 - 16) + '" fill="' + ROT + '" stroke="#ffffff" stroke-width="1.5"/>');
      o.push('<text x="' + sx0 + '" y="' + (sy0 - 21) + '" font-size="11" text-anchor="middle" fill="' + ROT + '" stroke="#f5f3ee" stroke-width="3" paint-order="stroke">Standort</text>');
    }
    // Enden A und A′
    o.push('<text x="' + ml + '" y="' + (mt + plotH + 44).toFixed(1) + '" font-size="18" font-weight="700" text-anchor="middle" fill="' + ROT + '">A</text>');
    o.push('<text x="' + (ml + plotB) + '" y="' + (mt + plotH + 44).toFixed(1) + '" font-size="18" font-weight="700" text-anchor="middle" fill="' + ROT + '">A′</text>');

    // Legende
    var ly = mt + plotH + 62, lx = ml, felder = [];
    felder.push(["#262626", "Gebäude (geschnitten)"]);
    if (R.hinten.length) { felder.push(["#cfcac0", "Gebäude (Ansicht)"]); }
    if (Z.baeume) { felder.push(["#4f9d47", "Baum"]); }
    if (Z.wald) { felder.push(["#2f7d3c", "Wald"]); }
    if (R.schnitte.some(function (e) { return e.typ === "eigen"; }) || R.hinten.some(function (e) { return e.typ === "eigen"; })) { felder.push([ROT, "eigener Baukörper"]); }
    felder.push(["#efece4", "Gelände"]);
    felder.forEach(function (f) {
      o.push('<rect x="' + lx + '" y="' + (ly - 11) + '" width="14" height="14" fill="' + f[0] + '" stroke="#1a1a1a" stroke-width="0.6"/>');
      o.push('<text x="' + (lx + 20) + '" y="' + ly + '" font-size="12.5" fill="#1a1a1a">' + esc(f[1]) + '</text>');
      lx += 36 + f[1].length * 7.2;
    });
    var quellen = [QUELLE_GELAENDE]; if (Z.gebaeude) { quellen.push(QUELLE_HOEHEN); } if (Z.baeume || Z.wald) { quellen.push(QUELLE_OSM); }
    o.push('<text x="' + ml + '" y="' + (ly + 26) + '" font-size="11" fill="#77746d">' + esc(quellen.join("  ·  ")) + '</text>');
    o.push('<text x="' + ml + '" y="' + (ly + 42) + '" font-size="11" fill="#77746d">Orientierung für den Entwurf: Gebäudehöhen ca. 1 bis 5 m genau, Dachformen vereinfacht, Bäume mit geschätzten Maßen, Gelände auf 5 m Raster geglättet.</text>');
    o.push('</svg>');
    return { svg: o.join("\n"), W: W, H: H, ml: ml, plotB: plotB, mt: mt, plotH: plotH, L: L };
  }

  // ---------- Bedienfeld (unten über der Karte) ----------
  var STIL = [
    ".schnittPanel{position:absolute;left:0;right:0;bottom:0;height:48%;min-height:240px;z-index:1150;display:flex;flex-direction:column;background:var(--papier);border-top:2px solid var(--tinte);box-shadow:0 -4px 14px rgba(0,0,0,.18);font-family:var(--schrift);color:var(--tinte)}",
    ".schnittPanel .sKopf{flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:7px 12px;border-bottom:1px solid var(--linie);font-size:12px}",
    ".schnittPanel .sKopf strong{letter-spacing:.1em;text-transform:uppercase;font-size:13px}",
    ".schnittPanel .sKopf label{display:inline-flex;align-items:center;gap:5px;margin:0;font-size:12px;letter-spacing:0;text-transform:none;white-space:nowrap}",
    ".schnittPanel .sKopf select,.schnittPanel .sKopf input[type=text]{width:auto;padding:3px 6px;font-size:12px;margin:0;border:1px solid var(--tinte);background:var(--feld);border-radius:0}",
    ".schnittPanel .sKopf input[type=text]{width:46px}",
    ".schnittPanel .sKopf input[type=checkbox]{margin:0;width:auto}",
    ".schnittPanel .sKopf button{width:auto;margin:0;padding:4px 10px;font-size:12px}",
    ".schnittPanel .sRechts{margin-left:auto;display:flex;gap:6px}",
    ".schnittPanel .sFlaeche{position:relative;flex:1 1 auto;overflow:auto;background:#f5f3ee}",
    ".schnittPanel .sFlaeche svg{display:block;width:100%;height:auto;min-width:760px}",
    ".schnittPanel .sStatus{flex:0 0 auto;padding:4px 12px;font-size:12px;color:var(--grau);border-top:1px solid var(--linie);min-height:24px}",
    ".schnittPanel .sMeldung{padding:22px;font-size:14px}",
    ".schnittPanel.zu{height:0;min-height:0;border-top:none;box-shadow:none}",
    ".schnittPanel.zu>.sKopf,.schnittPanel.zu>.sFlaeche,.schnittPanel.zu>.sStatus{display:none}",
    ".schnittPanel .sKnopf{position:absolute;left:50%;top:-16px;transform:translateX(-50%);z-index:3;width:52px;height:16px;margin:0;padding:0;border:1px solid #e6e6e6;border-bottom:none;background:#fcfcfc;color:transparent;font-size:0;line-height:0;cursor:pointer}",
    ".schnittPanel .sKnopf::before{content:\"\";position:absolute;left:50%;top:50%;width:10px;height:8px;transform:translate(-50%,-50%);background:#8b8b8b;-webkit-mask:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2010%208%27%3E%3Cpolygon%20points=%271.3,1.4%208.7,1.4%205,6.6%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E') center/100% 100% no-repeat;mask:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2010%208%27%3E%3Cpolygon%20points=%271.3,1.4%208.7,1.4%205,6.6%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E') center/100% 100% no-repeat}",
    ".schnittPanel.zu .sKnopf::before{-webkit-mask-image:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2010%208%27%3E%3Cpolygon%20points=%271.3,6.6%208.7,6.6%205,1.4%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E');mask-image:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2010%208%27%3E%3Cpolygon%20points=%271.3,6.6%208.7,6.6%205,1.4%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E')}",
    ".schnittPanel .sKnopf:hover{background:#ececec;color:transparent;border-color:#e6e6e6}",
    ".schnittPanel .sKnopf:hover::before{background:#505050}",
    ".schnittPanel .sKnopf:active{background:#787878}",
    ".schnittPanel .sKnopf:active::before{background:#fff}",
    ".schnittGriff{display:flex;align-items:center;justify-content:center;background:#fff;border:2px solid #c0392b;color:#c0392b;font:700 12px var(--schrift);box-sizing:border-box;cursor:move}",
    ".schnittPfeil{color:#c0392b;font-size:20px;line-height:20px;text-align:center;text-shadow:0 0 3px #fff,0 0 3px #fff}"
  ].join("\n");

  function stilEinfuegen() {
    if (el("schnittStil")) { return; }
    var s = document.createElement("style"); s.id = "schnittStil"; s.textContent = STIL; document.head.appendChild(s);
  }
  function waehlOption(werte, aktuell, texte) {
    return werte.map(function (w, i) { return '<option value="' + w + '"' + (String(w) === String(aktuell) ? " selected" : "") + ">" + texte[i] + "</option>"; }).join("");
  }
  function oeffnePanel() {
    stilEinfuegen();
    if (panel) { panel.style.display = ""; panel.classList.remove("zu"); return; }
    var bereich = karte.getContainer().parentNode;
    panel = document.createElement("div");
    panel.className = "schnittPanel";
    panel.innerHTML =
      '<button type="button" class="sKnopf" id="sKnopf" title="Schnitt ein- oder ausklappen" aria-label="Schnitt ein- oder ausklappen">▾</button>' +
      '<div class="sKopf"><strong>Schnitt A–A′</strong>' +
      '<label>Blick nach <select id="sBlick">' + waehlOption(["rechts", "links"], Z.blick, ["rechts der Linie", "links der Linie"]) + '</select></label>' +
      '<label>Ansicht dahinter <select id="sTiefe">' + waehlOption([0, 20, 40, 80, 150], Z.tiefe, ["keine", "bis 20 m", "bis 40 m", "bis 80 m", "bis 150 m"]) + '</select></label>' +
      '<label>Überhöhung <select id="sUeber">' + waehlOption([1, 2, 3, 5], Z.ueber, ["keine (1:1)", "2-fach", "3-fach", "5-fach"]) + '</select></label>' +
      '<label><input type="checkbox" id="sGeb"' + (Z.gebaeude ? " checked" : "") + '> Gebäude</label>' +
      '<label><input type="checkbox" id="sBaum"' + (Z.baeume ? " checked" : "") + '> Bäume</label>' +
      '<label><input type="checkbox" id="sWald"' + (Z.wald ? " checked" : "") + '> Wälder</label>' +
      '<label>Höhe <input type="text" id="sWaldH" value="' + z1(Z.waldHoehe, 0) + '" inputmode="decimal" title="Höhe der Wälder in Metern"> m</label>' +
      '<label><input type="checkbox" id="sEigen"' + (Z.eigene ? " checked" : "") + '> Eigene Baukörper</label>' +
      '<label title="Bestandsgebäude, die unter einem eigenen Baukörper liegen, nicht zeigen"><input type="checkbox" id="sAus"' + (Z.ausblenden ? " checked" : "") + '> Bestand darunter ausblenden</label>' +
      '<span class="sRechts"><button type="button" class="zweit" id="sPng">PNG</button><button type="button" class="zweit" id="sPdf">PDF</button><button type="button" class="zweit" id="sSvg">SVG</button><button type="button" class="zweit" id="sZu" title="Schnitt schließen">✕</button></span></div>' +
      '<div class="sFlaeche" id="sFlaeche"></div><div class="sStatus" id="sStatus">&nbsp;</div>';
    bereich.appendChild(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    function lesen() {
      Z.blick = el("sBlick").value; Z.tiefe = +el("sTiefe").value; Z.ueber = +el("sUeber").value;
      Z.gebaeude = el("sGeb").checked; Z.baeume = el("sBaum").checked; Z.wald = el("sWald").checked; Z.eigene = el("sEigen").checked; Z.ausblenden = el("sAus").checked;
      var wh = parseFloat(String(el("sWaldH").value).replace(",", "."));
      Z.waldHoehe = wh > 0 ? Math.max(4, Math.min(45, wh)) : 18;
      pfeilNeu();
      neuRechnen(150);
    }
    ["sBlick", "sTiefe", "sUeber", "sGeb", "sBaum", "sWald", "sEigen", "sAus"].forEach(function (id) { el(id).addEventListener("change", lesen); });
    el("sWaldH").addEventListener("change", lesen);
    el("sPng").addEventListener("click", function () { speichern("png"); });
    el("sPdf").addEventListener("click", function () { speichern("pdf"); });
    el("sSvg").addEventListener("click", function () { speichern("svg"); });
    el("sZu").addEventListener("click", schliessePanel);
    el("sKnopf").addEventListener("click", function () { panel.classList.toggle("zu"); });
    var fl = el("sFlaeche");
    fl.addEventListener("mousemove", beiMaus);
    fl.addEventListener("mouseleave", function () { if (positionMarke) { karte.removeLayer(positionMarke); positionMarke = null; } statusText(""); });
  }
  function schliessePanel() {
    if (panel) { panel.remove(); panel = null; }
    if (positionMarke) { karte.removeLayer(positionMarke); positionMarke = null; }
    ergebnis = null; svgInfo = null; rechnungNr++;
  }
  function statusText(t) { var e = el("sStatus"); if (e) { e.textContent = t || " "; } }
  function meldung(html) { var f = el("sFlaeche"); if (f) { f.innerHTML = '<div class="sMeldung">' + html + '</div>'; } }

  // Maus über dem Schnitt: Position auf der Karte zeigen
  function beiMaus(ev) {
    var svg = el("sFlaeche") && el("sFlaeche").querySelector("svg");
    if (!svg || !ergebnis || !svgInfo) { return; }
    var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    var m = svg.getScreenCTM(); if (!m) { return; }
    var p = pt.matrixTransform(m.inverse()), s = (p.x - svgInfo.ml) / svgInfo.plotB * svgInfo.L;
    if (s < 0 || s > svgInfo.L) { if (positionMarke) { karte.removeLayer(positionMarke); positionMarke = null; } statusText(""); return; }
    var R = ergebnis, sgm = R.segs[R.segs.length - 1], q;
    for (q = 0; q < R.segs.length; q++) { if (s <= R.segs[q].s0 + R.segs[q].len) { sgm = R.segs[q]; break; } }
    var u = Math.max(0, Math.min(sgm.len, s - sgm.s0)), x = sgm.ax + sgm.ux * u, y = sgm.ay + sgm.uy * u;
    var ll = L.latLng(R.lo.lat0 + y / M_LAT, R.lo.lng0 + x / R.lo.mLng);
    if (!positionMarke) { positionMarke = L.circleMarker(ll, { radius: 6, color: "#ffffff", weight: 2, fillColor: ROT, fillOpacity: 1, interactive: false }).addTo(karte); }
    else { positionMarke.setLatLng(ll); }
    statusText("Position " + z1(s, 0) + " m ab A · Gelände " + z1(R.gz(x, y)) + " m ü. NHN");
  }

  // ---------- Rechnen und Anzeigen ----------
  function neuRechnen(ms) {
    if (!panel) { return; }
    if (timer) { clearTimeout(timer); }
    timer = setTimeout(function () { timer = null; zeige(); }, ms || 0);
  }
  function zeige() {
    if (!panel || Z.punkte.length < 2) { return; }
    var nr = ++rechnungNr;
    if (!datenGeladen) { meldung("Daten werden geladen (beim ersten Mal einige MB: Gebäudehöhen und Gelände für den Bereich der Linie) …"); }
    ladeDaten().then(function (daten) {
      if (nr !== rechnungNr || !panel) { return; }
      var R;
      try { R = rechne(daten); } catch (x) { meldung(esc(x.message || "Der Schnitt konnte nicht berechnet werden.")); return; }
      ergebnis = R;
      var b = baueSvg(R);
      svgInfo = b;
      var fl = el("sFlaeche"); if (!fl) { return; }
      var oben = fl.scrollTop;
      fl.innerHTML = b.svg;
      fl.scrollTop = oben;
      var z = R.zaehler;
      statusText("Geschnitten: " + z.geb + " Gebäude, " + z.baeume + " Bäume, " + z.wald + " Waldflächen" + (z.eigen ? ", " + z.eigen + " eigene Baukörper" : "") + (Z.tiefe > 0 ? "; in der Ansicht dahinter " + z.gebHinten + " weitere Gebäude" : "") + ". Mit der Maus über den Schnitt fahren zeigt die Stelle auf der Karte.");
    }).catch(function (x) {
      if (nr !== rechnungNr || !panel) { return; }
      if (window.console) { console.error("Schnitt:", x); }
      meldung("Der Schnitt konnte nicht berechnet werden. " + esc(x && x.message ? x.message : "") + " Die Ordner „hoehen“ und „gelaende“ sowie die Datei ansicht3d.js müssen im selben Ordner wie index.html liegen.");
    });
  }

  // ---------- Speichern ----------
  function dateiname(endung) {
    var d = new Date(), t = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
    return "Schnitt_A-A_" + t + "." + endung;
  }
  function herunterladen(blob, name) {
    var a = document.createElement("a"); a.download = name; a.href = URL.createObjectURL(blob);
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function alsLeinwand(faktor) {
    return new Promise(function (fertig, fehler) {
      var b = svgInfo, blob = new Blob([b.svg], { type: "image/svg+xml;charset=utf-8" }), url = URL.createObjectURL(blob), bild = new Image();
      bild.onload = function () {
        var c = document.createElement("canvas"); c.width = b.W * faktor; c.height = b.H * faktor;
        var g = c.getContext("2d"); g.fillStyle = "#f5f3ee"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bild, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); fertig(c);
      };
      bild.onerror = function () { URL.revokeObjectURL(url); fehler(new Error("Das Bild konnte nicht erzeugt werden.")); };
      bild.src = url;
    });
  }
  function speichern(art) {
    if (!ergebnis || !svgInfo) { statusText("Der Schnitt ist noch nicht fertig berechnet."); return; }
    var b = svgInfo;
    if (art === "svg") { herunterladen(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + b.svg], { type: "image/svg+xml" }), dateiname("svg")); return; }
    statusText("Bild wird erzeugt …");
    alsLeinwand(2).then(function (c) {
      if (art === "png") {
        c.toBlob(function (blob) { if (blob) { herunterladen(blob, dateiname("png")); statusText("PNG gespeichert."); } else { statusText("Das Bild konnte nicht gespeichert werden."); } }, "image/png");
      } else {
        var breiteMm = 297, hoeheMm = 297 * b.H / b.W;
        return erzeugePdf(c, { breiteMm: breiteMm, hoeheMm: hoeheMm, titel: "Schnitt A–A′" }).then(function (blob) { herunterladen(blob, dateiname("pdf")); statusText("PDF gespeichert."); });
      }
    }).catch(function (x) { statusText("Speichern nicht möglich: " + (x && x.message ? x.message : "Fehler")); });
  }

  // ---------- Linie auf der Karte ----------
  function latlngs() { return Z.punkte.map(function (p) { return L.latLng(p[0], p[1]); }); }
  function griffIcon(i, n) {
    var ende = i === 0 || i === n - 1, text = i === 0 ? "A" : (i === n - 1 ? "A′" : ""), gr = ende ? 22 : 12;
    return L.divIcon({ className: "", html: '<div class="schnittGriff" style="width:' + gr + 'px;height:' + gr + 'px">' + text + '</div>', iconSize: [gr, gr], iconAnchor: [gr / 2, gr / 2] });
  }
  function linieLoeschenKarte() {
    if (linie) { karte.removeLayer(linie); linie = null; }
    griffe.forEach(function (g) { karte.removeLayer(g); }); griffe = [];
    if (pfeil) { karte.removeLayer(pfeil); pfeil = null; }
  }
  function pfeilNeu() {
    if (pfeil) { karte.removeLayer(pfeil); pfeil = null; }
    if (Z.punkte.length < 2) { return; }
    var a = karte.latLngToContainerPoint(L.latLng(Z.punkte[0][0], Z.punkte[0][1])), b = karte.latLngToContainerPoint(L.latLng(Z.punkte[1][0], Z.punkte[1][1]));
    var dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
    if (len < 40) { return; }
    var ux = dx / len, uy = dy / len, rx = -uy, ry = ux;                    // rechts neben der Linie (Bildschirm: y nach unten)
    var sg = Z.blick === "links" ? -1 : 1, mx = (a.x + b.x) / 2 + sg * rx * 22, my = (a.y + b.y) / 2 + sg * ry * 22;
    var grad = Math.atan2(sg * rx, -sg * ry) * 180 / Math.PI;
    pfeil = L.marker(karte.containerPointToLatLng(L.point(mx, my)), { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<div class="schnittPfeil" style="transform:rotate(' + grad + 'deg)">▲</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(karte);
  }
  function zeichneLinieKarte() {
    linieLoeschenKarte();
    if (Z.punkte.length < 2) { return; }
    linie = L.polyline(latlngs(), { color: ROT, weight: 3, dashArray: "12 4 2 4", interactive: false }).addTo(karte);
    var n = Z.punkte.length;
    Z.punkte.forEach(function (p, i) {
      var m = L.marker(L.latLng(p[0], p[1]), { draggable: true, icon: griffIcon(i, n), keyboard: false, title: i === 0 ? "Anfang A (ziehen)" : (i === n - 1 ? "Ende A′ (ziehen)" : "Knickpunkt (ziehen, Rechtsklick entfernt ihn)"), zIndexOffset: 500 }).addTo(karte);
      m.on("drag", function () { Z.punkte[i] = [m.getLatLng().lat, m.getLatLng().lng]; linie.setLatLngs(latlngs()); pfeilNeu(); });
      m.on("dragend", function () { geaendert(); });
      m.on("contextmenu", function () { if (Z.punkte.length > 2 && i > 0 && i < Z.punkte.length - 1) { Z.punkte.splice(i, 1); zeichneLinieKarte(); geaendert(); } });
      griffe.push(m);
    });
    pfeilNeu();
  }
  function geaendert() {
    var l = laenge();
    info(l > MAX_LAENGE ? "Die Schnittlinie ist " + z1(l, 0) + " m lang; mehr als " + MAX_LAENGE + " m gehen nicht. Bitte kürzen." : "Schnittlinie: " + z1(l, 0) + " m lang.", l > MAX_LAENGE);
    if (l <= MAX_LAENGE) { neuRechnen(250); }
  }
  function laenge() {
    var l = 0, i;
    for (i = 0; i + 1 < Z.punkte.length; i++) { l += karte.distance(L.latLng(Z.punkte[i][0], Z.punkte[i][1]), L.latLng(Z.punkte[i + 1][0], Z.punkte[i + 1][1])); }
    return l;
  }

  // ---------- Zeichnen der Linie ----------
  function zeichnenStarten() {
    if (typeof zeichenSetzeWerkzeug === "function") { zeichenSetzeWerkzeug("auswahl"); }
    if (typeof planWahl !== "undefined" && planWahl) { planAbbrechenWahl(); }
    if (typeof fotoWahl !== "undefined" && fotoWahl) { fotoWahlBeenden(true); }
    if (typeof grundWahl !== "undefined" && grundWahl && window.grundstueck) { window.grundstueck.klickBeenden(); }
    karte.closePopup();
    zeichnet = true; neuePunkte = [];
    karte.getContainer().classList.add("plan-wahl");
    karte.doubleClickZoom.disable();
    setzeKartenStatus("Schnittlinie: Klicke nacheinander die Punkte der Linie (Anfang A, ggf. Knickpunkte, Ende A′). Doppelklick oder Enter beendet, Esc bricht ab.");
    info("Zeichne die Linie auf der Karte …");
  }
  function zeichnenBeenden(abbrechen) {
    if (!zeichnet) { return; }
    zeichnet = false;
    karte.getContainer().classList.remove("plan-wahl");
    karte.doubleClickZoom.enable();
    if (gummi) { karte.removeLayer(gummi); gummi = null; }
    setzeKartenStatus("");
    var p = neuePunkte; neuePunkte = [];
    // doppelte Endpunkte (Doppelklick) entfernen
    while (p.length > 1 && karte.distance(L.latLng(p[p.length - 1][0], p[p.length - 1][1]), L.latLng(p[p.length - 2][0], p[p.length - 2][1])) < 2) { p.pop(); }
    if (abbrechen || p.length < 2) {
      info(abbrechen || p.length < 1 ? "" : "Für eine Schnittlinie braucht man mindestens zwei Punkte.");
      zeichneLinieKarte();                                  // die bisherige Linie (falls es eine gab) bleibt, siehe unten
      return;
    }
    Z.punkte = p;
    zeichneLinieKarte();
    var l = laenge();
    if (l > MAX_LAENGE) { info("Die Schnittlinie ist " + z1(l, 0) + " m lang; mehr als " + MAX_LAENGE + " m gehen nicht. Bitte mit den Griffen kürzen.", true); return; }
    info("Schnittlinie: " + z1(l, 0) + " m lang. Die Griffe lassen sich verschieben.");
    anzeigen();
  }
  karte.on("click", function (ev) {
    if (!zeichnet) { return; }
    neuePunkte.push([ev.latlng.lat, ev.latlng.lng]);
    // Zwischenstand als Linie zeigen
    if (!gummi) { gummi = L.polyline([], { color: ROT, weight: 2, dashArray: "6 4", interactive: false }).addTo(karte); }
    gummi.setLatLngs(neuePunkte.map(function (q) { return L.latLng(q[0], q[1]); }));
  });
  karte.on("mousemove", function (ev) {
    if (!zeichnet || !neuePunkte.length || !gummi) { return; }
    gummi.setLatLngs(neuePunkte.map(function (q) { return L.latLng(q[0], q[1]); }).concat([ev.latlng]));
  });
  karte.on("dblclick", function () { if (zeichnet) { zeichnenBeenden(false); } });
  karte.on("zoomend", function () { if (Z.punkte.length > 1) { pfeilNeu(); } });
  document.addEventListener("keydown", function (ev) {
    if (!zeichnet) { return; }
    if (ev.key === "Escape") { zeichnenBeenden(neuePunkte.length < 2); }
    else if (ev.key === "Enter") { zeichnenBeenden(false); }
  });

  // ---------- Schnittstelle für die Hauptseite ----------
  function anzeigen() {
    if (Z.punkte.length < 2) { info("Zeichne zuerst eine Schnittlinie auf der Karte.", true); return; }
    if (laenge() > MAX_LAENGE) { info("Die Schnittlinie ist zu lang (höchstens " + MAX_LAENGE + " m).", true); return; }
    oeffnePanel();
    zeige();
  }
  function loesche() {
    zeichnenBeenden(true);
    schliessePanel();
    linieLoeschenKarte();
    Z.punkte = [];
    info("");
  }
  window.schnitt = {
    zeichnen: zeichnenStarten,
    zeichnet: function () { return zeichnet; },
    zeichnenBeenden: function () { zeichnenBeenden(neuePunkte.length < 2); },
    anzeigen: anzeigen,
    loesche: loesche,
    hatLinie: function () { return Z.punkte.length >= 2; },
    zustand: function () {
      if (Z.punkte.length < 2) { return null; }
      return { punkte: Z.punkte.map(function (p) { return [+p[0].toFixed(7), +p[1].toFixed(7)]; }), blick: Z.blick, tiefe: Z.tiefe, ueber: Z.ueber, gebaeude: Z.gebaeude, baeume: Z.baeume, wald: Z.wald, eigene: Z.eigene, ausblenden: Z.ausblenden, waldHoehe: Z.waldHoehe };
    },
    stelleWiederHer: function (s) {
      loesche();
      if (!s || !s.punkte || s.punkte.length < 2) { return; }
      Z.punkte = s.punkte.map(function (p) { return [p[0], p[1]]; });
      Z.blick = s.blick === "links" ? "links" : "rechts";
      Z.tiefe = [0, 20, 40, 80, 150].indexOf(s.tiefe) >= 0 ? s.tiefe : 40;
      Z.ueber = [1, 2, 3, 5].indexOf(s.ueber) >= 0 ? s.ueber : 1;
      Z.gebaeude = s.gebaeude !== false; Z.baeume = s.baeume !== false; Z.wald = s.wald !== false; Z.eigene = s.eigene !== false; Z.ausblenden = s.ausblenden !== false;
      Z.waldHoehe = s.waldHoehe > 0 ? s.waldHoehe : 18;
      zeichneLinieKarte();
      info("Schnittlinie: " + z1(laenge(), 0) + " m lang.");
    }
  };
})();
