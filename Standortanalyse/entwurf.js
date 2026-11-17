/* Entwurfsstrategie: baut aus der Standortanalyse der App einen fertigen Text für eine KI (Vorlage "Generate Design Strategy").
   Die Datei wird erst beim ersten Klick auf "Text erstellen" geladen. Sie benutzt Daten und Funktionen der Hauptseite (index.html):
   marker, karte, aktuelleAnzeige, zeichnung, plaene, SONNE, FLAECHEN, EINRICHTUNGEN, MOBILITAET, SPIEL, OEPNV, TAKT, LUFT, STARKREGEN und die Lader
   ladeKartenDaten, ladeEinrichtungenDaten, ladeOepnvDaten, ladeMobilitaetDaten, ladeFahrplanDaten, ladeLuftDaten, ladeSpielDaten, ladeBaeumeDaten,
   ladeFlaechenDaten, ladeAnsicht3d (für Gebäudehöhen und Gelände). Alles, was hier steht, ist gerechnet oder aus den lokalen Dateien gelesen;
   nichts ist erfunden. Was die App nicht weiß, steht im Text unter "Nicht vorhanden". */
(function () {
  "use strict";

  var R1 = 400, R2 = 800;                 // Umkreise in Metern (5 und 10 Minuten zu Fuß)
  var METER_GRAD = 111195;

  // ---------- kleine Helfer ----------
  function z(n, st) { return Number(n).toLocaleString("de-DE", { minimumFractionDigits: st || 0, maximumFractionDigits: st || 0 }); }
  function prozent(a) { return z(a * 100, a > 0 && a < 0.1 ? 1 : 0) + " %"; }
  function ort(P) {
    var rad = Math.PI / 180;
    return {
      lat0: P.lat, lng0: P.lng, mLat: METER_GRAD, mLng: METER_GRAD * Math.cos(P.lat * rad),
      xy: function (lat, lng) { return [(lng - P.lng) * METER_GRAD * Math.cos(P.lat * rad), (lat - P.lat) * METER_GRAD]; },
      abstand: function (lat, lng) { var d = this.xy(lat, lng); return Math.sqrt(d[0] * d[0] + d[1] * d[1]); },
      richtung: function (lat, lng) {   // Himmelsrichtung vom Punkt aus gesehen (N, NO, O ...)
        var d = this.xy(lat, lng), w = (Math.atan2(d[0], d[1]) * 180 / Math.PI + 360) % 360;
        return ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(w / 45) % 8];
      }
    };
  }
  function innenRing(lat, lng, ring) {       // ring = [lat, lng, lat, lng, ...]
    var in_ = false;
    for (var i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      var yi = ring[i], xi = ring[i + 1], yj = ring[j], xj = ring[j + 1];
      if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) { in_ = !in_; }
    }
    return in_;
  }
  function inFlaeche(f, lat, lng) {          // Außenring und Löcher: ungerade Zahl von Ringen = innen
    var n = 0;
    for (var k = 0; k < f.ringe.length; k++) { if (innenRing(lat, lng, f.ringe[k])) { n++; } }
    return (n % 2) === 1;
  }
  function segAbstand(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
  // Kleinster Abstand des Punkts zu einer Fläche (0, wenn er darin liegt); stopp = ab dieser Entfernung wird nicht mehr genau gesucht
  function flaechenAbstand(O, f, stopp) {
    var mx = stopp / O.mLat, my = stopp / O.mLng;
    if (O.lat0 < f.s - mx || O.lat0 > f.n + mx || O.lng0 < f.w - my || O.lng0 > f.o + my) { return Infinity; }
    if (inFlaeche(f, O.lat0, O.lng0)) { return 0; }
    var best = Infinity;
    f.ringe.forEach(function (r) {
      for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        var a = O.xy(r[j], r[j + 1]), b = O.xy(r[i], r[i + 1]);
        var d = segAbstand(0, 0, a[0], a[1], b[0], b[1]);
        if (d < best) { best = d; }
      }
    });
    return best;
  }
  function naechsteFlaeche(O, flaechen, stopp) {
    var best = Infinity, n = 0;
    flaechen.forEach(function (f) { var d = flaechenAbstand(O, f, stopp); if (d < best) { best = d; } if (d <= R2) { n++; } });
    return { abstand: best, anzahl: n };
  }
  // Raster von Probepunkten (16 m) im 800-m-Kreis: Anteil der Fläche, die von einer Gruppe bedeckt ist (für den 400- und den 800-m-Kreis)
  function probepunkte(O) {
    var pts = [], s = 16;
    for (var y = -R2; y <= R2; y += s) {
      for (var x = -R2; x <= R2; x += s) {
        var r2 = x * x + y * y;
        if (r2 > R2 * R2) { continue; }
        pts.push({ lat: O.lat0 + y / O.mLat, lng: O.lng0 + x / O.mLng, in1: r2 <= R1 * R1 });
      }
    }
    return pts;
  }
  function anteile(pts, flaechen) {
    var n1 = 0, n2 = 0, e1 = 0, e2 = 0, kand = flaechen;
    pts.forEach(function (p) {
      n2++; if (p.in1) { n1++; }
      for (var i = 0; i < kand.length; i++) {
        var f = kand[i];
        if (p.lat < f.s || p.lat > f.n || p.lng < f.w || p.lng > f.o) { continue; }
        if (inFlaeche(f, p.lat, p.lng)) { e2++; if (p.in1) { e1++; } break; }
      }
    });
    return { a1: n1 ? e1 / n1 : 0, a2: n2 ? e2 / n2 : 0 };
  }
  function punktGruppe(O, liste) {           // [{ lat, lng }] -> Zahl in 400 m, in 800 m, nächster Abstand
    var n1 = 0, n2 = 0, best = Infinity;
    liste.forEach(function (p) {
      var d = O.abstand(p.lat, p.lng);
      if (d <= R1) { n1++; } if (d <= R2) { n2++; } if (d < best) { best = d; }
    });
    return { n1: n1, n2: n2, naechste: best };
  }
  function abstandText(d) { return isFinite(d) ? "nächster in ca. " + z(Math.round(d / 10) * 10) + " m" : "keiner in den Daten"; }
  function zeile(titel, w) { return "- " + titel + ": " + w; }

  // Farbe einer Starkregen-Pixel -> Klasse (nächste Farbe der Legende)
  function farbeNachKlasse(r, g, b) {
    var best = -1, bd = 1e9;
    window.STARKREGEN_KLASSEN.forEach(function (k, i) {
      var h = k[0], R = parseInt(h.substr(1, 2), 16), G = parseInt(h.substr(3, 2), 16), B = parseInt(h.substr(5, 2), 16);
      var d = (r - R) * (r - R) + (g - G) * (g - G) + (b - B) * (b - B);
      if (d < bd) { bd = d; best = i; }
    });
    return bd < 6000 ? best : -1;
  }
  // Starkregen im 100-m-Umkreis: ein kleines Bild vom Online-Dienst des Bundes holen und die Farben auszählen
  function starkregenAmPunkt(g, P) {
    var halb = 100, mx = P.lng * Math.PI / 180 * 6378137, my = Math.log(Math.tan(Math.PI / 4 + P.lat * Math.PI / 360)) * 6378137;
    var f = 1 / Math.cos(P.lat * Math.PI / 180);          // Meter auf der Kugel -> Web-Mercator-Meter
    var bbox = [mx - halb * f, my - halb * f, mx + halb * f, my + halb * f].join(","), W = 80;
    var url = window.STARKREGEN_WMS + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=" + g.layer + "&STYLES=&CRS=EPSG:3857&BBOX=" + bbox + "&WIDTH=" + W + "&HEIGHT=" + W + "&FORMAT=image/png&TRANSPARENT=TRUE";
    return new Promise(function (fertig) {
      var bild = new Image(), frist = setTimeout(function () { fertig(null); }, 20000);
      bild.crossOrigin = "anonymous";
      bild.onload = function () {
        clearTimeout(frist);
        try {
          var c = document.createElement("canvas"); c.width = W; c.height = W;
          var cx = c.getContext("2d"); cx.drawImage(bild, 0, 0);
          var d = cx.getImageData(0, 0, W, W).data, nass = 0, tiefste = -1, mitte = -1;
          for (var y = 0; y < W; y++) {
            for (var x = 0; x < W; x++) {
              var i = (y * W + x) * 4;
              if (d[i + 3] < 120) { continue; }
              var k = farbeNachKlasse(d[i], d[i + 1], d[i + 2]);
              if (k < 0) { continue; }
              nass++; if (k > tiefste) { tiefste = k; }
              if (Math.abs(x - W / 2) <= 1 && Math.abs(y - W / 2) <= 1) { mitte = Math.max(mitte, k); }
            }
          }
          fertig({ anteil: nass / (W * W), tiefste: tiefste, mitte: mitte });
        } catch (e) { fertig(null); }
      };
      bild.onerror = function () { clearTimeout(frist); fertig(null); };
      bild.src = url;
    });
  }

  // ---------- Daten sammeln ----------
  // Jeder Teil gibt eine Liste von Textzeilen zurück. "fehlt" sammelt, was die App nicht weiß.
  function sammeln(opt, melde) {
    var m = window.marker;
    var P = { lat: m.getLatLng().lat, lng: m.getLatLng().lng }, O = ort(P);
    var teile = { A: [], B: [], C: [], D: [], fehlt: [], quellen: [] };
    var pts = probepunkte(O);
    var daten = {};
    function schritt(t) { if (melde) { melde(t); } }

    function lade(name, f) { return f().then(function (d) { daten[name] = d; }, function () { daten[name] = null; teile.fehlt.push("Datei für „" + name + "“ konnte nicht geladen werden."); }); }

    schritt("Daten werden geladen …");
    var jobs = [
      lade("karte", window.ladeKartenDaten),
      lade("einr", window.ladeEinrichtungenDaten),
      lade("oepnv", window.ladeOepnvDaten),
      lade("mobil", window.ladeMobilitaetDaten),
      lade("fahrplan", window.ladeFahrplanDaten),
      lade("luft", window.ladeLuftDaten),
      lade("spiel", window.ladeSpielDaten),
      lade("baeume", window.ladeBaeumeDaten),
      lade("flaechen", function () { return window.ladeFlaechenDaten(window.FLAECHEN); })
    ];
    if (opt.hoehen) {
      jobs.push(lade("a3d", function () {
        return window.ladeAnsicht3d().then(function () {
          var D = window.ansicht3d && window.ansicht3d.daten;
          if (!D) { throw new Error("keine Daten"); }
          return Promise.all([Promise.resolve(D.gebaeude()), D.gelaende()]).then(function (e) { return { gebaeude: e[0], gelaende: e[1], utm32: D.utm32 }; });
        });
      }));
    }
    var regen = [];
    if (opt.starkregen) {
      schritt("Starkregen-Karte wird abgefragt …");
      window.STARKREGEN.forEach(function (g) { regen.push(starkregenAmPunkt(g, P).then(function (r) { return { g: g, r: r }; })); });
    }

    return Promise.all(jobs).then(function () { return Promise.all(regen); }).then(function (regenErg) {
      schritt("Umgebung wird ausgewertet …");
      var Dm = new Date();
      var A = teile.A, B = teile.B, C = teile.C, Dd = teile.D;
      var fl = daten.flaechen || {};

      // ===== A. Standort =====
      A.push(zeile("Adresse (so gesucht)", window.aktuelleAnzeige || "nicht angegeben"));
      A.push(zeile("Lage des roten Punkts (Mittelpunkt aller Umkreise)", z(P.lat, 6) + " N, " + z(P.lng, 6) + " O (WGS 84)"));
      var bez = (fl.bezirke || []).filter(function (f) { return inFlaeche(f, P.lat, P.lng); })[0];
      A.push(zeile("Stadtbezirk", bez && bez.a ? bez.a : "nicht in den Daten gefunden"));
      var bpl = (fl.bplan || []).filter(function (f) { return inFlaeche(f, P.lat, P.lng); }).length;
      A.push(zeile("Bebauungsplan", bpl ? "Der Punkt liegt im Umriss eines rechtsverbindlichen Bebauungsplans (Stadt Oldenburg, Datenlizenz dl-de/by-2-0). Plannummer und Festsetzungen sind in den App-Daten NICHT enthalten und müssen beim Planungsamt geprüft werden." : "Der Punkt liegt in keinem Umriss eines Bebauungsplans in den Daten. Das heißt nicht, dass keine planungsrechtlichen Regeln gelten (zum Beispiel § 34 BauGB); das muss geprüft werden."));

      // Grundstück aus der Zeichnung
      var zeich = window.zeichnung || [];
      var flaechenObj = zeich.filter(function (o) { return o.art === "flaeche" && !o.mass && o.punkte && o.punkte.length >= 3; });
      var grund = flaechenObj.filter(function (o) { return /grundst|plangebiet|parzelle|baugrund|areal|baufeld/i.test(o.name || ""); })[0] || null;
      if (grund) {
        var xs = grund.punkte.map(function (p) { return O.xy(p.lat, p.lng); });
        var minx = Math.min.apply(null, xs.map(function (q) { return q[0]; })), maxx = Math.max.apply(null, xs.map(function (q) { return q[0]; }));
        var miny = Math.min.apply(null, xs.map(function (q) { return q[1]; })), maxy = Math.max.apply(null, xs.map(function (q) { return q[1]; }));
        var cl = 0, cg = 0; grund.punkte.forEach(function (p) { cl += p.lat; cg += p.lng; });
        cl /= grund.punkte.length; cg /= grund.punkte.length;
        A.push(zeile("Grundstück (vom Nutzer gezeichnet: „" + grund.name + "“)", "Fläche " + z(window.zeichenFlaecheQm(grund.punkte), 0) + " m², Umfang " + z(window.zeichenLaenge(grund.punkte, true), 0) + " m, " + grund.punkte.length + " Eckpunkte, umschließendes Rechteck ca. " + z(maxx - minx, 0) + " m (Ost–West) × " + z(maxy - miny, 0) + " m (Nord–Süd), Mitte " + z(O.abstand(cl, cg), 0) + " m vom roten Punkt (" + O.richtung(cl, cg) + "). Die Lage stammt aus deiner Zeichnung und ist nicht amtlich vermessen."));
      } else {
        A.push(zeile("Grundstück", "nicht angegeben (keine Fläche mit dem Namen „Grundstück“ gezeichnet). Grenzen, Größe und Zuschnitt sind unbekannt."));
        teile.fehlt.push("Grundstücksgrenze, Fläche und Zuschnitt (zeichne in „06 Zeichnen“ eine Fläche und nenne sie „Grundstück“).");
      }
      // weitere gezeichnete Objekte
      var andere = flaechenObj.filter(function (o) { return o !== grund; });
      if (andere.length) {
        A.push(zeile("Weitere gezeichnete Flächen", andere.map(function (o) { return "„" + (o.name || "ohne Namen") + "“ " + z(window.zeichenFlaecheQm(o.punkte), 0) + " m²" + (o.hoehe > 0 ? " (Höhe " + z(o.hoehe, 1) + " m, für 3D)" : ""); }).join("; ")));
      }
      var messungen = zeich.filter(function (o) { return o.mass && o.punkte && o.punkte.length >= 2; });
      if (messungen.length) { A.push(zeile("Messungen des Nutzers", messungen.map(function (o) { return o.art === "flaeche" ? "Fläche " + z(window.zeichenFlaecheQm(o.punkte), 0) + " m²" : "Strecke " + z(window.zeichenLaenge(o.punkte, false), 1) + " m"; }).join("; "))); }
      var linien = zeich.filter(function (o) { return (o.art === "linie" || o.art === "pfeil") && !o.mass && o.punkte && o.punkte.length >= 2 && o.name; });
      if (linien.length) { A.push(zeile("Benannte Linien/Pfeile", linien.map(function (o) { return "„" + o.name + "“ " + z(window.zeichenLaenge(o.punkte, false), 0) + " m"; }).join("; "))); }
      var texte = zeich.filter(function (o) { return o.art === "text" && o.text; });
      if (texte.length) { A.push(zeile("Beschriftungen des Nutzers auf der Karte", texte.map(function (o) { return "„" + o.text + "“"; }).join("; "))); }
      var bauk = zeich.filter(function (o) { return (o.art === "baum" || (o.art === "punkt" && o.hoehe > 0)); });
      if (bauk.length) { A.push(zeile("Eigene Bäume und Säulen", bauk.length + " Objekte")); }
      var plaeneZeigen = (window.plaene || []);
      if (plaeneZeigen.length) { A.push(zeile("Hochgeladene Pläne des Nutzers", plaeneZeigen.map(function (p) { return "„" + p.name + "“ (" + z(p.breiteM, 0) + " m breit" + (p.zeigen ? "" : ", ausgeblendet") + ")"; }).join("; ") + ". Die Bildinhalte kennt die App nicht; sie sind nicht Teil dieser Daten.")); }

      // Straßen (Zugänge und Erschließung)
      var kd = daten.karte;
      if (kd) {
        var klassen = ["Hauptverkehrsstraße (Autobahn, Trunk, Primär)", "Verbindungsstraße (Sekundär, Tertiär)", "Wohn- und Erschließungsstraße", "Zufahrt, Servicestraße, Wirtschaftsweg", "Fuß-, Rad- oder Wanderweg"];
        var gefunden = {};
        for (var k = 0; k < 5; k++) {
          (kd.strassenNachKlasse[k] || []).forEach(function (l) {
            var best = Infinity, p = l.pts;
            if (O.lat0 < l.s - 200 / METER_GRAD || O.lat0 > l.n + 200 / METER_GRAD) { return; }
            for (var i = 2; i < p.length; i += 2) {
              var a = O.xy(p[i - 2], p[i - 1]), b = O.xy(p[i], p[i + 1]);
              var d = segAbstand(0, 0, a[0], a[1], b[0], b[1]);
              if (d < best) { best = d; }
            }
            if (best > 150) { return; }
            var name = (l.name >= 0 && kd.namen && kd.namen[l.name]) ? kd.namen[l.name] : "";
            var key = (name || "(ohne Namen)") + "|" + l.k;
            if (!gefunden[key] || best < gefunden[key].d) { gefunden[key] = { d: best, k: l.k, name: name || "(ohne Namen)" }; }
          });
        }
        var liste = Object.keys(gefunden).map(function (kk) { return gefunden[kk]; }).sort(function (a, b) { return a.d - b.d; });
        if (liste.length) {
          A.push(zeile("Straßen und Wege im Umkreis von 150 m um den roten Punkt (nächster Abstand, Klasse nach OpenStreetMap)", ""));
          liste.slice(0, 14).forEach(function (s) { A.push("  - " + s.name + ": ca. " + z(Math.round(s.d / 5) * 5) + " m, " + klassen[s.k]); });
        } else { A.push(zeile("Straßen im Umkreis von 150 m", "keine in den Daten")); }
        var bahn = (kd.bahn || []).some(function (l) { if (O.lat0 < l.s - R1 / METER_GRAD || O.lat0 > l.n + R1 / METER_GRAD || O.lng0 < l.w - R1 / METER_GRAD || O.lng0 > l.o + R1 / METER_GRAD) { return false; } for (var i = 2; i < l.pts.length; i += 2) { var a = O.xy(l.pts[i - 2], l.pts[i - 1]), b = O.xy(l.pts[i], l.pts[i + 1]); if (segAbstand(0, 0, a[0], a[1], b[0], b[1]) <= R1) { return true; } } return false; });
        B.push(zeile("Bahnstrecke im 400-m-Umkreis (Lärm- und Erschließungsfaktor)", bahn ? "ja, mindestens eine Bahnlinie in den Daten" : "keine in den Daten"));
        teile.quellen.push("Straßen, Bahn, Gewässer: © OpenStreetMap-Mitwirkende (ODbL), Stand der Datei " + (kd.stand || "unbekannt"));
      }

      // ===== B. Standortanalyse =====
      // Gebäude, Höhen und Gelände
      if (daten.a3d) {
        var G = daten.a3d.gebaeude, n1 = 0, n2 = 0, gf1 = 0, gf2 = 0, trauf = [], first = [], dachCls = [0, 0, 0, 0, 0], hoehenKl = [0, 0, 0, 0, 0], nah = [];
        // Die Höhen sind schon auf den Boden bezogen: ansicht3d.js zieht von den Werten der Datei (Höhen über NHN) die Geländehöhe ab.
        var Gd0 = daten.a3d.gelaende, u0 = daten.a3d.utm32, ohneHoehe = 0;
        var hAt = function (lat, lng) {
          if (!Gd0) { return null; }
          var q = u0(lat, lng), c = Math.round((q.e - Gd0.e0) / Gd0.schritt - 0.5), r = Math.round((Gd0.n1 - q.n) / Gd0.schritt - 0.5);
          if (c < 0 || r < 0 || c >= Gd0.W || r >= Gd0.H) { return null; }
          return Gd0.h[r * Gd0.W + c] / 10;
        };
        G.forEach(function (g) {
          var d = O.abstand(g.lat, g.lng);
          if (d > R2) { return; }
          var r0 = g.ringe[0], flaeche = 0;
          for (var i = 0, j = r0.length - 2; i < r0.length; j = i, i += 2) {
            var a = O.xy(r0[j], r0[j + 1]), b = O.xy(r0[i], r0[i + 1]);
            flaeche += a[0] * b[1] - b[0] * a[1];
          }
          flaeche = Math.abs(flaeche) / 2;
          for (var h = 1; h < g.ringe.length; h++) {
            var rh = g.ringe[h], fh = 0;
            for (var i2 = 0, j2 = rh.length - 2; i2 < rh.length; j2 = i2, i2 += 2) {
              var a2 = O.xy(rh[j2], rh[j2 + 1]), b2 = O.xy(rh[i2], rh[i2 + 1]);
              fh += a2[0] * b2[1] - b2[0] * a2[1];
            }
            flaeche -= Math.abs(fh) / 2;
          }
          n2++; gf2 += flaeche;
          var tr = g.t, fi = g.f;          // schon auf den Boden bezogen (siehe hoehenKorrigieren in ansicht3d.js)
          if (d <= R1) {
            n1++; gf1 += flaeche;
            if (g.cls >= 0 && g.cls < 5) { dachCls[g.cls]++; }
            if (tr !== null) { trauf.push(tr); first.push(fi); hoehenKl[tr <= 4 ? 0 : tr <= 7 ? 1 : tr <= 10 ? 2 : tr <= 13 ? 3 : 4]++; } else { ohneHoehe++; }
          }
          if (d <= 60) { nah.push({ d: d, g: g, flaeche: flaeche, tr: tr, fi: fi }); }
        });
        var kreisflaeche1 = Math.PI * R1 * R1, kreisflaeche2 = Math.PI * R2 * R2;
        trauf.sort(function (a, b) { return a - b; }); first.sort(function (a, b) { return a - b; });
        var med = function (a) { return a.length ? a[Math.floor(a.length / 2)] : 0; };
        var mit = function (a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; };
        B.push("Bebauung (Gebäudemodell des Landes LGLN, LoD2; Näherung, Gebäude am Rand des Kreises zählen ganz):");
        B.push("  - Gebäude im 400-m-Umkreis: " + z(n1) + "; im 800-m-Umkreis: " + z(n2));
        B.push("  - Überbaute Fläche (Summe der Gebäudegrundflächen) im 400-m-Umkreis: ca. " + prozent(gf1 / kreisflaeche1) + " der Kreisfläche; im 800-m-Umkreis: ca. " + prozent(gf2 / kreisflaeche2) + " (Gebäudegrundflächen im Verhältnis zur Kreisfläche, nicht zur Grundstücksfläche; keine GRZ nach BauNVO)");
        B.push("  - Die Zahl der Gebäude enthält auch Nebengebäude (Garagen, Schuppen, Anbauten) und Gebäudeteile.");
        if (trauf.length) {
          B.push("  - Höhen über Gelände (Höhenangabe der Datei minus Geländehöhe am Gebäude; Genauigkeit etwa 1 bis 5 m), ohne Höhenwert: " + z(ohneHoehe) + " Gebäude");
          B.push("  - Traufhöhe im 400-m-Umkreis: Median " + z(med(trauf), 1) + " m, Mittel " + z(mit(trauf), 1) + " m, größte Firsthöhe " + z(first[first.length - 1], 1) + " m");
          B.push("  - Verteilung nach Traufhöhe (grob, bei etwa 3 m je Geschoss; keine amtliche Geschosszahl; enthält auch niedrige Nebengebäude): bis 4 m " + prozent(hoehenKl[0] / trauf.length) + ", 4–7 m " + prozent(hoehenKl[1] / trauf.length) + ", 7–10 m " + prozent(hoehenKl[2] / trauf.length) + ", 10–13 m " + prozent(hoehenKl[3] / trauf.length) + ", über 13 m " + prozent(hoehenKl[4] / trauf.length));
        } else if (n1) { B.push("  - Höhen über Gelände: nicht berechnet (Geländedatei fehlt)."); }
        if (n1) {
          B.push("  - Dachformen (vereinfacht, Anteil): flach " + prozent(dachCls[0] / n1) + ", Satteldach " + prozent(dachCls[1] / n1) + ", Walmdach " + prozent(dachCls[2] / n1) + ", Zelt-/Pyramidendach " + prozent(dachCls[3] / n1) + ", Pultdach " + prozent(dachCls[4] / n1));
        }
        nah.sort(function (a, b) { return a.d - b.d; });
        if (nah.length) {
          B.push("  - Gebäude im 60-m-Umkreis um den roten Punkt (nächste zuerst; Abstand zur Gebäudemitte):");
          nah.filter(function (e) { return e.flaeche >= 10; }).slice(0, 10).forEach(function (e) { B.push("    - " + z(Math.round(e.d)) + " m " + O.richtung(e.g.lat, e.g.lng) + ": " + (e.tr === null ? "Höhe unbekannt" : "Traufe " + z(e.tr, 1) + " m, First " + z(e.fi, 1) + " m") + ", Grundfläche ca. " + z(Math.round(e.flaeche)) + " m²"); });
          B.push("    (nur Gebäude ab 10 m² Grundfläche aufgelistet; kleinere Nebengebäude und Gebäudeteile fehlen hier)");
        } else { B.push("  - Im 60-m-Umkreis um den roten Punkt stehen laut Daten keine Gebäude (unbebaute oder neu zu bebauende Stelle möglich)."); }
        teile.quellen.push("Gebäudehöhen: LGLN (2024), CC BY 4.0");

        // Gelände
        if (Gd0) {
          var hp = hAt(P.lat, P.lng), mn1 = 1e9, mx1 = -1e9, mn2 = 1e9, mx2 = -1e9, s1 = 0, c1 = 0;
          pts.forEach(function (p, i) {
            if (i % 4 !== 0) { return; }
            var h = hAt(p.lat, p.lng); if (h === null) { return; }
            if (h < mn2) { mn2 = h; } if (h > mx2) { mx2 = h; }
            if (p.in1) { if (h < mn1) { mn1 = h; } if (h > mx1) { mx1 = h; } s1 += h; c1++; }
          });
          B.push("Gelände (Höhenmodell DGM1 des Landes, 5-m-Raster; glättet Deiche und Böschungen):");
          if (hp !== null) {
            B.push("  - Höhe am roten Punkt: ca. " + z(hp, 1) + " m über NHN");
            if (c1) { B.push("  - Im 400-m-Umkreis: " + z(mn1, 1) + " bis " + z(mx1, 1) + " m über NHN (Unterschied " + z(mx1 - mn1, 1) + " m); im 800-m-Umkreis: " + z(mn2, 1) + " bis " + z(mx2, 1) + " m (Unterschied " + z(mx2 - mn2, 1) + " m)"); }
          } else { B.push("  - Der Punkt liegt außerhalb des Höhenmodells."); }
          teile.quellen.push("Gelände: LGLN (DGM1), CC BY 4.0");
        }
      } else if (!opt.hoehen) {
        teile.fehlt.push("Gebäudehöhen, Dichte und Geländehöhen (die Option „Gebäudehöhen und Gelände einbeziehen“ war ausgeschaltet).");
      }

      // Nutzungen, Grün, Wasser
      var gruppenInfo = [["parks", "Parks, Gärten, Wiesen, Friedhöfe, Spielplätze (Grünflächen)"], ["wald", "Wald, Gehölz, Feuchtgebiet"], ["wasser", "Gewässer"], ["plaetze", "Plätze, Fußgängerzonen, Märkte"],
                         ["wohnen", "Flächennutzung Wohnen"], ["gewerbe", "Flächennutzung Gewerbe und Handel"], ["industrie", "Flächennutzung Industrie, Hafen, Bahngelände"], ["gemeinbedarf", "Flächennutzung Gemeinbedarf und Bildung (Schulen, Kliniken, Kirchen, Behörden)"]];
      B.push("Flächenanteile im Umkreis (aus OpenStreetMap-Flächen, Raster 16 m; die Gruppen können sich überlappen; wo OSM keine Nutzung kennt, bleibt es weiß, also kein Beweis für „unbebaut“):");
      gruppenInfo.forEach(function (gi) {
        if (!fl[gi[0]]) { return; }
        var a = anteile(pts, fl[gi[0]]);
        B.push("  - " + gi[1] + ": " + prozent(a.a1) + " im 400-m-Umkreis, " + prozent(a.a2) + " im 800-m-Umkreis");
      });
      teile.quellen.push("Flächen und Nutzungen: © OpenStreetMap-Mitwirkende (ODbL)");

      // Bäume
      if (daten.baeume) {
        var bn1 = 0, bn2 = 0, krone1 = 0, mitH = 0, nH = 0, ig = 0;
        daten.baeume.forEach(function (b) {
          var d = O.abstand(b.lat, b.lng);
          if (d <= R2) { bn2++; }
          if (d <= R1) { bn1++; var kr = window.baumKroneBreite(b); krone1 += Math.PI * kr * kr / 4; if (b.h > 0) { mitH += b.h; nH++; } if (b.ig) { ig++; } }
        });
        B.push(zeile("Einzelbäume (OpenStreetMap, unvollständig; viele Straßenbäume fehlen)", z(bn1) + " im 400-m-Umkreis, " + z(bn2) + " im 800-m-Umkreis" + (nH ? "; bei " + nH + " ist die Höhe erfasst (Mittel " + z(mitH / nH, 1) + " m)" : "") + (ig ? "; " + ig + " immergrün/Nadel" : "") + "; Kronenfläche der erfassten Bäume im 400-m-Umkreis ca. " + prozent(Math.min(1, krone1 / (Math.PI * R1 * R1))) + " (geschätzt, Kronenbreite oft nicht erfasst)"));
        var nah30 = daten.baeume.filter(function (b) { return O.abstand(b.lat, b.lng) <= 40; });
        if (nah30.length) { B.push(zeile("Erfasste Bäume im 40-m-Umkreis um den roten Punkt", nah30.length + " (z. B. " + nah30.slice(0, 5).map(function (b) { return O.richtung(b.lat, b.lng) + " " + z(Math.round(O.abstand(b.lat, b.lng))) + " m" + (b.h > 0 ? ", " + z(b.h, 0) + " m hoch" : ""); }).join("; ") + ")")); }
      }

      // Bewegung: ÖPNV, Fahrplan, Rad, Auto
      if (daten.oepnv) {
        var bus = punktGruppe(O, daten.oepnv.filter(function (p) { return !p.bahn; })), bahnh = punktGruppe(O, daten.oepnv.filter(function (p) { return p.bahn; }));
        B.push(zeile("Haltestellen (OpenStreetMap)", "Bushaltepunkte: " + z(bus.n1) + " im 400-m-, " + z(bus.n2) + " im 800-m-Umkreis, " + abstandText(bus.naechste) + "; Bahnhof/Haltepunkt: " + abstandText(bahnh.naechste)));
        teile.quellen.push("Haltestellen: © OpenStreetMap-Mitwirkende (ODbL)");
      }
      if (daten.fahrplan) {
        var nahe = daten.fahrplan.filter(function (h) { return O.abstand(h.lat, h.lng) <= R1; }).sort(function (a, b) { return b.abf - a.abf; });
        if (nahe.length) {
          var alleLinien = {}; nahe.forEach(function (h) { String(h.linien || "").split(/\s*[,;]\s*/).forEach(function (l) { if (l) { alleLinien[l] = true; } }); });
          B.push("Fahrplan (gtfs.de, ein normaler Dienstag, 6–20 Uhr, ohne Endhaltestellen; Haltestellen gleichen Namens zusammengefasst):");
          B.push("  - Haltestellen im 400-m-Umkreis: " + nahe.length + ", verschiedene Linien: " + Object.keys(alleLinien).length);
          nahe.slice(0, 5).forEach(function (h) { B.push("  - " + h.name + " (" + z(Math.round(O.abstand(h.lat, h.lng) / 10) * 10) + " m, " + O.richtung(h.lat, h.lng) + "): " + z(h.abf / 14, 1) + " Abfahrten pro Stunde im Mittel, Linien " + (h.linien || "keine Angabe")); });
        } else { B.push(zeile("Fahrplan", "keine Haltestelle mit Fahrplandaten im 400-m-Umkreis (der Fahrplan enthält nur Haltestellen mit Linienverkehr).")); }
        teile.quellen.push("Fahrplan: gtfs.de / DELFI e.V. (CC BY 4.0)");
      }
      if (daten.mobil) {
        var mz = [];
        window.MOBILITAET.forEach(function (g) {
          var d = daten.mobil[g.id]; if (!d) { return; }
          if (d.punkte) { var pg = punktGruppe(O, d.punkte); mz.push("  - " + g.name + ": " + z(pg.n1) + " im 400-m-, " + z(pg.n2) + " im 800-m-Umkreis, " + abstandText(pg.naechste)); }
          if (d.linien) {
            var l1 = 0, l2 = 0;
            d.linien.forEach(function (li) { for (var i = 1; i < li.length; i++) { var mlat = (li[i][0] + li[i - 1][0]) / 2, mlng = (li[i][1] + li[i - 1][1]) / 2, dd = O.abstand(mlat, mlng); if (dd > R2) { continue; } var a = O.xy(li[i - 1][0], li[i - 1][1]), b = O.xy(li[i][0], li[i][1]), len = Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); l2 += len; if (dd <= R1) { l1 += len; } } });
            mz.push("  - " + g.name + ": ca. " + z(Math.round(l1 / 10) * 10) + " m Länge im 400-m-, ca. " + z(Math.round(l2 / 10) * 10) + " m im 800-m-Umkreis");
          }
        });
        B.push("Verkehr und Mobilität (Radwege, Parken, Sharing: OpenStreetMap; Ladestationen: Bundesnetzagentur):");
        mz.forEach(function (t) { B.push(t); });
        teile.quellen.push(window.MOBILITAET_OSM_TEXT + "; " + window.MOBILITAET_LADER_TEXT);
      }

      // Einrichtungen, Spielen
      if (daten.einr) {
        B.push("Einrichtungen (OpenStreetMap, nicht vollständig; Zahl der Einträge, nicht Größe oder Qualität):");
        window.EINRICHTUNGEN.forEach(function (g) {
          var pg = punktGruppe(O, daten.einr[g.id] || []);
          B.push("  - " + g.name + ": " + z(pg.n1) + " im 400-m-, " + z(pg.n2) + " im 800-m-Umkreis, " + abstandText(pg.naechste));
        });
        teile.quellen.push("Einrichtungen: © OpenStreetMap-Mitwirkende (ODbL)");
      }
      if (daten.spiel) {
        var sp = punktGruppe(O, daten.spiel.spielplaetze), oeff = daten.spiel.spielplaetze.filter(function (s) { return !/privat|customers|no/i.test(s.zugang || ""); });
        var spo = punktGruppe(O, oeff);
        var orte = Object.keys(daten.spiel.orte).map(function (id) { var g = window.SPIEL.filter(function (x) { return x.id === id; })[0]; var pg = punktGruppe(O, daten.spiel.orte[id]); return (g ? g.name : id) + ": " + z(pg.n1) + " im 400-m-Umkreis, " + abstandText(pg.naechste); });
        B.push(zeile("Spielplätze (OpenStreetMap)", z(sp.n1) + " im 400-m-, " + z(sp.n2) + " im 800-m-Umkreis, " + abstandText(sp.naechste) + "; davon wahrscheinlich öffentlich (Zugang nicht eingeschränkt): " + abstandText(spo.naechste)));
        B.push("  - Bewegungsorte: " + orte.join("; "));
      }

      // Sonne
      B.push("Sonne am Standort (gerechnet, ohne Verschattung durch Umgebung; Ortszeit):");
      window.SONNE.forEach(function (tag) {
        var d = window.sonnenDaten(P.lat, P.lng, tag);
        B.push("  - " + tag.datum + ": Aufgang " + window.uhrzeitText(d.aufgangZeit) + " Uhr (Richtung " + z(d.aufgangRichtung, 0) + "°), Untergang " + window.uhrzeitText(d.untergangZeit) + " Uhr (Richtung " + z(d.untergangRichtung, 0) + "°), Mittagshöhe " + z(d.mittagHoehe, 0) + "°, Sonnenhöchststand " + window.uhrzeitText(d.mittagZeit) + " Uhr");
      });
      B.push("  - Tag- und Nachtgleiche: Mittagshöhe etwa " + z(90 - P.lat, 0) + "°. Verschattung durch Nachbarbauten ist hier NICHT berücksichtigt (dafür gibt es in der App die 3D-Ansicht mit Schatten und Sonnenstunden).");

      // Lärm, Schutzgebiete, Luft, Starkregen
      var laermZeilen = [];
      [["laerm_lden", "Straßenlärm ganzer Tag (L_DEN)", window.LAERM_LDEN], ["laerm_nacht", "Straßenlärm nachts (L_Night)", window.LAERM_NACHT]].forEach(function (L) {
        var list = fl[L[0]]; if (!list) { return; }
        var amPunkt = list.filter(function (f) { return inFlaeche(f, P.lat, P.lng); }).map(function (f) { return L[2][f.a] ? L[2][f.a][1] : f.a; });
        var alle = anteile(pts, list);
        laermZeilen.push("  - " + L[1] + " am roten Punkt: " + (amPunkt.length ? amPunkt.join(", ") : "keine Kartierung an dieser Stelle (unter der Schwelle von 55 dB tags bzw. 50 dB nachts oder keine kartierte Straße)") + "; Anteil der Fläche mit Kartierung: " + prozent(alle.a1) + " im 400-m-, " + prozent(alle.a2) + " im 800-m-Umkreis");
      });
      if (laermZeilen.length) {
        B.push("Lärm (Lärmkartierung der Stadt Oldenburg, nur Straßenlärm; Schienen-, Gewerbe- und Fluglärm sind nicht enthalten):");
        laermZeilen.forEach(function (t) { B.push(t); });
        teile.quellen.push(window.STADT_QUELLE_TEXT);
      }
      var schutz = [["nsg", "Naturschutzgebiet"], ["lsg", "Landschaftsschutzgebiet"], ["biotope", "Geschütztes Biotop"], ["wallhecken", "Wallhecken"]];
      var sz = [];
      schutz.forEach(function (s) {
        if (!fl[s[0]]) { return; }
        var r = naechsteFlaeche(O, fl[s[0]], R2);
        sz.push("  - " + s[1] + ": " + (r.abstand === 0 ? "der Punkt liegt darin" : (r.abstand <= R2 ? "nächste Fläche ca. " + z(Math.round(r.abstand / 10) * 10) + " m entfernt" : "keine im 800-m-Umkreis")));
      });
      if (fl.naturdenkmale) { var nd = (fl.naturdenkmale || []).map(function (p) { return { lat: p.lat, lng: p.lng }; }); var ndg = punktGruppe(O, nd); sz.push("  - Naturdenkmale: " + z(ndg.n2) + " im 800-m-Umkreis, " + abstandText(ndg.naechste)); }
      if (sz.length) { B.push("Schutzgebiete (Stadt Oldenburg; Näherung über Umrisse, ersetzt keine Auskunft der Naturschutzbehörde):"); sz.forEach(function (t) { B.push(t); }); }

      if (daten.luft && daten.luft.length) {
        var best = daten.luft.slice().sort(function (a, b) { return O.abstand(a.lat, a.lng) - O.abstand(b.lat, b.lng); })[0];
        var lj = best.jahre[best.jahre.length - 1];
        B.push(zeile("Luftqualität", "nächste amtliche Messstation „" + best.name + "“ (Art: " + best.art + ") in ca. " + z(Math.round(O.abstand(best.lat, best.lng) / 10) * 10) + " m; Jahresmittel " + lj.jahr + ": NO₂ " + (lj.no2 === null ? "–" : z(lj.no2, 1)) + ", PM10 " + (lj.pm10 === null ? "–" : z(lj.pm10, 1)) + ", PM2,5 " + (lj.pm25 === null ? "–" : z(lj.pm25, 1)) + " µg/m³ (Grenzwerte EU bis 2029: 40/40/25; Richtwerte WHO 2021: 10/15/5). Gilt nur für die Messstelle, nicht für jeden Ort der Stadt."));
        teile.quellen.push(window.LUFT_QUELLE_TEXT);
      }
      if (regenErg.length) {
        B.push("Starkregen (Hinweiskarte des Bundes, BKG; Simulation ohne Kanalnetz und Versickerung; Online-Abfrage für ein 200 × 200 m großes Fenster um den roten Punkt):");
        regenErg.forEach(function (e) {
          var r = e.r, kl = window.STARKREGEN_KLASSEN;
          if (!r) { B.push("  - " + e.g.name + ": Abfrage nicht möglich (kein Internet oder Dienst nicht erreichbar)"); }
          else { B.push("  - " + e.g.name + ": " + (r.anteil > 0 ? prozent(r.anteil) + " des Fensters überflutet, größte Tiefe im Fenster " + (r.tiefste >= 0 ? kl[r.tiefste][1] : "unter 10 cm") + (r.mitte >= 0 ? "; am roten Punkt selbst " + kl[r.mitte][1] : "; am roten Punkt selbst keine Überflutung dargestellt") : "keine Überflutung (ab 10 cm) im Fenster dargestellt")); }
        });
        teile.quellen.push(window.STARKREGEN_QUELLE_TEXT);
      } else if (!opt.starkregen) {
        teile.fehlt.push("Starkregen-Gefährdung (die Abfrage war ausgeschaltet).");
      }

      // Eingeschaltete Ebenen
      var an = window.alleAnalyseEbenen().filter(function (e) { return window.karte.hasLayer(e.ebene); }).map(function (e) { return e.name || e.legende || e.text || e.id; });
      B.push(zeile("Zur Zeit in der Karte eingeschaltete Analyseebenen", an.length ? an.join("; ") : "keine"));
      B.push(zeile("Hintergrundkarte", window.aktiveQuelle() === window.KARTEN_QUELLEN.schwarzplan ? "Schwarzplan" : (window.aktiveQuelle() === window.KARTEN_QUELLEN.eigene ? "Startkarte" : "Hellgrau") + (window.karte.hasLayer(window.bebauungEbene) ? ", Bebauung eingeschaltet" : "")));

      // ===== C. Projektanforderungen (Angaben des Nutzers) =====
      function nutzer(titel, wert) {
        if (wert && String(wert).trim()) { C.push(zeile(titel, String(wert).trim().replace(/\n+/g, " "))); } else { C.push(zeile(titel, "nicht angegeben")); teile.fehlt.push(titel + " (vom Nutzer nicht angegeben).");}
      }
      nutzer("Geplante Nutzung und Bauaufgabe (Funktionen, Räume)", opt.aufgabe);
      nutzer("Ungefähre Geschossfläche in m²", opt.flaeche);
      nutzer("Zahl der Nutzer", opt.nutzer);
      nutzer("Höhe bzw. Geschossbegrenzung", opt.geschosse);
      nutzer("Nachhaltigkeitsziele und besondere Wünsche des Auftraggebers", opt.wuensche);

      // ===== D. Randbedingungen =====
      Dd.push(zeile("Planungsrecht (Baulinien, Abstände, Art und Maß der Nutzung)", "nicht angegeben; die App kennt nur, ob ein Bebauungsplan-Umriss den Punkt enthält (siehe oben)"));
      Dd.push(zeile("Bestand auf dem Grundstück, zu erhaltende Gebäude", "nicht angegeben (das Gebäudemodell zeigt Gebäude im Umfeld, sagt aber nichts über Erhalt oder Abriss)"));
      Dd.push(zeile("Brandschutz, Zufahrt, Budget, Bauweise", "nicht angegeben"));
      ["Eigentumsverhältnisse, Altlasten, Baugrund und Grundwasserstand (die App hat dafür Online-Karten des Landes, sie sind in diesem Text nicht ausgewertet)", "Klimadaten (Temperatur, Wind, Niederschlag), Windrichtungen", "Genaue Lage und Höhe der Nachbargebäude an der Grundstücksgrenze, Abstandsflächen", "Leitungen und Erschließung (Wasser, Abwasser, Strom, Wärme)", "Baulinien, Baugrenzen, zulässige Geschosszahl und Dichte aus dem Planungsrecht"].forEach(function (t) { teile.fehlt.push(t + "."); });

      teile.stand = Dm;
      return teile;
    });
  }

  // ---------- Vorlage ----------
  var VORLAGE = `GENERATE DESIGN STRATEGY

AI Architecture & Urban Design Assistant

ROLE

You are an experienced architect, urban designer, and architectural strategist. You specialize in translating site analysis, urban context, environmental conditions, and architectural requirements into distinctive architectural design strategies.

Your task is to develop three fundamentally different architectural and urban design strategies for a given site.

You do not simply generate three variations of the same building. Each strategy must represent a distinct architectural position, urban concept, spatial organization, and relationship between the building and its surroundings.

Think conceptually, spatially, critically, and architecturally.

1. INPUT DATA

You will receive the following information (it is provided in the section "EINGABEDATEN" above this instruction):

A. Site Information
Site location and address; site boundaries and area; site geometry and dimensions; topography and orientation; existing buildings and structures; access points and surrounding streets; neighboring buildings and urban context.

B. Site Analysis
Urban structure and morphology; surrounding building typologies; building heights and density; public and private spaces; existing movement patterns; access and circulation; views and visual connections; sunlight and shading conditions; climate and environmental factors; green spaces and vegetation; noise sources and environmental constraints; existing spatial qualities and potentials.

C. Project Requirements
Intended building use; required functions and spaces; approximate floor area; number of users; height or storey limitations; relevant design requirements; sustainability goals; special client requirements.

D. Design Constraints
Known planning restrictions; setbacks and building lines; access and fire safety requirements; existing structures to preserve; budget or construction constraints; other known limitations.

Only use provided or explicitly verified information as factual input. Clearly identify missing information and assumptions.

2. CORE TASK

Develop exactly three architectural design strategies.

Each strategy must explore a fundamentally different response to the site's urban, spatial, environmental, and functional conditions.

The three strategies should differ in at least the following aspects:
- Urban planning concept
- Positioning and footprint of the building
- Relationship to surrounding buildings
- Relationship between public and private space
- Spatial organization
- Building massing and height distribution
- Circulation and access
- Relationship between interior and exterior
- Architectural character
- Landscape integration

Avoid superficial differences such as changing only the building shape, façade material, or color.

Each strategy must have a clear conceptual argument explaining why this approach makes sense for the specific site.

3. DESIGN STRATEGY GENERATION

Generate three strategies using the following conceptual directions as inspiration. Adapt them to the actual site instead of applying them mechanically.

STRATEGY A — URBAN CONTINUITY
Explore how the project can strengthen and continue the existing urban fabric.
Potential approaches: completing an existing street edge; creating a perimeter block; reinforcing existing urban axes; aligning with neighboring buildings; creating clearly defined urban spaces; strengthening the relationship between street and building.
Focus: urban integration, spatial definition, contextual continuity, and efficient land use.

STRATEGY B — OPEN & CONNECTED LANDSCAPE
Explore how architecture can become an extension of the surrounding landscape and public realm.
Potential approaches: freestanding or fragmented building volumes; generous open spaces; green corridors and landscape connections; public courtyards and gardens; porous ground floors; integration of vegetation and outdoor activities.
Focus: openness, permeability, landscape integration, biodiversity, and public space.

STRATEGY C — HYBRID & TRANSFORMATIVE URBANITY
Explore a more experimental approach that introduces new spatial relationships and urban possibilities.
Potential approaches: hybrid building typologies; layered or stacked functions; elevated or interconnected volumes; mixed-use configurations; new public passages and connections; flexible spaces and adaptable structures; combining dense and open spatial conditions.
Focus: innovation, programmatic diversity, spatial complexity, adaptability, and new urban relationships.

Important: These are conceptual starting points, not fixed building forms. If another interpretation better responds to the site, develop it while preserving the conceptual distinction between the three strategies.

4. OUTPUT STRUCTURE

For each of the three strategies, generate the following sections:

4.1 STRATEGY IDENTITY
Strategy name; short conceptual title; one-sentence design statement; three to five architectural keywords.

4.2 URBAN CONCEPT
Explain: how the strategy responds to the existing urban structure; how the building relates to neighboring structures; how it defines or transforms public space; which existing urban connections it strengthens or creates; how it addresses the site's specific opportunities and constraints.

4.3 ARCHITECTURAL CONCEPT
Describe: building typology; building footprint and massing; height and volume distribution; spatial organization; main entrance and access concept; circulation and movement; relationship between interior and exterior; potential architectural character.

4.4 SPATIAL ORGANIZATION
Explain the proposed arrangement of: public functions; semi-public functions; private functions; service and technical areas; open spaces; circulation areas. Describe the spatial relationships, not just a list of rooms.

4.5 LANDSCAPE & CLIMATE
Explain: integration of existing vegetation; new green and open spaces; sunlight and shading considerations; ventilation and outdoor comfort; rainwater management opportunities; potential climate-adaptive measures. Do not claim precise environmental performance without sufficient data.

4.6 DESIGN POTENTIAL
Identify: three major architectural opportunities; three major urban or spatial benefits; potential sustainability benefits.

4.7 RISKS & CHALLENGES
Identify: main design challenges; potential conflicts with the site context; functional or spatial disadvantages; planning or technical issues requiring further investigation.

4.8 DESIGN PRINCIPLES
Provide five clear principles that should guide the next design phase. Make them actionable and specific to the strategy.

4.9 CONCEPTUAL VISUALIZATION
Describe how this strategy could be represented visually: suggested massing diagram; suggested site plan; suggested section; suggested spatial or circulation diagram; suggested architectural atmosphere. Provide a concise image-generation prompt for an architectural concept visualization. The visualization prompt must describe the design idea, spatial composition, context, perspective, lighting, and architectural atmosphere. It must not invent precise site conditions that were not provided.

5. COMPARATIVE EVALUATION

After generating all three strategies, compare them using the following criteria. Score each criterion from 1 to 5 (1 = Weak, 2 = Limited, 3 = Moderate, 4 = Strong, 5 = Very strong).

Evaluation criteria: urban integration; response to site conditions; quality of public space; spatial quality; functional efficiency; architectural identity; landscape integration; sustainability potential; flexibility and adaptability; overall design potential.

Explain each score briefly and transparently. Do not reward a strategy simply because it is more experimental. Evaluate each strategy according to its suitability for the specific project. Present the results in a comparison table.

6. FINAL RECOMMENDATION

Conclude with:
A. Recommended Strategy: identify the strategy with the strongest overall potential.
B. Reasoning: explain why it is the most convincing response to the site and project requirements.
C. Design Opportunities: identify the most promising elements that should be developed further.
D. Potential Hybrid: identify whether individual elements from the other two strategies could be integrated into the recommended strategy.
E. Next Design Steps: suggest five concrete steps for developing the selected concept into an architectural design.

Do not automatically recommend the highest-scoring strategy if the scores are close or if a particular strategic advantage is more important than the total score.

7. DESIGN QUALITY RULES

Follow these principles throughout the process:
- Every strategy must be architecturally and urbanistically distinct.
- Every strategy must respond specifically to the provided site.
- Avoid generic architectural descriptions.
- Avoid purely aesthetic variations.
- Explain the spatial consequences of each design decision.
- Connect design decisions to specific findings from the site analysis.
- Distinguish between verified facts, assumptions, and design proposals.
- Never invent legal permissions, dimensions, or technical feasibility.
- Do not present conceptual ideas as approved or buildable designs.
- If important information is missing, state the uncertainty and explain how it affects the design proposal.
- Prefer clear architectural reasoning over unnecessarily complex language.

FINAL OBJECTIVE

The output should read like an early-stage architectural design competition study.

The three strategies must be sufficiently developed that an architect can use them as a starting point for: site planning; massing studies; conceptual floor plans; architectural diagrams; sectional studies; initial visualizations; design development.

The result should enable a meaningful architectural decision between three genuinely different visions for the site.`;

  // ---------- Text zusammensetzen ----------
  function zusammenbauen(t) {
    var datum = t.stand.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
    var z_ = [];
    z_.push("HINWEIS FÜR DIE KI");
    z_.push("Dieser Text besteht aus zwei Teilen: (1) EINGABEDATEN zu einem Standort in Oldenburg, die die Web-App „Standortanalyse Oldenburg“ am " + datum + " aus lokalen Datendateien und Angaben des Nutzers zusammengestellt hat, und (2) der ANWEISUNG weiter unten. Befolge die Anweisung und verwende die Eingabedaten als einzige faktische Grundlage. Antworte auf Deutsch. Was unter „Nicht vorhanden“ steht, ist unbekannt: Kennzeichne dazu getroffene Annahmen ausdrücklich als Annahmen.");
    z_.push("Die Zahlen stammen aus Open-Data-Dateien (Stand je Quelle unten) und sind Näherungen für den frühen Entwurf, keine amtliche Auskunft.");
    z_.push("");
    z_.push("==================== EINGABEDATEN ====================");
    z_.push("");
    z_.push("A. SITE INFORMATION (Standort)");
    t.A.forEach(function (l) { z_.push(l); });
    z_.push("");
    z_.push("B. SITE ANALYSIS (Standortanalyse; Umkreise: 400 m und 800 m um den roten Punkt, das sind 5 und 10 Minuten zu Fuß in Luftlinie)");
    t.B.forEach(function (l) { z_.push(l); });
    z_.push("");
    z_.push("C. PROJECT REQUIREMENTS (Projektanforderungen, Angaben des Nutzers)");
    t.C.forEach(function (l) { z_.push(l); });
    z_.push("");
    z_.push("D. DESIGN CONSTRAINTS (Randbedingungen)");
    t.D.forEach(function (l) { z_.push(l); });
    z_.push("");
    z_.push("NICHT VORHANDEN bzw. UNBEKANNT (bitte als Lücken und Annahmen behandeln):");
    var gesehen = {};
    t.fehlt.forEach(function (l) { if (!gesehen[l]) { gesehen[l] = true; z_.push("- " + l); } });
    z_.push("");
    z_.push("QUELLEN: " + t.quellen.filter(function (q, i, a) { return a.indexOf(q) === i; }).join(" | "));
    z_.push("");
    z_.push("==================== ANWEISUNG ====================");
    z_.push("");
    z_.push(VORLAGE);
    return z_.join("\n");
  }

  window.entwurf = {
    // opt: { aufgabe, flaeche, nutzer, geschosse, wuensche, hoehen (bool), starkregen (bool) }; melde(text) zeigt den Fortschritt
    erstellen: function (opt, melde) {
      if (!window.marker) { return Promise.reject(new Error("Adresse fehlt")); }
      return sammeln(opt, melde).then(zusammenbauen);
    }
  };
})();
