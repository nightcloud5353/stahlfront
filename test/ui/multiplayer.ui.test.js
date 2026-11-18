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

// Zwei Browser über (nachgebaute) Internet-Server. relays: Liste der Server-Adressen
async function netPair(relays, fn) {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const base = `http://127.0.0.1:${srv.address().port}/?test&noDirect&relay=${relays.join(',')}`;
    const pw = passwordStorage();
    const open = async (name) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, Object.assign({ sf_name: name }, pw));
      await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
      const p = await ctx.newPage();
      p.errors = [];
      p.on('pageerror', (e) => p.errors.push(e.message));
      await p.goto(base);
      await p.waitForSelector('#menu:not(.hidden)');
      return p;
    };
    await fn(open);
  } finally {
    await browser.close(); srv.close();
  }
}
async function hostRoom(open) {
  const host = await open('Host');
  await host.click('#btnHost');
  await host.waitForSelector('#lobby:not(.hidden)', { timeout: 15000 });
  return { host, code: await host.evaluate(() => location.hash.slice(1)) };
}

test('Gastgeber nur über den zweiten Internet-Server erreichbar: Mitspieler kommt trotzdem sofort in die Lobby', async () => {
  const a = await startBroker(), b = await startBroker();
  try {
    await netPair([a.url, b.url], async (open) => {
      const { host, code } = await hostRoom(open);
      // Verbindung des Gastgebers zu Server A reißt ab und A lässt ihn vorerst nicht wieder rein
      a.refuse = true;
      assert.ok(a.kick('/h') >= 1);
      await host.waitForTimeout(2600); // Neuverbindungsversuch scheitert -> nächster erst in einigen Sekunden
      a.refuse = false;
      const guest = await open('Gast');
      await guest.fill('#code', code);
      await guest.click('#btnJoin');
      // vorher: Mitspieler klopfte nur bei Server A an (der erste erreichbare) -> niemand antwortete
      await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 5000 });
      await host.waitForFunction(() => document.querySelectorAll('#plist li').length >= 2);
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    });
  } finally { a.close(); b.close(); }
});

test('Internet-Server verliert jede dritte Nachricht: Beitreten, Eingaben und Spielstart klappen trotzdem', async () => {
  // jede dritte Nachricht pro Thema geht verloren (in beide Richtungen)
  const broker = await startBroker({ drop: (topic, n) => n % 3 === 2 });
  try {
    await netPair([broker.url], async (open) => {
      const { host, code } = await hostRoom(open);
      const guest = await open('Gast');
      await guest.fill('#code', code);
      await guest.click('#btnJoin');
      await guest.waitForSelector('#lobby:not(.hidden)', { timeout: 10000 });
      const gid = await guest.evaluate(() => window.__sfTest.myId);
      assert.ok(gid, 'Mitspieler kennt seine Spieler-Nummer (sonst ist er nie dran und kann nicht zielen)');
      // viele Eingaben hintereinander: die letzte muss beim Gastgeber ankommen
      await guest.evaluate(() => { for (const camo of ['wueste', 'winter', 'oliv', 'nacht', 'wueste', 'winter']) window.__sfTest.send({ t: 'look', camo, hat: 'helm' }); });
      await host.waitForFunction((id) => { const p = window.__sfTest.hostSim.players.get(id); return p && p.look.camo === 'winter'; }, gid, { timeout: 5000 });
      await host.click('#btnStart');
      await host.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
      await guest.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
      const same = await guest.evaluate(() => window.__sfTest.guestMask());
      const hostMask = await host.evaluate(() => Array.from(window.__sfTest.hostSim.mask));
      assert.ok(same.length === hostMask.length && same.every((v, i) => v === hostMask[i]), 'gleiches Gelände');
      assert.ok(broker.stats.lost > 5, 'es gingen wirklich Nachrichten verloren');
      assert.deepEqual(host.errors, []);
      assert.deepEqual(guest.errors, []);
    });
  } finally { broker.close(); }
});

// ---------- Direktweg zusätzlich zum Internet-Server (gegen Lag) ----------
test('Mitspieler öffnet zusätzlich den Direktweg: Spiel läuft danach darüber, ohne Fehler', async () => {
  const broker = await startBroker({ delay: 40 });
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, passwordStorage());
    await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.address().port}/?relay=${broker.url}`);
    await page.waitForSelector('#menu:not(.hidden)');
    // Gastgeber und Mitspieler in derselben Seite; PeerJS durch einen Nachbau ohne Vermittlungsserver ersetzt
    await page.evaluate(() => {
      const reg = new Map();
      const ev = (o) => { o.h = {}; o.on = (e, f) => { (o.h[e] = o.h[e] || []).push(f); }; o.emit = (e, x) => { for (const f of o.h[e] || []) f(x); }; return o; };
      const dc = (meta) => ev({
        open: false, metadata: meta,
        send(b) { const o = this.other, c = new Uint8Array(b).buffer; if (this.open) setTimeout(() => o.open && o.emit('data', c), 1); },
        close() { if (!this.open) return; this.open = false; this.emit('close'); this.other.close(); },
      });
      window.Peer = class {
        constructor(id) { ev(this); this.id = id || 'p' + Math.random(); reg.set(this.id, this); setTimeout(() => this.emit('open', this.id), 5); }
        connect(id, opts) {
          const a = dc(opts.metadata), b = dc(opts.metadata); a.other = b; b.other = a;
          const target = reg.get(id);
          setTimeout(() => {
            if (!target) { this.emit('error', { type: 'peer-unavailable' }); return; }
            target.emit('connection', b);
            setTimeout(() => { a.open = b.open = true; b.emit('open'); a.emit('open'); }, 5);
          }, 5);
          return a;
        }
        destroy() { this.destroyed = true; reg.delete(this.id); }
        reconnect() {}
      };
      window.__t = { got: [] };
      window.__t.h = window.NET.host({ onReady: (code) => {
        window.__t.code = code;
        window.NET.join(code, { onReady: (c, l) => { window.__t.link = l; l.onmessage = (m) => window.__t.got.push(m); } });
      } });
    });
    await page.waitForFunction(() => window.__t.link, null, { timeout: 10000 });
    // Direktweg steht und ist der schnellste -> Gastgeber schickt darüber
    await page.waitForFunction(() => { const s = window.__t.h.stats(); return s.length === 1 && s[0].best === 'direct'; }, null, { timeout: 8000 });
    // Beitreten über den Weg klappt (Antwort kommt an)
    await page.evaluate(() => window.__t.link.send({ t: 'join', name: 'Gast' }));
    await page.waitForFunction(() => window.__t.got.some((m) => m.t === 'welcome'), null, { timeout: 5000 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); broker.close(); srv.close();
  }
});

test('Direktweg nicht möglich (kein Vermittlungsserver erreichbar): Mitspieler kommt trotzdem ins Gefecht, ohne Fehler', async () => {
  const broker = await startBroker();
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    // ohne noDirect: der Mitspieler versucht zusätzlich den Direktweg, der aber blockiert ist
    const base = `http://127.0.0.1:${srv.address().port}/?test&relay=${broker.url}`;
    const pw = passwordStorage();
    const open = async (name) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, Object.assign({ sf_name: name }, pw));
      await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
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
    await host.click('#btnStart');
    await host.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
    await guest.waitForSelector('#hud:not(.hidden)', { timeout: 10000 });
    assert.deepEqual(host.errors, []);
    assert.deepEqual(guest.errors, []);
  } finally {
    await browser.close(); broker.close(); srv.close();
  }
});
