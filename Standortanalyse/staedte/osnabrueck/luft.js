// Luftmessstationen in Osnabrueck mit Jahresmittelwerten. Quelle: Umweltbundesamt mit Daten der Messnetze der Laender und des Bundes. Erzeugt mit Datenpflege\20_Luft_aktualisieren.ps1
// Jede Station = [Breite, Laenge (Millionstel Grad), Name, Code, Art, Strasse, in Betrieb seit, [[Jahr, NO2, PM10, PM2,5 (Jahresmittel in ug/m3), Tage ueber 50 ug/m3 (PM10)], ...]]
var LUFT_DATEN = {"stand":"2026-11-18","einheit":1e-6,"stationen":[
[52255300,8052900,"Osnabrück","DENI038","Hintergrund","Bomblatstraße","1988-10-01",[[2019,16,15,9.3,2],[2020,14,13,7.8,0],[2021,15,14,9.5,0],[2022,13,14,8.6,0],[2023,11,13,7.3,0],[2024,12,12,7.7,0],[2025,13,15,9.2,3]]],
[52270300,8041500,"Osnabrück-Verkehr","DENI067","Verkehr","Schloßwall","2005-07-01",[[2019,38,20,11,4],[2020,31,17,9,0],[2021,32,19,10,6],[2022,30,20,11,1],[2023,27,17,9.5,0],[2024,27,17,8.9,0],[2025,28,20,10,6]]]
]};
