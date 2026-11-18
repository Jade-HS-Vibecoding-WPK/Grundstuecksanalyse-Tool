# Gemeinsame Hilfe fuer alle Datenprogramme: liest die Einstellungen einer Stadt aus Standortanalyse\staedte\staedte.js.
# Benutzung in einem Programm:   . (Join-Path $PSScriptRoot 'stadt.ps1'); $S = Hole-Stadt $Stadt
# Danach gibt es: $S.Id, $S.Name, $S.Ascii, $S.Sued/$S.West/$S.Nord/$S.Ost (Datenrechteck), $S.Breite, $S.MitteBreite,
# $S.MitteLaenge, $S.Ags, $S.Kreis, $S.Gemeinde, $S.Ordner (Zielordner der fertigen Dateien)

function Hole-Stadt([string]$id) {
  $datei = Join-Path $PSScriptRoot '..\Standortanalyse\staedte\staedte.js'
  if (-not (Test-Path $datei)) { throw "Die Datei staedte.js fehlt: $datei" }
  $text = [IO.File]::ReadAllText($datei, [Text.Encoding]::UTF8)
  $m = [regex]::Match($text, '(?s)\n  ' + [regex]::Escape($id) + ': \{(.*?)\n  \}')
  if (-not $m.Success) { throw "Die Stadt '$id' steht nicht in staedte.js." }
  $b = $m.Groups[1].Value
  $zahl = { param($feld)
    $r = [regex]::Match($b, '\b' + $feld + ':\s*\[([^\]]*)\]')
    if (-not $r.Success) { throw "In staedte.js fehlt bei '$id' das Feld '$feld'." }
    @($r.Groups[1].Value.Split(',') | ForEach-Object { [double]::Parse($_.Trim(), [Globalization.CultureInfo]::InvariantCulture) })
  }
  $text1 = { param($feld, $pflicht)
    $r = [regex]::Match($b, '\b' + $feld + ':\s*"([^"]*)"')
    if (-not $r.Success) { if ($pflicht) { throw "In staedte.js fehlt bei '$id' das Feld '$feld'." } else { return '' } }
    $r.Groups[1].Value.Replace('\\', '\')
  }
  $rechteck = & $zahl 'datenrechteck'
  $mitte = & $zahl 'mitte'
  $br = [regex]::Match($b, '\bbreite:\s*([0-9.]+)')
  if (-not $br.Success) { throw "In staedte.js fehlt bei '$id' das Feld 'breite'." }
  $name = & $text1 'name' $true
  $ascii = $name.Replace([string][char]0xE4, 'ae').Replace([string][char]0xF6, 'oe').Replace([string][char]0xFC, 'ue').Replace([string][char]0xDF, 'ss')
  $ordner = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ('..\Standortanalyse\staedte\' + $id)))
  New-Item -ItemType Directory -Force $ordner | Out-Null
  [pscustomobject]@{
    Id = $id; Name = $name; Ascii = $ascii
    Sued = $rechteck[0]; West = $rechteck[1]; Nord = $rechteck[2]; Ost = $rechteck[3]
    Breite = [double]::Parse($br.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
    MitteBreite = $mitte[0]; MitteLaenge = $mitte[1]
    Ags = (& $text1 'ags' $false)
    Kreis = (& $text1 'ladekreis' $false)      # Muster fuer die Spalte "Kreis" im Ladesaeulenregister (leer = nur Rechteck)
    Gemeinde = (& $text1 'borisgemeinde' $false) # Muster fuer den Gemeindenamen in BORIS (leer = nur Rechteck)
    Ordner = $ordner
  }
}
