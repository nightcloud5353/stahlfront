// Browser-Tests: Handy und Tablet – Erkennung, Bedienung mit dem Finger, nichts ragt aus dem Bildschirm.
// Und umgekehrt: am PC (auch im kleinen Fenster) greift nichts davon.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, toLobby, toGame, visible } = require('./browser');

let env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

const classes = (page) => page.evaluate(() => ['touch', 'phone', 'tablet'].filter((c) => document.body.classList.contains(c)));

test('Erkennung: Handy, Tablet, PC', async () => {
  for (const [dev, want] of [['iphone', ['touch', 'phone']], ['android', ['touch', 'phone']], ['ipad', ['touch', 'tablet']], ['pc', []], ['pcKlein', []]]) {
    const page = await env.open(dev);
    assert.deepEqual(await classes(page), want, dev);
    await page.context().close();
  }
});

for (const dev of ['iphone', 'android', 'ipad']) {
  test(`${dev}: Bildschirm-Knöpfe, keine Tastenhilfe, Hinweise für Finger`, async () => {
    const page = await env.open(dev);
    await toGame(page);
    for (const sel of ['.cbtn.drive', '.cbtn.sm', '#btnWeapon', '#btnFire', '#btnFull2']) assert.ok(await visible(page, sel), `${sel} sichtbar`);
    for (const sel of ['#keyhint', '#btnPad', '#btnFire kbd', '#btnWeapon kbd']) assert.ok(!(await visible(page, sel)), `${sel} ausgeblendet`);
    const hint = await page.textContent('#hint');
    assert.match(hint, /Finger/);
    assert.doesNotMatch(hint, /Maus/);
    // Schriftzug "FEUER" passt in seinen Knopf
    const fits = await page.$eval('#btnFire', (b) => b.scrollWidth <= b.clientWidth + 1);
    assert.ok(fits, 'FEUER passt in den Knopf');
    // keine Bedienelemente außerhalb des Bildschirms
    const out = await page.evaluate(() => [...document.querySelectorAll('#hud button, #hud .panel')].filter((e) => {
      const r = e.getBoundingClientRect(); if (!r.width) return false;
      return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
    }).map((e) => e.id || e.className));
    assert.deepEqual(out, []);
    assert.deepEqual(page.errors, []);
  });

  test(`${dev}: mit dem Finger Winkel ändern und feuern`, async () => {
    const page = await env.open(dev);
    await toGame(page);
    const aim0 = await page.evaluate(() => window.__sfTest.sim.g.active.aim);
    const up = await page.$('.cbtn.sm[data-k="u"]');
    const box = await up.boundingBox();
    // Finger auf "Winkel hoch" halten
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    await page.waitForTimeout(900);
    await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    }, [box.x + box.width / 2, box.y + box.height / 2]);
    const aim1 = await page.evaluate(() => window.__sfTest.sim.g.active.aim);
    assert.ok(aim1 > aim0, `Winkel steigt (${aim0} -> ${aim1})`);
    await page.tap('#btnFire');
    await page.waitForFunction(() => window.__sfTest.sim.g.fired);
    assert.deepEqual(page.errors, []);
  });

  test(`${dev}: Hilfe erklärt die Bedienung mit dem Finger`, async () => {
    const page = await env.open(dev);
    await toGame(page);
    await page.evaluate(() => document.getElementById('help').classList.remove('hidden'));
    assert.ok(await visible(page, '#help .touchonly'));
    assert.ok(!(await visible(page, '#help .desktoponly')));
  });
}

// Lädt die Google-Schrift nicht (schlechtes Netz; in den Tests ist sie gesperrt), springt eine breitere
// Ersatzschrift ein. Mit 'DejaVu Sans' (breit, auf Linux-Testrechnern wie GitHub vorhanden) prüfen, dass nichts abgeschnitten wird.
for (const [dev, font] of [['iphone'], ['iphoneHoch'], ['ipad'], ['iphoneHoch', 'DejaVu Sans']]) {
  test(`${dev}${font ? ' mit Schrift ' + font : ''}: Lobby ragt nicht über den Bildschirm hinaus`, async () => {
    const page = await env.open(dev);
    if (font) await page.addStyleTag({ content: `:root { --ui: '${font}', sans-serif; }` });
    await toLobby(page);
    const r = await page.evaluate(() => {
      const bad = [...document.querySelectorAll('#lobby button')].filter((b) => {
        const q = b.getBoundingClientRect(); return q.width && (q.right > innerWidth + 1 || q.left < -1);
      }).map((b) => b.textContent.trim());
      const cut = [...document.querySelectorAll('#lobby .seg button')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim());
      return { bad, cut, sw: document.documentElement.scrollWidth, w: innerWidth };
    });
    assert.deepEqual(r.bad, [], 'Knöpfe innerhalb des Bildschirms');
    assert.deepEqual(r.cut, [], 'Beschriftungen nicht abgeschnitten');
    assert.ok(r.sw <= r.w + 1, 'kein seitliches Scrollen');
  });
}

test('PC: keine Touch-Anpassungen (Hinweise mit Maus, kein Vollbild-Knopf oben, Hilfe mit Maus und Tastatur)', async () => {
  for (const dev of ['pc', 'pcKlein']) {
    const page = await env.open(dev);
    await toGame(page);
    assert.match(await page.textContent('#hint'), /Maus/, dev);
    assert.ok(!(await visible(page, '#btnFull2')), dev);
    assert.ok(await visible(page, '#btnFire kbd'), `${dev}: Tastenbeschriftung am Feuer-Knopf`);
    await page.evaluate(() => document.getElementById('help').classList.remove('hidden'));
    assert.ok(await visible(page, '#help .desktoponly'), dev);
    assert.ok(!(await visible(page, '#help .touchonly')), dev);
    await page.context().close();
  }
});
