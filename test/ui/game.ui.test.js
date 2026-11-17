// Browser-Tests: Gefecht auf dem PC – Tastatur, Feuer, Waffenmenü, Aussehen bleibt wie es ist
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, toGame, visible } = require('./browser');

let env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

const sim = (page, fn) => page.evaluate(fn);

test('PC: Tastenhilfe statt Bildschirm-Knöpfen, umschaltbar', async () => {
  const page = await env.open('pc');
  await toGame(page);
  assert.equal(await page.evaluate(() => document.body.classList.contains('touch')), false, 'PC gilt nicht als Touch-Gerät');
  assert.ok(await visible(page, '#keyhint'), 'Tastenhilfe sichtbar');
  assert.ok(await visible(page, '#btnPad'), 'Knopf "Bildschirm-Knöpfe zeigen" sichtbar');
  assert.ok(!(await visible(page, '.cbtn.drive')), 'Fahrknöpfe ausgeblendet');
  assert.ok(await visible(page, '#btnFire'));
  await page.click('#btnPad');
  assert.ok(await visible(page, '.cbtn.drive'), 'Fahrknöpfe nach Umschalten sichtbar');
  assert.deepEqual(page.errors, []);
});

test('PC: mit W zielen, mit Leertaste feuern', async () => {
  const page = await env.open('pc');
  await toGame(page);
  const aim0 = await sim(page, () => window.__sfTest.sim.g.active.aim);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(900); await page.keyboard.up('KeyW');
  const aim1 = await sim(page, () => window.__sfTest.sim.g.active.aim);
  assert.ok(aim1 > aim0, `Winkel steigt (${aim0} -> ${aim1})`);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__sfTest.sim.g.fired);
  assert.deepEqual(page.errors, []);
});

test('PC: Tab öffnet das Waffenmenü, Auswahl wechselt die Waffe', async () => {
  const page = await env.open('pc');
  await toGame(page);
  await page.keyboard.press('Tab');
  await page.waitForSelector('#weaponMenu:not(.hidden)');
  await page.click('#weaponMenu button:has-text("MG-Salve")');
  await page.waitForSelector('#weaponMenu.hidden', { state: 'attached' });
  await page.waitForFunction(() => window.__sfTest.sim.g.weapon === 'mg');
  assert.match(await page.textContent('#wName'), /MG/);
});
