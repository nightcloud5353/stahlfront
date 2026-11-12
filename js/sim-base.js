// STAHLFRONT – Simulation: Konstanten, Balancing-Werte und Hilfsfunktionen (gemeinsam für alle sim-*.js)
(function (root) {
  'use strict';
  const S = root.SHARED;
  const { W, H, WEAPONS, PHYS } = S;
  const R = S.TANK_R;
  const G = PHYS.G;

  // ---------- Balancing ----------
  const DRIVE_MAX = 0.9;       // px/Tick Höchstgeschwindigkeit
  const DRIVE_ACC = 0.08;      // Anfahren
  const CLIMB = 4;             // max. Stufe, die ein Panzer hochfahren kann
  const FUEL_COST = 0.55;      // Treibstoff pro Tick bei voller Fahrt (100 = ca. 3 s Fahrt)
  const FALL_SAFE = 7;         // ab dieser Aufprallgeschwindigkeit gibt es Schaden
  const FALL_DMG = 3;          // Schaden pro px/Tick darüber
  const WIND_ACC = 0.03;       // Windbeschleunigung bei Wind 1.0
  const RETREAT = 2.5;         // Sekunden Rückzug nach dem Schuss
  const MAX_HP = 100;
  const SUDDEN_DEATH_ROUNDS = 7;
  const SUDDEN_DEATH_CAVES = 5; // Höhlen: viel Deckung, Gefechte dauern sonst doppelt so lange
  const WATER_RISE = 24;      // px pro Runde (verteilt auf die Züge der noch lebenden Teams)
  const WATER_RISE_CAVES = 40; // Höhlen: steigt schneller (getestet: 40 kürzt am meisten, ohne dass nur noch das Wasser entscheidet)
  const BARREL_R = 7;
  const CRATE_R = 8;
  const CRATE_EVERY = 3;
  const CRATE_CHANCE = 0.65;
  const CRATE_HEAL = 25;
  const RESUME_WAIT = 25;      // Sekunden Wartezeit auf Mitspieler nach "Gefecht fortsetzen"
  const FIRE_REACH = R + 9;    // Abstand Flamme -> Panzermitte, ab dem es brennt
  const FIRE_LAND = 8;         // Schaden, wenn Napalm auf einem Panzer landet (einmal pro Zug)
  const FIRE_DMG = 6;          // Schaden pro Zug im Feuer (+1 je weitere Flamme, max. FIRE_MAX)
  const FIRE_MAX = 12;
  const FIRE_ROUNDS = 2;       // so viele Runden brennt Napalm
  const FLAMES = 9;            // Brandtropfen pro Napalm
  const C4_FUSE = 50;          // Ticks Piepen, bevor die Sprengladung hochgeht
  const SLIDE_THIN = 12;       // Überhänge bis zu dieser Dicke brechen nach einer Explosion ab
  const SLIDE_SPAN_TH = 32;    // dickere Decken tragen sich immer selbst
  const SLIDE_CHUNK = 700;    // lose Erdbrocken bis zu dieser Größe (Pixel) fallen herunter
  const SLIDE_MAX = 9000;      // Obergrenze rutschender Pixel pro Explosion
  const GRAIN = 3;             // Erde zerfällt in Brocken von 3×3 Pixeln
  const SAVE_KEY = 'sf_save';
  const BOARD_KEY = 'sf_board';

  // [Radius, Maximalschaden, Rückstoß]
  const BOOM = {
    shell:   [40, 48, 6.2],
    bouncer: [40, 42, 6.2],   // unter der HE-Granate: dafür kaum Wind
    cluster: [28, 38, 5.0],
    bomblet: [21, 20, 4.4],   // Splitter streuen weit – sonst schwächer als die HE-Granate
    drill:   [40, 52, 6.6],
    mine:    [34, 45, 7.0],
    strike:  [28, 20, 5.0],   // trifft fast immer (Ziel anklicken) – daher pro Granate schwächer
    mg:      [6,  6,  1.4],   // 5 Kugeln = max. 30 (kein Wind, kein Zielen der Kraft)
    death:   [26, 12, 4.5],
    barrel:  [40, 30, 6.5],
    crate:   [30, 20, 5.0],
    napalm:  [22, 14, 3.5],   // kleiner Knall – der Schaden kommt vom Feuer
    c4:      [62, 62, 8.5],   // stark, aber eine ganze Runde Vorwarnung
    nuke:    [120, 80, 11.5],
  };
  const PT = {
    shell:   { wind: 1.0, impact: true },
    cluster: { wind: 0.8, impact: true },
    bomblet: { wind: 0.3, impact: true },
    strike:  { wind: 0.4, impact: true },
    drill:   { wind: 0.3, drill: true },
    bouncer: { wind: 0.3, bounce: 0.55 },
    mine:    { wind: 0.0, bounce: 0.1 },
    napalm:  { wind: 0.8, impact: true },
    nuke:    { wind: 0.6, impact: true },
    flame:   { wind: 0.15, bounce: 0.12 },
    c4:      { wind: 0.0, bounce: 0.1 },
  };
  const BOT_SKILL = {
    1: { a: 6, p: 8, wind: 0.0, think: 2.2, smart: 0.2 },
    2: { a: 2.6, p: 4, wind: 0.7, think: 1.8, smart: 0.6 },
    3: { a: 1.0, p: 1.6, wind: 1.0, think: 1.4, smart: 1.0 },
  };

  const WMAP = {};
  WEAPONS.forEach((w) => { WMAP[w.id] = w; });

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const store = {
    get(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* voll/gesperrt */ } },
    del(k) { try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) { /* egal */ } },
  };
  const CIRC = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; CIRC.push([Math.cos(a), Math.sin(a)]); }
  const noInput = () => ({ l: false, r: false, u: false, d: false, pu: false, pd: false });
  const validLook = (l) => ({
    camo: S.CAMOS.some((c) => c.id === (l && l.camo)) ? l.camo : 'oliv',
    hat: S.HATS.some((h) => h.id === (l && l.hat)) ? l.hat : 'none',
  });

  // Methoden einer Hilfsklasse in die Sim-Klasse übernehmen (so lässt sich die Simulation auf mehrere Dateien verteilen)
  function mixin(Target, Source) {
    for (const k of Object.getOwnPropertyNames(Source.prototype)) {
      if (k === 'constructor') continue;
      if (Object.prototype.hasOwnProperty.call(Target.prototype, k)) throw new Error('Sim-Methode doppelt: ' + k);
      Object.defineProperty(Target.prototype, k, Object.getOwnPropertyDescriptor(Source.prototype, k));
    }
  }

  root.SimBase = {
    S, W, H, WEAPONS, PHYS, R, G, DRIVE_MAX,
    DRIVE_ACC, CLIMB, FUEL_COST, FALL_SAFE, FALL_DMG, WIND_ACC, RETREAT, MAX_HP,
    SUDDEN_DEATH_ROUNDS, SUDDEN_DEATH_CAVES, WATER_RISE, WATER_RISE_CAVES, BARREL_R, CRATE_R, CRATE_EVERY, CRATE_CHANCE, CRATE_HEAL,
    RESUME_WAIT, FIRE_REACH, FIRE_LAND, FIRE_DMG, FIRE_MAX, FIRE_ROUNDS, FLAMES, C4_FUSE,
    SLIDE_THIN, SLIDE_SPAN_TH, SLIDE_CHUNK, SLIDE_MAX, GRAIN, SAVE_KEY, BOARD_KEY, BOOM,
    PT, BOT_SKILL, WMAP, rand, clamp, r1, gauss, shuffle,
    pick, store, CIRC, noInput, validLook,
    mixin,
  };
})(typeof self !== 'undefined' ? self : globalThis);
