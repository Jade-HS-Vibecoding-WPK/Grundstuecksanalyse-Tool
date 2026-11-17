# Umsetzungsplan: Web-App für Standortanalyse Oldenburg

Stand: 16.11.2026

## 1. Ziel

Eine kleine Web-App, mit der man für ein Grundstück in **Oldenburg** eine Standortanalyse erstellt und grafisch aufbereitet.

- Man gibt eine **Adresse** ein. Die App zeigt das Umfeld und holt automatisch Umgebungsdaten.
- Man lädt **einen Plan** (JPG, PNG oder PDF) hoch, legt ihn auf die Karte und zeichnet selbst darauf.
- Man **exportiert** das Ergebnis als PNG oder PDF, mit Legende, Nordpfeil und Maßstab.

## 2. Entscheidungen (mit dir abgestimmt)

| Thema | Entscheidung |
|---|---|
| Stadt | Zunächst nur Oldenburg |
| Material | Pro Bearbeitung ein hochgeladener Plan als JPG, PNG oder PDF (mehrere Pläne später) |
| Arbeitsweise | Hochladen und selbst einzeichnen, keine automatische Bilderkennung |
| Ergebnis | Export als PNG und PDF |
| Ort der App | Neuer Ordner `Standortanalyse` im Ordner `ClaudeSeinOrdner` |
| Bedienung | Per Doppelklick im Browser öffnen, nichts installieren |

## 3. Die Themen als Ebenen

Jedes Thema ist eine eigene Ebene mit eigener Farbe. Man kann sie ein- und ausblenden.

| Ebene | Inhalt |
|---|---|
| ÖPNV | Bushaltestellen, Bahnhöfe |
| Läden & Schulen | Supermärkte, Schulen, Kitas, Ärzte, weitere Einrichtungen |
| Grün | Parks, Wiesen, Wald, Wasser |
| Entfernungskreise | 5 und 10 Minuten zu Fuß |
| Sonnenstand | Sonnenbahn am 21. Juni und 21. Dezember |
| Städtebaulicher Kontext | Straßennetz, Nutzungsarten (Wohnen, Gewerbe usw.) |
| Nachbarbebauung | Gebäudeumrisse als Schwarzplan, wenn vorhanden mit Geschosszahlen |
| Freiräume | Plätze, Höfe, Grünflächen und Wege |
| Eigene Zeichnung | Alles, was man selbst einzeichnet |

## 4. Datenquellen und Technik (einfach erklärt)

Alles läuft im Browser. Es gibt keinen eigenen Server.

| Aufgabe | Werkzeug | Was das heißt |
|---|---|---|
| Karte anzeigen | Leaflet | Kostenlose Karten-Bibliothek, wie eine Zeichenfläche mit Zoom |
| Karten-Hintergrund | OpenStreetMap | Freie Weltkarte |
| Adresse finden | Nominatim | Übersetzt eine Adresse in einen Punkt auf der Karte |
| Umgebungsdaten | Overpass API | Fragt bei OpenStreetMap ab, zum Beispiel „alle Haltestellen im Umkreis von 800 m“ |
| Sonnenstand | SunCalc | Rechnet die Sonnenbahn für Ort und Datum aus |
| PDF lesen | pdf.js | Wandelt eine PDF-Seite in ein Bild um |
| Zeichnen | Leaflet-Geoman (oder gleichwertig) | Punkte, Linien, Flächen, Pfeile, Texte |
| Export | Bild- und PDF-Bibliothek | Speichert die Ansicht als PNG oder PDF |

Die App braucht eine **Internetverbindung** für Karte und Umgebungsdaten.

## 5. Schritte

Nach jedem Schritt zeige ich dir das Ergebnis. Der nächste Schritt beginnt erst, wenn du zustimmst.

### Schritt 1: Grundgerüst
- Ordner `Standortanalyse` mit der App-Datei anlegen
- Karte von Oldenburg anzeigen
- Adresssuche mit Punkt auf der Karte
- **Ergebnis:** Du tippst eine Adresse ein und siehst die Stelle auf der Karte.

### Schritt 2: Umgebungsdaten als Ebenen
- Umkreis wählbar, Standard 800 m
- Ebenen aus Abschnitt 3 laden und anzeigen
- Ebenen-Liste zum Ein- und Ausblenden, mit Farben
- Entfernungskreise und Sonnenbahn
- **Ergebnis:** Eine Adresse eingeben und sofort eine erste Analyse sehen.

### Schritt 3: Eigenen Plan hochladen und zeichnen
- Upload von JPG, PNG und PDF
- Plan verschieben, drehen, skalieren und transparent schalten
- Hilfe zum Einpassen: Du markierst zwei bekannte Punkte, die App passt den Plan an
- Zeichenwerkzeuge für Punkte, Linien, Flächen, Pfeile und Texte
- **Ergebnis:** Dein Plan liegt passend auf der Karte, und du kannst darauf zeichnen.

