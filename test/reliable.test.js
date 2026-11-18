'use strict';
// Sicherer Kanal (js/reliable.js): Der öffentliche Internet-Server verliert, verdoppelt und vertauscht
// Nachrichten. Wichtiges (Feuer, Zielen, Beitreten, Spielstart …) muss trotzdem genau einmal und in
// der richtigen Reihenfolge ankommen.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { withSeed } = require('./helpers');
const { Chan, RESEND_MS } = require(path.join(__dirname, '..', 'js', 'reliable.js'));

// Zwei Kanäle über eine schlechte Leitung. loss/dup/delay: Wahrscheinlichkeiten bzw. max. Verzögerung (ms)
function pair(opts) {
  const o = Object.assign({ loss: 0, dup: 0, delay: 0, drop: null }, opts);
  let now = 0;
  const clock = () => now;
  const q = []; // { at, to, f }
  const got = { a: [], b: [] };
  const sent = { a: 0, b: 0 };
  let a, b;
  const wire = (to) => (f) => {
    sent[to === 'b' ? 'a' : 'b']++;
    const frame = JSON.parse(JSON.stringify(f));
    if (o.drop && o.drop(frame, to)) return;
    if (Math.random() < o.loss) return;
    const copies = Math.random() < o.dup ? 2 : 1;
    for (let i = 0; i < copies; i++) q.push({ at: now + 5 + Math.random() * o.delay, to, f: frame });
  };
  a = new Chan(wire('b'), (m) => got.a.push(m), clock);
  b = new Chan(wire('a'), (m) => got.b.push(m), clock);
  // Zeit laufen lassen: Leitung zustellen, beide Kanäle ticken alle 60 ms
  const run = (ms) => {
    const end = now + ms;
    while (now < end) {
      now += 5;
      q.sort((x, y) => x.at - y.at);
      while (q.length && q[0].at <= now) { const e = q.shift(); (e.to === 'a' ? a : b).recv(e.f); }
      if (now % 60 === 0) { a.tick(); b.tick(); }
    }
  };
  return { a, b, got, sent, run, q };
}

test('verlustfreie Leitung: alles kommt genau einmal in Reihenfolge an, nichts wird nachgeschickt', () => {
  const l = pair();
  for (let i = 0; i < 50; i++) l.a.send({ t: 'x', i });
  l.run(1000);
  assert.deepEqual(l.got.b.map((m) => m.i), [...Array(50).keys()]);
  assert.equal(l.a.unacked, 0, 'alles bestätigt');
  assert.equal(l.a.stats.resent, 0);
});

test('Leitung verliert, verdoppelt und vertauscht: wichtige Nachrichten kommen trotzdem genau einmal in Reihenfolge an', () => {
  withSeed(7, () => {
    const l = pair({ loss: 0.35, dup: 0.2, delay: 200 });
    for (let i = 0; i < 300; i++) { l.a.send({ t: 'set', i }); l.b.send({ t: 's', i }); if (i % 10 === 0) l.run(30); }
    l.run(8000);
    assert.deepEqual(l.got.b.map((m) => m.i), [...Array(300).keys()], 'a -> b vollständig');
    assert.deepEqual(l.got.a.map((m) => m.i), [...Array(300).keys()], 'b -> a vollständig');
    assert.equal(l.a.unacked, 0);
    assert.equal(l.b.unacked, 0);
    assert.ok(l.a.stats.resent > 0, 'es wurde nachgeschickt');
  });
});

test('verlorenes "Feuer" wird nachgeschickt (vorher: Schuss kam nie beim Gastgeber an)', () => {
  let first = true;
  const l = pair({ drop: (f) => { if (f.k === 'm' && f.m.t === 'fire' && first) { first = false; return true; } return false; } });
  l.a.send({ t: 'fire' });
  l.run(100);
  assert.deepEqual(l.got.b, [], 'erst einmal verloren');
  l.run(RESEND_MS + 200);
  assert.deepEqual(l.got.b, [{ t: 'fire' }], 'kommt nach kurzer Zeit doch an');
});

test('verlorene Bestätigung: Nachricht kommt nicht doppelt beim Spiel an', () => {
  let n = 0;
  const l = pair({ drop: (f) => f.k === 'a' && n++ < 3 });
  l.a.send({ t: 'fire' });
  l.run(3000);
  assert.deepEqual(l.got.b, [{ t: 'fire' }]);
  assert.ok(l.b.stats.dups >= 1, 'Doppel erkannt und verworfen');
  assert.equal(l.a.unacked, 0);
});

test('Zustände: nie an einer fehlenden wichtigen Nachricht vorbei und nie veraltet', () => {
  let lostStart = true;
  const l = pair({ drop: (f) => { if (f.k === 'm' && f.m.t === 'start' && lostStart) { lostStart = false; return true; } return false; } });
  l.a.send({ t: 'start' });
  l.a.send({ t: 's', i: 1 }, true);
  l.run(50);
  assert.deepEqual(l.got.b, [], 'Zustand nicht vor dem (verlorenen) Start zeigen');
  l.run(RESEND_MS + 300);
  l.a.send({ t: 's', i: 2 }, true);
  l.run(50);
  assert.deepEqual(l.got.b.map((m) => m.t + (m.i || '')), ['start', 's2'], 'Start kommt zuerst, dann Zustände');
  // veralteter Zustand (überholt) wird verworfen
  l.b.recv({ k: 'u', n: 1, u: 1, m: { t: 's', i: 1 } });
  assert.equal(l.got.b.length, 2);
  assert.equal(l.b.stats.staleU, 1);
});

test('Lücke wird sofort gemeldet und schnell gefüllt (nicht erst nach der vollen Wartezeit)', () => {
  let drop2 = true;
  const l = pair({ drop: (f) => { if (f.k === 'm' && f.n === 2 && drop2) { drop2 = false; return true; } return false; } });
  l.a.send({ i: 1 }); l.a.send({ i: 2 });
  l.run(150);
  l.a.send({ i: 3 }); // kommt vor der 2 an -> Lücke
  l.run(250);
  assert.deepEqual(l.got.b.map((m) => m.i), [1, 2, 3]);
});

test('kaputte oder fremde Rahmen werden ignoriert', () => {
  const l = pair();
  for (const f of [null, {}, { k: 'm' }, { k: 'x', n: 1 }, { k: 'a', n: 'x' }]) l.b.recv(f);
  assert.deepEqual(l.got.b, []);
});
