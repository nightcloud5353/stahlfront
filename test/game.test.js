'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { S, makeSim, joinPlayer, withSeed, catchSimErrors } = require('./helpers');

function startGame(opts) {
  const o = Object.assign({ bots: 1, map: 'huegel', tanks: 1, spectatorHost: false }, opts);
  const sim = makeSim();
  sim.code = 'TEST';
  const host = joinPlayer(sim, 'Host');
  sim.onMessage(host.conn, { t: 'settings', tanks: o.tanks, map: o.map, theme: 0, turnTime: 30 });
  for (let i = 0; i < o.bots; i++) sim.onMessage(host.conn, { t: 'addbot', level: 1 + (i % 3) });
  if (o.spectatorHost) host.p.spec = true; // nur KI gegen KI
  sim.onMessage(host.conn, { t: 'start' });
  return { sim, host };
}

function runUntil(sim, cond, maxTicks) {
  for (let i = 0; i < maxTicks; i++) { if (cond()) return i; sim.step(); }
  return -1;
}

for (const map of S.MAPS) {
  test(`KI gegen KI auf "${map.name}": Gefecht endet ohne Fehler`, { timeout: 120000 }, () => {
    withSeed(100 + map.id.length, () => {
      let sim, ticks;
      const errors = catchSimErrors(() => {
        ({ sim } = startGame({ bots: 3, map: map.id, tanks: 1, spectatorHost: true }));
        ticks = runUntil(sim, () => sim.phase === 'over', 60 * 60 * 40);
      });
      assert.deepEqual(errors, [], 'keine Fehler in der Simulation');
      assert.ok(ticks > 0, 'Gefecht ist zu Ende gegangen');
      if (process.env.SF_DEBUG) console.log(map.id, ticks, sim.g.turnCount);
      const over = sim.lastOver;
      assert.equal(over.rank.length, 3);
      assert.equal(new Set(over.rank).size, 3);
      for (const t of sim.g.tanks) {
        assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y), 'Position gültig');
        assert.ok(t.hp >= 0 && t.hp <= 100);
      }
      // Bestenliste wurde geschrieben
      const board = JSON.parse(globalThis.localStorage.getItem('sf_board'));
      assert.ok(Object.keys(board).some((k) => k.endsWith('(KI)')));
    });
  });
}

test('Explosion: Schaden nimmt mit dem Abstand ab, Eigenschaden wird gezählt', () => {
  withSeed(9, () => {
    const { sim } = startGame();
    const g = sim.g;
    const [a, b] = g.tanks;
    const src = { team: a.team, ox: a.x, oy: a.y };
    const hp0 = b.hp;
    sim.explode(b.x, b.y, 40, 48, 6, 'shell', src);
    const direct = hp0 - b.hp;
    assert.ok(direct >= 40 && direct <= 48, `Volltreffer ${direct}`);
    assert.equal(g.teams[a.team].st.dmg, direct);

    const hp1 = a.hp;
    sim.explode(a.x + 30, a.y, 40, 48, 6, 'shell', src);
    const self = hp1 - a.hp;
    assert.ok(self > 0 && self < direct, `Streifschuss ${self}`);
    assert.equal(g.teams[a.team].st.self, self);
  });
});

test('Schaden: hp fällt nie unter 0', () => {
  withSeed(2, () => {
    const { sim } = startGame();
    const t = sim.g.tanks[1];
    sim.damage(t, 250, null);
    assert.equal(t.hp, 0);
    sim.damage(t, 10, null);
    assert.equal(t.hp, 0);
  });
});

test('Eingaben: nur der Spieler am Zug, Werte werden begrenzt', () => {
  withSeed(4, () => {
    const { sim, host } = startGame();
    const g = sim.g;
    // so lange weiterschalten, bis der Gastgeber dran ist
    while (g.teams[g.turnTeam].bot) sim.nextTurn();
    const t = g.active;
    sim.onMessage(host.conn, { t: 'set', aim: 999, power: -5, face: 1 });
    assert.equal(t.aim, S.PHYS.AIM_MAX);
    assert.equal(t.power, 0);
    sim.onMessage(host.conn, { t: 'set', aim: NaN, power: Infinity });
    assert.equal(t.aim, S.PHYS.AIM_MAX);
    sim.onMessage(host.conn, { t: 'weapon', w: 'nuke' }); // Atomgranate gibt es nur aus Kisten
    assert.equal(g.weapon, 'shell');

    // ein Zuschauer darf nichts steuern
    const zu = joinPlayer(sim, 'Zuschauer');
    sim.onMessage(zu.conn, { t: 'set', aim: 10 });
    assert.equal(t.aim, S.PHYS.AIM_MAX);
  });
});

test('Feuern: Munition wird verbraucht, Schuss fliegt und der Zug endet', () => {
  withSeed(6, () => {
    const { sim, host } = startGame();
    const g = sim.g;
    while (g.teams[g.turnTeam].bot) sim.nextTurn();
    const team = g.teams[g.turnTeam];
    team.turns = 5; // alle Waffen freigeschaltet
    const before = team.ammo.cluster;
    sim.onMessage(host.conn, { t: 'weapon', w: 'cluster' });
    sim.onMessage(host.conn, { t: 'set', aim: 45, power: 60 });
    sim.onMessage(host.conn, { t: 'fire' });
    assert.equal(team.ammo.cluster, before - 1);
    assert.ok(g.proj.some((p) => p.type === 'cluster'));
    const turn0 = g.turnCount;
    const ticks = runUntil(sim, () => g.turnCount > turn0 || sim.phase === 'over', 60 * 60);
    assert.ok(ticks > 0, 'nächster Zug hat begonnen');
  });
});

test('Spielstand: speichern und fortsetzen ergibt dasselbe Gefecht', () => {
  withSeed(8, () => {
    const { sim } = startGame({ bots: 2, tanks: 2 });
    sim.nextTurn();
    const saved = globalThis.StahlSim.loadSave();
    assert.ok(saved, 'Spielstand liegt im Speicher');
    const sim2 = makeSim();
    sim2.restore(saved);
    assert.equal(sim2.g.phase, 'pause');
    assert.deepEqual(sim2.mask, sim.mask);
    assert.equal(sim2.g.tanks.length, sim.g.tanks.length);
    for (let i = 0; i < sim.g.tanks.length; i++) {
      const a = sim.g.tanks[i], b = sim2.g.tanks[i];
      assert.equal(b.id, a.id); assert.equal(b.hp, a.hp); assert.equal(b.x, a.x); assert.equal(b.team, a.team);
    }
    assert.equal(sim2.g.active.id, sim.g.active.id);
    assert.equal(sim2.g.teams[0].tanks[0], sim2.g.tanks.find((t) => t.id === sim2.g.teams[0].tanks[0].id), 'Teams zeigen auf dieselben Panzer-Objekte');
    globalThis.StahlSim.clearSave();
    assert.equal(globalThis.StahlSim.loadSave(), null);
  });
});
