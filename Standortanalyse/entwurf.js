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
      var K = teile.kenn = {};           // Kennzahlen für das Standortprofil (Kacheln, Stärken und Hinweise)

      // ===== A. Standort =====
      A.push(zeile("Adresse (so gesucht)", window.aktuelleAnzeige || "nicht angegeben"));
      A.push(zeile("Lage des roten Punkts (Mittelpunkt aller Umkreise)", z(P.lat, 6) + " N, " + z(P.lng, 6) + " O (WGS 84)"));
      var bez = (fl.bezirke || []).filter(function (f) { return inFlaeche(f, P.lat, P.lng); })[0];
      A.push(zeile("Stadtbezirk", bez && bez.a ? bez.a : "nicht in den Daten gefunden"));
      K.bezirk = bez && bez.a ? bez.a : "";
      var bpl = (fl.bplan || []).filter(function (f) { return inFlaeche(f, P.lat, P.lng); }).length;
      K.bplan = bpl > 0;
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
        var G = daten.a3d.gebaeude, n1 = 0, n2 = 0, gf1 = 0, gf2 = 0, trauf = [], traufHaupt = [], first = [], dachCls = [0, 0, 0, 0, 0], hoehenKl = [0, 0, 0, 0, 0], nah = [];
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
            if (tr !== null) { trauf.push(tr); if (flaeche >= 50) { traufHaupt.push(tr); } first.push(fi); hoehenKl[tr <= 4 ? 0 : tr <= 7 ? 1 : tr <= 10 ? 2 : tr <= 13 ? 3 : 4]++; } else { ohneHoehe++; }
          }
          if (d <= 60) { nah.push({ d: d, g: g, flaeche: flaeche, tr: tr, fi: fi }); }
        });
        var kreisflaeche1 = Math.PI * R1 * R1, kreisflaeche2 = Math.PI * R2 * R2;
        trauf.sort(function (a, b) { return a - b; }); first.sort(function (a, b) { return a - b; });
        var med = function (a) { return a.length ? a[Math.floor(a.length / 2)] : 0; };
        var mit = function (a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; };
        B.push("Bebauung (Gebäudemodell des Landes LGLN, LoD2; Näherung, Gebäude am Rand des Kreises zählen ganz):");
        B.push("  - Gebäude im 400-m-Umkreis: " + z(n1) + "; im 800-m-Umkreis: " + z(n2));
        K.gebaeude400 = n1; K.gebaeude800 = n2; K.ueberbaut400 = gf1 / kreisflaeche1;
        B.push("  - Überbaute Fläche (Summe der Gebäudegrundflächen) im 400-m-Umkreis: ca. " + prozent(gf1 / kreisflaeche1) + " der Kreisfläche; im 800-m-Umkreis: ca. " + prozent(gf2 / kreisflaeche2) + " (Gebäudegrundflächen im Verhältnis zur Kreisfläche, nicht zur Grundstücksfläche; keine GRZ nach BauNVO)");
        B.push("  - Die Zahl der Gebäude enthält auch Nebengebäude (Garagen, Schuppen, Anbauten) und Gebäudeteile.");
        if (trauf.length) {
          K.traufeMedian = med(trauf); if (traufHaupt.length) { traufHaupt.sort(function (a, b) { return a - b; }); K.traufeHaupt = med(traufHaupt); } K.firstMax = first[first.length - 1]; K.hoch13 = hoehenKl[4] / trauf.length; K.niedrig7 = (hoehenKl[0] + hoehenKl[1]) / trauf.length;
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
            K.hoeheAmPunkt = hp; if (c1) { K.hoeheDiff400 = mx1 - mn1; }
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
        (K.anteil = K.anteil || {})[gi[0]] = a;
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
        K.baeume400 = bn1;
        B.push(zeile("Einzelbäume (OpenStreetMap, unvollständig; viele Straßenbäume fehlen)", z(bn1) + " im 400-m-Umkreis, " + z(bn2) + " im 800-m-Umkreis" + (nH ? "; bei " + nH + " ist die Höhe erfasst (Mittel " + z(mitH / nH, 1) + " m)" : "") + (ig ? "; " + ig + " immergrün/Nadel" : "") + "; Kronenfläche der erfassten Bäume im 400-m-Umkreis ca. " + prozent(Math.min(1, krone1 / (Math.PI * R1 * R1))) + " (geschätzt, Kronenbreite oft nicht erfasst)"));
        var nah30 = daten.baeume.filter(function (b) { return O.abstand(b.lat, b.lng) <= 40; });
        if (nah30.length) { B.push(zeile("Erfasste Bäume im 40-m-Umkreis um den roten Punkt", nah30.length + " (z. B. " + nah30.slice(0, 5).map(function (b) { return O.richtung(b.lat, b.lng) + " " + z(Math.round(O.abstand(b.lat, b.lng))) + " m" + (b.h > 0 ? ", " + z(b.h, 0) + " m hoch" : ""); }).join("; ") + ")")); }
      }

      // Bewegung: ÖPNV, Fahrplan, Rad, Auto
      if (daten.oepnv) {
        var bus = punktGruppe(O, daten.oepnv.filter(function (p) { return !p.bahn; })), bahnh = punktGruppe(O, daten.oepnv.filter(function (p) { return p.bahn; }));
        K.bus400 = bus.n1; K.busNaechste = bus.naechste; K.bahnNaechste = bahnh.naechste;
        B.push(zeile("Haltestellen (OpenStreetMap)", "Bushaltepunkte: " + z(bus.n1) + " im 400-m-, " + z(bus.n2) + " im 800-m-Umkreis, " + abstandText(bus.naechste) + "; Bahnhof/Haltepunkt: " + abstandText(bahnh.naechste)));
        teile.quellen.push("Haltestellen: © OpenStreetMap-Mitwirkende (ODbL)");
      }
      if (daten.fahrplan) {
        var nahe = daten.fahrplan.filter(function (h) { return O.abstand(h.lat, h.lng) <= R1; }).sort(function (a, b) { return b.abf - a.abf; });
        if (nahe.length) {
          var alleLinien = {}; nahe.forEach(function (h) { String(h.linien || "").split(/\s*[,;]\s*/).forEach(function (l) { if (l) { alleLinien[l] = true; } }); });
          K.takt400 = nahe[0].abf / 14; K.linien400 = Object.keys(alleLinien).length;
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
          if (d.punkte) { var pg = punktGruppe(O, d.punkte); (K.mob = K.mob || {})[g.id] = pg; mz.push("  - " + g.name + ": " + z(pg.n1) + " im 400-m-, " + z(pg.n2) + " im 800-m-Umkreis, " + abstandText(pg.naechste)); }
          if (d.linien) {
            var l1 = 0, l2 = 0;
            d.linien.forEach(function (li) { for (var i = 1; i < li.length; i++) { var mlat = (li[i][0] + li[i - 1][0]) / 2, mlng = (li[i][1] + li[i - 1][1]) / 2, dd = O.abstand(mlat, mlng); if (dd > R2) { continue; } var a = O.xy(li[i - 1][0], li[i - 1][1]), b = O.xy(li[i][0], li[i][1]), len = Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1])); l2 += len; if (dd <= R1) { l1 += len; } } });
            (K.mob = K.mob || {})[g.id] = { l1: l1, l2: l2 };
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
          (K.einr = K.einr || {})[g.id] = pg;
          B.push("  - " + g.name + ": " + z(pg.n1) + " im 400-m-, " + z(pg.n2) + " im 800-m-Umkreis, " + abstandText(pg.naechste));
        });
        teile.quellen.push("Einrichtungen: © OpenStreetMap-Mitwirkende (ODbL)");
      }
      if (daten.spiel) {
        var sp = punktGruppe(O, daten.spiel.spielplaetze), oeff = daten.spiel.spielplaetze.filter(function (s) { return !/privat|customers|no/i.test(s.zugang || ""); });
        var spo = punktGruppe(O, oeff);
        var orte = Object.keys(daten.spiel.orte).map(function (id) { var g = window.SPIEL.filter(function (x) { return x.id === id; })[0]; var pg = punktGruppe(O, daten.spiel.orte[id]); return (g ? g.name : id) + ": " + z(pg.n1) + " im 400-m-Umkreis, " + abstandText(pg.naechste); });
        K.spiel = sp; K.spielOeff = spo;
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
        if (L[0] === "laerm_lden") { K.laermTag = amPunkt; K.laermAnteil400 = alle.a1; }
        if (L[0] === "laerm_nacht") { K.laermNacht = amPunkt; }
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
        (K.schutz = K.schutz || {})[s[0]] = r.abstand;
        sz.push("  - " + s[1] + ": " + (r.abstand === 0 ? "der Punkt liegt darin" : (r.abstand <= R2 ? "nächste Fläche ca. " + z(Math.round(r.abstand / 10) * 10) + " m entfernt" : "keine im 800-m-Umkreis")));
      });
      if (fl.naturdenkmale) { var nd = (fl.naturdenkmale || []).map(function (p) { return { lat: p.lat, lng: p.lng }; }); var ndg = punktGruppe(O, nd); sz.push("  - Naturdenkmale: " + z(ndg.n2) + " im 800-m-Umkreis, " + abstandText(ndg.naechste)); }
      if (sz.length) { B.push("Schutzgebiete (Stadt Oldenburg; Näherung über Umrisse, ersetzt keine Auskunft der Naturschutzbehörde):"); sz.forEach(function (t) { B.push(t); }); }

      if (daten.luft && daten.luft.length) {
        var best = daten.luft.slice().sort(function (a, b) { return O.abstand(a.lat, a.lng) - O.abstand(b.lat, b.lng); })[0];
        var lj = best.jahre[best.jahre.length - 1];
        K.no2 = lj.no2; K.luftJahr = lj.jahr; K.luftAbstand = O.abstand(best.lat, best.lng);
        B.push(zeile("Luftqualität", "nächste amtliche Messstation „" + best.name + "“ (Art: " + best.art + ") in ca. " + z(Math.round(O.abstand(best.lat, best.lng) / 10) * 10) + " m; Jahresmittel " + lj.jahr + ": NO₂ " + (lj.no2 === null ? "–" : z(lj.no2, 1)) + ", PM10 " + (lj.pm10 === null ? "–" : z(lj.pm10, 1)) + ", PM2,5 " + (lj.pm25 === null ? "–" : z(lj.pm25, 1)) + " µg/m³ (Grenzwerte EU bis 2029: 40/40/25; Richtwerte WHO 2021: 10/15/5). Gilt nur für die Messstelle, nicht für jeden Ort der Stadt."));
        teile.quellen.push(window.LUFT_QUELLE_TEXT);
      }
      if (regenErg.length) {
        B.push("Starkregen (Hinweiskarte des Bundes, BKG; Simulation ohne Kanalnetz und Versickerung; Online-Abfrage für ein 200 × 200 m großes Fenster um den roten Punkt):");
        regenErg.forEach(function (e) {
          var r = e.r, kl = window.STARKREGEN_KLASSEN;
          (K.regen = K.regen || {})[e.g.id] = r;
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
    var bwt = bewerten(t);
    if (bwt.gesamt) {
      z_.push("E. APP-BEWERTUNG (einfache Einschätzung der App aus den Zahlen oben, nur zur Orientierung; bitte kritisch prüfen und nicht blind übernehmen)");
      z_.push("- Gesamtnote: " + z(bwt.gesamt.note, 1) + " (" + bwt.gesamt.wort + "), Skala Schulnoten 1 = sehr gut bis 6 = ungenügend");
      bwt.kategorien.forEach(function (k) { z_.push("- " + k.titel + ": " + z(k.note, 1) + " (" + k.wort + ") – " + k.text); });
      z_.push("- " + bwt.hinweis);
      z_.push("");
    }
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

  // ---------- Dateiformate: Textdatei, Word (.docx), PDF ----------
  // Beide Formate werden ohne Zusatzprogramme in der App selbst gebaut. Die Zeilen des Textes werden dafür grob eingeteilt:
  // Überschriften (Großbuchstaben, "A. SITE ..."), Aufzählungspunkte ("- ", eingerückt je zwei Leerzeichen), Leerzeilen und normaler Text.
  function zeileEinteilen(l) {
    if (/^\s*$/.test(l)) { return { art: "leer" }; }
    if (/^=+ .* =+$/.test(l)) { return { art: "h1", text: l.replace(/^=+ | =+$/g, "") }; }
    var pm = l.match(/^(\s*)- (.*)$/);
    if (pm) { return { art: "punkt", text: pm[2], ebene: Math.floor(pm[1].length / 2) }; }
    if (l.length < 90 && /^[A-ZÄÖÜ0-9][A-ZÄÖÜ0-9 &\/\-—.,:()]{3,}$/.test(l)) { return { art: "h2", text: l }; }
    if (/^[A-D]\. [A-Z][A-Z ]{3,}/.test(l) || /^NICHT VORHANDEN/.test(l)) { return { art: "h2", text: l }; }
    return { art: "text", text: l.replace(/^\s+/, "") };
  }

  // -- PDF (Helvetica, A4, Seitenzahlen) --
  function winAnsi(s) {
    var karte = { "„": 0x84, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "–": 0x96, "—": 0x97, "•": 0x95, "€": 0x80, "…": 0x85, "™": 0x99 };
    var ersatz = { "₂": "2", "₁": "1", "−": "-", "≥": ">=", "≤": "<=", "≈": "~", "→": "->", "½": "1/2", " ": " " };
    var aus = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), k = s.charCodeAt(i);
      if (k < 128 || (k >= 160 && k <= 255)) { aus += c; }
      else if (karte[c] !== undefined) { aus += String.fromCharCode(karte[c]); }
      else if (ersatz[c] !== undefined) { aus += ersatz[c]; }
      else { aus += "?"; }
    }
    return aus;
  }
  function pdfText(s) { return winAnsi(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"); }
  function pdfBauen(text, titel) {
    var cv = document.createElement("canvas").getContext("2d");
    var B = 595.28, H = 841.89, RAND = 56, OBEN = 62, UNTEN = 62, BR = B - 2 * RAND;
    function breite(t, fett, gr) { cv.font = (fett ? "bold " : "") + gr + "px Arial, Helvetica, sans-serif"; return cv.measureText(t).width; }
    function umbrechen(t, fett, gr, maxB) {
      var worte = t.split(" "), zeilen = [], akt = "";
      worte.forEach(function (w) {
        var probe = akt ? akt + " " + w : w;
        if (breite(probe, fett, gr) <= maxB) { akt = probe; return; }
        if (akt) { zeilen.push(akt); akt = ""; }
        while (breite(w, fett, gr) > maxB) {          // sehr langes Wort: hart trennen
          var n = w.length; while (n > 1 && breite(w.slice(0, n), fett, gr) > maxB) { n--; }
          zeilen.push(w.slice(0, n)); w = w.slice(n);
        }
        akt = w;
      });
      zeilen.push(akt);
      return zeilen;
    }
    var seiten = [[]], y = OBEN;
    function neueSeite() { seiten.push([]); y = OBEN; }
    function setzen(t, x0, fett, gr, vorher, nachher, punktX) {      // punktX: vor die erste Zeile kommt ein Aufzählungspunkt an dieser Stelle
      var zeilen = umbrechen(t, fett, gr, BR - (x0 - RAND)), lh = gr * 1.38;
      y += vorher;
      zeilen.forEach(function (z, i) {
        if (y + lh > H - UNTEN) { neueSeite(); }
        y += lh;
        var sp = seiten[seiten.length - 1];
        if (i === 0 && punktX !== undefined) { sp.push({ x: punktX, y: y - gr * 0.28, t: "•", fett: false, gr: gr }); }
        sp.push({ x: x0, y: y - gr * 0.28, t: z, fett: fett, gr: gr });
      });
      y += nachher;
    }
    setzen(titel, RAND, true, 17, 0, 6);
    text.split("\n").forEach(function (l) {
      var e = zeileEinteilen(l);
      if (e.art === "leer") { y += 5; }
      else if (e.art === "h1") { setzen(e.text, RAND, true, 13.5, 10, 4); }
      else if (e.art === "h2") { setzen(e.text, RAND, true, 11, 8, 2); }
      else if (e.art === "punkt") {
        var x = RAND + 8 + e.ebene * 14;
        setzen(e.text, x + 9, false, 9.5, 0, 1, x);
      }
      else { setzen(e.text, RAND, false, 9.5, 0, 2); }
    });
    // PDF-Objekte schreiben (nur Zeichen unter 256, Länge = Bytes)
    var objs = [], N = seiten.length;
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = []; for (var i = 0; i < N; i++) { kids.push((5 + 2 * i) + " 0 R"); }
    objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + N + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    function f2(n) { return (Math.round(n * 100) / 100).toString(); }
    seiten.forEach(function (sp, i) {
      var c = [];
      sp.forEach(function (e) { c.push("BT /" + (e.fett ? "F2" : "F1") + " " + f2(e.gr) + " Tf " + f2(e.x) + " " + f2(H - e.y) + " Td (" + pdfText(e.t) + ") Tj ET"); });
      var fuss = "Seite " + (i + 1) + " von " + N, fb = breite(fuss, false, 8);
      c.push("BT /F1 8 Tf " + f2((B - fb) / 2) + " " + f2(32) + " Td (" + pdfText(fuss) + ") Tj ET");
      var inhalt = c.join("\n");
      objs[5 + 2 * i] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + f2(B) + " " + f2(H) + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + (6 + 2 * i) + " 0 R >>";
      objs[6 + 2 * i] = "<< /Length " + inhalt.length + " >>\nstream\n" + inhalt + "\nendstream";
    });
    var info = 5 + 2 * N;
    objs[info] = "<< /Title (" + pdfText(titel) + ") /Producer (Standortanalyse Oldenburg) >>";
    var out = "%PDF-1.4\n", off = [];
    for (var o = 1; o <= info; o++) { off[o] = out.length; out += o + " 0 obj\n" + objs[o] + "\nendobj\n"; }
    var xref = out.length;
    out += "xref\n0 " + (info + 1) + "\n0000000000 65535 f \n";
    for (var q = 1; q <= info; q++) { out += ("0000000000" + off[q]).slice(-10) + " 00000 n \n"; }
    out += "trailer\n<< /Size " + (info + 1) + " /Root 1 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    var bytes = new Uint8Array(out.length);
    for (var b = 0; b < out.length; b++) { bytes[b] = out.charCodeAt(b) & 255; }
    return new Blob([bytes], { type: "application/pdf" });
  }

  // -- Word (.docx = ZIP aus einigen XML-Dateien, hier ohne Komprimierung geschrieben) --
  var CRC_TABELLE = null;
  function crc32(bytes) {
    if (!CRC_TABELLE) { CRC_TABELLE = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) { c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); } CRC_TABELLE[n] = c >>> 0; } }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) { crc = CRC_TABELLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8); }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function zipBauen(dateien) {          // dateien = [{ name, text }]
    var enc = new TextEncoder(), teile = [], zentral = [], offset = 0;
    var d = new Date(), zeit = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    function u16(v) { return [v & 255, (v >> 8) & 255]; }
    function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
    dateien.forEach(function (f) {
      var name = enc.encode(f.name), daten = enc.encode(f.text), crc = crc32(daten);
      var kopf = [0x50, 0x4b, 0x03, 0x04].concat(u16(20), u16(0x0800), u16(0), u16(zeit), u16(datum), u32(crc), u32(daten.length), u32(daten.length), u16(name.length), u16(0));
      teile.push(new Uint8Array(kopf), name, daten);
      zentral.push({ name: name, crc: crc, groesse: daten.length, offset: offset });
      offset += kopf.length + name.length + daten.length;
    });
    var zStart = offset, zGroesse = 0;
    zentral.forEach(function (z) {
      var e = [0x50, 0x4b, 0x01, 0x02].concat(u16(20), u16(20), u16(0x0800), u16(0), u16(zeit), u16(datum), u32(z.crc), u32(z.groesse), u32(z.groesse), u16(z.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(z.offset));
      teile.push(new Uint8Array(e), z.name); zGroesse += e.length + z.name.length;
    });
    teile.push(new Uint8Array([0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(zentral.length), u16(zentral.length), u32(zGroesse), u32(zStart), u16(0))));
    return new Blob(teile, { type: "application/zip" });
  }
  function xml(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); }
  function docxBauen(text, titel) {
    var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", ab = [];
    function absatz(t, stil, einzug) {
      var ppr = (stil ? '<w:pStyle w:val="' + stil + '"/>' : "") + (einzug !== undefined ? '<w:spacing w:after="40"/><w:ind w:left="' + (360 + einzug * 360) + '" w:hanging="260"/>' : "");
      return "<w:p>" + (ppr ? "<w:pPr>" + ppr + "</w:pPr>" : "") + '<w:r><w:t xml:space="preserve">' + xml(t) + "</w:t></w:r></w:p>";
    }
    ab.push(absatz(titel, "Title"));
    text.split("\n").forEach(function (l) {
      var e = zeileEinteilen(l);
      if (e.art === "leer") { return; }
      if (e.art === "h1") { ab.push(absatz(e.text, "Heading1")); }
      else if (e.art === "h2") { ab.push(absatz(e.text, "Heading2")); }
      else if (e.art === "punkt") { ab.push(absatz("•  " + e.text, null, e.ebene)); }
      else { ab.push(absatz(e.text)); }
    });
    var dokument = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="' + W + '"><w:body>' + ab.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    function stil(id, name, gr, fett, vor, nach) {
      return '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + name + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + vor + '" w:after="' + nach + '"/></w:pPr><w:rPr>' + (fett ? "<w:b/>" : "") + '<w:sz w:val="' + gr + '"/></w:rPr></w:style>';
    }
    var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      stil("Title", "Title", 36, true, 0, 160) + stil("Heading1", "heading 1", 28, true, 280, 100) + stil("Heading2", "heading 2", 23, true, 200, 60) + "</w:styles>";
    var typen = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
    var blob = zipBauen([{ name: "[Content_Types].xml", text: typen }, { name: "_rels/.rels", text: rels }, { name: "word/document.xml", text: dokument }, { name: "word/_rels/document.xml.rels", text: docRels }, { name: "word/styles.xml", text: styles }]);
    return new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // ---------- Standortprofil: lesbare Fassung für Word und PDF ----------
  // Aus denselben Daten wie der KI-Text (teile.A bis D und teile.kenn) entsteht ein Dokument für Menschen: Deckblatt mit Kennzahlen, Kurzfassung mit
  // Stärken und Hinweisen (nur aus den Zahlen abgeleitet) und die Daten in Tabellen. Die englische Anweisung für die KI steht dort nicht.
  var FARBE_ROT = "C0392B", FARBE_TINTE = "1A1A1A", FARBE_GRAU = "77746D", FARBE_LINIE = "CDC9C0", FARBE_PAPIER = "F5F3EE";

  // Teilt die Textzeilen in Gruppen (Überschrift, Zeilen mit Merkmal und Wert, Notizen)
  function profilGruppen(t) {
    var gruppen = [], index = {};
    function gruppe(titel) { if (!index[titel]) { index[titel] = { titel: titel, zeilen: [], notiz: "" }; gruppen.push(index[titel]); } return index[titel]; }
    function teilePos(text) {            // erstes ": " außerhalb von Klammern
      var d = 0;
      for (var i = 0; i < text.length - 1; i++) { var c = text.charAt(i); if (c === "(") { d++; } else if (c === ")") { d--; } else if (d === 0 && c === ":" && text.charAt(i + 1) === " ") { return i; } }
      return -1;
    }
    function kopfTeilen(text) { var m = text.match(/^(.*?) \((.*)\)$/); return m ? { titel: m[1], notiz: m[2] } : { titel: text, notiz: "" }; }
    function lies(liste, standard, zuordnen) {
      var akt = gruppe(standard);
      liste.forEach(function (l) {
        if (/^[^\s-]/.test(l) && /:$/.test(l)) {                        // Gruppenüberschrift ohne Einrückung ("Bebauung (...):")
          var h = kopfTeilen(l.replace(/:$/, "")); akt = gruppe(h.titel); if (h.notiz && !akt.notiz) { akt.notiz = h.notiz; } return;
        }
        var ein = l.match(/^(\s*)- (.*)$/);
        if (!ein) { return; }
        var text = ein[2], tief = ein[1].length >= 4, pos = teilePos(text);
        if (ein[1].length === 0) {
          var label = pos > 0 ? text.slice(0, pos) : text.replace(/:\s*$/, ""), wert = pos > 0 ? text.slice(pos + 2) : "";
          if (/Zur Zeit in der Karte eingeschaltete|^Hintergrundkarte/.test(label)) { return; }
          if (wert.replace(/\s+/g, "") === "") { var h2 = kopfTeilen(label); akt = gruppe(h2.titel); if (h2.notiz && !akt.notiz) { akt.notiz = h2.notiz; } return; }
          akt = gruppe(zuordnen ? zuordnen(label) : standard);
          akt.zeilen.push({ l: label, w: wert });
          return;
        }
        if (/:\s*$/.test(text) && pos < 0) { akt.zeilen.push({ l: text.replace(/:\s*$/, ""), w: "", kopf: true }); return; }
        if (pos > 0 && !/^\(.*\)$/.test(text)) { akt.zeilen.push({ l: text.slice(0, pos), w: text.slice(pos + 2), tief: tief }); }
        else { akt.zeilen.push({ note: text.replace(/^\(|\)$/g, ""), tief: tief }); }
      });
    }
    lies(t.A, "Standort", function (label) { return /gezeichnete|Messungen|Benannte Linien|Beschriftungen|Eigene Bäume|Hochgeladene Pläne/.test(label) ? "Eigene Zeichnung und Pläne" : "Standort"; });
    lies(t.B, "Umgebung", function (label) {
      if (/Bahnstrecke/.test(label)) { return "Bahn"; }
      if (/Einzelbäume|Erfasste Bäume/.test(label)) { return "Vegetation"; }
      if (/^Haltestellen/.test(label)) { return "Haltestellen"; }
      if (/^Fahrplan/.test(label)) { return "Fahrplan"; }
      if (/Spielplätze/.test(label)) { return "Spielen und Bewegen"; }
      if (/Luftqualität/.test(label)) { return "Luftqualität"; }
      return "Umgebung";
    });
    lies(t.C, "Projektangaben (Angaben des Nutzers)");
    lies(t.D, "Randbedingungen");
    return gruppen.filter(function (g) { return g.zeilen.length; });
  }

  function aufrunden10(m) { return z(Math.round(m / 10) * 10); }
  // Kennzahlen, Kurzfassung, Stärken und Hinweise: alles nur aus den berechneten Zahlen
  function profilBewertung(t, adresse) {
    var K = t.kenn || {}, kacheln = [], staerken = [], achten = [], i;
    function kachel(wert, text) { if (kacheln.length < 6) { kacheln.push({ wert: wert, text: text }); } }
    if (K.gebaeude400 !== undefined) { kachel(z(K.gebaeude400), "Gebäude im 400-m-Umkreis"); }
    if (K.ueberbaut400 !== undefined) { kachel(prozent(K.ueberbaut400), "überbaute Fläche im 400-m-Umkreis"); }
    if (K.traufeMedian !== undefined) { kachel(z(K.traufeMedian, 1) + " m", "Traufhöhe der Gebäude (Median)"); }
    if (K.busNaechste !== undefined && isFinite(K.busNaechste)) { kachel(aufrunden10(K.busNaechste) + " m", "bis zur nächsten Bushaltestelle"); }
    if (K.einr && K.einr.laeden && isFinite(K.einr.laeden.naechste)) { kachel(aufrunden10(K.einr.laeden.naechste) + " m", "bis zum nächsten Laden"); }
    if (K.anteil && K.anteil.parks) { kachel(prozent(K.anteil.parks.a1), "Grünflächen im 400-m-Umkreis"); }
    if (K.hoeheDiff400 !== undefined && kacheln.length < 6) { kachel(z(K.hoeheDiff400, 1) + " m", "Höhenunterschied im 400-m-Umkreis"); }

    // Stärken
    if (K.busNaechste !== undefined && K.busNaechste <= 300) { staerken.push("Eine Bushaltestelle liegt nur etwa " + aufrunden10(K.busNaechste) + " m entfernt."); }
    if (K.takt400 !== undefined && K.takt400 >= 3) { staerken.push("Gute Anbindung: an der besten Haltestelle im 400-m-Umkreis fahren im Mittel etwa " + z(K.takt400, 1) + " Fahrten pro Stunde (" + K.linien400 + " Linien im Umkreis)."); }
    [["laeden", "Einkaufen", "ein Laden"], ["schulen", "Schule oder Kita", "eine Schule oder Kita"], ["aerzte", "Arzt oder Apotheke", "ein Arzt oder eine Apotheke"]].forEach(function (e) {
      var g = K.einr && K.einr[e[0]]; if (g && g.naechste <= 400) { staerken.push("Alltag zu Fuß: " + e[2] + " ist in etwa " + aufrunden10(g.naechste) + " m erreichbar."); }
    });
    if (K.anteil && K.anteil.parks && K.anteil.parks.a1 >= 0.1) { staerken.push("Grünflächen: etwa " + prozent(K.anteil.parks.a1) + " des 400-m-Umkreises sind Parks, Gärten oder Wiesen (nach OpenStreetMap)."); }
    if (K.spiel && K.spiel.naechste <= 300) { staerken.push("Ein Spielplatz liegt nur etwa " + aufrunden10(K.spiel.naechste) + " m entfernt."); }
    if (K.mob && K.mob.radweg && K.mob.radweg.l1 >= 800) { staerken.push("Gutes Radwegenetz: etwa " + z(Math.round(K.mob.radweg.l1 / 10) * 10) + " m Radwege im 400-m-Umkreis."); }
    if (K.ueberbaut400 !== undefined && K.ueberbaut400 >= 0.35 && K.ueberbaut400 <= 0.6) { staerken.push("Kompakte Bebauung (etwa " + prozent(K.ueberbaut400) + " überbaut) unterstützt kurze Wege."); }

    // Hinweise
    if (K.laermTag && K.laermTag.length) { achten.push("Straßenlärm am Standort: " + K.laermTag.join(", ") + " (ganzer Tag, Lärmkartierung der Stadt)."); }
    else if (K.laermAnteil400 !== undefined && K.laermAnteil400 > 0.3) { achten.push("In etwa " + prozent(K.laermAnteil400) + " des 400-m-Umkreises liegt Straßenlärm ab 55 dB vor; am Standort selbst nicht kartiert."); }
    var rg = K.regen && (K.regen.extrem || K.regen.agw);
    if (K.regen) {
      var ex = K.regen.extrem, ag = K.regen.agw;
      if (ex && (ex.mitte >= 0)) { achten.push("Starkregen: Am Standort selbst ist bei einem extremen Ereignis eine Überflutung dargestellt."); }
      else if (ex && ex.anteil >= 0.2) { achten.push("Starkregen: Im 100-m-Umfeld sind bei einem extremen Ereignis etwa " + prozent(ex.anteil) + " überflutet; die Fließwege sollten angesehen werden."); }
      if (ag && ag.mitte >= 0) { achten.push("Starkregen: Schon bei einem außergewöhnlichen Ereignis ist der Standort überflutet dargestellt."); }
    }
    if (K.schutz) {
      [["nsg", "Naturschutzgebiet"], ["lsg", "Landschaftsschutzgebiet"], ["biotope", "geschütztes Biotop"], ["wallhecken", "Wallhecke"]].forEach(function (s) {
        var d = K.schutz[s[0]]; if (d !== undefined && d <= 100) { achten.push((d === 0 ? "Der Standort liegt in einem" : "In nur etwa " + aufrunden10(d) + " m Entfernung liegt ein") + " " + s[1] + ": Abstimmung mit der Naturschutzbehörde einplanen."); }
      });
    }
    if (K.hoeheDiff400 !== undefined && K.hoeheDiff400 >= 5) { achten.push("Geländeunterschied von etwa " + z(K.hoeheDiff400, 1) + " m im 400-m-Umkreis."); }
    if (K.ueberbaut400 !== undefined && K.ueberbaut400 < 0.15) { achten.push("Locker bebaute Umgebung (etwa " + prozent(K.ueberbaut400) + " überbaut): Für das Leitbild der kurzen Wege liegen Ziele eher weit auseinander."); }
    if (K.ueberbaut400 !== undefined && K.ueberbaut400 > 0.6) { achten.push("Sehr dichte Bebauung (etwa " + prozent(K.ueberbaut400) + " überbaut): Freiraum, Grün und Belichtung beachten."); }
    if (K.hoch13 !== undefined && K.hoch13 >= 0.3) { achten.push("Viele hohe Gebäude (Traufe über 13 m: " + prozent(K.hoch13) + "): Verschattung des Grundstücks prüfen."); }
    if (K.no2 !== undefined && K.no2 !== null && K.no2 >= 30) { achten.push("Luft: An der nächsten Messstation lag NO₂ " + K.luftJahr + " bei " + z(K.no2, 1) + " µg/m³ (EU-Grenzwert 40, WHO-Richtwert 10); die Station liegt etwa " + aufrunden10(K.luftAbstand) + " m entfernt."); }
    if (K.busNaechste !== undefined && K.busNaechste > 500) { achten.push("Die nächste Bushaltestelle ist etwa " + aufrunden10(K.busNaechste) + " m entfernt."); }
    else if (K.takt400 === undefined && K.busNaechste !== undefined) { achten.push("Im 400-m-Umkreis liegt keine Haltestelle mit Fahrplandaten."); }
    if (K.bplan) { achten.push("Der Standort liegt im Umriss eines Bebauungsplans: Festsetzungen beim Planungsamt prüfen."); }
    if ((t.fehlt || []).some(function (f) { return /^Grundstücksgrenze/.test(f); })) { achten.push("Das Grundstück ist nicht gezeichnet; Größe und Zuschnitt sind unbekannt."); }

    // Kurzfassung als Fließtext
    var s = [];
    s.push("Das Profil beschreibt den Standort" + (adresse ? " „" + adresse + "“" : "") + (K.bezirk ? " (" + K.bezirk + ")" : "") + " mit Daten aus einem Umkreis von 400 und 800 m (5 und 10 Minuten zu Fuß in Luftlinie).");
    if (K.gebaeude400 !== undefined) {
      s.push("Im 400-m-Umkreis stehen etwa " + z(K.gebaeude400) + " Gebäude (inklusive Nebengebäude), rund " + prozent(K.ueberbaut400) + " der Fläche sind überbaut" + (K.traufeMedian !== undefined ? "; die Traufhöhe liegt im Median bei " + z(K.traufeMedian, 1) + " m" : "") + ".");
    }
    if (K.anteil && K.anteil.wohnen) { s.push("Nach OpenStreetMap ist das Umfeld zu etwa " + prozent(K.anteil.wohnen.a1) + " Wohnnutzung" + (K.anteil.gewerbe && K.anteil.gewerbe.a1 >= 0.05 ? " und zu " + prozent(K.anteil.gewerbe.a1) + " Gewerbe und Handel" : "") + "."); }
    s.push("Die Aussagen beruhen nur auf offenen Daten; sie sind Näherungen für den frühen Entwurf und ersetzen keine amtliche Auskunft oder Vermessung.");
    return { kacheln: kacheln, staerken: staerken, achten: achten, kurz: s.join(" ") };
  }

  function profilModell(t) {
    var adresse = (window.aktuelleAnzeige || "").trim(), b = profilBewertung(t, adresse);
    var P = window.marker.getLatLng();
    return { titel: "Standortprofil", adresse: adresse || "Standort ohne Adresse", datum: t.stand.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }),
             koord: z(P.lat, 5) + " N, " + z(P.lng, 5) + " O", kacheln: b.kacheln, kurz: b.kurz, staerken: b.staerken, achten: b.achten, gruppen: profilGruppen(t),
             bewertung: bewerten(t), fehlt: t.fehlt.filter(function (l, i, a) { return a.indexOf(l) === i; }), quellen: t.quellen.filter(function (q, i, a) { return a.indexOf(q) === i; }) };
  }

  // -- Word --
  function docxProfil(m) {
    var W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships", BR = 9638;
    function r(t, o) {
      o = o || {};
      return "<w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/>" + (o.fett ? "<w:b/>" : "") + (o.kursiv ? "<w:i/>" : "") + (o.farbe ? "<w:color w:val=\"" + o.farbe + "\"/>" : "") +
        (o.abst ? "<w:spacing w:val=\"" + o.abst + "\"/>" : "") + "<w:sz w:val=\"" + Math.round((o.gr || 10) * 2) + "\"/></w:rPr><w:t xml:space=\"preserve\">" + xml(t) + "</w:t></w:r>";
    }
    function p(runs, o) {
      o = o || {};
      var pr = (o.keep ? "<w:keepNext/>" : "") + (o.umbruch ? "<w:pageBreakBefore/>" : "") +
        (o.rand ? "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"" + o.rand + "\" w:space=\"4\" w:color=\"" + FARBE_ROT + "\"/></w:pBdr>" : "") +
        "<w:spacing w:before=\"" + Math.round((o.vor || 0) * 20) + "\" w:after=\"" + Math.round((o.nach === undefined ? 4 : o.nach) * 20) + "\" w:line=\"" + (o.zeile || 264) + "\" w:lineRule=\"auto\"/>" +
        (o.einzug !== undefined ? "<w:ind w:left=\"" + o.einzug + "\" w:hanging=\"" + (o.haengt || 0) + "\"/>" : "") + (o.ausr ? "<w:jc w:val=\"" + o.ausr + "\"/>" : "");
      return "<w:p><w:pPr>" + pr + "</w:pPr>" + (Array.isArray(runs) ? runs.join("") : runs) + "</w:p>";
    }
    function zelle(inhalt, breite, o) {
      o = o || {};
      return "<w:tc><w:tcPr><w:tcW w:w=\"" + breite + "\" w:type=\"dxa\"/>" + (o.span ? "<w:gridSpan w:val=\"" + o.span + "\"/>" : "") +
        "<w:tcBorders><w:top w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"" + FARBE_LINIE + "\"/><w:left w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"" + FARBE_LINIE + "\"/><w:bottom w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"" + FARBE_LINIE + "\"/><w:right w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"" + FARBE_LINIE + "\"/></w:tcBorders>" +
        "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"" + (o.fuell || "FFFFFF") + "\"/>" + (o.mitte ? "<w:vAlign w:val=\"center\"/>" : "") + "</w:tcPr>" + inhalt + "</w:tc>";
    }
    function tabelle(spalten, zeilen) {
      return "<w:tbl><w:tblPr><w:tblW w:w=\"" + BR + "\" w:type=\"dxa\"/><w:tblLayout w:type=\"fixed\"/><w:tblCellMar><w:top w:w=\"60\" w:type=\"dxa\"/><w:left w:w=\"110\" w:type=\"dxa\"/><w:bottom w:w=\"60\" w:type=\"dxa\"/><w:right w:w=\"110\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr><w:tblGrid>" +
        spalten.map(function (s) { return "<w:gridCol w:w=\"" + s + "\"/>"; }).join("") + "</w:tblGrid>" + zeilen.map(function (zl) { return "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + zl + "</w:tr>"; }).join("") + "</w:tbl>";
    }
    function punkte(liste, farbe) {
      return liste.map(function (t) { return p([r("•  ", { farbe: farbe, fett: true, gr: 10.5 }), r(t, { gr: 10.5 })], { einzug: 360, haengt: 260, nach: 3 }); }).join("");
    }
    function ueberschrift(nr, titel, o) {
      return p([r(nr ? nr + "  " : "", { fett: true, farbe: FARBE_ROT, gr: 13 }), r(titel, { fett: true, gr: 13 })], { keep: true, vor: (o && o.vor !== undefined) ? o.vor : 16, nach: 4, umbruch: o && o.umbruch, rand: o && o.rand });
    }
    var ab = [];
    // Deckblatt
    ab.push(p(r("STANDORTANALYSE OLDENBURG", { gr: 9, farbe: FARBE_GRAU, fett: true, abst: 40 }), { vor: 30, nach: 6 }));
    ab.push(p(r(m.titel, { gr: 34, fett: true }), { nach: 6, rand: 18, zeile: 240 }));
    ab.push(p(r(m.adresse, { gr: 16, fett: true, farbe: FARBE_ROT }), { vor: 8, nach: 2 }));
    ab.push(p(r(m.datum + "   ·   " + m.koord + " (WGS 84)", { gr: 9.5, farbe: FARBE_GRAU }), { nach: 14 }));
    if (m.kacheln.length) {
      var b3 = Math.floor(BR / 3), zeilenK = [];
      for (var i = 0; i < m.kacheln.length; i += 3) {
        var zs = "";
        for (var j = 0; j < 3; j++) {
          var k = m.kacheln[i + j];
          zs += zelle(k ? p(r(k.wert, { gr: 20, fett: true, farbe: FARBE_ROT }), { ausr: "center", vor: 4, nach: 0, zeile: 240 }) + p(r(k.text, { gr: 8.5, farbe: FARBE_GRAU }), { ausr: "center", nach: 4, zeile: 240 }) : p("", { nach: 0 }),
                      j === 2 ? BR - 2 * b3 : b3, { fuell: FARBE_PAPIER, mitte: true });
        }
        zeilenK.push(zs);
      }
      ab.push(tabelle([b3, b3, BR - 2 * b3], zeilenK));
    }
    ab.push(ueberschrift("", "Kurzfassung", { vor: 18 }));
    ab.push(p(r(m.kurz, { gr: 10.5 }), { nach: 6 }));
    if (m.staerken.length) { ab.push(ueberschrift("", "Das spricht für den Standort", { vor: 10 })); ab.push(punkte(m.staerken, "2E8B3D")); }
    if (m.achten.length) { ab.push(ueberschrift("", "Das ist zu beachten", { vor: 10 })); ab.push(punkte(m.achten, FARBE_ROT)); }
    // Bewertung
    if (m.bewertung && m.bewertung.gesamt) {
      var bw = m.bewertung, gn = bw.gesamt;
      ab.push(p(r("Bewertung des Standorts", { gr: 20, fett: true }), { umbruch: true, nach: 4, rand: 12, zeile: 240 }));
      ab.push(p([r(z(gn.note, 1), { gr: 40, fett: true, farbe: gn.farbe }), r("   Gesamtnote · " + gn.wort, { gr: 13, fett: true })], { vor: 10, nach: 2, zeile: 240 }));
      ab.push(p(r("Schulnoten: 1 = sehr gut, 6 = ungenügend. Gewichtet: Mobilität und Versorgung je 25 %, Grün und Umwelt je 15 %, Bebauung und Planung je 10 %.", { gr: 8.5, farbe: FARBE_GRAU }), { nach: 8 }));
      var wB = [2300, 1500, 2500, BR - 6300], zlB = [];
      zlB.push(["Kategorie", "Note", "Skala", "Begründung"].map(function (h, i) { return zelle(p(r(h, { gr: 9, fett: true, farbe: FARBE_GRAU }), { nach: 0 }), wB[i], { fuell: "E9E7E2" }); }).join(""));
      bw.kategorien.forEach(function (k, ki) {
        var voll = Math.round(k.punkte / 10), balken = "";
        for (var q = 0; q < 10; q++) { balken += r("■", { gr: 12, farbe: q < voll ? k.farbe : "D9D5CC" }); }
        var fuell = (ki % 2) ? FARBE_PAPIER : "FFFFFF";
        zlB.push(zelle(p(r(k.titel, { gr: 10, fett: true }), { nach: 0 }), wB[0], { fuell: fuell, mitte: true }) +
                 zelle(p([r(z(k.note, 1), { gr: 15, fett: true, farbe: k.farbe }), r("  " + k.wort, { gr: 8.5, farbe: FARBE_GRAU })], { nach: 0 }), wB[1], { fuell: fuell, mitte: true }) +
                 zelle(p(balken, { nach: 0 }), wB[2], { fuell: fuell, mitte: true }) +
                 zelle(p(r(k.text, { gr: 8.5 }), { nach: 0 }), wB[3], { fuell: fuell, mitte: true }));
      });
      ab.push(tabelle(wB, zlB));
      ab.push(p(r(bw.hinweis, { gr: 8.5, kursiv: true, farbe: FARBE_GRAU }), { vor: 8 }));
      bw.kategorien.forEach(function (k) {
        ab.push(p(r(k.titel + ": die einzelnen Kriterien", { gr: 10, fett: true }), { vor: 10, nach: 2, keep: true }));
        ab.push(punkte(k.kriterien.map(kritText), k.farbe));
      });
    }
    // Daten
    ab.push(p(r("Die Daten im Detail", { gr: 20, fett: true }), { umbruch: true, nach: 4, rand: 12, zeile: 240 }));
    m.gruppen.forEach(function (g, gi) {
      ab.push(ueberschrift(("0" + (gi + 1)).slice(-2), g.titel));
      if (g.notiz) { ab.push(p(r(g.notiz, { gr: 8.5, kursiv: true, farbe: FARBE_GRAU }), { keep: true, nach: 4 })); }
      var w1 = 3200, w2 = BR - w1, zl = [], n = 0;
      g.zeilen.forEach(function (e) {
        if (e.note) { zl.push(zelle(p(r(e.note, { gr: 8.5, kursiv: true, farbe: FARBE_GRAU }), { nach: 0, einzug: e.tief ? 300 : 0, haengt: 0 }), BR, { span: 2, fuell: "FFFFFF" })); return; }
        if (e.kopf) { zl.push(zelle(p(r(e.l, { gr: 9.5, fett: true }), { nach: 0 }), BR, { span: 2, fuell: "E9E7E2" })); n = 0; return; }
        var fuell = (n++ % 2) ? FARBE_PAPIER : "FFFFFF";
        zl.push(zelle(p(r((e.tief ? "– " : "") + e.l, { gr: 9.5, fett: true, farbe: "4A4842" }), { nach: 0, einzug: e.tief ? 200 : 0, haengt: 0 }), w1, { fuell: fuell }) + zelle(p(r(e.w, { gr: 9.5 }), { nach: 0 }), w2, { fuell: fuell }));
      });
      ab.push(tabelle([w1, w2], zl));
      ab.push(p("", { nach: 0 }));
    });
    if (m.fehlt.length) { ab.push(ueberschrift("", "Nicht vorhanden oder unbekannt", { vor: 14 })); ab.push(punkte(m.fehlt, FARBE_GRAU)); }
    ab.push(ueberschrift("", "Quellen", { vor: 14 }));
    m.quellen.forEach(function (q) { ab.push(p(r(q, { gr: 8.5, farbe: FARBE_GRAU }), { nach: 2 })); });
    ab.push(p(r("Erstellt mit der App „Standortanalyse Oldenburg“ am " + m.datum + ". Alle Zahlen sind Näherungen aus offenen Daten und ersetzen keine amtliche Auskunft, Vermessung oder Genehmigung.", { gr: 8.5, kursiv: true, farbe: FARBE_GRAU }), { vor: 12 }));

    var dokument = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document xmlns:w=\"" + W + "\" xmlns:r=\"" + R + "\"><w:body>" + ab.join("") +
      "<w:sectPr><w:footerReference w:type=\"default\" r:id=\"rId2\"/><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"708\" w:footer=\"567\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>";
    var fuss = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:ftr xmlns:w=\"" + W + "\" xmlns:r=\"" + R + "\"><w:p><w:pPr><w:pBdr><w:top w:val=\"single\" w:sz=\"4\" w:space=\"4\" w:color=\"" + FARBE_LINIE + "\"/></w:pBdr><w:tabs><w:tab w:val=\"right\" w:pos=\"" + BR + "\"/></w:tabs></w:pPr>" +
      r("Standortanalyse Oldenburg  ·  " + m.adresse, { gr: 8, farbe: FARBE_GRAU }) + "<w:r><w:tab/></w:r>" + r("Seite ", { gr: 8, farbe: FARBE_GRAU }) +
      "<w:fldSimple w:instr=\"PAGE\"><w:r><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/><w:color w:val=\"" + FARBE_GRAU + "\"/><w:sz w:val=\"16\"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>";
    var styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:styles xmlns:w=\"" + W + "\"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\" w:cs=\"Arial\"/><w:sz w:val=\"21\"/><w:lang w:val=\"de-DE\"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after=\"80\" w:line=\"264\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style></w:styles>";
    var typen = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/><Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/><Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/></Types>";
    var rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>";
    var docRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" Target=\"footer1.xml\"/></Relationships>";
    var blob = zipBauen([{ name: "[Content_Types].xml", text: typen }, { name: "_rels/.rels", text: rels }, { name: "word/document.xml", text: dokument }, { name: "word/_rels/document.xml.rels", text: docRels }, { name: "word/styles.xml", text: styles }, { name: "word/footer1.xml", text: fuss }]);
    return new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  // -- PDF im gleichen Stil --
  function pdfProfil(m) {
    var cv = document.createElement("canvas").getContext("2d");
    var B = 595.28, H = 841.89, RAND = 52, OBEN = 54, UNTEN = 60, BR = B - 2 * RAND;
    function rgb(hex) { return [parseInt(hex.substr(0, 2), 16) / 255, parseInt(hex.substr(2, 2), 16) / 255, parseInt(hex.substr(4, 2), 16) / 255]; }
    function breite(t, fett, gr) { cv.font = (fett ? "bold " : "") + gr + "px Arial, Helvetica, sans-serif"; return cv.measureText(t).width; }
    function umbrechen(t, fett, gr, maxB) {
      var worte = String(t).split(" "), zeilen = [], akt = "";
      worte.forEach(function (w) {
        var probe = akt ? akt + " " + w : w;
        if (breite(probe, fett, gr) <= maxB) { akt = probe; return; }
        if (akt) { zeilen.push(akt); akt = ""; }
        while (breite(w, fett, gr) > maxB) { var n = w.length; while (n > 1 && breite(w.slice(0, n), fett, gr) > maxB) { n--; } zeilen.push(w.slice(0, n)); w = w.slice(n); }
        akt = w;
      });
      zeilen.push(akt);
      return zeilen;
    }
    var seiten = [[]], y = OBEN;
    function neueSeite() { seiten.push([]); y = OBEN; }
    function sp() { return seiten[seiten.length - 1]; }
    function text(t, x, yy, fett, gr, farbe, mitte) { if (mitte) { x = x - breite(t, fett, gr) / 2; } sp().push({ k: "t", x: x, y: yy, t: t, fett: fett, gr: gr, farbe: rgb(farbe) }); }
    function rechteck(x, yy, w, h, farbe) { sp().push({ k: "r", x: x, y: yy, w: w, h: h, farbe: rgb(farbe) }); }
    function linie(x1, y1, x2, y2, farbe, dicke) { sp().push({ k: "l", x1: x1, y1: y1, x2: x2, y2: y2, farbe: rgb(farbe), d: dicke }); }
    function platz(h) { if (y + h > H - UNTEN) { neueSeite(); } }
    // Absatz mit Umbruch; gibt die Höhe zurück
    function absatz(t, x0, gr, fett, farbe, vor, nach, breiteMax) {
      var zeilen = umbrechen(t, fett, gr, (breiteMax || (BR - (x0 - RAND)))), lh = gr * 1.4;
      y += vor;
      zeilen.forEach(function (zl) { platz(lh); y += lh; text(zl, x0, y - gr * 0.28, fett, gr, farbe); });
      y += nach;
    }
    function aufzaehlung(liste, farbe) {
      liste.forEach(function (t) {
        var zeilen = umbrechen(t, false, 10, BR - 16), lh = 14;
        platz(lh * Math.min(2, zeilen.length));
        zeilen.forEach(function (zl, i) { platz(lh); y += lh; if (i === 0) { text("•", RAND + 2, y - 2.8, true, 10, farbe); } text(zl, RAND + 14, y - 2.8, false, 10, FARBE_TINTE); });
        y += 2;
      });
    }
    function ueberschrift(nr, titel, vor, mitFolge) {
      platz(vor + 20 + (mitFolge || 24));
      y += vor;
      var x = RAND;
      if (nr) { text(nr, x, y + 11, true, 13, FARBE_ROT); x += 24; }
      text(titel, x, y + 11, true, 13, FARBE_TINTE);
      y += 18;
    }

    // Deckblatt
    rechteck(RAND, y, 46, 5, FARBE_ROT); y += 24;
    text("STANDORTANALYSE OLDENBURG", RAND, y, true, 8.5, FARBE_GRAU); y += 38;
    text(m.titel, RAND, y, true, 30, FARBE_TINTE); y += 10;
    linie(RAND, y, RAND + BR, y, FARBE_ROT, 1.4); y += 6;
    absatz(m.adresse, RAND, 15, true, FARBE_ROT, 10, 2);
    absatz(m.datum + "   ·   " + m.koord + " (WGS 84)", RAND, 9, false, FARBE_GRAU, 0, 14);
    if (m.kacheln.length) {
      var kw = (BR - 20) / 3, kh = 66;
      for (var i = 0; i < m.kacheln.length; i += 3) {
        platz(kh + 10);
        for (var j = 0; j < 3; j++) {
          var k = m.kacheln[i + j]; if (!k) { continue; }
          var kx = RAND + j * (kw + 10);
          rechteck(kx, y, kw, kh, FARBE_PAPIER);
          linie(kx, y, kx + kw, y, FARBE_LINIE, 0.6); linie(kx, y + kh, kx + kw, y + kh, FARBE_LINIE, 0.6); linie(kx, y, kx, y + kh, FARBE_LINIE, 0.6); linie(kx + kw, y, kx + kw, y + kh, FARBE_LINIE, 0.6);
          text(k.wert, kx + kw / 2, y + 28, true, 20, FARBE_ROT, true);
          var tz = umbrechen(k.text, false, 8, kw - 14); tz.slice(0, 2).forEach(function (zl, q) { text(zl, kx + kw / 2, y + 43 + q * 10.5, false, 8, FARBE_GRAU, true); });
        }
        y += kh + 10;
      }
    }
    ueberschrift("", "Kurzfassung", 12, 40);
    absatz(m.kurz, RAND, 10, false, FARBE_TINTE, 2, 4);
    if (m.staerken.length) { ueberschrift("", "Das spricht für den Standort", 8, 30); aufzaehlung(m.staerken, "2E8B3D"); }
    if (m.achten.length) { ueberschrift("", "Das ist zu beachten", 8, 30); aufzaehlung(m.achten, FARBE_ROT); }

    // Bewertung (eigene Seite)
    if (m.bewertung && m.bewertung.gesamt) {
      var bw = m.bewertung, gn = bw.gesamt;
      neueSeite();
      text("Bewertung des Standorts", RAND, y + 16, true, 20, FARBE_TINTE); y += 24; linie(RAND, y, RAND + BR, y, FARBE_ROT, 1); y += 8;
      text(z(gn.note, 1), RAND, y + 36, true, 38, gn.farbe);
      text("Gesamtnote · " + gn.wort, RAND + 86, y + 28, true, 13, FARBE_TINTE);
      y += 48;
      absatz("Schulnoten: 1 = sehr gut, 6 = ungenügend. Gewichtet: Mobilität und Versorgung je 25 %, Grün und Umwelt je 15 %, Bebauung und Planung je 10 %.", RAND, 8, false, FARBE_GRAU, 0, 8);
      bw.kategorien.forEach(function (k) {
        var tz = umbrechen(k.text, false, 8.8, BR), kr = k.kriterien.map(function (c) { return umbrechen("– " + kritText(c), false, 8, BR - 8); });
        var hk = 22 + 12 + tz.length * 11.5 + kr.reduce(function (s, a) { return s + a.length * 10.3; }, 0) + 12;
        platz(hk);
        text(k.titel, RAND, y + 12, true, 11.5, FARBE_TINTE);
        var nt = z(k.note, 1) + " · " + k.wort; text(nt, RAND + BR - breite(nt, true, 11.5), y + 12, true, 11.5, k.farbe);
        rechteck(RAND, y + 18, BR, 7, "E4E1DA"); rechteck(RAND, y + 18, BR * k.punkte / 100, 7, k.farbe);
        y += 36;
        tz.forEach(function (zl) { text(zl, RAND, y, false, 8.8, FARBE_TINTE); y += 11.5; });
        kr.forEach(function (zeilen) { zeilen.forEach(function (zl, q) { text(zl, RAND + (q ? 8 : 0), y, false, 8, FARBE_GRAU); y += 10.3; }); });
        y += 10;
      });
      absatz(bw.hinweis, RAND, 8, false, FARBE_GRAU, 4, 0);
    }
    // Daten im Detail
    neueSeite();    text("Die Daten im Detail", RAND, y + 16, true, 20, FARBE_TINTE); y += 24; linie(RAND, y, RAND + BR, y, FARBE_ROT, 1); y += 4;
    var W1 = 168, W2 = BR - W1, G = 9, LH = 12.2;
    m.gruppen.forEach(function (g, gi) {
      ueberschrift(("0" + (gi + 1)).slice(-2), g.titel, 16, 40);
      if (g.notiz) { var nz = umbrechen(g.notiz, false, 8, BR); nz.forEach(function (zl) { y += 10.5; text(zl, RAND, y - 2, false, 8, FARBE_GRAU); }); y += 3; }
      var n = 0;
      g.zeilen.forEach(function (e) {
        if (e.note) {
          var nl = umbrechen(e.note, false, 8, BR - 12 - (e.tief ? 14 : 0)), h = nl.length * 10.5 + 5; platz(h);
          nl.forEach(function (zl, q) { text(zl, RAND + 6 + (e.tief ? 14 : 0), y + 9.5 + q * 10.5, false, 8, FARBE_GRAU); }); y += h; return;
        }
        if (e.kopf) { platz(20); rechteck(RAND, y, BR, 16, "E9E7E2"); text(e.l, RAND + 6, y + 11.2, true, G, FARBE_TINTE); y += 16; n = 0; return; }
        var ll = umbrechen((e.tief ? "– " : "") + e.l, true, G, W1 - 12 - (e.tief ? 8 : 0)), wl = umbrechen(e.w, false, G, W2 - 12);
        var h2 = Math.max(ll.length, wl.length) * LH + 6; platz(h2);
        rechteck(RAND, y, BR, h2, (n++ % 2) ? FARBE_PAPIER : "FFFFFF");
        ll.forEach(function (zl, q) { text(zl, RAND + 6 + (e.tief ? 8 : 0), y + 3 + (q + 1) * LH - 3, true, G, "4A4842"); });
        wl.forEach(function (zl, q) { text(zl, RAND + W1 + 6, y + 3 + (q + 1) * LH - 3, false, G, FARBE_TINTE); });
        linie(RAND, y + h2, RAND + BR, y + h2, FARBE_LINIE, 0.4);
        y += h2;
      });
      y += 4;
    });
    if (m.fehlt.length) { ueberschrift("", "Nicht vorhanden oder unbekannt", 16, 30); aufzaehlung(m.fehlt, FARBE_GRAU); }
    ueberschrift("", "Quellen", 16, 24);
    m.quellen.forEach(function (q) { absatz(q, RAND, 8, false, FARBE_GRAU, 0, 2); });
    absatz("Erstellt mit der App „Standortanalyse Oldenburg“ am " + m.datum + ". Alle Zahlen sind Näherungen aus offenen Daten und ersetzen keine amtliche Auskunft, Vermessung oder Genehmigung.", RAND, 8, false, FARBE_GRAU, 10, 0);

    // Fußzeile (erst jetzt, wenn die Seitenzahl feststeht)
    var N = seiten.length;
    seiten.forEach(function (s, i) {
      s.push({ k: "l", x1: RAND, y1: H - UNTEN + 14, x2: RAND + BR, y2: H - UNTEN + 14, farbe: rgb(FARBE_LINIE), d: 0.6 });
      s.push({ k: "t", x: RAND, y: H - UNTEN + 27, t: "Standortanalyse Oldenburg  ·  " + m.adresse, fett: false, gr: 7.5, farbe: rgb(FARBE_GRAU) });
      var fz = "Seite " + (i + 1) + " von " + N;
      s.push({ k: "t", x: RAND + BR - breite(fz, false, 7.5), y: H - UNTEN + 27, t: fz, fett: false, gr: 7.5, farbe: rgb(FARBE_GRAU) });
    });
    // PDF-Objekte schreiben
    function f2(v) { return (Math.round(v * 100) / 100).toString(); }
    function farbe3(c) { return f2(c[0]) + " " + f2(c[1]) + " " + f2(c[2]); }
    var objs = [];
    objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    var kids = []; for (var pi = 0; pi < N; pi++) { kids.push((5 + 2 * pi) + " 0 R"); }
    objs[2] = "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + N + " >>";
    objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    seiten.forEach(function (s, pi2) {
      var c = [];
      s.forEach(function (e) {
        if (e.k === "r") { c.push(farbe3(e.farbe) + " rg " + f2(e.x) + " " + f2(H - e.y - e.h) + " " + f2(e.w) + " " + f2(e.h) + " re f"); }
        else if (e.k === "l") { c.push(f2(e.d) + " w " + farbe3(e.farbe) + " RG " + f2(e.x1) + " " + f2(H - e.y1) + " m " + f2(e.x2) + " " + f2(H - e.y2) + " l S"); }
        else { c.push("BT " + farbe3(e.farbe) + " rg /" + (e.fett ? "F2" : "F1") + " " + f2(e.gr) + " Tf " + f2(e.x) + " " + f2(H - e.y) + " Td (" + pdfText(e.t) + ") Tj ET"); }
      });
      var inhalt = c.join("\n");
      objs[5 + 2 * pi2] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + f2(B) + " " + f2(H) + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents " + (6 + 2 * pi2) + " 0 R >>";
      objs[6 + 2 * pi2] = "<< /Length " + inhalt.length + " >>\nstream\n" + inhalt + "\nendstream";
    });
    var info = 5 + 2 * N;
    objs[info] = "<< /Title (" + pdfText("Standortprofil – " + m.adresse) + ") /Producer (Standortanalyse Oldenburg) >>";
    var out = "%PDF-1.4\n", off = [];
    for (var o = 1; o <= info; o++) { off[o] = out.length; out += o + " 0 obj\n" + objs[o] + "\nendobj\n"; }
    var xref = out.length;
    out += "xref\n0 " + (info + 1) + "\n0000000000 65535 f \n";
    for (var q2 = 1; q2 <= info; q2++) { out += ("0000000000" + off[q2]).slice(-10) + " 00000 n \n"; }
    out += "trailer\n<< /Size " + (info + 1) + " /Root 1 0 R /Info " + info + " 0 R >>\nstartxref\n" + xref + "\n%%EOF";
    var bytes = new Uint8Array(out.length);
    for (var bi = 0; bi < out.length; bi++) { bytes[bi] = out.charCodeAt(bi) & 255; }
    return new Blob([bytes], { type: "application/pdf" });
  }

  // ---------- Bewertung des Standorts (Noten 1 bis 6) ----------
  // Rein aus den berechneten Zahlen (teile.kenn) mit festen, hier lesbaren Schwellen. Jedes Kriterium bekommt 0 bis 100 Punkte
  // (linear zwischen "schlecht" und "gut"), die Kategorie ist der gewichtete Mittelwert der vorhandenen Kriterien, die Note ist
  // 6 - 5 * Punkte / 100 (100 Punkte = 1,0; 0 Punkte = 6,0). Fehlende Daten zählen nicht mit. Es ist eine Orientierung, keine Wertermittlung.
  function lin(x, schlecht, gut) {
    if (x === null || x === undefined || !isFinite(x)) { return null; }
    return Math.max(0, Math.min(1, (x - schlecht) / (gut - schlecht))) * 100;
  }
  function gewMittel(liste) {
    var s = 0, g = 0;
    liste.forEach(function (e) { if (e.s !== null && e.s !== undefined) { s += e.s * e.g; g += e.g; } });
    return g ? s / g : null;
  }
  function noteVon(punkte) { return Math.round(Math.max(1, Math.min(6, 6 - 5 * punkte / 100)) * 10) / 10; }
  function noteWort(n) { return n <= 1.5 ? "sehr gut" : n <= 2.5 ? "gut" : n <= 3.5 ? "befriedigend" : n <= 4.5 ? "ausreichend" : n <= 5.5 ? "mangelhaft" : "ungenügend"; }
  function bewertungFarbe(punkte) { return punkte >= 75 ? "2E8B3D" : punkte >= 55 ? "86A93A" : punkte >= 40 ? "E8A317" : punkte >= 25 ? "E8710A" : "C0392B"; }
  function meter10(m) { return z(Math.round(m / 10) * 10) + " m"; }

  function bewerten(t) {
    var K = t.kenn || {}, kat = [];
    function kategorie(titel, gewicht, kriterien) {
      var punkte = gewMittel(kriterien);
      if (punkte === null) { return; }
      var da = kriterien.filter(function (e) { return e.s !== null && e.s !== undefined; }).sort(function (a, b) { return b.s - a.s; });
      var text = (da[0].s >= 60 ? "Stärke: " : "Noch am besten: ") + da[0].fakt + ".";
      var schwach = da[da.length - 1];
      if (da.length > 1 && schwach.s < 60) { text += (schwach.s < 40 ? " Schwäche: " : " Schwächer: ") + schwach.fakt + "."; }
      else if (da.length === 1) { text = da[0].fakt.charAt(0).toUpperCase() + da[0].fakt.slice(1) + "."; }
      var note = noteVon(punkte);
      kat.push({ titel: titel, gewicht: gewicht, punkte: Math.round(punkte), note: note, wort: noteWort(note), farbe: bewertungFarbe(punkte), text: text,
                 kriterien: da.map(function (e) { return { name: e.name, punkte: Math.round(e.s), fakt: e.fakt }; }) });
    }

    // 1. Mobilität
    var bus = K.busNaechste;
    var park = K.mob ? Math.min(K.mob.parkplatz ? K.mob.parkplatz.naechste : Infinity, K.mob.parkhaus ? K.mob.parkhaus.naechste : Infinity) : undefined;
    var lader = K.mob && K.mob.lader ? K.mob.lader.naechste : undefined;
    var auto = gewMittel([{ s: lin(park, 800, 200), g: 1 }, { s: lin(lader, 1500, 400), g: 1 }]);
    kategorie("Mobilität", 0.25, [
      { name: "Haltestelle", g: 0.35, s: bus === undefined ? null : (isFinite(bus) ? lin(bus, 800, 200) : 0), fakt: isFinite(bus) ? "nächste Bushaltestelle in ca. " + meter10(bus) : "keine Bushaltestelle in den Daten" },
      { name: "Takt", g: 0.25, s: bus === undefined ? null : (K.takt400 === undefined ? 0 : lin(K.takt400, 0, 6)), fakt: K.takt400 === undefined ? "keine Haltestelle mit Fahrplan im 400-m-Umkreis" : "bis zu " + z(K.takt400, 1) + " Abfahrten pro Stunde im 400-m-Umkreis" },
      { name: "Radwege", g: 0.25, s: K.mob && K.mob.radweg ? lin(K.mob.radweg.l1, 0, 1000) : null, fakt: K.mob && K.mob.radweg ? "etwa " + z(Math.round(K.mob.radweg.l1 / 10) * 10) + " m Radwege im 400-m-Umkreis" : "" },
      { name: "Parken und Laden", g: 0.15, s: auto, fakt: "Parkplatz in ca. " + (isFinite(park) ? meter10(park) : "?") + ", Ladestation in ca. " + (lader !== undefined && isFinite(lader) ? meter10(lader) : "?") }
    ]);
    // 2. Versorgung im Alltag
    var E = K.einr || {};
    function nah(id, schlecht, gut, name, g) { return { name: name, g: g, s: E[id] ? lin(E[id].naechste, schlecht, gut) : null, fakt: E[id] && isFinite(E[id].naechste) ? name + ": nächster in ca. " + meter10(E[id].naechste) : name + ": nichts in den Daten" }; }
    var summe = Object.keys(E).reduce(function (s, id) { return s + E[id].n2; }, 0);
    kategorie("Versorgung im Alltag", 0.25, [
      nah("laeden", 800, 150, "Läden", 0.3), nah("schulen", 1000, 200, "Schulen und Kitas", 0.2), nah("aerzte", 1000, 250, "Ärzte und Apotheken", 0.2), nah("freizeit", 800, 150, "Freizeit und Kultur", 0.15),
      { name: "Vielfalt", g: 0.15, s: Object.keys(E).length ? lin(summe, 0, 60) : null, fakt: z(summe) + " Einrichtungen im 800-m-Umkreis" }
    ]);
    // 3. Grün und Freiraum
    var A = K.anteil || {};
    kategorie("Grün und Freiraum", 0.15, [
      { name: "Grünflächen", g: 0.4, s: A.parks ? lin(A.parks.a1, 0, 0.2) : null, fakt: A.parks ? prozent(A.parks.a1) + " Grünflächen im 400-m-Umkreis" : "" },
      { name: "Spielplatz", g: 0.2, s: K.spiel ? lin(K.spiel.naechste, 700, 150) : null, fakt: K.spiel && isFinite(K.spiel.naechste) ? "Spielplatz in ca. " + meter10(K.spiel.naechste) : "kein Spielplatz in den Daten" },
      { name: "Wald und Wasser", g: 0.2, s: A.wald && A.wasser ? lin(A.wald.a1 + A.wasser.a1, 0, 0.1) : null, fakt: A.wald && A.wasser ? prozent(A.wald.a1 + A.wasser.a1) + " Wald, Gehölz und Gewässer im 400-m-Umkreis" : "" },
      { name: "Bäume", g: 0.2, s: K.baeume400 === undefined ? null : lin(K.baeume400, 0, 150), fakt: z(K.baeume400 || 0) + " erfasste Bäume im 400-m-Umkreis" }
    ]);
    // 4. Umweltbelastung (hoher Wert = geringe Belastung)
    var laermP = null, laermF = "";
    if (K.laermTag !== undefined) {
      if (K.laermTag.length) {
        var kl = K.laermTag.join(","), pk = /75/.test(kl) && /ab/.test(kl) ? 0 : /70/.test(kl) ? 15 : /65/.test(kl) ? 35 : /60/.test(kl) ? 55 : 75;
        laermP = pk; laermF = "Straßenlärm am Standort " + K.laermTag.join(", ");
      } else if (K.laermAnteil400 > 0.3) { laermP = 85; laermF = "kein kartierter Straßenlärm am Standort, in der Umgebung aber teils ab 55 dB"; }
      else { laermP = 100; laermF = "kein kartierter Straßenlärm am Standort"; }
    }
    var regenP = null, regenF = "";
    if (K.regen) {
      var ex = K.regen.extrem, ag = K.regen.agw;
      if (ex || ag) {
        regenP = ex ? lin(ex.anteil, 0.5, 0) : 100; regenF = "Starkregen: " + (ex ? prozent(ex.anteil) + " des 100-m-Umfelds bei extremem Ereignis überflutet" : "keine Angabe");
        if (ex && ex.mitte >= 0) { regenP = Math.min(regenP, 20); regenF = "Starkregen: Standort bei extremem Ereignis überflutet dargestellt"; }
        if (ag && ag.mitte >= 0) { regenP = Math.min(regenP, 10); regenF = "Starkregen: Standort schon bei außergewöhnlichem Ereignis überflutet dargestellt"; }
      }
    }
    var luftG = K.luftAbstand !== undefined && K.luftAbstand > 1500 ? 0.1 : 0.25;
    kategorie("Umweltbelastung", 0.15, [
      { name: "Lärm", g: 0.4, s: laermP, fakt: laermF },
      { name: "Starkregen", g: 0.35, s: regenP, fakt: regenF },
      { name: "Luft", g: luftG, s: K.no2 === undefined || K.no2 === null ? null : lin(K.no2, 40, 10), fakt: "NO₂ " + (K.no2 === undefined || K.no2 === null ? "?" : z(K.no2, 1)) + " µg/m³ an der Messstation in ca. " + (K.luftAbstand !== undefined ? meter10(K.luftAbstand) : "?") }
    ]);
    // 5. Bebauung und Dichte unter dem Leitbild "Stadt der kurzen Wege": kompakt und dicht (aber nicht überladen), gemischte Nutzung,
    //    Alltagsziele in 5 Minuten zu Fuß, mehrgeschossig, ebenes Gelände für kurze Fußwege
    var dichte = K.ueberbaut400 === undefined ? null : (K.ueberbaut400 >= 0.35 && K.ueberbaut400 <= 0.6 ? 100 : K.ueberbaut400 < 0.35 ? lin(K.ueberbaut400, 0.1, 0.35) : 70 + 30 * lin(K.ueberbaut400, 0.75, 0.6) / 100);
    var mischung = null, mischF = "";
    if (A.wohnen && A.gewerbe && A.gemeinbedarf) {
      var wo = A.wohnen.a1, anders = A.gewerbe.a1 + A.gemeinbedarf.a1 + (A.plaetze ? A.plaetze.a1 : 0);
      mischung = lin(Math.min(wo, anders), 0, 0.25);
      mischF = "Wohnen " + prozent(wo) + ", Gewerbe, Handel, Gemeinbedarf und Plätze zusammen " + prozent(anders) + " im 400-m-Umkreis";
    }
    var ziele5 = Object.keys(E).length ? ["laeden", "schulen", "aerzte", "freizeit"].filter(function (id) { return E[id] && E[id].n1 >= 1; }).length : null;
    kategorie("Bebauung und Dichte (Stadt der kurzen Wege)", 0.1, [
      { name: "Kompaktheit", g: 0.3, s: dichte, fakt: K.ueberbaut400 === undefined ? "" : prozent(K.ueberbaut400) + " der Fläche im 400-m-Umkreis überbaut (kompakt ab etwa 35 %)" },
      { name: "Nutzungsmischung", g: 0.3, s: mischung, fakt: mischF },
      { name: "Alltagsziele in 5 Minuten", g: 0.2, s: ziele5 === null ? null : ziele5 * 25, fakt: ziele5 === null ? "" : ziele5 + " von 4 Zielgruppen (Läden, Schule/Kita, Arzt, Freizeit) im 400-m-Umkreis" },
      { name: "Geschossigkeit", g: 0.1, s: K.traufeHaupt === undefined ? null : lin(K.traufeHaupt, 4, 9), fakt: K.traufeHaupt === undefined ? "" : "Traufhöhe der Hauptgebäude (ab 50 m² Grundfläche) im Median " + z(K.traufeHaupt, 1) + " m" },
      { name: "Gelände", g: 0.1, s: K.hoeheDiff400 === undefined ? null : 30 + 0.7 * lin(K.hoeheDiff400, 15, 2), fakt: K.hoeheDiff400 === undefined ? "" : "Höhenunterschied " + z(K.hoeheDiff400, 1) + " m im 400-m-Umkreis" }
    ]);    // 6. Planung und Schutz
    var sg = K.schutz || {}, namen = { nsg: "Naturschutzgebiet", lsg: "Landschaftsschutzgebiet", biotope: "geschütztes Biotop", wallhecken: "Wallhecke" }, schlecht = null, ws = 100;
    Object.keys(sg).forEach(function (id) {
      var d = sg[id], p = d === 0 ? 20 : d <= 100 ? 50 : d <= 300 ? 75 : 100;
      if (p < ws) { ws = p; schlecht = id; }
    });
    kategorie("Planung und Schutz", 0.1, [
      { name: "Schutzgebiete", g: 0.7, s: Object.keys(sg).length ? ws : null, fakt: schlecht ? namen[schlecht] + (sg[schlecht] === 0 ? " am Standort" : " in ca. " + meter10(sg[schlecht])) : "kein Schutzgebiet im 300-m-Umkreis" },
      { name: "Bebauungsplan", g: 0.3, s: K.bplan === undefined ? null : (K.bplan ? 70 : 100), fakt: K.bplan ? "Bebauungsplan vorhanden, Festsetzungen sind zu prüfen" : "kein Bebauungsplan-Umriss am Standort" }
    ]);
    var gesamt = null;
    var gs = 0, gg = 0;
    kat.forEach(function (k) { gs += k.punkte * k.gewicht; gg += k.gewicht; });
    if (gg) { var gp = gs / gg, gn = noteVon(gp); gesamt = { punkte: Math.round(gp), note: gn, wort: noteWort(gn), farbe: bewertungFarbe(gp) }; }
    return { gesamt: gesamt, kategorien: kat,
             hinweis: "Die Noten sind eine Orientierung aus offenen Daten und festen Schwellen (100 Punkte = Note 1, 0 Punkte = Note 6), keine Wertermittlung und keine Eignungsaussage. Bebauung und Dichte folgt dem Leitbild der „Stadt der kurzen Wege“ (kompakt, gemischt, Alltagsziele zu Fuß erreichbar). Was die Daten nicht kennen, zählt nicht mit." };
  }
  function noteText(n) { return z(n, 1); }
  function kritText(c) { return (c.fakt.indexOf(c.name) === 0 ? c.fakt : c.name + ": " + c.fakt) + " (" + c.punkte + " von 100 Punkten)"; }

  // Die Bewertung als Block in der App (Noten und Balken)
  function bewertungAnzeigen(behaelter, b) {
    behaelter.innerHTML = "";
    if (!b || !b.gesamt) { behaelter.hidden = true; return; }
    behaelter.hidden = false;
    function el(tag, text, css) { var e = document.createElement(tag); if (text) { e.textContent = text; } if (css) { e.style.cssText = css; } return e; }
    var kopf = el("div", null, "display:flex;align-items:baseline;gap:10px;margin:2px 0 8px");
    kopf.appendChild(el("span", noteText(b.gesamt.note), "font-size:30px;font-weight:700;color:#" + b.gesamt.farbe + ";line-height:1"));
    kopf.appendChild(el("span", "Gesamtnote · " + b.gesamt.wort, "font-size:13px;font-weight:700"));
    behaelter.appendChild(kopf);
    b.kategorien.forEach(function (k) {
      var z1 = el("div", null, "margin:0 0 9px");
      var zeile = el("div", null, "display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-bottom:2px");
      zeile.appendChild(el("strong", k.titel)); zeile.appendChild(el("span", noteText(k.note) + " · " + k.wort, "font-weight:700;color:#" + k.farbe));
      var rahmen = el("div", null, "height:7px;background:#e4e1da;border:1px solid #cdc9c0");
      rahmen.appendChild(el("div", null, "height:100%;width:" + k.punkte + "%;background:#" + k.farbe));
      z1.appendChild(zeile); z1.appendChild(rahmen); z1.appendChild(el("div", k.text, "font-size:11px;color:#77746d;line-height:1.4;margin-top:2px"));
      behaelter.appendChild(z1);
    });
    behaelter.appendChild(el("div", b.hinweis, "font-size:11px;color:#77746d;line-height:1.4"));
  }

  window.entwurf = {
    // format: "txt", "docx" oder "pdf"; gibt eine Datei (Blob) zurück
    bewertungZeigen: function (behaelter) { bewertungAnzeigen(behaelter, window.entwurf.letztes ? bewerten(window.entwurf.letztes) : null); },
    datei: function (text, format, titel) {
      // Word und PDF: das lesbare Standortprofil (aus den Daten der letzten Erstellung); ohne Daten der reine Text
      if (format === "docx") { return window.entwurf.letztes ? docxProfil(profilModell(window.entwurf.letztes)) : docxBauen(text, titel); }
      if (format === "pdf") { return window.entwurf.letztes ? pdfProfil(profilModell(window.entwurf.letztes)) : pdfBauen(text, titel); }
      return new Blob([text], { type: "text/plain;charset=utf-8" });
    },
    // opt: { aufgabe, flaeche, nutzer, geschosse, wuensche, hoehen (bool), starkregen (bool) }; melde(text) zeigt den Fortschritt
    erstellen: function (opt, melde) {
      if (!window.marker) { return Promise.reject(new Error("Adresse fehlt")); }
      return sammeln(opt, melde).then(function (t) { window.entwurf.letztes = t; return zusammenbauen(t); });
    }
  };
})();
