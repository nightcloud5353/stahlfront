'use strict';
// Verbindung über die Internet-Server (js/relay.js) in Node – mit nachgebauten Servern (test/ui/mqtt-broker.js).
// Prüft, dass der Spielzustand über den SCHNELLSTEN Weg läuft (Ursache für starken Lag bei Mitspielern)
// und dass ein Direktweg (WebRTC) bevorzugt wird und beim Wegfall nahtlos auf den Server zurückgefallen wird.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startBroker } = require('./ui/mqtt-broker');

const js = (f) => path.join(__dirname, '..', 'js', f);
globalThis.SHARED = globalThis.SHARED || require(js('shared.js'));
require(js('reliable.js'));
const RELAY = require(js('relay.js'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error('Zeit abgelaufen: ' + what); await wait(20); }
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

test.before(async () => {
  await RELAY.setKey(Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'));
});

// Gastgeber (mit Ersatz-Simulation) + Mitspieler über die gegebenen Server
async function pair(urls) {
  globalThis.location = { search: '?relay=' + urls.join(',') };
  const code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();
  const sim = { conns: [], got: [], onConnect(c) { this.conns.push(c); }, onMessage(c, m) { this.got.push(m); }, onDisconnect() {} };
  let hostReady = false;
  const host = RELAY.host(code, sim, { onReady: () => { hostReady = true; } });
  await until(() => hostReady, 5000, 'Gastgeber verbunden');
  let link = null;
  const guest = RELAY.join(code, { onReady: (c, l) => { link = l; }, onError: (e) => { throw new Error(e); } });
  await until(() => link && sim.conns.length, 5000, 'Mitspieler verbunden');
  const seen = [];
  link.onmessage = (m) => { if (m.t === 's') seen.push(Date.now() - m.at); };
  // Spielzustände 30x pro Sekunde (wie die Simulation bei Bewegung)
  const hc = sim.conns[0];
  let n = 0;
  const pump = setInterval(() => hc.send({ t: 's', at: Date.now(), n: n++ }), 33);
  return {
    host, guest, link, sim, seen,
    close() { clearInterval(pump); link.close(); host.close(); },
  };
}

test('zwei Internet-Server, einer langsam: Spielzustand läuft über den schnellen (vorher: über den langsamen)', async () => {
  const slow = await startBroker({ delay: 160 }), fast = await startBroker();
  const p = await pair([slow.url, fast.url]);
  try {
    await wait(3500); // Laufzeitmessung einschwingen lassen
    p.seen.length = 0;
    await wait(2000);
    assert.ok(p.seen.length > 15, 'Zustände kommen an: ' + p.seen.length);
    const lag = median(p.seen);
    assert.ok(lag < 80, `Verzögerung Gastgeber -> Mitspieler ${lag} ms (langsamer Server: 160 ms)`);
    assert.equal(p.host.stats()[0].best, fast.url);
    assert.equal(p.guest.stats().best, fast.url);
  } finally { p.close(); slow.close(); fast.close(); }
});

// Zwei verbundene Ersatz-Datenkanäle (wie PeerJS-DataConnection), Laufzeit ~2 ms
function dcPair() {
  const mk = () => {
    const h = {};
    return {
      open: true, h,
      on(ev, fn) { (h[ev] = h[ev] || []).push(fn); },
      emit(ev, x) { for (const fn of h[ev] || []) fn(x); },
      send(b) { if (!this.open) return; const other = this.other, copy = new Uint8Array(b).buffer; setTimeout(() => other.open && other.emit('data', copy), 2); },
      close() { if (!this.open) return; this.open = false; this.emit('close'); this.other.close(); },
    };
  };
  const a = mk(), b = mk(); a.other = b; b.other = a;
  return [a, b];
}

test('Direktweg: wird bevorzugt, Zustände kommen ohne Server-Bremse (30/s); fällt er weg, geht es über den Server weiter', async () => {
  const srv = await startBroker({ delay: 60 });
  const p = await pair([srv.url]);
  try {
    await wait(1500);
    const [hd, gd] = dcPair();
    assert.equal(p.host.addDirect(hd), true);
    assert.equal(p.guest.addDirect(gd), true);
    await wait(3000);
    assert.equal(p.host.stats()[0].best, 'direct');
    assert.equal(p.guest.stats().best, 'direct');
    p.seen.length = 0;
    await wait(2000);
    assert.ok(p.seen.length >= 45, `über den Direktweg jeder Zustand (30/s): ${p.seen.length} in 2 s`);
    assert.ok(median(p.seen) < 30, 'Direktweg schnell: ' + median(p.seen) + ' ms');
    // Eingaben des Mitspielers kommen an
    p.link.send({ t: 'fire' });
    await until(() => p.sim.got.some((m) => m.t === 'fire'), 2000, 'Eingabe über Direktweg');

    // Direktweg reißt ab -> weiter über den Server, nichts geht verloren
    hd.close();
    await wait(300);
    p.seen.length = 0;
    await wait(1500);
    assert.ok(p.seen.length > 10, 'nach Wegfall weiter über den Server: ' + p.seen.length);
    assert.equal(p.host.stats()[0].best, srv.url);
    p.link.send({ t: 'weapon', w: 'nuke' });
    await until(() => p.sim.got.some((m) => m.t === 'weapon'), 3000, 'Eingabe über den Server');
  } finally { p.close(); srv.close(); }
});
