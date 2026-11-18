// Luftmessstationen in Hannover mit Jahresmittelwerten. Quelle: Umweltbundesamt mit Daten der Messnetze der Laender und des Bundes. Erzeugt mit Datenpflege\20_Luft_aktualisieren.ps1
// Jede Station = [Breite, Laenge (Millionstel Grad), Name, Code, Art, Strasse, in Betrieb seit, [[Jahr, NO2, PM10, PM2,5 (Jahresmittel in ug/m3), Tage ueber 50 ug/m3 (PM10)], ...]]
var LUFT_DATEN = {"stand":"2026-11-18","einheit":1e-6,"stationen":[
[52359500,9715500,"Hannover Verkehr","DENI048","Verkehr","Göttinger Straße","1989-07-01",[[2019,39,18,9.7,4],[2020,32,16,8.3,1],[2021,34,18,9.6,3],[2022,32,18,10,1],[2023,28,16,7.8,1],[2024,26,16,8.8,1],[2025,28,17,9.5,6]]],
[52362900,9706100,"Hannover","DENI054","Hintergrund","Am Lindener Berge","1978-01-01",[[2019,16,14,9.3,1],[2020,13,12,7.7,1],[2021,14,13,8.4,1],[2022,13,14,8.4,0],[2023,11,13,7.3,0],[2024,11,12,7.9,0],[2025,13,14,8.9,4]]]
]};
