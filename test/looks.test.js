// Panzer gestalten: Daten der Tarnungen/Kopfbedeckungen und Umstellung alter Auswahl
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { S } = require('./helpers');
const B = globalThis.SimBase;
const art = fs.readFileSync(path.join(__dirname, '..', 'js', 'tank-art.js'), 'utf8');

test('Tarnungen: vollständige Daten, eindeutige IDs, jedes Muster wird gezeichnet', () => {
  assert.equal(new Set(S.CAMOS.map((c) => c.id)).size, S.CAMOS.length);
  for (const c of S.CAMOS) {
    for (const k of ['id', 'name', 'info', 'base', 'turret', 'pat', 'swatch']) assert.ok(c[k], `${c.id}.${k}`);
    assert.ok(Array.isArray(c.cols), `${c.id}.cols`);
    assert.match(c.base, /^#[0-9A-F]{6}$/i);
    assert.ok(art.includes(`case '${c.pat}'`), `Muster "${c.pat}" fehlt in tank-art.js`);
  }
});

test('Kopfbedeckungen: eindeutige IDs, jede wird gezeichnet', () => {
  assert.equal(new Set(S.HATS.map((h) => h.id)).size, S.HATS.length);
  assert.equal(S.HATS[0].id, 'none');
  for (const h of S.HATS.slice(1)) assert.ok(art.includes(`case '${h.id}'`), `Kopfbedeckung "${h.id}" fehlt in tank-art.js`);
});

test('validLook: alte Auswahl wird umgestellt, Unbekanntes wird zum Standard', () => {
  assert.deepEqual(B.validLook({ camo: 'nacht', hat: 'krone' }), { camo: 'splitter', hat: 'morion' });
  assert.deepEqual(B.validLook({ camo: 'wald', hat: 'krone' }), { camo: 'wald', hat: 'morion' });
  assert.deepEqual(B.validLook({ camo: 'nacht', hat: 'pickel' }), { camo: 'splitter', hat: 'pickel' });
  assert.deepEqual(B.validLook({ camo: 'xyz', hat: '<b>' }), { camo: 'oliv', hat: 'none' });
  assert.deepEqual(B.validLook(null), { camo: 'oliv', hat: 'none' });
  for (const c of S.CAMOS) for (const h of S.HATS) assert.deepEqual(B.validLook({ camo: c.id, hat: h.id }), { camo: c.id, hat: h.id });
});
