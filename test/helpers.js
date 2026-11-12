// Lädt die Browser-Skripte der Simulation in Node (ohne Browser, ohne Netzwerk).
'use strict';
const path = require('node:path');

// localStorage-Ersatz: Bestenliste und Spielstand landen hier
class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const js = (f) => path.join(__dirname, '..', 'js', f);
globalThis.SHARED = require(js('shared.js'));
for (const f of ['sim-base.js', 'sim.js', 'sim-terrain.js', 'sim-world.js', 'sim-weapons.js', 'sim-bot.js']) require(js(f));

const S = globalThis.SHARED;
const Sim = globalThis.StahlSim;

// Reproduzierbarer Zufall: Math.random wird für die Dauer von fn durch einen festen Generator ersetzt
function withSeed(seed, fn) {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { return fn(); } finally { Math.random = orig; }
}

// Sim ohne eigene Zeitschleife: Tests rufen step() selbst auf
function makeSim() {
  const sim = new Sim();
  sim.destroy();
  return sim;
}

// Verbindung, die alle Nachrichten mitschreibt
function fakeConn() {
  const c = { sent: [], closed: false, send(m) { c.sent.push(m); }, close() { c.closed = true; } };
  c.last = (t) => { for (let i = c.sent.length - 1; i >= 0; i--) if (c.sent[i].t === t) return c.sent[i]; return null; };
  return c;
}

function joinPlayer(sim, name, extra) {
  const conn = fakeConn();
  sim.onConnect(conn);
  sim.onMessage(conn, Object.assign({ t: 'join', name }, extra || {}));
  return { conn, p: conn.player };
}

// Fehler, die die Sim in step() abfängt und nur ausgibt, für Tests sichtbar machen
function catchSimErrors(fn) {
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a);
  try { fn(); } finally { console.error = orig; }
  return errors;
}

module.exports = { S, Sim, withSeed, makeSim, fakeConn, joinPlayer, catchSimErrors, MemoryStorage };
