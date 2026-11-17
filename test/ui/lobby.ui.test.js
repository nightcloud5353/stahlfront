// Browser-Tests: Lobby, Panzer gestalten (Tarnung, Kommandant)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, toLobby } = require('./browser');
const S = require('../../js/shared.js');

let env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

test('Lobby zeigt alle Tarnungen und Kopfbedeckungen als Knöpfe', async () => {
  const page = await env.open('pc');
  await toLobby(page);
  const camos = await page.$$eval('#chipCamo button', (bs) => bs.map((b) => ({ text: b.textContent.trim(), title: b.title, sw: b.querySelector('i').style.background })));
  assert.deepEqual(camos.map((c) => c.text), S.CAMOS.map((c) => c.name));
  for (const c of camos) {
    assert.ok(c.title.length > 10, `Tarnung "${c.text}" hat eine Erklärung`);
    assert.ok(c.sw.length > 0, `Tarnung "${c.text}" hat ein Farbfeld`);
  }
  const hats = await page.$$eval('#chipHat button', (bs) => bs.map((b) => b.textContent.trim()));
  assert.deepEqual(hats, S.HATS.map((h) => h.name));
  assert.deepEqual(page.errors, []);
});

test('Auswahl von Tarnung und Kopfbedeckung wird gespeichert und an den Gastgeber geschickt', async () => {
  const page = await env.open('pc');
  await toLobby(page);
  await page.click('#chipHat button:has-text("Pickelhaube")');
  await page.click('#chipCamo button:has-text("Splitter")');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sf_look')));
  assert.deepEqual(saved, { camo: 'splitter', hat: 'pickel' });
  await page.waitForFunction(() => {
    const p = [...window.__sfTest.sim.players.values()].find((q) => !q.bot);
    return p.look.camo === 'splitter' && p.look.hat === 'pickel';
  });
  assert.equal(await page.textContent('#chipHat button.on'), 'Pickelhaube');
});

test('Alte Auswahl (Krone, Nacht) wird zu Morion und Splitter', async () => {
  const page = await env.open('pc', { sf_look: JSON.stringify({ camo: 'nacht', hat: 'krone' }) });
  await toLobby(page);
  assert.equal(await page.textContent('#chipHat button.on'), 'Morion');
  assert.match(await page.textContent('#chipCamo button.on'), /Splitter/);
});