### Schritt 4: Legende und Export
- Automatische Legende aus den eingeschalteten Ebenen
- Nordpfeil und Maßstabsbalken
- Export als PNG und als PDF, Format wählbar (zum Beispiel A4 und A3)
- **Ergebnis:** Eine fertige Grafik, die du in dein Portfolio einsetzen kannst.

### Schritt 5: Feinschliff
- Gestaltung im Stil einer Architekturgrafik (klare Linien, ruhige Farben)
- Schwarzplan-Darstellung, wenn gewünscht
- Fehlermeldungen in einfacher Sprache
- Kurze Anleitung für dich
- **Ergebnis:** Eine App, die du ohne meine Hilfe benutzen kannst.

## 6. Was ich prüfen muss (Risiken)

| Punkt | Was passieren kann | Plan |
|---|---|---|
| Entfernungskreise | Kreise zeigen Luftlinie (5 Min. etwa 400 m, 10 Min. etwa 800 m), nicht den echten Fußweg | Klar beschriften. Echte Wege später als Zusatz möglich |
| Datenqualität | OpenStreetMap ist nicht überall vollständig, Geschosszahlen fehlen oft | Hinweis in der App, Ergebnisse von dir prüfen lassen |
| Export | Karten-Kacheln lassen sich manchmal nicht direkt in ein Bild übernehmen | Frühzeitig in Schritt 1 testen und bei Bedarf Alternative wählen |
| Nutzungsregeln | Die kostenlosen Dienste erlauben nur begrenzt viele Abfragen | Abfragen sparsam stellen, Ergebnisse zwischenspeichern |
| Maßstab | Der Maßstab im Export stimmt nur, wenn der Plan korrekt eingepasst wurde | Einpass-Hilfe in Schritt 3, Hinweis im Export |
| Große PDFs | Sehr große Pläne laden langsam | Seite wählbar, Bild wird verkleinert |

## 7. Später (nicht Teil der ersten Version)

### Vom Nutzer ausgewählt (Stand 16.11.2026, nach Schritt 2 und den Etappen A und B von Schritt 3)

Diese fünf Ideen möchte der Nutzer nach den geplanten Schritten umsetzen:

1. **Echte Fußwege statt Kreise (umgesetzt, 17.11.2026, die Kreise bleiben zum Vergleichen):** Die 5- und 10-Minuten-Zonen nach dem tatsächlichen Wegenetz statt als Kreis (braucht einen Dienst im Internet oder das lokal gespeicherte Wegenetz aus `karte_oldenburg.js`).
2. **Offene Daten der Stadt Oldenburg (umgesetzt, 16.11.2026; ohne Starkregen, siehe CLAUDE.md):** zum Beispiel Lärmkarten, Hochwassergebiete, Bebauungspläne. Zuerst prüfen, was als Daten verfügbar ist.
3. **Projekt speichern und wieder öffnen (umgesetzt, 16.11.2026):** Adresse, Plan, eingeschaltete Ebenen, Einstellungen und Zeichnungen in einer Datei sichern und laden (bisher ist nach dem Neuladen alles weg).
4. **Schwarzplan-Modus (umgesetzt, 16.11.2026):** Per Knopfdruck nur Gebäude in Schwarz auf weißem Grund. Die Gebäude liegen schon lokal vor.
5. **Messen (umgesetzt, 16.11.2026):** Strecken und Flächen auf der Karte messen (zum Beispiel Straßenbreite, Grundstücksgröße in m²).

### Weitere Ideen (noch nicht ausgewählt)

- Mehrere Pläne pro Projekt (Lageplan, Erdgeschoss, Dach als einzeln schaltbare Ebenen), Plan zuschneiden
- Export als Vektorgrafik (SVG oder DXF) für Rhino, Illustrator, AutoCAD
- ~~Schattenwurf der Gebäude zu gewählter Uhrzeit und Jahreszeit~~ – umgesetzt als "10 3D-Ansicht" (Klotzmodell mit Sonne, Datum und Uhrzeit, eigene Baukörper aus Zeichnung plus Höhe, Bild speichern; Höhen vom LGLN). Noch offen daraus: Auswertung "Schattenstunden auf dem Boden", Bäume, Dachformen, Geländehöhen
- Fotos mit Standort und Blickrichtung auf der Karte
- Höhenlinien und Gelände, Varianten vergleichen (Schieber), Windrose, eigene Legendeneinträge und Logo, Blattvorlagen
- Weitere Städte

## 8. Fertig ist die erste Version, wenn

- [ ] eine Oldenburger Adresse gefunden und auf der Karte angezeigt wird
- [ ] alle Ebenen aus Abschnitt 3 sichtbar sind und sich ein- und ausblenden lassen
- [ ] ein hochgeladener Plan (JPG, PNG oder PDF) auf der Karte liegt und sich einpassen lässt
- [ ] man darauf zeichnen kann
- [ ] der Export als PNG und PDF mit Legende, Nordpfeil und Maßstab funktioniert
- [ ] du die App ohne Hilfe starten und bedienen kannst
