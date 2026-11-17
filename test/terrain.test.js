'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { S, withSeed, makeSim } = require('./helpers');

const solidCount = (sim) => sim.mask.reduce((n, v) => n + (v ? 1 : 0), 0);

for (const map of S.MAPS) {
  test(`Gelände "${map.name}": genug Boden, Ränder befahrbar`, () => {
    withSeed(7, () => {
      const sim = makeSim();
      sim.g = { map: map.id, waterY: S.H - 62, objs: [], tanks: [] };
      sim.genTerrain(map.id);
      const frac = solidCount(sim) / sim.mask.length;
      assert.ok(frac > 0.05 && frac < 0.9, `Bodenanteil ${frac}`);
      // in der Mitte gibt es irgendwo Boden
      assert.ok(sim.floorsAt(S.W / 2).length > 0 || sim.floorsAt(S.W / 3).length > 0);
    });
  });
}

test('Lauflängen-Kodierung: rle → unrle ergibt dasselbe Gelände', () => {
  withSeed(11, () => {
    const sim = makeSim();
    sim.g = { map: 'bruecken', waterY: S.H - 62, objs: [], tanks: [] };
    sim.genTerrain('bruecken');
    const before = Uint8Array.from(sim.mask);
    const r = sim.rle();
    assert.equal(r.length % 2, 0);
    assert.equal(r.filter((_, i) => i % 2).reduce((a, b) => a + b, 0), before.length);
    sim.mask.fill(0);
    sim.unrle(r);
    assert.deepEqual(sim.mask, before);
  });
});

test('Krater: carve entfernt Erde, Beton bleibt teilweise stehen', () => {
  const sim = makeSim();
  sim.g = { map: 'huegel', waterY: S.H - 62, objs: [], tanks: [], slides: [] };
  const { W } = S;
  sim.mask.fill(0);
  // links Erde, rechts Beton
  for (let y = 500; y < 700; y++) for (let x = 0; x < W; x++) sim.mask[y * W + x] = x < 1000 ? 1 : 2;
  sim.carve(800, 600, 30);
  assert.equal(sim.solid(800, 600), false);
  sim.carve(1200, 600, 30);
  assert.equal(sim.solid(1200, 600), false, 'Mitte des Betonkraters ist weg');
  assert.equal(sim.solid(1200 + 25, 600), true, 'Beton wird nur zum Teil zerstört');
});

// Ebene Fläche unten + dünner, frei schwebender Erdstreifen (bricht bei einer Explosion in der Nähe ab)
function ledgeSim() {
  const sim = makeSim();
  const { W, H } = S;
  sim.g = { map: 'huegel', waterY: H - 62, objs: [], tanks: [], proj: [], slides: [], nextId: 1 };
  sim.mask.fill(0);
  for (let y = 600; y < H; y++) sim.mask.fill(1, y * W, (y + 1) * W);
  for (let y = 400; y < 406; y++) sim.mask.fill(1, y * W + 900, y * W + 1100);
  // gelandete Pixel aus den Meldungen an die Mitspieler mitzählen
  sim.landed = 0;
  sim.broadcast = (m) => {
    if (m.t !== 'sl') return;
    for (let i = 0; i < m.d.length; i += 4) for (let b = m.d[i + 3]; b; b &= b - 1) sim.landed++;
  };
  return sim;
}
function settleSlides(sim) {
  for (let i = 0; i < 2000 && sim.g.slides.length; i++) { sim.tickN++; sim.updateSlides(); }
  assert.equal(sim.g.slides.length, 0, 'alle Brocken sind gelandet');
}
// Erde im Streifen (dorthin fällt nichts zurück: die Brocken landen auf der Fläche bei y = 600)
const ledge = (sim) => { let n = 0; for (let y = 400; y < 406; y++) for (let x = 0; x < S.W; x++) n += sim.mask[y * S.W + x] === 1 ? 1 : 0; return n; };

