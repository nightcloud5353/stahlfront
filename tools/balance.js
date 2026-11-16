// Balancing-Statistik: viele KI-Gefechte ohne Browser simulieren und alle Mechaniken messen.
// Ergebnisse und Vorgehen: BALANCING.md
//
// Aufruf: node tools/balance.js '<JSON-Konfig>'  (Ausgabe: JSON-Bericht)
//   levels   KI-Stufen der Teams, z. B. [3,3,3] oder [1,2,3]   (Sitzordnung wird pro Gefecht rotiert)
//   tanks    Panzer pro Team                n      Gefechte pro Karte        seed  Zufallsstartwert
//   maps     nur diese Karten, z. B. ["hoehlen"]
//   patch    Werte testweise ändern, ohne Dateien anzufassen: {"sim-base.js": [["FUEL_COST = 0.55", "FUEL_COST = 0.37"]]}
//   force    Zwangs-Experiment: die KI nimmt diese Waffe immer, wenn sie sinnvoll ist (mit ammo: {"<id>": -1})
//   nobonus  Abschuss-Bonus der KI-Bewertung abschalten (für Vergleich Schätzung/Real)
// Beispiel: node tools/balance.js '{"levels":[3,3,3],"n":5,"force":"napalm","ammo":{"napalm":-1}}'
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const cfg = Object.assign({ levels: [3, 3, 3], tanks: 1, n: 3, seed: 1, maps: null, patch: {}, ammo: {}, force: null, nobonus: false }, JSON.parse(process.argv[2] || '{}'));

class MemoryStorage { constructor() { this.m = new Map(); } getItem(k) { return this.m.has(k) ? this.m.get(k) : null; } setItem(k, v) { this.m.set(k, String(v)); } removeItem(k) { this.m.delete(k); } }
globalThis.localStorage = new MemoryStorage();
const load = (f) => {
  let src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  for (const [re, rep] of cfg.patch[f] || []) {
    const r = new RegExp(re);
    if (!r.test(src)) throw new Error('Patch passt nicht: ' + f + ' ' + re);
    src = src.replace(r, rep);
  }
  return src;
};
if (cfg.force) (cfg.patch['sim-bot.js'] = cfg.patch['sim-bot.js'] || []).push(['o\\.v \\+= gauss\\(\\) \\* noise - cost\\(o\\.w\\);', `o.v += gauss() * noise - cost(o.w) + (o.w === '${cfg.force}' && o.raw > 8 ? 200 : 0);`]);
if (cfg.nobonus) (cfg.patch['sim-bot.js'] = cfg.patch['sim-bot.js'] || []).push(['\\+ \\(a >= k\\.hp \\? 30 : 0\\)', '+ 0']);
const shared = { exports: {} };
new vm.Script(`(function(module){${load('shared.js')}})`).runInThisContext()(shared);
globalThis.SHARED = shared.exports;
for (const w of shared.exports.WEAPONS) if (cfg.ammo[w.id] !== undefined) w.ammo = cfg.ammo[w.id];
for (const f of ['sim-base.js', 'sim.js', 'sim-terrain.js', 'sim-world.js', 'sim-weapons.js', 'sim-bot.js']) new vm.Script(load(f), { filename: f }).runInThisContext();
const S = globalThis.SHARED, Sim = globalThis.StahlSim, P = Sim.prototype, BASE = globalThis.SimBase;

// ---------- Messpunkte ----------
const st = {
  games: 0, timeouts: 0, errors: 0, ticks: 0, turns: 0, sdGames: 0, winLv: {}, winSeat: {}, firstMoverWins: 0,
  use: {}, dmg: {}, dmgU: {}, self: {}, kills: {}, zero: {}, est: {}, opp: {}, oppN: 0,
  deaths: { boom: 0, drown: 0, drownSD: 0 }, fall: 0, fire: 0, barrel: 0, deathBoom: 0,
  fuel: [], fuelOut: 0, driveTurns: 0, walkCapped: 0, walks: 0,
  winch: { ok: 0, fail: 0, len: [], gain: [] }, crates: {}, cratesDropped: 0, crateDist: [], cratesLost: 0, plans: {},
  hpLeftWinner: [], turnsPerGame: [], maps: {},
};
const inc = (o, k, v = 1) => { o[k] = (o[k] || 0) + v; };
let G = null; // aktuelle Sim

