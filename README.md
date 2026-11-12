# STAHLFRONT

Rundenbasiertes Panzer-Artillerie-Spiel für 2–6 Spieler – komplett im Browser, ohne Installation.

**Spielen:** https://nightcloud5353.github.io/stahlfront/

## So spielt ihr zusammen

1. **iPhone-Hotspot einschalten** (Einstellungen → Persönlicher Hotspot → „Zugriff für andere erlauben“, am besten „Kompatibilität maximieren“ an). Mobile Daten müssen an sein.
2. Alle Geräte mit dem Hotspot verbinden.
3. **Gastgeber** (am besten der Laptop): Seite öffnen → Passwort → Name → **SPIEL ERSTELLEN**. Es erscheint ein 4-stelliger **Raumcode**.
4. **Alle anderen:** Seite öffnen → Passwort → Name → Raumcode eingeben → **BEITRETEN**. (Oder der Gastgeber tippt auf **EINLADEN** und schickt den Link.)
5. Gastgeber wählt Panzer pro Spieler, Zugzeit und Karte → **GEFECHT STARTEN**.
6. Handys quer halten. Der Gastgeber lässt die Seite offen und den Bildschirm an.

Das Spiel läuft im Browser des Gastgebers; die Geräte sind direkt miteinander verbunden (WebRTC). Das Internet wird nur zum Laden der Seite und zum Verbinden über den Raumcode gebraucht.

## Probleme?

| Problem | Lösung |
|---|---|
| „Kein Spiel mit diesem Code gefunden“ | Code prüfen; ist die Seite beim Gastgeber noch offen? |
| Verbindung bricht ab | Seite neu laden → Beitreten – man landet wieder im selben Spiel |
| Gastgeber-Handy geht in Standby | Spiel bricht ab → Laptop als Gastgeber nehmen |
| Kein Vollbild auf dem iPhone | Safari → Teilen → „Zum Home-Bildschirm“, dann von dort starten |

## Steuerung

- **◀ ▶** fahren (kostet Treibstoff) · **WINKEL ▲▼** · **KRAFT + −** (tippen = 1 Schritt, halten = schnell) · **FEUER**
- Munitions-Knopf öffnet die Auswahl · Artillerie: Ziel antippen · Doppeltipp/Tab: Panzer wechseln (vor dem ersten Zug)
- Tastatur: ←→/AD fahren, ↑↓/WS Winkel, Q/E Kraft, Leertaste Feuer, 1–0 Munition, Tab Menü, O Übersicht

## Technik

Reines HTML/CSS/JavaScript, keine Abhängigkeiten außer [PeerJS](https://peerjs.com) (MIT, liegt unter `js/`).
`js/sim.js` = Spiellogik (läuft beim Gastgeber), `js/game.js` = Darstellung & Steuerung, `js/net.js` = Verbindung.
