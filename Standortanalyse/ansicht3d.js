/* =====================================================================
   3D-Ansicht (Schattenstudie)
   Wird erst beim ersten Öffnen geladen (zusammen mit three/three.min.js und hoehen_oldenburg.js).
   Zeigt die Umgebung als Modell mit vereinfachten Dachformen (Gebäudehöhen und Dachformen: LGLN, CC BY 4.0), die eigenen Baukörper aus der
   Zeichnung (Flächen mit Höhe) und den Schatten der Sonne zu einem wählbaren Tag und einer Uhrzeit.
   Greift auf die Daten der Hauptseite zu (marker, zeichnung, erstelleKartenbild, ...).
   ===================================================================== */
(function () {
  "use strict";

  var QUELLE_HOEHEN = "Gebäudehöhen: LGLN (2024), CC BY 4.0";
  var QUELLE_KARTE = "Grundrisse und Karte: © OpenStreetMap-Mitwirkende";
  var TEXTUR_PIXEL = 2048;                       // Kantenlänge des Bodenbildes
  var MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  var HIMMELSRICHTUNGEN = ["Nord", "Nordost", "Ost", "Südost", "Süd", "Südwest", "West", "Nordwest"];

  var zustand = null;       // alles, was nur bei geöffneter Ansicht existiert
  var gebaeudeListe = null; // entpackte Gebäude mit Höhen (einmal)

  // ---------- Sonne ----------
  // Sommerzeit in Deutschland: von letztem Sonntag im März bis letztem Sonntag im Oktober (jeweils 1 Uhr UTC)
  function letzterSonntag(jahr, monat0) {
    var d = new Date(Date.UTC(jahr, monat0 + 1, 0));
    return d.getUTCDate() - d.getUTCDay();
  }
  function zeitverschiebung(jahr, monat, tag, stunde) {
    var start = Date.UTC(jahr, 2, letzterSonntag(jahr, 2), 1);
    var ende = Date.UTC(jahr, 9, letzterSonntag(jahr, 9), 1);
    var utc = Date.UTC(jahr, monat - 1, tag, stunde) - 3600e3;
    return (utc >= start && utc < ende) ? 2 : 1;
  }
  // Höhe und Himmelsrichtung der Sonne. Uhrzeit als Ortszeit in Stunden (z. B. 14,5 = 14:30 Uhr).
  function sonnenstand(breite, laenge, jahr, monat, tag, stunde) {
    var rad = Math.PI / 180;
    var verschiebung = zeitverschiebung(jahr, monat, tag, stunde);
    var utcStunde = stunde - verschiebung;
    var n = Math.round((Date.UTC(jahr, monat - 1, tag) - Date.UTC(jahr, 0, 1)) / 864e5) + 1;
    var g = 2 * Math.PI / 365 * (n - 1 + (utcStunde - 12) / 24);
    var dek = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) +
              0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var zeitgleichung = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var sonnenzeit = utcStunde + laenge / 15 + zeitgleichung / 60;
    var h = (sonnenzeit - 12) * 15 * rad;
    var phi = breite * rad;
    var sinHoehe = Math.sin(phi) * Math.sin(dek) + Math.cos(phi) * Math.cos(dek) * Math.cos(h);
    var hoehe = Math.asin(Math.max(-1, Math.min(1, sinHoehe)));
    var az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(dek) * Math.cos(phi)) + Math.PI;   // von Norden im Uhrzeigersinn
    return { hoehe: hoehe, azimut: az, sommerzeit: verschiebung === 2 };
  }
  // Aufgang und Untergang (Ortszeit in Stunden) durch Absuchen des Tages
  function sonnenZeiten(breite, laenge, jahr, monat, tag) {
    var auf = null, unter = null, vorher = sonnenstand(breite, laenge, jahr, monat, tag, 0).hoehe;
    for (var m = 1; m <= 1440; m++) {
      var s = sonnenstand(breite, laenge, jahr, monat, tag, m / 60).hoehe;
      if (vorher <= -0.0145 && s > -0.0145 && auf === null) { auf = m / 60; }
      if (vorher > -0.0145 && s <= -0.0145) { unter = m / 60; }
      vorher = s;
    }
    return { auf: auf, unter: unter };
  }
  function uhrzeit(stunden) {
    var min = Math.round(stunden * 60);
    var h = Math.floor(min / 60) % 24, m = min % 60;
    return h + ":" + (m < 10 ? "0" : "") + m;
  }
  function richtungsname(azimut) {
    var grad = ((azimut * 180 / Math.PI) % 360 + 360) % 360;
    return HIMMELSRICHTUNGEN[Math.round(grad / 45) % 8];
  }
  function datumText(jahr, monat, tag) { return tag + ". " + MONATE[monat - 1] + " " + jahr; }

  // ---------- Daten ----------
  function entpacke() {
    if (gebaeudeListe) { return gebaeudeListe; }
    var roh = window.HOEHEN_OLDENBURG;
    var e = roh.einheit;
    var ab = roh.version >= 2 ? 4 : 2;      // ab Version 2: [Traufe, First, Dachklasse, Winkel, Ring, ...]
    gebaeudeListe = roh.gebaeude.map(function (g) {
      var ringe = [];
      for (var i = ab; i < g.length; i++) {
        var r = g[i], f = new Float64Array(r.length);
        var la = 0, lo = 0;
        for (var k = 0; k < r.length; k += 2) {
          la = k === 0 ? r[0] : la + r[k];
          lo = k === 0 ? r[1] : lo + r[k + 1];
          f[k] = la * e; f[k + 1] = lo * e;
        }
        ringe.push(f);
      }
      var a = ringe[0], cla = 0, clo = 0, n = a.length / 2;
      for (var j = 0; j < a.length; j += 2) { cla += a[j]; clo += a[j + 1]; }
      return { t: g[0] / 10, f: g[1] / 10, cls: ab === 4 ? g[2] : 0, ang: ab === 4 ? g[3] : 0, ringe: ringe, lat: cla / n, lng: clo / n };
    });
    window.HOEHEN_OLDENBURG = null;
    return gebaeudeListe;
  }

  function imVieleck(x, y, pkt) {     // pkt = [x0, y0, x1, y1, ...]
    var innen = false;
    for (var i = 0, j = pkt.length - 2; i < pkt.length; j = i, i += 2) {
      var xi = pkt[i], yi = pkt[i + 1], xj = pkt[j], yj = pkt[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) { innen = !innen; }
    }
    return innen;
  }

  // ---------- Oberfläche ----------
  var STIL = [
    ".a3d{position:fixed;inset:34px 0 0 0;z-index:5000;display:flex;background:var(--papier);font-family:var(--schrift);color:var(--tinte)}",
    ".a3d input[type=date]{width:100%;padding:9px 10px;font-size:14px;font-family:inherit;color:var(--tinte);background:var(--feld);border:1px solid var(--tinte);border-radius:0}",
    ".a3d .abschnitt:last-of-type{border-bottom:none}",
    ".a3d .kopf h1{font-size:20px}",
    ".a3d .a3d-flaeche{position:relative;flex:1;min-width:0;background:#e9e7e2}",
    ".a3d .a3d-leisteknopf{position:absolute;left:0;top:50%;transform:translateY(-50%);z-index:6;width:16px;height:52px;margin:0;padding:0;border:1px solid #e6e6e6;border-left:none;background:#fcfcfc;color:transparent;font-size:0;line-height:0;cursor:pointer}",
    ".a3d .a3d-leisteknopf::before{content:\"\";position:absolute;left:50%;top:50%;width:8px;height:10px;transform:translate(-50%,-50%);background:#8b8b8b;-webkit-mask:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%208%2010%27%3E%3Cpolygon%20points=%276.6,1.3%206.6,8.7%201.2,5%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E') center/100% 100% no-repeat;mask:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%208%2010%27%3E%3Cpolygon%20points=%276.6,1.3%206.6,8.7%201.2,5%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E') center/100% 100% no-repeat}",
    ".a3d .a3d-leisteknopf.zu::before{-webkit-mask-image:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%208%2010%27%3E%3Cpolygon%20points=%271.4,1.3%201.4,8.7%206.8,5%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E');mask-image:url('data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%208%2010%27%3E%3Cpolygon%20points=%271.4,1.3%201.4,8.7%206.8,5%27%20fill=%27black%27%20stroke=%27black%27%20stroke-width=%271.4%27%20stroke-linejoin=%27round%27/%3E%3C/svg%3E')}",
    ".a3d .a3d-leisteknopf:hover{background:#ececec;border-color:#e6e6e6;color:transparent}",
    ".a3d .a3d-leisteknopf:hover::before{background:#505050}",
    ".a3d .a3d-leisteknopf:active{background:#787878}",
    ".a3d .a3d-leisteknopf:active::before{background:#fff}",
    ".a3d.leiste-zu .a3d-leiste{display:none}",
    ".a3d canvas.a3d-bild{display:block;width:100%;height:100%;touch-action:none;cursor:grab}",
    ".a3d canvas.a3d-bild.zieht{cursor:grabbing}",
    ".a3d canvas.a3d-bild.messen{cursor:crosshair}",
    ".a3d canvas.a3d-ueber{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}",
    ".a3d .a3d-liste li button{width:auto;flex:0 0 auto;margin:0;padding:2px 8px;line-height:1.3}",
    ".a3d .a3d-liste li.mess{align-items:flex-start;white-space:normal}",
    ".a3d .a3d-liste li.mess span.n{white-space:pre-line;overflow:visible}",
    ".a3d .a3d-liste li.mess i{margin-top:3px}",
    ".a3d .a3d-gruppe{margin-top:14px;border-top:1px solid var(--linie);padding-top:10px}",
    ".a3d .a3d-gruppe>.gruppentitel{margin-bottom:6px}",
    ".a3d input[type=range]{width:100%}",
    ".a3d .a3d-punktinfo{position:absolute;z-index:5;background:rgba(245,243,238,.97);border:1px solid var(--tinte);box-shadow:0 2px 8px rgba(0,0,0,.25);padding:8px 24px 8px 10px;font-size:12px;line-height:1.45;max-width:270px;pointer-events:auto}",
    ".a3d .a3d-punktinfo[hidden]{display:none}",
    ".a3d .a3d-punktinfo .zu{position:absolute;top:2px;right:4px;border:0;background:none;width:auto;padding:0 4px;font-size:14px;cursor:pointer;color:var(--grau)}",
    ".a3d .a3d-info{position:absolute;left:12px;bottom:12px;background:rgba(245,243,238,.92);border:1px solid var(--tinte);padding:6px 10px;font-size:13px;line-height:1.45;max-width:70%}",
    ".a3d .a3d-nord{position:absolute;right:14px;top:14px;width:46px;height:46px;border:1px solid var(--tinte);border-radius:50%;background:rgba(245,243,238,.92)}",
    ".a3d .a3d-nord span{position:absolute;left:50%;top:50%;width:0;height:0;margin:-17px 0 0 -6px;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:34px solid var(--rot);transform-origin:50% 17px}",
    ".a3d .a3d-nord b{position:absolute;left:0;right:0;top:-1px;text-align:center;font-size:11px;color:var(--tinte)}",
    ".a3d .a3d-status{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(245,243,238,.95);border:1px solid var(--tinte);padding:10px 16px;font-size:14px}",
    ".a3d .a3d-legende{position:absolute;right:12px;bottom:12px;background:rgba(245,243,238,.94);border:1px solid var(--tinte);padding:8px 10px;font-size:12px;line-height:1.5}",
    ".a3d .a3d-legende[hidden]{display:none}",
    ".a3d .a3d-legende .a3d-leg-titel{font-weight:700;margin-bottom:4px}",
    ".a3d .a3d-legende i{display:inline-block;width:16px;height:11px;margin-right:7px;border:1px solid rgba(0,0,0,.3);vertical-align:-1px}",
    ".a3d .a3d-liste{margin:6px 0 0;padding:0;list-style:none}",
    ".a3d .a3d-liste li{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px}",
    ".a3d .a3d-liste li span.n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".a3d .a3d-liste input[type=number]{width:70px}",
    ".a3d .a3d-liste i{display:inline-block;width:12px;height:12px;border:1px solid var(--tinte)}",
    ".a3d .a3d-datumknoepfe{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}",
    ".a3d .a3d-datumknoepfe button{padding:6px 4px}"
  ].join("\n");

  var HTML = [
    '<div class="seitenleiste a3d-leiste">',
    '  <header class="kopf">',
    '    <h1>3D-Ansicht</h1>',
    '    <p class="untertitel">Schattenstudie</p>',
    '    <div class="knopfreihe" style="margin-top:12px"><button type="button" id="a3dZu" class="zweit">Zurück zur Karte</button></div>',
    '  </header>',

    '  <details class="abschnitt" open>',
    '    <summary><span class="nr">01</span> Sonne</summary>',
    '    <div class="inhalt">',
    '      <div class="gruppentitel">Datum</div>',
    '      <input type="date" id="a3dDatum" autocomplete="off" aria-label="Datum">',
    '      <div class="a3d-datumknoepfe">',
    '        <button type="button" class="zweit" data-tag="3-21">21. März</button><button type="button" class="zweit" data-tag="6-21">21. Juni</button>',
    '        <button type="button" class="zweit" data-tag="9-23">23. September</button><button type="button" class="zweit" data-tag="12-21">21. Dezember</button>',
    '      </div>',
    '      <div class="gruppentitel" style="margin-top:14px">Uhrzeit: <strong id="a3dZeitText"></strong></div>',
    '      <input type="range" id="a3dZeit" min="0" max="1440" step="5" value="720" autocomplete="off" aria-label="Uhrzeit">',
    '      <div class="knopfreihe" style="margin-top:8px"><button type="button" id="a3dPlay" class="zweit">▶ Tag abspielen</button><button type="button" id="a3dMittag" class="zweit">Sonnenmittag</button></div>',
    '      <label class="haken"><input type="checkbox" id="a3dSchatten" checked autocomplete="off"> Schatten zeigen</label>',
    '      <p class="hinweis">Die Uhrzeit ist die Ortszeit (im Sommer mit Sommerzeit).</p>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">02</span> Bewegen</summary>',
    '    <div class="inhalt">',
    '      <div class="gruppentitel">Mit der Maus</div>',
    '      <p class="hinweis" style="margin-top:0">Ziehen = drehen. Rechtsklick ziehen (oder Umschalt + ziehen) = verschieben. Mausrad = zoomen.</p>',
    '      <div class="gruppentitel" style="margin-top:12px">Ansicht wählen</div>',
    '      <div class="knopfreihe"><button type="button" id="a3dDraufsicht" class="zweit">Von oben</button><button type="button" id="a3dSued" class="zweit">Von Süden</button></div>',
    '      <div class="knopfreihe" style="margin-top:6px"><button type="button" id="a3dSchraeg" class="zweit">Schräg (Start)</button></div>',
    '      <div class="gruppentitel" style="margin-top:12px">Darstellung</div>',
    '      <select id="a3dKamera" autocomplete="off" aria-label="Darstellung"><option value="persp" selected>Perspektive</option><option value="ortho">Parallel (ohne Verkürzung)</option></select>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">03</span> Modell</summary>',
    '    <div class="inhalt">',
    '      <div class="gitter">',
    '        <div><label for="a3dRadius">Ausschnitt</label><select id="a3dRadius" autocomplete="off"><option value="250">250 m</option><option value="400" selected>400 m</option><option value="600">600 m</option><option value="800">800 m</option><option value="1500">1,5 km</option><option value="3000">3 km</option><option value="5000">5 km</option></select></div>',
    '        <div><label for="a3dHoehenart">Gebäudehöhe</label><select id="a3dHoehenart" autocomplete="off"><option value="dach" selected>Mit Dachformen (vereinfacht)</option><option value="mittel">Flach auf Mitte Traufe/First</option><option value="first">bis zum First</option><option value="trauf">bis zur Traufe</option></select></div>',
    '      </div>',
    '      <label class="haken"><input type="checkbox" id="a3dGelaende" checked autocomplete="off"> Gelände (Höhenmodell des Landes, 5 m Raster)</label>',
    '      <label class="haken"><input type="checkbox" id="a3dKarte" checked autocomplete="off"> Karte auf dem Boden (wie in der Karte eingestellt)</label>',
    '      <label class="haken"><input type="checkbox" id="a3dAusblenden" checked autocomplete="off"> Bestand unter eigenen Baukörpern ausblenden</label>',
    '      <button type="button" id="a3dNeu" class="zweit" style="margin-top:6px">Modell neu aufbauen</button>',
    '      <p class="hinweis" id="a3dModellInfo"></p>',
    '      <p class="hinweis">Dächer sind vereinfacht: Sattel-, Walm-, Zelt- und Pultdächer entstehen aus den Dachformen der Landesdaten (Gauben, Krüppelwalme und Mansarden werden nicht abgebildet; unregelmäßige Grundrisse bleiben flach). Die Höhen sind amtliche Messwerte mit etwa 1 bis 5 m Genauigkeit. Quelle: Gebäudehöhen LGLN (2024), CC BY 4.0. Das Gelände folgt dem Höhenmodell des Landes (5 m Raster, Quelle: LGLN DGM1, CC BY 4.0); Gebäude, Bäume und Wälder stehen darauf.</p>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">04</span> Analysedaten</summary>',
    '    <div class="inhalt">',
    '      <p class="hinweis" style="margin-top:0">Dieselben Schalter wie in „04 Analysedaten“ der Karte: Was du hier schaltest, gilt auch dort. Flächen und Linien liegen auf dem Boden, Haltestellen und Einrichtungen stehen als Pfähle mit Kugel im Modell. Klicke eine Kugel an (kein Messwerkzeug gewählt): Bei Haltestellen siehst du Name, Linien und Abfahrten, bei Ladestationen Betreiber und Leistung.</p>',
    '      <div class="knopfreihe" style="margin-bottom:6px">',
    '        <button type="button" id="a3dAnalyseAn" class="zweit">Alles einschalten</button>',
    '        <button type="button" id="a3dAnalyseAus" class="zweit">Alles ausschalten</button>',
    '      </div>',
    '      <div class="gruppentitel" style="margin-top:12px">Darstellung auf dem Boden</div>',
    '      <label for="a3dFarbstaerke">Farbstärke der Flächen: <strong id="a3dFarbstaerkeText"></strong></label>',
    '      <input type="range" id="a3dFarbstaerke" min="0" max="100" step="5" value="35" autocomplete="off">',
    '      <label for="a3dBodenHell" style="margin-top:10px">Helligkeit des Bodens: <strong id="a3dBodenHellText"></strong></label>',
    '      <input type="range" id="a3dBodenHell" min="0" max="80" step="2" value="28" autocomplete="off">',
    '      <button type="button" id="a3dFarbenStandard" class="zweit" style="margin-top:6px">Standardwerte</button>',
    '      <div id="a3dAnalyse" style="margin-top:6px"></div>',
    '      <p class="hinweis" id="a3dAnalyseHinweis"></p>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">05</span> Sonnenstunden</summary>',
    '    <div class="inhalt">',
    '      <p class="hinweis" style="margin-top:0">Rechnet für jede Stelle, wie viele Stunden am Tag im Jahresmittel direkte Sonne ankommt: 12 Monatstage, alle 10 Minuten, mit Gebäuden, Bäumen (Belaubung je Monat) und Wäldern. Ohne Wolken. Am Rand des Ausschnitts fehlen Schatten von Gebäuden außerhalb.</p>',
    '      <div class="gruppentitel">Was gefärbt wird</div>',
    '      <label class="haken" style="margin-top:0"><input type="checkbox" id="a3dSonneDach" checked autocomplete="off"> Dächer</label>',
    '      <label class="haken"><input type="checkbox" id="a3dSonneFassade" checked autocomplete="off"> Fassaden (bis 800 m Ausschnitt)</label>',
    '      <p class="hinweis" id="a3dSonneInfo"></p>',
    '      <button type="button" id="a3dSonneRechnen">Sonnenstunden berechnen</button>',
    '      <button type="button" id="a3dSonneStopp" class="zweit" hidden>Abbrechen</button>',
    '      <div id="a3dSonneMeldung" class="meldung" aria-live="polite"></div>',
    '      <p class="hinweis" id="a3dSonneHinweis"></p>',
    '      <div class="gruppentitel" style="margin-top:14px">Anzeige</div>',
    '      <label class="haken" style="margin-top:0"><input type="checkbox" id="a3dSonneZeigen" checked autocomplete="off"> Sonnenstunden zeigen</label>',
    '      <label for="a3dSonneDeckkraft" style="margin-top:8px">Deckkraft</label>',
    '      <input type="range" id="a3dSonneDeckkraft" min="20" max="100" step="5" value="85" autocomplete="off">',
    '      <p class="hinweis">Das Ergebnis erscheint auch in der Karte (Ebene „Sonnenstunden“ in 04 Analysedaten) und im gespeicherten Bild. Ablesen: Werkzeug „Sonnenstunden“ unter „08 Messen“.</p>',
    '    </div>',
    '  </details>',
    '  <details class="abschnitt">',
    '    <summary><span class="nr">06</span> Bäume</summary>',
    '    <div class="inhalt">',
    '      <label class="haken" style="margin-top:0"><input type="checkbox" id="a3dBaeume" checked autocomplete="off"> Bäume zeigen</label>',
    '      <label class="haken"><input type="checkbox" id="a3dBaumSchatten" checked autocomplete="off"> Bäume werfen Schatten</label>',
    '      <label class="haken"><input type="checkbox" id="a3dWald" checked autocomplete="off"> Wälder zeigen (als Baumblöcke)</label>',
    '      <label for="a3dWaldHoehe" style="margin-top:8px">Höhe der Wälder in Metern</label>',
    '      <input type="number" id="a3dWaldHoehe" min="4" max="45" step="1" value="18" autocomplete="off">',
    '      <div class="gruppentitel" style="margin-top:14px">Belaubung: <strong id="a3dLaubText"></strong></div>',
    '      <label class="haken" style="margin-top:4px"><input type="checkbox" id="a3dLaubAuto" checked autocomplete="off"> automatisch nach Datum</label>',
    '      <input type="range" id="a3dLaub" min="0" max="100" step="5" value="100" autocomplete="off" aria-label="Belaubung" style="margin-top:6px">',
    '      <p class="hinweis" id="a3dBaumInfo"></p>',
    '      <p class="hinweis" id="a3dBaumAusText" style="margin-top:0"></p>',
    '      <button type="button" id="a3dBaumAusZurueck" class="zweit" hidden>Ausgeblendete Bäume wieder einblenden</button>',
    '      <p class="hinweis" id="a3dWaldInfo"></p>',
    '      <p class="hinweis">Die Bäume stammen aus OpenStreetMap und sind nicht vollständig (vor allem Straßenbäume fehlen oft). Ohne Höhenangabe werden etwa 12 m Höhe und 8 m Krone angenommen. Eigene Bäume setzt du in der Karte unter „06 Zeichnen“ mit dem Punkt-Werkzeug und einer Höhe. Laubbäume sind im Winter kahl und werfen dann nur einen schwachen Schatten. Wälder (OpenStreetMap) werden als Baumblöcke mit gleicher Höhe gezeigt; im Winter sind sie lichter, aber nicht kahl.</p>',
    '    </div>',
    '  </details>',
    '  <details class="abschnitt">',
    '    <summary><span class="nr">07</span> Eigene Baukörper und Bäume</summary>',
    '    <div class="inhalt">',
    '      <div class="gruppentitel">Bäume hinzufügen</div>',
    '      <div class="gitter">',
    '        <div><label for="a3dNeuHoehe">Höhe in m</label><input type="number" id="a3dNeuHoehe" min="1" max="60" step="0.5" value="12" autocomplete="off"></div>',
    '        <div><label for="a3dNeuKrone">Krone in m</label><input type="number" id="a3dNeuKrone" min="0" max="40" step="0.5" value="0" autocomplete="off" title="0 = automatisch"></div>',
    '      </div>',
    '      <label for="a3dNeuArt" style="margin-top:8px">Baumart</label>',
    '      <select id="a3dNeuArt" autocomplete="off"><option value="laub" selected>Laubbaum</option><option value="nadel">Nadelbaum (immergrün)</option></select>',
    '      <div class="werkzeugreihe zwei" style="margin-top:8px">',
    '        <button type="button" class="zweit" data-mess="baumSetzen">Baum setzen</button>',
    '        <button type="button" class="zweit" data-mess="baumVerschieben">Verschieben</button>',
    '        <button type="button" class="zweit" data-mess="baumEntfernen">Entfernen</button>',
    '      </div>',
    '      <p class="hinweis" id="a3dBaumHinweis">Wähle ein Werkzeug und klicke ins Modell.</p>',
    '      <div class="gruppentitel" style="margin-top:14px">Zeichnung</div>',
    '      <p class="hinweis" style="margin-top:0">Alle Flächen, Punkte und Bäume aus „06 Zeichnen“ auf der Karte. Trage eine Höhe in Metern ein: Eine Fläche wird dann zum Baukörper, eine Säule (Werkzeug „Säule“ in „06 Zeichnen“: Kreis als Grundriss, Höhe und Durchmesser trägst du dort oder hier ein). Bäume zeichnest du mit dem Werkzeug „Baum“; Bäume, die du hier setzt, erscheinen auch in der Karte. 0 = nicht zeigen.</p>',
    '      <ul class="a3d-liste" id="a3dKoerper"></ul>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">08</span> Messen</summary>',
    '    <div class="inhalt">',
    '      <div class="gruppentitel">Werkzeug</div>',
    '      <div class="werkzeugreihe zwei">',
    '        <button type="button" class="zweit" data-mess="entfernung">Entfernung</button>',
    '        <button type="button" class="zweit" data-mess="strecke">Strecke</button>',
    '        <button type="button" class="zweit" data-mess="hoehe">Gebäudehöhe</button>',
    '        <button type="button" class="zweit" data-mess="schatten">Schatten prüfen</button>',
    '        <button type="button" class="zweit" data-mess="sonnenstunden">Sonnenstunden</button>',
    '      </div>',
    '      <p class="hinweis" id="a3dMessHinweis">Wähle ein Werkzeug und klicke ins Modell. Die Punkte rasten an Gebäudeecken ein.</p>',
    '      <button type="button" id="a3dMessFertig" class="zweit" hidden>Strecke beenden (oder Enter)</button>',
    '      <div class="gruppentitel" style="margin-top:14px">Messungen</div>',
    '      <ul class="a3d-liste" id="a3dMessListe"></ul>',
    '      <div class="knopfreihe" style="margin-top:6px"><button type="button" id="a3dMessLetzte" class="zweit">Letzte löschen</button><button type="button" id="a3dMessAlle" class="zweit">Alle löschen</button></div>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">09</span> Speichern</summary>',
    '    <div class="inhalt">',
    '      <label for="a3dFormat">Dateiformat</label>',
    '      <select id="a3dFormat" autocomplete="off">',
    '        <option value="png" selected>PNG (Bild)</option>',
    '        <option value="pdf">PDF (Bild, Papiergröße)</option>',
    '        <option value="vpdf">PDF (Vektorzeichnung)</option>',
    '        <option value="svg">SVG (Vektorzeichnung)</option>',
    '        <option value="dxf">DXF (3D-Modell für CAD)</option>',
    '      </select>',
    '      <div id="a3dFeldGroesse" style="margin-top:10px"><label for="a3dGroesse">Bildgröße</label>',
    '        <select id="a3dGroesse" autocomplete="off"><option value="1">wie auf dem Bildschirm</option><option value="2" selected>doppelt so groß</option><option value="3">dreifach (sehr groß)</option></select></div>',
    '      <div id="a3dFeldPapier" class="gitter" style="margin-top:10px" hidden>',
    '        <div><label for="a3dPapier">Papierformat</label><select id="a3dPapier" autocomplete="off"><option value="A5">A5</option><option value="A4" selected>A4</option><option value="A3">A3</option><option value="A2">A2</option><option value="A1">A1</option></select></div>',
    '        <div><label for="a3dAusrichtung">Ausrichtung</label><select id="a3dAusrichtung" autocomplete="off"><option value="quer" selected>quer</option><option value="hoch">hoch</option></select></div>',
    '      </div>',
    '      <div id="a3dFeldDpi" style="margin-top:10px" hidden><label for="a3dDpi">Auflösung</label><select id="a3dDpi" autocomplete="off"><option value="100">100 dpi</option><option value="150" selected>150 dpi</option><option value="200">200 dpi</option><option value="300">300 dpi</option></select></div>',
    '      <p class="hinweis" id="a3dSpeichernInfo"></p>',
    '      <button type="button" id="a3dSpeichern" style="margin-top:8px">Als Bild speichern</button>',
    '      <div id="a3dMeldung" class="meldung" aria-live="polite"></div>',
    '    </div>',
    '  </details>',

    '  <details class="abschnitt">',
    '    <summary><span class="nr">10</span> Hilfe</summary>',
    '    <div class="inhalt hilfe">',
    '      <h3>So gehst du vor</h3>',
    '      <ol>',
    '        <li><strong>Sonne</strong> (01): Datum wählen (oder einen der Knöpfe) und die Uhrzeit mit dem Regler einstellen. Der Schatten wandert mit. „Tag abspielen“ lässt die Sonne von morgens bis abends laufen.</li>',
    '        <li><strong>Bewegen</strong> (02): Ziehen dreht das Modell, Rechtsklick ziehen (oder Umschalt + ziehen) verschiebt es, das Mausrad zoomt. „Von oben“ zeigt den Grundriss mit Norden oben.</li>',
    '        <li><strong>Modell</strong> (03): Mit „Ausschnitt“ bestimmst du, wie viel Umgebung um den roten Punkt gezeigt wird (250 m bis 5 km).</li>',
    '        <li><strong>Analysedaten</strong> (04): Haken setzen, dann liegen zum Beispiel Grünflächen, Lärm oder die Fußwege auf dem Boden, und Haltestellen und Einrichtungen stehen als Pfähle mit farbiger Kugel im Modell. Ein Klick auf eine Kugel zeigt bei Haltestellen Name, Linien und Abfahrten (ohne gewähltes Messwerkzeug). Die Schalter sind dieselben wie in der Karte.</li>',
    '        <li><strong>Sonnenstunden</strong> (05): „Sonnenstunden berechnen“ färbt Boden, Dächer und Fassaden nach den Sonnenstunden pro Tag im Jahresmittel (Gebäude, Bäume und Wälder werfen Schatten, ohne Wolken). Rot und Orange = viel Sonne, Blau = wenig. Das Ergebnis steht auch in der Karte (Ebene „Sonnenstunden“) und im gespeicherten Bild. Die Rechnung dauert einige Sekunden bis eine halbe Minute. Mit dem Werkzeug „Sonnenstunden“ in 08 liest du einen Wert ab.</li>',
    '        <li><strong>Bäume</strong> (06): Bäume aus OpenStreetMap stehen im Modell und werfen Schatten. Wälder erscheinen als grüne Baumblöcke (Höhe einstellbar, Standard 18 m). „Belaubung“ folgt dem Datum (im Winter sind Laubbäume kahl und werfen nur einen schwachen Schatten); ohne Haken „automatisch nach Datum“ stellst du sie selbst ein.</li>',
    '        <li><strong>Eigene Baukörper und Bäume</strong> (07): Zeichne in der Karte unter „06 Zeichnen“ eine Fläche (wird ein Baukörper) und trage hier die Höhe in Metern ein. Bäume setzt du hier direkt: Höhe, Krone und Art einstellen, „Baum setzen“ wählen und ins Modell klicken. „Verschieben“ (erst den eigenen Baum, dann den neuen Standort anklicken) und „Entfernen“ (eigene Bäume werden gelöscht, Bestandsbäume ausgeblendet, zum Beispiel für eine geplante Fällung) gehören dazu. Alle Bäume, die du setzt, erscheinen auch in der Karte; in „06 Bäume“ blendest du ausgeblendete Bestandsbäume wieder ein.</li>',
    '        <li><strong>Messen</strong> (08): Werkzeug wählen und ins Modell klicken. „Entfernung“ nimmt zwei Punkte, „Strecke“ mehrere (Doppelklick oder Enter beendet), „Gebäudehöhe“ zeigt Traufe und First eines angeklickten Gebäudes, „Schatten prüfen“ sagt, wann ein Punkt Sonne bekommt, „Sonnenstunden“ liest den berechneten Jahreswert ab.</li>',
    '        <li><strong>Speichern</strong> (09): Dateiformat wählen und „Speichern“. PNG und PDF (Bild) zeigen die Ansicht wie am Bildschirm mit Datum, Uhrzeit, Sonnenstand, Analysedaten und Messungen. „PDF (Vektorzeichnung)“ und SVG sind Linienzeichnungen für Illustrator, Affinity oder Inkscape. DXF ist das 3D-Modell (Gebäude, eigene Baukörper und Bäume als 3D-Flächen in Metern) für AutoCAD, Rhino, Vectorworks, ArchiCAD.</li>',
    '      </ol>',

    '      <h3>Gut zu wissen</h3>',
    '      <ul>',
    '        <li>Die Punkte beim Messen rasten an Gebäudeecken ein. So messen auch schräge Ansichten genau.</li>',
    '        <li>Mit Esc beendest du erst die laufende Messung, dann das Werkzeug, dann die 3D-Ansicht.</li>',
    '        <li>Die Messungen gelten nur, solange die 3D-Ansicht offen ist. Speichere vorher ein Bild.</li>',
    '        <li>Die Uhrzeit ist die Ortszeit (im Sommer mit Sommerzeit).</li>',
    '        <li>Dächer sind vereinfacht: Sattel-, Walm-, Zelt- und Pultdächer nach den Landesdaten, ohne Gauben, Krüppelwalme und Mansarden; unregelmäßige Grundrisse und Gebäude mit Innenhof bleiben flach. In „03 Modell“ kannst du auf flache Klötze umschalten. Das Gelände (Haken „Gelände“ in 03) folgt dem Höhenmodell des Landes im 5-m-Raster: Deiche und Böschungen erscheinen etwas weicher als in Wirklichkeit, Brücken, Tunnel und Wasserflächen sind nicht eigens modelliert; Schatten, Schattenprüfung, Sonnenstunden und die Dateien (SVG, PDF, DXF) berücksichtigen das Gelände. In Oldenburg ist es flach (im Stadtgebiet etwa −2 bis 31 m über NHN), der Unterschied ist daher klein. Die Bäume sind nur die, die OpenStreetMap kennt (viele Straßenbäume fehlen), mit geschätzter Höhe und Krone, und werfen im Winter nur einen schwachen Schatten. Wälder sind grobe Blöcke mit einheitlicher Höhe. Die Gebäudehöhen sind amtliche Messwerte (LGLN) mit etwa 1 bis 5 m Genauigkeit.</li>',
    '        <li>Schwere Rechnungen (Modell aufbauen, Sonnenstunden, SVG, PDF und DXF) verteilt die App auf mehrere Prozessorkerne, damit die Seite dabei möglichst nicht einfriert. Geht das in deinem Browser nicht, rechnet sie wie früher allein, nur etwas langsamer.</li>',
    '        <li>Bei den Ausschnitten 3 und 5 km lässt die App sehr kleine Gebäude weg und die Schatten sind gröber. Für genaue Schattenstudien nimm höchstens 800 m.</li>',
    '      </ul>',

    '      <h3>Wenn etwas nicht klappt</h3>',
    '      <ul>',
    '        <li><strong>Das Bild bleibt schwarz oder leer:</strong> Einen kleineren Ausschnitt wählen (250 m), „Modell neu aufbauen“ drücken oder die Seite neu laden.</li>',
    '        <li><strong>Kein Gebäude zu sehen:</strong> Es gibt keine Höhendaten an dieser Stelle (zum Beispiel am äußersten Stadtrand). Ort in der Karte prüfen.</li>',
    '        <li><strong>Die Farben auf dem Boden sind zu blass oder zu grell:</strong> In „04 Analysedaten“ die Regler „Farbstärke der Flächen“ und „Helligkeit des Bodens“ verstellen. „Standardwerte“ setzt sie zurück.</li>',
    '        <li><strong>Der Boden ist grau oder ohne Karte:</strong> Haken „Karte auf dem Boden“ in 03 prüfen und „Modell neu aufbauen“ drücken. Die Flächen und Linien der Analysedaten erscheinen nur, wenn dieser Haken an ist.</li>',
    '        <li><strong>Fußweg, Wegenetz oder Sonnenstrahlen fehlen:</strong> Diese Ebenen brauchen eine gesuchte Adresse (der rote Punkt). Adresse im Reiter „Karte“ suchen und die 3D-Ansicht neu öffnen.</li>',
    '        <li><strong>Die Sonnenstunden brauchen sehr lange oder brechen ab:</strong> Einen kleineren Ausschnitt wählen (bis 800 m rechnet die App auch die Fassaden, darüber nur Boden und Dächer) oder „Fassaden“ abschalten. Ändert sich das Modell (Bäume, Baukörper), muss neu gerechnet werden.</li>',
    '        <li><strong>Eine Messung lässt sich nicht setzen:</strong> Prüfe, ob ein Werkzeug gewählt ist (es ist dunkel hinterlegt) und klicke auf eine Fläche des Modells, nicht in den leeren Himmel.</li>',
    '        <li><strong>Speichern klappt nicht:</strong> Bildgröße „wie auf dem Bildschirm“ wählen.</li>',
    '        <li><strong>Vektordatei „zu viele Flächen“:</strong> In „03 Modell“ einen kleineren Ausschnitt wählen (bis 1,5 km) oder in der Ansicht näher heranzoomen. Außerhalb des Bildes liegende Flächen werden weggelassen.</li>',
    '        <li><strong>DXF „zu groß“:</strong> Einen kleineren Ausschnitt wählen. Die Anzeige unter dem Dateiformat nennt die Zahl der Flächen und die ungefähre Dateigröße.</li>',
    '        <li><strong>Die DXF-Datei liegt weit weg vom Nullpunkt:</strong> Der Nullpunkt ist der rote Punkt. Soll das Modell zu Katasterplänen passen, es um die UTM-Werte aus dem Kopf der Datei (EPSG:25832) verschieben.</li>',
    '      </ul>',
    '      <p>Die ausführliche Anleitung steht auch in der Datei ANLEITUNG.html im Ordner „Standortanalyse“.</p>',
    '    </div>',
    '  </details>',
    '</div>',
    '<div class="a3d-flaeche" id="a3dFlaeche">',
    '  <button type="button" id="a3dLeisteKnopf" class="a3d-leisteknopf" aria-label="Seitenleiste einklappen" title="Seitenleiste einklappen"></button>',
    '  <canvas class="a3d-bild" id="a3dBild"></canvas>',
    '  <canvas class="a3d-ueber" id="a3dUeber"></canvas>',
    '  <div class="a3d-nord" id="a3dNord"><b>N</b><span></span></div>',
    '  <div class="a3d-legende" id="a3dSonneLegende" hidden></div>',
    '  <div class="a3d-punktinfo" id="a3dPunktInfo" hidden></div>',
    '  <div class="a3d-info" id="a3dInfo"></div>',
    '  <div class="a3d-status" id="a3dStatus">Wird geladen …</div>',
    '</div>'
  ].join("\n");

  // ---------- Öffnen ----------
  function oeffnen() {
    if (zustand) { return; }
    var THREE = window.THREE;
    var mitte = marker ? marker.getLatLng() : karte.getCenter();
    var z = zustand = {
      mitte: L.latLng(mitte.lat, mitte.lng),
      mLng: METER_PRO_GRAD * Math.cos(mitte.lat * Math.PI / 180),
      mLat: METER_PRO_GRAD,
      datum: null,        // { j, m, t }
      zeit: 14,           // Ortszeit in Stunden
      schmutz: true,      // Modell muss neu gebaut werden
      neuZeichnen: true,
      theta: 0.5, pol: 0.95, dist: 700, ziel: new THREE.Vector3(0, 0, 0),
      kamera: "persp", spielt: false, radius: 400,
      koerper: [], hk: null, messungen: [], werkzeug: null, messEntwurf: null, messNr: 0,
      gelaende: false, gelBasis: 0, gelMax: 0, gelFehler: "", gh: function () { return 0; }, ghAbs: function () { return 0; },
      bodenToken: 0, punktToken: 0, punktAnzahl: 0, analyse: [], analyseTimer: null,
      baumToken: 0, baeume: [], baumGitter: null, baumMaterial: null, baumAnzahlEigen: 0,
      waldToken: 0, waelder: [], waldKarte: null, waldMaterial: null,
      sonnenErgebnis: null, sonneArbeiter: [], sonneAbbruch: null
    };

    var style = document.createElement("style");
    style.textContent = STIL;
    var wurzel = document.createElement("div");
    wurzel.className = "a3d";
    wurzel.innerHTML = HTML;
    document.body.appendChild(style);
    document.body.appendChild(wurzel);
    z.style = style; z.wurzel = wurzel;
    function el(id) { return wurzel.querySelector("#" + id); }
    z.el = el;

    // Startdatum: heute, sonst der 21. Juni
    var heute = new Date();
    z.datum = { j: heute.getFullYear(), m: heute.getMonth() + 1, t: heute.getDate() };
    // Startuhrzeit: 14 Uhr, aber 12 Uhr Sonnenmittag im Winter bringt auch nur wenig – 14 Uhr zeigt Schatten gut
    el("a3dDatum").value = z.datum.j + "-" + ("0" + z.datum.m).slice(-2) + "-" + ("0" + z.datum.t).slice(-2);
    el("a3dZeit").value = String(z.zeit * 60);

    // Darstellung
    z.bild = el("a3dBild");
    z.renderer = new THREE.WebGLRenderer({ canvas: z.bild, antialias: true, preserveDrawingBuffer: false });
    z.renderer.shadowMap.enabled = true;
    z.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    z.szene = new THREE.Scene();
    z.hemi = new THREE.HemisphereLight(0xffffff, 0xb8b5ad, 0.55);
    z.szene.add(z.hemi);
    z.sonne = new THREE.DirectionalLight(0xfff4e0, 0.95);
    z.sonne.castShadow = true;
    z.sonne.shadow.bias = -0.0004;
    z.sonne.shadow.normalBias = 0.6;
    z.szene.add(z.sonne);
    z.szene.add(z.sonne.target);
    z.persp = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    z.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);

    z.modell = new THREE.Group();
    z.szene.add(z.modell);
    z.punktGruppe = new THREE.Group();      // Pfähle der Punkte (Haltestellen, Einrichtungen); nicht Teil des Messmodells
    z.szene.add(z.punktGruppe);
    z.baumGruppe = new THREE.Group();       // Bäume (Stämme und Kronen)
    z.szene.add(z.baumGruppe);
    analyseBauen();
    z.waldGruppe = new THREE.Group();       // Wälder (Baumblöcke)
    z.szene.add(z.waldGruppe);
    z.sonnenGruppe = new THREE.Group();     // Sonnenstunden: farbige Flächen auf Boden, Dächern und Fassaden
    z.szene.add(z.sonnenGruppe);
    el("a3dSonneInfo").textContent = sonneInfoText();
    el("a3dSonneRechnen").addEventListener("click", sonneStarten);
    el("a3dSonneStopp").addEventListener("click", function () { if (typeof z.sonneAbbruch === "function") { z.sonneAbbruch(); } });
    el("a3dSonneFassade").addEventListener("change", function () { el("a3dSonneInfo").textContent = sonneInfoText(); });
    el("a3dSonneZeigen").addEventListener("change", sonneAktualisierenAnzeige);
    el("a3dSonneDeckkraft").addEventListener("input", sonneAktualisierenAnzeige);
    el("a3dBaumAusZurueck").addEventListener("click", function () { baumAus = {}; baumNeuLaden(); });
    el("a3dBaeume").addEventListener("change", function () { baeumeSichtbar(); messSchattenAktualisieren(); zeichne(); });
    el("a3dBaumSchatten").addEventListener("change", function () { baeumeSichtbar(); waldSichtbar(); messSchattenAktualisieren(); zeichne(); });
    el("a3dWald").addEventListener("change", function () { waldSichtbar(); messSchattenAktualisieren(); zeichne(); });
    el("a3dWaldHoehe").addEventListener("change", function () { waldAufbauen(); });
    el("a3dLaubAuto").addEventListener("change", function () { el("a3dLaub").disabled = el("a3dLaubAuto").checked; laubAuto(); laubAnwenden(); messSchattenAktualisieren(); zeichne(); });
    el("a3dLaub").addEventListener("input", function () { laubAnwenden(); messSchattenAktualisieren(); zeichne(); });
    laubAuto();

    // Ereignisse
    el("a3dZu").addEventListener("click", verbergen);
    el("a3dLeisteKnopf").addEventListener("click", function () {       // Seitenleiste der 3D-Ansicht ein- und ausklappen (die Ansicht passt sich über den ResizeObserver an)
      var zu = wurzel.classList.toggle("leiste-zu"), k = el("a3dLeisteKnopf"), text = zu ? "Seitenleiste ausklappen" : "Seitenleiste einklappen";
      k.classList.toggle("zu", zu); k.title = text; k.setAttribute("aria-label", text);
    });
    z.tasten = function (ev) {
      if (z.versteckt) { return; }                 // die Karte ist gerade vorn: Tasten gehören ihr
      if (ev.key === "Escape") {
        // erst die laufende Messung abbrechen, dann das Werkzeug ablegen, erst dann die Ansicht schließen
        if (z.messEntwurf) { z.messEntwurf = null; messHinweis(); zeichne(); }
        else if (z.werkzeug) { messWerkzeug(null); }
        else { verbergen(); }
      } else if (ev.key === "Enter" && z.werkzeug === "strecke") { messStreckeBeenden(); }
    };
    document.addEventListener("keydown", z.tasten);
    el("a3dDatum").addEventListener("change", function () {
      var teile = el("a3dDatum").value.split("-");
      if (teile.length === 3) { z.datum = { j: +teile[0], m: +teile[1], t: +teile[2] }; sonneAnwenden(); }
    });
    Array.prototype.forEach.call(wurzel.querySelectorAll("[data-tag]"), function (b) {
      b.addEventListener("click", function () {
        var p = b.dataset.tag.split("-");
        z.datum = { j: z.datum.j, m: +p[0], t: +p[1] };
        el("a3dDatum").value = z.datum.j + "-" + ("0" + z.datum.m).slice(-2) + "-" + ("0" + z.datum.t).slice(-2);
        sonneAnwenden();
      });
    });
    el("a3dZeit").addEventListener("input", function () { z.zeit = +el("a3dZeit").value / 60; sonneAnwenden(); });
    el("a3dPlay").addEventListener("click", abspielen);
    el("a3dMittag").addEventListener("click", function () {
      // Zeit der höchsten Sonne finden
      var beste = 12, hoechste = -9;
      for (var m = 0; m <= 1440; m += 5) {
        var s = sonnenstand(z.mitte.lat, z.mitte.lng, z.datum.j, z.datum.m, z.datum.t, m / 60);
        if (s.hoehe > hoechste) { hoechste = s.hoehe; beste = m / 60; }
      }
      z.zeit = beste; el("a3dZeit").value = String(Math.round(beste * 60 / 5) * 5); sonneAnwenden();
    });
    el("a3dSchatten").addEventListener("change", function () { sonneAnwenden(); });
    ["a3dRadius", "a3dHoehenart", "a3dKarte", "a3dAusblenden", "a3dGelaende"].forEach(function (id) {
      el(id).addEventListener("change", function () { baueModell(); });
    });
    el("a3dNeu").addEventListener("click", function () { baueModell(); });
    el("a3dDraufsicht").addEventListener("click", function () { z.pol = 0.0001; zeichne(); });
    el("a3dSued").addEventListener("click", function () { z.theta = 0; z.pol = 1.35; zeichne(); });
    el("a3dSchraeg").addEventListener("click", function () { z.theta = 0.5; z.pol = 0.95; z.ziel.set(0, 0, 0); z.dist = z.radius * 1.75; zeichne(); });
    el("a3dKamera").addEventListener("change", function () { z.kamera = el("a3dKamera").value; zeichne(); });
    el("a3dSpeichern").addEventListener("click", speichern);
    el("a3dFormat").addEventListener("change", speicherFelder);
    speicherFelder();
    Array.prototype.forEach.call(wurzel.querySelectorAll("[data-mess]"), function (b) {
      b.addEventListener("click", function () { messWerkzeug(z.werkzeug === b.dataset.mess ? null : b.dataset.mess); });
    });
    el("a3dMessFertig").addEventListener("click", function () { messStreckeBeenden(); });
    el("a3dMessLetzte").addEventListener("click", function () { z.messEntwurf = null; z.messungen.pop(); messListe(); messHinweis(); zeichne(); });
    el("a3dMessAlle").addEventListener("click", function () { z.messEntwurf = null; z.messungen = []; messListe(); messHinweis(); zeichne(); });
    kameraEreignisse();

    z.beobachter = new ResizeObserver(function () { groesseAnpassen(); });
    z.beobachter.observe(el("a3dFlaeche"));

    z.stand = standSignatur();
    baueModell();
  }

  // ---------- Reiter: verstecken und wieder zeigen (die Ansicht bleibt dabei erhalten) ----------
  // Was sich in der Karte ändern kann, solange die 3D-Ansicht versteckt ist (Adresse, Zeichnung, Ebenen, Hintergrund, Pläne), steht in der Signatur.
  function standSignatur() {
    try {
      var p = projektSammeln(false);
      delete p.gespeichert; delete p.einstellungen; delete p.exportMitte; delete p.fotos;
      p.karte = { hintergrund: p.karte.hintergrund, bebauung: p.karte.bebauung, kontrast: p.karte.kontrast };
      return JSON.stringify(p);
    } catch (x) { return ""; }
  }
  function offen() { return !!zustand; }
  function meldeReiter(was) { document.dispatchEvent(new CustomEvent("ansicht3d-reiter", { detail: was })); }
  function verbergen() {
    var z = zustand;
    if (!z || z.versteckt) { return; }
    if (z.spielt) { z.spielt = false; z.el("a3dPlay").textContent = "▶ Tag abspielen"; }
    if (z.analyseTimer) { clearTimeout(z.analyseTimer); z.analyseTimer = null; }
    z.stand = standSignatur();
    z.versteckt = true;
    z.wurzel.style.display = "none";
    meldeReiter("karte");
  }
  function zeigen() {
    var z = zustand;
    if (!z) { return; }
    z.versteckt = false;
    z.wurzel.style.display = "";
    var m = (typeof marker !== "undefined" && marker) ? marker.getLatLng() : null;
    if (m && (Math.abs(m.lat - z.mitte.lat) > 1e-7 || Math.abs(m.lng - z.mitte.lng) > 1e-7)) {
      schliessen(); oeffnen(); meldeReiter("3d"); return;           // neue Adresse: Ansicht ganz neu um den neuen Punkt
    }
    var neu = standSignatur();
    if (neu !== z.stand) { z.stand = neu; analyseHakenAngleichen(); baueListe(); baueModell(); }
    else { groesseAnpassen(); zeichne(); }
    meldeReiter("3d");
  }

  function schliessen() {
    var z = zustand;
    if (!z) { return; }
    z.spielt = false;
    document.removeEventListener("keydown", z.tasten);
    z.beobachter.disconnect();
    if (z.animation) { cancelAnimationFrame(z.animation); }
    if (z.analyseTimer) { clearTimeout(z.analyseTimer); }
    punkteLeeren();
    baeumeLeeren();
    waldLeeren();
    (z.sonneArbeiter || []).forEach(function (w) { w.terminate(); });
    arbeiterSchliessen();
    sonneLeeren();
    leereModell();
    if (z.boden && z.boden.material.map) { z.boden.material.map.dispose(); }
    z.renderer.dispose();
    z.wurzel.remove();
    z.style.remove();
    zustand = null;
  }

  function groesseAnpassen() {
    var z = zustand; if (!z) { return; }
    var f = z.el("a3dFlaeche");
    var b = Math.max(10, f.clientWidth), h = Math.max(10, f.clientHeight);
    z.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    z.renderer.setSize(b, h, false);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var ue = z.el("a3dUeber");
    ue.width = Math.round(b * dpr); ue.height = Math.round(h * dpr);
    zeichne();
  }

  // ---------- Gelände (Digitales Geländemodell 1 m des LGLN, auf 5 m Raster, Datei gelaende_oldenburg.js) ----------
  var QUELLE_GELAENDE = "Gelände: LGLN (DGM1), CC BY 4.0";
  var gelaendeDaten = null, gelaendeVorgang = null;
  // Lädt die Datei (nur beim ersten Mal): Base64 -> entpacken ("deflate-raw") -> Zeilen aus Differenzen zurückrechnen (Dezimeter über NHN)
  function gelaendeLaden() {
    if (gelaendeDaten) { return Promise.resolve(gelaendeDaten); }
    if (gelaendeVorgang) { return gelaendeVorgang; }
    gelaendeVorgang = new Promise(function (fertig, fehler) {
      function auswerten() {
        try {
          var roh = window.GELAENDE_OLDENBURG;
          if (typeof DecompressionStream === "undefined") { throw new Error("Der Browser kann die Gelände-Datei nicht entpacken (DecompressionStream fehlt)."); }
          var bin = atob(roh.daten), bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
          new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer().then(function (buf) {
            var d = new Int16Array(buf), W = roh.breite, H = roh.hoehe;
            for (var j = 0; j < H; j++) { var s = 0, o = j * W; for (var k = 0; k < W; k++) { s = (s + d[o + k]) << 16 >> 16; d[o + k] = s; } }
            gelaendeDaten = { h: d, W: W, H: H, e0: roh.e0, n1: roh.n1, schritt: roh.schritt, stand: roh.stand, min: roh.min, max: roh.max };
            window.GELAENDE_OLDENBURG = null;
            fertig(gelaendeDaten);
          }, function (x) { gelaendeVorgang = null; fehler(x); });
        } catch (x) { gelaendeVorgang = null; fehler(x); }
      }
      if (window.GELAENDE_OLDENBURG) { auswerten(); return; }
      var skript = document.createElement("script");
      skript.src = "gelaende_oldenburg.js";
      skript.onload = auswerten;
      skript.onerror = function () { gelaendeVorgang = null; fehler(new Error("Datei gelaende_oldenburg.js nicht gefunden")); };
      document.head.appendChild(skript);
    });
    return gelaendeVorgang;
  }

  // Richtet z.gh(x, n) ein: Höhe des Geländes in Metern über dem Punkt in der Mitte (x = Ost, n = Nord in Metern um die Mitte).
  // Ohne Gelände (G = null) ist es überall 0. Das Raster liegt in UTM32; die Umrechnung der Metersysteme ist eine kleine Drehung
  // (Meridiankonvergenz), die aus drei UTM-Punkten bestimmt wird.
  function gelaendeEinrichten(z, G) {
    z.gelaende = !!G; z.gelBasis = 0; z.gelMax = 0;
    if (!G) { z.gh = function () { return 0; }; z.ghAbs = z.gh; return; }
    var o = utm32(z.mitte.lat, z.mitte.lng);
    var oe = utm32(z.mitte.lat, z.mitte.lng + 1000 / z.mLng), on = utm32(z.mitte.lat + 1000 / z.mLat, z.mitte.lng);
    var a11 = (oe.e - o.e) / 1000, a21 = (oe.n - o.n) / 1000, a12 = (on.e - o.e) / 1000, a22 = (on.n - o.n) / 1000;
    var h = G.h, W = G.W, H = G.H, e0 = G.e0, n1 = G.n1, sch = G.schritt;
    function absolut(x, n) {
      var c = ((o.e + a11 * x + a12 * n) - e0) / sch - 0.5, r = (n1 - (o.n + a21 * x + a22 * n)) / sch - 0.5;
      var c0 = Math.floor(c), r0 = Math.floor(r), fx = c - c0, fy = r - r0;
      var c1 = c0 + 1, r1 = r0 + 1;
      c0 = c0 < 0 ? 0 : (c0 > W - 1 ? W - 1 : c0); c1 = c1 < 0 ? 0 : (c1 > W - 1 ? W - 1 : c1);
      r0 = r0 < 0 ? 0 : (r0 > H - 1 ? H - 1 : r0); r1 = r1 < 0 ? 0 : (r1 > H - 1 ? H - 1 : r1);
      var v = (h[r0 * W + c0] * (1 - fx) + h[r0 * W + c1] * fx) * (1 - fy) + (h[r1 * W + c0] * (1 - fx) + h[r1 * W + c1] * fx) * fy;
      return v * 0.1;
    }
    z.gelBasis = absolut(0, 0);
    z.gelDaten = G; z.gelAffin = { oe: o.e, on: o.n, a11: a11, a12: a12, a21: a21, a22: a22 };      // für die Hintergrundprozesse
    z.gelMax = Math.max(0, (G.max || 0) - z.gelBasis);          // höchstes Gelände über der Mitte (für Suchstrecken der Schattenprüfung)
    z.ghAbs = absolut;
    z.gh = function (x, n) { return absolut(x, n) - z.gelBasis; };
  }

  // Bodenfläche: Gitter, dessen Höhen dem Gelände folgen (ohne Gelände ein einfaches Quadrat). hoch = Abstand über dem Gelände (für Auflagen).
  function bodenGeometrie(R, hoch) {
    var z = zustand, THREE = window.THREE;
    var seg = z.gelaende ? Math.max(2, Math.min(512, Math.ceil(2 * R / 5))) : 1;
    var g = new THREE.PlaneGeometry(2 * R, 2 * R, seg, seg);
    g.rotateX(-Math.PI / 2);                 // liegt jetzt waagerecht; Norden = -z, die Texturkoordinaten bleiben gleich
    if (z.gelaende || hoch) {
      var p = g.attributes.position;
      for (var i = 0; i < p.count; i++) { p.setY(i, (z.gelaende ? z.gh(p.getX(i), -p.getZ(i)) : 0) + (hoch || 0)); }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }
    return g;
  }
  // Höhen für ein Gebäude: y0 = mittlere Geländehöhe an den Ecken (Bezug für Traufe und First), yb = tiefste Ecke minus 20 cm (Wandfuß)
  function gruendung(ring) {
    var z = zustand;
    if (!z.gelaende) { return { y0: 0, yb: 0 }; }
    var s = 0, n = ring.length / 2, tief = 1e9;
    for (var i = 0; i < ring.length; i += 2) { var v = z.gh(ring[i], ring[i + 1]); s += v; if (v < tief) { tief = v; } }
    return { y0: s / n, yb: tief - 0.2 };
  }
  // ---------- Modell ----------
  function leereModell() {
    var z = zustand;
    while (z.modell.children.length) {
      var k = z.modell.children.pop();
      if (k.geometry) { k.geometry.dispose(); }
      if (k.material) { if (k.material.map) { k.material.map.dispose(); } k.material.dispose(); }
    }
    z.boden = null;
  }

  // Ein Vieleck (Ringe in Breite/Länge) in Meter um die Mitte
  function inMeter(ring) {
    var z = zustand, aus = [];
    for (var i = 0; i < ring.length; i += 2) {
      aus.push((ring[i + 1] - z.mitte.lng) * z.mLng, (ring[i] - z.mitte.lat) * z.mLat);   // x = Ost, y = Nord
    }
    return aus;
  }

  // ---------- Rechenkern für Gebäude (läuft im Hauptprogramm und in Hintergrundprozessen, daher ohne three.js und ohne Zugriff auf die Seite) ----------
  // Alle Funktionen dieses Abschnitts stehen in ARBEITER_FUNKTIONEN (weiter unten): Sie werden als Text in die Web Worker kopiert und dürfen nur
  // einander, Math und Typed Arrays benutzen.

  function flaecheMeter(r) {            // Fläche (positiv = gegen den Uhrzeigersinn) eines Rings [x, y, x, y, ...]
    var a = 0;
    for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { a += r[j] * r[i + 1] - r[i] * r[j + 1]; }
    return a / 2;
  }

  // --- Dreiecke aus einem Vieleck mit Löchern ("Ear Clipping", nach dem Verfahren der Bibliothek earcut von Mapbox, ISC-Lizenz, ohne Z-Kurven-Beschleunigung) ---
  function ecKnoten(i, x, y) { return { i: i, x: x, y: y, prev: null, next: null, steiner: false }; }
  function ecEinfuegen(i, x, y, last) {
    var p = ecKnoten(i, x, y);
    if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function ecEntfernen(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function ecFlaeche(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function ecGleich(p1, p2) { return p1.x === p2.x && p1.y === p2.y; }
  function ecVorzeichen(n) { return n > 0 ? 1 : (n < 0 ? -1 : 0); }
  function ecVorzeichenFlaeche(data, start, end) {
    var sum = 0;
    for (var i = start, j = end - 2; i < end; i += 2) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
    return sum;
  }
  function ecListe(data, start, end, uhrzeiger) {
    var i, last;
    if (uhrzeiger === (ecVorzeichenFlaeche(data, start, end) > 0)) {
      for (i = start; i < end; i += 2) { last = ecEinfuegen(i, data[i], data[i + 1], last); }
    } else {
      for (i = end - 2; i >= start; i -= 2) { last = ecEinfuegen(i, data[i], data[i + 1], last); }
    }
    if (last && ecGleich(last, last.next)) { ecEntfernen(last); last = last.next; }
    return last;
  }
  function ecFiltern(start, end) {      // doppelte und auf einer Geraden liegende Punkte entfernen
    if (!start) { return start; }
    if (!end) { end = start; }
    var p = start, nochmal;
    do {
      nochmal = false;
      if (!p.steiner && (ecGleich(p, p.next) || ecFlaeche(p.prev, p, p.next) === 0)) {
        ecEntfernen(p);
        p = end = p.prev;
        if (p === p.next) { break; }
        nochmal = true;
      } else { p = p.next; }
    } while (nochmal || p !== end);
    return end;
  }
  function ecPunktImDreieck(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function ecIstOhr(ear) {
    var a = ear.prev, b = ear, c = ear.next;
    if (ecFlaeche(a, b, c) >= 0) { return false; }
    var p = ear.next.next;
    while (p !== ear.prev) {
      if (ecPunktImDreieck(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && ecFlaeche(p.prev, p, p.next) >= 0) { return false; }
      p = p.next;
    }
    return true;
  }
  function ecSchneidet(p1, q1, p2, q2) {
    var o1 = ecVorzeichen(ecFlaeche(p1, q1, p2)), o2 = ecVorzeichen(ecFlaeche(p1, q1, q2)), o3 = ecVorzeichen(ecFlaeche(p2, q2, p1)), o4 = ecVorzeichen(ecFlaeche(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) { return true; }
    if (o1 === 0 && ecAufStrecke(p1, p2, q1)) { return true; }
    if (o2 === 0 && ecAufStrecke(p1, q2, q1)) { return true; }
    if (o3 === 0 && ecAufStrecke(p2, p1, q2)) { return true; }
    if (o4 === 0 && ecAufStrecke(p2, q1, q2)) { return true; }
    return false;
  }
  function ecAufStrecke(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
  function ecSchneidetVieleck(a, b) {
    var p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && ecSchneidet(p, p.next, a, b)) { return true; }
      p = p.next;
    } while (p !== a);
    return false;
  }
  function ecLokalInnen(a, b) {
    return ecFlaeche(a.prev, a, a.next) < 0 ? (ecFlaeche(a, b, a.next) >= 0 && ecFlaeche(a, a.prev, b) >= 0) : (ecFlaeche(a, b, a.prev) < 0 || ecFlaeche(a, a.next, b) < 0);
  }
  function ecMitteInnen(a, b) {
    var p = a, innen = false, px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if (((p.y > py) !== (p.next.y > py)) && p.next.y !== p.y && (px < (p.next.x - p.x) * (py - p.y) / (p.next.y - p.y) + p.x)) { innen = !innen; }
      p = p.next;
    } while (p !== a);
    return innen;
  }
  function ecGueltigeDiagonale(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !ecSchneidetVieleck(a, b) &&
      ((ecLokalInnen(a, b) && ecLokalInnen(b, a) && ecMitteInnen(a, b) && (ecFlaeche(a.prev, a, b.prev) || ecFlaeche(a, b.prev, b))) ||
       (ecGleich(a, b) && ecFlaeche(a.prev, a, a.next) > 0 && ecFlaeche(b.prev, b, b.next) > 0));
  }
  function ecPolygonTeilen(a, b) {
    var a2 = ecKnoten(a.i, a.x, a.y), b2 = ecKnoten(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }
  function ecLokaleSchnitteHeilen(start, dreiecke) {
    var p = start;
    do {
      var a = p.prev, b = p.next.next;
      if (!ecGleich(a, b) && ecSchneidet(a, p, p.next, b) && ecLokalInnen(a, b) && ecLokalInnen(b, a)) {
        dreiecke.push(a.i / 2, p.i / 2, b.i / 2);
        ecEntfernen(p); ecEntfernen(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return ecFiltern(p);
  }
  function ecTeilen(start, dreiecke) {
    var a = start;
    do {
      var b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && ecGueltigeDiagonale(a, b)) {
          var c = ecPolygonTeilen(a, b);
          a = ecFiltern(a, a.next); c = ecFiltern(c, c.next);
          ecOhrenSchneiden(a, dreiecke, 0);
          ecOhrenSchneiden(c, dreiecke, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function ecOhrenSchneiden(ear, dreiecke, durchgang) {
    if (!ear) { return; }
    var stop = ear, prev, next;
    while (ear.prev !== ear.next) {
      prev = ear.prev; next = ear.next;
      if (ecIstOhr(ear)) {
        dreiecke.push(prev.i / 2, ear.i / 2, next.i / 2);
        ecEntfernen(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!durchgang) { ecOhrenSchneiden(ecFiltern(ear), dreiecke, 1); }
        else if (durchgang === 1) { ear = ecLokaleSchnitteHeilen(ecFiltern(ear), dreiecke); ecOhrenSchneiden(ear, dreiecke, 2); }
        else if (durchgang === 2) { ecTeilen(ear, dreiecke); }
        break;
      }
    }
  }
  function ecLinkester(start) {
    var p = start, l = start;
    do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) { l = p; } p = p.next; } while (p !== start);
    return l;
  }
  function ecSektorEnthaeltSektor(m, p) { return ecFlaeche(m.prev, m, p.prev) < 0 && ecFlaeche(p.next, m, m.next) < 0; }
  function ecLochBruecke(loch, aussen) {
    var p = aussen, hx = loch.x, hy = loch.y, qx = -Infinity, m;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p.x < p.next.x ? p : p.next;
          if (x === hx) { return m; }
        }
      }
      p = p.next;
    } while (p !== aussen);
    if (!m) { return null; }
    var stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && ecPunktImDreieck(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        tan = Math.abs(hy - p.y) / (hx - p.x);
        if (ecLokalInnen(p, loch) && (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && ecSektorEnthaeltSektor(m, p)))))) { m = p; tanMin = tan; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function ecLochEntfernen(loch, aussen) {
    var bruecke = ecLochBruecke(loch, aussen);
    if (!bruecke) { return aussen; }
    var rueck = ecPolygonTeilen(bruecke, loch);
    ecFiltern(rueck, rueck.next);
    return ecFiltern(bruecke, bruecke.next);
  }
  function ecLoecherEntfernen(data, lochStarts, aussen) {
    var queue = [], i, len, start, end, liste;
    for (i = 0, len = lochStarts.length; i < len; i++) {
      start = lochStarts[i] * 2;
      end = i < len - 1 ? lochStarts[i + 1] * 2 : data.length;
      liste = ecListe(data, start, end, false);
      if (liste === liste.next) { liste.steiner = true; }
      queue.push(ecLinkester(liste));
    }
    queue.sort(function (a, b) { return a.x - b.x; });
    for (i = 0; i < queue.length; i++) { aussen = ecLochEntfernen(queue[i], aussen); }
    return aussen;
  }
  // data = [x0, y0, x1, y1, ...] (erst der Außenring, dann die Löcher), lochStarts = Punktnummern, bei denen die Löcher beginnen. Ergebnis: Punktnummern je drei.
  function ecTriangulieren(data, lochStarts) {
    var hatLoecher = lochStarts && lochStarts.length, aussenLaenge = hatLoecher ? lochStarts[0] * 2 : data.length;
    var aussen = ecListe(data, 0, aussenLaenge, true), dreiecke = [];
    if (!aussen || aussen.next === aussen.prev) { return dreiecke; }
    if (hatLoecher) { aussen = ecLoecherEntfernen(data, lochStarts, aussen); }
    ecOhrenSchneiden(aussen, dreiecke, 0);
    return dreiecke;
  }

  // ---------- Dachformen (vereinfacht) ----------
  // Aus Traufhöhe, Firsthöhe, Dachklasse und Firstrichtung der Landesdaten entsteht eine Höhenfunktion hf(x, y) für den Grundriss.
  // Sie ist stückweise eben; die Knicklinien (First, Grat, Kehle) stehen in lin = [[a, b, c], ...] (Gerade a·x + b·y = c, a² + b² = 1).
  // Klassen: 1 Satteldach, 2 Walmdach, 3 Zeltdach, 4 Pultdach (0 = flach: kein Dach, die Höhe bleibt gleich).
  // Ein Dach besteht aus Zahlen p (art, t, f, ca, sa, s0, u0, hw, hl, qmin, qmax); dachBauen(p) macht daraus hf und lin
  // (so lässt sich das Dach auch in einem Hintergrundprozess neu aufbauen, Funktionen kann man nicht dorthin schicken).
  var DACH_NAMEN = ["Flachdach", "Satteldach", "Walmdach", "Zeltdach", "Pultdach"];
  var DACH_FUELLUNG = 0.6;          // der Grundriss muss mindestens so viel seines umschließenden Rechtecks füllen, sonst bleibt das Dach flach
  var DACH_WALM_FUELLUNG = 0.85;    // Walm- und Zeltdächer nur über (fast) rechteckigen Grundrissen, sonst wird ein Satteldach daraus

  function dachBauen(p) {
    var t = p.t, f = p.f, d = f - t, ca = p.ca, sa = p.sa, art = p.art;
    if (art === 4) {
      var qmin = p.qmin, qmax = p.qmax;
      return { art: 4, t: t, f: f, lin: [], hmax: f, hf: function (px, py) { var v = (px * sa + py * ca - qmin) / (qmax - qmin); return f - d * Math.min(1, Math.max(0, v)); } };
    }
    var s0 = p.s0, u0 = p.u0, hw = p.hw, hl = p.hl, m = Math.min(hw, hl), c0 = hw - hl, hf, lin;
    function gerade(cs, cu, c) {      // cs·S + cu·U = c mit S = s − s0, U = u − u0, als Gerade in (x, y)
      var a = cs * ca + cu * sa, b = -cs * sa + cu * ca, l = Math.sqrt(a * a + b * b);
      return [a / l, b / l, (c + cs * s0 + cu * u0) / l];
    }
    if (art === 1) {
      lin = [gerade(1, 0, 0)];
      hf = function (px, py) { var S = px * ca - py * sa - s0; return t + d * Math.max(0, 1 - Math.abs(S) / hw); };
    } else if (art === 2) {
      lin = [hl >= hw ? gerade(1, 0, 0) : gerade(0, 1, 0), gerade(1, -1, c0), gerade(1, 1, c0), gerade(1, 1, -c0), gerade(1, -1, -c0)];     // First und vier Grate
      hf = function (px, py) {
        var S = px * ca - py * sa - s0, U = px * sa + py * ca - u0;
        return t + d * Math.min(1, Math.max(0, Math.min(hw - Math.abs(S), hl - Math.abs(U)) / m));
      };
    } else {
      lin = [gerade(1 / hw, -1 / hl, 0), gerade(1 / hw, 1 / hl, 0)];
      hf = function (px, py) {
        var S = px * ca - py * sa - s0, U = px * sa + py * ca - u0;
        return t + d * Math.max(0, 1 - Math.max(Math.abs(S) / hw, Math.abs(U) / hl));
      };
    }
    return { art: art, t: t, f: f, lin: lin, hmax: f, hf: hf };
  }

  function dachErzeugen(ringe, t, f, cls, ang) {
    if (!cls || ringe.length !== 1 || !(f - t >= 0.3)) { return null; }
    var r = ringe[0], n = r.length / 2;
    if (n > 1 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1]) { n--; }
    if (n < 3) { return null; }
    var th = ang * Math.PI / 180, ca = Math.cos(th), sa = Math.sin(th), i, x, y, p;
    if (cls === 4) {                  // Pultdach: ang = Richtung, in die das Dach nach unten fällt
      var qmin = 1e9, qmax = -1e9;
      for (i = 0; i < n; i++) { var q = r[2 * i] * sa + r[2 * i + 1] * ca; if (q < qmin) { qmin = q; } if (q > qmax) { qmax = q; } }
      if (qmax - qmin < 1.5) { return null; }
      p = { art: 4, t: t, f: f, ca: ca, sa: sa, qmin: qmin, qmax: qmax };
    } else {
      // Firstachse u = (sin ang, cos ang) in (Ost, Nord); quer dazu s = (cos ang, -sin ang)
      var smin = 1e9, smax = -1e9, umin = 1e9, umax = -1e9;
      for (i = 0; i < n; i++) {
        x = r[2 * i]; y = r[2 * i + 1];
        var s1 = x * ca - y * sa, u1 = x * sa + y * ca;
        if (s1 < smin) { smin = s1; } if (s1 > smax) { smax = s1; }
        if (u1 < umin) { umin = u1; } if (u1 > umax) { umax = u1; }
      }
      var hw = (smax - smin) / 2, hl = (umax - umin) / 2;
      if (hw < 1 || hl < 1) { return null; }
      var fill = Math.abs(flaecheMeter(r)) / (4 * hw * hl);
      if (fill < DACH_FUELLUNG) { return null; }
      var art = cls;
      if ((art === 2 || art === 3) && fill < DACH_WALM_FUELLUNG) { art = 1; }
      p = { art: art, t: t, f: f, ca: ca, sa: sa, s0: (smax + smin) / 2, u0: (umax + umin) / 2, hw: hw, hl: hl };
    }
    var dach = dachBauen(p);
    dach.name = DACH_NAMEN[p.art]; dach.p = p;
    return dach;
  }

  // Schneidet ein Vieleck (flache Liste x, y, ...) an der Geraden: [Teil auf der positiven Seite, Teil auf der negativen Seite]
  function schneideVieleck(P, g) {
    var pos = [], neg = [], n = P.length / 2, E = 0.02, i, j;
    var dd = [];
    for (i = 0; i < n; i++) { var v = g[0] * P[2 * i] + g[1] * P[2 * i + 1] - g[2]; dd.push(Math.abs(v) < E ? 0 : v); }
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      var di = dd[i], dj = dd[j];
      if (di >= 0) { pos.push(P[2 * i], P[2 * i + 1]); }
      if (di <= 0) { neg.push(P[2 * i], P[2 * i + 1]); }
      if ((di > 0 && dj < 0) || (di < 0 && dj > 0)) {
        var tt = di / (di - dj), px = P[2 * i] + (P[2 * j] - P[2 * i]) * tt, py = P[2 * i + 1] + (P[2 * j + 1] - P[2 * i + 1]) * tt;
        pos.push(px, py); neg.push(px, py);
      }
    }
    return [pos, neg];
  }
  function teileDreieck(tri, lin) {     // Dreieck an allen Knicklinien zerschneiden; Ergebnis: Liste von Dreiecken [x0, y0, x1, y1, x2, y2]
    var liste = [tri], li, q, T, d0, d1, d2, E = 0.02;
    for (li = 0; li < lin.length; li++) {
      var g = lin[li], neu = [];
      for (q = 0; q < liste.length; q++) {
        T = liste[q];
        d0 = g[0] * T[0] + g[1] * T[1] - g[2]; d1 = g[0] * T[2] + g[1] * T[3] - g[2]; d2 = g[0] * T[4] + g[1] * T[5] - g[2];
        if ((d0 >= -E && d1 >= -E && d2 >= -E) || (d0 <= E && d1 <= E && d2 <= E)) { neu.push(T); continue; }
        var teile = schneideVieleck(T, g);
        for (var s = 0; s < 2; s++) {
          var P = teile[s], np = P.length / 2;
          for (var k = 1; k + 1 < np; k++) { neu.push([P[0], P[1], P[2 * k], P[2 * k + 1], P[2 * k + 2], P[2 * k + 3]]); }
        }
      }
      liste = neu;
    }
    return liste;
  }

  // Ringe aus flachen Listen: Außenkante gegen den Uhrzeigersinn, Höfe im Uhrzeigersinn, [[x, y], ...] je Ring
  function konturenAus(ringeMeter) {
    var konturen = [];
    ringeMeter.forEach(function (r, i) {
      var pkt = [];
      for (var k = 0; k < r.length; k += 2) { pkt.push([r[k], r[k + 1]]); }
      if (pkt.length > 1 && pkt[0][0] === pkt[pkt.length - 1][0] && pkt[0][1] === pkt[pkt.length - 1][1]) { pkt.pop(); }
      if (pkt.length < 3) { return; }
      var gegenUhr = flaecheMeter(r) > 0;
      if ((i === 0) !== gegenUhr) { pkt.reverse(); }
      konturen.push(pkt);
    });
    return konturen;
  }

  // Flächen eines Körpers: d = Dachdreiecke (je 9 Zahlen: x, y, Höhe ×3, gegen den Uhrzeigersinn von oben), w = Wände (je 6 Zahlen: ax, ay, Höhe a, bx, by, Höhe b; unten immer 0)
  // konturen siehe konturenAus; dach = Ergebnis von dachErzeugen/dachBauen oder null (dann flach auf der Höhe hoehe)
  function koerperGeometrie(konturen, hoehe, dach) {
    var d = [], w = [], i, k;
    var daten = [], lochStarts = [], alle = [];
    konturen.forEach(function (pkt, ri) {
      if (ri > 0) { lochStarts.push(daten.length / 2); }
      pkt.forEach(function (p) { daten.push(p[0], p[1]); alle.push(p); });
    });
    var tri = ecTriangulieren(daten, lochStarts);
    var lin = dach ? dach.lin : [], hf = dach ? dach.hf : null;
    for (i = 0; i + 2 < tri.length; i += 3) {
      var p0 = alle[tri[i]], p1 = alle[tri[i + 1]], p2 = alle[tri[i + 2]];
      var fl0 = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
      if (Math.abs(fl0) < 1e-9) { continue; }
      if (fl0 < 0) { var tm = p1; p1 = p2; p2 = tm; }                       // gegen den Uhrzeigersinn
      if (!dach) {
        d.push(p0[0], p0[1], hoehe, p1[0], p1[1], hoehe, p2[0], p2[1], hoehe);
        continue;
      }
      var teile = teileDreieck([p0[0], p0[1], p1[0], p1[1], p2[0], p2[1]], lin);
      for (var q = 0; q < teile.length; q++) {
        var T = teile[q];
        var fl = (T[2] - T[0]) * (T[5] - T[1]) - (T[4] - T[0]) * (T[3] - T[1]);
        if (Math.abs(fl) < 1e-6) { continue; }
        if (fl < 0) { var tx = T[2], ty = T[3]; T[2] = T[4]; T[3] = T[5]; T[4] = tx; T[5] = ty; }
        d.push(T[0], T[1], hf(T[0], T[1]), T[2], T[3], hf(T[2], T[3]), T[4], T[5], hf(T[4], T[5]));
      }
    }
    for (var c = 0; c < konturen.length; c++) {
      var pk = konturen[c];
      for (var i2 = 0, j2 = pk.length - 1; i2 < pk.length; j2 = i2, i2++) {
        var a = pk[j2], b = pk[i2], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.sqrt(dx * dx + dy * dy);
        if (l < 0.01) { continue; }
        if (!dach) { w.push(a[0], a[1], hoehe, b[0], b[1], hoehe); continue; }
        var ts = [0, 1];
        for (k = 0; k < lin.length; k++) {      // wo die Wandkante eine Knicklinie kreuzt (Giebel), wird die Wandoberkante geknickt
          var ga = lin[k][0] * a[0] + lin[k][1] * a[1] - lin[k][2], gb = lin[k][0] * b[0] + lin[k][1] * b[1] - lin[k][2];
          if ((ga > 0.02 && gb < -0.02) || (ga < -0.02 && gb > 0.02)) { ts.push(ga / (ga - gb)); }
        }
        ts.sort(function (u, v) { return u - v; });
        for (k = 0; k + 1 < ts.length; k++) {
          var xa = a[0] + dx * ts[k], ya = a[1] + dy * ts[k], xb = a[0] + dx * ts[k + 1], yb = a[1] + dy * ts[k + 1];
          if (ts[k + 1] - ts[k] < 1e-4) { continue; }
          w.push(xa, ya, hf(xa, ya), xb, yb, hf(xb, yb));
        }
      }
    }
    return { d: d, w: w };
  }

  // Sammelt Klötze zu einer einzigen Form (schnell zu zeichnen)
  // Eigene, schlanke Aufbereitung: Dach (Dreiecke) und Wände, kein Boden. Speicher wächst in Stücken (Float32Array).
  function Sammler(mitUV) {
    this.pos = new Float32Array(1 << 16); this.nor = new Float32Array(1 << 16); this.n = 0; this.gruppen = [];
    this.uv = mitUV ? new Float32Array((1 << 16) / 3 * 2) : null;      // Texturkoordinaten (für das Blattmuster der Wälder)
  }
  function sammlerPlatz(mehr) {
    if (this.n + mehr <= this.pos.length) { return; }
    var neu = this.pos.length;
    while (this.n + mehr > neu) { neu *= 2; }
    var p = new Float32Array(neu), q = new Float32Array(neu);
    p.set(this.pos.subarray(0, this.n)); q.set(this.nor.subarray(0, this.n));
    this.pos = p; this.nor = q;
    if (this.uv) { var t = new Float32Array(neu / 3 * 2); t.set(this.uv.subarray(0, this.n / 3 * 2)); this.uv = t; }
  }
  function sammlerPunkt(x, y, z, nx, ny, nz) {
    var i = this.n;
    this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
    this.nor[i] = nx; this.nor[i + 1] = ny; this.nor[i + 2] = nz;
    if (this.uv) {
      var j = i / 3 * 2;
      if (ny > 0.5) { this.uv[j] = x * 0.05; this.uv[j + 1] = z * 0.05; } else { this.uv[j] = (x + z) * 0.05; this.uv[j + 1] = y * 0.05; }
    }
    this.n += 3;
  }
  Sammler.prototype.platz = sammlerPlatz;
  Sammler.prototype.punkt = sammlerPunkt;

  // Schreibt einen Körper in den Sammler S (Dach und Wände). ringeMeter: erster Ring = Außenkante, weitere = Innenhöfe (in Metern, x = Ost, y = Nord);
  // dach (optional): Ergebnis von dachErzeugen/dachBauen, sonst flaches Dach auf der Höhe "hoehe";
  // y0 = Höhe des Geländes am Gebäude (Dach und Wandoberkante liegen darüber), yb = Höhe des Wandfußes (tiefste Stelle des Geländes). Gibt false zurück, wenn nichts entstand.
  function sammlerSchreibe(S, ringeMeter, hoehe, dach, y0, yb) {
    y0 = y0 || 0; yb = yb || 0;
    var konturen = konturenAus(ringeMeter);
    if (!konturen.length || ringeMeter[0].length / 2 < 3) { return false; }
    var G = koerperGeometrie(konturen, hoehe, dach);
    if (!G) { return false; }
    var d = G.d, w = G.w, i;
    S.platz(d.length + w.length * 3 + 18);
    for (i = 0; i < d.length; i += 9) {                      // Dach
      var nx = 0, ny = 0, nz = 1;
      if (dach) {
        var e1x = d[i + 3] - d[i], e1y = d[i + 4] - d[i + 1], e1z = d[i + 5] - d[i + 2], e2x = d[i + 6] - d[i], e2y = d[i + 7] - d[i + 1], e2z = d[i + 8] - d[i + 2];
        nx = e1y * e2z - e1z * e2y; ny = e1z * e2x - e1x * e2z; nz = e1x * e2y - e1y * e2x;
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      }
      for (var k = 0; k < 3; k++) { S.punkt(d[i + 3 * k], d[i + 3 * k + 2] + y0, -d[i + 3 * k + 1], nx, nz, -ny); }
    }
    for (i = 0; i < w.length; i += 6) {                      // Wände
      var ax = w[i], ay = w[i + 1], ha = w[i + 2], bx = w[i + 3], by = w[i + 4], hb = w[i + 5];
      var dx = bx - ax, dy = by - ay, l = Math.sqrt(dx * dx + dy * dy);
      if (l < 0.001) { continue; }
      var wx = dy / l, wy = -dx / l;                         // nach außen
      S.punkt(ax, yb, -ay, wx, 0, -wy); S.punkt(bx, yb, -by, wx, 0, -wy); S.punkt(bx, hb + y0, -by, wx, 0, -wy);
      S.punkt(ax, yb, -ay, wx, 0, -wy); S.punkt(bx, hb + y0, -by, wx, 0, -wy); S.punkt(ax, ha + y0, -ay, wx, 0, -wy);
    }
    return true;
  }
  Sammler.prototype.addiere = function (ringeMeter, hoehe, info, dach, y0, yb) {
    var v0 = this.n / 3;
    if (sammlerSchreibe(this, ringeMeter, hoehe, dach, y0, yb) && info) { this.gruppen.push({ v0: v0, info: info }); }   // ab welchem Punkt gehört was zu welchem Gebäude (für das Messen)
  };
  Sammler.prototype.gebaeude = function () {
    var THREE = window.THREE;
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, this.n), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.nor.slice(0, this.n), 3));
    if (this.uv) { g.setAttribute("uv", new THREE.BufferAttribute(this.uv.slice(0, this.n / 3 * 2), 2)); }
    return g;
  };

  // Aufgabe für die Hintergrundprozesse: eine Gruppe von Gebäuden zu Dreiecken verarbeiten.
  // a.jobs = [{ r: [Ring, ...], h: Höhe, p: Dachzahlen oder null, y0, yb }]. Ergebnis: Positionen und Normalen aller Gebäude hintereinander und je Gebäude der Anfang (-1 = nichts entstanden).
  function bestandStueck(a) {
    var S = new Sammler(false), starts = new Int32Array(a.jobs.length);
    for (var i = 0; i < a.jobs.length; i++) {
      var j = a.jobs[i], v0 = S.n / 3;
      var dach = j.p ? dachBauen(j.p) : null;
      starts[i] = sammlerSchreibe(S, j.r, j.h, dach, j.y0, j.yb) ? v0 : -1;
    }
    return { pos: S.pos.slice(0, S.n), nor: S.nor.slice(0, S.n), n: S.n, starts: starts };
  }

  // ---------- Vektorzeichnung und DXF in Hintergrundprozessen ----------
  // Projektion eines Raumpunkts (x, y = oben, z) in Bildpunkte; cam enthält die Matrizen der Kamera (wie three.js sie rechnet)
  function vProj(cam, x, y, zz) {
    var V = cam.V, P = cam.P;
    var ex = V[0] * x + V[4] * y + V[8] * zz + V[12], ey = V[1] * x + V[5] * y + V[9] * zz + V[13], ez = V[2] * x + V[6] * y + V[10] * zz + V[14];
    var w = 1 / (P[3] * ex + P[7] * ey + P[11] * ez + P[15]);
    var cx = (P[0] * ex + P[4] * ey + P[8] * ez + P[12]) * w, cy = (P[1] * ex + P[5] * ey + P[9] * ez + P[13]) * w, cz = (P[2] * ex + P[6] * ey + P[10] * ez + P[14]) * w;
    return { x: (cx * 0.5 + 0.5) * cam.B, y: (-cy * 0.5 + 0.5) * cam.H, ok: cz > -1 && cz < 1 };
  }
  function vTiefe(cam, x, y, zz) {       // je kleiner, desto weiter weg
    var V = cam.V;
    return V[2] * x + V[6] * y + V[10] * zz + V[14];
  }
  function vSchatt(cam, rgb, nx, ny, nz) {
    var f = Math.min(1, cam.hemi + cam.direkt * Math.max(0, nx * cam.L[0] + ny * cam.L[1] + nz * cam.L[2]));
    return [Math.round(rgb[0] * f), Math.round(rgb[1] * f), Math.round(rgb[2] * f)];
  }
  // Fügt ein Vieleck (Ringe aus Bildpunkten) hinzu; ganz außerhalb des Bildes oder mit unsichtbaren Ecken wird weggelassen
  function vFlaeche(cam, aus, ringe, fuell, kante, kw, gerade) {
    var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, k, i;
    for (k = 0; k < ringe.length; k++) {
      for (i = 0; i < ringe[k].length; i++) {
        var p = ringe[k][i]; if (!p.ok) { return; }
        if (p.x < minx) { minx = p.x; } if (p.x > maxx) { maxx = p.x; } if (p.y < miny) { miny = p.y; } if (p.y > maxy) { maxy = p.y; }
      }
    }
    if (maxx < 0 || minx > cam.B || maxy < 0 || miny > cam.H) { return; }
    aus.push({ r: ringe.map(function (ring) { return ring.map(function (p) { return [p.x, p.y]; }); }), f: fuell, s: kante, w: kw, e: gerade });
  }
  // Eine Gruppe von Körpern (Gebäude, eigene Baukörper, Wälder) für die Vektorzeichnung: Schatten auf dem Boden und die Flächen der Körper, bereits projiziert und
  // je Körper von hinten nach vorn geordnet. a.koerper = [{ ringe, p, h, y0, yb, rgb }], a.cam = Kamera, Licht und Einstellungen.
  function vektorStueck(a) {
    var cam = a.cam, u = cam.u, ergebnis = [], SCHATT = [196, 192, 182];
    for (var bi = 0; bi < a.koerper.length; bi++) {
      var k = a.koerper[bi];
      var ringe = k.ringe.map(function (r, i) {      // Ringe richten: Außenkante gegen den Uhrzeigersinn, Höfe im Uhrzeigersinn
        var kopie = r.slice(), gegenUhr = flaecheMeter(r) > 0;
        if ((i === 0) !== gegenUhr) { var q = []; for (var j = kopie.length - 2; j >= 0; j -= 2) { q.push(kopie[j], kopie[j + 1]); } kopie = q; }
        return kopie;
      });
      var dach = k.p ? dachBauen(k.p) : null;
      var G = dach ? koerperGeometrie(konturenAus(ringe), k.h, dach) : null;
      var y0 = k.y0, yb = k.yb, sch = [], fl = [], gi, i;
      var r0 = ringe[0], cx = 0, cy = 0, n = r0.length / 2;
      for (i = 0; i < r0.length; i += 2) { cx += r0[i]; cy += r0[i + 1]; }
      var tk = vTiefe(cam, cx / n, y0 + k.h / 2, -cy / n);
      // Schatten auf dem Boden: je Wandkante ein Parallelogramm
      if (cam.schatten) {
        if (G) {
          var W0 = G.w;
          for (var wi = 0; wi < W0.length; wi += 6) {
            var sax = W0[wi], say = W0[wi + 1], sbx = W0[wi + 3], sby = W0[wi + 4];
            var da = Math.sqrt(Math.pow(cam.sx * W0[wi + 2], 2) + Math.pow(cam.sn * W0[wi + 2], 2)), db = Math.sqrt(Math.pow(cam.sx * W0[wi + 5], 2) + Math.pow(cam.sn * W0[wi + 5], 2));
            var fa = da > cam.weite ? cam.weite / da : 1, fb = db > cam.weite ? cam.weite / db : 1;
            vFlaeche(cam, sch, [[vProj(cam, sax, y0, -say), vProj(cam, sbx, y0, -sby), vProj(cam, sbx + cam.sx * W0[wi + 5] * fb, y0, -(sby + cam.sn * W0[wi + 5] * fb)), vProj(cam, sax + cam.sx * W0[wi + 2] * fa, y0, -(say + cam.sn * W0[wi + 2] * fa))]], SCHATT, SCHATT, 0.4 * u);
          }
        } else {
          var sdx = cam.sx * k.h, sdn = cam.sn * k.h, sl = Math.sqrt(sdx * sdx + sdn * sdn);
          if (sl > cam.weite) { sdx *= cam.weite / sl; sdn *= cam.weite / sl; }
          ringe.forEach(function (r) {
            for (var i2 = 0, j2 = r.length - 2; i2 < r.length; j2 = i2, i2 += 2) {
              vFlaeche(cam, sch, [[vProj(cam, r[j2], y0, -r[j2 + 1]), vProj(cam, r[i2], y0, -r[i2 + 1]), vProj(cam, r[i2] + sdx, y0, -(r[i2 + 1] + sdn)), vProj(cam, r[j2] + sdx, y0, -(r[j2 + 1] + sdn))]], SCHATT, SCHATT, 0.4 * u);
            }
          });
        }
      }
      // Flächen des Körpers
      var WAND = [111, 107, 98], tmpFl;
      if (G) {                           // Gebäude mit Dachform: Wände und Dachdreiecke gemeinsam von hinten nach vorn
        var fl2 = [], D = G.d, W = G.w;
        for (gi = 0; gi < W.length; gi += 6) {
          var wax = W[gi], way = W[gi + 1], wbx = W[gi + 3], wby = W[gi + 4], wl = Math.sqrt((wbx - wax) * (wbx - wax) + (wby - way) * (wby - way));
          if (wl < 0.001) { continue; }
          var wnx = (wby - way) / wl, wnz = (wbx - wax) / wl;                // Wandrichtung nach außen (x, z = -Nord)
          var wsicht = cam.parallel ? wnx * cam.blick[0] + wnz * cam.blick[2] : wnx * (cam.kampos[0] - wax) + wnz * (cam.kampos[2] + way);
          if (wsicht <= 0) { continue; }
          fl2.push({ t: vTiefe(cam, (wax + wbx) / 2, y0 + (W[gi + 2] + W[gi + 5]) / 4, -(way + wby) / 2), pts: [[wax, yb, way], [wbx, yb, wby], [wbx, W[gi + 5] + y0, wby], [wax, W[gi + 2] + y0, way]], n: [wnx, 0, wnz], wand: true });
        }
        for (gi = 0; gi < D.length; gi += 9) {
          var e1x = D[gi + 3] - D[gi], e1y = D[gi + 4] - D[gi + 1], e1z = D[gi + 5] - D[gi + 2], e2x = D[gi + 6] - D[gi], e2y = D[gi + 7] - D[gi + 1], e2z = D[gi + 8] - D[gi + 2];
          var rnx = e1y * e2z - e1z * e2y, rny = e1z * e2x - e1x * e2z, rnz = e1x * e2y - e1y * e2x, rnl = Math.sqrt(rnx * rnx + rny * rny + rnz * rnz) || 1;
          rnx /= rnl; rny /= rnl; rnz /= rnl;
          if (rnz < 0) { rnx = -rnx; rny = -rny; rnz = -rnz; }
          var ex = (D[gi] + D[gi + 3] + D[gi + 6]) / 3, ey = (D[gi + 1] + D[gi + 4] + D[gi + 7]) / 3, ez = y0 + (D[gi + 2] + D[gi + 5] + D[gi + 8]) / 3;
          var rsicht = cam.parallel ? rnx * cam.blick[0] + rnz * cam.blick[1] - rny * cam.blick[2] : rnx * (cam.kampos[0] - ex) + rnz * (cam.kampos[1] - ez) - rny * (cam.kampos[2] + ey);
          if (rsicht <= 0) { continue; }
          fl2.push({ t: vTiefe(cam, ex, ez, -ey), pts: [[D[gi], D[gi + 2] + y0, D[gi + 1]], [D[gi + 3], D[gi + 5] + y0, D[gi + 4]], [D[gi + 6], D[gi + 8] + y0, D[gi + 7]]], n: [rnx, rnz, -rny], wand: false });
        }
        fl2.sort(function (p, q) { return p.t - q.t; });
        fl2.forEach(function (f) {
          var fu = vSchatt(cam, k.rgb, f.n[0], f.n[1], f.n[2]);
          vFlaeche(cam, fl, [f.pts.map(function (q) { return vProj(cam, q[0], q[1], -q[2]); })], fu, f.wand ? WAND : fu, f.wand ? 0.35 * u : 0.5 * u);
        });
      } else {
        var waende = [];
        ringe.forEach(function (r) {
          for (var i3 = 0, j3 = r.length - 2; i3 < r.length; j3 = i3, i3 += 2) {
            var ax = r[j3], ay = r[j3 + 1], bx = r[i3], by = r[i3 + 1], dx = bx - ax, dy = by - ay, l = Math.sqrt(dx * dx + dy * dy);
            if (l < 0.01) { continue; }
            var nx = dy / l, nz = dx / l;                          // nach außen (Außenkante gegen den Uhrzeigersinn); z = -Nord
            var sicht = cam.parallel ? nx * cam.blick[0] + nz * cam.blick[2] : nx * (cam.kampos[0] - ax) + nz * (cam.kampos[2] + ay);
            if (sicht <= 0) { continue; }
            waende.push({ t: vTiefe(cam, (ax + bx) / 2, y0 + k.h / 2, -(ay + by) / 2), a: [ax, ay], b: [bx, by], n: [nx, 0, nz] });
          }
        });
        waende.sort(function (p, q) { return p.t - q.t; });
        waende.forEach(function (w) {
          vFlaeche(cam, fl, [[vProj(cam, w.a[0], yb, -w.a[1]), vProj(cam, w.b[0], yb, -w.b[1]), vProj(cam, w.b[0], y0 + k.h, -w.b[1]), vProj(cam, w.a[0], y0 + k.h, -w.a[1])]],
            vSchatt(cam, k.rgb, w.n[0], w.n[1], w.n[2]), WAND, 0.35 * u);
        });
        var dachFl = vSchatt(cam, k.rgb, 0, 1, 0);
        vFlaeche(cam, fl, ringe.map(function (r) { var q = []; for (var i4 = 0; i4 < r.length; i4 += 2) { q.push(vProj(cam, r[i4], y0 + k.h, -r[i4 + 1])); } return q; }), dachFl, WAND, 0.35 * u, true);
      }
      ergebnis.push({ t: tk, sch: sch, fl: fl });
    }
    return { koerper: ergebnis };
  }

  // 3D-Flächen (DXF) einer Gruppe von Körpern. a.koerper = [{ ringe, p, h, y0, yb, ebene }]. Ergebnis: der Text der Einträge.
  function dxfF3(x) { return (Math.round(x * 1000) / 1000).toString(); }
  function dxfFlaeche(ebene, p1, p2, p3, p4) {
    var q = p4 || p3;
    return "0\n3DFACE\n8\n" + ebene + "\n10\n" + dxfF3(p1[0]) + "\n20\n" + dxfF3(p1[1]) + "\n30\n" + dxfF3(p1[2]) + "\n11\n" + dxfF3(p2[0]) + "\n21\n" + dxfF3(p2[1]) + "\n31\n" + dxfF3(p2[2]) +
           "\n12\n" + dxfF3(p3[0]) + "\n22\n" + dxfF3(p3[1]) + "\n32\n" + dxfF3(p3[2]) + "\n13\n" + dxfF3(q[0]) + "\n23\n" + dxfF3(q[1]) + "\n33\n" + dxfF3(q[2]) + "\n";
  }
  function dxfKoerperStueck(a) {
    var teile = [];
    for (var bi = 0; bi < a.koerper.length; bi++) {
      var k = a.koerper[bi], ringe = k.ringe.map(function (r, i) {
        var kopie = r.slice(), gegenUhr = flaecheMeter(r) > 0;
        if ((i === 0) !== gegenUhr) { var q = []; for (var j = kopie.length - 2; j >= 0; j -= 2) { q.push(kopie[j], kopie[j + 1]); } kopie = q; }
        if (kopie.length > 4 && kopie[0] === kopie[kopie.length - 2] && kopie[1] === kopie[kopie.length - 1]) { kopie.length -= 2; }
        return kopie;
      }).filter(function (r) { return r.length >= 6; });
      if (!ringe.length) { continue; }
      var yy0 = k.y0, yyb = k.yb, G = koerperGeometrie(konturenAus(ringe), k.h, k.p ? dachBauen(k.p) : null), gi;
      if (!G) { continue; }
      var D = G.d, W = G.w, ebene = k.ebene;
      for (gi = 0; gi < D.length; gi += 9) { teile.push(dxfFlaeche(ebene, [D[gi], D[gi + 1], D[gi + 2] + yy0], [D[gi + 3], D[gi + 4], D[gi + 5] + yy0], [D[gi + 6], D[gi + 7], D[gi + 8] + yy0])); }
      for (gi = 0; gi < W.length; gi += 6) { teile.push(dxfFlaeche(ebene, [W[gi], W[gi + 1], yyb], [W[gi + 3], W[gi + 4], yyb], [W[gi + 3], W[gi + 4], W[gi + 5] + yy0], [W[gi], W[gi + 1], W[gi + 2] + yy0])); }
    }
    return { text: teile.join("") };
  }

  // ---------- Mehrere Threads (Web Worker) ----------
  // Schwere Rechnungen (Gebäude zu Dreiecken, Höhenraster, Fassadenpunkte, Vektorzeichnung, DXF) laufen in Hintergrundprozessen, die sich
  // auf die Prozessorkerne verteilen. Die Funktionen dafür stehen in ARBEITER_FUNKTIONEN (als Text in die Worker kopiert, ohne three.js und
  // ohne Zugriff auf die Seite); die Aufgaben, die man von außen anstoßen kann, in ARBEITER_AUFGABEN. Geht das Starten von Hintergrundprozessen nicht
  // (zum Beispiel in einer streng eingestellten Umgebung), rechnet die Seite dieselben Funktionen selbst, Stück für Stück, damit sie nicht einfriert.
  var ARBEITER_FUNKTIONEN = [flaecheMeter, ecKnoten, ecEinfuegen, ecEntfernen, ecFlaeche, ecGleich, ecVorzeichen, ecVorzeichenFlaeche, ecListe, ecFiltern,
    ecPunktImDreieck, ecIstOhr, ecSchneidet, ecAufStrecke, ecSchneidetVieleck, ecLokalInnen, ecMitteInnen, ecGueltigeDiagonale, ecPolygonTeilen,
    ecLokaleSchnitteHeilen, ecTeilen, ecOhrenSchneiden, ecLinkester, ecSektorEnthaeltSektor, ecLochBruecke, ecLochEntfernen, ecLoecherEntfernen, ecTriangulieren,
    dachBauen, schneideVieleck, teileDreieck, konturenAus, koerperGeometrie, Sammler, sammlerPlatz, sammlerPunkt, sammlerSchreibe, bestandStueck,
    imVieleck, gelaendeProbe, hoehenStueck, fassadenStueck,
    vProj, vTiefe, vSchatt, vFlaeche, vektorStueck, dxfF3, dxfFlaeche, dxfKoerperStueck];
  var ARBEITER_AUFGABEN = [bestandStueck, hoehenStueck, fassadenStueck, vektorStueck, dxfKoerperStueck];
  var arbeiterPool = null;

  function arbeiterQuelle() {
    var teile = ARBEITER_FUNKTIONEN.map(function (f) { return f.toString(); });
    teile.push("Sammler.prototype.platz = sammlerPlatz; Sammler.prototype.punkt = sammlerPunkt;");
    teile.push("var ARBEITER = {" + ARBEITER_AUFGABEN.map(function (f) { return f.name + ":" + f.name; }).join(",") + "};");
    teile.push("self.onmessage = function (e) { var d = e.data; try { var r = ARBEITER[d.fn](d.arg); var tb = [];" +
      " for (var k in r) { if (r[k] && r[k].buffer instanceof ArrayBuffer && tb.indexOf(r[k].buffer) < 0) { tb.push(r[k].buffer); } }" +
      " self.postMessage({ id: d.id, r: r }, tb); } catch (x) { self.postMessage({ id: d.id, fehler: String(x && x.message || x) }); } };");
    return teile.join("\n");
  }

  function arbeiterStarten() {
    if (arbeiterPool) { return arbeiterPool; }
    var anzahl = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    var p = { arbeiter: [], warte: [], laufend: {}, nr: 0, geht: false, url: null, anzahl: anzahl };
    arbeiterPool = p;
    try {
      p.url = URL.createObjectURL(new Blob([arbeiterQuelle()], { type: "text/javascript" }));
      for (var i = 0; i < anzahl; i++) {
        var w = new Worker(p.url);
        w.aufgabe = null;
        w.onmessage = function (e) { arbeiterFertig(p, this, e.data); };
        w.onerror = function (e) { if (e && e.preventDefault) { e.preventDefault(); } arbeiterAusgefallen(p); };
        p.arbeiter.push(w);
      }
      p.geht = true;
    } catch (x) { arbeiterAusgefallen(p); }
    return p;
  }
  function arbeiterAusgefallen(p) {         // Hintergrundprozesse gehen nicht: alles Laufende und Wartende selbst rechnen
    if (!p.geht && !p.arbeiter.length && !Object.keys(p.laufend).length && !p.warte.length) { p.geht = false; return; }
    p.geht = false;
    var offen = p.warte.slice();
    Object.keys(p.laufend).forEach(function (k) { offen.push(p.laufend[k]); });
    p.warte = []; p.laufend = {};
    p.arbeiter.forEach(function (w) { w.terminate(); });
    p.arbeiter = [];
    offen.forEach(function (t) { arbeiterSelbst(t); });
  }
  function arbeiterSelbst(t) {              // dieselbe Funktion im Hauptprogramm, aber erst nach einer Atempause für die Seite
    window.setTimeout(function () {
      try { t.erfuellt(ARBEITER_AUFGABEN.filter(function (f) { return f.name === t.fn; })[0](t.arg)); } catch (x) { t.abgelehnt(x); }
    }, 0);
  }
  function arbeiterNaechste(p) {
    if (!p.geht) { return; }
    for (var i = 0; i < p.arbeiter.length && p.warte.length; i++) {
      var w = p.arbeiter[i];
      if (w.aufgabe) { continue; }
      var t = p.warte.shift();
      w.aufgabe = t; p.laufend[t.id] = t;
      w.postMessage({ id: t.id, fn: t.fn, arg: t.arg }, t.uebertragen || []);
    }
  }
  function arbeiterFertig(p, w, antwort) {
    var t = p.laufend[antwort.id];
    delete p.laufend[antwort.id]; w.aufgabe = null;
    if (t) { if (antwort.fehler) { t.abgelehnt(new Error(antwort.fehler)); } else { t.erfuellt(antwort.r); } }
    arbeiterNaechste(p);
  }
  // Stößt eine Aufgabe an: fn = Name einer Funktion aus ARBEITER_AUFGABEN, arg = ihre Eingabe (wird kopiert; Typed Arrays in "uebertragen" wandern ohne Kopie).
  // Gibt ein Versprechen mit dem Ergebnis zurück.
  function arbeiterAufgabe(fn, arg, uebertragen) {
    var p = arbeiterStarten();
    return new Promise(function (erfuellt, abgelehnt) {
      var t = { id: ++p.nr, fn: fn, arg: arg, uebertragen: uebertragen, erfuellt: erfuellt, abgelehnt: abgelehnt };
      if (!p.geht) { arbeiterSelbst(t); return; }
      p.warte.push(t);
      arbeiterNaechste(p);
    });
  }
  function arbeiterSchliessen() {
    var p = arbeiterPool;
    if (!p) { return; }
    arbeiterPool = null;
    p.geht = false;
    p.arbeiter.forEach(function (w) { w.terminate(); });
    if (p.url) { URL.revokeObjectURL(p.url); }
  }

  // Arbeitet eine Liste Stück für Stück im Hauptprogramm ab und gibt der Seite dazwischen kurz Luft (damit sie nicht einfriert). Gibt ein Versprechen zurück.
  function inScheiben(liste, tun) {
    return new Promise(function (erfuellt, abgelehnt) {
      var i = 0;
      function weiter() {
        try {
          var ende = performance.now() + 12;
          while (i < liste.length) { tun(liste[i++]); if (performance.now() > ende) { break; } }
        } catch (x) { abgelehnt(x); return; }
        if (i < liste.length) { window.setTimeout(weiter, 0); } else { erfuellt(); }
      }
      weiter();
    });
  }
  // Verteilt eine Liste von Körpern auf die Hintergrundprozesse (Aufgabe fn bekommt { koerper: Stück, ...extra }) und gibt die Ergebnisse in der ursprünglichen Reihenfolge zurück
  function arbeiterListe(fn, liste, extra) {
    var p = arbeiterStarten(), stueck = Math.max(100, Math.ceil(liste.length / (p.anzahl * 4))), aufgaben = [];
    for (var von = 0; von < liste.length; von += stueck) {
      var arg = { koerper: liste.slice(von, von + stueck) };
      for (var k in extra) { arg[k] = extra[k]; }
      aufgaben.push(arbeiterAufgabe(fn, arg));
    }
    if (!aufgaben.length) { return Promise.resolve([]); }
    return Promise.all(aufgaben).then(function (teile) {
      var alle = [];
      teile.forEach(function (t) { if (t.koerper) { t.koerper.forEach(function (x) { alle.push(x); }); } else { alle.push(t); } });
      return alle;
    });
  }
  // Verteilt eine Liste von Gebäuden auf die Hintergrundprozesse und setzt die Dreiecke in der ursprünglichen Reihenfolge zusammen.
  // Ergebnis: { pos, nor (Float32Array), anzahl (Zahlen), gruppen: [{ v0, info }] }
  function bestandDreiecke(jobs, infos) {
    var p = arbeiterStarten(), stueck = Math.max(250, Math.ceil(jobs.length / (p.anzahl * 4))), aufgaben = [];
    for (var von = 0; von < jobs.length; von += stueck) {
      (function (von) {
        aufgaben.push(arbeiterAufgabe("bestandStueck", { jobs: jobs.slice(von, von + stueck) }).then(function (r) { r.von = von; return r; }));
      })(von);
    }
    return Promise.all(aufgaben).then(function (teile) {
      var gesamt = 0, i, j;
      teile.forEach(function (t) { gesamt += t.n; });
      var pos = new Float32Array(gesamt), nor = new Float32Array(gesamt), gruppen = [], basis = 0;
      teile.forEach(function (t) {
        pos.set(t.pos, basis); nor.set(t.nor, basis);
        for (j = 0; j < t.starts.length; j++) { if (t.starts[j] >= 0) { gruppen.push({ v0: basis / 3 + t.starts[j], info: infos[t.von + j] }); } }
        basis += t.n;
      });
      return { pos: pos, nor: nor, anzahl: gesamt, gruppen: gruppen };
    });
  }

  // Eigene Baukörper: Flächen (Grundriss = die Fläche) und Punkte (Säule mit Kreis als Grundriss, Durchmesser in Metern, Standard 2 m)
  function eigeneFlaechen() {
    return (typeof zeichnung !== "undefined" ? zeichnung : []).filter(function (o) {
      return (o.art === "flaeche" && !o.mass && o.punkte && o.punkte.length >= 3) || (o.art === "punkt" && o.punkte && o.punkte.length);
    });
  }
  // Ecken des Grundrisses als Liste [Breite, Länge, ...]; bei einem Punkt ein Kreis mit 32 Ecken
  function koerperEcken(o) {
    var z = zustand, r = [];
    if (o.art === "punkt") {
      var rad = (o.durchmesser > 0 ? o.durchmesser : 2) / 2, p = o.punkte[0];
      for (var i = 0; i < 32; i++) {
        var w = i / 32 * 2 * Math.PI;
        r.push(p.lat + Math.sin(w) * rad / z.mLat, p.lng + Math.cos(w) * rad / z.mLng);
      }
    } else { o.punkte.forEach(function (q) { r.push(q.lat, q.lng); }); }
    return r;
  }

  function baueModell() {
    var z = zustand, THREE = window.THREE;
    z.el("a3dStatus").textContent = "Modell wird aufgebaut …";
    z.el("a3dStatus").hidden = false;
    z.radius = +z.el("a3dRadius").value;
    window.setTimeout(function () {
     gelaendeVorbereiten(z).then(function () {
      if (zustand !== z) { return; }
      leereModell();
      z.koerper = []; z.hk = null; z.hkVorgang = null;      // Körper des Modells (für die Schattenprüfung)
      sonneVeraltet();                  // ein berechnetes Ergebnis passt nach einer Änderung nicht mehr
      z.el("a3dSonneInfo").textContent = sonneInfoText();
      var R = z.radius;

      // Boden
      var bodenMat = new THREE.MeshLambertMaterial({ color: 0xeceae5 });
      if (z.gelaende) { z.gelMax = Math.max(0, gelaendeSpanne(R)[1] - z.gelBasis); }          // höchstes Gelände im Ausschnitt über der Mitte
      var boden = new THREE.Mesh(bodenGeometrie(R), bodenMat);
      boden.receiveShadow = true;
      z.modell.add(boden);
      z.boden = boden;

      // Gebäude
      var liste = entpacke();
      var dLat = R / z.mLat, dLng = R / z.mLng;
      var art = z.el("a3dHoehenart").value;
      var eigene = eigeneFlaechen().filter(function (o) { return o.hoehe > 0; });
      var eigeneMeter = eigene.map(function (o) { return inMeter(koerperEcken(o)); });
      var ausblenden = z.el("a3dAusblenden").checked && eigene.length > 0;
      var jobs = [], infos = [], anzahl = 0, ausgeblendet = 0, weggelassen = 0, dachZahl = [0, 0, 0, 0, 0];
      // Bei großen Ausschnitten kleine Gebäude weglassen (Schuppen, Garagen), sonst wird es zu schwer
      var kleinsteFlaeche = R <= 1500 ? 0 : (R <= 3000 ? 20 : 40);
      liste.forEach(function (g) {
        if (Math.abs(g.lat - z.mitte.lat) > dLat || Math.abs(g.lng - z.mitte.lng) > dLng) { return; }
        var ringe = R > 1500 ? [inMeter(g.ringe[0])] : g.ringe.map(inMeter);   // Innenhöfe nur bei kleinen Ausschnitten
        if (kleinsteFlaeche && Math.abs(flaecheMeter(ringe[0])) < kleinsteFlaeche) { weggelassen++; return; }
        if (ausblenden) {
          var cx = (g.lng - z.mitte.lng) * z.mLng, cy = (g.lat - z.mitte.lat) * z.mLat, weg = false;
          for (var i = 0; i < eigeneMeter.length && !weg; i++) {
            if (imVieleck(cx, cy, eigeneMeter[i])) { weg = true; break; }
            var ex = 0, ey = 0, em = eigeneMeter[i], n = em.length / 2;
            for (var k = 0; k < em.length; k += 2) { ex += em[k]; ey += em[k + 1]; }
            if (imVieleck(ex / n, ey / n, ringe[0])) { weg = true; }
          }
          if (weg) { ausgeblendet++; return; }
        }
        var h = art === "first" ? g.f : (art === "trauf" ? g.t : (g.t + g.f) / 2);
        var hm = Math.max(1.5, h);
        var dach = null;
        if (art === "dach" && g.t >= 1.5) { dach = dachErzeugen(ringe, g.t, g.f, g.cls, g.ang); }
        if (dach) { dachZahl[dach.art]++; } else { dachZahl[0]++; }
        var gr = gruendung(ringe[0]);
        jobs.push({ r: ringe, h: hm, p: dach ? dach.p : null, y0: gr.y0, yb: gr.yb });      // die Dreiecke entstehen unten in den Hintergrundprozessen
        infos.push({ art: "bestand", t: g.t, f: g.f, h: hm, hf: dach ? dach.hf : null, y0: gr.y0, dach: dach ? dach.name : (art === "dach" && g.cls ? "Flachdach (vereinfacht)" : "") });
        z.koerper.push({ ringe: ringe, h: hm, dach: dach, y0: gr.y0, yb: gr.yb });
        anzahl++;
      });
      var modellNr = z.modellNr = (z.modellNr || 0) + 1;
      z.el("a3dStatus").textContent = "Gebäude werden berechnet …";
      bestandDreiecke(jobs, infos).then(function (erg) {
      if (zustand !== z || modellNr !== z.modellNr) { return; }          // inzwischen wurde ein neues Modell angefordert
      if (anzahl && erg.anzahl) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(erg.pos, 3));
        geo.setAttribute("normal", new THREE.BufferAttribute(erg.nor, 3));
        var m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xf4f1ea, side: THREE.DoubleSide }));
        m.castShadow = true; m.receiveShadow = true;
        m.userData.gruppen = erg.gruppen;
        z.modell.add(m);
      }

      // Eigene Baukörper, jeder mit seiner Farbe
      eigene.forEach(function (o, i) {
        var s = new Sammler(), gr = gruendung(eigeneMeter[i]);
        s.addiere([eigeneMeter[i]], o.hoehe, null, null, gr.y0, gr.yb);
        if (!s.n) { return; }
        var m2 = new THREE.Mesh(s.gebaeude(), new THREE.MeshLambertMaterial({ color: new THREE.Color(o.farbe || "#c0392b"), side: THREE.DoubleSide }));
        m2.castShadow = true; m2.receiveShadow = true;
        m2.userData.info = { art: "eigen", name: o.name || "", h: o.hoehe, y0: gr.y0 };
        z.koerper.push({ ringe: [eigeneMeter[i]], h: o.hoehe, eigen: true, name: o.name || "", farbe: o.farbe || "#c0392b", y0: gr.y0, yb: gr.yb });
        z.modell.add(m2);
      });

      hoehenkarteAsync();             // das Höhenraster für Schatten im Hintergrund vorrechnen
      z.el("a3dModellInfo").textContent = anzahl + " Gebäude im Umkreis von " + R + " m" +
        (eigene.length ? ", " + eigene.length + " eigene" + (eigene.length === 1 ? "r Baukörper" : " Baukörper") : "") +
        (ausgeblendet ? " (" + ausgeblendet + " Bestandsgebäude ausgeblendet)" : "") + "." +
        (art === "dach" ? " Dächer: " + dachZahl[1] + " Sattel, " + dachZahl[2] + " Walm, " + dachZahl[3] + " Zelt, " + dachZahl[4] + " Pult, " + dachZahl[0] + " flach oder zu unregelmäßig." : "") +
        (weggelassen ? " Zur Beschleunigung weggelassen: " + weggelassen + " kleine Gebäude unter " + kleinsteFlaeche + " m²." : "") +
        (z.gelaende ? " Gelände: " + gelaendeSpanne(R).map(function (v) { return v.toFixed(1).replace(".", ","); }).join(" bis ") + " m über NHN." : "") + z.gelFehler;
      baueListe();
      speicherFelder();               // Größe der DXF-Datei und Hinweise zum Ausschnitt neu berechnen

      // Kamera passend zum Ausschnitt
      z.dist = R * 1.75;
      z.ziel.set(0, 0, 0);

      // Karte (mit den eingeschalteten Analysedaten) auf den Boden legen, Pfähle für die Punkte stellen
      punkteAufbauen();
      baeumeAufbauen();
      waldAufbauen();
      bodenAufbauen().then(function () {
        if (zustand !== z) { return; }
        z.el("a3dStatus").hidden = true;
        sonneAnwenden();
      });
      });
     });
    }, 30);
  }

  // Lädt (falls gewünscht) das Gelände und richtet z.gh ein; bei einem Fehler steht das Modell auf ebenem Boden
  // Die Geländedaten werden immer geladen: Die Höhen der Gebäude in der Datei sind Höhen über NHN und werden damit auf den Boden bezogen
  // (siehe hoehenKorrigieren). Der Haken "Gelände" bestimmt nur, ob das Relief im Modell zu sehen ist.
  function gelaendeVorbereiten(z) {
    z.gelFehler = "";
    var relief = z.el("a3dGelaende").checked;
    z.el("a3dStatus").textContent = "Gelände wird geladen …";
    return gelaendeLaden().then(function (G) { hoehenKorrigieren(G); gelaendeEinrichten(z, relief ? G : null); }, function (x) {
      gelaendeEinrichten(z, null);
      z.el("a3dGelaende").checked = false;
      z.gelFehler = " Das Gelände konnte nicht geladen werden (" + (x && x.message ? x.message : "Datei gelaende_oldenburg.js fehlt oder ist beschädigt") + "), das Modell steht auf ebenem Boden und die Gebäudehöhen sind dann um die Geländehöhe (in Oldenburg etwa 0 bis 20 m) zu hoch.";
    });
  }
  // Höhen in der Gebäudedatei (Traufe, First) sind Höhen über NHN, nicht über dem Boden (geprüft: sie steigen mit der Geländehöhe, Traufe minus
  // Gelände ergibt im Median 3,6 m). Hier einmal je Gebäude die Geländehöhe an der Gebäudemitte abziehen.
  var gebaeudeKorrigiert = false;
  function hoehenKorrigieren(G) {
    if (gebaeudeKorrigiert || !G) { return; }
    var liste = entpacke();
    for (var i = 0; i < liste.length; i++) {
      var g = liste[i], q = utm32(g.lat, g.lng);
      var c = Math.round((q.e - G.e0) / G.schritt - 0.5), r = Math.round((G.n1 - q.n) / G.schritt - 0.5);
      c = c < 0 ? 0 : (c > G.W - 1 ? G.W - 1 : c); r = r < 0 ? 0 : (r > G.H - 1 ? G.H - 1 : r);
      var boden = G.h[r * G.W + c] / 10;
      g.t = Math.max(0.5, g.t - boden); g.f = Math.max(g.t, g.f - boden);
    }
    gebaeudeKorrigiert = true;
  }
  // Kleinste und größte Geländehöhe im Ausschnitt (über NHN), grob abgetastet
  function gelaendeSpanne(R) {
    var z = zustand, mn = 1e9, mx = -1e9;
    for (var i = 0; i <= 20; i++) { for (var j = 0; j <= 20; j++) { var v = z.ghAbs(-R + 2 * R * i / 20, -R + 2 * R * j / 20); if (v < mn) { mn = v; } if (v > mx) { mx = v; } } }
    return [mn, mx];
  }

  // Zeichnet das Kartenbild (Hintergrund, Flächen, Linien, Zeichnung ...) neu und legt es auf den Boden.
  // Punkte (Haltestellen, Einrichtungen) werden dabei weggelassen, sie stehen als Pfähle im Modell.
  function bodenAufbauen() {
    var z = zustand, THREE = window.THREE;
    if (!z || !z.boden) { return Promise.resolve(); }
    var boden = z.boden, token = ++z.bodenToken, R = z.radius;
    if (!z.el("a3dKarte").checked || typeof erstelleKartenbild !== "function") {
      if (boden.material.map) { boden.material.map.dispose(); boden.material.map = null; boden.material.emissiveMap = null; boden.material.emissive.set(0x000000); boden.material.color.set(0xeceae5); boden.material.needsUpdate = true; }
      return Promise.resolve();
    }
    z.el("a3dStatus").textContent = "Karte wird gezeichnet …";
    z.el("a3dStatus").hidden = false;
    var pixel = R > 1500 ? Math.min(4096, z.renderer.capabilities.maxTextureSize || 2048) : TEXTUR_PIXEL;
    // Linien, Schilder und Zeichnung der Karte sind in Millimetern auf dem Papier bemessen. Ein kleiner Papier-Maßstab
    // (Ausschnitt 2·R Meter auf einem kleinen "Blatt") macht sie im Modell groß genug, um sie von oben zu erkennen.
    var massstab = Math.max(1000, Math.round(R * 13));
    var breiteMm = 2 * R * 1000 / massstab;
    var dpi = pixel * 25.4 / breiteMm;
    var e = {
      massstab: massstab, papier: "A4", quer: true, breiteMm: breiteMm, hoeheMm: breiteMm, dpi: dpi, format: "png", titel: "", ohnePunkte: true, ohneKoerper: true, ohneSonnenstunden: true,
      kraeftig: Math.max(0.001, +z.el("a3dFarbstaerke").value),
      zeige: { titel: false, nordpfeil: false, legende: false, balken: false, quelle: false }
    };
    return erstelleKartenbild(e, z.mitte, aktiveQuelle()).then(function (erg) {
      if (zustand !== z || token !== z.bodenToken || z.boden !== boden) { return; }
      var tex = new THREE.CanvasTexture(erg.leinwand);
      tex.anisotropy = 8;
      if (boden.material.map) { boden.material.map.dispose(); }
      boden.material.map = tex;
      boden.material.color.set(0xffffff);
      // Das Bild leuchtet ein wenig von selbst, damit die Farben auch bei tiefer Sonne und im Schatten gut zu erkennen sind
      boden.material.emissive.set(0xffffff);
      boden.material.emissiveMap = tex;
      boden.material.emissiveIntensity = +z.el("a3dBodenHell").value / 100;
      boden.material.needsUpdate = true;
    }).catch(function () {});
  }

  // Haltestellen, Einrichtungen und Naturdenkmale: ein Pfahl mit farbiger Kugel je Punkt
  function punkteAufbauen() {
    var z = zustand, THREE = window.THREE;
    if (!z) { return; }
    var token = ++z.punktToken, R = z.radius;
    var jobs = [], liste = [];
    if (typeof OEPNV !== "undefined" && karte.hasLayer(OEPNV.ebene)) {
      jobs.push(ladeOepnvDaten().then(function (pts) {
        pts.forEach(function (p) { liste.push({ lat: p.lat, lng: p.lng, farbe: OEPNV.farbe, gross: p.bahn, info: { art: "halt", lat: p.lat, lng: p.lng } }); });
      }));
      jobs.push(ladeFahrplanDaten().catch(function () { return null; }));      // für Name und Linien beim Anklicken
    }
    var eg = EINRICHTUNGEN.filter(function (g) { return karte.hasLayer(g.ebene); });
    if (eg.length) {
      jobs.push(ladeEinrichtungenDaten().then(function (d) {
        eg.forEach(function (g) { d[g.id].forEach(function (p) { liste.push({ lat: p.lat, lng: p.lng, farbe: g.farbe, gross: false, info: { art: "text", text: g.legende } }); }); });
      }));
    }
    var mg = MOBILITAET.filter(function (g) { return g.art === "punkt" && karte.hasLayer(g.ebene); });
    if (mg.length) {
      jobs.push(ladeMobilitaetDaten().then(function (d) {
        mg.forEach(function (g) { (d[g.id].punkte || []).forEach(function (p) { liste.push({ lat: p.lat, lng: p.lng, farbe: g.farbe, gross: false, info: g.lader ? { art: "lader", p: p } : { art: "text", text: g.legende } }); }); });
      }));
    }
    var sg = SPIEL.filter(function (g) { return g.art === "punkt" && karte.hasLayer(g.ebene); });
    if (sg.length) {
      jobs.push(ladeSpielDaten().then(function (d) {
        sg.forEach(function (g) { (d.orte[g.id] || []).forEach(function (o) { liste.push({ lat: o.lat, lng: o.lng, farbe: g.farbe, gross: false, info: { art: "text", text: o.art + (o.name ? ": " + o.name : "") } }); }); });
      }));
    }
    if (karte.hasLayer(LUFT.ebene)) {
      jobs.push(ladeLuftDaten().then(function (st) {
        st.forEach(function (s) { liste.push({ lat: s.lat, lng: s.lng, farbe: LUFT.farbe, gross: true, info: { art: "luft", s: s } }); });
      }));
    }
    if (karte.hasLayer(TAKT.ebene)) {
      jobs.push(ladeFahrplanDaten().then(function (halte) {
        halte.forEach(function (h) { liste.push({ lat: h.lat, lng: h.lng, farbe: taktKlasse(h).farbe, gross: taktKlasse(h).ab >= 6, info: { art: "halt", h: h } }); });
      }));
    }
    var fg = FLAECHEN.filter(function (g) { return g.punkte && karte.hasLayer(g.ebene); });
    if (fg.length) {
      jobs.push(ladeFlaechenDaten(fg).then(function (d) {
        fg.forEach(function (g) { (d[g.id] || []).forEach(function (p) { liste.push({ lat: p.lat, lng: p.lng, farbe: g.farbe, gross: false, info: { art: "text", text: g.legende || g.name } }); }); });
      }));
    }
    Promise.all(jobs).then(function () {
      if (zustand !== z || token !== z.punktToken) { return; }
      punkteLeeren();
      punktInfoZu();
      z.punktListe = [];
      var dLat = R / z.mLat, dLng = R / z.mLng;
      var im = liste.filter(function (p) { return Math.abs(p.lat - z.mitte.lat) <= dLat && Math.abs(p.lng - z.mitte.lng) <= dLng; });
      if (im.length) {
        var rk = Math.max(2.2, R / 150), hoehe = Math.max(26, R * 0.05), rm = rk * 0.18;
        var kugel = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), new THREE.MeshBasicMaterial({ color: 0xffffff }), im.length);
        var zyl = new THREE.CylinderGeometry(1, 1, 1, 6); zyl.translate(0, 0.5, 0);
        var mast = new THREE.InstancedMesh(zyl, new THREE.MeshBasicMaterial({ color: 0xffffff }), im.length);
        var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), skal = new THREE.Vector3(), farbe = new THREE.Color();
        im.forEach(function (p, i) {
          var x = (p.lng - z.mitte.lng) * z.mLng, nord = (p.lat - z.mitte.lat) * z.mLat, s = p.gross ? rk * 1.5 : rk, g0 = z.gh(x, nord);
          pos.set(x, g0, -nord); skal.set(rm, hoehe, rm); m4.compose(pos, q, skal); mast.setMatrixAt(i, m4);
          pos.set(x, g0 + hoehe + s * 0.6, -nord); skal.set(s, s, s); m4.compose(pos, q, skal); kugel.setMatrixAt(i, m4);
          z.punktListe.push({ pos: new THREE.Vector3(x, g0 + hoehe + s * 0.6, -nord), r: s, info: p.info });
          farbe.set(p.farbe); kugel.setColorAt(i, farbe); mast.setColorAt(i, farbe.clone().multiplyScalar(0.7));
        });
        kugel.instanceMatrix.needsUpdate = true; mast.instanceMatrix.needsUpdate = true;
        kugel.instanceColor.needsUpdate = true; mast.instanceColor.needsUpdate = true;
        z.punktGruppe.add(mast); z.punktGruppe.add(kugel);
      }
      z.punktAnzahl = im.length;
      zeichne();
    }).catch(function () {
      if (zustand === z) { z.el("a3dAnalyseHinweis").textContent = "Eine Datei mit Punkten (Haltestellen oder Einrichtungen) fehlt oder ist beschädigt."; }
    });
  }
  // ---------- Punkte anklicken (Haltestellen: Name und Linien; Ladestationen: Betreiber und Leistung) ----------
  function punktInfoZu() {
    var z = zustand, k = z && z.el("a3dPunktInfo");
    if (k) { k.hidden = true; k.innerHTML = ""; }
  }
  // Sucht die Kugel, die dem Klick am nächsten liegt (bis 14 Bildschirmpunkte, bei großen Kugeln deren Rand), und zeigt ein Fenster
  function punktKlick(cx, cy) {
    var z = zustand, THREE = window.THREE, kam = z.aktuelleKamera;
    punktInfoZu();
    if (!kam || !z.punktListe || !z.punktListe.length) { return; }
    var r = z.bild.getBoundingClientRect(), beste = null, bd = 1e9, v = new THREE.Vector3(), rand = new THREE.Vector3();
    z.punktListe.forEach(function (p) {
      v.copy(p.pos).project(kam);
      if (v.z < -1 || v.z > 1) { return; }
      var sx = (v.x * 0.5 + 0.5) * r.width, sy = (-v.y * 0.5 + 0.5) * r.height;
      // Radius der Kugel auf dem Bildschirm (ein Punkt seitlich der Kugel, in Kamera-Richtung nach rechts)
      rand.set(1, 0, 0).transformDirection(kam.matrixWorld).multiplyScalar(p.r).add(p.pos).project(kam);
      var pr = Math.abs((rand.x * 0.5 + 0.5) * r.width - sx);
      var d = Math.hypot(sx - (cx - r.left), sy - (cy - r.top));
      var grenze = Math.max(14, pr + 6);
      if (d <= grenze && d - pr < bd) { bd = d - pr; beste = p; }
    });
    if (!beste || !beste.info) { return; }
    var info = beste.info, inhalt = null;
    if (info.art === "halt") { inhalt = haltestellenPopup(info.h || fahrplanNaechste(info.lat, info.lng, 90)); }
    else if (info.art === "lader") { inhalt = ladestationPopup(info.p); }
    else if (info.art === "luft") { inhalt = luftPopup(info.s); }
    else if (info.art === "text") { inhalt = document.createElement("div"); inhalt.textContent = info.text; }
    if (!inhalt) { return; }
    var kasten = z.el("a3dPunktInfo"), zu = document.createElement("button");
    zu.type = "button"; zu.className = "zu"; zu.textContent = "✕"; zu.title = "Schließen";
    zu.addEventListener("click", punktInfoZu);
    kasten.appendChild(zu); kasten.appendChild(inhalt);
    kasten.hidden = false;
    var fl = z.el("a3dFlaeche").getBoundingClientRect();
    var x = cx - fl.left + 12, y = cy - fl.top + 12;
    x = Math.max(6, Math.min(x, fl.width - kasten.offsetWidth - 6)); y = Math.max(6, Math.min(y, fl.height - kasten.offsetHeight - 6));
    kasten.style.left = x + "px"; kasten.style.top = y + "px";
  }
  function punkteLeeren() {
    var z = zustand;
    while (z.punktGruppe.children.length) {
      var k = z.punktGruppe.children.pop();
      if (k.geometry) { k.geometry.dispose(); }
      if (k.material) { k.material.dispose(); }
      if (k.dispose) { k.dispose(); }
    }
  }

  // ---------- Bäume (OpenStreetMap-Einzelbäume und eigene Bäume aus der Zeichnung) ----------
  var BAUM_HOEHE_STANDARD = 12;          // Meter, wenn die Daten keine Höhe kennen
  var BAUM_DAEMPFUNG = 0.5;              // Lichtschwächung je Meter Krone bei voller Belaubung (8 m Krone lassen ca. 2 % Licht durch)

  // Die Baumdatei lädt die Hauptseite (gleiche Daten wie die Ebene "Bäume" in der Karte)
  function baeumeLaden() { return ladeBaeumeDaten(); }
  // Anteil der Blätter (0 bis 1) an einem Tag: Winter fast kahl, Austrieb ab Mitte April, voll bis Anfang Oktober, Laubfall im Oktober
  function laubAnteil(monat, tag) {
    var tage = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var n = tage[monat - 1] + tag;                                   // Tag im Jahr (ungefähr)
    function rampe(a, b, von, bis) { return von + (bis - von) * Math.max(0, Math.min(1, (n - a) / (b - a))); }
    if (n < 100) { return 0.12; }                                    // bis 10. April
    if (n < 130) { return rampe(100, 130, 0.12, 1); }                // Austrieb bis 10. Mai
    if (n < 274) { return 1; }                                       // bis 1. Oktober
    if (n < 310) { return rampe(274, 310, 1, 0.12); }                // Laubfall bis 6. November
    return 0.12;
  }

  function baumDichte() {            // Blattdichte der Laubbäume (0 bis 1) laut Regler
    return Math.max(0.08, +zustand.el("a3dLaub").value / 100);
  }

  // Zufall, der für denselben Baum immer gleich bleibt
  function zufall(x, y) { var s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); }

  function baeumeLeeren() {
    var z = zustand;
    if (!z || !z.baumGruppe) { return; }
    while (z.baumGruppe.children.length) {
      var k = z.baumGruppe.children.pop();
      if (k.geometry) { k.geometry.dispose(); }
      if (k.material) { k.material.dispose(); }
      if (k.dispose) { k.dispose(); }
    }
    z.baumMaterial = null;
  }

  function eigeneBaeume() {
    // Bäume aus dem Werkzeug "Baum" (und ältere Punkte mit Höhe)
    return (typeof zeichnung !== "undefined" ? zeichnung : []).filter(function (o) { return o.art === "baum" && o.hoehe > 0 && o.punkte && o.punkte.length; });
  }

  // Baut alle Bäume des Ausschnitts (Meter um die Mitte) und stellt sie ins Modell
  function baeumeAufbauen() {
    var z = zustand, THREE = window.THREE;
    if (!z) { return; }
    var token = ++z.baumToken;
    baeumeLaden().then(function (daten) {
      if (zustand !== z || token !== z.baumToken) { return; }
      baeumeLeeren();
      var R = z.radius, dLat = R / z.mLat, dLng = R / z.mLng, liste = [];
      daten.forEach(function (b) {
        if (Math.abs(b.lat - z.mitte.lat) > dLat || Math.abs(b.lng - z.mitte.lng) > dLng) { return; }
        var schluessel = Math.round(b.lat * 1e6) + "," + Math.round(b.lng * 1e6);
        if (baumAus[schluessel]) { return; }                              // in der 3D-Ansicht ausgeblendet (z. B. geplante Fällung)
        var h = b.h > 0 ? b.h : BAUM_HOEHE_STANDARD * (0.85 + 0.3 * zufall(b.lat * 1e3, b.lng * 1e3));
        var kr = b.k > 0 ? b.k : Math.max(3, h * 0.65);
        liste.push({ x: (b.lng - z.mitte.lng) * z.mLng, n: (b.lat - z.mitte.lat) * z.mLat, h: h, kr: kr, ig: b.ig, eigen: false, key: schluessel });
      });
      // eigene Bäume aus der Zeichnung (Punkt mit Höhe): die Höhe ist die Gesamthöhe
      eigeneBaeume().forEach(function (o) {
        var p = o.punkte[0];
        if (Math.abs(p.lat - z.mitte.lat) > dLat || Math.abs(p.lng - z.mitte.lng) > dLng) { return; }
        liste.push({ x: (p.lng - z.mitte.lng) * z.mLng, n: (p.lat - z.mitte.lat) * z.mLat, h: o.hoehe, kr: o.krone > 0 ? o.krone : Math.max(3, o.hoehe * 0.65),
                     ig: !!o.immergruen, eigen: true, farbe: o.farbe || "#2e8b3d", obj: o });
      });
      liste.forEach(function (b) { b.stamm = b.ig ? 0.12 * b.h : 0.3 * b.h; b.y0 = z.gh(b.x, b.n); });      // y0 = Geländehöhe am Stamm
      z.baeume = liste;
      z.baumAnzahlEigen = liste.filter(function (b) { return b.eigen; }).length;

      // Raster für die Schattenprüfung (Zellen von 8 m)
      var gitter = {}, maxH = 0, zelle = 8, nz = Math.ceil(2 * R / zelle) + 1;
      liste.forEach(function (b, i) {
        var a = b.kr / 2;
        var x0 = Math.max(0, Math.floor((b.x - a + R) / zelle)), x1 = Math.min(nz, Math.floor((b.x + a + R) / zelle));
        var y0 = Math.max(0, Math.floor((b.n - a + R) / zelle)), y1 = Math.min(nz, Math.floor((b.n + a + R) / zelle));
        for (var iy = y0; iy <= y1; iy++) for (var ix = x0; ix <= x1; ix++) { (gitter[ix * 4096 + iy] = gitter[ix * 4096 + iy] || []).push(i); }
        if (b.h > maxH) { maxH = b.h; }
      });
      z.baumGitter = { g: gitter, zelle: zelle, R: R, maxH: maxH };

      if (liste.length) {
        // Rauschmuster: so viele Blattpunkte bleiben stehen, wie die Belaubung vorgibt (auch im Schatten)
        var N = 64, daten8 = new Uint8Array(N * N * 4);
        for (var i = 0; i < N * N; i++) { var w = Math.floor(Math.random() * 255); daten8[i * 4] = w; daten8[i * 4 + 1] = w; daten8[i * 4 + 2] = w; daten8[i * 4 + 3] = 255; }
        var rausch = new THREE.DataTexture(daten8, N, N, THREE.RGBAFormat);
        rausch.wrapS = rausch.wrapT = THREE.RepeatWrapping; rausch.magFilter = THREE.NearestFilter; rausch.minFilter = THREE.NearestFilter;
        rausch.repeat.set(7, 5); rausch.needsUpdate = true;

        var laub = liste.filter(function (b) { return !b.ig; }), nadel = liste.filter(function (b) { return b.ig; });
        var matLaub = new THREE.MeshLambertMaterial({ color: 0xffffff, alphaMap: rausch, alphaTest: 0.001, side: THREE.DoubleSide });
        var matNadel = new THREE.MeshLambertMaterial({ color: 0xffffff, alphaMap: rausch, alphaTest: 0.12, side: THREE.DoubleSide });
        var matStamm = new THREE.MeshLambertMaterial({ color: 0x6b4f3a });
        z.baumMaterial = { laub: matLaub, nadel: matNadel, rausch: rausch };

        var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), skal = new THREE.Vector3(), farbe = new THREE.Color();
        function gruen(b, i) {
          if (b.eigen) { return farbe.set(b.farbe); }
          var r = zufall(b.x, b.n);
          return b.ig ? farbe.setHSL(0.36 + 0.03 * r, 0.40, 0.22 + 0.06 * r) : farbe.setHSL(0.24 + 0.08 * r, 0.42 + 0.12 * r, 0.30 + 0.12 * zufall(b.n, b.x));
        }
        function kronen(teil, geometrie, nadel) {
          if (!teil.length) { return; }
          var mesh = new THREE.InstancedMesh(geometrie, nadel ? matNadel : matLaub, teil.length);
          teil.forEach(function (b, i) {
            var hk = b.h - b.stamm;
            if (nadel) { pos.set(b.x, b.y0 + b.stamm, -b.n); skal.set(b.kr / 2, hk, b.kr / 2); }
            else { pos.set(b.x, b.y0 + b.stamm + hk / 2, -b.n); skal.set(b.kr / 2, hk / 2, b.kr / 2); }
            m4.compose(pos, q, skal); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, gruen(b, i));
          });
          mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
          mesh.castShadow = true; mesh.receiveShadow = false;
          z.baumGruppe.add(mesh);
        }
        kronen(laub, new THREE.SphereGeometry(1, 9, 7), false);
        var kegel = new THREE.ConeGeometry(1, 1, 9, 1); kegel.translate(0, 0.5, 0);
        kronen(nadel, kegel, true);
        var zyl = new THREE.CylinderGeometry(1, 1, 1, 5); zyl.translate(0, 0.5, 0);
        var staemme = new THREE.InstancedMesh(zyl, matStamm, liste.length);
        liste.forEach(function (b, i) {
          var rt = 0.14 + 0.012 * b.h;
          pos.set(b.x, b.y0, -b.n); skal.set(rt, Math.max(1, b.stamm + 0.25 * (b.h - b.stamm)), rt); m4.compose(pos, q, skal); staemme.setMatrixAt(i, m4);
        });
        staemme.instanceMatrix.needsUpdate = true; staemme.castShadow = true;
        z.baumGruppe.add(staemme);
      }
      baeumeSichtbar();
      laubAnwenden();
      z.el("a3dBaumInfo").textContent = liste.length + " Bäume im Ausschnitt" + (z.baumAnzahlEigen ? " (davon " + z.baumAnzahlEigen + " eigene)" : "") + ".";
      baeumeAusInfo();
      sonneVeraltet();
      messSchattenAktualisieren();
      zeichne();
    }).catch(function () {
      if (zustand === z) { z.el("a3dBaumInfo").textContent = "Die Baumdatei (baeume_oldenburg.js) fehlt oder ist beschädigt. Sie muss im Ordner „Standortanalyse“ liegen."; }
    });
  }

  function baeumeSichtbar() {
    var z = zustand;
    var an = z.el("a3dBaeume").checked, schatten = an && z.el("a3dBaumSchatten").checked;
    z.baumGruppe.visible = an;
    z.baumGruppe.children.forEach(function (m) { m.castShadow = schatten; });
    if (typeof speicherFelder === "function" && z.el("a3dFormat")) { speicherFelder(); }
  }

  // Belaubung auf die Materialien übertragen (die Blätter sind ein Punktmuster: weniger Blätter = mehr Lücken, auch im Schatten)
  function laubAnwenden() {
    var z = zustand;
    if (!z) { return; }
    var d = baumDichte();
    z.el("a3dLaubText").textContent = Math.round(d * 100) + " %";
    if (z.baumMaterial) { z.baumMaterial.laub.alphaTest = d >= 0.995 ? 0.001 : 1 - d; }
    if (z.waldMaterial) { var wd = waldDichte(); z.waldMaterial.alphaTest = wd >= 0.995 ? 0.001 : 1 - wd; }
  }

  // Bei "automatisch": Belaubung folgt dem Datum
  function laubAuto() {
    var z = zustand;
    if (!z || !z.el("a3dLaubAuto").checked) { return; }
    var d = z.datum, a = laubAnteil(d.m, d.t);
    z.el("a3dLaub").value = String(Math.round(a * 20) * 5);
    z.el("a3dLaub").disabled = true;
    laubAnwenden();
  }

  // ---- Bäume hinzufügen, verschieben, entfernen (Werkzeuge im Modell) ----
  function baumNeuLaden() {          // nach Änderungen: Bäume, Liste und Zahlen neu
    var z = zustand;
    baeumeAufbauen();
    baueListe();
    zeichne();
  }

  // Der Baum, dessen Krone dem Klick am nächsten liegt (höchstens 40 Bildschirmpunkte entfernt)
  function naechsterBaum(cx, cy, nurEigene) {
    var z = zustand, THREE = window.THREE, kam = z.aktuelleKamera;
    if (!kam || !z.baeume) { return null; }
    var r = z.bild.getBoundingClientRect(), v = new THREE.Vector3(), beste = null, bd = 1e9;
    z.baeume.forEach(function (b) {
      if (nurEigene && !b.eigen) { return; }
      v.set(b.x, b.y0 + b.stamm + (b.h - b.stamm) / 2, -b.n).project(kam);
      if (v.z < -1 || v.z > 1) { return; }
      var d = Math.hypot((v.x * 0.5 + 0.5) * r.width + r.left - cx, (-v.y * 0.5 + 0.5) * r.height + r.top - cy);
      if (d < bd) { bd = d; beste = b; }
    });
    return bd <= 40 ? beste : null;
  }

  function baumKlick(cx, cy) {
    var z = zustand, THREE = window.THREE, w = z.werkzeug;
    if (!z.el("a3dBaeume").checked) { z.el("a3dBaeume").checked = true; baeumeSichtbar(); }
    if (w === "baumSetzen") {
      var tr = messTreffer(cx, cy);
      if (!tr) { return; }
      var ll = L.latLng(z.mitte.lat + (-tr.punkt.z) / z.mLat, z.mitte.lng + tr.punkt.x / z.mLng);
      var alt = { baumHoehe: zeichenEigenschaften.baumHoehe, krone: zeichenEigenschaften.krone, immergruen: zeichenEigenschaften.immergruen };
      var h = Math.max(1, Math.min(60, parseFloat(String(z.el("a3dNeuHoehe").value).replace(",", ".")) || 12));
      var kr = Math.max(0, Math.min(40, parseFloat(String(z.el("a3dNeuKrone").value).replace(",", ".")) || 0));
      zeichenEigenschaften.baumHoehe = h; zeichenEigenschaften.krone = kr; zeichenEigenschaften.immergruen = z.el("a3dNeuArt").value === "nadel";
      zeichenNeu("baum", [ll]);                                        // legt den Baum in der Zeichnung an (erscheint auch in der Karte)
      zeichenEigenschaften.baumHoehe = alt.baumHoehe; zeichenEigenschaften.krone = alt.krone; zeichenEigenschaften.immergruen = alt.immergruen;
      zeichenFelderVonAuswahl();
      baumNeuLaden();
    } else if (w === "baumVerschieben") {
      if (!z.messEntwurf || !z.messEntwurf.baum) {
        var b = naechsterBaum(cx, cy, true);
        if (!b) { z.el("a3dBaumHinweis").textContent = "Hier ist kein eigener Baum. Nur eigene Bäume lassen sich verschieben. Klicke dicht an die Krone eines eigenen Baums."; return; }
        z.messEntwurf = { art: "baum", baum: b, punkte: [new THREE.Vector3(b.x, b.y0 + b.stamm + (b.h - b.stamm) / 2, -b.n)] };
        messHinweis(); zeichne();
      } else {
        var tr2 = messTreffer(cx, cy);
        if (!tr2) { return; }
        var ziel = z.messEntwurf.baum;
        zeichenMerken();
        ziel.obj.punkte[0] = { lat: z.mitte.lat + (-tr2.punkt.z) / z.mLat, lng: z.mitte.lng + tr2.punkt.x / z.mLng };
        zeichenAktualisiereObjekt(ziel.obj);
        aktualisiereExportInfo();
        z.messEntwurf = null;
        messHinweis();
        baumNeuLaden();
      }
    } else if (w === "baumEntfernen") {
      var e = naechsterBaum(cx, cy, false);
      if (!e) { z.el("a3dBaumHinweis").textContent = "Hier ist kein Baum. Klicke dicht an die Krone eines Baums."; return; }
      if (e.eigen) {
        zeichenMerken();
        zeichnung = zeichnung.filter(function (o) { return o !== e.obj; });
        if (zeichenAuswahl === e.obj.id) { zeichenAuswahl = null; }
        zeichneAlles();
        zeichenFelderVonAuswahl();
        aktualisiereExportInfo();
      } else {
        baumAus[e.key] = true;
      }
      baumNeuLaden();
    }
  }

  function baeumeAusInfo() {
    var z = zustand, n = Object.keys(baumAus).length;
    z.el("a3dBaumAusText").textContent = n ? (n === 1 ? "1 Bestandsbaum ausgeblendet." : n + " Bestandsbäume ausgeblendet.") : "";
    z.el("a3dBaumAusZurueck").hidden = !n;
  }

  // Wie viel Licht kommt am Punkt p durch Baumkronen und Wälder zur Sonne? 1 = voll, 0 = nichts (Gebäude prüft imSchatten)
  function baumLicht(p, s) {
    var z = zustand;
    if (!z || !z.el("a3dBaumSchatten").checked) { return 1; }
    var mitBaeumen = z.el("a3dBaeume").checked && z.baeume && z.baeume.length > 0;
    var mitWald = z.el("a3dWald").checked && z.waelder && z.waelder.length > 0;
    if (!mitBaeumen && !mitWald) { return 1; }
    var bg = z.baumGitter || { g: {}, zelle: 8, R: z.radius, maxH: 0 }, R = bg.R, tanH = Math.tan(s.hoehe);
    if (tanH <= 0.01) { return 1; }
    var wk = mitWald ? waldKarte() : null, wh = mitWald ? waldHoehe() : 0, wDichte = waldDichte();
    var hoechste = Math.max(mitBaeumen ? bg.maxH : 0, wh);
    var dx = Math.sin(s.azimut), dn = Math.cos(s.azimut), x = p.x, n = -p.z;
    var dichte = baumDichte(), maxD = Math.min(R * 1.5, (hoechste + (z.gelaende ? z.gelMax : 0) - p.y) / tanH);
    var schritt = Math.max(0.5, R / 800), summe = 0;
    for (var u = 0.3; u <= maxD; u += schritt) {
      var sx = x + dx * u, sn = n + dn * u, sy = p.y + u * tanH;
      if (wk && sy <= wh + (z.gelaende ? z.gh(sx, sn) : 0)) {
        var wx = Math.floor((sx + R) / wk.zelle), wy = Math.floor((sn + R) / wk.zelle);
        if (wx >= 0 && wx < wk.N && wy >= 0 && wy < wk.N && wk.f[wy * wk.N + wx]) { summe += schritt * wDichte; continue; }
      }
      if (!mitBaeumen) { continue; }
      var ix = Math.floor((sx + R) / bg.zelle), iy = Math.floor((sn + R) / bg.zelle);
      var liste = bg.g[ix * 4096 + iy];
      if (!liste) { continue; }
      for (var k = 0; k < liste.length; k++) {
        var b = z.baeume[liste[k]], a = b.kr / 2, hk = b.h - b.stamm, cy = b.y0 + b.stamm + hk / 2;
        var ex = (sx - b.x) / a, en = (sn - b.n) / a, ey = (sy - cy) / (hk / 2);
        if (ex * ex + en * en + ey * ey <= 1) { summe += schritt * (b.ig ? 0.85 : dichte); break; }   // ein Baum je Punkt zählt
      }
    }
    return Math.exp(-BAUM_DAEMPFUNG * summe);
  }
  // ---------- Wälder (als Baumblöcke) ----------
  var waldDaten = null, waldLadevorgang = null;

  function waldLaden() {
    if (waldDaten) { return Promise.resolve(waldDaten); }
    if (waldLadevorgang) { return waldLadevorgang; }
    waldLadevorgang = new Promise(function (fertig, fehler) {
      function auswerten() {
        try {
          var roh = window.WAELDER_OLDENBURG;
          waldDaten = entpackeGebaeude({ einheit: roh.einheit, gebaeude: roh.wald });     // gleiche Umwandlung wie bei den Gebäuden
          window.WAELDER_OLDENBURG = null;
          fertig(waldDaten);
        } catch (x) { waldLadevorgang = null; fehler(x); }
      }
      if (window.WAELDER_OLDENBURG) { auswerten(); return; }
      var skript = document.createElement("script");
      skript.src = "waelder_oldenburg.js";
      skript.onload = auswerten;
      skript.onerror = function () { waldLadevorgang = null; fehler(new Error("Datei waelder_oldenburg.js nicht gefunden")); };
      document.head.appendChild(skript);
    });
    return waldLadevorgang;
  }

  function waldHoehe() { return Math.max(4, Math.min(45, parseFloat(String(zustand.el("a3dWaldHoehe").value).replace(",", ".")) || 18)); }
  function waldDichte() { return 0.4 + 0.6 * baumDichte(); }     // Mischwald: auch im Winter ziemlich dicht (Nadelbäume, Unterholz)

  function waldLeeren() {
    var z = zustand;
    if (!z || !z.waldGruppe) { return; }
    while (z.waldGruppe.children.length) {
      var k = z.waldGruppe.children.pop();
      if (k.geometry) { k.geometry.dispose(); }
      if (k.material) { if (k.material.alphaMap) { k.material.alphaMap.dispose(); } k.material.dispose(); }
    }
    z.waldMaterial = null;
  }

  function waldAufbauen() {
    var z = zustand, THREE = window.THREE;
    if (!z) { return; }
    var token = ++z.waldToken;
    waldLaden().then(function (daten) {
      if (zustand !== z || token !== z.waldToken) { return; }
      waldLeeren();
      var R = z.radius, h = waldHoehe(), liste = [];
      var s = z.mitte.lat - R / z.mLat, n = z.mitte.lat + R / z.mLat, w = z.mitte.lng - R / z.mLng, o = z.mitte.lng + R / z.mLng;
      var klein = R > 1500 ? 600 : (R > 800 ? 200 : 0);               // sehr kleine Wäldchen bei großen Ausschnitten weglassen
      daten.forEach(function (f) {
        if (f.n < s || f.s > n || f.o < w || f.w > o) { return; }
        var ringe = (R > 1500 ? [f.ringe[0]] : f.ringe).map(inMeter);
        if (klein && Math.abs(flaecheMeter(ringe[0])) < klein) { return; }
        var grw = gruendung(ringe[0]);
        liste.push({ ringe: ringe, h: h, y0: grw.y0, yb: grw.yb });
      });
      z.waelder = liste; z.waldKarte = null;
      if (liste.length) {
        var N = 16, d8 = new Uint8Array(N * N * 4);
        for (var i = 0; i < N * N; i++) { var v = Math.floor(Math.random() * 255); d8[i * 4] = v; d8[i * 4 + 1] = v; d8[i * 4 + 2] = v; d8[i * 4 + 3] = 255; }
        var tex = new THREE.DataTexture(d8, N, N, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
        var sammler = new Sammler(true);
        liste.forEach(function (k) { sammler.addiere(k.ringe, k.h, null, null, k.y0, k.yb); });
        if (sammler.n) {
          var mat = new THREE.MeshLambertMaterial({ color: 0x4b7d3d, alphaMap: tex, alphaTest: 0.001, side: THREE.DoubleSide });
          var mesh = new THREE.Mesh(sammler.gebaeude(), mat);
          mesh.castShadow = true; mesh.receiveShadow = false;
          z.waldGruppe.add(mesh);
          z.waldMaterial = mat;
        }
      }
      waldSichtbar();
      laubAnwenden();
      z.el("a3dWaldInfo").textContent = liste.length + " Waldflächen im Ausschnitt.";
      sonneVeraltet();
      messSchattenAktualisieren();
      zeichne();
    }).catch(function () {
      if (zustand === z) { z.el("a3dWaldInfo").textContent = "Die Walddatei (waelder_oldenburg.js) fehlt oder ist beschädigt. Sie muss im Ordner „Standortanalyse“ liegen."; }
    });
  }

  function waldSichtbar() {
    var z = zustand;
    var an = z.el("a3dWald").checked;
    z.waldGruppe.visible = an;
    z.waldGruppe.children.forEach(function (m) { m.castShadow = an && z.el("a3dBaumSchatten").checked; });
    if (typeof speicherFelder === "function" && z.el("a3dFormat")) { speicherFelder(); }
  }

  // Raster (Zellen von mindestens 2 m): 1 = Wald. Wird erst bei der ersten Schattenprüfung gebaut.
  function waldKarte() {
    var z = zustand;
    if (z.waldKarte) { return z.waldKarte; }
    var R = z.radius, zelle = Math.max(2, R / 500), N = Math.ceil(2 * R / zelle), f = new Uint8Array(N * N);
    (z.waelder || []).forEach(function (k) {
      var r0 = k.ringe[0], minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (var i = 0; i < r0.length; i += 2) {
        if (r0[i] < minx) { minx = r0[i]; } if (r0[i] > maxx) { maxx = r0[i]; }
        if (r0[i + 1] < miny) { miny = r0[i + 1]; } if (r0[i + 1] > maxy) { maxy = r0[i + 1]; }
      }
      var x0 = Math.max(0, Math.floor((minx + R) / zelle)), x1 = Math.min(N - 1, Math.floor((maxx + R) / zelle));
      var y0 = Math.max(0, Math.floor((miny + R) / zelle)), y1 = Math.min(N - 1, Math.floor((maxy + R) / zelle));
      for (var iy = y0; iy <= y1; iy++) {
        for (var ix = x0; ix <= x1; ix++) {
          var cx = (ix + 0.5) * zelle - R, cy = (iy + 0.5) * zelle - R, innen = false;
          for (var q = 0; q < k.ringe.length; q++) { if (imVieleck(cx, cy, k.ringe[q])) { innen = !innen; } }
          if (innen) { f[iy * N + ix] = 1; }
        }
      }
    });
    z.waldKarte = { f: f, N: N, zelle: zelle, R: R, h: waldHoehe() };
    return z.waldKarte;
  }

  // ---------- Analysedaten (gemeinsame Schalter mit der Karte) ----------
  var ANALYSE_GRUPPEN = [
    ["Fußweg", function () { return KREISE; }, function (k) { return k.minuten + " Min. zu Fuß (" + k.meter + " m)"; }],
    ["Fußweg nach Wegenetz", function () { return WEGENETZ_ZEITEN; }, function (w) { return w.name; }],
    ["Sonnenstand", function () { return SONNE; }, function (s) { return s.datum; }],
    ["ÖPNV", function () { return [OEPNV, TAKT]; }, function (g) { return g === OEPNV ? "Haltestellen und Bahnhöfe" : g.name; }],
    ["Verkehr und Mobilität", function () { return MOBILITAET; }, function (g) { return g.name; }],
    ["Spielen und Bewegen (Grün und Freiräume)", function () { return SPIEL; }, function (g) { return g.name; }],
    ["Luftqualität", function () { return [LUFT]; }, function (g) { return g.name; }],
    ["Einrichtungen", function () { return EINRICHTUNGEN; }, function (g) { return g.name; }],
    ["Grün und Freiräume", function () { return FLAECHEN.filter(function (g) { return g.quelle === "flaechen"; }); }, function (g) { return g.name; }],
    ["Nutzungsarten", function () { return FLAECHEN.filter(function (g) { return g.quelle === "nutzung"; }); }, function (g) { return g.name; }],
    ["Starkregen (Bund, Online-Dienst)", function () { return STARKREGEN; }, function (g) { return g.name; }],
    ["Boden (LBEG, Online-Dienst)", function () { return BODEN; }, function (g) { return g.name; }],
    ["Geologie und Baugrund (LBEG, Online-Dienst)", function () { return GEOLOGIE; }, function (g) { return g.name; }],
    ["Grundwasser (LBEG, Online-Dienst)", function () { return GRUNDWASSER; }, function (g) { return g.name; }],
    ["Versiegelung und Altlasten (LBEG, Online-Dienst)", function () { return VERSIEGELUNG; }, function (g) { return g.name; }],
    ["Lärm (Stadt Oldenburg)", function () { return FLAECHEN.filter(function (g) { return g.quelle === "laerm"; }); }, function (g) { return g.name; }],
    ["Planung und Naturschutz (Stadt Oldenburg)", function () { return FLAECHEN.filter(function (g) { return g.quelle === "stadt"; }); }, function (g) { return g.name; }],
    ["Flächennutzungsplan (Stadt Oldenburg)", function () { return FLAECHEN.filter(function (g) { return g.quelle === "fnp"; }); }, function (g) { return g.name; }],
    ["Grundstücke (Kataster, LGLN, Online-Dienst)", function () { return FLST.concat(LIEGENSCHAFT); }, function (g) { return g.name; }]
  ];

  function analyseBauen() {
    var z = zustand;
    var behaelter = z.el("a3dAnalyse");
    z.analyse = [];
    ANALYSE_GRUPPEN.forEach(function (gr) {
      var gruppe = document.createElement("details"); gruppe.className = "analyseGruppe";      // ausklappbar, am Anfang zu
      var titel = document.createElement("summary");
      var titelText = document.createElement("span"); titelText.className = "titel"; titelText.textContent = gr[0];
      var titelZahl = document.createElement("span"); titelZahl.className = "anzahl";
      titel.appendChild(titelText); titel.appendChild(titelZahl);
      var inhalt = document.createElement("div");
      gruppe.appendChild(titel); gruppe.appendChild(inhalt);
      behaelter.appendChild(gruppe);
      gr[1]().forEach(function (eintrag) {
        var zeile = document.createElement("label"); zeile.className = "haken";
        var haken = document.createElement("input"); haken.type = "checkbox";
        var strich = document.createElement("span");
        if (eintrag.flaeche) {
          strich.className = "farbflaeche"; strich.style.background = eintrag.farbe; strich.style.opacity = String(eintrag.deckkraft + 0.25);
        } else if (eintrag.punkt) {
          strich.className = "farbpunkt"; strich.style.background = eintrag.farbe;
          if (eintrag.rand) { strich.style.boxShadow = "0 0 0 1.5px " + eintrag.rand; }
        } else {
          strich.className = "farbstrich"; strich.style.borderTopColor = eintrag.farbe;
          strich.style.borderTopStyle = (eintrag.strich && eintrag.strich.length) ? "dashed" : "solid";
        }
        var text = gr[2](eintrag);
        zeile.appendChild(haken); zeile.appendChild(strich); zeile.appendChild(document.createTextNode(text));
        inhalt.appendChild(zeile);
        haken.addEventListener("change", function () {
          if (haken.checked) { karte.addLayer(eintrag.ebene); } else { karte.removeLayer(eintrag.ebene); }
          if (typeof synchronisiereAnalyseHaken === "function") { synchronisiereAnalyseHaken(); }
          analyseGeaendert();
        });
        z.analyse.push({ haken: haken, ebene: eintrag.ebene, text: text });
      });
    });
    // Regler: Farbstärke (zeichnet das Bodenbild neu, sobald man loslässt) und Helligkeit des Bodens (sofort)
    var farbstaerke = z.el("a3dFarbstaerke"), helligkeit = z.el("a3dBodenHell");
    function reglerTexte() {
      z.el("a3dFarbstaerkeText").textContent = farbstaerke.value + " %";
      z.el("a3dBodenHellText").textContent = helligkeit.value + " %";
    }
    function helligkeitAnwenden() {
      if (z.boden && z.boden.material.emissiveMap) { z.boden.material.emissiveIntensity = +helligkeit.value / 100; zeichne(); }
    }
    function bodenNeu() {
      if (z.analyseTimer) { clearTimeout(z.analyseTimer); }
      z.analyseTimer = setTimeout(function () {
        if (zustand !== z) { return; }
        bodenAufbauen().then(function () { if (zustand === z) { z.el("a3dStatus").hidden = true; zeichne(); } });
      }, 250);
    }
    farbstaerke.addEventListener("input", reglerTexte);
    farbstaerke.addEventListener("change", bodenNeu);
    helligkeit.addEventListener("input", function () { reglerTexte(); helligkeitAnwenden(); });
    z.el("a3dFarbenStandard").addEventListener("click", function () {
      farbstaerke.value = "35"; helligkeit.value = "28"; reglerTexte(); helligkeitAnwenden(); bodenNeu();
    });
    reglerTexte();
    z.el("a3dAnalyseAn").addEventListener("click", function () { analyseAlle(true); });
    z.el("a3dAnalyseAus").addEventListener("click", function () { analyseAlle(false); });
    analyseHakenAngleichen();
  }

  function analyseHakenAngleichen() {
    var z = zustand;
    z.analyse.forEach(function (a) { a.haken.checked = karte.hasLayer(a.ebene); });
    if (typeof aktualisiereGruppenZaehler === "function") { aktualisiereGruppenZaehler(); }
    var braucht = !marker && z.analyse.some(function (a) { return a.haken.checked && /Min\. zu Fuß|nach Wegenetz|Juni|Dezember/.test(a.text); });
    z.el("a3dAnalyseHinweis").textContent = braucht
      ? "Fußweg, Wegenetz und Sonnenstrahlen brauchen eine gesuchte Adresse (roter Punkt). Suche in der Karte eine Adresse und öffne die 3D-Ansicht neu."
      : "";
  }

  function analyseAlle(an) {
    var z = zustand;
    if (typeof schalteAlleAnalyseEbenen === "function") { schalteAlleAnalyseEbenen(an); }
    analyseHakenAngleichen();
    analyseGeaendert();
  }

  // Nach jeder Änderung: kurz warten (mehrere Klicks hintereinander), dann Boden und Pfähle neu
  function analyseGeaendert() {
    var z = zustand;
    analyseHakenAngleichen();
    if (!z.el("a3dKarte").checked) { z.el("a3dKarte").checked = true; }   // ohne Kartenbild auf dem Boden wären Flächen und Linien unsichtbar
    if (z.analyseTimer) { clearTimeout(z.analyseTimer); }
    z.analyseTimer = setTimeout(function () {
      if (zustand !== z) { return; }
      punkteAufbauen();
      bodenAufbauen().then(function () {
        if (zustand !== z) { return; }
        z.el("a3dStatus").hidden = true;
        zeichne();
      });
    }, 350);
  }
  function baueListe() {
    var z = zustand;
    var ul = z.el("a3dKoerper");
    ul.innerHTML = "";
    // Flächen werden Baukörper, Punkte werden Säulen (Kreis mit Durchmesser), Bäume (Werkzeug "Baum") bleiben Bäume; jeweils mit Höhe über 0
    var baeumeListe = (typeof zeichnung !== "undefined" ? zeichnung : []).filter(function (o) { return o.art === "baum" && o.punkte && o.punkte.length; }).slice(0, 60);
    var nrF = 0, nrP = 0;
    var eintraege = eigeneFlaechen().map(function (o) { return { o: o, baum: false, saeule: o.art === "punkt", name: o.name || (o.art === "punkt" ? "Säule " + (++nrP) : "Fläche " + (++nrF)) }; })
      .concat(baeumeListe.map(function (o, i) { return { o: o, baum: true, name: o.name || "Baum " + (i + 1) }; }));
    if (!eintraege.length) {
      var li0 = document.createElement("li");
      li0.innerHTML = '<span class="n" style="white-space:normal;color:var(--grau)">Noch nichts gezeichnet. Zeichne in „06 Zeichnen“ eine Fläche (wird ein Baukörper), einen Punkt (wird eine Säule mit Kreis als Grundriss) oder einen Baum, dann erscheint sie hier.</span>';
      ul.appendChild(li0);
      return;
    }
    function zahlFeld(wert, titel, max) {
      var feld = document.createElement("input"); feld.type = "number"; feld.min = "0"; feld.max = String(max); feld.step = "0.5";
      feld.value = wert > 0 ? String(wert) : "0"; feld.title = titel;
      return feld;
    }
    function lesen(feld, max) {
      var h = Math.max(0, Math.min(max, parseFloat(String(feld.value).replace(",", ".")) || 0));
      feld.value = String(h);
      return h;
    }
    function fertig() {
      if (typeof zeichenFelderVonAuswahl === "function") { zeichenFelderVonAuswahl(); }
      if (typeof aktualisiereExportInfo === "function") { aktualisiereExportInfo(); }
      baueModell();
    }
    eintraege.forEach(function (e) {
      var o = e.o, li = document.createElement("li");
      var farbe = document.createElement("i"); farbe.style.background = o.farbe || "#c0392b";
      var name = document.createElement("span"); name.className = "n"; name.textContent = (e.baum ? "Baum: " : "") + e.name;
      var feld = zahlFeld(o.hoehe, e.baum ? "Höhe des Baums in Metern" : (e.saeule ? "Höhe der Säule in Metern (0 = keine Säule)" : "Höhe in Metern"), 500);
      var m = document.createElement("span"); m.textContent = "m";
      feld.addEventListener("change", function () {
        o.hoehe = lesen(feld, o.art === "baum" ? 60 : 500);
        if (o.art === "baum" && o.hoehe < 1) { o.hoehe = 1; feld.value = "1"; }
        if (e.baum) { zeichenAktualisiereObjekt(o); aktualisiereExportInfo(); baumNeuLaden(); } else { fertig(); }
      });
      li.appendChild(farbe); li.appendChild(name); li.appendChild(feld); li.appendChild(m);
      if (e.saeule) {
        var dm = zahlFeld(o.durchmesser > 0 ? o.durchmesser : 2, "Durchmesser der Säule in Metern", 200); dm.style.width = "56px"; dm.min = "0.1"; dm.step = "0.1";
        var m3 = document.createElement("span"); m3.textContent = "m Durchm.";
        dm.addEventListener("change", function () { o.durchmesser = Math.max(0.1, lesen(dm, 200)); dm.value = String(o.durchmesser); zeichenAktualisiereObjekt(o); fertig(); });
        li.appendChild(dm); li.appendChild(m3);
      }
      if (e.baum) {
        var kr = zahlFeld(o.krone, "Kronenbreite in Metern (0 = automatisch)", 40); kr.style.width = "56px";
        var m2 = document.createElement("span"); m2.textContent = "m Krone";
        kr.addEventListener("change", function () { o.krone = lesen(kr, 40); zeichenAktualisiereObjekt(o); aktualisiereExportInfo(); baumNeuLaden(); });
        li.appendChild(kr); li.appendChild(m2);
      }
      if (o.art === "baum") {          // Bäume lassen sich hier löschen (Flächen und Punkte nur in der Karte)
        var weg = document.createElement("button"); weg.type = "button"; weg.className = "zweit"; weg.textContent = "✕"; weg.title = "Diesen Baum löschen";
        weg.addEventListener("click", function () {
          zeichenMerken();
          zeichnung = zeichnung.filter(function (x) { return x !== o; });
          if (zeichenAuswahl === o.id) { zeichenAuswahl = null; }
          zeichneAlles(); zeichenFelderVonAuswahl(); aktualisiereExportInfo();
          baumNeuLaden();
        });
        li.appendChild(weg);
      }
      ul.appendChild(li);
    });
  }
  // ---------- Sonne anwenden ----------
  function sonneAnwenden() {
    var z = zustand, THREE = window.THREE;
    if (!z) { return; }
    var d = z.datum;
    z.el("a3dZeitText").textContent = uhrzeit(z.zeit) + " Uhr";
    var s = sonnenstand(z.mitte.lat, z.mitte.lng, d.j, d.m, d.t, z.zeit);
    z.stand = s;
    var hoeheGrad = s.hoehe * 180 / Math.PI;
    var azGrad = ((s.azimut * 180 / Math.PI) % 360 + 360) % 360;
    var oben = hoeheGrad > 0.3;
    var schatten = z.el("a3dSchatten").checked;

    var ostK = Math.sin(s.azimut) * Math.cos(s.hoehe), nordK = Math.cos(s.azimut) * Math.cos(s.hoehe), obenK = Math.sin(s.hoehe);
    var R = z.radius;
    var abstand = Math.max(3000, R * 2.5);                // so weit steht die Sonne (nur für den Schattenwurf)
    z.sonne.position.set(ostK * abstand, Math.max(obenK, 0.02) * abstand, -nordK * abstand);
    z.sonne.target.position.set(0, 0, 0);
    z.sonne.castShadow = schatten && oben;
    var c = z.sonne.shadow.camera;
    var w = R * 1.5;
    c.left = -w; c.right = w; c.top = w; c.bottom = -w; c.near = Math.max(50, abstand - R * 2); c.far = abstand + R * 2.5;
    c.updateProjectionMatrix();
    var kleineGroesse = Math.min(4096, z.renderer.capabilities.maxTextureSize || 2048);
    if (z.sonne.shadow.mapSize.x !== kleineGroesse) {
      z.sonne.shadow.mapSize.set(kleineGroesse, kleineGroesse);
      if (z.sonne.shadow.map) { z.sonne.shadow.map.dispose(); z.sonne.shadow.map = null; }
    }
    z.sonne.intensity = oben ? Math.min(1, 0.25 + hoeheGrad / 18) * 0.95 : 0;
    z.hemi.intensity = oben ? 0.5 : 0.28;
    z.szene.background = new THREE.Color(oben ? 0xe6eaee : 0x2d323a);
    if (z.boden) { z.modell.traverse(function (o) { if (o.material) { o.material.needsUpdate = true; } }); }

    var zeiten = sonnenZeiten(z.mitte.lat, z.mitte.lng, d.j, d.m, d.t);
    z.el("a3dInfo").innerHTML =
      "<strong>" + datumText(d.j, d.m, d.t) + ", " + uhrzeit(z.zeit) + " Uhr</strong> (" + (s.sommerzeit ? "Sommerzeit" : "Winterzeit") + ")<br>" +
      (oben ? "Sonnenhöhe " + Math.round(hoeheGrad) + "°, Richtung " + Math.round(azGrad) + "° (" + richtungsname(s.azimut) + ")" : "Die Sonne steht unter dem Horizont.") +
      "<br>Aufgang " + (zeiten.auf === null ? "–" : uhrzeit(zeiten.auf)) + " Uhr · Untergang " + (zeiten.unter === null ? "–" : uhrzeit(zeiten.unter)) + " Uhr";
    laubAuto();
    messSchattenAktualisieren();
    zeichne();
  }

  function abspielen() {
    var z = zustand;
    if (z.spielt) { z.spielt = false; z.el("a3dPlay").textContent = "▶ Tag abspielen"; return; }
    z.spielt = true;
    z.el("a3dPlay").textContent = "❚❚ Anhalten";
    var zeiten = sonnenZeiten(z.mitte.lat, z.mitte.lng, z.datum.j, z.datum.m, z.datum.t);
    var von = zeiten.auf !== null ? zeiten.auf : 5, bis = zeiten.unter !== null ? zeiten.unter : 21;
    if (z.zeit < von || z.zeit >= bis) { z.zeit = von; }
    var letzte = null;
    function schritt(zeitpunkt) {
      if (!zustand || !z.spielt) { return; }
      if (letzte === null) { letzte = zeitpunkt; }
      var dt = (zeitpunkt - letzte) / 1000; letzte = zeitpunkt;
      z.zeit += dt * 1.5;                    // 1,5 Stunden pro Sekunde
      if (z.zeit >= bis) { z.zeit = von; }
      z.el("a3dZeit").value = String(Math.round(z.zeit * 60 / 5) * 5);
      sonneAnwenden();
      requestAnimationFrame(schritt);
    }
    requestAnimationFrame(schritt);
  }

  // ---------- Kamera ----------
  function kameraEreignisse() {
    var z = zustand, bild = z.bild;
    var modus = null, x0 = 0, y0 = 0;
    bild.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });
    var startX = 0, startY = 0, startKnopf = 0;
    bild.addEventListener("pointerdown", function (ev) {
      modus = (ev.button === 2 || ev.shiftKey || ev.button === 1) ? "schieben" : "drehen";
      x0 = ev.clientX; y0 = ev.clientY;
      startX = ev.clientX; startY = ev.clientY; startKnopf = ev.button;
      bild.setPointerCapture(ev.pointerId);
      bild.classList.add("zieht");
    });
    bild.addEventListener("pointermove", function (ev) {
      if (!modus) { return; }
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      x0 = ev.clientX; y0 = ev.clientY;
      if (modus === "drehen") {
        z.theta -= dx * 0.006;
        z.pol = Math.max(0.0001, Math.min(Math.PI / 2 - 0.02, z.pol - dy * 0.006));
      } else {
        var s = z.dist * Math.tan(20 * Math.PI / 180) * 2 / Math.max(1, bild.clientHeight);
        var rx = Math.cos(z.theta), rz = -Math.sin(z.theta);       // nach rechts
        var vx = -Math.sin(z.theta), vz = -Math.cos(z.theta);      // von der Kamera weg
        z.ziel.x += -rx * dx * s + vx * dy * s;
        z.ziel.z += -rz * dx * s + vz * dy * s;
        var grenze = z.radius;
        z.ziel.x = Math.max(-grenze, Math.min(grenze, z.ziel.x));
        z.ziel.z = Math.max(-grenze, Math.min(grenze, z.ziel.z));
      }
      zeichne();
    });
    function ende() { modus = null; bild.classList.remove("zieht"); }
    bild.addEventListener("pointerup", function (ev) {
      var war = modus;
      ende();
      // Ein Klick (kaum bewegt, linke Taste) setzt beim Messen einen Punkt
      var klick = war === "drehen" && startKnopf === 0 && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5;
      if (klick && z.werkzeug) { messKlick(ev.clientX, ev.clientY); }
      else if (klick) { punktKlick(ev.clientX, ev.clientY); }      // ohne Werkzeug: Haltestelle oder Ladestation anklicken
      else if (war) { punktInfoZu(); }
    });
    bild.addEventListener("dblclick", function () { if (z.werkzeug === "strecke") { messStreckeBeenden(); } });
    bild.addEventListener("pointercancel", ende);
    bild.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      z.dist = Math.max(30, Math.min(z.radius * 6, z.dist * Math.pow(1.0015, ev.deltaY)));
      zeichne();
    }, { passive: false });
  }

  function kameraStellen(kamera, b, h) {
    var z = zustand;
    var sp = Math.sin(z.pol), cp = Math.cos(z.pol);
    var px = z.ziel.x + z.dist * sp * Math.sin(z.theta);
    var py = z.ziel.y + z.dist * cp;
    var pz = z.ziel.z + z.dist * sp * Math.cos(z.theta);
    kamera.position.set(px, py, pz);
    // Bei der Draufsicht zeigt "oben" des Bildes nach Norden (bzw. der Blickrichtung)
    kamera.up.set(0, 1, 0);
    if (z.pol < 0.002) { kamera.up.set(-Math.sin(z.theta), 0, -Math.cos(z.theta)); }
    kamera.lookAt(z.ziel);
    if (kamera.isOrthographicCamera) {
      var halbH = z.dist * Math.tan(20 * Math.PI / 180);
      kamera.left = -halbH * b / h; kamera.right = halbH * b / h; kamera.top = halbH; kamera.bottom = -halbH;
      kamera.updateProjectionMatrix();
    } else {
      kamera.aspect = b / h;
      kamera.near = Math.max(1, z.dist * 0.02);          // der Tiefenbereich passt sich dem Abstand an (sonst flackern ferne Flächen)
      kamera.far = z.dist + z.radius * 4;
      kamera.updateProjectionMatrix();
    }
  }

  function zeichne() {
    var z = zustand;
    if (!z || z.wartet) { return; }
    z.wartet = true;
    z.animation = requestAnimationFrame(function () {
      z.wartet = false;
      if (zustand !== z) { return; }
      var b = z.bild.clientWidth || 1, h = z.bild.clientHeight || 1;
      var kamera = z.kamera === "ortho" ? z.ortho : z.persp;
      kameraStellen(kamera, b, h);
      z.renderer.render(z.szene, kamera);
      z.aktuelleKamera = kamera;
      ueberlagerungZeichnen();
      z.el("a3dNord").querySelector("span").style.transform = "rotate(" + (z.theta * 180 / Math.PI) + "deg)";
    });
  }

  // ---------- Messen ----------
  var MESS_FARBEN = { entfernung: "#d4202a", strecke: "#1d6fd8", hoehe: "#1a8f3a", schatten: "#333333", baum: "#e0a800" };
  var MESS_NAMEN = { entfernung: "Entfernung", strecke: "Strecke", hoehe: "Gebäudehöhe", schatten: "Schattenprüfung" };

  function lm(m) {        // Länge als Text: "45,2 m", ab 1000 m in km
    if (m >= 1000) { return (m / 1000).toFixed(2).replace(".", ",") + " km"; }
    return (m >= 100 ? m.toFixed(0) : m.toFixed(1)).replace(".", ",") + " m";
  }
  function stdText(minuten) {
    var h = Math.floor(minuten / 60), m = Math.round(minuten % 60);
    return h + " h " + (m < 10 ? "0" : "") + m + " min";
  }

  function messWerkzeug(name) {
    var z = zustand;
    z.werkzeug = name;
    z.messEntwurf = null;
    Array.prototype.forEach.call(z.wurzel.querySelectorAll("[data-mess]"), function (b) { b.classList.toggle("aktiv", b.dataset.mess === name); });
    z.bild.classList.toggle("messen", !!name);
    z.el("a3dMessFertig").hidden = name !== "strecke";
    messHinweis();
    zeichne();
  }

  function messHinweis() {
    var z = zustand, w = z.werkzeug, e = z.messEntwurf, t;
    // Baum-Werkzeuge haben ihren eigenen Hinweis (Abschnitt 06)
    var baumHinweis = "Wähle ein Werkzeug und klicke ins Modell.";
    if (w === "baumSetzen") { baumHinweis = "Klicke ins Modell, um einen Baum zu setzen (Höhe, Krone und Art oben einstellbar). Esc legt das Werkzeug ab."; }
    else if (w === "baumVerschieben") { baumHinweis = (e && e.baum ? "Klicke den neuen Standort des Baums." : "Klicke einen eigenen Baum an, dann den neuen Standort.") + " Esc legt das Werkzeug ab."; }
    else if (w === "baumEntfernen") { baumHinweis = "Klicke einen Baum an: Eigene Bäume werden gelöscht, Bestandsbäume ausgeblendet. Esc legt das Werkzeug ab."; }
    z.el("a3dBaumHinweis").textContent = baumHinweis;
    if (/^baum/.test(w || "")) { z.el("a3dMessHinweis").textContent = "Wähle ein Werkzeug und klicke ins Modell. Die Punkte rasten an Gebäudeecken ein."; return; }
    if (!w) { t = "Wähle ein Werkzeug und klicke ins Modell. Die Punkte rasten an Gebäudeecken ein."; }
    else if (w === "entfernung") { t = e ? "Klicke den zweiten Punkt." : "Klicke den ersten Punkt (Boden, Wand oder Dach)."; }
    else if (w === "strecke") {
      t = e ? e.punkte.length + " Punkte, bisher " + lm(messLaenge(e.punkte)) + ". Weiter klicken; Doppelklick oder Enter beendet die Strecke."
            : "Klicke die Punkte der Strecke nacheinander.";
    }
    else if (w === "hoehe") { t = "Klicke ein Gebäude an (Wand oder Dach). Du siehst Traufe, First, die Dachform und die Höhe des Klickpunkts."; }
    else if (w === "sonnenstunden") { t = "Klicke Boden, Dach oder Wand an: Du siehst die Sonnenstunden pro Tag im Jahresmittel (zuerst in „05 Sonnenstunden“ berechnen)."; }
    else { t = "Klicke einen Punkt am Boden, an einer Wand oder auf einem Dach. Du siehst, ob er jetzt im Schatten liegt und wann am gewählten Tag die Sonne ihn trifft."; }
    if (w) { t += " Esc legt das Werkzeug ab."; }
    z.el("a3dMessHinweis").textContent = t;
  }

  function messLaenge(pkt) {
    var s = 0;
    for (var i = 1; i < pkt.length; i++) { s += pkt[i].distanceTo(pkt[i - 1]); }
    return s;
  }

  // Sucht, was unter dem Mauszeiger liegt: Punkt im Raum, wenn möglich eingerastet an einer Gebäudeecke, und welches Gebäude
  function messTreffer(cx, cy) {
    var z = zustand, THREE = window.THREE;
    var r = z.bild.getBoundingClientRect();
    var kam = z.aktuelleKamera;
    if (!kam) { return null; }
    var ndc = new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    var strahl = new THREE.Raycaster();
    strahl.setFromCamera(ndc, kam);
    z.modell.updateMatrixWorld(true);
    var treffer = strahl.intersectObjects(z.modell.children, false);
    if (!treffer.length) { return null; }
    var t = treffer[0];
    var p = t.point.clone(), info = null;
    if (t.object !== z.boden) {
      if (t.object.userData.info) { info = t.object.userData.info; }
      else if (t.object.userData.gruppen) {
        var g = t.object.userData.gruppen, lo = 0, hi = g.length - 1;
        while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (g[mid].v0 <= t.face.a) { lo = mid; } else { hi = mid - 1; } }
        info = g[lo].info;
      }
      // Einrasten an der nächsten Ecke des getroffenen Dreiecks (bis 14 Bildschirmpunkte)
      var pos = t.object.geometry.attributes.position, beste = null, bd = 14;
      [t.face.a, t.face.b, t.face.c].forEach(function (i) {
        var v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(t.object.matrixWorld);
        var s = v.clone().project(kam);
        var d = Math.hypot((s.x * 0.5 + 0.5) * r.width - (cx - r.left), (-s.y * 0.5 + 0.5) * r.height - (cy - r.top));
        if (d < bd) { bd = d; beste = v; }
      });
      if (beste) { p = beste; }
    }
    return { punkt: p, info: info };
  }

  function messKlick(cx, cy) {
    var z = zustand, THREE = window.THREE;
    if (/^baum/.test(z.werkzeug || "")) { baumKlick(cx, cy); return; }
    var tr = messTreffer(cx, cy);
    if (!tr) { return; }
    var w = z.werkzeug, p = tr.punkt;
    if (w === "entfernung") {
      if (!z.messEntwurf) { z.messEntwurf = { art: "entfernung", punkte: [p] }; }
      else { var a = z.messEntwurf.punkte[0]; z.messEntwurf = null; messNeu({ art: "entfernung", punkte: [a, p] }); return; }
    } else if (w === "strecke") {
      if (!z.messEntwurf) { z.messEntwurf = { art: "strecke", punkte: [] }; }
      var pk = z.messEntwurf.punkte;
      if (!pk.length || pk[pk.length - 1].distanceTo(p) > 0.05) { pk.push(p); }
    } else if (w === "hoehe") {
      if (!tr.info) { z.el("a3dMessHinweis").textContent = "Hier steht kein Gebäude. Klicke ein Gebäude an (Wand oder Dach)."; return; }
      messNeu({ art: "hoehe", punkte: [p], info: tr.info });
      return;
    } else if (w === "schatten") {
      messNeu({ art: "schatten", punkte: [p] });
      return;
    } else if (w === "sonnenstunden") {
      var wert = sonneWert(p, tr.info);
      if (!wert) {
        z.el("a3dMessHinweis").textContent = z.sonnenErgebnis ? "Hier gibt es keinen Wert (außerhalb des Ausschnitts)." : "Berechne erst die Sonnenstunden (Abschnitt „05 Sonnenstunden“).";
        return;
      }
      messNeu({ art: "sonnenstunden", punkte: [p], wert: wert });
      return;
    }
    messHinweis();
    zeichne();
  }

  function messStreckeBeenden() {
    var z = zustand, e = z.messEntwurf;
    if (!e || e.art !== "strecke") { return; }
    z.messEntwurf = null;
    if (e.punkte.length >= 2) { messNeu({ art: "strecke", punkte: e.punkte }); } else { messHinweis(); zeichne(); }
  }

  function messNeu(m) {
    var z = zustand;
    m.id = ++z.messNr;
    messBerechne(m);
    z.messungen.push(m);
    messListe();
    messHinweis();
    zeichne();
  }

  // Berechnet Zahlen, Beschriftung und Linien einer Messung
  function messBerechne(m) {
    var THREE = window.THREE, z = zustand, p = m.punkte;
    m.farbe = MESS_FARBEN[m.art];
    m.linien = [];
    if (m.art === "entfernung") {
      var a = p[0], b = p[1];
      var d3 = a.distanceTo(b), dh = Math.hypot(b.x - a.x, b.z - a.z), dy = Math.abs(b.y - a.y);
      m.linien.push({ a: a, b: b });
      if (dy > 0.2 && dh > 0.2) {
        var c = new THREE.Vector3(b.x, a.y, b.z);
        m.linien.push({ a: a, b: c, strich: true }, { a: c, b: b, strich: true });
      }
      m.anker = a.clone().add(b).multiplyScalar(0.5);
      m.zeilen = [lm(d3), "waagerecht " + lm(dh) + " · Höhe " + lm(dy)];
      m.text = "Entfernung " + lm(d3) + " (waagerecht " + lm(dh) + ", Höhenunterschied " + lm(dy) + ")";
    } else if (m.art === "strecke") {
      var gesamt = messLaenge(p), wag = 0;
      for (var i = 1; i < p.length; i++) { m.linien.push({ a: p[i - 1], b: p[i] }); wag += Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z); }
      m.anker = p[p.length - 1];
      m.zeilen = ["Σ " + lm(gesamt)];
      m.text = "Strecke " + lm(gesamt) + " (" + p.length + " Punkte, waagerecht " + lm(wag) + ")";
    } else if (m.art === "hoehe") {
      var q = p[0], info = m.info, h = info.h;
      if (info.hf) { h = info.hf(q.x, -q.z); }                  // mit Dachform: Höhe des Daches an der angeklickten Stelle
      var y0g = info.y0 || 0;                                    // Geländehöhe am Gebäude
      var fuss = new THREE.Vector3(q.x, y0g, q.z), kopf = new THREE.Vector3(q.x, y0g + h, q.z);
      m.linien.push({ a: fuss, b: kopf });
      m.anker = kopf;
      m.zeilen = ["Höhe " + lm(h)];
      var txt = (info.hf ? "Gebäudehöhe an dieser Stelle " : "Gebäudehöhe im Modell ") + lm(h);
      if (info.art === "bestand") {
        m.zeilen.push("Traufe " + lm(info.t) + " · First " + lm(info.f));
        txt += " (Traufe " + lm(info.t) + ", First " + lm(info.f) + (info.dach ? ", " + info.dach : "") + ")";
      } else { m.zeilen.push("Eigener Baukörper" + (info.name ? " " + info.name : "")); txt = "Eigener Baukörper" + (info.name ? " „" + info.name + "“" : "") + ": " + lm(h); }
      var qh = q.y - zustand.gh(q.x, -q.z);                      // Höhe des Klickpunkts über dem Gelände
      if (qh > 0.3) { txt += "; Klickpunkt " + lm(qh) + " über dem Boden"; m.zeilen.push("Klickpunkt " + lm(qh) + " über Boden"); }
      m.text = txt;
    } else if (m.art === "schatten") {
      messSchattenBerechne(m);
    } else if (m.art === "sonnenstunden") {
      var sh = m.wert.stunden, shText = sh.toFixed(1).replace(".", ",");
      m.farbe = sonnenFarbeHex(sh);
      m.anker = p[0];
      m.zeilen = [shText + " h Sonne pro Tag", m.wert.art + ", Jahresmittel"];
      m.text = "Sonnenstunden im Jahresmittel: " + shText + " Stunden pro Tag (" + m.wert.art + ")" + (p[0].y > 0.3 && m.wert.art === "Boden" ? "" : "");
    }
  }

  // ---------- Höhenraster und Fassadenpunkte in Hintergrundprozessen ----------
  // Geländehöhe (m über dem roten Punkt) aus einem Geländeausschnitt G (siehe gelaendeAusschnitt) an der Stelle (x, n) in Metern um die Mitte
  function gelaendeProbe(G, x, n) {
    var c = ((G.oe + G.a11 * x + G.a12 * n) - G.e0) / G.sch - 0.5, r = (G.n1 - (G.on + G.a21 * x + G.a22 * n)) / G.sch - 0.5;
    var c0 = Math.floor(c), r0 = Math.floor(r), fx = c - c0, fy = r - r0, c1 = c0 + 1, r1 = r0 + 1, W = G.W, H = G.H, h = G.h;
    c0 = c0 < 0 ? 0 : (c0 > W - 1 ? W - 1 : c0); c1 = c1 < 0 ? 0 : (c1 > W - 1 ? W - 1 : c1);
    r0 = r0 < 0 ? 0 : (r0 > H - 1 ? H - 1 : r0); r1 = r1 < 0 ? 0 : (r1 > H - 1 ? H - 1 : r1);
    var v = (h[r0 * W + c0] * (1 - fx) + h[r0 * W + c1] * fx) * (1 - fy) + (h[r1 * W + c0] * (1 - fx) + h[r1 * W + c1] * fx) * fy;
    return v * 0.1 - G.basis;
  }
  // Ein Band von Zeilen r0 bis r1 des Höhenrasters (Zellen von "zelle" Metern, N x N Zellen um die Mitte). a.koerper = [{ ringe, p (Dachzahlen oder null), h, y0 }]
  function hoehenStueck(a) {
    var R = a.R, zelle = a.zelle, N = a.N, r0 = a.r0, r1 = a.r1, G = a.gel, rows = r1 - r0;
    var f = new Float32Array(rows * N), m = new Uint8Array(rows * N), maxH = 0, gx, gy;
    if (G) {
      for (gy = r0; gy < r1; gy++) { for (gx = 0; gx < N; gx++) { var gv = gelaendeProbe(G, (gx + 0.5) * zelle - R, (gy + 0.5) * zelle - R); f[(gy - r0) * N + gx] = gv; if (gv > maxH) { maxH = gv; } } }
    }
    function imRinge(x, y, ringe) {
      var innen = false;
      for (var k = 0; k < ringe.length; k++) { if (imVieleck(x, y, ringe[k])) { innen = !innen; } }
      return innen;
    }
    for (var bi = 0; bi < a.koerper.length; bi++) {
      var k = a.koerper[bi], rr = k.ringe[0], minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, dach = k.p ? dachBauen(k.p) : null, hf = dach ? dach.hf : null, b0 = k.y0 || 0;
      for (var i = 0; i < rr.length; i += 2) {
        if (rr[i] < minx) { minx = rr[i]; } if (rr[i] > maxx) { maxx = rr[i]; }
        if (rr[i + 1] < miny) { miny = rr[i + 1]; } if (rr[i + 1] > maxy) { maxy = rr[i + 1]; }
        var vx = Math.floor((rr[i] + R) / zelle), vy = Math.floor((rr[i + 1] + R) / zelle);   // Ecken zählen immer
        var hv = b0 + (hf ? hf(rr[i], rr[i + 1]) : k.h);
        if (vx >= 0 && vx < N && vy >= r0 && vy < r1 && f[(vy - r0) * N + vx] < hv) { f[(vy - r0) * N + vx] = hv; m[(vy - r0) * N + vx] = 1; }
      }
      var x0 = Math.max(0, Math.floor((minx + R) / zelle)), x1 = Math.min(N - 1, Math.floor((maxx + R) / zelle));
      var y0 = Math.max(r0, Math.floor((miny + R) / zelle)), y1 = Math.min(r1 - 1, Math.floor((maxy + R) / zelle));
      for (var iy = y0; iy <= y1; iy++) {
        for (var ix = x0; ix <= x1; ix++) {
          var idx = (iy - r0) * N + ix;
          if (!hf && f[idx] >= b0 + k.h) { continue; }
          var cx = (ix + 0.5) * zelle - R, cy = (iy + 0.5) * zelle - R;
          var hz = b0 + (hf ? hf(cx, cy) : k.h);
          if (f[idx] >= hz) { continue; }
          if (imRinge(cx, cy, k.ringe)) { f[idx] = hz; m[idx] = 1; }
        }
      }
      var hmx = b0 + (dach ? dach.hmax : k.h);
      if (hmx > maxH) { maxH = hmx; }
    }
    return { f: f, m: m, maxH: new Float32Array([maxH]) };
  }
  // Fassadenstücke einer Gruppe von Körpern: Wände in Stücke von etwa schr Metern Länge und Bändern von etwa bd Metern Höhe.
  // a.koerper = [{ ringe, p, h, y0, yb }]; Ergebnis je Stück ax, an, bx, bn (Eckpunkte in Metern), y0, y1 (Höhe), nx, nn (Richtung nach außen); zu viele Stücke (über a.grenze): Anzahl -1
  function fassadenStueck(a) {
    var ax_ = [], an_ = [], bx_ = [], bn_ = [], y0_ = [], y1_ = [], nx_ = [], nn_ = [], schr = a.schr, bd = a.bd;
    for (var ki = 0; ki < a.koerper.length; ki++) {
      var k = a.koerper[ki], dach = k.p ? dachBauen(k.p) : null;
      for (var ri = 0; ri < k.ringe.length; ri++) {
        var r = k.ringe[ri], kopie = r.slice(), gegenUhr = flaecheMeter(r) > 0;
        if ((ri === 0) !== gegenUhr) { var q = []; for (var j = kopie.length - 2; j >= 0; j -= 2) { q.push(kopie[j], kopie[j + 1]); } kopie = q; }
        for (var i = 0, j2 = kopie.length - 2; i < kopie.length; j2 = i, i += 2) {
          var ax = kopie[j2], an = kopie[j2 + 1], bx = kopie[i], bn = kopie[i + 1], dx = bx - ax, dn = bn - an, l = Math.sqrt(dx * dx + dn * dn);
          if (l < 0.5) { continue; }
          var nx = dn / l, nn = -dx / l;                              // nach außen
          var segm = Math.max(1, Math.round(l / schr));
          if (ax_.length + segm * Math.max(1, Math.ceil((k.h + (k.y0 || 0) - (k.yb || 0)) / bd)) > a.grenze) { return { n: new Int32Array([-1]) }; }
          for (var sg = 0; sg < segm; sg++) {
            var t0 = sg / segm, t1 = (sg + 1) / segm;
            var hs = dach ? dach.hf(ax + dx * (t0 + t1) / 2, an + dn * (t0 + t1) / 2) : k.h;     // Höhe der Wand an dieser Stelle (Giebel!)
            var yFuss = k.yb || 0, hg = hs + (k.y0 || 0) - yFuss;
            var rows = Math.max(1, Math.ceil(hg / bd));
            for (var rw = 0; rw < rows; rw++) {
              ax_.push(ax + dx * t0); an_.push(an + dn * t0); bx_.push(ax + dx * t1); bn_.push(an + dn * t1);
              y0_.push(yFuss + hg * rw / rows); y1_.push(yFuss + hg * (rw + 1) / rows); nx_.push(nx); nn_.push(nn);
            }
          }
        }
      }
    }
    return { n: new Int32Array([ax_.length]), ax: new Float64Array(ax_), an: new Float64Array(an_), bx: new Float64Array(bx_), bn: new Float64Array(bn_),
             y0: new Float64Array(y0_), y1: new Float64Array(y1_), nx: new Float64Array(nx_), nn: new Float64Array(nn_) };
  }

  // Geländeausschnitt (nur der Teil unter dem Modell) samt Umrechnung für die Hintergrundprozesse
  function gelaendeAusschnitt(z, R) {
    var G = z.gelDaten, af = z.gelAffin, W = G.W, H = G.H, mn1 = 1e9, mx1 = -1e9, mn2 = 1e9, mx2 = -1e9;
    [[-R, -R], [R, -R], [R, R], [-R, R]].forEach(function (c) {
      var col = ((af.oe + af.a11 * c[0] + af.a12 * c[1]) - G.e0) / G.schritt - 0.5, row = (G.n1 - (af.on + af.a21 * c[0] + af.a22 * c[1])) / G.schritt - 0.5;
      if (col < mn1) { mn1 = col; } if (col > mx1) { mx1 = col; } if (row < mn2) { mn2 = row; } if (row > mx2) { mx2 = row; }
    });
    var c0 = Math.max(0, Math.floor(mn1) - 2), c1 = Math.min(W - 1, Math.ceil(mx1) + 2), r0 = Math.max(0, Math.floor(mn2) - 2), r1 = Math.min(H - 1, Math.ceil(mx2) + 2);
    var cw = c1 - c0 + 1, ch = r1 - r0 + 1, sub = new Int16Array(cw * ch);
    for (var r = 0; r < ch; r++) { sub.set(G.h.subarray((r0 + r) * W + c0, (r0 + r) * W + c0 + cw), r * cw); }
    return { h: sub, W: cw, H: ch, e0: G.e0 + c0 * G.schritt, n1: G.n1 - r0 * G.schritt, sch: G.schritt, oe: af.oe, on: af.on, a11: af.a11, a12: af.a12, a21: af.a21, a22: af.a22, basis: z.gelBasis };
  }

  // Das Höhenraster für Schatten (siehe hoehenkarte) in Hintergrundprozessen, in Bändern von Zeilen. Setzt z.hk, wenn nicht inzwischen schon eines da ist.
  function hoehenkarteAsync() {
    var z = zustand;
    if (z.hk) { return Promise.resolve(z.hk); }
    if (z.hkVorgang) { return z.hkVorgang; }
    var R = z.radius, zelle = Math.max(0.5, R / 800), N = Math.ceil(2 * R / zelle), p = arbeiterStarten();
    var baender = Math.max(1, Math.min(N, p.anzahl * 2)), hoehe = Math.ceil(N / baender), gel = z.gelaende ? gelaendeAusschnitt(z, R) : null, nr = z.modellNr;
    var koerper = z.koerper.map(function (k) {
      var r0 = k.ringe[0], mn = 1e9, mx = -1e9;
      for (var i = 1; i < r0.length; i += 2) { if (r0[i] < mn) { mn = r0[i]; } if (r0[i] > mx) { mx = r0[i]; } }
      return { ringe: k.ringe, p: k.dach ? k.dach.p : null, h: k.h, y0: k.y0 || 0, von: Math.floor((mn + R) / zelle), bis: Math.floor((mx + R) / zelle) };
    });
    var aufgaben = [];
    for (var r0 = 0; r0 < N; r0 += hoehe) {
      (function (r0, r1) {
        var liste = koerper.filter(function (k) { return k.bis >= r0 && k.von < r1; });
        aufgaben.push(arbeiterAufgabe("hoehenStueck", { R: R, zelle: zelle, N: N, r0: r0, r1: r1, gel: gel, koerper: liste }).then(function (e) { e.r0 = r0; return e; }));
      })(r0, Math.min(N, r0 + hoehe));
    }
    var vorgang = Promise.all(aufgaben).then(function (teile) {
      if (zustand !== z || z.modellNr !== nr) { return null; }
      if (z.hk) { return z.hk; }
      var f = new Float32Array(N * N), m = new Uint8Array(N * N), maxH = 0;
      teile.forEach(function (t) { f.set(t.f, t.r0 * N); m.set(t.m, t.r0 * N); if (t.maxH[0] > maxH) { maxH = t.maxH[0]; } });
      z.hk = { f: f, m: m, N: N, zelle: zelle, max: maxH, R: R };
      return z.hk;
    });
    z.hkVorgang = vorgang;
    return vorgang;
  }
  // ---- Schattenprüfung: Höhenraster aller Körper, damit Strahlen zur Sonne schnell geprüft werden können ----
  function hoehenkarte() {
    var z = zustand;
    if (z.hk) { return z.hk; }
    var R = z.radius, zelle = Math.max(0.5, R / 800), N = Math.ceil(2 * R / zelle);
    var f = new Float32Array(N * N), m = new Uint8Array(N * N), maxH = 0;       // f = höchste Fläche (Gelände oder Dach) über der Mitte, m = 1 unter einem Gebäude
    if (z.gelaende) {                    // Gelände als Grundhöhe jeder Zelle
      for (var gy = 0; gy < N; gy++) { for (var gx = 0; gx < N; gx++) { var gv = z.gh((gx + 0.5) * zelle - R, (gy + 0.5) * zelle - R); f[gy * N + gx] = gv; if (gv > maxH) { maxH = gv; } } }
    }
    function imRinge(x, y, ringe) {
      var innen = false;
      for (var k = 0; k < ringe.length; k++) { if (imVieleck(x, y, ringe[k])) { innen = !innen; } }
      return innen;
    }
    z.koerper.forEach(function (k) {
      var r0 = k.ringe[0], minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, hf = k.dach ? k.dach.hf : null, b0 = k.y0 || 0;
      for (var i = 0; i < r0.length; i += 2) {
        if (r0[i] < minx) { minx = r0[i]; } if (r0[i] > maxx) { maxx = r0[i]; }
        if (r0[i + 1] < miny) { miny = r0[i + 1]; } if (r0[i + 1] > maxy) { maxy = r0[i + 1]; }
        var vx = Math.floor((r0[i] + R) / zelle), vy = Math.floor((r0[i + 1] + R) / zelle);   // Ecken zählen immer
        var hv = b0 + (hf ? hf(r0[i], r0[i + 1]) : k.h);
        if (vx >= 0 && vx < N && vy >= 0 && vy < N && f[vy * N + vx] < hv) { f[vy * N + vx] = hv; m[vy * N + vx] = 1; }
      }
      var x0 = Math.max(0, Math.floor((minx + R) / zelle)), x1 = Math.min(N - 1, Math.floor((maxx + R) / zelle));
      var y0 = Math.max(0, Math.floor((miny + R) / zelle)), y1 = Math.min(N - 1, Math.floor((maxy + R) / zelle));
      for (var iy = y0; iy <= y1; iy++) {
        for (var ix = x0; ix <= x1; ix++) {
          var idx = iy * N + ix;
          if (!hf && f[idx] >= b0 + k.h) { continue; }
          var cx = (ix + 0.5) * zelle - R, cy = (iy + 0.5) * zelle - R;
          var hz = b0 + (hf ? hf(cx, cy) : k.h);
          if (f[idx] >= hz) { continue; }
          if (imRinge(cx, cy, k.ringe)) { f[idx] = hz; m[idx] = 1; }
        }
      }
      var hmx = b0 + (k.dach ? k.dach.hmax : k.h);
      if (hmx > maxH) { maxH = hmx; }
    });
    z.hk = { f: f, m: m, N: N, zelle: zelle, max: maxH, R: R };
    return z.hk;
  }

  // Liegt der Punkt p (Raumpunkt) bei diesem Sonnenstand im Schatten?
  function imSchatten(p, s) {
    var hk = hoehenkarte(), R = hk.R;
    var tanH = Math.tan(s.hoehe);
    var dx = Math.sin(s.azimut), dn = Math.cos(s.azimut);        // waagerecht zur Sonne (Ost, Nord)
    var x = p.x, n = -p.z;                                        // Nord = -z
    var maxD = Math.min(R * 1.5, (hk.max - p.y) / tanH);
    for (var u = hk.zelle * 1.2; u <= maxD; u += hk.zelle) {
      var ix = Math.floor((x + dx * u + R) / hk.zelle), iy = Math.floor((n + dn * u + R) / hk.zelle);
      if (ix < 0 || ix >= hk.N || iy < 0 || iy >= hk.N) { if (u > R * 2) { break; } continue; }
      if (hk.f[iy * hk.N + ix] > p.y + u * tanH + 0.25) { return true; }
    }
    return false;
  }

  function tagesVerlauf(p) {
    var z = zustand, d = z.datum;
    var zt = sonnenZeiten(z.mitte.lat, z.mitte.lng, d.j, d.m, d.t);
    if (zt.auf === null || zt.unter === null) { return { text: "keine Sonne an diesem Tag", minuten: 0 }; }
    var inter = [], offen = null, min = 0, schritt = 5 / 60, letzte = zt.auf;
    for (var t = zt.auf; t <= zt.unter + 1e-9; t += schritt) {
      var s = sonnenstand(z.mitte.lat, z.mitte.lng, d.j, d.m, d.t, t);
      var sonnig = s.hoehe > 0.0087 && !imSchatten(p, s) && baumLicht(p, s) >= 0.5;
      if (sonnig) { if (offen === null) { offen = t; } min += 5; }
      else if (offen !== null) { inter.push([offen, letzte]); offen = null; }
      letzte = t;
    }
    if (offen !== null) { inter.push([offen, letzte]); }
    if (!inter.length) { return { text: "an diesem Tag keine direkte Sonne", minuten: 0 }; }
    var teile = inter.map(function (iv) { return uhrzeit(iv[0]) + "–" + uhrzeit(iv[1]); });
    return { text: teile.join(", ") + " Uhr (zusammen " + stdText(min) + ")", minuten: min };
  }

  function messSchattenBerechne(m) {
    var z = zustand, d = z.datum, p = m.punkte[0], s = z.stand;
    var jetzt = "Sonne", licht = 1;
    if (s.hoehe <= 0.0087) { jetzt = "Sonne unter dem Horizont"; }
    else if (imSchatten(p, s)) { jetzt = "Schatten"; }
    else {
      licht = baumLicht(p, s);
      if (licht < 0.3) { jetzt = "Schatten (Baum)"; } else if (licht < 0.7) { jetzt = "Halbschatten (Baum)"; }
    }
    var schluessel = d.j + "-" + d.m + "-" + d.t + "|" + z.baumToken + "|" + baumDichte() + "|" + z.el("a3dBaeume").checked + z.el("a3dBaumSchatten").checked + z.el("a3dWald").checked + "|" + z.waldToken + "|" + z.el("a3dWaldHoehe").value;
    if (!m.tag || m.tagSchluessel !== schluessel || m.tagKarte !== z.hk) {
      m.tag = tagesVerlauf(p); m.tagSchluessel = schluessel; m.tagKarte = z.hk;
    }
    m.sonnig = jetzt === "Sonne";
    m.farbe = m.sonnig ? "#e0a800" : "#333333";
    m.linien = [];
    m.anker = p;
    var kurz = d.t + ". " + MONATE[d.m - 1].slice(0, 3) + ".";
    m.zeilen = [jetzt + " (" + uhrzeit(z.zeit) + ")", "Sonne am " + kurz + ": " + (m.tag.minuten ? stdText(m.tag.minuten) : "keine")];
    m.text = "Schattenprüfung am " + datumText(d.j, d.m, d.t) + ", " + uhrzeit(z.zeit) + " Uhr: " + jetzt + ". Direkte Sonne: " + m.tag.text +
             (p.y - z.gh(p.x, -p.z) > 0.3 ? ". Punkt " + lm(p.y - z.gh(p.x, -p.z)) + " über dem Boden" : "") + ".";
  }

  function messSchattenAktualisieren() {
    var z = zustand;
    if (!z || !z.messungen.some(function (m) { return m.art === "schatten"; })) { return; }
    z.messungen.forEach(function (m) { if (m.art === "schatten") { messSchattenBerechne(m); } });
    messListe();
  }

  function messListe() {
    var z = zustand, ul = z.el("a3dMessListe");
    ul.innerHTML = "";
    z.messungen.forEach(function (m, i) {
      var li = document.createElement("li"); li.className = "mess";
      var farbe = document.createElement("i"); farbe.style.background = m.farbe;
      var t = document.createElement("span"); t.className = "n"; t.textContent = (i + 1) + ". " + m.text;
      var x = document.createElement("button"); x.type = "button"; x.className = "zweit"; x.textContent = "✕"; x.title = "Diese Messung löschen";
      x.addEventListener("click", function () { z.messungen.splice(z.messungen.indexOf(m), 1); messListe(); zeichne(); });
      li.appendChild(farbe); li.appendChild(t); li.appendChild(x);
      ul.appendChild(li);
    });
  }

  // ---- Zeichnen der Messungen (über dem 3D-Bild, auch ins gespeicherte Bild) ----
  function ueberlagerungZeichnen() {
    var z = zustand, ue = z.el("a3dUeber");
    var c = ue.getContext("2d");
    var dpr = ue.width / Math.max(1, ue.clientWidth);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, ue.width, ue.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    messZeichnen(c, z.aktuelleKamera, ue.clientWidth, ue.clientHeight, 1);
  }

  function messZeichnen(c, kamera, B, H, u) {
    var z = zustand;
    if (!kamera) { return; }
    var alle = z.messungen.slice();
    if (z.messEntwurf && z.messEntwurf.punkte.length) {         // Messung, die gerade entsteht
      var e = z.messEntwurf, pseudo = { farbe: MESS_FARBEN[e.art], linien: [], punkte: e.punkte, entwurf: true };
      for (var i = 1; i < e.punkte.length; i++) { pseudo.linien.push({ a: e.punkte[i - 1], b: e.punkte[i] }); }
      if (e.art === "strecke" && e.punkte.length > 1) { pseudo.anker = e.punkte[e.punkte.length - 1]; pseudo.zeilen = ["Σ " + lm(messLaenge(e.punkte))]; }
      alle.push(pseudo);
    }
    function proj(v) {
      var p = v.clone().project(kamera);
      return { x: (p.x * 0.5 + 0.5) * B, y: (-p.y * 0.5 + 0.5) * H, ok: p.z > -1 && p.z < 1 };
    }
    c.lineCap = "round"; c.lineJoin = "round";
    alle.forEach(function (m) {
      // Linien: erst weißer Saum, dann Farbe
      m.linien.forEach(function (l) {
        var a = proj(l.a), b = proj(l.b);
        if (!a.ok || !b.ok) { return; }
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y);
        c.setLineDash(l.strich ? [6 * u, 4 * u] : []);
        c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = (l.strich ? 3.5 : 5) * u; c.stroke();
        c.strokeStyle = m.farbe; c.lineWidth = (l.strich ? 1.5 : 2.5) * u; c.stroke();
      });
      c.setLineDash([]);
      // Punkte
      var pk = m.punkte || [];
      pk.forEach(function (v) {
        var a = proj(v); if (!a.ok) { return; }
        c.beginPath(); c.arc(a.x, a.y, 4.5 * u, 0, 2 * Math.PI);
        c.fillStyle = "#ffffff"; c.fill(); c.lineWidth = 2 * u; c.strokeStyle = m.farbe; c.stroke();
      });
      // Beschriftung
      if (m.anker && m.zeilen) {
        var a = proj(m.anker);
        if (!a.ok) { return; }
        var schrift = 12 * u, zeile = 15 * u, pad = 5 * u, br = 0;
        m.zeilen.forEach(function (t, k) {
          c.font = (k === 0 ? "bold " : "") + (k === 0 ? schrift : schrift * 0.88) + "px Bahnschrift, 'Segoe UI', Arial, sans-serif";
          br = Math.max(br, c.measureText(t).width);
        });
        var kb = br + 2 * pad, kh = m.zeilen.length * zeile + 2 * pad - 2 * u;
        var kx = Math.max(2 * u, Math.min(B - kb - 2 * u, a.x - kb / 2)), ky = Math.max(2 * u, Math.min(H - kh - 2 * u, a.y - kh - 12 * u));
        c.fillStyle = "rgba(255,255,255,0.94)"; c.fillRect(kx, ky, kb, kh);
        c.strokeStyle = m.farbe; c.lineWidth = 1.5 * u; c.strokeRect(kx, ky, kb, kh);
        c.fillStyle = "#1a1a1a"; c.textBaseline = "top"; c.textAlign = "left";
        m.zeilen.forEach(function (t, k) {
          c.font = (k === 0 ? "bold " : "") + (k === 0 ? schrift : schrift * 0.88) + "px Bahnschrift, 'Segoe UI', Arial, sans-serif";
          c.fillText(t, kx + pad, ky + pad - u + k * zeile);
        });
      }
    });
  }

  // ---------- Sonnenstunden (Jahresmittel) ----------
  // Für jede Stelle (Boden, Dach, Fassade) wird gerechnet, wie viele Stunden am Tag im Jahresmittel direkte Sonne ankommt.
  // Verfahren: Von jeder Stelle aus wird in 72 Himmelsrichtungen der "Horizont" bestimmt (wie hoch Gebäude und Kronen dort in den
  // Himmel ragen). Dann wird für 12 Monatstage (je der 15.) alle 10 Minuten geprüft, ob die Sonne über diesem Horizont steht.
  // Bäume und Wälder lassen je nach Belaubung des Monats einen Teil des Lichts durch. Wolken sind nicht berücksichtigt.
  // Die Rechenkerne stehen als eigenständige Funktionen da, damit sie auch in Hintergrundprozessen (Web Worker) laufen können.
  var SONNE_BINS = 72;                 // Himmelsrichtungen (alle 5 Grad)
  var SONNE_MAX_RADIUS = 2000;         // größere Ausschnitte werden nicht gerechnet
  var SONNE_FASSADEN_MAX_RADIUS = 800; // Fassaden nur bei kleineren Ausschnitten

  function sonnenKern(P, von, bis) {
    var NR = P.NR, zr = P.zr, R = P.R, hkF = P.hkF, hkM = P.hkM, hkN = P.hkN, hkZ = P.hkZ, cH = P.cH, cT = P.cT, cN = P.cN, cZ = P.cZ;
    var NB = P.NB, bdx = P.bdx, bdn = P.bdn, dist = P.dist, nd = dist.length, binUsed = P.binUsed;
    var tanEl = P.tanEl, ns = tanEl.length, abin = P.abin, afr = P.afr, mon = P.mon, wgt = P.wgt, sinEl = P.sinEl, tau = P.tau, dens = P.dens;
    var out = new Float32Array((bis - von) * NR);
    var slopeS = new Float32Array(NB), slopeC = new Float32Array(NB), typC = new Uint8Array(NB);
    var zweiR = 2 * R;
    for (var iy = von; iy < bis; iy++) {
      var cn = (iy + 0.5) * zr - R;
      for (var ix = 0; ix < NR; ix++) {
        var cx = (ix + 0.5) * zr - R;
        var hi = Math.min(hkN - 1, Math.floor((cx + R) / hkZ)), hj = Math.min(hkN - 1, Math.floor((cn + R) / hkZ));
        var h0 = hkF[hj * hkN + hi];
        var ci = Math.min(cN - 1, Math.floor((cx + R) / cZ)), cj = Math.min(cN - 1, Math.floor((cn + R) / cZ));
        var ownT = hkM[hj * hkN + hi] === 0 ? cT[cj * cN + ci] : 0, ownH = ownT ? cH[cj * cN + ci] - h0 : 0;      // Baum auf freier Fläche: Kronenhöhe über dem Gelände
        for (var b = 0; b < NB; b++) {
          if (!binUsed[b]) { continue; }
          var best = -1e9, bestC = -1e9, tc = 0, ddx = bdx[b], ddn = bdn[b];
          for (var k = 0; k < nd; k++) {
            var d = dist[k], x = cx + ddx * d + R, n = cn + ddn * d + R;
            if (x < 0 || n < 0 || x >= zweiR || n >= zweiR) { break; }
            var sl = (hkF[Math.floor(n / hkZ) * hkN + Math.floor(x / hkZ)] - h0) / d;
            if (sl > best) { best = sl; }
            var cidx = Math.floor(n / cZ) * cN + Math.floor(x / cZ), chh = cH[cidx];
            if (cT[cidx] > 0) { var sc = (chh - h0) / d; if (sc > bestC) { bestC = sc; tc = cT[cidx]; } }
          }
          slopeS[b] = best; slopeC[b] = bestC; typC[b] = tc;
        }
        var sum = 0;
        for (var s = 0; s < ns; s++) {
          var ib = abin[s], fr = afr[s], ib2 = ib + 1 >= NB ? 0 : ib + 1;
          var te = tanEl[s];
          if (te <= slopeS[ib] * (1 - fr) + slopeS[ib2] * fr) { continue; }
          var f = 1;
          if (te <= slopeC[ib] * (1 - fr) + slopeC[ib2] * fr) { f = tau[mon[s] * 4 + (typC[ib] || typC[ib2])]; }
          if (ownT) { f *= Math.exp(-0.5 * dens[mon[s] * 4 + ownT] * Math.min(7, 0.55 * ownH) / Math.max(sinEl[s], 0.25)); }
          sum += f * wgt[s];
        }
        out[(iy - von) * NR + ix] = sum;
      }
    }
    return out;
  }

  // Fassadenpunkte: x, y (Höhe), n (Nord), Richtung der Wand nach außen (nx, nn). Nur Himmelsrichtungen vor der Wand zählen.
  function fassadenKern(P, von, bis) {
    var R = P.R, hkF = P.hkF, hkN = P.hkN, hkZ = P.hkZ, cH = P.cH, cT = P.cT, cN = P.cN, cZ = P.cZ;
    var NB = P.NB, bdx = P.bdx, bdn = P.bdn, dist = P.dist, nd = dist.length;
    var tanEl = P.tanEl, ns = tanEl.length, abin = P.abin, afr = P.afr, mon = P.mon, wgt = P.wgt, tau = P.tau, sdx = P.sdx, sdn = P.sdn;
    var fx = P.fx, fy = P.fy, fn = P.fn, fnx = P.fnx, fnn = P.fnn;
    var out = new Float32Array(bis - von);
    var slopeS = new Float32Array(NB), slopeC = new Float32Array(NB), typC = new Uint8Array(NB);
    var zweiR = 2 * R;
    for (var q = von; q < bis; q++) {
      var cx = fx[q], cn = fn[q], h0 = fy[q], nx = fnx[q], nn = fnn[q];
      for (var b = 0; b < NB; b++) {
        slopeS[b] = -1e9; slopeC[b] = -1e9; typC[b] = 0;
        var ddx = bdx[b], ddn = bdn[b];
        if (ddx * nx + ddn * nn < -0.2) { continue; }
        var best = -1e9, bestC = -1e9, tc = 0;
        for (var k = 0; k < nd; k++) {
          var d = dist[k], x = cx + ddx * d + R, n = cn + ddn * d + R;
          if (x < 0 || n < 0 || x >= zweiR || n >= zweiR) { break; }
          var sl = (hkF[Math.floor(n / hkZ) * hkN + Math.floor(x / hkZ)] - h0) / d;
          if (sl > best) { best = sl; }
          var cidx = Math.floor(n / cZ) * cN + Math.floor(x / cZ), chh = cH[cidx];
          if (cT[cidx] > 0) { var sc = (chh - h0) / d; if (sc > bestC) { bestC = sc; tc = cT[cidx]; } }
        }
        slopeS[b] = best; slopeC[b] = bestC; typC[b] = tc;
      }
      var sum = 0;
      for (var s = 0; s < ns; s++) {
        if (sdx[s] * nx + sdn[s] * nn <= 0.02) { continue; }            // die Sonne steht hinter der Wand
        var ib = abin[s], fr = afr[s], ib2 = ib + 1 >= NB ? 0 : ib + 1;
        var te = tanEl[s];
        if (te <= slopeS[ib] * (1 - fr) + slopeS[ib2] * fr) { continue; }
        var f = 1;
        if (te <= slopeC[ib] * (1 - fr) + slopeC[ib2] * fr) { f = tau[mon[s] * 4 + (typC[ib] || typC[ib2])]; }
        sum += f * wgt[s];
      }
      out[q - von] = sum;
    }
    return out;
  }

  function sonneFarbeBytes(h) { var c = sonnenFarbe(h); return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]; }

  // Dachhöhen und Baumkronen als Raster für die Rechenkerne
  function sonneBaumRaster(hk) {
    var z = zustand, R = z.radius, zelle = Math.max(1, hk.zelle), N = Math.ceil(2 * R / zelle);
    var cH = new Float32Array(N * N), cT = new Uint8Array(N * N);       // cH = Oberkante der Krone über der Mitte, gilt nur dort, wo cT > 0
    var schatten = z.el("a3dBaumSchatten").checked;
    if (schatten && z.el("a3dBaeume").checked && z.baeume) {
      z.baeume.forEach(function (b) {
        var a = b.kr / 2, hk2 = b.h - b.stamm, cy = b.stamm + hk2 / 2, typ = b.ig ? 2 : 1, by = b.y0 || 0;
        var x0 = Math.max(0, Math.floor((b.x - a + R) / zelle)), x1 = Math.min(N - 1, Math.floor((b.x + a + R) / zelle));
        var y0 = Math.max(0, Math.floor((b.n - a + R) / zelle)), y1 = Math.min(N - 1, Math.floor((b.n + a + R) / zelle));
        for (var iy = y0; iy <= y1; iy++) {
          for (var ix = x0; ix <= x1; ix++) {
            var dx = (ix + 0.5) * zelle - R - b.x, dn = (iy + 0.5) * zelle - R - b.n, r = Math.sqrt(dx * dx + dn * dn);
            if (r > a) { continue; }
            var top = by + (b.ig ? b.stamm + hk2 * (1 - r / a) : cy + (hk2 / 2) * Math.sqrt(Math.max(0, 1 - (r * r) / (a * a))));
            if (!cT[iy * N + ix] || top > cH[iy * N + ix]) { cH[iy * N + ix] = top; cT[iy * N + ix] = typ; }
          }
        }
      });
    }
    if (schatten && z.el("a3dWald").checked && z.waelder && z.waelder.length) {
      var wh = waldHoehe();
      z.waelder.forEach(function (k) {
        var r0 = k.ringe[0], minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
        for (var i = 0; i < r0.length; i += 2) {
          if (r0[i] < minx) { minx = r0[i]; } if (r0[i] > maxx) { maxx = r0[i]; }
          if (r0[i + 1] < miny) { miny = r0[i + 1]; } if (r0[i + 1] > maxy) { maxy = r0[i + 1]; }
        }
        var x0 = Math.max(0, Math.floor((minx + R) / zelle)), x1 = Math.min(N - 1, Math.floor((maxx + R) / zelle));
        var y0 = Math.max(0, Math.floor((miny + R) / zelle)), y1 = Math.min(N - 1, Math.floor((maxy + R) / zelle));
        for (var iy = y0; iy <= y1; iy++) {
          for (var ix = x0; ix <= x1; ix++) {
            var cx = (ix + 0.5) * zelle - R, cy = (iy + 0.5) * zelle - R, innen = false;
            for (var q = 0; q < k.ringe.length; q++) { if (imVieleck(cx, cy, k.ringe[q])) { innen = !innen; } }
            var wtop = wh + z.gh(cx, cy);
            if (innen && (!cT[iy * N + ix] || wtop > cH[iy * N + ix])) { cH[iy * N + ix] = wtop; cT[iy * N + ix] = 3; }
          }
        }
      });
    }
    return { cH: cH, cT: cT, cN: N, cZ: zelle };
  }

  // Alle Sonnenstellungen: 12 Monatstage (je der 15.), alle 10 Minuten zwischen Auf- und Untergang
  function sonneStellungen() {
    var z = zustand, NB = SONNE_BINS, tage = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    var liste = [], benutzt = new Uint8Array(NB);
    for (var m = 1; m <= 12; m++) {
      for (var t = 0; t < 24; t += 1 / 6) {
        var s = sonnenstand(z.mitte.lat, z.mitte.lng, z.datum.j, m, 15, t + 1 / 12);
        if (s.hoehe < 0.0175) { continue; }                          // erst ab 1 Grad über dem Horizont
        var a = s.azimut % (2 * Math.PI); if (a < 0) { a += 2 * Math.PI; }
        var pos = a / (2 * Math.PI) * NB, ib = Math.floor(pos) % NB;
        benutzt[ib] = 1; benutzt[(ib + 1) % NB] = 1;
        liste.push({ tan: Math.tan(s.hoehe), sin: Math.sin(s.hoehe), ib: ib, fr: pos - Math.floor(pos), m: m - 1, w: (1 / 6) * tage[m - 1] / 365, sx: Math.sin(a), sn: Math.cos(a) });
      }
    }
    return { liste: liste, benutzt: benutzt };
  }

  function sonneParameter() {
    var z = zustand, R = z.radius, NB = SONNE_BINS;
    var hk = hoehenkarte();
    var bc = sonneBaumRaster(hk);
    var st = sonneStellungen(), ns = st.liste.length;
    var zr = Math.max(2, Math.round(R / 200 * 2) / 2), NR = Math.ceil(2 * R / zr);
    var P = {
      R: R, NR: NR, zr: zr, NB: NB, hkF: hk.f, hkM: hk.m, hkN: hk.N, hkZ: hk.zelle, cH: bc.cH, cT: bc.cT, cN: bc.cN, cZ: bc.cZ,
      bdx: new Float32Array(NB), bdn: new Float32Array(NB), binUsed: st.benutzt,
      tanEl: new Float32Array(ns), sinEl: new Float32Array(ns), abin: new Int16Array(ns), afr: new Float32Array(ns), mon: new Uint8Array(ns),
      wgt: new Float32Array(ns), sdx: new Float32Array(ns), sdn: new Float32Array(ns), tau: new Float32Array(48), dens: new Float32Array(48)
    };
    for (var b = 0; b < NB; b++) { P.bdx[b] = Math.sin(b / NB * 2 * Math.PI); P.bdn[b] = Math.cos(b / NB * 2 * Math.PI); }
    st.liste.forEach(function (s, i) {
      P.tanEl[i] = s.tan; P.sinEl[i] = s.sin; P.abin[i] = s.ib; P.afr[i] = s.fr; P.mon[i] = s.m; P.wgt[i] = s.w; P.sdx[i] = s.sx; P.sdn[i] = s.sn;
    });
    // Blattdichte je Monat: Laubbaum nach Jahreszeit, Nadelbaum immer dicht, Wald dazwischen; 6 m Weg durch die Krone
    for (var m = 0; m < 12; m++) {
      var laub = Math.max(0.08, laubAnteil(m + 1, 15));
      var d = [0, laub, 0.85, 0.4 + 0.6 * laub];
      for (var t = 0; t < 4; t++) { P.dens[m * 4 + t] = d[t]; P.tau[m * 4 + t] = t === 0 ? 1 : Math.exp(-BAUM_DAEMPFUNG * d[t] * 6); }
    }
    var dist = [], d0 = 1.2;
    while (d0 < 500) { dist.push(d0); d0 = d0 * 1.07 + 0.4; }
    P.dist = new Float32Array(dist);
    // Höhe der Gebäude je Rechenzelle (für die Dächer)
    P.occ = new Float32Array(NR * NR);          // Höhe der Dachfläche über der Mitte (nur wo occM = 1)
    P.occM = new Uint8Array(NR * NR);           // 1 = Zelle liegt unter einem Gebäude
    for (var iy = 0; iy < NR; iy++) {
      for (var ix = 0; ix < NR; ix++) {
        var hi = Math.min(hk.N - 1, Math.floor(((ix + 0.5) * zr) / hk.zelle)), hj = Math.min(hk.N - 1, Math.floor(((iy + 0.5) * zr) / hk.zelle));
        P.occ[iy * NR + ix] = hk.f[hj * hk.N + hi];
        P.occM[iy * NR + ix] = hk.m[hj * hk.N + hi];
      }
    }
    return P;
  }

  // Fassadenpunkte aller Gebäude: Wände in Stücke von etwa 3 m Länge und Bändern von 3 m Höhe zerlegt, je ein Messpunkt in der Mitte
  function sonneFassaden(P) {
    var z = zustand, schritt = Math.max(3, P.zr), band = 3, teile = null;
    var GRENZE = 150000;           // so viele Fassadenpunkte höchstens (sonst wird gröber gerechnet)
    function zerlege(schr, bd) {   // { ax, an, bx, bn, y0, y1, nx, nn } oder null, wenn es zu viele werden
      var liste = [];
      for (var ki = 0; ki < z.koerper.length; ki++) {
        var k = z.koerper[ki];
        for (var ri = 0; ri < k.ringe.length; ri++) {
          var r = k.ringe[ri], kopie = r.slice(), gegenUhr = flaecheMeter(r) > 0;
          if ((ri === 0) !== gegenUhr) { var q = []; for (var j = kopie.length - 2; j >= 0; j -= 2) { q.push(kopie[j], kopie[j + 1]); } kopie = q; }
          for (var i = 0, j2 = kopie.length - 2; i < kopie.length; j2 = i, i += 2) {
            var ax = kopie[j2], an = kopie[j2 + 1], bx = kopie[i], bn = kopie[i + 1], dx = bx - ax, dn = bn - an, l = Math.sqrt(dx * dx + dn * dn);
            if (l < 0.5) { continue; }
            var nx = dn / l, nn = -dx / l;                              // nach außen
            var segm = Math.max(1, Math.round(l / schr));
            if (liste.length + segm * Math.max(1, Math.ceil((k.h + (k.y0 || 0) - (k.yb || 0)) / bd)) > GRENZE) { return null; }
            for (var sg = 0; sg < segm; sg++) {
              var t0 = sg / segm, t1 = (sg + 1) / segm;
              var hs = k.dach ? k.dach.hf(ax + dx * (t0 + t1) / 2, an + dn * (t0 + t1) / 2) : k.h;     // Höhe der Wand an dieser Stelle (Giebel!)
              var yFuss = k.yb || 0, hg = hs + (k.y0 || 0) - yFuss;                   // von der tiefsten Stelle des Geländes bis zur Wandoberkante
              var rows = Math.max(1, Math.ceil(hg / bd));
              for (var rw = 0; rw < rows; rw++) {
                liste.push({ ax: ax + dx * t0, an: an + dn * t0, bx: ax + dx * t1, bn: an + dn * t1, y0: yFuss + hg * rw / rows, y1: yFuss + hg * (rw + 1) / rows, nx: nx, nn: nn });
              }
            }
          }
        }
      }
      return liste;
    }
    for (var versuch = 0; versuch < 8 && !teile; versuch++) { teile = zerlege(schritt, band); schritt *= 1.5; band *= 1.5; }
    if (!teile) { teile = []; }
    var n = teile.length;
    P.fx = new Float32Array(n); P.fy = new Float32Array(n); P.fn = new Float32Array(n); P.fnx = new Float32Array(n); P.fnn = new Float32Array(n);
    teile.forEach(function (t, i) {
      P.fx[i] = (t.ax + t.bx) / 2 + t.nx * 0.35; P.fn[i] = (t.an + t.bn) / 2 + t.nn * 0.35; P.fy[i] = (t.y0 + t.y1) / 2; P.fnx[i] = t.nx; P.fnn[i] = t.nn;
    });
    return teile;
  }

  // Dasselbe wie sonneFassaden, aber verteilt auf die Hintergrundprozesse. Gibt ein Versprechen mit der Liste der Fassadenstücke zurück (füllt P.fx usw.).
  function sonneFassadenAsync(P) {
    var z = zustand, p = arbeiterStarten(), GRENZE = 150000;
    var koerper = z.koerper.map(function (k) { return { ringe: k.ringe, p: k.dach ? k.dach.p : null, h: k.h, y0: k.y0 || 0, yb: k.yb || 0 }; });
    var stueck = Math.max(200, Math.ceil(koerper.length / (p.anzahl * 2)));
    function versuch(nr, schr, bd) {
      if (nr >= 8) { return Promise.resolve([]); }
      var aufgaben = [];
      for (var von = 0; von < koerper.length; von += stueck) {
        aufgaben.push(arbeiterAufgabe("fassadenStueck", { koerper: koerper.slice(von, von + stueck), schr: schr, bd: bd, grenze: GRENZE }));
      }
      return Promise.all(aufgaben).then(function (teile) {
        var summe = 0, zuViel = false;
        teile.forEach(function (t) { if (t.n[0] < 0) { zuViel = true; } else { summe += t.n[0]; } });
        if (zuViel || summe > GRENZE) { return versuch(nr + 1, schr * 1.5, bd * 1.5); }
        return teile;
      });
    }
    return versuch(0, Math.max(3, P.zr), 3).then(function (teile) {
      var n = 0;
      teile.forEach(function (t) { n += t.n[0]; });
      var liste = new Array(n), i = 0;
      P.fx = new Float32Array(n); P.fy = new Float32Array(n); P.fn = new Float32Array(n); P.fnx = new Float32Array(n); P.fnn = new Float32Array(n);
      teile.forEach(function (t) {
        for (var j = 0; j < t.n[0]; j++, i++) {
          liste[i] = { ax: t.ax[j], an: t.an[j], bx: t.bx[j], bn: t.bn[j], y0: t.y0[j], y1: t.y1[j], nx: t.nx[j], nn: t.nn[j] };
          P.fx[i] = (t.ax[j] + t.bx[j]) / 2 + t.nx[j] * 0.35; P.fn[i] = (t.an[j] + t.bn[j]) / 2 + t.nn[j] * 0.35; P.fy[i] = (t.y0[j] + t.y1[j]) / 2; P.fnx[i] = t.nx[j]; P.fnn[i] = t.nn[j];
        }
      });
      return liste;
    });
  }
  // Führt die Rechnung aus: mit Hintergrundprozessen (schnell), sonst Stück für Stück im Hauptprogramm. Gibt ein Versprechen zurück.
  function sonneRechnen(P, mitFassaden, beiFortschritt) {
    var z = zustand;
    var NR = P.NR, jobs = [], i;
    var zeilen = 6;
    for (i = 0; i < NR; i += zeilen) { jobs.push({ art: "boden", von: i, bis: Math.min(NR, i + zeilen) }); }
    var nf = mitFassaden ? P.fx.length : 0, bloecke = 400;
    for (i = 0; i < nf; i += bloecke) { jobs.push({ art: "fassade", von: i, bis: Math.min(nf, i + bloecke) }); }
    var gesamt = jobs.length, fertig = 0, ergebnisBoden = new Float32Array(NR * NR), ergebnisFassade = new Float32Array(nf);
    var naechster = 0;
    function ablegen(job, out) {
      if (job.art === "boden") { ergebnisBoden.set(out, job.von * NR); } else { ergebnisFassade.set(out, job.von); }
      fertig++; beiFortschritt(fertig / gesamt);
    }
    return new Promise(function (erfuellt, abgebrochen) {
      z.sonneAbbruch = function () { (z.sonneArbeiter || []).forEach(function (w) { w.terminate(); }); z.sonneArbeiter = []; abgebrochen(new Error("abgebrochen")); };
      function imHauptprogramm() {
        (z.sonneArbeiter || []).forEach(function (w) { w.terminate(); }); z.sonneArbeiter = [];
        function schritt() {
          if (zustand !== z) { return; }
          var start = performance.now();
          while (naechster < jobs.length && performance.now() - start < 40) {
            var j = jobs[naechster++];
            ablegen(j, (j.art === "boden" ? sonnenKern : fassadenKern)(P, j.von, j.bis));
          }
          if (naechster < jobs.length) { setTimeout(schritt, 0); } else { erfuellt({ boden: ergebnisBoden, fassade: ergebnisFassade }); }
        }
        schritt();
      }
      var anzahl = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
      var quelle = "var sonnenKern=" + sonnenKern.toString() + ";var fassadenKern=" + fassadenKern.toString() + ";var P=null;" +
        "self.onmessage=function(e){var d=e.data;if(d.init){P=d.init;self.postMessage({bereit:true});return;}" +
        "var out=(d.art==='fassade'?fassadenKern:sonnenKern)(P,d.von,d.bis);self.postMessage({id:d.id,out:out},[out.buffer]);};";
      var blob, url;
      try {
        blob = new Blob([quelle], { type: "text/javascript" }); url = URL.createObjectURL(blob);
        z.sonneArbeiter = [];
        var bereit = 0, fehlerGemeldet = false, laufend = 0;
        function naechsteAufgabe(w) {
          if (naechster >= jobs.length) { if (laufend === 0 && fertig === gesamt) { z.sonneArbeiter.forEach(function (x) { x.terminate(); }); z.sonneArbeiter = []; erfuellt({ boden: ergebnisBoden, fassade: ergebnisFassade }); } return; }
          var id = naechster++, j = jobs[id];
          laufend++;
          w.zuletzt = id;
          w.postMessage({ id: id, art: j.art, von: j.von, bis: j.bis });
        }
        for (var wi = 0; wi < anzahl; wi++) {
          (function () {
            var w = new Worker(url);
            w.onmessage = function (ev) {
              if (ev.data.bereit) { bereit++; naechsteAufgabe(w); return; }
              laufend--;
              ablegen(jobs[ev.data.id], ev.data.out);
              naechsteAufgabe(w);
            };
            w.onerror = function () {
              if (fehlerGemeldet) { return; }
              fehlerGemeldet = true;
              // Hintergrundprozess nicht möglich: Aufträge, die noch nicht fertig sind, im Hauptprogramm nachholen
              naechster = 0; fertig = 0; laufend = 0; imHauptprogramm();
            };
            z.sonneArbeiter.push(w);
            w.postMessage({ init: P });
          })();
        }
      } catch (e) { imHauptprogramm(); }
    });
  }

  // Farbbilder und Netze aus dem Ergebnis bauen und anzeigen
  function sonneAnzeigen(P, erg, fassadenTeile) {
    var z = zustand, THREE = window.THREE, R = P.R, NR = P.NR, zr = P.zr;
    sonneLeeren();
    var mitDach = z.el("a3dSonneDach").checked, mitFassade = z.el("a3dSonneFassade").checked && fassadenTeile && fassadenTeile.length;

    // Farbbilder: eins für den Boden in 3D (Gebäudeflächen durchsichtig), eins für die Karte (Dächer gefärbt)
    var c3 = document.createElement("canvas"), c2 = document.createElement("canvas");
    c3.width = c3.height = c2.width = c2.height = NR;
    var x3 = c3.getContext("2d"), x2 = c2.getContext("2d");
    var d3 = x3.createImageData(NR, NR), d2 = x2.createImageData(NR, NR);
    var hoechst = 0, summe = 0, anzahl = 0;
    for (var iy = 0; iy < NR; iy++) {
      for (var ix = 0; ix < NR; ix++) {
        var v = erg.boden[iy * NR + ix], col = sonneFarbeBytes(v), px = ((NR - 1 - iy) * NR + ix) * 4;      // Norden oben
        d2.data[px] = col[0]; d2.data[px + 1] = col[1]; d2.data[px + 2] = col[2]; d2.data[px + 3] = 255;
        if (P.occM[iy * NR + ix]) { d3.data[px + 3] = 0; }
        else { d3.data[px] = col[0]; d3.data[px + 1] = col[1]; d3.data[px + 2] = col[2]; d3.data[px + 3] = 255; summe += v; anzahl++; }
        if (v > hoechst) { hoechst = v; }
      }
    }
    x3.putImageData(d3, 0, 0); x2.putImageData(d2, 0, 0);

    var gruppe = z.sonnenGruppe, deckkraft = +z.el("a3dSonneDeckkraft").value / 100;
    var tex = new THREE.CanvasTexture(c3);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    var bodenMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: deckkraft, depthWrite: false, side: THREE.DoubleSide });
    var boden = new THREE.Mesh(bodenGeometrie(R, 0.06), bodenMat);       // folgt dem Gelände, 6 cm darüber
    boden.renderOrder = 2;
    gruppe.add(boden);

    var dachMenge = 0;
    if (mitDach) {
      var zellen = 0;
      for (var q = 0; q < P.occM.length; q++) { if (P.occM[q]) { zellen++; } }
      if (zellen <= 700000) {
        var pos = new Float32Array(zellen * 18), farben = new Float32Array(zellen * 18), o = 0;
        // Eckhöhe = Mittel der angrenzenden Dachzellen (so bleiben geneigte Dächer geschlossen und glatt)
        var eckH = function (cx, cy, eigen) {
          var s = 0, m = 0;
          for (var dy = -1; dy <= 0; dy++) {
            for (var dx = -1; dx <= 0; dx++) {
              var ax = cx + dx, ay = cy + dy;
              if (ax < 0 || ay < 0 || ax >= NR || ay >= NR) { continue; }
              var hh = P.occ[ay * NR + ax];
              if (P.occM[ay * NR + ax] && Math.abs(hh - eigen) < 6) { s += hh; m++; }
            }
          }
          return m ? s / m + 0.05 : eigen + 0.05;
        };
        for (var jy = 0; jy < NR; jy++) {
          for (var jx = 0; jx < NR; jx++) {
            var h = P.occ[jy * NR + jx];
            if (!P.occM[jy * NR + jx]) { continue; }
            var c = sonneFarbeBytes(erg.boden[jy * NR + jx]), x0 = jx * zr - R, x1 = x0 + zr, n0 = jy * zr - R, n1 = n0 + zr;
            var h00 = eckH(jx, jy, h), h10 = eckH(jx + 1, jy, h), h11 = eckH(jx + 1, jy + 1, h), h01 = eckH(jx, jy + 1, h);
            var ecken = [x0, h00, -n0, x1, h10, -n0, x1, h11, -n1, x0, h00, -n0, x1, h11, -n1, x0, h01, -n1];
            for (var e = 0; e < 18; e += 3) { pos[o + e] = ecken[e]; pos[o + e + 1] = ecken[e + 1]; pos[o + e + 2] = ecken[e + 2]; farben[o + e] = c[0] / 255; farben[o + e + 1] = c[1] / 255; farben[o + e + 2] = c[2] / 255; }
            o += 18;
          }
        }
        var gd = new THREE.BufferGeometry();
        gd.setAttribute("position", new THREE.BufferAttribute(pos, 3)); gd.setAttribute("color", new THREE.BufferAttribute(farben, 3));
        var dach = new THREE.Mesh(gd, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: deckkraft, side: THREE.DoubleSide }));
        dach.renderOrder = 1; gruppe.add(dach); dachMenge = zellen;
      }
    }

    var fassadeMenge = 0;
    if (mitFassade) {
      var nf = fassadenTeile.length, pos2 = new Float32Array(nf * 18), farben2 = new Float32Array(nf * 18), o2 = 0;
      for (var f = 0; f < nf; f++) {
        var t = fassadenTeile[f], c2f = sonneFarbeBytes(erg.fassade[f]), vx = t.nx * 0.08, vn = t.nn * 0.08;
        var A = [t.ax + vx, t.y0, -(t.an + vn)], B = [t.bx + vx, t.y0, -(t.bn + vn)], C = [t.bx + vx, t.y1, -(t.bn + vn)], D = [t.ax + vx, t.y1, -(t.an + vn)];
        var tri = [A, B, C, A, C, D];
        for (var e2 = 0; e2 < 6; e2++) {
          pos2[o2] = tri[e2][0]; pos2[o2 + 1] = tri[e2][1]; pos2[o2 + 2] = tri[e2][2];
          farben2[o2] = c2f[0] / 255; farben2[o2 + 1] = c2f[1] / 255; farben2[o2 + 2] = c2f[2] / 255;
          o2 += 3;
        }
      }
      var gf = new THREE.BufferGeometry();
      gf.setAttribute("position", new THREE.BufferAttribute(pos2, 3)); gf.setAttribute("color", new THREE.BufferAttribute(farben2, 3));
      var fassade = new THREE.Mesh(gf, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: deckkraft, side: THREE.DoubleSide }));
      fassade.renderOrder = 1; gruppe.add(fassade); fassadeMenge = nf;
    }

    z.sonnenErgebnis = { P: P, erg: erg, fassaden: fassadenTeile || [], c2: c2, veraltet: false, mittel: anzahl ? summe / anzahl : 0, hoechst: hoechst, dach: dachMenge, fassade: fassadeMenge };
    gruppe.visible = z.el("a3dSonneZeigen").checked;
    // Ergebnis auch in der Karte (Ebene "Sonnenstunden" in 04 Analysedaten)
    var dla = R / z.mLat, dlo = R / z.mLng;
    sonnenKarteSetzen({ canvas: c2, s: z.mitte.lat - dla, n: z.mitte.lat + dla, w: z.mitte.lng - dlo, o: z.mitte.lng + dlo });
    sonneLegendeBauen();
    zeichne();
  }

  function sonneLeeren() {
    var z = zustand;
    if (!z || !z.sonnenGruppe) { return; }
    while (z.sonnenGruppe.children.length) {
      var k = z.sonnenGruppe.children.pop();
      if (k.geometry) { k.geometry.dispose(); }
      if (k.material) { if (k.material.map) { k.material.map.dispose(); } k.material.dispose(); }
    }
    z.sonnenErgebnis = null;       // das Farbbild in der Karte (2D) bleibt bis zur nächsten Berechnung stehen
    var l = z.el("a3dSonneLegende"); if (l) { l.hidden = true; }
  }

  function sonneLegendeBauen() {
    var z = zustand, l = z.el("a3dSonneLegende");
    var html = '<div class="a3d-leg-titel">Sonnenstunden pro Tag<br>(Jahresmittel)</div>';
    SONNE_STUFEN.slice().reverse().forEach(function (st) { html += '<div><i style="background:' + sonnenFarbeHex(st[1]) + '"></i>' + st[0] + '</div>'; });
    l.innerHTML = html;
    l.hidden = !(z.sonnenErgebnis && z.el("a3dSonneZeigen").checked);
  }

  function sonneWert(p, info) {
    var z = zustand, s = z.sonnenErgebnis;
    if (!s) { return null; }
    // Wand: nächster Fassadenpunkt (innerhalb von 3 m), sonst Zelle (Boden oder Dach)
    if (info && p.y - z.gh(p.x, -p.z) > 0.4 && s.fassaden.length) {
      var beste = -1, bd = 9;
      for (var i = 0; i < s.fassaden.length; i++) {
        var t = s.fassaden[i], mx = (t.ax + t.bx) / 2, mn = (t.an + t.bn) / 2, my = (t.y0 + t.y1) / 2;
        var d = Math.hypot(mx - p.x, mn + p.z, (my - p.y) * 1.0);
        if (d < bd) { bd = d; beste = i; }
      }
      if (beste >= 0 && bd < 3.5) { return { stunden: s.erg.fassade[beste], art: "Fassade" }; }
    }
    var P = s.P, ix = Math.floor((p.x + P.R) / P.zr), iy = Math.floor((-p.z + P.R) / P.zr);
    if (ix < 0 || iy < 0 || ix >= P.NR || iy >= P.NR) { return null; }
    return { stunden: s.erg.boden[iy * P.NR + ix], art: P.occM[iy * P.NR + ix] ? "Dach" : "Boden" };
  }

  function sonneAktualisierenAnzeige() {
    var z = zustand, an = z.el("a3dSonneZeigen").checked, deck = +z.el("a3dSonneDeckkraft").value / 100;
    z.sonnenGruppe.visible = an;
    z.sonnenGruppe.children.forEach(function (m) { if (m.material) { m.material.opacity = deck; } });
    var l = z.el("a3dSonneLegende"); l.hidden = !(z.sonnenErgebnis && an);
    zeichne();
  }

  function sonneInfoText() {
    var z = zustand, R = z.radius, zr = Math.max(2, Math.round(R / 200 * 2) / 2), n = Math.ceil(2 * R / zr);
    var t = "Ausschnitt " + (R >= 1000 ? (R / 1000).toString().replace(".", ",") + " km" : R + " m") + ": Raster " + zr.toString().replace(".", ",") + " m (" + n + " × " + n + " Zellen).";
    if (R > SONNE_MAX_RADIUS) { t += " Zu groß: Für Sonnenstunden bitte in „03 Modell“ höchstens 1,5 km wählen."; }
    else if (R > SONNE_FASSADEN_MAX_RADIUS && z.el("a3dSonneFassade").checked) { t += " Fassaden werden nur bis 800 m Ausschnitt gerechnet."; }
    return t;
  }

  function sonneStarten() {
    var z = zustand;
    var meld = z.el("a3dSonneMeldung"), knopf = z.el("a3dSonneRechnen"), stopp = z.el("a3dSonneStopp");
    function zeigen(t, art) { meld.textContent = t; meld.className = "meldung " + (art || ""); }
    if (z.radius > SONNE_MAX_RADIUS) { zeigen("Dieser Ausschnitt ist zu groß. Wähle in „03 Modell“ höchstens 1,5 km.", "fehler"); return; }
    if (z.sonneAbbruch === "laeuft") { return; }
    knopf.disabled = true; stopp.hidden = false;
    zeigen("Wird vorbereitet …");
    window.setTimeout(function () {
      var P, vorbereitet;
      try {
        // Das Höhenraster kommt aus den Hintergrundprozessen (meist schon fertig); die Fassadenpunkte werden ebenfalls dort vorbereitet
        vorbereitet = hoehenkarteAsync().then(function () {
          if (zustand !== z) { throw new Error("abgebrochen"); }
          P = sonneParameter();
          var mitF = z.el("a3dSonneFassade").checked && z.radius <= SONNE_FASSADEN_MAX_RADIUS;
          return mitF ? sonneFassadenAsync(P) : null;
        });
      } catch (e) {
        zeigen("Die Berechnung konnte nicht vorbereitet werden.", "fehler"); knopf.disabled = false; stopp.hidden = true; return;
      }
      var t0 = performance.now(), fassaden = null;
      vorbereitet.then(function (f) {
        fassaden = f && f.length ? f : (f ? [] : null);
        if (fassaden && !fassaden.length) { fassaden = null; }
        return sonneRechnen(P, !!fassaden, function (anteil) { zeigen("Wird berechnet … " + Math.round(anteil * 100) + " %"); });
      }).then(function (erg) {
        if (zustand !== z) { return; }
        sonneAnzeigen(P, erg, fassaden);
        var sek = Math.round((performance.now() - t0) / 100) / 10;
        zeigen("Fertig in " + sek.toString().replace(".", ",") + " Sekunden. Im Boden Ø " + z.sonnenErgebnis.mittel.toFixed(1).replace(".", ",") + " Sonnenstunden pro Tag, höchster Wert " + z.sonnenErgebnis.hoechst.toFixed(1).replace(".", ",") + ".", "ok");
        z.el("a3dSonneHinweis").textContent = "";
        knopf.disabled = false; stopp.hidden = true; z.sonneAbbruch = null;
      }).catch(function (fehler) {
        if (zustand !== z) { return; }
        zeigen(fehler && fehler.message === "abgebrochen" ? "Abgebrochen." : "Die Berechnung ist fehlgeschlagen. Versuche einen kleineren Ausschnitt.", fehler && fehler.message === "abgebrochen" ? "" : "fehler");
        knopf.disabled = false; stopp.hidden = true; z.sonneAbbruch = null;
      });
    }, 40);
  }

  // Wird aufgerufen, wenn sich das Modell ändert: das Ergebnis passt dann nicht mehr
  function sonneVeraltet() {
    var z = zustand;
    if (!z || !z.sonnenErgebnis) { return; }
    if (z.sonnenErgebnis.P.R !== z.radius) { sonneLeeren(); z.el("a3dSonneMeldung").textContent = "Der Ausschnitt hat sich geändert, die Sonnenstunden müssen neu berechnet werden."; return; }
    z.sonnenErgebnis.veraltet = true;
    z.el("a3dSonneHinweis").textContent = "Das Modell hat sich seit der Berechnung geändert (zum Beispiel Bäume oder Baukörper). Rechne neu, damit die Farben stimmen.";
  }

  // ---------- Speichern ----------
  var VEKTOR_MAX_RADIUS = 1500;        // größere Ausschnitte würden zu schwere Vektordateien ergeben
  var DXF_MAX_FLAECHEN = 600000;       // so viele 3D-Flächen höchstens in einer DXF-Datei

  function dateiName(endung) {
    var z = zustand, d = z.datum;
    var anzeige = (typeof aktuelleAnzeige !== "undefined" && marker) ? aktuelleAnzeige : "";
    return "3D_" + (anzeige ? anzeige.split(",")[0].replace(/[^\wäöüÄÖÜß-]+/g, "_") + "_" : "") + d.j + "-" + ("0" + d.m).slice(-2) + "-" + ("0" + d.t).slice(-2) + "_" + uhrzeit(z.zeit).replace(":", "") + "." + endung;
  }

  function herunterladen(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function groesseMB(bytes) { return (bytes / 1048576).toFixed(1).replace(".", ",") + " MB"; }

  // Papiergröße in Millimetern (Breite, Höhe) nach den Feldern
  function papierMm() {
    var z = zustand;
    var mm = PAPIER_MM[z.el("a3dPapier").value];                       // [lange Seite, kurze Seite]
    return z.el("a3dAusrichtung").value === "quer" ? [mm[0], mm[1]] : [mm[1], mm[0]];
  }

  // Titelkasten unten links und Nordpfeil oben rechts. "c" ist eine Leinwand oder der Aufzeichner für Vektordateien.
  function beschriftungZeichnen(c, B, H, u) {
    var z = zustand, d = z.datum, s = z.stand;
    var zeilen = [
      { t: "Standortanalyse Oldenburg · 3D-Schattenstudie", fett: true },
      { t: datumText(d.j, d.m, d.t) + ", " + uhrzeit(z.zeit) + " Uhr (" + (s.sommerzeit ? "Sommerzeit" : "Winterzeit") + ")" },
      { t: s.hoehe > 0 ? "Sonnenhöhe " + Math.round(s.hoehe * 180 / Math.PI) + "°, Richtung " + Math.round(((s.azimut * 180 / Math.PI) % 360 + 360) % 360) + "° (" + richtungsname(s.azimut) + ")" : "Sonne unter dem Horizont" }
    ];
    var anzeige = (typeof aktuelleAnzeige !== "undefined" && marker) ? aktuelleAnzeige : "";
    if (anzeige) { zeilen.push({ t: anzeige }); }
    if (c.vektor !== true) {       // Analysedaten stehen nur im Rasterbild (die Vektorzeichnung hat keinen Kartenboden)
      var aktiv = z.analyse.filter(function (a) { return a.haken.checked; }).map(function (a) { return a.text; });
      if (aktiv.length) {
        zeilen.push({ t: "Analysedaten: " + (aktiv.length > 5 ? aktiv.slice(0, 5).join(", ") + " und " + (aktiv.length - 5) + " weitere" : aktiv.join(", ")), klein: true });
      }
    }
    var stadtDaten = c.vektor !== true && typeof FLAECHEN !== "undefined" && FLAECHEN.some(function (g) { return g.stadt && karte.hasLayer(g.ebene); });
    zeilen.push({ t: QUELLE_HOEHEN + (z.gelaende ? "  ·  " + QUELLE_GELAENDE : "") + (c.vektor === true ? "  ·  Grundrisse: © OpenStreetMap-Mitwirkende" : "  ·  " + QUELLE_KARTE) +
      (stadtDaten && typeof STADT_QUELLE_TEXT !== "undefined" ? "  ·  Daten: " + STADT_QUELLE_TEXT : "") +
      (typeof FLAECHEN !== "undefined" && typeof FNP_QUELLE_TEXT !== "undefined" && c.vektor !== true && FLAECHEN.some(function (g) { return g.fnp && karte.hasLayer(g.ebene); }) ? "  ·  " + FNP_QUELLE_TEXT : "") +
      (c.vektor !== true && typeof dienstQuellenText === "function" ? dienstQuellenText() : ""), klein: true });
    var abstand = 6 * u, zeile = 17 * u, kleinZeile = 14 * u;
    var breite = 0;
    var schrift = "px Bahnschrift, 'Segoe UI', Arial, sans-serif";
    zeilen.forEach(function (l) {
      c.font = (l.fett ? "bold " : "") + (l.klein ? 11 * u : 13 * u) + schrift;
      breite = Math.max(breite, c.measureText(l.t).width);
    });
    var kastenB = breite + 2 * abstand, kastenH = 2 * abstand;
    zeilen.forEach(function (l) { kastenH += l.klein ? kleinZeile : zeile; });
    var kx = 10 * u, ky = H - kastenH - 10 * u;
    c.fillStyle = "rgba(245,243,238,0.93)"; c.fillRect(kx, ky, kastenB, kastenH);
    c.strokeStyle = "#1a1a1a"; c.lineWidth = Math.max(1, u); c.strokeRect(kx, ky, kastenB, kastenH);
    c.fillStyle = "#1a1a1a"; c.textBaseline = "top";
    var yy = ky + abstand;
    zeilen.forEach(function (l) {
      c.font = (l.fett ? "bold " : "") + (l.klein ? 11 * u : 13 * u) + schrift;
      c.fillStyle = l.klein ? "#555555" : "#1a1a1a";
      c.fillText(l.t, kx + abstand, yy + (l.klein ? 1 * u : 0));
      yy += l.klein ? kleinZeile : zeile;
    });
    // Nordpfeil
    var nx = B - 40 * u, ny = 40 * u, nr = 24 * u;
    c.fillStyle = "rgba(245,243,238,0.93)"; c.strokeStyle = "#1a1a1a"; c.lineWidth = Math.max(1, u);
    c.beginPath(); c.arc(nx, ny, nr, 0, 2 * Math.PI); c.fill(); c.stroke();
    c.save(); c.translate(nx, ny); c.rotate(z.theta);
    c.fillStyle = "#c0392b"; c.beginPath(); c.moveTo(0, -nr * 0.75); c.lineTo(nr * 0.28, nr * 0.35); c.lineTo(-nr * 0.28, nr * 0.35); c.closePath(); c.fill();
    c.restore();
    c.fillStyle = "#1a1a1a"; c.font = "bold " + 11 * u + schrift; c.textAlign = "center";
    c.fillText("N", nx, ny - nr - 14 * u); c.textAlign = "left";
  }

  // Legende der Sonnenstunden unten rechts
  function sonneLegendeZeichnen(c, B, H, u) {
    var z = zustand;
    if (!z.sonnenErgebnis || !z.el("a3dSonneZeigen").checked) { return; }
    var schrift = "px Bahnschrift, 'Segoe UI', Arial, sans-serif", zeile = 17 * u, pad = 8 * u;
    var eintraege = SONNE_STUFEN.slice().reverse();
    var bw = 168 * u, bh = pad * 2 + zeile * (eintraege.length + 1.4), x = B - bw - 10 * u, y = H - bh - 10 * u;
    c.fillStyle = "rgba(245,243,238,0.94)"; c.fillRect(x, y, bw, bh);
    c.strokeStyle = "#1a1a1a"; c.lineWidth = Math.max(1, u); c.strokeRect(x, y, bw, bh);
    c.fillStyle = "#1a1a1a"; c.textBaseline = "top"; c.textAlign = "left";
    c.font = "bold " + 12 * u + schrift;
    c.fillText("Sonnenstunden pro Tag", x + pad, y + pad);
    c.font = 11 * u + schrift; c.fillStyle = "#555555";
    c.fillText("Jahresmittel", x + pad, y + pad + 14 * u);
    c.fillStyle = "#1a1a1a";
    eintraege.forEach(function (st, i) {
      var yy = y + pad + zeile * (i + 1.4);
      c.fillStyle = sonnenFarbeHex(st[1]); c.fillRect(x + pad, yy, 22 * u, 12 * u);
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = Math.max(1, 0.8 * u); c.strokeRect(x + pad, yy, 22 * u, 12 * u);
      c.fillStyle = "#1a1a1a"; c.font = 12 * u + schrift; c.fillText(st[0], x + pad + 30 * u, yy - 1 * u);
    });
  }

  // Zeichnet das 3D-Bild in der Größe B × H neu und gibt es mit Messungen und Beschriftung als Leinwand zurück
  function rasterBild(B, H) {
    var z = zustand;
    var b0 = z.bild.clientWidth, h0 = z.bild.clientHeight;
    var kamera = z.kamera === "ortho" ? z.ortho : z.persp;
    var pr = z.renderer.getPixelRatio();
    try {
      z.renderer.setPixelRatio(1);
      z.renderer.setSize(B, H, false);
      kameraStellen(kamera, B, H);
      z.renderer.render(z.szene, kamera);
      var ziel = document.createElement("canvas");
      ziel.width = B; ziel.height = H;
      var c = ziel.getContext("2d");
      c.drawImage(z.bild, 0, 0, B, H);
      messZeichnen(c, kamera, B, H, B / b0);                 // Messungen
      beschriftungZeichnen(c, B, H, Math.max(1, H / 900));   // Titelkasten, Nordpfeil
      sonneLegendeZeichnen(c, B, H, Math.max(1, H / 900));   // Legende der Sonnenstunden (wenn sie gezeigt werden)
      return ziel;
    } finally {
      z.renderer.setPixelRatio(pr);
      z.renderer.setSize(b0, h0, false);
      zeichne();
    }
  }

  // ---------- Aufzeichner: tut so, als wäre er eine Leinwand, und merkt sich alles als Vektoren (für SVG und PDF) ----------
  function Aufzeichner(mass) {
    this.vektor = true;
    this.ops = [];
    this.pfad = [];                   // Teilpfade: { p: [[x, y], ...], zu: bool }
    this.fillStyle = "#000000"; this.strokeStyle = "#000000";
    this.lineWidth = 1; this.globalAlpha = 1; this.font = "12px Arial";
    this.textAlign = "left"; this.textBaseline = "alphabetic"; this.lineCap = "butt"; this.lineJoin = "miter";
    this.strich = [];
    this.m = [1, 0, 0, 1, 0, 0];      // Verschiebung und Drehung
    this.stapel = [];
    this.mess = mass.getContext("2d");
  }
  Aufzeichner.prototype.save = function () {
    this.stapel.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, globalAlpha: this.globalAlpha,
      font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, strich: this.strich });
  };
  Aufzeichner.prototype.restore = function () {
    var s = this.stapel.pop(); if (!s) { return; }
    this.m = s.m; this.fillStyle = s.fillStyle; this.strokeStyle = s.strokeStyle; this.lineWidth = s.lineWidth; this.globalAlpha = s.globalAlpha;
    this.font = s.font; this.textAlign = s.textAlign; this.textBaseline = s.textBaseline; this.strich = s.strich;
  };
  Aufzeichner.prototype.translate = function (x, y) {
    var m = this.m; this.m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  };
  Aufzeichner.prototype.rotate = function (w) {
    var m = this.m, c = Math.cos(w), s = Math.sin(w);
    this.m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[0] * -s + m[2] * c, m[1] * -s + m[3] * c, m[4], m[5]];
  };
  Aufzeichner.prototype.punkt = function (x, y) {
    var m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  };
  Aufzeichner.prototype.beginPath = function () { this.pfad = []; };
  Aufzeichner.prototype.moveTo = function (x, y) { this.pfad.push({ p: [this.punkt(x, y)], zu: false }); };
  Aufzeichner.prototype.lineTo = function (x, y) {
    if (!this.pfad.length) { this.moveTo(x, y); return; }
    this.pfad[this.pfad.length - 1].p.push(this.punkt(x, y));
  };
  Aufzeichner.prototype.closePath = function () { if (this.pfad.length) { this.pfad[this.pfad.length - 1].zu = true; } };
  Aufzeichner.prototype.arc = function (x, y, r, a0, a1) {
    var n = Math.max(16, Math.min(48, Math.round(r * 2))), voll = Math.abs(a1 - a0) >= 2 * Math.PI - 1e-6;
    for (var i = 0; i <= n; i++) {
      var w = a0 + (a1 - a0) * i / n;
      if (voll && i === n) { break; }
      if (i === 0) { this.moveTo(x + r * Math.cos(w), y + r * Math.sin(w)); } else { this.lineTo(x + r * Math.cos(w), y + r * Math.sin(w)); }
    }
    if (voll) { this.closePath(); }
  };
  Aufzeichner.prototype.farbe = function (stil, mitAlpha) {
    this.mess.fillStyle = "#000000"; this.mess.fillStyle = stil;      // der Browser bringt jede Schreibweise auf "#rrggbb" oder "rgba(...)"
    var s = String(this.mess.fillStyle), r, g, b, a = 1;
    if (s.charAt(0) === "#") { r = parseInt(s.substr(1, 2), 16); g = parseInt(s.substr(3, 2), 16); b = parseInt(s.substr(5, 2), 16); }
    else { var t = s.match(/[\d.]+/g) || [0, 0, 0]; r = +t[0]; g = +t[1]; b = +t[2]; if (t.length > 3) { a = +t[3]; } }
    return { r: r, g: g, b: b, a: a * (mitAlpha ? this.globalAlpha : 1) };
  };
  Aufzeichner.prototype.fill = function (regel) {
    if (!this.pfad.length) { return; }
    this.ops.push({ t: "f", d: this.pfad.slice(), f: this.farbe(this.fillStyle, true), gerade: regel === "evenodd" });
  };
  Aufzeichner.prototype.stroke = function () {
    if (!this.pfad.length) { return; }
    this.ops.push({ t: "s", d: this.pfad.slice(), f: this.farbe(this.strokeStyle, true), w: this.lineWidth, strich: this.strich.slice(), kappe: this.lineCap, ecke: this.lineJoin });
  };
  Aufzeichner.prototype.rechteck = function (x, y, b, h) {
    this.beginPath(); this.moveTo(x, y); this.lineTo(x + b, y); this.lineTo(x + b, y + h); this.lineTo(x, y + h); this.closePath();
  };
  Aufzeichner.prototype.fillRect = function (x, y, b, h) { this.rechteck(x, y, b, h); this.fill(); };
  Aufzeichner.prototype.strokeRect = function (x, y, b, h) { this.rechteck(x, y, b, h); this.stroke(); };
  Aufzeichner.prototype.setLineDash = function (a) { this.strich = (a || []).slice(); };
  Aufzeichner.prototype.schrift = function () {          // Vektordateien verwenden Arial/Helvetica (Standardschrift in PDF)
    var f = String(this.font), g = f.match(/([\d.]+)px/), fett = /bold/.test(f);
    return { groesse: g ? +g[1] : 12, fett: fett };
  };
  Aufzeichner.prototype.measureText = function (t) {
    var s = this.schrift();
    this.mess.font = (s.fett ? "bold " : "") + s.groesse + "px Arial, Helvetica, sans-serif";
    return this.mess.measureText(t);
  };
  Aufzeichner.prototype.fillText = function (t, x, y) {
    var s = this.schrift(), w = this.measureText(t).width, links = x;
    if (this.textAlign === "center") { links = x - w / 2; } else if (this.textAlign === "right") { links = x - w; }
    var basis = y;
    if (this.textBaseline === "top") { basis = y + s.groesse * 0.8; } else if (this.textBaseline === "middle") { basis = y + s.groesse * 0.35; }
    var p = this.punkt(links, basis);
    this.ops.push({ t: "t", x: p[0], y: p[1], s: String(t), groesse: s.groesse, fett: s.fett, f: this.farbe(this.fillStyle, true) });
  };

  function hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? "0" : "") + n.toString(16); }
  function farbeHex(f) { return "#" + hex2(f.r) + hex2(f.g) + hex2(f.b); }
  function runde(x) { return Math.round(x * 10) / 10; }
  function xmlText(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Vektorzeichnung der aktuellen Ansicht: Boden, Schatten, Gebäude (von hinten nach vorn), Messungen, Beschriftung
  function vektorZeichnen(c, B, H, u) {
    var z = zustand, THREE = window.THREE;
    var kamera = z.kamera === "ortho" ? z.ortho : z.persp;
    kameraStellen(kamera, B, H);
    kamera.updateMatrixWorld(true);
    var R = z.radius, v = new THREE.Vector3();
    var st = z.stand, oben = st.hoehe > 0.0087, schatten = z.el("a3dSchatten").checked && oben;
    var tanH = Math.tan(st.hoehe), hg = st.hoehe * 180 / Math.PI;
    var L = new THREE.Vector3(Math.sin(st.azimut) * Math.cos(st.hoehe), Math.sin(st.hoehe), -Math.cos(st.azimut) * Math.cos(st.hoehe));   // Richtung zur Sonne
    var hemi = oben ? 0.5 : 0.28, direkt = oben ? Math.min(1, 0.25 + hg / 18) * 0.95 : 0;
    var kampos = kamera.position, parallel = kamera === z.ortho;
    var blick = new THREE.Vector3().subVectors(kamera.position, z.ziel);
    var zaehler = 0, GRENZE = 250000;

    function pr(x, y, zz) { v.set(x, y, zz).project(kamera); return { x: (v.x * 0.5 + 0.5) * B, y: (-v.y * 0.5 + 0.5) * H, ok: v.z > -1 && v.z < 1 }; }
    function tiefe(x, y, zz) { return v.set(x, y, zz).applyMatrix4(kamera.matrixWorldInverse).z; }   // je kleiner, desto weiter weg
    function schattiert(basis, n) {
      var f = Math.min(1, hemi + direkt * Math.max(0, n.x * L.x + n.y * L.y + n.z * L.z));
      return "rgb(" + Math.round(basis.r * 255 * f) + "," + Math.round(basis.g * 255 * f) + "," + Math.round(basis.b * 255 * f) + ")";
    }
    function flaeche(punkte, fuell, kante, kw, regel) {            // Vieleck(e) in Bildpunkten zeichnen; ganz außerhalb des Bildes wird weggelassen
      var minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (var k = 0; k < punkte.length; k++) for (var i = 0; i < punkte[k].length; i++) {
        var p = punkte[k][i]; if (!p.ok) { return; }
        if (p.x < minx) { minx = p.x; } if (p.x > maxx) { maxx = p.x; } if (p.y < miny) { miny = p.y; } if (p.y > maxy) { maxy = p.y; }
      }
      if (maxx < 0 || minx > B || maxy < 0 || miny > H) { return; }
      if (++zaehler > GRENZE) { throw new Error("zu viele"); }
      c.beginPath();
      punkte.forEach(function (ring) {
        ring.forEach(function (p, i) { if (i === 0) { c.moveTo(p.x, p.y); } else { c.lineTo(p.x, p.y); } });
        c.closePath();
      });
      if (fuell) { c.fillStyle = fuell; c.fill(regel); }
      if (kante) { c.strokeStyle = kante; c.lineWidth = kw; c.lineJoin = "round"; c.stroke(); }
    }

    // Papier und Boden
    c.fillStyle = "#f5f3ee"; c.fillRect(0, 0, B, H);
    if (z.gelaende) {                    // Gelände: Gitter aus Vierecken, von hinten nach vorn, einfach schattiert
      var gn = Math.max(8, Math.min(60, Math.ceil(2 * R / 12))), gs = 2 * R / gn, gz = [], gi, gj;
      for (gj = 0; gj <= gn; gj++) { gz.push([]); for (gi = 0; gi <= gn; gi++) { gz[gj].push(z.gh(-R + gi * gs, -R + gj * gs)); } }
      var vierecke = [];
      for (gj = 0; gj < gn; gj++) {
        for (gi = 0; gi < gn; gi++) {
          var gx0 = -R + gi * gs, gn0 = -R + gj * gs, gx1 = gx0 + gs, gn1 = gn0 + gs;
          var ha = gz[gj][gi], hb = gz[gj][gi + 1], hc = gz[gj + 1][gi + 1], hd = gz[gj + 1][gi];
          var nx0 = (ha - hb + hd - hc) / (2 * gs), nn0 = (ha - hd + hb - hc) / (2 * gs), nl = Math.sqrt(nx0 * nx0 + nn0 * nn0 + 1);
          vierecke.push({ t: tiefe((gx0 + gx1) / 2, (ha + hb + hc + hd) / 4, -(gn0 + gn1) / 2), pts: [[gx0, ha, gn0], [gx1, hb, gn0], [gx1, hc, gn1], [gx0, hd, gn1]], n: new THREE.Vector3(nx0 / nl, 1 / nl, -nn0 / nl) });
        }
      }
      vierecke.sort(function (p, q) { return p.t - q.t; });
      vierecke.forEach(function (vq) { var fu = schattiert(new THREE.Color(0xe8e5de), vq.n); flaeche([vq.pts.map(function (q) { return pr(q[0], q[1], -q[2]); })], fu, fu, 0.4 * u); });
    } else {
      flaeche([[pr(-R, 0, -R), pr(R, 0, -R), pr(R, 0, R), pr(-R, 0, R)]], "#e8e5de", "#bdb9b0", 0.8 * u);
    }

    // Körper (Gebäude, eigene Baukörper, Wälder) rechnen die Hintergrundprozesse: Schatten und Flächen, schon in Bildpunkten und je Körper geordnet
    var waldListe = (z.el("a3dWald").checked && z.waelder) ? z.waelder.map(function (w) { return { ringe: w.ringe, h: w.h, y0: w.y0, yb: w.yb, farbe: "#6f9a5a", eigen: true, wald: true }; }) : [];
    var basisFarbe = new THREE.Color(0xf4f1ea);
    var liste = z.koerper.concat(waldListe).map(function (k) {
      var fc = k.eigen ? new THREE.Color(k.farbe) : basisFarbe;
      return { ringe: k.ringe, p: k.dach ? k.dach.p : null, h: k.h, y0: k.y0 || 0, yb: k.yb || 0, rgb: [fc.r * 255, fc.g * 255, fc.b * 255] };
    });
    var kam = {
      V: Array.prototype.slice.call(kamera.matrixWorldInverse.elements), P: Array.prototype.slice.call(kamera.projectionMatrix.elements), B: B, H: H, u: u,
      hemi: hemi, direkt: direkt, L: [L.x, L.y, L.z], kampos: [kampos.x, kampos.y, kampos.z], blick: [blick.x, blick.y, blick.z], parallel: parallel,
      schatten: !!(schatten && tanH > 0.035), sx: -Math.sin(st.azimut) / tanH, sn: -Math.cos(st.azimut) / tanH, weite: Math.min(3 * R, 1e9)
    };
    function rgbText(f) { return "rgb(" + Math.round(f[0]) + "," + Math.round(f[1]) + "," + Math.round(f[2]) + ")"; }
    function flaecheAus(f) {            // eine im Hintergrund berechnete Fläche (Ringe in Bildpunkten) zeichnen
      c.beginPath();
      f.r.forEach(function (ring) {
        ring.forEach(function (p, i) { if (i === 0) { c.moveTo(p[0], p[1]); } else { c.lineTo(p[0], p[1]); } });
        c.closePath();
      });
      if (f.f) { c.fillStyle = rgbText(f.f); c.fill(f.e ? "evenodd" : undefined); }
      if (f.s) { c.strokeStyle = rgbText(f.s); c.lineWidth = f.w; c.lineJoin = "round"; c.stroke(); }
    }
    var baeume = (z.el("a3dBaeume").checked && z.baeume) ? z.baeume : [], dichte = baumDichte();
    var schattenSchritt = z.el("a3dBaumSchatten").checked;

    return arbeiterListe("vektorStueck", liste, { cam: kam }).then(function (teile) {
      var gesamt = 0;
      teile.forEach(function (t) { gesamt += t.sch.length + t.fl.length; });
      zaehler += gesamt;
      if (zaehler > GRENZE) { throw new Error("zu viele"); }
      // Schatten auf dem Boden: je Wandkante ein Parallelogramm, alle in derselben Farbe
      var schAlle = []; teile.forEach(function (t) { t.sch.forEach(function (f) { schAlle.push(f); }); });
      return inScheiben(schAlle, flaecheAus).then(function () {

      // Bäume: Schatten auf dem Boden (drei Kreise je Krone), später die Kronen zusammen mit den Gebäuden von hinten nach vorn
      function kreis(b, hoehe, radius, ziel) {        // Kreis in der Höhe "hoehe" um den Baum, in Bildpunkten; mit ziel = "boden" entlang der Sonnenstrahlen auf den Boden geworfen
        var pk = [];
        for (var i = 0; i < 16; i++) {
          var w = i / 16 * 2 * Math.PI, x = b.x + radius * Math.cos(w), n = b.n + radius * Math.sin(w);
          if (ziel === "boden") { x += -Math.sin(st.azimut) / tanH * hoehe; n += -Math.cos(st.azimut) / tanH * hoehe; pk.push(pr(x, b.y0 || 0, -n)); }
          else { pk.push(pr(x, hoehe + (b.y0 || 0), -n)); }
        }
        return pk;
      }
      if (schatten && schattenSchritt && tanH > 0.035) {
        baeume.forEach(function (b) {
          var dens = b.ig ? 0.85 : dichte, hk = b.h - b.stamm, cyb = b.stamm + hk / 2, a = b.kr / 2;
          var mix = Math.min(1, dens * 0.95), f = "rgb(" + Math.round(232 - 36 * mix) + "," + Math.round(229 - 37 * mix) + "," + Math.round(222 - 40 * mix) + ")";
          [[cyb - hk * 0.35, a * 0.9], [cyb, a], [cyb + hk * 0.35, a * 0.9]].forEach(function (s) { flaeche([kreis(b, s[0], s[1], "boden")], f, null, 0); });
        });
      }

      // Gebäude und Baumkronen von hinten nach vorn
      var reihe = teile.map(function (t) { return { k: t, t: t.t }; })
        .concat(baeume.map(function (b) { return { baum: b, t: tiefe(b.x, (b.y0 || 0) + b.stamm + (b.h - b.stamm) / 2, -b.n) }; })).sort(function (a, b) { return a.t - b.t; });
      return inScheiben(reihe, function (eintrag) {
        if (eintrag.baum) {
          var bm = eintrag.baum, hkr = bm.h - bm.stamm, dns = bm.ig ? 0.85 : dichte, gc = new THREE.Color(bm.eigen ? bm.farbe : (bm.ig ? 0x2f5d3a : 0x6aa84f));
          var fu = "rgb(" + Math.round(gc.r * 255) + "," + Math.round(gc.g * 255) + "," + Math.round(gc.b * 255) + ")";
          var p0 = pr(bm.x, bm.y0 || 0, -bm.n), p1 = pr(bm.x, (bm.y0 || 0) + bm.stamm + hkr * 0.2, -bm.n);
          if (p0.ok && p1.ok) { c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.strokeStyle = "#6b4f3a"; c.lineWidth = 1.4 * u; c.stroke(); }
          c.globalAlpha = 0.35 + 0.6 * Math.min(1, dns);
          flaeche([kreis(bm, bm.stamm + hkr / 2, bm.kr / 2, "")], fu, "#3f6b34", 0.4 * u);
          c.globalAlpha = 1;
          return;
        }
        eintrag.k.fl.forEach(flaecheAus);
      }).then(function () {
      messZeichnen(c, kamera, B, H, u);
      beschriftungZeichnen(c, B, H, u);
      return zaehler;
      });
      });
    });
  }
  function vektorAufnehmen(B, H) {
    var mass = document.createElement("canvas");
    var c = new Aufzeichner(mass);
    c.u = Math.max(1, H / 900);
    return vektorZeichnen(c, B, H, c.u).then(function (anzahl) { return { ops: c.ops, B: B, H: H, flaechen: anzahl }; });
  }

  function svgBauen(auf, breiteMm, hoeheMm, titel) {
    var t = [];
    t.push('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="' + breiteMm + 'mm" height="' + hoeheMm + 'mm" viewBox="0 0 ' + auf.B + ' ' + auf.H +
      '" font-family="Arial, Helvetica, sans-serif">\n<title>' + xmlText(titel) + '</title>\n');
    function pfadD(d) {
      return d.map(function (sp) {
        return "M" + sp.p.map(function (q) { return runde(q[0]) + " " + runde(q[1]); }).join("L") + (sp.zu ? "Z" : "");
      }).join("");
    }
    auf.ops.forEach(function (o) {
      if (o.t === "f") {
        t.push('<path d="' + pfadD(o.d) + '" fill="' + farbeHex(o.f) + '"' + (o.f.a < 0.999 ? ' fill-opacity="' + o.f.a.toFixed(2) + '"' : "") + (o.gerade ? ' fill-rule="evenodd"' : "") + '/>\n');
      } else if (o.t === "s") {
        t.push('<path d="' + pfadD(o.d) + '" fill="none" stroke="' + farbeHex(o.f) + '"' + (o.f.a < 0.999 ? ' stroke-opacity="' + o.f.a.toFixed(2) + '"' : "") +
          ' stroke-width="' + runde(o.w * 10) / 10 + '"' + (o.strich.length ? ' stroke-dasharray="' + o.strich.map(runde).join(" ") + '"' : "") +
          ' stroke-linecap="' + (o.kappe === "butt" ? "butt" : o.kappe) + '" stroke-linejoin="' + o.ecke + '"/>\n');
      } else {
        t.push('<text x="' + runde(o.x) + '" y="' + runde(o.y) + '" font-size="' + runde(o.groesse) + '"' + (o.fett ? ' font-weight="bold"' : "") + ' fill="' + farbeHex(o.f) +
          '"' + (o.f.a < 0.999 ? ' fill-opacity="' + o.f.a.toFixed(2) + '"' : "") + '>' + xmlText(o.s) + '</text>\n');
      }
    });
    t.push("</svg>\n");
    return new Blob(t, { type: "image/svg+xml" });
  }

  // Zeichen für die Standardschrift des PDFs (WinAnsi): alles Unbekannte wird ersetzt
  var WINANSI = { "–": 0x96, "—": 0x97, "·": 0xB7, "°": 0xB0, "²": 0xB2, "³": 0xB3, "ä": 0xE4, "ö": 0xF6, "ü": 0xFC, "Ä": 0xC4, "Ö": 0xD6, "Ü": 0xDC, "ß": 0xDF, "©": 0xA9, "„": 0x84, "“": 0x93, "€": 0x80 };
  function pdfText(s) {
    s = s.replace(/Σ/g, "Summe").replace(/↔/g, "<->").replace(/↕/g, "");
    var aus = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), code = s.charCodeAt(i);
      if (code >= 32 && code < 127) { aus += (ch === "(" || ch === ")" || ch === "\\") ? "\\" + ch : ch; }
      else if (WINANSI[ch] !== undefined) { aus += "\\" + ("00" + WINANSI[ch].toString(8)).slice(-3); }
      else if (code > 127 && code < 256) { aus += "\\" + code.toString(8); }
      else { aus += "?"; }
    }
    return aus;
  }

  function pdfVektorBauen(auf, breiteMm, hoeheMm, titel) {
    var bPt = breiteMm * 72 / 25.4, hPt = hoeheMm * 72 / 25.4, f = bPt / auf.B;
    var gs = {}, teile = [];
    function z2(n) { return (Math.round(n * 100) / 100).toString(); }
    function rgb(c) { return z2(c.r / 255) + " " + z2(c.g / 255) + " " + z2(c.b / 255); }
    function alpha(a) {
      if (a >= 0.999) { return ""; }
      var k = Math.max(1, Math.round(a * 100)); gs["G" + k] = k / 100;
      return "/G" + k + " gs\n";
    }
    function pfad(d) {
      var s = "";
      d.forEach(function (sp) {
        sp.p.forEach(function (q, i) { s += z2(q[0] * f) + " " + z2(hPt - q[1] * f) + (i === 0 ? " m\n" : " l\n"); });
        if (sp.zu) { s += "h\n"; }
      });
      return s;
    }
    var inhalt = "";
    auf.ops.forEach(function (o) {
      if (o.t === "f") {
        inhalt += "q\n" + alpha(o.f.a) + rgb(o.f) + " rg\n" + pfad(o.d) + (o.gerade ? "f*\n" : "f\n") + "Q\n";
      } else if (o.t === "s") {
        var kappe = o.kappe === "round" ? 1 : (o.kappe === "square" ? 2 : 0), ecke = o.ecke === "round" ? 1 : (o.ecke === "bevel" ? 2 : 0);
        inhalt += "q\n" + alpha(o.f.a) + rgb(o.f) + " RG\n" + z2(o.w * f) + " w\n" + kappe + " J\n" + ecke + " j\n" +
          (o.strich.length ? "[" + o.strich.map(function (x) { return z2(x * f); }).join(" ") + "] 0 d\n" : "") + pfad(o.d) + "S\nQ\n";
      } else {
        inhalt += "q\n" + alpha(o.f.a) + rgb(o.f) + " rg\nBT\n/" + (o.fett ? "F2" : "F1") + " " + z2(o.groesse * f) + " Tf\n" +
          z2(o.x * f) + " " + z2(hPt - o.y * f) + " Td\n(" + pdfText(o.s) + ") Tj\nET\nQ\n";
      }
    });
    var kodierer = new TextEncoder(), laenge = 0, versatz = [];
    function schreibe(x) { var b = typeof x === "string" ? kodierer.encode(x) : x; teile.push(b); laenge += b.length; }
    function objekt(nr, fn) { versatz[nr] = laenge; schreibe(nr + " 0 obj\n"); fn(); schreibe("endobj\n"); }
    var gsNamen = Object.keys(gs);
    schreibe("%PDF-1.4\n");
    objekt(1, function () { schreibe("<< /Type /Catalog /Pages 2 0 R >>\n"); });
    objekt(2, function () { schreibe("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n"); });
    objekt(3, function () {
      var g = gsNamen.map(function (n) { return "/" + n + " << /Type /ExtGState /ca " + gs[n] + " /CA " + gs[n] + " >>"; }).join(" ");
      schreibe("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + z2(bPt) + " " + z2(hPt) + "] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << " + g + " >> >> /Contents 4 0 R >>\n");
    });
    var bytes = kodierer.encode(inhalt);
    objekt(4, function () { schreibe("<< /Length " + bytes.length + " >>\nstream\n"); schreibe(bytes); schreibe("\nendstream\n"); });
    objekt(5, function () { schreibe("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n"); });
    objekt(6, function () { schreibe("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\n"); });
    var asciiTitel = pdfText(titel);
    objekt(7, function () { schreibe("<< /Title (" + asciiTitel + ") /Producer (Standortanalyse Oldenburg) >>\n"); });
    var xrefStart = laenge, tabelle = "xref\n0 8\n0000000000 65535 f \n";
    for (var n = 1; n <= 7; n++) { tabelle += ("0000000000" + versatz[n]).slice(-10) + " 00000 n \n"; }
    schreibe(tabelle);
    schreibe("trailer\n<< /Size 8 /Root 1 0 R /Info 7 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n");
    return new Blob(teile, { type: "application/pdf" });
  }

  // ---------- DXF: 3D-Flächen (3DFACE) der Gebäude und eigenen Baukörper in Metern ----------
  var ACI = [[1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255], [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [94, 0, 128, 64], [150, 0, 76, 150], [14, 128, 0, 0], [40, 165, 123, 0]];
  function aciFarbe(hex) {
    var c = new window.THREE.Color(hex), r = c.r * 255, g = c.g * 255, b = c.b * 255, beste = 7, bd = 1e12;
    ACI.forEach(function (a) { var d = (a[1] - r) * (a[1] - r) + (a[2] - g) * (a[2] - g) + (a[3] - b) * (a[3] - b); if (d < bd) { bd = d; beste = a[0]; } });
    return beste;
  }
  function ascii(s) {
    return String(s).replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
      .replace(/Σ/g, "Summe").replace(/[°]/g, " Grad").replace(/²/g, "2").replace(/[^\x20-\x7E]/g, "?");
  }
  function ebenenName(s, vergeben) {
    var n = ascii(s).toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "KOERPER";
    var name = n, i = 2; while (vergeben[name]) { name = n + "_" + i++; } vergeben[name] = true; return name;
  }
  // UTM (Zone 32, ETRS89) aus Breite/Länge, nur für den Hinweis im Kopf der Datei
  function utm32(breite, laenge) {
    var A = 6378137.0, F = 1 / 298.257222101, n = F / (2 - F), K0 = 0.9996;
    var aq = A / (1 + n) * (1 + n * n / 4 + Math.pow(n, 4) / 64);
    var a1 = n / 2 - 2 * n * n / 3 + 5 * Math.pow(n, 3) / 16 + 41 * Math.pow(n, 4) / 180, a2 = 13 * n * n / 48 - 3 * Math.pow(n, 3) / 5 + 557 * Math.pow(n, 4) / 1440;
    var phi = breite * Math.PI / 180, dl = (laenge - 9) * Math.PI / 180, q = 2 * Math.sqrt(n) / (1 + n), sp = Math.sin(phi);
    function ath(x) { return 0.5 * Math.log((1 + x) / (1 - x)); }
    var t = Math.sinh(ath(sp) - q * ath(q * sp)), xi = Math.atan2(t, Math.cos(dl)), eta = ath(Math.sin(dl) / Math.sqrt(1 + t * t));
    return { e: 500000 + K0 * aq * (eta + a1 * Math.cos(2 * xi) * Math.sinh(2 * eta) + a2 * Math.cos(4 * xi) * Math.sinh(4 * eta)),
             n: K0 * aq * (xi + a1 * Math.sin(2 * xi) * Math.cosh(2 * eta) + a2 * Math.sin(4 * xi) * Math.cosh(4 * eta)) };
  }

  // Schätzt die Zahl der Flächen (für die Anzeige vor dem Speichern)
  function dxfFlaechenZahl() {
    var z = zustand, n = 0;
    z.koerper.forEach(function (k) { k.ringe.forEach(function (r, i) { var p = r.length / 2; n += (p + (i === 0 ? Math.max(0, p - 2) : 0)) * (k.dach ? (k.dach.art === 4 ? 2 : 4) : 1); }); });
    if (z.gelaende) { var gnz = Math.max(4, Math.min(150, Math.ceil(2 * z.radius / 10))); n += gnz * gnz; }
    if (z.baeume && z.el("a3dBaeume").checked) { n += z.baeume.length * 32; }
    if (z.waelder && z.el("a3dWald").checked) { z.waelder.forEach(function (k) { k.ringe.forEach(function (r, i) { var p = r.length / 2; n += p + (i === 0 ? Math.max(0, p - 2) : 0); }); }); }
    return n;
  }

  function dxfBauen() {
    var z = zustand, THREE = window.THREE;
    var teile = [], puffer = [];
    function s(code, wert) { puffer.push(code + "\n" + wert + "\n"); if (puffer.length > 20000) { teile.push(puffer.join("")); puffer = []; } }
    function f3(x) { return (Math.round(x * 1000) / 1000).toString(); }
    var vergeben = { BESTAND: true, MESSUNGEN: true };
    var ebenen = [{ name: "BESTAND", aci: 8 }];
    var eigeneEbene = z.koerper.filter(function (k) { return k.eigen; }).map(function (k) { var e = { name: ebenenName(k.name || "KOERPER", vergeben), aci: aciFarbe(k.farbe) }; ebenen.push(e); return e; });
    var baeume = (z.el("a3dBaeume").checked && z.baeume) ? z.baeume : [];
    var waldListe = (z.el("a3dWald").checked && z.waelder) ? z.waelder.map(function (w) { return { ringe: w.ringe, h: w.h, y0: w.y0, yb: w.yb, wald: true }; }) : [];
    if (waldListe.length) { ebenen.push({ name: "WALD", aci: 94 }); }
    if (z.gelaende) { ebenen.push({ name: "GELAENDE", aci: 8 }); }
    if (baeume.length) { ebenen.push({ name: "BAEUME", aci: 3 }); }
    ebenen.push({ name: "MESSUNGEN", aci: 1 });
    var u = utm32(z.mitte.lat, z.mitte.lng), d = z.datum;

    s(999, "Standortanalyse Oldenburg - 3D-Modell (Gebaeude und eigene Baukoerper)");
    s(999, "Einheit Meter. Nullpunkt = roter Punkt: Breite " + z.mitte.lat.toFixed(6) + ", Laenge " + z.mitte.lng.toFixed(6) + ". X = Ost, Y = Nord, " + (z.gelaende ? "Z = Hoehe ueber dem Gelaende am Nullpunkt (dort " + z.gelBasis.toFixed(1) + " m ueber NHN); Gebaeude stehen auf dem Gelaende." : "Z = Hoehe ueber Gelaende."));
    s(999, "Nullpunkt in UTM32 ETRS89 (EPSG:25832): Rechtswert " + u.e.toFixed(2) + ", Hochwert " + u.n.toFixed(2) + ". Zum Verorten alles um diesen Wert verschieben.");
    s(999, "Gebaeudehoehen: " + ascii(QUELLE_HOEHEN) + (z.gelaende ? ". " + ascii(QUELLE_GELAENDE) : "") + ". Grundrisse: OpenStreetMap-Mitwirkende (ODbL). Hoehe der Bloecke: " + ascii(z.el("a3dHoehenart").selectedOptions[0].textContent) + ".");
    s(0, "SECTION"); s(2, "TABLES");
    s(0, "TABLE"); s(2, "LTYPE"); s(70, 1);
    s(0, "LTYPE"); s(2, "CONTINUOUS"); s(70, 0); s(3, "Solid line"); s(72, 65); s(73, 0); s(40, "0.0");
    s(0, "ENDTAB");
    s(0, "TABLE"); s(2, "LAYER"); s(70, ebenen.length);
    ebenen.forEach(function (e) { s(0, "LAYER"); s(2, e.name); s(70, 0); s(62, e.aci); s(6, "CONTINUOUS"); });
    s(0, "ENDTAB"); s(0, "ENDSEC");
    s(0, "SECTION"); s(2, "ENTITIES");

    function flaeche(ebene, p1, p2, p3, p4) {
      s(0, "3DFACE"); s(8, ebene);
      s(10, f3(p1[0])); s(20, f3(p1[1])); s(30, f3(p1[2]));
      s(11, f3(p2[0])); s(21, f3(p2[1])); s(31, f3(p2[2]));
      s(12, f3(p3[0])); s(22, f3(p3[1])); s(32, f3(p3[2]));
      var q = p4 || p3;
      s(13, f3(q[0])); s(23, f3(q[1])); s(33, f3(q[2]));
    }
    var ei = 0;
    var dxfListe = z.koerper.concat(waldListe).map(function (k) {
      return { ringe: k.ringe, p: k.dach ? k.dach.p : null, h: k.h, y0: k.y0 || 0, yb: k.yb || 0, ebene: k.wald ? "WALD" : (k.eigen ? eigeneEbene[ei++].name : "BESTAND") };
    });
    teile.push(puffer.join("")); puffer = [];       // bisher Geschriebenes sichern, die Körper kommen aus den Hintergrundprozessen

    return arbeiterListe("dxfKoerperStueck", dxfListe, {}).then(function (stuecke) {
    stuecke.forEach(function (st) { teile.push(st.text); });
    // Gelände: Gitter aus 3D-Flächen (Zellen von mindestens 10 m, höchstens 150 x 150)
    if (z.gelaende) {
      var gR = z.radius, gnn = Math.max(4, Math.min(150, Math.ceil(2 * gR / 10))), gss = 2 * gR / gnn, gzz = [], ggi, ggj;
      for (ggj = 0; ggj <= gnn; ggj++) { gzz.push([]); for (ggi = 0; ggi <= gnn; ggi++) { gzz[ggj].push(z.gh(-gR + ggi * gss, -gR + ggj * gss)); } }
      for (ggj = 0; ggj < gnn; ggj++) {
        for (ggi = 0; ggi < gnn; ggi++) {
          var gx0 = -gR + ggi * gss, gy0 = -gR + ggj * gss;
          flaeche("GELAENDE", [gx0, gy0, gzz[ggj][ggi]], [gx0 + gss, gy0, gzz[ggj][ggi + 1]], [gx0 + gss, gy0 + gss, gzz[ggj + 1][ggi + 1]], [gx0, gy0 + gss, gzz[ggj + 1][ggi]]);
        }
      }
    }

    // Bäume: Krone als einfaches Ellipsoid (8 Segmente, 4 Bänder) und der Stamm als Linie
    baeume.forEach(function (b) {
      var hk = b.h - b.stamm, cy = (b.y0 || 0) + b.stamm + hk / 2, a = b.kr / 2, bz = hk / 2, ringe = [];
      for (var i = 0; i <= 4; i++) {
        var w = Math.PI * i / 4, rr = a * Math.sin(w), zz = cy - bz * Math.cos(w), ring = [];
        for (var j = 0; j < 8; j++) { var v = j / 8 * 2 * Math.PI; ring.push([b.x + rr * Math.cos(v), b.n + rr * Math.sin(v), zz]); }
        ringe.push(ring);
      }
      for (var band = 0; band < 4; band++) {
        for (var j2 = 0; j2 < 8; j2++) {
          var k2 = (j2 + 1) % 8;
          flaeche("BAEUME", ringe[band][j2], ringe[band][k2], ringe[band + 1][k2], ringe[band + 1][j2]);
        }
      }
      s(0, "LINE"); s(8, "BAEUME"); s(10, f3(b.x)); s(20, f3(b.n)); s(30, f3(b.y0 || 0)); s(11, f3(b.x)); s(21, f3(b.n)); s(31, f3((b.y0 || 0) + b.stamm + hk * 0.2));
    });

    // Messungen als Linien und Text
    var th = Math.max(1, z.radius / 150);
    z.messungen.forEach(function (m) {
      (m.linien || []).forEach(function (l) {
        s(0, "LINE"); s(8, "MESSUNGEN");
        s(10, f3(l.a.x)); s(20, f3(-l.a.z)); s(30, f3(l.a.y)); s(11, f3(l.b.x)); s(21, f3(-l.b.z)); s(31, f3(l.b.y));
      });
      if (m.anker && m.zeilen) {
        s(0, "TEXT"); s(8, "MESSUNGEN"); s(10, f3(m.anker.x)); s(20, f3(-m.anker.z)); s(30, f3(m.anker.y)); s(40, f3(th)); s(1, ascii(m.zeilen.join(" | ")));
      }
    });
    s(0, "ENDSEC"); s(0, "EOF");
    teile.push(puffer.join(""));
    return new Blob(teile, { type: "application/dxf" });
    });
  }

  // ---------- Felder je nach Dateiformat ----------
  var FORMAT_INFO = {
    png: "Das Bild enthält Datum, Uhrzeit, Sonnenstand, Nordpfeil, Quellen, Analysedaten und deine Messungen.",
    pdf: "Die aktuelle Ansicht (mit Boden, Analysedaten, Schatten und Messungen) als Bild in einer PDF-Seite im gewählten Papierformat. Der Bildausschnitt passt sich dem Seitenverhältnis an.",
    vpdf: "Linienzeichnung der aktuellen Ansicht als PDF mit echten Vektoren (Illustrator, Affinity, Inkscape): Gebäude, eigene Baukörper, Bäume, Schatten auf dem Boden, Messungen und Beschriftung. Ohne Kartenboden und Analysedaten; Schatten fallen nur auf den Boden.",
    svg: "Wie die Vektor-PDF, aber als SVG-Datei (für Webbrowser, Illustrator, Affinity, Inkscape). Ohne Kartenboden und Analysedaten; Schatten fallen nur auf den Boden.",
    dxf: "3D-Modell als 3D-Flächen in Metern für AutoCAD, Rhino, Vectorworks, ArchiCAD u. a. Nullpunkt = roter Punkt (X Ost, Y Nord, Z oben). Ebenen: BESTAND, je eigener Baukörper eine Ebene, BAEUME, MESSUNGEN. Im Kopf der Datei steht der Nullpunkt in UTM (EPSG:25832)."
  };
  var FORMAT_KNOPF = { png: "Als PNG speichern", pdf: "Als PDF speichern", vpdf: "Als Vektor-PDF speichern", svg: "Als SVG speichern", dxf: "Als DXF speichern" };

  function speicherFelder() {
    var z = zustand, f = z.el("a3dFormat").value;
    z.el("a3dFeldGroesse").hidden = f !== "png";
    z.el("a3dFeldPapier").hidden = !(f === "pdf" || f === "vpdf" || f === "svg");
    z.el("a3dFeldDpi").hidden = f !== "pdf";
    var info = FORMAT_INFO[f];
    if (f === "dxf") {
      var n = dxfFlaechenZahl();
      info += " Aktuell ca. " + n.toLocaleString("de-DE") + " Flächen (etwa " + groesseMB(n * 135) + ")." + (n > DXF_MAX_FLAECHEN ? " Das ist zu viel: bitte einen kleineren Ausschnitt wählen." : "");
    } else if ((f === "vpdf" || f === "svg") && z.radius > VEKTOR_MAX_RADIUS) {
      info += " Für Vektordateien bitte einen Ausschnitt bis 1,5 km wählen.";
    }
    z.el("a3dSpeichernInfo").textContent = info;
    z.el("a3dSpeichern").textContent = FORMAT_KNOPF[f];
  }

  function speichern() {
    var z = zustand, f = z.el("a3dFormat").value;
    var meld = z.el("a3dMeldung"), knopf = z.el("a3dSpeichern");
    function zeigen(text, art) { meld.textContent = text; meld.className = "meldung " + (art || ""); }
    var max = Math.min(z.renderer.capabilities.maxTextureSize || 4096, 8192);
    knopf.disabled = true;
    zeigen("Wird erstellt …");
    // dem Browser Zeit geben, die Meldung zu zeigen
    window.setTimeout(function () {
      try {
        if (f === "png") {
          var faktor = +z.el("a3dGroesse").value;
          var B = Math.round(z.bild.clientWidth * faktor), H = Math.round(z.bild.clientHeight * faktor);
          if (B > max || H > max) { var q = Math.min(max / B, max / H); B = Math.floor(B * q); H = Math.floor(H * q); }
          var ziel = rasterBild(B, H), name = dateiName("png");
          ziel.toBlob(function (blob) {
            herunterladen(blob, name);
            zeigen("Gespeichert: " + name + " (" + B + " × " + H + " Bildpunkte).", "ok");
            knopf.disabled = false;
          }, "image/png");
          return;
        }
        if (f === "pdf") {
          var mm = papierMm(), dpi = +z.el("a3dDpi").value, bb = Math.round(mm[0] * dpi / 25.4), hh = Math.round(mm[1] * dpi / 25.4), hinweis = "";
          var skal = Math.min(1, max / bb, max / hh, Math.sqrt(45e6 / (bb * hh)));
          if (skal < 1) { bb = Math.floor(bb * skal); hh = Math.floor(hh * skal); hinweis = " Die Auflösung wurde auf " + Math.round(dpi * skal) + " dpi verringert (sonst zu groß)."; }
          var bild = rasterBild(bb, hh), pname = dateiName("pdf");
          erzeugePdf(bild, { breiteMm: mm[0], hoeheMm: mm[1], titel: "3D-Ansicht Standortanalyse" }).then(function (blob) {
            herunterladen(blob, pname);
            zeigen("Gespeichert: " + pname + " (" + z.el("a3dPapier").value + ", " + groesseMB(blob.size) + ")." + hinweis, "ok");
          }).catch(function () { zeigen("Das PDF konnte nicht erstellt werden. Wähle ein kleineres Papierformat oder eine kleinere Auflösung.", "fehler"); })
            .then(function () { knopf.disabled = false; });
          return;
        }
        if (f === "vpdf" || f === "svg") {
          if (z.radius > VEKTOR_MAX_RADIUS) { zeigen("Für Vektordateien bitte in „03 Modell“ einen Ausschnitt bis 1,5 km wählen.", "fehler"); knopf.disabled = false; return; }
          var m2 = papierMm(), px = 96 / 25.4;
          vektorAufnehmen(Math.round(m2[0] * px), Math.round(m2[1] * px)).then(function (auf) {
            var blob2 = f === "svg" ? svgBauen(auf, m2[0], m2[1], "3D-Ansicht Standortanalyse") : pdfVektorBauen(auf, m2[0], m2[1], "3D-Ansicht Standortanalyse");
            var vname = dateiName(f === "svg" ? "svg" : "pdf").replace(/(\.[a-z]+)$/, "_vektor$1");
            herunterladen(blob2, vname);
            zeigen("Gespeichert: " + vname + " (" + auf.flaechen.toLocaleString("de-DE") + " Flächen, " + groesseMB(blob2.size) + ").", "ok");
          }).catch(function (e) {
            if (e && e.message === "zu viele") { zeigen("Das sind zu viele Flächen für eine Vektordatei. Wähle einen kleineren Ausschnitt oder zoome näher heran.", "fehler"); }
            else { zeigen("Das konnte nicht gespeichert werden. Versuche eine kleinere Bildgröße oder einen kleineren Ausschnitt.", "fehler"); }
          }).then(function () { knopf.disabled = false; });
          return;
        }
        if (f === "dxf") {
          var n = dxfFlaechenZahl();
          if (n > DXF_MAX_FLAECHEN) { zeigen("Das Modell ist zu groß für eine DXF-Datei (ca. " + n.toLocaleString("de-DE") + " Flächen). Wähle in „03 Modell“ einen kleineren Ausschnitt.", "fehler"); knopf.disabled = false; return; }
          dxfBauen().then(function (blob3) {
            var dname = dateiName("dxf");
            herunterladen(blob3, dname);
            zeigen("Gespeichert: " + dname + " (" + groesseMB(blob3.size) + ", Nullpunkt = roter Punkt, Einheit Meter).", "ok");
          }).catch(function () {
            zeigen("Das konnte nicht gespeichert werden. Versuche einen kleineren Ausschnitt.", "fehler");
          }).then(function () { knopf.disabled = false; });
        }
      } catch (fehler) {
        zeigen("Das konnte nicht gespeichert werden. Versuche eine kleinere Bildgröße oder einen kleineren Ausschnitt.", "fehler");
        knopf.disabled = false;
      }
    }, 40);
  }

  // daten: für entwurf.js (Entwurfsstrategie): Gebäude mit Höhen, Gelände und die Umrechnung nach UTM
  window.ansicht3d = { oeffnen: oeffnen, schliessen: schliessen, verbergen: verbergen, zeigen: zeigen, offen: offen, sonnenstand: sonnenstand, daten: { gebaeude: function () { return gelaendeLaden().then(function (G) { hoehenKorrigieren(G); return entpacke(); }); }, gelaende: gelaendeLaden, utm32: utm32 } };
})();
