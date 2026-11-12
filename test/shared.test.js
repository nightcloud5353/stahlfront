'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { S, Sim } = require('./helpers');

test('randomId: Länge und Alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const id = S.randomId(24);
    assert.equal(id.length, 24);
    assert.match(id, /^[a-z0-9]+$/);
  }
  const code = S.randomId(4, 'ABC');
  assert.match(code, /^[ABC]{4}$/);
});

test('randomId: keine auffällige Häufung einzelner Zeichen', () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const n = {};
  const s = S.randomId(32000, abc);
  for (const ch of s) n[ch] = (n[ch] || 0) + 1;
  for (const ch of abc) assert.ok(n[ch] > 700 && n[ch] < 1300, `${ch}: ${n[ch]}`);
});

test('Waffen: eindeutige IDs und gültige Modi', () => {
  const ids = S.WEAPONS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const w of S.WEAPONS) {
    assert.ok(['fire', 'aim', 'now', 'target'].includes(w.mode), w.id);
    assert.ok(Number.isInteger(w.ammo) && w.ammo >= -1, w.id);
    assert.ok(w.from >= 1, w.id);
  }
});

test('Waffen: jede Geschossart hat Flug- und Explosionswerte', () => {
  const { PT, BOOM } = globalThis.SimBase;
  for (const w of S.WEAPONS.filter((x) => x.mode === 'fire')) {
    assert.ok(PT[w.id], `PT fehlt: ${w.id}`);
    assert.ok(BOOM[w.id], `BOOM fehlt: ${w.id}`);
  }
  for (const [k, v] of Object.entries(BOOM)) {
    assert.equal(v.length, 3, k);
    assert.ok(v.every((x) => x > 0), k);
  }
});

test('Sim-Klasse: alle Teile sind eingemischt', () => {
  for (const m of ['genTerrain', 'carve', 'landslide', 'spawnTanks', 'updateTank', 'useWeapon', 'explode', 'botPlan', 'botThink'])
    assert.equal(typeof Sim.prototype[m], 'function', m);
});
