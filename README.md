# STAHLFRONT

Rundenbasiertes Panzer-Artillerie-Spiel für 2–6 Spieler – komplett im Browser, ohne Installation.

**Spielen:** https://nightcloud5353.github.io/stahlfront/

## So spielt ihr zusammen (jeder am eigenen Laptop)

1. **iPhone-Hotspot einschalten** (Einstellungen → Persönlicher Hotspot → „Zugriff für andere erlauben“, „Kompatibilität maximieren“ an). Mobile Daten müssen an sein.
2. Alle Laptops mit dem Hotspot verbinden.
3. **Gastgeber:** Seite öffnen → Passwort → Name → **SPIEL ERSTELLEN**. Es erscheint ein 4-stelliger **Raumcode**.
4. **Alle anderen:** Seite öffnen → Passwort → Name → Raumcode → **BEITRETEN** (oder die kopierte Einladung öffnen).
5. In der Lobby: Panzer gestalten (Tarnung, Kommandant), Gastgeber wählt Gelände, Zugzeit und ggf. **KI-Gegner** → **GEFECHT STARTEN**.

**Üben:** Zugzeit **Ohne** wählen (kein Zeitlimit) und einen KI-Gegner hinzufügen.

Bricht beim Gastgeber etwas ab (Tab zu, Absturz), auf der Seite im Hauptmenü **FORTSETZEN** klicken: Das Gefecht geht mit demselben Raumcode weiter, die Mitspieler verbinden sich automatisch neu.

## Probleme?

| Problem | Lösung |
|---|---|
| „Kein Spiel mit diesem Code gefunden“ | Code prüfen; ist die Seite beim Gastgeber noch offen? |
| Verbindung bricht ab | Das Spiel verbindet sich alle 3 s selbst neu; notfalls Seite neu laden → Beitreten |
| Gastgeber-Tab geschlossen / abgestürzt | Gastgeber: Seite öffnen → **FORTSETZEN** |
| Laptop geht in den Ruhemodus | Netzteil anschließen, Energiesparen aus |
| Niemand kann beitreten | Sind alle im iPhone-Hotspot und hat das iPhone mobile Daten? |

## Steuerung

- **Maus:** am eigenen Panzer ziehen = zielen (Richtung = Winkel, Länge = Kraft) · Klick = Ziel (Artillerie) · Ziehen auf der Karte = verschieben · Mausrad = Zoom
- **Tastatur:** A/D fahren · W/S Winkel · E/Q Kraft · Leertaste Feuer · Tab Munition · 1–0 Munition direkt · P Panzer wechseln · O Übersicht · M Ton · Esc Menü

## Technik

Reines HTML/CSS/JavaScript, keine Abhängigkeiten außer [PeerJS](https://peerjs.com) (MIT, liegt unter `js/`).
`js/sim.js` = Spiellogik inkl. KI (läuft beim Gastgeber), `js/game.js` = Darstellung & Steuerung, `js/net.js` = Verbindung, `js/sound.js` = Geräusche.
