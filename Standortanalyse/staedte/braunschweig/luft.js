// Luftmessstationen in Braunschweig mit Jahresmittelwerten. Quelle: Umweltbundesamt mit Daten der Messnetze der Laender und des Bundes. Erzeugt mit Datenpflege\20_Luft_aktualisieren.ps1
// Jede Station = [Breite, Laenge (Millionstel Grad), Name, Code, Art, Strasse, in Betrieb seit, [[Jahr, NO2, PM10, PM2,5 (Jahresmittel in ug/m3), Tage ueber 50 ug/m3 (PM10)], ...]]
var LUFT_DATEN = {"stand":"2026-11-18","einheit":1e-6,"stationen":[
[52226900,10473600,"Braunschweig","DENI011","Hintergrund","Broitzem (Fernmeldeturm)","1978-01-01",[[2019,12,13,null,3],[2020,11,11,null,0],[2021,10,13,null,1],[2022,10,13,null,0],[2023,8.3,11,null,0],[2024,9,13,8.2,1],[2025,9.9,14,9,5]]],
[52266700,10540600,"Braunschweig-Verkehr","DENI075","Verkehr","Altewiekring","2019-02-05",[[2019,29,17,9.7,4],[2020,25,16,7.9,1],[2021,26,17,8.8,3],[2022,25,17,9.5,0],[2023,22,13,7.3,0],[2024,19,15,8.3,2],[2025,21,16,9.3,5]]]
]};
