# Balancing (Version 1.19)

Gemessen mit der KI aus 1.18 als „Testspieler“: viele tausend simulierte Gefechte ohne Browser
(`tools/balance.js`). Elite-KI rechnet Wind und Flugbahnen exakt; ihr Zielfehler ist klein, aber vorhanden
(1° Winkel, 1,6 Kraft). Die Werte unten sind daher eher Obergrenzen – Menschen treffen seltener.

## Vorgehen

1. **Ausgangslage:** normale Gefechte (3 × Elite, 1–3 Panzer; Rekrut/Veteran/Elite gemischt; Zweikämpfe), alle 4 Karten.
2. **Zwangs-Experimente pro Waffe:** Die KI nimmt eine Waffe *immer*, wenn sie dort sinnvoll ist (unbegrenzte Munition).
   So sieht man, wie viel Schaden sie unter gleichen Bedingungen pro Einsatz wirklich macht.
3. **Nahkampf-Lage** (Panzer starten 70 px auseinander) für Mine, Sprengladung, Rammen.
4. **Varianten** für Treibstoff, Seilwinde, Hochwasser, Startvorteil – gleiche Zufallsstarts, nur ein Wert geändert.
5. **Kontrolle der Messung:** Die Flugbahn-Vorhersage der KI weicht von der echten Simulation im Mittel < 1 px ab
   (Abpraller: in 3 von 40 Würfen chaotisch). Gefundene KI-Fehler wurden vorher behoben (MG-Bewertung,
   Schüsse ohne Trefferchance, Kisten am Fallschirm).

## Waffen – Schaden pro Einsatz (Elite, offenes Gelände)

| Waffe | vorher | nachher | Munition | Änderung |
|---|---|---|---|---|
| HE-Granate | 23 | 21 | ∞ | – (Bezugswert) |
| Abprallgranate | **15** | 22 | ∞ | Radius 40 → 44, Schaden 42 → 48, Sprungkraft 0,55 → 0,40 (bleibt näher am Aufschlag liegen) |
| MG-Salve | 23 | 22 | ∞ | – (nur auf Sicht) |
| Bunkerbrecher | 26 | 21 | 2 | Schaden 52 → 46. War im offenen Gelände besser als HE (in 65–80 % der Fälle „beste Waffe“). Jetzt gleichauf im Freien, **in den Höhlen 24,5 statt 13 (HE)** |
| Streumunition | 34 | 32 | 2 | – |
| Artillerieschlag | 31 | 30 | 1 | – |
| Napalm | **18** | 26 | 1 | Knall 22/14 → 26/22, Brandschaden beim Aufschlag 8 → 12 |
| Atomgranate | 51 | 52 | Kiste | – |

Nahkampf-Lage:

| Waffe | vorher | nachher | Änderung |
|---|---|---|---|
| Sprengladung | **≈ 0** (bei 5–9 Eigenschaden) | 52 (kein Eigenschaden) | zündet jetzt **am Ende des eigenen Zuges** statt zu Beginn des nächsten. Vorher war jeder Gegner bis dahin weggefahren – auch mit fast doppeltem Radius nur 4 Schaden |
| Mine | 28 | 28 | – |
| Rammstoß | 20 + Sturz/Wasser | – | – (gut, um Gegner von Kanten zu stoßen) |
| Streumunition (Vergleich) | 51 | – | – |

## Treibstoff (100 = ca. 160 px)

| Treibstoff | Kisten eingesammelt | Züge mit Fahrt | Spieldauer (Züge) |
|---|---|---|---|
| 60 % | 21 / 95 | 4 % | 20,6 |
| **100 % (bleibt)** | 29 / 107 | 7 % | 22,1 |
| 150 % | 31 / 106 | 8 % | 20,6 |
| 200 % | 30 / 102 | 9 % | 20,1 |

Weniger Treibstoff kostet spürbar Nachschub; mehr bringt nichts Messbares. Der Abstand zwischen Panzern beim Start ist
280–570 px – mit 160 px kommt man zu Deckung und Kisten in der Nähe, aber nicht zum Gegner. **Unverändert.**

## Seilwinde (Reichweite 260 px, 3 Stück)

200 / 260 / 330 px ändern Spieldauer, Ertrinken und Ergebnis praktisch nicht (Unterschiede im Rauschen). Genutzt wird
sie vor allem, um aus Gruben und vor steigendem Wasser zu fliehen: im Mittel 110–130 px Seil, 85–110 px Höhengewinn.
Die Reichweite wird oft ausgeschöpft (90 %-Wert 170–265 px) – kürzer würde Fluchtwege abschneiden. **Unverändert.**

## Sonstige Mechaniken

- **Stufen:** Zweikampf Veteran–Rekrut 20 : 4, Elite–Veteran 24 : 0; zu dritt Elite 27, Veteran 12, Rekrut 9 von 48
  (vor dem Feinschliff gewann der Rekrut öfter als der Veteran).
- **Startvorteil:** mit 2 Panzern pro Team keiner (50 %). Nur im Duell mit je 1 Panzer gewinnt der Erste ~60–65 %;
  eine Extra-Reparatur fürs zweite Team senkte das auf 58 % (nicht eindeutig) – daher keine Sonderregel.
- **Höhlen:** dauern 2–3 × länger, weil in 47 % der Züge kein Schuss mit Trefferchance existiert (Hügelland 2 %).
  Hochwasser eine Runde früher verkürzt das kaum (21,4 statt 22,5 Züge) – die Deckung ist der Charakter der Karte. Unverändert.
- **Fallschaden, Fässer, Wrack-Explosion, Kisten-Heilung (25), Reparatur (+30):** unauffällig, unverändert.
- **Ertrinken:** 20–30 % aller Abschüsse, davon gut ein Drittel durch Hochwasser – Wasser bleibt eine echte Gefahr.

## Selbst nachmessen

```bash
node tools/balance.js '{"levels":[3,3,3],"n":12}'                                  # Ausgangslage
node tools/balance.js '{"levels":[3,3,3],"n":5,"force":"napalm","ammo":{"napalm":-1},"nobonus":true}'
node tools/balance.js '{"levels":[3,3,3],"tanks":2,"n":6,"patch":{"sim-base.js":[["FUEL_COST = 0.55","FUEL_COST = 0.37"]]}}'
```