const oUse = P.useWeapon;
P.useWeapon = function (w, target) {
  const g = this.g;
  this._curW = w.id;
  const lv = g.teams[g.turnTeam].bot;
  const before = { proj: new Set(g.proj), q: new Set(g.queue) };
  const r = oUse.call(this, w, target);
  if (w.id !== 'winch') {
    inc(st.use, w.id);
    g._turnW = w.id; g._turnLv = lv;
    const tag = (src) => { if (src && !src.w) src.w = w.id; };
    for (const p of g.proj) if (!before.proj.has(p)) tag(p.src);
    for (const q of g.queue) if (!before.q.has(q)) tag(q.p.src);
    if (g.burst) tag(g.burst.src);
    const plan = g.bot && g.bot.plan;
    if (plan && plan.raw !== undefined && plan.w === w.id) g._turnEst = plan.raw;
  }
  return r;
};
const oWinch = P.useWinch;
P.useWinch = function (t, team) {
  const had = this.g.winch;
  oWinch.call(this, t, team);
  if (had) return;
  if (this.g.winch) { st.winch.ok++; st.winch.len.push(Math.hypot(this.g.winch.ax - t.x, this.g.winch.ay - t.y)); this.g._winchY = t.y; this.g._winchT = t; }
  else st.winch.fail++;
};
const oUW = P.updateWinch;
P.updateWinch = function () {
  oUW.call(this);
  if (!this.g.winch && this.g._winchT) { st.winch.gain.push(this.g._winchY - this.g._winchT.y); this.g._winchT = null; }
};
const oExp = P.explode;
P.explode = function (x, y, r, d, k, kind, src) { const prev = this._expKind; this._expKind = kind; try { return oExp.call(this, x, y, r, d, k, kind, src); } finally { this._expKind = prev; } };
const oDmg = P.damage;
P.damage = function (t, amount, src) {
  if (t.alive && amount > 0) {
    const real = Math.min(t.hp, amount);
    if (!src) { if (this._expKind === 'death') st.deathBoom += real; else st.fall += real; }
    else {
      const w = src.w || this._curW || '?';
      if (this._expKind === 'barrel' || this._expKind === 'crate') st.barrel += real;
      if (this.g.phase === 'settle' && this.g.fires.length && !this._expKind) st.fire += real;
      if (t.team === src.team) inc(st.self, w, real); else { inc(st.dmgU, w, amount); inc(st.dmg, w, real); const g = this.g; if (g._turnW) g._turnDmg = (g._turnDmg || 0) + real; }
    }
  }
  return oDmg.call(this, t, amount, src);
};
const oBc = P.broadcast;
P.broadcast = function (m) {
  if (m && m.t === 'dead') {
    st.deaths[m.how === 'drown' ? 'drown' : 'boom']++;
    if (m.how === 'drown' && this.g.waterY < this.g._water0) st.deaths.drownSD++;
    const g = this.g; if (g._turnW && m.by === g.turnTeam) inc(st.kills, g._turnW);
  }
  return oBc.call(this, m);
};
const oDrop = P.dropCrate;
P.dropCrate = function () { oDrop.call(this); st.cratesDropped++; const o = this.g.objs[this.g.objs.length - 1]; const d = Math.min(...this.g.tanks.filter((k) => k.alive).map((k) => Math.abs(k.x - o.x))); st.crateDist.push(d); };
const oPick = P.pickup;
P.pickup = function (o, t) { inc(st.crates, o.content); return oPick.call(this, o, t); };
const oNext = P.nextTurn;
P.nextTurn = function () {
  const g = this.g;
  if (g && g.active && g._turnStarted) {
    const used = 100 - g.fuel;
    st.fuel.push(used); if (used > 1) st.driveTurns++; if (g.fuel <= 0.5) st.fuelOut++;
    if (g._turnW) {
      const w = g._turnW, d = g._turnDmg || 0;
      inc(st.dmg, '_turns_' + w); if (!d) inc(st.zero, w);
      if (g._turnEst !== undefined) { const e = st.est[w] || (st.est[w] = { est: 0, real: 0, n: 0 }); e.est += g._turnEst; e.real += d; e.n++; }
    }
    st.turns++;
  }
  g._turnW = null; g._turnDmg = 0; g._turnEst = undefined; g._turnStarted = true;
  return oNext.call(this);
};
const oOpt = P.botOptions;
P.botOptions = function* (ctx, team, ...rest) {
  const opts = yield* oOpt.call(this, ctx, team, ...rest);
  if (team.bot === 3) {
    st.oppN++;
    const best = {};
    for (const o of opts) if (o.raw !== undefined && (best[o.w] === undefined || o.raw > best[o.w])) best[o.w] = o.raw;
    for (const w in best) { const e = st.opp[w] || (st.opp[w] = { n: 0, sum: 0, top: 0 }); e.n++; e.sum += Math.max(0, best[w]); }
    const top = Object.keys(best).sort((a, b) => best[b] - best[a])[0];
    if (top) inc(st.opp[top], 'top');
  }
  return opts;
};
const oPlan = P.botPlan;
P.botPlan = function* (...a) { const r = yield* oPlan.apply(this, a); inc(st.plans, r.kind === 'shot' ? r.w : r.kind); return r; };
const oWalk = P.botWalk;
P.botWalk = function (x, y, dir, maxDist) { const out = oWalk.call(this, x, y, dir, maxDist); if (maxDist > 100) { st.walks++; if (out.length >= Math.floor(maxDist) - 1) st.walkCapped++; } return out; };

