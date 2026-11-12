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

Die Verbindung läuft über einen öffentlichen Internet-Server (MQTT) – das klappt in jedem Netz, auch wenn jeder zu Hause sitzt. Ist der Server nicht erreichbar, wird automatisch eine Direktverbindung (WebRTC) versucht. Alle Nachrichten sind mit dem Spiel-Passwort verschlüsselt (AES-256-GCM, Schlüssel per PBKDF2 aus dem Passwort) – auf dem Server ist nur Zeichensalat zu sehen.

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
- **Tastatur:** A/D fahren · W/S Winkel · E/Q Kraft · Leertaste Feuer · Tab Munition · 1–0 Munition direkt · Umschalt+1–3 Napalm/Sprengladung/Atomgranate · P Panzer wechseln · O Übersicht · M Ton · N Musik · Esc Menü

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt, keine Abhängigkeiten außer [PeerJS](https://peerjs.com) (MIT, liegt unter `js/`).

| Datei | Inhalt |
|---|---|
| `js/shared.js` | Waffen, Karten, Tarnmuster, Physik-Konstanten (Gastgeber + Darstellung) |
| `js/sim-base.js` | Balancing-Werte und Hilfsfunktionen der Simulation |
| `js/sim.js` | Simulation beim Gastgeber: Lobby, Züge, Spielende, Spielstand |
| `js/sim-terrain.js` | Gelände erzeugen, Krater, Erdrutsche |
| `js/sim-world.js` | Panzer, Fässer, Kisten: Platzierung, Fahren, Physik |
| `js/sim-weapons.js` | Waffen, Geschosse, Explosionen, Napalm |
| `js/sim-bot.js` | KI-Gegner |
| `js/game.js` | Darstellung, HUD und Steuerung |
| `js/tank-art.js` | Panzer zeichnen |
| `js/net.js`, `js/relay.js` | Verbindung (Internet-Server bzw. WebRTC) |
| `js/sound.js` | Geräusche und Musik |

Die `sim-*.js`-Dateien erweitern alle dieselbe Klasse `StahlSim`; die Reihenfolge der `<script>`-Tags in `index.html` ist daher wichtig (`sim-base.js` → `sim.js` → übrige `sim-*.js`).

### Tests und Prüfung

Zum Spielen ist nichts davon nötig – nur für die Entwicklung (Node.js 20 oder neuer):

```bash
npm install
npm test        # Simulation in Node: Lobby, Gelände, Schaden, Spielstand, komplette KI-Gefechte auf allen Karten
npm run lint    # ESLint: Tippfehler bei Namen, doppelte Methoden usw.
```

Bei jedem Push laufen beide automatisch auf GitHub (Actions → „Prüfen“).
