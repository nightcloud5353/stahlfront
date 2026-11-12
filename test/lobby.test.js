'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeSim, joinPlayer, withSeed } = require('./helpers');

test('Beitreten: erster Spieler wird Gastgeber, Name wird bereinigt', () => {
  const sim = makeSim();
  const a = joinPlayer(sim, '  <b>Hans&Franz"  ');
  const b = joinPlayer(sim, '');
  assert.equal(sim.hostPid, a.p.id);
  assert.equal(a.p.name, 'bHansFranz', 'HTML-Zeichen raus');
  assert.equal(joinPlayer(sim, 'A'.repeat(30)).p.name.length, 12, 'max. 12 Zeichen');
  assert.ok(!/[<>&"]/.test(a.p.name));
  assert.equal(b.p.name, 'Soldat');
  assert.equal(a.conn.last('welcome').host, true);
  assert.equal(b.conn.last('welcome').host, false);
  assert.match(a.p.token, /^[a-z0-9]{24}$/);
  assert.notEqual(a.p.token, b.p.token);
});

test('Wiederverbinden mit Token übernimmt denselben Spieler', () => {
  const sim = makeSim();
  const a = joinPlayer(sim, 'Anna');
  const again = joinPlayer(sim, 'Anna', { token: a.p.token });
  assert.equal(again.p, a.p);
  assert.equal(sim.players.size, 1);
  assert.ok(a.conn.last('replaced'));
  assert.equal(a.conn.closed, true);
});

test('Nur der Gastgeber darf Einstellungen ändern, ungültige Werte werden ignoriert', () => {
  const sim = makeSim();
  const host = joinPlayer(sim, 'Host');
  const gast = joinPlayer(sim, 'Gast');
  sim.onMessage(gast.conn, { t: 'settings', tanks: 4, turnTime: 60 });
  assert.equal(sim.settings.tanks, 2);
  sim.onMessage(host.conn, { t: 'settings', tanks: 9, turnTime: 13, map: 'mond', theme: 99 });
  assert.deepEqual(sim.settings, { tanks: 2, turnTime: 30, theme: -1, map: 'random' });
  sim.onMessage(host.conn, { t: 'settings', tanks: 3, turnTime: 0, map: 'inseln', theme: 2 });
  assert.deepEqual(sim.settings, { tanks: 3, turnTime: 0, theme: 2, map: 'inseln' });
});

test('Unsinnige Nachrichten werden ignoriert', () => {
  const sim = makeSim();
  const a = joinPlayer(sim, 'A');
  for (const m of [null, 42, 'x', {}, { t: 7 }, { t: 'fire' }, { t: 'weapon', w: '__proto__' }]) sim.onMessage(a.conn, m);
  const fremd = { sent: [], send() {}, close() {} };
  sim.onConnect(fremd);
  sim.onMessage(fremd, { t: 'start' }); // nicht beigetreten
  assert.equal(sim.phase, 'lobby');
});

test('Start braucht mindestens zwei Teilnehmer; KI zählt mit', () => {
  withSeed(3, () => {
    const sim = makeSim();
    const host = joinPlayer(sim, 'Host');
    sim.onMessage(host.conn, { t: 'start' });
    assert.equal(sim.phase, 'lobby');
    assert.equal(host.conn.last('msg').k, 'err');
    sim.onMessage(host.conn, { t: 'addbot', level: 3 });
    sim.onMessage(host.conn, { t: 'start' });
    assert.equal(sim.phase, 'game');
    assert.equal(sim.g.teams.length, 2);
    assert.equal(sim.g.tanks.length, 4, '2 Panzer pro Team');
    assert.ok(host.conn.last('start'));
    assert.ok(host.conn.last('terrain'));
  });
});

test('Kick nur durch den Gastgeber und nicht den Gastgeber selbst', () => {
  const sim = makeSim();
  const host = joinPlayer(sim, 'Host');
  const gast = joinPlayer(sim, 'Gast');
  sim.onMessage(gast.conn, { t: 'kick', id: host.p.id });
  assert.equal(sim.players.size, 2);
  sim.onMessage(host.conn, { t: 'kick', id: host.p.id });
  assert.equal(sim.players.size, 2);
  sim.onMessage(host.conn, { t: 'kick', id: gast.p.id });
  assert.equal(sim.players.size, 1);
  assert.ok(gast.conn.last('kicked'));
});

test('Wer während des Gefechts beitritt, schaut zu', () => {
  withSeed(5, () => {
    const sim = makeSim();
    const host = joinPlayer(sim, 'Host');
    sim.onMessage(host.conn, { t: 'addbot', level: 1 });
    sim.onMessage(host.conn, { t: 'start' });
    const spaet = joinPlayer(sim, 'Spät');
    assert.equal(spaet.p.spec, true);
    assert.ok(spaet.conn.last('start'), 'bekommt trotzdem das laufende Gefecht');
  });
});