// ---------- Zufall + Gefechte ----------
let seedState = 0;
const rnd = () => { seedState = (seedState + 0x6D2B79F5) >>> 0; let t = seedState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
Math.random = rnd;
const origErr = console.error; console.error = (...a) => { st.errors++; if (st.errors < 3) origErr(...a); };
const maps = cfg.maps || S.MAPS.map((m) => m.id);
for (const map of maps) {
  for (let i = 0; i < cfg.n; i++) {
    seedState = (cfg.seed * 1000003 + i * 7919 + map.length * 31) >>> 0;
    const sim = new Sim(); sim.destroy(); sim.code = 'X'; G = sim;
    const conn = { send() {}, close() {} };
    sim.onConnect(conn); sim.onMessage(conn, { t: 'join', name: 'Host' });
    sim.onMessage(conn, { t: 'settings', tanks: cfg.tanks, map, theme: 0, turnTime: 30 });
    const lv = cfg.levels.slice();
    // Sitzordnung rotieren, damit kein Platz bevorzugt ist
    for (let k = 0; k < i % lv.length; k++) lv.push(lv.shift());
    for (const l of lv) sim.onMessage(conn, { t: 'addbot', level: l });
    conn.player.spec = true;
    sim.onMessage(conn, { t: 'start' });
    const g = sim.g; g._water0 = g.waterY;
    const firstTeam = g.turnTeam;
    let tk = 0;
    for (; tk < 60 * 60 * 40 && sim.phase !== 'over'; tk++) sim.step();
    st.games++; st.ticks += tk;
    if (sim.phase !== 'over') { st.timeouts++; continue; }
    if (g.waterY < g._water0) st.sdGames++;
    const rank = sim.lastOver.rank, w = g.teams[rank[0]];
    const alive = g.teams.filter((t) => t.tanks.some((k) => k.alive));
    st.turnsPerGame.push(g.turnCount);
    const ms = st.maps[map] || (st.maps[map] = { n: 0, turns: 0, sd: 0 }); ms.n++; ms.turns += g.turnCount; if (g.waterY < g._water0) ms.sd++;
    if (alive.length === 1) {
      inc(st.winLv, w.bot); inc(st.winSeat, w.idx);
      if (w.idx === firstTeam) st.firstMoverWins++;
      st.hpLeftWinner.push(w.tanks.reduce((a, k) => a + (k.alive ? k.hp : 0), 0));
    } else inc(st.winLv, 'unentschieden');
  }
}
console.error = origErr;

// ---------- Bericht ----------
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) * q)] : 0; };
const rep = {
  cfg: { levels: cfg.levels, tanks: cfg.tanks, n: cfg.n, force: cfg.force },
  spiele: st.games, timeouts: st.timeouts, fehler: st.errors,
  minutenProSpiel: +(st.ticks / st.games / 3600).toFixed(2), zuegeProSpiel: +avg(st.turnsPerGame).toFixed(1),
  hochwasserAnteil: +(st.sdGames / st.games).toFixed(2),
  karten: Object.fromEntries(Object.entries(st.maps).map(([k, v]) => [k, { zuege: +(v.turns / v.n).toFixed(1), hochwasser: +(v.sd / v.n).toFixed(2) }])),
  siegeStufe: st.winLv, siegePlatz: st.winSeat, ersterZugGewinnt: +(st.firstMoverWins / st.games).toFixed(2),
  restHpSieger: Math.round(avg(st.hpLeftWinner)),
  tode: st.deaths, schaden: { fall: st.fall, feuer: st.fire, fassKiste: st.barrel, wrackExplosion: st.deathBoom },
  treibstoff: { verbrauchMittel: +avg(st.fuel).toFixed(1), zuegeMitFahrt: +(st.driveTurns / st.turns).toFixed(2), leergefahren: st.fuelOut, fahrwegAmLimit: +(st.walkCapped / Math.max(1, st.walks)).toFixed(2) },
  seilwinde: { ok: st.winch.ok, fehl: st.winch.fail, laengeMittel: Math.round(avg(st.winch.len)), laengeP90: Math.round(pct(st.winch.len, 0.9)), hoehengewinn: Math.round(avg(st.winch.gain)) },
  kisten: Object.assign({ abgeworfen: st.cratesDropped, eingesammelt: Object.values(st.crates).reduce((a, b) => a + b, 0), abstandNaechsterPanzerMedian: Math.round(pct(st.crateDist, 0.5)), innerhalb160: +(st.crateDist.filter((d) => d < 160).length / Math.max(1, st.crateDist.length)).toFixed(2) }, st.crates), plaene: st.plans,
  waffen: {},
};
const ws = new Set([...Object.keys(st.use), ...Object.keys(st.opp)]);
for (const w of ws) {
  const n = st.use[w] || 0;
  const o = st.opp[w];
  const e = st.est[w];
  rep.waffen[w] = {
    einsatz: n, schadenProEinsatz: n ? +((st.dmg[w] || 0) / n).toFixed(1) : null, ungedeckelt: n ? +((st.dmgU[w] || 0) / n).toFixed(1) : null, eigenProEinsatz: n ? +((st.self[w] || 0) / n).toFixed(1) : null,
    fehlschussQuote: n ? +((st.zero[w] || 0) / n).toFixed(2) : null, kills: st.kills[w] || 0,
    schaetzungVsReal: e ? `${(e.est / e.n).toFixed(0)}/${(e.real / e.n).toFixed(0)}` : null,
    chanceMittel: o ? +(o.sum / o.n).toFixed(1) : null, verfuegbar: o ? +(o.n / st.oppN).toFixed(2) : null, besteOption: o ? +((o.top || 0) / o.n).toFixed(2) : null,
  };
}
console.log(JSON.stringify(rep, null, 1));
