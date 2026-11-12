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
