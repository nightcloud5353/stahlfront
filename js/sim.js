// STAHLFRONT – Spiel-Simulation. Läuft im Browser des Gastgebers und ist die einzige "Wahrheit".
(function (root) {
  'use strict';
  const S = root.SHARED;
  const { W, H, WEAPONS, PHYS } = S;
  const R = S.TANK_R;
  const G = PHYS.G;

  // ---------- Balancing ----------
  const DRIVE_MAX = 0.9;       // px/Tick Höchstgeschwindigkeit
  const DRIVE_ACC = 0.08;      // Anfahren
  const CLIMB = 4;             // max. Stufe, die ein Panzer hochfahren kann
  const FUEL_COST = 0.55;      // Treibstoff pro Tick bei voller Fahrt (100 = ca. 3 s Fahrt)
  const FALL_SAFE = 7;         // ab dieser Aufprallgeschwindigkeit gibt es Schaden
  const FALL_DMG = 3;          // Schaden pro px/Tick darüber
  const WIND_ACC = 0.03;       // Windbeschleunigung bei Wind 1.0
  const RETREAT = 2.5;         // Sekunden Rückzug nach dem Schuss
  const MAX_HP = 100;
  const SUDDEN_DEATH_ROUNDS = 7;
  const WATER_RISE = 12;
  const BARREL_R = 7;          // Treibstofffass
  const CRATE_R = 8;           // Nachschubkiste
  const CRATE_EVERY = 3;       // alle n Züge evtl. eine Kiste
  const CRATE_CHANCE = 0.65;
  const CRATE_HEAL = 25;

  // [Radius, Maximalschaden, Rückstoß]
  const BOOM = {
    shell:   [40, 48, 6.2],
    bouncer: [44, 50, 6.6],
    cluster: [28, 22, 5.0],
    bomblet: [21, 16, 4.4],
    drill:   [40, 52, 6.6],
    mine:    [34, 45, 7.0],
    strike:  [28, 22, 5.0],
    mg:      [6,  8,  1.4],
    death:   [26, 12, 4.5],
    barrel:  [40, 30, 6.5],
    crate:   [30, 20, 5.0],
  };
  // Flugverhalten der Geschosse
  const PT = {
    shell:   { wind: 1.0, impact: true },
    cluster: { wind: 0.8, impact: true },
    bomblet: { wind: 0.3, impact: true },
    strike:  { wind: 0.4, impact: true },
    drill:   { wind: 0.3, drill: true },
    bouncer: { wind: 0.3, bounce: 0.55 },
    mine:    { wind: 0.0, bounce: 0.1 },
  };

  const WMAP = {};
  WEAPONS.forEach((w) => { WMAP[w.id] = w; });

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const CIRC = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; CIRC.push([Math.cos(a), Math.sin(a)]); }

  class Sim {
    constructor() {
      this.players = new Map();
      this.nextPid = 1;
      this.hostPid = null;
      this.settings = { tanks: 2, turnTime: 30, theme: -1 };
      this.phase = 'lobby';
      this.g = null;
      this.mask = new Uint8Array(W * H);
      this.tickN = 0;
      this.acc = 0;
      this.lastStep = performance.now();
      this.interval = setInterval(() => this.loop(), 1000 / 60);
    }
    destroy() { clearInterval(this.interval); }

    // ---------- Zeitschleife (holt verpasste Ticks nach, falls der Browser bremst) ----------
    loop() {
      const now = performance.now();
      this.acc += now - this.lastStep;
      this.lastStep = now;
      let n = 0;
      while (this.acc >= 1000 / 60 && n < 30) { this.step(); this.acc -= 1000 / 60; n++; }
      if (n >= 30) this.acc = 0;
    }
    step() {
      this.tickN++;
      if (!this.g) return;
      try { this.stepGame(); } catch (e) { console.error(e); }
    }

    // ---------- Verbindungen ----------
    onConnect(conn) { conn.player = null; }
    onDisconnect(conn) {
      const p = conn.player;
      if (!p || p.conn !== conn) return;
      p.conn = null; p.connected = false;
      if (this.phase === 'lobby' && p.id !== this.hostPid) this.players.delete(p.id);
      this.broadcastLobby();
      if (this.g) this.sendMsg(`${p.name} hat die Verbindung verloren`);
    }
    onMessage(conn, m) {
      if (!m || typeof m.t !== 'string') return;
      if (m.t === 'join') return this.join(conn, m);
      const p = conn.player;
      if (!p) return;
      switch (m.t) {
        case 'settings': return this.setSettings(p, m);
        case 'start': return this.start(p);
        case 'kick': return this.kick(p, m.id);
        case 'lobby': if (p.id === this.hostPid) this.toLobby(); return;
        case 'rematch': if (p.id === this.hostPid && this.phase === 'over') this.start(p, true); return;
        default: return this.gameInput(p, m);
      }
    }

    join(conn, m) {
      const name = String(m.name || '').replace(/[<>&"]/g, '').trim().slice(0, 12) || 'Soldat';
      let p = null;
      if (m.token) for (const q of this.players.values()) if (q.token === m.token) p = q;
      if (p) {
        if (p.conn && p.conn !== conn) { try { p.conn.send({ t: 'replaced' }); p.conn.close(); } catch (e) { /* egal */ } }
        p.conn = conn; p.connected = true;
        if (this.phase === 'lobby') p.name = name;
      } else {
        const active = [...this.players.values()].filter((q) => !q.spec);
        const spec = this.phase !== 'lobby' || active.length >= S.MAX_PLAYERS;
        p = { id: this.nextPid++, token: Math.random().toString(36).slice(2) + Date.now().toString(36), name, color: spec ? -1 : this.freeColor(), conn, connected: true, spec };
        this.players.set(p.id, p);
        if (this.hostPid === null) this.hostPid = p.id;
      }
      conn.player = p;
      conn.send({ t: 'welcome', id: p.id, token: p.token, host: p.id === this.hostPid });
      this.broadcastLobby();
      if (this.g) this.sendStart(p);
    }
    freeColor() {
      const used = new Set([...this.players.values()].filter((q) => !q.spec).map((q) => q.color));
      for (let i = 0; i < S.TEAM_COLORS.length; i++) if (!used.has(i)) return i;
      return 0;
    }
    kick(p, id) {
      if (p.id !== this.hostPid || this.phase !== 'lobby' || id === this.hostPid) return;
      const q = this.players.get(id);
      if (!q) return;
      if (q.conn) { try { q.conn.send({ t: 'kicked' }); } catch (e) { /* egal */ } }
      this.players.delete(id);
      this.broadcastLobby();
    }
    setSettings(p, m) {
      if (p.id !== this.hostPid || this.phase !== 'lobby') return;
      if ([1, 2, 3, 4].includes(m.tanks)) this.settings.tanks = m.tanks;
      if ([20, 30, 45, 60].includes(m.turnTime)) this.settings.turnTime = m.turnTime;
      if (m.theme >= -1 && m.theme < S.THEMES.length) this.settings.theme = m.theme | 0;
      this.broadcastLobby();
    }
    lobbyInfo() {
      return {
        t: 'lobby', phase: this.phase, host: this.hostPid, settings: this.settings,
        players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, color: q.color, connected: q.connected, spec: q.spec })),
      };
    }
    broadcastLobby() { this.broadcast(this.lobbyInfo()); }
    broadcast(obj) { for (const q of this.players.values()) if (q.conn && q.connected) q.conn.send(obj); }
    sendMsg(text, kind) { this.broadcast({ t: 'msg', text, k: kind || '' }); }

    toLobby() {
      this.g = null; this.phase = 'lobby';
      for (const q of [...this.players.values()]) {
        if (!q.connected && q.id !== this.hostPid) { this.players.delete(q.id); continue; }
      }
      for (const q of this.players.values()) {
        if (q.spec) {
          const active = [...this.players.values()].filter((x) => !x.spec).length;
          if (active < S.MAX_PLAYERS) { q.spec = false; q.color = this.freeColor(); }
        }
      }
      this.broadcastLobby();
    }

    // ---------- Spielstart ----------
    start(p, rematch) {
      if (p.id !== this.hostPid) return;
      if (this.phase !== 'lobby' && !rematch) return;
      if (rematch) this.toLobby();
      const teamsP = [...this.players.values()].filter((q) => !q.spec && q.connected);
      if (teamsP.length < 2) { p.conn && p.conn.send({ t: 'msg', text: 'Mindestens 2 Spieler nötig', k: 'err' }); return; }
      const theme = this.settings.theme >= 0 ? this.settings.theme : Math.floor(Math.random() * S.THEMES.length);
      const g = this.g = {
        theme, teams: [], tanks: [], proj: [], queue: [], nextId: 1,
        turnTeam: -1, active: null, phase: 'turn', timer: 0, wind: 0, weapon: 'shell', fuel: 100,
        input: { l: false, r: false, u: false, d: false, pu: false, pd: false }, hold: { u: 0, d: 0, pu: 0, pd: 0 },
        driveV: 0, burst: null, turnCount: 0, waterY: H - 62, settleT: 0, waterRaised: false, out: [], fired: false, busy: true,
        objs: [], chain: [], moved: false, stats: null, crateDone: false, sinceCrate: 0,
      };
      this.phase = 'game';
      this.genTerrain();
      teamsP.forEach((q, i) => {
        const ammo = {};
        WEAPONS.forEach((w) => { ammo[w.id] = w.ammo; });
        g.teams.push({ pid: q.id, name: q.name, color: q.color, tanks: [], next: 0, ammo, lastWeapon: 'shell', idx: i, turns: 0 });
      });
      this.spawnTanks(this.settings.tanks);
      const cs = shuffle(S.CALLSIGNS.slice());
      g.tanks.forEach((t, i) => { t.cs = cs[i % cs.length]; });
      this.spawnBarrels(3 + Math.floor(rand(0, 3)));
      g.turnTeam = Math.floor(Math.random() * g.teams.length) - 1;
      g.wind = r1(rand(-0.5, 0.5));
      for (const q of this.players.values()) if (q.connected) this.sendStart(q);
      this.nextTurn();
    }

    sendStart(p) {
      if (!p.conn || !this.g) return;
      const g = this.g;
      const rle = this.rle();
      const CH = 6000;
      const parts = Math.ceil(rle.length / CH);
      for (let i = 0; i < parts; i++) p.conn.send({ t: 'terrain', i, n: parts, d: rle.slice(i * CH, (i + 1) * CH) });
      p.conn.send({
        t: 'start', W, H, theme: g.theme, wy: g.waterY, settings: this.settings,
        teams: g.teams.map((t) => ({ pid: t.pid, name: t.name, color: t.color, tanks: t.tanks.map((k) => ({ id: k.id, cs: k.cs })) })),
      });
      if (this.phase === 'over' && this.lastOver) p.conn.send(this.lastOver);
      this.sendState(true);
    }

    rle() {
      const m = this.mask, out = [];
      let cur = 0, n = 0;
      for (let i = 0; i < m.length; i++) { if (m[i] === cur) n++; else { out.push(n); cur = m[i]; n = 1; } }
      out.push(n);
      return out;
    }

    // ---------- Gelände ----------
    genTerrain() {
      const m = this.mask;
      m.fill(0);
      const base = H * 0.56;
      const amps = [150, 70, 28, 10];
      const waves = amps.map((a, i) => ({ a: a * rand(0.6, 1.1), f: ((Math.PI * 2) / W) * rand(1, 2) * Math.pow(2.3, i), p: rand(0, Math.PI * 2) }));
      const hs = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        let h = base;
        for (const w of waves) h += w.a * Math.sin(w.f * x + w.p);
        const e = Math.min(x, W - 1 - x);
        if (e < 140) { const t = (140 - e) / 140; h += t * t * 420; }
        hs[x] = clamp(h, H * 0.22, H + 10);
        for (let y = Math.max(0, Math.floor(hs[x])); y < H; y++) m[y * W + x] = 1;
      }
      // Höhlen
      const caves = 2 + Math.floor(rand(0, 3));
      for (let c = 0; c < caves; c++) {
        let x = rand(300, W - 300), y = hs[Math.floor(x)] + rand(80, 160), a = rand(0, Math.PI * 2);
        const len = Math.floor(rand(10, 22));
        for (let i = 0; i < len; i++) {
          this.carve(x, y, Math.round(rand(16, 26)));
          a += rand(-0.5, 0.5); x += Math.cos(a) * 12; y += Math.sin(a) * 7;
          y = Math.min(y, H - 120);
        }
      }
      // schwebende Felsplatten
      const isl = 1 + Math.floor(rand(0, 2));
      for (let k = 0; k < isl; k++) {
        const cx = Math.floor(rand(450, W - 450));
        const cy = hs[cx] - rand(170, 240);
        if (cy < 140) continue;
        const rx = rand(60, 110), ry = rand(16, 24);
        for (let dx = -Math.floor(rx); dx <= rx; dx++) {
          const t = 1 - (dx / rx) * (dx / rx);
          if (t <= 0) continue;
          const top = Math.floor(cy - ry * 0.35 * Math.sqrt(t)), bot = Math.floor(cy + ry * Math.sqrt(t));
          for (let y = top; y <= bot; y++) { const xx = cx + dx; if (xx >= 0 && xx < W && y >= 0 && y < H) m[y * W + xx] = 1; }
        }
      }
    }
    carve(x, y, r) {
      const cx = Math.round(x), cy = Math.round(y), m = this.mask;
      for (let dy = -r; dy <= r; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= H) continue;
        const span = Math.floor(Math.sqrt(r * r - dy * dy));
        const x0 = Math.max(0, cx - span), x1 = Math.min(W - 1, cx + span);
        if (x0 <= x1) m.fill(0, yy * W + x0, yy * W + x1 + 1);
      }
    }
    solid(x, y) {
      x = Math.floor(x); y = Math.floor(y);
      if (x < 0 || x >= W || y < 0 || y >= H) return false;
      return this.mask[y * W + x] === 1;
    }
    circleHits(x, y, r) {
      for (let i = 0; i < 16; i++) if (this.solid(x + CIRC[i][0] * r, y + CIRC[i][1] * r)) return true;
      return this.solid(x, y);
    }
    normalAt(x, y, r) {
      let nx = 0, ny = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (this.solid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
      }
      const l = Math.hypot(nx, ny);
      return l < 1e-6 ? [0, -1] : [nx / l, ny / l];
    }
    surfaceY(x) {
      for (let y = R + 2; y < H; y++) if (this.circleHits(x, y + 1, R)) return this.circleHits(x, y, R) ? null : y;
      return null;
    }
    groundBelow(x, y) {
      for (let d = -12; d <= 26; d++) if (this.solid(x, y + d)) return y + d;
      return null;
    }

    // ---------- Panzer platzieren (fair verteilt) ----------
    spawnTanks(per) {
      const g = this.g;
      const order = [];
      let prev = null;
      for (let k = 0; k < per; k++) {
        let ts = shuffle(g.teams.slice());
        if (prev && ts.length > 1 && ts[0] === prev) ts.push(ts.shift());
        for (const t of ts) order.push(t);
        prev = ts[ts.length - 1];
      }
      const n = order.length, margin = 170, span = (W - 2 * margin) / n;
      order.forEach((team, i) => {
        let pos = null;
        for (let a = 0; a < 60 && !pos; a++) {
          const spread = a < 30 ? 0.3 : 0.5;
          const x = clamp(margin + span * (i + 0.5) + rand(-span * spread, span * spread), 120, W - 120);
          const y = this.surfaceY(x);
          if (y === null || y > g.waterY - 45) continue;
          if (g.tanks.some((t) => Math.abs(t.x - x) < 70)) continue;
          pos = [x, y];
        }
        for (let a = 0; a < 200 && !pos; a++) {
          const x = rand(120, W - 120), y = this.surfaceY(x);
          if (y !== null && y < g.waterY - 45) pos = [x, y];
        }
        if (!pos) pos = [W / 2, 100];
        const t = {
          id: g.nextId++, team: team.idx, x: pos[0], y: pos[1], vx: 0, vy: 0, grounded: false, hp: MAX_HP, alive: true, drowned: false,
          face: pos[0] < W / 2 ? 1 : -1, aim: 45, power: 55, tilt: 0, bounces: 0,
        };
        g.tanks.push(t);
        team.tanks.push(t);
      });
    }

    spawnBarrels(n) {
      const g = this.g;
      for (let k = 0; k < n; k++) {
        for (let a = 0; a < 40; a++) {
          const x = rand(220, W - 220);
          if (g.tanks.some((t) => Math.abs(t.x - x) < 70) || g.objs.some((o) => Math.abs(o.x - x) < 60)) continue;
          const y = this.surfaceY(x);
          if (y === null || y > g.waterY - 40) continue;
          g.objs.push({ id: g.nextId++, kind: 'barrel', x, y: y + (R - BARREL_R), vx: 0, vy: 0, grounded: false, alive: true, r: BARREL_R, bounces: 0 });
          break;
        }
      }
    }
    dropCrate() {
      const g = this.g;
      const x = rand(160, W - 160);
      const roll = Math.random();
      const pool = ['cluster', 'drill', 'mine', 'strike', 'repair'];
      const content = roll < 0.4 ? 'heal' : pool[Math.floor(Math.random() * pool.length)];
      const sy = this.surfaceY(x);
      const y = Math.max(-30, (sy === null ? 300 : sy) - 260);
      g.objs.push({ id: g.nextId++, kind: 'crate', x, y, vx: 0, vy: 0, grounded: false, alive: true, r: CRATE_R, chute: true, content, bounces: 0 });
      this.sendMsg('Nachschub wird abgeworfen!', 'warn');
    }
    pickup(o, t) {
      const g = this.g, team = g.teams[t.team];
      o.alive = false;
      let text;
      if (o.content === 'heal') { const b = t.hp; t.hp = Math.min(MAX_HP, t.hp + CRATE_HEAL); text = `+${t.hp - b} Panzerung`; }
      else { const w = WMAP[o.content]; team.ammo[w.id] = team.ammo[w.id] < 0 ? -1 : team.ammo[w.id] + 1; text = `+1 ${w.name}`; }
      this.broadcast({ t: 'fx', k: 'pickup', id: t.id, x: r1(o.x), y: r1(o.y), text });
      this.sendMsg(`${team.name} sammelt Nachschub: ${text}`);
    }

    // ---------- Züge ----------
    nextTurn() {
      const g = this.g;
      g.turnCount++;
      g.waterRaised = false;
      g.crateDone = false;
      g.moved = false;
      g.stats = { team: -1, dmg: 0, self: 0, kills: 0 };
      const n = g.teams.length;
      let team = null;
      for (let i = 1; i <= n; i++) {
        const ti = (g.turnTeam + i) % n;
        if (g.teams[ti].tanks.some((t) => t.alive)) { g.turnTeam = ti; team = g.teams[ti]; break; }
      }
      if (!team) return this.gameOver();
      let tank = null;
      for (let k = 0; k < team.tanks.length; k++) {
        const idx = (team.next + k) % team.tanks.length;
        if (team.tanks[idx].alive) { tank = team.tanks[idx]; team.next = idx + 1; break; }
      }
      g.active = tank;
      team.turns++;
      g.stats.team = g.turnTeam;
      g.wind = r1(clamp(g.wind * 0.4 + rand(-0.7, 0.7), -1, 1));
      g.weapon = team.ammo[team.lastWeapon] !== 0 && WMAP[team.lastWeapon].from <= team.turns ? team.lastWeapon : 'shell';
      g.fuel = 100; g.driveV = 0; g.burst = null; g.fired = false;
      g.input = { l: false, r: false, u: false, d: false, pu: false, pd: false };
      g.hold = { u: 0, d: 0, pu: 0, pd: 0 };
      const pl = this.players.get(team.pid);
      const online = pl && pl.connected;
      g.timer = online ? this.settings.turnTime : 5;
      g.phase = 'turn';
      this.broadcast({ t: 'turn', team: g.turnTeam, tank: tank.id, online: !!online });
      if (!online) this.sendMsg(`${team.name} ist offline – Zug wird übersprungen`);
      this.sendState(true);
    }
    isActivePlayer(p) {
      const g = this.g;
      return g && g.active && g.teams[g.turnTeam].pid === p.id;
    }
    startSettle() {
      const g = this.g;
      if (g.phase === 'settle' || g.phase === 'over') return;
      g.phase = 'settle'; g.settleT = 0; g.driveV = 0;
      g.input = { l: false, r: false, u: false, d: false, pu: false, pd: false };
      if (g.active) { g.active.aim = Math.round(g.active.aim); g.active.power = Math.round(g.active.power); }
    }

    gameInput(p, m) {
      const g = this.g;
      if (!g || !this.isActivePlayer(p)) return;
      const t = g.active;
      const canAct = g.phase === 'turn' && t.alive;
      const canMove = (g.phase === 'turn' || g.phase === 'retreat') && t.alive;
      switch (m.t) {
        case 'in': {
          if (!canMove) return;
          const k = m.k || {};
          const prev = g.input;
          const nu = { l: !!k.l, r: !!k.r, u: !!k.u, d: !!k.d, pu: !!k.pu, pd: !!k.pd };
          if (canAct) {
            if (nu.u && !prev.u) { t.aim = clamp(Math.round(t.aim) + 1, PHYS.AIM_MIN, PHYS.AIM_MAX); g.hold.u = 0; }
            if (nu.d && !prev.d) { t.aim = clamp(Math.round(t.aim) - 1, PHYS.AIM_MIN, PHYS.AIM_MAX); g.hold.d = 0; }
            if (nu.pu && !prev.pu) { t.power = clamp(Math.round(t.power) + 1, 0, 100); g.hold.pu = 0; }
            if (nu.pd && !prev.pd) { t.power = clamp(Math.round(t.power) - 1, 0, 100); g.hold.pd = 0; }
            if ((!nu.u && prev.u) || (!nu.d && prev.d)) t.aim = Math.round(t.aim);
            if ((!nu.pu && prev.pu) || (!nu.pd && prev.pd)) t.power = Math.round(t.power);
          }
          g.input = nu;
          return;
        }
        case 'set': {
          if (!canAct) return;
          if (typeof m.aim === 'number' && isFinite(m.aim)) t.aim = clamp(Math.round(m.aim), PHYS.AIM_MIN, PHYS.AIM_MAX);
          if (typeof m.power === 'number' && isFinite(m.power)) t.power = clamp(Math.round(m.power), 0, 100);
          if (m.face === 1 || m.face === -1) t.face = m.face;
          return;
        }
        case 'weapon': {
          if (!canAct || !WMAP[m.w]) return;
          const team = g.teams[g.turnTeam];
          if (team.ammo[m.w] === 0 || WMAP[m.w].from > team.turns) return;
          g.weapon = m.w;
          return;
        }
        case 'switch': {
          // Panzer wechseln – nur solange in diesem Zug noch nichts passiert ist
          if (!canAct || g.fired || g.moved) return;
          const team = g.teams[g.turnTeam];
          const alive = team.tanks.filter((k) => k.alive);
          if (alive.length < 2) return;
          const i = alive.indexOf(t);
          const nt = alive[(i + 1) % alive.length];
          g.active = nt;
          team.next = team.tanks.indexOf(nt) + 1;
          g.input = { l: false, r: false, u: false, d: false, pu: false, pd: false };
          this.broadcast({ t: 'switched', tank: nt.id });
          this.sendState(true);
          return;
        }
        case 'fire': {
          if (!canAct) return;
          const w = WMAP[g.weapon];
          if (w.mode === 'target') return;
          this.useWeapon(w, null);
          return;
        }
        case 'target': {
          if (!canAct) return;
          const w = WMAP[g.weapon];
          if (w.mode !== 'target' || typeof m.x !== 'number' || typeof m.y !== 'number') return;
          this.useWeapon(w, { x: clamp(m.x, 0, W), y: clamp(m.y, 0, H) });
          return;
        }
        default:
      }
    }

    pivot(t) {
      const c = Math.cos(t.tilt), s = Math.sin(t.tilt);
      const px = PHYS.PIVOT_X * t.face, py = PHYS.PIVOT_Y;
      return [t.x + px * c - py * s, t.y + px * s + py * c];
    }
    aimDir(t) {
      const a = (t.aim * Math.PI) / 180;
      return [t.face * Math.cos(a), -Math.sin(a)];
    }

    useWeapon(w, target) {
      const g = this.g, t = g.active, team = g.teams[g.turnTeam];
      if (team.ammo[w.id] === 0 || w.from > team.turns) return;
      if (team.ammo[w.id] > 0) team.ammo[w.id]--;
      team.lastWeapon = w.id;
      t.aim = Math.round(t.aim); t.power = Math.round(t.power);
      g.input = { l: false, r: false, u: false, d: false, pu: false, pd: false };
      g.fired = true;
      const [px, py] = this.pivot(t);
      const [dx, dy] = this.aimDir(t);
      const mx = px + dx * PHYS.MUZZLE, my = py + dy * PHYS.MUZZLE;
      const sp = PHYS.speed(t.power);
      const shoot = (type, extra) => {
        const p = Object.assign({ id: g.nextId++, type, x: mx, y: my, vx: dx * sp, vy: dy * sp, owner: t.id, age: 0, fuse: -1 }, extra || {});
        g.proj.push(p);
        return p;
      };
      switch (w.id) {
        case 'shell': shoot('shell'); break;
        case 'bouncer': shoot('bouncer', { fuse: 180 }); break;
        case 'cluster': shoot('cluster'); break;
        case 'drill': shoot('drill', { dl: 70 }); break;
        case 'mg': g.burst = { n: 5, t: 0 }; break;
        case 'mine': {
          const p = { id: g.nextId++, type: 'mine', x: t.x - t.face * 20, y: t.y - 4, vx: -t.face * 0.6, vy: -1.2, owner: t.id, age: 0, fuse: -1, armed: false };
          g.proj.push(p);
          break;
        }
        case 'strike': {
          const n = 5;
          for (let i = 0; i < n; i++) {
            const x = target.x + (i - 2) * 30 + rand(-4, 4);
            g.queue.push({ at: this.tickN + i * 7, p: { id: 0, type: 'strike', x, y: -60, vx: -g.wind * 0.6, vy: 3, owner: -1, age: 0, fuse: -1 } });
          }
          this.broadcast({ t: 'fx', k: 'strike', x: Math.round(target.x), y: Math.round(target.y) });
          break;
        }
        case 'ram': {
          const victim = g.tanks.find((o) => o.alive && o !== t && Math.sign(o.x - t.x) === t.face && Math.abs(o.x - t.x) < 2 * R + 26 && Math.abs(o.y - t.y) < 26);
          t.vx = t.face * 3.2; t.vy = -2.2; t.grounded = false;
          if (victim) {
            victim.vx = t.face * 6.5; victim.vy = -4.5; victim.grounded = false;
            this.damage(victim, 20);
          }
          this.broadcast({ t: 'fx', k: 'ram', id: t.id, hit: !!victim });
          break;
        }
        case 'repair': {
          const before = t.hp;
          t.hp = Math.min(MAX_HP, t.hp + 30);
          this.broadcast({ t: 'fx', k: 'repair', id: t.id, a: t.hp - before });
          this.startSettle();
          return;
        }
        case 'skip':
          this.sendMsg(`${team.name} setzt aus`);
          this.startSettle();
          return;
        default:
      }
      if (w.mode === 'fire') this.broadcast({ t: 'fx', k: 'shot', w: w.id, x: r1(mx), y: r1(my), id: t.id });
      if (g.phase === 'turn') { g.phase = 'retreat'; g.timer = RETREAT; }
    }

    // ---------- Simulation pro Tick ----------
    stepGame() {
      const g = this.g;
      if (g.phase === 'over') {
        for (const t of g.tanks) this.updateTank(t);
        if (this.tickN % 6 === 0) this.sendState(false);
        return;
      }
      const act = g.active;
      if ((g.phase === 'turn' || g.phase === 'retreat') && act) {
        if (!act.alive) this.startSettle();
        else this.control(act);
      }
      // MG-Salve
      if (g.burst) {
        if (g.burst.t-- <= 0) {
          g.burst.t = 5; g.burst.n--;
          this.mgShot(act);
          if (g.burst.n <= 0) g.burst = null;
        }
      }
      // verzögerte Geschosse (Artillerie)
      if (g.queue.length) {
        const due = g.queue.filter((q) => q.at <= this.tickN);
        g.queue = g.queue.filter((q) => q.at > this.tickN);
        for (const q of due) { q.p.id = g.nextId++; g.proj.push(q.p); }
      }
      if (g.chain.length) {
        const due = g.chain.filter((c) => c.at <= this.tickN);
        g.chain = g.chain.filter((c) => c.at > this.tickN);
        for (const c of due) { const [r, d, k] = BOOM[c.kind]; this.explode(c.x, c.y, r, d, k, c.kind); }
      }
      for (const t of g.tanks) this.updateTank(t);
      for (const o of g.objs) this.updateObj(o);
      for (const p of g.proj.slice()) if (!p.dead) this.updateProj(p);
      g.proj = g.proj.filter((p) => !p.dead);
      g.objs = g.objs.filter((o) => o.alive);

      const dt = 1 / 60;
      if (g.phase === 'turn') {
        g.timer -= dt;
        if (g.timer <= 0) { g.timer = 0; if (!g.fired) this.sendMsg('Zeit abgelaufen'); this.startSettle(); }
      } else if (g.phase === 'retreat') {
        g.timer -= dt;
        if (g.timer <= 0 && !g.burst) this.startSettle();
      } else if (g.phase === 'settle') {
        g.settleT += dt;
        if ((this.stable() && g.settleT > 0.7) || g.settleT > 14) this.afterSettle();
      }
      const busy = g.proj.length > 0 || g.queue.length > 0 || g.burst || g.tanks.some((t) => t.alive && !t.grounded) || g.objs.some((o) => !o.grounded) ||
        Object.values(g.input).some(Boolean) || g.phase === 'settle';
      if (this.tickN % (busy ? 2 : 6) === 0) this.sendState(false);
    }

    control(t) {
      const g = this.g, inp = g.input;
      // Zielen / Kraft (gedrückt halten = beschleunigen)
      if (g.phase === 'turn') {
        const rate = (h) => (h < 18 ? 0 : Math.min(1.6, 0.25 + (h - 18) * 0.03));
        if (inp.u && !inp.d) { g.hold.u++; t.aim = clamp(t.aim + rate(g.hold.u), PHYS.AIM_MIN, PHYS.AIM_MAX); }
        if (inp.d && !inp.u) { g.hold.d++; t.aim = clamp(t.aim - rate(g.hold.d), PHYS.AIM_MIN, PHYS.AIM_MAX); }
        if (inp.pu && !inp.pd) { g.hold.pu++; t.power = clamp(t.power + rate(g.hold.pu), 0, 100); }
        if (inp.pd && !inp.pu) { g.hold.pd++; t.power = clamp(t.power - rate(g.hold.pd), 0, 100); }
      }
      // Fahren
      const dir = inp.l && !inp.r ? -1 : inp.r && !inp.l ? 1 : 0;
      if (dir === 0) { g.driveV = 0; return; }
      if (t.face !== dir) { t.face = dir; g.driveV = 0; }
      if (!t.grounded || g.fuel <= 0) { g.driveV = 0; return; }
      g.driveV = Math.min(DRIVE_MAX, g.driveV + DRIVE_ACC);
      const nx = t.x + dir * g.driveV;
      let moved = false;
      for (let c = 0; c <= CLIMB; c++) {
        if (!this.circleHits(nx, t.y - c, R)) { t.x = nx; t.y -= c; moved = true; break; }
      }
      if (moved) {
        g.moved = true;
        for (let d = 0; d < CLIMB + 1; d++) { if (!this.circleHits(t.x, t.y + 1, R)) t.y += 1; else break; }
        g.fuel = Math.max(0, g.fuel - FUEL_COST * (g.driveV / DRIVE_MAX));
      } else g.driveV = 0;
    }

    // gemeinsame Physik für Panzer, Fässer und Kisten
    physics(b, r, onImpact) {
      if (b.grounded && !this.circleHits(b.x, b.y + 1, r)) { b.grounded = false; b.vx = 0; b.vy = 0; }
      if (b.grounded) return;
      b.vy = Math.min(b.vy + G, b.chute ? 1.8 : 14);
      b.vx = b.chute ? this.g.wind * 0.5 : b.vx * 0.995;
      const sp = Math.hypot(b.vx, b.vy), steps = Math.max(1, Math.ceil(sp));
      for (let i = 0; i < steps; i++) {
        const nx = b.x + b.vx / steps, ny = b.y + b.vy / steps;
        if (!this.circleHits(nx, ny, r)) { b.x = nx; b.y = ny; continue; }
        const [ax, ay] = this.normalAt(nx, ny, r + 3);
        const impact = -(b.vx * ax + b.vy * ay);
        if (onImpact) onImpact(impact);
        if (ay < -0.45 || ++b.bounces > 30) { b.grounded = true; b.vx = 0; b.vy = 0; b.bounces = 0; b.chute = false; }
        else {
          const dot = b.vx * ax + b.vy * ay;
          if (dot < 0) { b.vx = (b.vx - 2 * dot * ax) * 0.3; b.vy = (b.vy - 2 * dot * ay) * 0.3; }
          else { b.x += ax; b.y += ay; }
        }
        break;
      }
    }

    updateObj(o) {
      const g = this.g;
      if (!o.alive) return;
      this.physics(o, o.r, null);
      if (o.y > g.waterY + 2) {
        o.alive = false;
        this.broadcast({ t: 'fx', k: 'splash', x: r1(o.x), y: g.waterY });
        return;
      }
      if (o.kind === 'crate') {
        const t = g.tanks.find((k) => k.alive && Math.hypot(k.x - o.x, k.y - o.y) < R + o.r + 4);
        if (t) this.pickup(o, t);
      }
    }

    updateTank(t) {
      const g = this.g;
      if (t.drowned) return;
      this.physics(t, R, (impact) => {
        if (t.alive && impact > FALL_SAFE) this.damage(t, Math.round((impact - FALL_SAFE) * FALL_DMG));
      });
      // Neigung aus dem Boden unter den Ketten
      if (t.grounded) {
        const yl = this.groundBelow(t.x - 9, t.y), yr = this.groundBelow(t.x + 9, t.y);
        const target = yl !== null && yr !== null ? clamp(Math.atan2(yr - yl, 18), -0.6, 0.6) : 0;
        t.tilt += (target - t.tilt) * 0.3;
      }
      if (t.y > g.waterY + 4) {
        t.drowned = true;
        this.broadcast({ t: 'fx', k: 'splash', x: r1(t.x), y: g.waterY, big: 1 });
        if (t.alive) {
          t.alive = false; t.hp = 0;
          this.broadcast({ t: 'dead', id: t.id, how: 'drown' });
          if (t === g.active && (g.phase === 'turn' || g.phase === 'retreat')) this.startSettle();
        }
      }
    }

    hitsTank(x, y, p) {
      for (const t of this.g.tanks) {
        if (!t.alive) continue;
        if (t.id === p.owner && p.age < 12) continue;
        if (Math.abs(t.x - x) < R + 9 && y > t.y - R - 5 && y < t.y + R + 1) return t;
      }
      for (const o of this.g.objs) {
        if (o.alive && Math.hypot(o.x - x, o.y - y) < o.r + 1) return o;
      }
      return null;
    }

    updateProj(p) {
      const g = this.g, T = PT[p.type];
      p.age++;
      if (p.fuse > 0 && --p.fuse === 0) return this.boomAt(p);
      if (p.type === 'mine') {
        if (!p.armed && p.age > 60) p.armed = true;
        if (p.armed && !p.triggered && g.tanks.some((t) => t.alive && Math.hypot(t.x - p.x, t.y - p.y) < R + 12)) {
          p.triggered = true; p.fuse = 36;
          this.broadcast({ t: 'fx', k: 'trigger', x: r1(p.x), y: r1(p.y) });
        }
      }
      if (p.drilling) {
        const sp = 2.6;
        for (let i = 0; i < 2; i++) {
          p.x += p.dx * sp / 2; p.y += p.dy * sp / 2; p.dl -= sp / 2;
          if (this.hitsTank(p.x, p.y, p)) return this.boomAt(p);
        }
        this.carve(p.x, p.y, 7);
        if (p.age % 2 === 0) this.broadcast({ t: 'carve', x: Math.round(p.x), y: Math.round(p.y), r: 7 });
        if (p.dl <= 0) return this.boomAt(p);
        if (p.y > g.waterY) { p.dead = true; this.broadcast({ t: 'fx', k: 'splash', x: r1(p.x), y: g.waterY }); }
        return;
      }
      if (p.rest) {
        if (!this.circleHits(p.x, p.y + 1.5, 3)) p.rest = false;
        else return;
      }
      p.vy += G;
      if (T.wind) p.vx += g.wind * WIND_ACC * T.wind;
      const sp = Math.hypot(p.vx, p.vy), steps = Math.max(1, Math.ceil(sp));
      for (let i = 0; i < steps; i++) {
        const nx = p.x + p.vx / steps, ny = p.y + p.vy / steps;
        if (T.impact) {
          if (this.solid(nx, ny) || this.hitsTank(nx, ny, p)) { p.x = nx; p.y = ny; return this.boomAt(p); }
        } else if (T.drill) {
          if (this.hitsTank(nx, ny, p)) { p.x = nx; p.y = ny; return this.boomAt(p); }
          if (this.solid(nx, ny)) {
            p.x = nx; p.y = ny; p.drilling = true;
            const l = Math.hypot(p.vx, p.vy) || 1;
            p.dx = p.vx / l; p.dy = p.vy / l;
            this.broadcast({ t: 'fx', k: 'drill', x: r1(p.x), y: r1(p.y) });
            return;
          }
        } else if (this.circleHits(nx, ny, 3)) {
          const [ax, ay] = this.normalAt(nx, ny, 5);
          const dot = p.vx * ax + p.vy * ay;
          if (dot < 0) {
            if (-dot > 2) this.broadcast({ t: 'fx', k: 'bounce', x: r1(nx), y: r1(ny) });
            p.vx = (p.vx - 2 * dot * ax) * T.bounce; p.vy = (p.vy - 2 * dot * ay) * T.bounce;
          } else { p.x += ax; p.y += ay; }
          if (Math.hypot(p.vx, p.vy) < 0.6 && ay < -0.3) { p.vx = 0; p.vy = 0; p.rest = true; }
          return;
        }
        p.x = nx; p.y = ny;
      }
      if (p.y > g.waterY) { p.dead = true; this.broadcast({ t: 'fx', k: 'splash', x: r1(p.x), y: g.waterY }); }
      else if (p.x < -500 || p.x > W + 500) p.dead = true;
    }

    boomAt(p) {
      p.dead = true;
      const [r, d, k] = BOOM[p.type];
      this.explode(p.x, p.y, r, d, k, p.type);
      if (p.type === 'cluster') {
        for (let i = 0; i < 5; i++) {
          this.g.proj.push({ id: this.g.nextId++, type: 'bomblet', x: p.x, y: p.y - 4, vx: rand(-2.2, 2.2), vy: rand(-5, -3), owner: -1, age: 0, fuse: -1 });
        }
      }
    }

    mgShot(t) {
      if (!t || !t.alive) return;
      const [px, py] = this.pivot(t);
      const spread = ((rand(-1.2, 1.2) + t.aim) * Math.PI) / 180;
      const dx = t.face * Math.cos(spread), dy = -Math.sin(spread);
      let x = px + dx * PHYS.MUZZLE, y = py + dy * PHYS.MUZZLE;
      const sx = x, sy = y;
      let hit = false;
      for (let i = 0; i < 900; i++) {
        x += dx; y += dy;
        if (x < 0 || x > W || y < -200 || y > H) break;
        if (this.solid(x, y) || this.hitsTank(x, y, { owner: t.id, age: 0 })) { hit = true; break; }
      }
      this.broadcast({ t: 'fx', k: 'tracer', x1: r1(sx), y1: r1(sy), x2: r1(x), y2: r1(y) });
      if (hit) { const [r, d, k] = BOOM.mg; this.explode(x, y, r, d, k, 'mg'); }
    }

    explode(x, y, r, dmg, knock, kind) {
      const g = this.g;
      this.carve(x, y, r);
      this.broadcast({ t: 'boom', x: Math.round(x), y: Math.round(y), r, k: kind });
      for (const t of g.tanks) {
        if (!t.alive) continue;
        const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy), reach = r + R;
        if (d >= reach) continue;
        const f = 1 - d / reach;
        const amount = Math.round(dmg * Math.min(1, f * 1.35));
        const nx = d > 0.5 ? dx / d : 0, ny = d > 0.5 ? dy / d : -1;
        t.vx += nx * knock * f; t.vy += ny * knock * f - 1.8 * f;
        t.grounded = false;
        if (amount > 0) this.damage(t, amount);
      }
      for (const t of g.tanks) if (!t.alive && !t.drowned) { const d = Math.hypot(t.x - x, t.y - y); if (d < r + R) t.grounded = false; }
      // Fässer und Kisten gehen hoch – leicht verzögert, damit man die Kettenreaktion sieht
      for (const o of g.objs) {
        if (!o.alive) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < r + o.r) {
          o.alive = false;
          g.chain.push({ at: this.tickN + 8, x: o.x, y: o.y, kind: o.kind });
        } else if (d < r + 30) {
          const f = 1 - d / (r + 30);
          o.grounded = false; o.chute = false;
          o.vx += ((o.x - x) / (d || 1)) * knock * f; o.vy += ((o.y - y) / (d || 1)) * knock * f - 1;
        }
      }
      for (const p of g.proj) {
        if (p.dead || PT[p.type].impact || p.drilling) continue;
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
        if (d < r + 20) {
          const f = 1 - d / (r + 20);
          p.rest = false;
          p.vx += (dx / (d || 1)) * knock * f; p.vy += (dy / (d || 1)) * knock * f - 1;
          if (p.type === 'mine' && p.armed && !p.triggered) { p.triggered = true; p.fuse = 20; }
        }
      }
    }

    damage(t, amount) {
      const g = this.g;
      if (!t.alive || amount <= 0) return;
      const real = Math.min(t.hp, amount);
      if (g.stats) { if (t.team === g.stats.team) g.stats.self += real; else g.stats.dmg += real; }
      t.hp = Math.max(0, t.hp - amount);
      this.broadcast({ t: 'dmg', id: t.id, a: amount });
      if (t === g.active && (g.phase === 'turn' || g.phase === 'retreat')) this.startSettle();
    }

    stable() {
      const g = this.g;
      if (g.queue.length || g.burst || g.chain.length) return false;
      if (g.proj.some((p) => !(p.type === 'mine' && p.rest && !p.triggered))) return false;
      if (g.objs.some((o) => o.alive && !o.grounded)) return false;
      return g.tanks.every((t) => !t.alive || t.grounded);
    }

    afterSettle() {
      const g = this.g;
      const dying = g.tanks.filter((t) => t.alive && t.hp <= 0);
      if (dying.length) {
        for (const t of dying) {
          t.alive = false;
          if (g.stats && t.team !== g.stats.team) g.stats.kills++;
          this.broadcast({ t: 'dead', id: t.id, how: 'boom' });
          const [r, d, k] = BOOM.death;
          this.explode(t.x, t.y, r, d, k, 'death');
        }
        g.settleT = 0;
        return;
      }
      // Teams, die gerade ausgeschieden sind
      for (const team of g.teams) {
        if (!g.out.includes(team.idx) && !team.tanks.some((t) => t.alive)) {
          g.out.push(team.idx);
          this.sendMsg(`${team.name} ist ausgeschieden`, 'out');
        }
      }
      // Zugbilanz
      if (g.stats && !g.stats.reported) {
        g.stats.reported = true;
        const s = g.stats, tn = g.teams[s.team];
        if (tn && (s.dmg > 0 || s.self > 0)) {
          let txt = `${tn.name}: ${s.dmg} Schaden`;
          if (s.kills) txt += ` · ${s.kills} zerstört`;
          if (s.self) txt += ` · ${s.self} Eigenschaden`;
          this.broadcast({ t: 'msg', text: txt, k: s.dmg >= 40 || s.kills ? 'good' : '' });
        }
      }
      const alive = g.teams.filter((t) => t.tanks.some((k) => k.alive));
      if (alive.length <= 1) return this.gameOver();
      // Nachschub-Abwurf
      if (!g.crateDone) {
        g.crateDone = true;
        g.sinceCrate++;
        if (g.sinceCrate >= CRATE_EVERY && Math.random() < CRATE_CHANCE && g.objs.filter((o) => o.kind === 'crate').length < 3) {
          g.sinceCrate = 0;
          this.dropCrate();
          g.settleT = 0;
          return;
        }
      }
      if (!g.waterRaised && g.turnCount >= g.teams.length * SUDDEN_DEATH_ROUNDS) {
        if (g.turnCount === g.teams.length * SUDDEN_DEATH_ROUNDS) this.sendMsg('HOCHWASSER – das Wasser steigt jede Runde!', 'warn');
        g.waterY -= WATER_RISE;
        g.waterRaised = true;
        g.settleT = 0;
        return;
      }
      this.nextTurn();
    }

    gameOver() {
      const g = this.g;
      g.phase = 'over'; this.phase = 'over';
      const alive = g.teams.filter((t) => t.tanks.some((k) => k.alive));
      const winner = alive.length === 1 ? alive[0].idx : -1;
      const rank = [];
      if (winner >= 0) rank.push(winner);
      for (let i = g.out.length - 1; i >= 0; i--) rank.push(g.out[i]);
      this.lastOver = { t: 'over', winner, rank };
      this.broadcast(this.lastOver);
      this.broadcastLobby();
      this.sendState(true);
    }

    sendState() {
      const g = this.g;
      if (!g) return;
      const team = g.teams[g.turnTeam];
      const am = team ? WEAPONS.map((w) => team.ammo[w.id]) : [];
      this.broadcast({
        t: 's', ph: g.phase, tm: Math.ceil(g.timer), tt: g.turnTeam, tb: g.active ? g.active.id : 0,
        wi: Math.round(g.wind * 10), wp: g.weapon, fu: Math.round(g.fuel), am, wy: g.waterY,
        rd: team ? team.turns : 0, sw: !g.fired && !g.moved && g.phase === 'turn' && team && team.tanks.filter((k) => k.alive).length > 1 ? 1 : 0,
        o: g.objs.map((o) => [o.id, o.kind === 'crate' ? 'c' : 'b', r1(o.x), r1(o.y), o.chute ? 1 : 0]),
        b: g.tanks.map((t) => [t.id, r1(t.x), r1(t.y), t.hp, t.face, r1(t.aim), t.alive ? 1 : 0, Math.round(t.tilt * 100), t.drowned ? 1 : 0, Math.round(t.power), t.grounded ? 1 : 0]),
        p: g.proj.map((p) => [p.id, p.type, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.fuse > 0 ? Math.ceil(p.fuse / 60) : 0, p.armed ? 1 : 0]),
      });
    }
  }

  root.StahlSim = Sim;
})(typeof self !== 'undefined' ? self : this);