test('Erdrutsch: zwei Explosionen kurz nacheinander verdoppeln keine Erde', () => {
  withSeed(3, () => {
    const sim = ledgeSim();
    const before = ledge(sim);
    sim.landslide(1000, 410, 40, null);
    const n1 = sim.g.slides.length;
    assert.ok(n1 > 0, 'Streifen bricht ab');
    // zweite Explosion, bevor die Brocken losgelassen sind (z. B. Streumunition, Artillerieschlag)
    sim.landslide(1000, 410, 40, null);
    assert.equal(sim.g.slides.length, n1, 'schon abbrechende Erde wird nicht noch einmal erfasst');
    settleSlides(sim);
    const removed = before - ledge(sim);
    assert.ok(removed > 0);
    assert.ok(sim.landed <= removed, `gelandet ${sim.landed}, abgebrochen ${removed}`);
  });
});

test('Erdrutsch: weggesprengte Teile eines abbrechenden Brockens fallen nicht trotzdem herunter', () => {
  withSeed(4, () => {
    const sim = ledgeSim();
    sim.landslide(1000, 410, 40, null);
    // Krater mitten im Streifen, bevor die Brocken losgelassen sind
    sim.carveRaw(1000, 403, 20);
    const afterCarve = ledge(sim);
    // bis alle Brocken losgelassen sind (noch bevor der erste unten aufschlägt)
    for (let i = 0; i < 200 && sim.g.slides.some((s) => !s.released); i++) { sim.tickN++; sim.updateSlides(); }
    assert.equal(sim.landed, 0, 'noch nichts gelandet');
    const falling = sim.g.slides.reduce((n, s) => n + s.n, 0);
    assert.equal(falling, afterCarve - ledge(sim), 'es fällt genau die Erde, die noch da war');
    settleSlides(sim);
    assert.ok(sim.landed <= falling);
  });
});

// ---------- Optimierungen: Ergebnisse müssen exakt wie vorher sein ----------
const refCircleHits = (sim, x, y, r) => {
  const C = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; C.push([Math.cos(a), Math.sin(a)]); }
  for (let i = 0; i < 16; i++) if (sim.solid(x + C[i][0] * r, y + C[i][1] * r)) return true;
  return sim.solid(x, y);
};
const refFloorsAt = (sim, x) => {
  const out = [], R = S.TANK_R;
  for (let y = R + 2; y < sim.g.waterY - 30; y++) {
    if (!refCircleHits(sim, x, y, R) && refCircleHits(sim, x, y + 1, R)) { out.push(y); y += R * 2; }
  }
  return out;
};
const refRle = (m) => {
  const out = [];
  let cur = m[0], n = 0;
  for (let i = 0; i < m.length; i++) { if (m[i] === cur) n++; else { out.push(cur, n); cur = m[i]; n = 1; } }
  out.push(cur, n);
  return out;
};

for (const map of S.MAPS) {
  test(`Schnelle Geländeabfragen auf "${map.name}": gleiche Ergebnisse wie vorher`, () => {
    withSeed(21 + map.id.length, () => {
      const sim = makeSim();
      sim.g = { map: map.id, waterY: S.H - 62, objs: [], tanks: [], slides: [] };
      sim.genTerrain(map.id);
      // ein paar Krater, damit es auch Löcher, Kanten und einzelne Pixel gibt
      for (let i = 0; i < 25; i++) sim.carve(Math.random() * S.W, Math.random() * S.H, 5 + Math.floor(Math.random() * 40));
      sim.mask[0] = 1; sim.mask[3] = 2; sim.mask[sim.mask.length - 1] = 2;
      assert.deepEqual(sim.rle(), refRle(sim.mask), 'rle');
      for (let x = -15; x < S.W + 15; x += 7) {
        assert.deepEqual(sim.floorsAt(x + 0.5), refFloorsAt(sim, x + 0.5), `floorsAt(${x + 0.5})`);
        for (let y = -15; y < S.H + 15; y += 13) {
          const fx = x + Math.random(), fy = y + Math.random();
          assert.equal(sim.circleHits(fx, fy, 10), refCircleHits(sim, fx, fy, 10), `circleHits(${fx}, ${fy})`);
        }
      }
    });
  });
}

test('Lauflängen-Kodierung: Sonderfälle (alles gleich, Wechsel an jeder Stelle)', () => {
  const sim = makeSim();
  sim.mask.fill(1);
  assert.deepEqual(sim.rle(), [1, sim.mask.length]);
  for (let i = 0; i < 64; i++) sim.mask[i] = i % 3 === 0 ? 2 : i % 2;
  sim.mask[sim.mask.length - 2] = 0;
  assert.deepEqual(sim.rle(), refRle(sim.mask));
});
