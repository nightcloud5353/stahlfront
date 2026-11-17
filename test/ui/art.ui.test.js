// Browser-Tests: Panzer zeichnen – jede Tarnung und jede Kopfbedeckung wird wirklich (und unterschiedlich) gezeichnet
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./browser');
const S = require('../../js/shared.js');

let env, page;
test.before(async () => { env = await setup(); page = await env.open('pc'); });
test.after(async () => { await env.close(); });

// zeichnet einen Panzer groß auf eine Leinwand und liefert einen Fingerabdruck der Pixel
const render = (look, region) => page.evaluate(([look, region]) => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, 320, 200);
  x.setTransform(6, 0, 0, 6, 160, 150);
  window.TANKART.draw(x, { id: 5, x: 0, y: 0, tilt: 0, face: 1, aim: 30, alive: true }, look, '#D9483B', 0, false, false);
  const [rx, ry, rw, rh] = region;
  const d = x.getImageData(rx, ry, rw, rh).data;
  let sum = 0, n = 0; const cols = new Set();
  for (let i = 0; i < d.length; i += 4) { sum += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7; cols.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4)); n++; }
  return { avg: sum / n, cols: cols.size, hash: Array.from(d.filter((_, i) => i % 97 === 0)).join(',') };
}, [look, region]);

const HEAD = [80, 0, 110, 90];   // Bereich um den Kommandanten
const HULL = [20, 60, 280, 140]; // Wanne, Schürzen, Turm

test('jede Kopfbedeckung wird gezeichnet und sieht anders aus als die anderen', async () => {
  const seen = new Map();
  for (const h of S.HATS) {
    const r = await render({ camo: 'oliv', hat: h.id }, HEAD);
    for (const [other, hash] of seen) assert.notEqual(r.hash, hash, `${h.name} sieht aus wie ${other}`);
    seen.set(h.name, r.hash);
  }
  assert.deepEqual(page.errors, []);
});

test('jede Tarnung wird gezeichnet und hat ein eigenes Muster', async () => {
  const seen = new Map();
  for (const c of S.CAMOS) {
    const r = await render({ camo: c.id, hat: 'none' }, HULL);
    if (c.pat !== 'uni') assert.ok(r.cols >= 12, `${c.name}: Muster mit mehreren Farben (${r.cols})`);
    for (const [other, hash] of seen) assert.notEqual(r.hash, hash, `${c.name} sieht aus wie ${other}`);
    seen.set(c.name, r.hash);
  }
  assert.deepEqual(page.errors, []);
});
