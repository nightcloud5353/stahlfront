'use strict';
// KI-Gegner: gezielte Lagen auf flachem Testgelände – nutzt die KI die passende Waffe/Funktion?
const test = require('node:test');
const assert = require('node:assert/strict');
const { S, makeSim, joinPlayer, withSeed } = require('./helpers');

// Gefecht Gastgeber gegen eine Elite-KI; die KI ist am Zug, Gelände nach ground(x) (Oberkante), kein Wind
function setup(opts) {
  const o = Object.assign({ level: 3, tanks: 1, ground: () => 600, water: 900 }, opts);
  const sim = makeSim();
  sim.code = 'TEST';
  const host = joinPlayer(sim, 'Host');
  sim.onMessage(host.conn, { t: 'settings', tanks: o.tanks, map: 'huegel', theme: 0, turnTime: 30 });
  sim.onMessage(host.conn, { t: 'addbot', level: o.level });
  sim.onMessage(host.conn, { t: 'start' });
  const g = sim.g;
  while (!g.teams[g.turnTeam].bot) sim.nextTurn();
  g.objs = []; g.proj = []; g.fires = []; g.queue = [];
  g.waterY = o.water; g.wind = 0;
  sim.mask.fill(0);
  for (let x = 0; x < S.W; x++) for (let y = o.ground(x); y < S.H; y++) sim.mask[y * S.W + x] = 1;
  const place = (t, x) => { t.x = x; t.y = sim.floorsAt(x)[0]; t.grounded = true; t.vx = 0; t.vy = 0; t.tilt = 0; t.hp = 100; };
  const team = g.teams[g.turnTeam];
  team.turns = 6; // alle Waffen freigeschaltet
  const bot = g.active;
  return { sim, g, team, bot, foes: g.tanks.filter((k) => k.team !== bot.team), own: team.tanks.filter((k) => k !== bot), place };
}
// Plan der KI sofort ausrechnen (sonst verteilt über mehrere Frames)
function plan(s) {
  const b = s.g.bot = { t: 0, plan: null, done: false };
  const gen = s.sim.botPlan(s.team, s.g.active, globalThis.SimBase.BOT_SKILL[s.team.bot], b);
  let r;
  do { s.sim.botWork = 0; r = gen.next(); } while (!r.done);
  return r.value;
}
const run = (sim, cond, max) => { for (let i = 0; i < max; i++) { if (cond()) return true; sim.step(); } return false; };

test('KI rammt einen Gegner über die Klippe ins Wasser', () => {
  withSeed(5, () => {
    const s = setup({ ground: (x) => (x < 1170 ? 600 : S.H), water: 800 });
    s.place(s.bot, 1000); s.place(s.foes[0], 1035);
    const p = plan(s);
    assert.equal(p.w, 'ram');
    assert.equal(p.face, 1);
  });
});

test('KI nimmt die Atomgranate gegen einen weit entfernten Gegner', () => {
  withSeed(5, () => {
    const s = setup();
    s.place(s.bot, 600); s.place(s.foes[0], 1100);
    s.team.ammo.nuke = 1;
    assert.equal(plan(s).w, 'nuke');
  });
});

test('KI fährt aus dem Feuer', () => {
  withSeed(5, () => {
    const s = setup();
    s.place(s.bot, 1000); s.place(s.foes[0], 1500);
    s.g.fires.push({ id: 999, x: 1000, y: s.bot.y + 8, life: 4, born: -1, src: { team: s.foes[0].team } });
    const p = plan(s);
    assert.equal(p.kind, 'drive');
    assert.ok(Math.abs(p.x - 1000) > 25);
  });
});

test('KI holt sich eine Heil-Kiste und schießt danach', () => {
  withSeed(5, () => {
    const s = setup();
    s.place(s.bot, 1000); s.place(s.foes[0], 1500);
    s.bot.hp = 40;
    s.g.objs.push({ id: 998, kind: 'crate', x: 1080, y: s.bot.y + 2, vx: 0, vy: 0, grounded: true, alive: true, r: 8, content: 'heal', bounces: 0 });
    s.g.bot = { t: 0, plan: null, done: false };
    assert.ok(run(s.sim, () => !s.g.objs.length, 60 * 10), 'Kiste eingesammelt');
    assert.ok(s.bot.hp > 40);
    assert.ok(run(s.sim, () => s.g.fired, 60 * 15), 'danach gefeuert');
  });
});

test('KI zieht sich mit der Seilwinde aus einer Grube am Wasser', () => {
  withSeed(5, () => {
    const s = setup({ ground: (x) => (Math.abs(x - 1000) < 40 ? 760 : 600), water: 800 });
    s.place(s.bot, 1000); s.place(s.foes[0], 1500);
    const y0 = s.bot.y, ammo = s.team.ammo.winch;
    s.g.bot = { t: 0, plan: null, done: false };
    assert.ok(run(s.sim, () => s.g.fired, 60 * 20), 'gefeuert');
    assert.equal(s.team.ammo.winch, ammo - 1, 'Seilwinde benutzt');
    assert.ok(s.bot.y < y0 - 100, 'aus der Grube heraus');
  });
});

test('KI wechselt zum Panzer mit der besseren Lage', () => {
  withSeed(5, () => {
    const s = setup({ tanks: 2, ground: (x) => (Math.abs(x - 400) < 30 ? 760 : 600), water: 790 });
    s.place(s.bot, 400); s.place(s.own[0], 1100); s.place(s.foes[0], 1300); s.place(s.foes[1], 1400);
    s.team.ammo.winch = 0;
    const p = plan(s);
    assert.equal(p.kind, 'switch');
    assert.equal(p.tank, s.own[0]);
  });
});

test('KI schießt nicht auf den eigenen Panzer', () => {
  withSeed(5, () => {
    const s = setup({ tanks: 2 });
    s.place(s.bot, 600); s.place(s.own[0], 1000); s.place(s.foes[0], 1030); s.place(s.foes[1], 1700);
    s.g.bot = { t: 0, plan: null, done: false };
    const hp = s.own[0].hp;
    const turn = s.g.turnCount;
    assert.ok(run(s.sim, () => s.g.turnCount > turn, 60 * 40), 'Zug beendet');
    assert.ok(hp - s.own[0].hp < 20, `eigener Panzer verlor ${hp - s.own[0].hp}`);
  });
});

test('Sprengladung geht am Ende des eigenen Zuges hoch – der Leger ist dann weg', () => {
  withSeed(5, () => {
    const s = setup();
    s.place(s.bot, 1000); s.place(s.foes[0], 1045);
    s.team.ammo = Object.assign(s.team.ammo, { cluster: 0, drill: 0, napalm: 0, strike: 0, mine: 0, nuke: 0, c4: 1 });
    // HE/Abpraller auf so kurze Entfernung wären Eigenbeschuss -> KI nimmt die Sprengladung
    const p = plan(s);
    assert.equal(p.w, 'c4');
    s.g.bot = { t: 5, plan: p, done: false, t0: 0 };
    const foe = s.foes[0], hp = foe.hp, turn = s.g.turnCount;
    assert.ok(run(s.sim, () => s.g.turnCount > turn, 60 * 30), 'Zug beendet');
    assert.ok(hp - foe.hp >= 40, `Gegner verlor ${hp - foe.hp}`);
    assert.equal(s.bot.hp, 100, 'Leger unverletzt');
  });
});
