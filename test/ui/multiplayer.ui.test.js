// Browser-Tests: Mitspieler (nicht Gastgeber) kommen sicher ins Gefecht – auch wenn unterwegs Nachrichten
// verloren gehen (der öffentliche Internet-Server stellt nichts garantiert zu) oder der Gastgeber neu verbindet.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setup, serve, passwordStorage } = require('./browser');
const { startBroker } = require('./mqtt-broker');

let env;
test.before(async () => { env = await setup(); });
test.after(async () => { await env.close(); });

// Mitspieler in die Lobby, Gastgeber (unsichtbar) startet.
// drop = Quelltext einer Funktion: welche Nachrichten an mich unterwegs verloren gehen
async function guestStart(page, drop, settings) {
  await page.evaluate(([d, st]) => {
    window.__sfTest.remoteGuest('Gast', undefined, d);
    if (st) window.__sfTest.hostSend(Object.assign({ t: 'settings' }, st));
  }, [drop || null, settings || null]);
  await page.waitForSelector('#lobby:not(.hidden)');
  await page.evaluate(() => window.__sfTest.hostSend({ t: 'start' }));
}
const maskOk = (page) => page.evaluate(() => {
  const g = window.__sfTest.sim; // Gelände beim Gastgeber == Gelände beim Mitspieler?
  return window.__sfTest.guestMask().every((v, i) => v === g.mask[i]);
});

test('Mitspieler: Gefecht startet (Nachrichten laufen als JSON wie übers Netz)', async () => {
  const page = await env.open('pc');
  await guestStart(page);
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  assert.ok(await maskOk(page), 'gleiches Gelände wie beim Gastgeber');
  assert.deepEqual(page.errors, []);
});

test('Mitspieler: verlorene Start-Nachricht -> holt sich den Start selbst, bleibt nicht in der Lobby', async () => {
  const page = await env.open('pc');
  // die erste Start-Nachricht geht verloren
  await guestStart(page, "(() => { let done = false; return (m) => { if (m.t === 'start' && !done) { done = true; return true; } return false; }; })()");
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
  assert.ok(await maskOk(page));
  assert.deepEqual(page.errors, []);
});

test('Mitspieler: verlorenes Geländestück -> kein Start mit kaputtem Gelände, wird neu angefordert', async () => {
  const page = await env.open('pc');
  // Inseln: Gelände kommt in 2 Teilen, der zweite geht verloren
  await guestStart(page, "(() => { let done = false; return (m) => { if (m.t === 'terrain' && m.i === 1 && !done) { done = true; return true; } return false; }; })()", { map: 'inseln' });
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
  assert.ok(await maskOk(page), 'Gelände vollständig');
  assert.deepEqual(page.errors, []);
});

// ---------- echter Netzweg: zwei Browser über einen (nachgebauten) Internet-Server ----------
test('Über den Internet-Server: Mitspieler kommt ins Gefecht, auch nachdem der Gastgeber neu verbunden hat', async () => {
  const srv = await serve();
  const broker = await startBroker();
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${srv.address().port}/?noDirect&relay=${broker.url}`;
    const pw = passwordStorage();
    const open = async (name) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, Object.assign({ sf_name: name }, pw));
      await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort()); // kein echtes Internet (PeerJS)
      const p = await ctx.newPage();
      p.errors = [];
      p.on('pageerror', (e) => p.errors.push(e.message));
      await p.goto(base);
      await p.waitForSelector('#menu:not(.hidden)');
      return p;
    };
    const host = await open('Host');
    await host.click('#btnHost');
    await host.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 });
    const code = await host.evaluate(() => location.hash.slice(1));
    const guest = await open('Gast');
    await guest.fill('#code', code);
    await guest.click('#btnJoin');
    await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 });
    await host.waitForFunction(() => document.querySelectorAll('#plist li').length >= 2);

    // Verbindung des Gastgebers zum Server reißt ab, er verbindet neu (passiert bei öffentlichen Servern)
    assert.ok(broker.kick('/h') >= 1);
    await host.waitForTimeout(3500);
    // ein Lebenszeichen des Mitspielers kommt über die neue Verbindung an
    await guest.waitForTimeout(4500);

    await host.click('#btnStart');
    await host.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
    // vor der Korrektur ging alles an die tote Verbindung -> Mitspieler blieb in der Lobby
    await guest.waitForSelector('#hud:not(.hidden)', { timeout: 6000 });
    assert.deepEqual(host.errors, []);
    assert.deepEqual(guest.errors, []);
  } finally {
    await browser.close(); broker.close(); srv.close();
  }
});
