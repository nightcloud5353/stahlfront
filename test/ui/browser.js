// Hilfen für die Browser-Tests: kleiner Webserver für das Spiel + Chromium über Playwright.
// Die Seite wird mit ?test geöffnet: dann gibt es window.__sfTest (lokales Spiel ohne Netzwerk/Passwort, siehe game.js).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };

// Geräte, auf denen die Oberfläche geprüft wird
const DEVICES = {
  pc: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  pcKlein: { viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 },
  iphone: devices['iPhone 13 landscape'],
  iphoneHoch: devices['iPhone 13'],
  ipad: devices['iPad (gen 7) landscape'],
  android: devices['Pixel 7 landscape'],
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((q, r) => {
      const rel = decodeURIComponent(q.url.split('?')[0]);
      const f = path.join(ROOT, rel === '/' ? 'index.html' : rel);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
      r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(r);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

// Startet Server + Browser einmal pro Testdatei
async function setup() {
  const srv = await serve();
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  return {
    browser,
    // Seite auf einem Gerät öffnen. storage: Werte, die vor dem Laden in localStorage stehen sollen
    async open(device, storage) {
      const ctx = await browser.newContext(DEVICES[device]);
      if (storage) await ctx.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      // keine echten Netzwerkverbindungen (Internet-Server, PeerJS)
      await ctx.route((url) => !url.href.startsWith(base), (r) => r.abort());
      await page.goto(base + '?test');
      await page.waitForFunction(() => !!window.__sfTest);
      return page;
    },
    async close() { await browser.close(); srv.close(); },
  };
}

// Lokales Spiel in die Lobby bringen (ich + KI-Gegner)
async function toLobby(page, opts) {
  const o = Object.assign({ bots: 1, look: null }, opts);
  await page.evaluate((o) => {
    window.__sfTest.localHost('Kommandant', o.look || undefined);
    for (let i = 0; i < o.bots; i++) window.__sfTest.send({ t: 'addbot', level: 2 });
    window.__sfTest.send({ t: 'settings', turnTime: 0, map: 'huegel', theme: 0, tanks: 1 });
  }, o);
  await page.waitForSelector('#lobby:not(.hidden)');
  await page.waitForFunction((n) => document.querySelectorAll('#plist li').length >= n + 1, o.bots);
}

// Gefecht starten und warten, bis ein menschlicher Spieler am Zug ist
async function toGame(page, opts) {
  await toLobby(page, opts);
  await page.evaluate(() => window.__sfTest.send({ t: 'start' }));
  await page.waitForSelector('#hud:not(.hidden)');
  await page.waitForFunction(() => {
    const g = window.__sfTest.sim.g;
    return g && g.phase === 'turn' && !g.teams[g.turnTeam].bot;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// sichtbar = vorhanden, nicht display:none/visibility:hidden und mit Fläche
async function visible(page, sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  }, sel);
}

module.exports = { setup, toLobby, toGame, visible, DEVICES };
