# STAHLFRONT – Regeln für die Arbeit am Projekt

## Automatische Tests sind Pflicht

Jede Änderung bekommt automatische Tests, damit spätere Updates nichts unbemerkt kaputt machen:

- **Neue Funktion → neue Tests**, die genau diese Funktion prüfen.
- **Fehler behoben → Test, der den Fehler nachstellt.** Er muss mit dem alten Code fehlschlagen und mit der Korrektur durchlaufen (vorher prüfen, z. B. mit `git stash push js/`).
- **Optik/Oberfläche geändert → Browser-Test** in `test/ui/` (Sichtbarkeit, Bedienung, keine Fehler in der Konsole, Darstellung auf PC, Handy und Tablet).
- **Bestehende Tests nie abschwächen oder löschen**, um eine Änderung „grün“ zu bekommen. Ändert sich ein Verhalten bewusst, den Test anpassen und das im Commit begründen.
- Vor jedem Commit und Push: `npm run check` muss fehlerfrei durchlaufen (Lint + Simulationstests + Browser-Tests).

## Tests

| Befehl | Was |
|---|---|
| `npm test` | Simulation, Gelände, Waffen, Lobby-Logik, Daten (Node, `test/*.test.js`) |
| `npm run test:ui` | Browser-Tests mit Playwright/Chromium (`test/ui/*.ui.test.js`) |
| `npm run check` | alles zusammen inkl. ESLint |

- `test/helpers.js`: Simulation ohne Browser (`makeSim`, `joinPlayer`, `withSeed` für reproduzierbaren Zufall).
- `test/ui/browser.js`: Webserver + Chromium, Geräte (`pc`, `pcKlein`, `iphone`, `iphoneHoch`, `ipad`, `android`), `toLobby`, `toGame`, `visible`.
- Die Seite hat mit `?test` in der Adresse einen Test-Zugang (`window.__sfTest`, siehe Ende von `js/game.js`): lokales Spiel ohne Netzwerk und Passwort.
- Zufall in Tests immer mit `withSeed` festlegen, damit Ergebnisse reproduzierbar sind.

## Versionen

Bei jeder neuen Version `package.json` **und** alle `?v=` in `index.html` sowie die Versionsanzeige im Hauptmenü anpassen (`test/version.test.js` prüft das).

## PC bleibt, wie er ist

Anpassungen für Handy/Tablet gelten nur, wenn ein Touch-Gerät erkannt wird (`body.touch`). Die Darstellung und Bedienung am PC (Maus + Tastatur) darf sich dadurch nicht ändern – das sichern die PC-Tests in `test/ui/` ab.
