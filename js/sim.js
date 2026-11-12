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
  const BARREL_R = 7;
  const CRATE_R = 8;
  const CRATE_EVERY = 3;
  const CRATE_CHANCE = 0.65;
  const CRATE_HEAL = 25;
  const RESUME_WAIT = 25;      // Sekunden Wartezeit auf Mitspieler nach "Gefecht fortsetzen"
  const SAVE_KEY = 'sf_save';
  const BOARD_KEY = 'sf_board';

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
  const PT = {
    shell:   { wind: 1.0, impact: true },
    cluster: { wind: 0.8, impact: true },
    bomblet: { wind: 0.3, impact: true },
    strike:  { wind: 0.4, impact: true },
    drill:   { wind: 0.3, drill: true },
    bouncer: { wind: 0.3, bounce: 0.55 },
    mine:    { wind: 0.0, bounce: 0.1 },
  };
  const BOT_SKILL = {
    1: { a: 6, p: 8, wind: 0.0, think: 2.2, smart: 0.2 },
    2: { a: 2.6, p: 4, wind: 0.7, think: 1.8, smart: 0.6 },
    3: { a: 1.0, p: 1.6, wind: 1.0, think: 1.4, smart: 1.0 },
  };

  const WMAP = {};
  WEAPONS.forEach((w) => { WMAP[w.id] = w; });

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r1 = (v) => Math.round(v * 10) / 10;
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const store = {
    get(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (root.localStorage) root.localStorage.setItem(k, v); } catch (e) { /* voll/gesperrt */ } },
    del(k) { try { if (root.localStorage) root.localStorage.removeItem(k); } catch (e) { /* egal */ } },
  };
  const CIRC = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; CIRC.push([Math.cos(a), Math.sin(a)]); }
  const noInput = () => ({ l: false, r: false, u: false, d: false, pu: false, pd: false });
  const validLook = (l) => ({
    camo: S.CAMOS.some((c) => c.id === (l && l.camo)) ? l.camo : 'oliv',
    hat: S.HATS.some((h) => h.id === (l && l.hat)) ? l.hat : 'none',
  });

  class Sim {
    constructor() {
      this.players = new Map();
      this.nextPid = 1;
      this.hostPid = null;
      this.settings = { tanks: 2, turnTime: 30, theme: -1, map: 'random' };
      this.phase = 'lobby';
      this.g = null;
      this.code = null;
      this.mask = new Uint8Array(W * H); // 0 = Luft, 1 = Erde, 2 = Beton
      this.tickN = 0;
      this.acc = 0;
      this.slow = 0;
      this.lastStep = performance.now();
      this.lines = S.LINES;
      this.interval = setInterval(() => this.loop(), 1000 / 60);
    }
    destroy() { clearInterval(this.interval); }

    // ---------- Zeitschleife (holt verpasste Ticks nach; Zeitlupe bei großen Momenten) ----------
    loop() {
      const now = performance.now();
      const dt = now - this.lastStep;
      this.lastStep = now;
      this.acc += this.slow > 0 ? dt * 0.4 : dt;
      let n = 0;
      while (this.acc >= 1000 / 60 && n < 90) { this.step(); this.acc -= 1000 / 60; n++; if (this.slow > 0) this.slow--; }
      if (n >= 90) this.acc = 0;
    }
    step() {
      this.tickN++;
      if (!this.g) return;
      try { this.stepGame(); } catch (e) { console.error(e); }
    }
    slowmo(ticks) { this.slow = Math.max(this.slow, ticks); }

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
        case 'addbot': return this.addBot(p, m.level);
        case 'look': if (this.phase === 'lobby') { p.look = validLook(m); this.broadcastLobby(); } return;
        case 'lobby': if (p.id === this.hostPid) this.toLobby(); return;
        case 'rematch': if (p.id === this.hostPid && this.phase === 'over') this.start(p, true); return;
        default: return this.gameInput(p, m);
      }
    }

    join(conn, m) {
      const name = String(m.name || '').replace(/[<>&"]/g, '').trim().slice(0, 12) || 'Soldat';
      let p = null;
      if (m.token) for (const q of this.players.values()) if (q.token === m.token && !q.bot) p = q;
      if (p) {
        if (p.conn && p.conn !== conn) { try { p.conn.send({ t: 'replaced' }); p.conn.close(); } catch (e) { /* egal */ } }
        p.conn = conn; p.connected = true;
        if (this.phase === 'lobby') { p.name = name; if (m.look) p.look = validLook(m.look); }
        if (this.g) this.sendMsg(`${p.name} ist wieder da`);
      } else {
        const active = [...this.players.values()].filter((q) => !q.spec);
        const spec = this.phase !== 'lobby' || active.length >= S.MAX_PLAYERS;
        p = { id: this.nextPid++, token: Math.random().toString(36).slice(2) + Date.now().toString(36), name, color: spec ? -1 : this.freeColor(), conn, connected: true, spec, bot: 0, look: validLook(m.look) };
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
    addBot(p, level) {
      if (p.id !== this.hostPid || this.phase !== 'lobby') return;
      const active = [...this.players.values()].filter((q) => !q.spec);
      if (active.length >= S.MAX_PLAYERS) return;
      const lv = [1, 2, 3].includes(level) ? level : 2;
      const used = new Set([...this.players.values()].map((q) => q.name));
      const name = S.BOT_NAMES.find((n) => !used.has(n)) || 'KI ' + this.nextPid;
      const look = { camo: pick(S.CAMOS).id, hat: pick(['helm', 'barett', 'muetze', 'kappe']) };
      this.players.set(this.nextPid, { id: this.nextPid++, token: '', name, color: this.freeColor(), conn: null, connected: true, spec: false, bot: lv, look });
      this.broadcastLobby();
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
      if ([0, 20, 30, 45, 60].includes(m.turnTime)) this.settings.turnTime = m.turnTime; // 0 = ohne Zeitlimit (Übungsmodus)
      if (m.theme >= -1 && m.theme < S.THEMES.length) this.settings.theme = m.theme | 0;
      if (m.map === 'random' || S.MAPS.some((x) => x.id === m.map)) this.settings.map = m.map;
      this.broadcastLobby();
    }
    board() {
      try { return JSON.parse(store.get(BOARD_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    lobbyInfo() {
      const b = this.board();
      const top = Object.entries(b).map(([name, v]) => Object.assign({ name }, v)).sort((x, y) => y.w - x.w || y.dmg - x.dmg).slice(0, 8);
      return {
        t: 'lobby', phase: this.phase, host: this.hostPid, settings: this.settings, board: top,
        players: [...this.players.values()].map((q) => ({ id: q.id, name: q.name, color: q.color, connected: q.connected, spec: q.spec, bot: q.bot, look: q.look })),
      };
    }
    broadcastLobby() { this.broadcast(this.lobbyInfo()); }
    broadcast(obj) { for (const q of this.players.values()) if (q.conn && q.connected) q.conn.send(obj); }
    sendMsg(text, kind) { this.broadcast({ t: 'msg', text, k: kind || '' }); }

    toLobby() {
      this.g = null; this.phase = 'lobby'; this.slow = 0;
      store.del(SAVE_KEY);
      for (const q of [...this.players.values()]) if (!q.connected && q.id !== this.hostPid) this.players.delete(q.id);
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
      if (teamsP.length < 2) { if (p.conn) p.conn.send({ t: 'msg', text: 'Mindestens 2 Teilnehmer nötig (auch KI)', k: 'err' }); return; }
      const theme = this.settings.theme >= 0 ? this.settings.theme : Math.floor(Math.random() * S.THEMES.length);
      const map = this.settings.map === 'random' ? pick(S.MAPS).id : this.settings.map;
      const g = this.g = {
        theme, map, teams: [], tanks: [], proj: [], queue: [], nextId: 1,
        turnTeam: -1, active: null, phase: 'turn', timer: 0, wind: 0, weapon: 'shell', fuel: 100,
        input: noInput(), hold: { u: 0, d: 0, pu: 0, pd: 0 },
        driveV: 0, burst: null, turnCount: 0, waterY: H - 62, settleT: 0, waterRaised: false, out: [], fired: false,
        objs: [], chain: [], moved: false, stats: null, crateDone: false, sinceCrate: 0, bot: null, turnHit: false, sayQ: [], lastLine: {}, firedMode: '',
      };
      this.phase = 'game';
      this.genTerrain(map);
      teamsP.forEach((q, i) => {
        const ammo = {};
        WEAPONS.forEach((w) => { ammo[w.id] = w.ammo; });
        g.teams.push({
          pid: q.id, name: q.name, color: q.color, bot: q.bot, look: q.look, tanks: [], next: 0, ammo, lastWeapon: 'shell', idx: i, turns: 0,
          st: { dmg: 0, kills: 0, self: 0, drowns: 0, shots: 0, hits: 0, best: 0, far: 0 },
        });
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

    startInfo() {
      const g = this.g;
      return {
        t: 'start', W, H, theme: g.theme, map: g.map, wy: g.waterY, settings: this.settings,
        teams: g.teams.map((t) => ({ pid: t.pid, name: t.name, color: t.color, bot: t.bot, look: t.look, tanks: t.tanks.map((k) => ({ id: k.id, cs: k.cs })) })),
      };
    }
    sendStart(p) {
      if (!p.conn || !this.g) return;
      const rle = this.rle();
      const CH = 6000;
      const parts = Math.ceil(rle.length / CH);
      for (let i = 0; i < parts; i++) p.conn.send({ t: 'terrain', i, n: parts, d: rle.slice(i * CH, (i + 1) * CH) });
      p.conn.send(this.startInfo());
      if (this.phase === 'over' && this.lastOver) p.conn.send(this.lastOver);
      this.sendState();
    }

    // Lauflängen-Kodierung als Paare [Wert, Anzahl, Wert, Anzahl, …]
    rle() {
      const m = this.mask, out = [];
      let cur = m[0], n = 0;
      for (let i = 0; i < m.length; i++) { if (m[i] === cur) n++; else { out.push(cur, n); cur = m[i]; n = 1; } }
      out.push(cur, n);
      return out;
    }
    unrle(a) {
      const m = this.mask;
      let i = 0;
      for (let k = 0; k < a.length; k += 2) { m.fill(a[k], i, i + a[k + 1]); i += a[k + 1]; }
    }

    // ---------- Gelände ----------
    heights(base, amps) {
      const waves = amps.map((a, i) => ({ a: a * rand(0.6, 1.1), f: ((Math.PI * 2) / W) * rand(1, 2) * Math.pow(2.3, i), p: rand(0, Math.PI * 2) }));
      const hs = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        let h = base;
        for (const w of waves) h += w.a * Math.sin(w.f * x + w.p);
        hs[x] = h;
      }
      return hs;
    }
    edgeDrop(hs) {
      for (let x = 0; x < W; x++) {
        const e = Math.min(x, W - 1 - x);
        if (e < 140) { const t = (140 - e) / 140; hs[x] += t * t * 420; }
      }
    }
    fillHeights(hs) {
      const m = this.mask;
      for (let x = 0; x < W; x++) {
        const h = clamp(hs[x], H * 0.15, H + 10);
        for (let y = Math.max(0, Math.floor(h)); y < H; y++) m[y * W + x] = 1;
      }
    }
    worm(x, y, len, r0, r1_, maxY, stepX, stepY) {
      let a = rand(0, Math.PI * 2);
      for (let i = 0; i < len; i++) {
        this.carveRaw(x, y, Math.round(rand(r0, r1_)));
        a += rand(-0.45, 0.45); x += Math.cos(a) * (stepX || 12); y += Math.sin(a) * (stepY || 7);
        y = Math.min(y, maxY);
        x = clamp(x, 60, W - 60);
      }
    }
    rock(cx, cy, rx, ry, val) {
      const m = this.mask;
      for (let dx = -Math.floor(rx); dx <= rx; dx++) {
        const t = 1 - (dx / rx) * (dx / rx);
        if (t <= 0) continue;
        const top = Math.floor(cy - ry * 0.35 * Math.sqrt(t)), bot = Math.floor(cy + ry * Math.sqrt(t));
        for (let y = top; y <= bot; y++) { const xx = cx + dx; if (xx >= 0 && xx < W && y >= 0 && y < H) m[y * W + xx] = val || 1; }
      }
    }
    rect(x0, y0, w, h, val) {
      const m = this.mask;
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, y0 + h); y++)
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, x0 + w); x++) m[y * W + x] = val;
    }
    genTerrain(type) {
      const m = this.mask;
      m.fill(0);
      if (type === 'inseln') {
        // 4–5 Inseln mit tiefem Wasser dazwischen
        const n = 4 + Math.floor(rand(0, 2));
        const hs = new Float32Array(W).fill(H + 40);
        const span = (W - 200) / n;
        for (let i = 0; i < n; i++) {
          const cx = 100 + span * (i + 0.5) + rand(-span * 0.15, span * 0.15);
          const half = rand(span * 0.32, span * 0.42), top = rand(H * 0.38, H * 0.6);
          for (let x = Math.floor(cx - half); x <= cx + half; x++) {
            if (x < 0 || x >= W) continue;
            const t = (x - cx) / half;
            const h = top + (1 - Math.cos(t * Math.PI / 2) ** 0.6) * (H - top) * 0.9 + 18 * Math.sin(x * 0.03 + i) + 8 * Math.sin(x * 0.09);
            hs[x] = Math.min(hs[x], h);
          }
        }
        this.fillHeights(hs);
        for (let c = 0; c < 2; c++) { const x = rand(300, W - 300); const y = hs[Math.floor(x)] + rand(60, 110); if (hs[Math.floor(x)] < H * 0.7) this.worm(x, y, 8, 14, 20, H - 140); }
      } else if (type === 'bruecken') {
        // Zwei Hochebenen, dazwischen eine Schlucht mit Betonbrücken und Bunkern
        const hs = this.heights(H * 0.46, [40, 20, 8]);
        const gapL = rand(720, 800), gapR = rand(1200, 1280);
        for (let x = 0; x < W; x++) {
          if (x > gapL && x < gapR) {
            const t = Math.min(x - gapL, gapR - x);
            hs[x] = Math.max(hs[x], Math.min(H + 40, hs[x] + t * 3.2));
          }
        }
        // Felsnadel in der Mitte
        const mid = (gapL + gapR) / 2 + rand(-40, 40);
        for (let x = Math.floor(mid - 45); x < mid + 45; x++) hs[x] = Math.min(hs[x], H * 0.56 + Math.abs(x - mid) * 1.6);
        this.edgeDrop(hs);
        this.fillHeights(hs);
        // Brücken aus Beton
        const deckY = Math.floor(Math.max(hs[Math.floor(gapL - 5)], hs[Math.floor(gapR + 5)])) - 2;
        this.rect(gapL - 30, deckY, gapR - gapL + 60, 8, 2);
        for (const px of [gapL + (gapR - gapL) * 0.28, gapL + (gapR - gapL) * 0.72]) this.rect(px - 6, deckY + 8, 12, H - deckY, 2);
        // zweite, tiefere Brücke
        const deck2 = deckY + rand(140, 190);
        if (deck2 < H - 120) this.rect(gapL - 10, deck2, gapR - gapL + 20, 7, 2);
        // Bunker (Betonwände mit Dach) auf beiden Seiten
        for (const bx of [rand(260, 560), rand(1440, 1740)]) {
          const by = Math.floor(hs[Math.floor(bx)]);
          this.rect(bx - 34, by - 40, 68, 8, 2);
          this.rect(bx - 34, by - 40, 8, 30, 2);
          this.rect(bx + 26, by - 40, 8, 30, 2);
        }
        for (let c = 0; c < 2; c++) { const x = c ? rand(150, gapL - 150) : rand(gapR + 150, W - 150); this.worm(x, hs[Math.floor(x)] + rand(80, 130), 10, 15, 22, H - 120); }
      } else if (type === 'hoehlen') {
        // Dicke Erdschicht voller befahrbarer Tunnel
        const hs = this.heights(H * 0.3, [70, 35, 14, 6]);
        this.edgeDrop(hs);
        this.fillHeights(hs);
        const n = 5 + Math.floor(rand(0, 3));
        for (let c = 0; c < n; c++) {
          const x = rand(220, W - 220), y = rand(H * 0.45, H * 0.82);
          let a = rand(-0.3, 0.3) + (Math.random() < 0.5 ? 0 : Math.PI);
          let cx = x, cy = y;
          const len = Math.floor(rand(18, 34));
          for (let i = 0; i < len; i++) {
            this.carveRaw(cx, cy, Math.round(rand(24, 32)));
            a += rand(-0.25, 0.25); cx = clamp(cx + Math.cos(a) * 16, 160, W - 160); cy = clamp(cy + Math.sin(a) * 7, hs[Math.floor(cx)] + 60, H - 110);
          }
        }
        // ein paar Schächte nach oben
        for (let s = 0; s < 3; s++) {
          const x = rand(300, W - 300);
          for (let y = hs[Math.floor(x)] - 10; y < H * 0.6; y += 10) this.carveRaw(x + Math.sin(y * 0.05) * 6, y, 16);
        }
      } else {
        // Hügelland (Standard)
        const hs = this.heights(H * 0.56, [150, 70, 28, 10]);
        this.edgeDrop(hs);
        this.fillHeights(hs);
        const caves = 2 + Math.floor(rand(0, 3));
        for (let c = 0; c < caves; c++) {
          const x = rand(300, W - 300);
          this.worm(x, clamp(hs[Math.floor(x)], 0, H) + rand(80, 160), Math.floor(rand(10, 22)), 16, 26, H - 120);
        }
        const isl = 1 + Math.floor(rand(0, 2));
        for (let k = 0; k < isl; k++) {
          const cx = Math.floor(rand(450, W - 450));
          const cy = hs[cx] - rand(170, 240);
          if (cy < 140) continue;
          this.rock(cx, cy, rand(60, 110), rand(16, 24), 1);
        }
      }
    }
    // Explosionsloch: Erde im vollen Radius, Beton nur im kleineren Radius
    carve(x, y, r) {
      const cx = Math.round(x), cy = Math.round(y), m = this.mask;
      const rc = Math.round(r * PHYS.CONCRETE);
      for (let dy = -r; dy <= r; dy++) {
        const yy = cy + dy;
        if (yy < 0 || yy >= H) continue;
        const span = Math.floor(Math.sqrt(r * r - dy * dy));
        const spanC = Math.abs(dy) <= rc ? Math.floor(Math.sqrt(rc * rc - dy * dy)) : -1;
        const x0 = Math.max(0, cx - span), x1 = Math.min(W - 1, cx + span);
        const row = yy * W;
        for (let xx = x0; xx <= x1; xx++) {
          const v = m[row + xx];
          if (v === 1 || (v === 2 && Math.abs(xx - cx) <= spanC)) m[row + xx] = 0;
        }
      }
    }
    carveRaw(x, y, r) {
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
      return this.mask[y * W + x] !== 0;
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
    // alle Stellen in Spalte x, an denen ein Panzer stehen kann (Oberfläche, Höhlenböden, Brücken)
    floorsAt(x) {
      const out = [];
      for (let y = R + 2; y < this.g.waterY - 30; y++) {
        if (!this.circleHits(x, y, R) && this.circleHits(x, y + 1, R)) { out.push(y); y += R * 2; }
      }
      return out;
    }
    surfaceY(x) {
      const f = this.floorsAt(x);
      return f.length ? f[0] : null;
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
        const ts = shuffle(g.teams.slice());
        if (prev && ts.length > 1 && ts[0] === prev) ts.push(ts.shift());
        for (const t of ts) order.push(t);
        prev = ts[ts.length - 1];
      }
      const n = order.length, margin = 150, span = (W - 2 * margin) / n;
      const anyFloor = (x) => { const f = this.floorsAt(x); if (!f.length) return null; return g.map === 'hoehlen' ? pick(f) : f[0]; };
      // fester Stand: Boden direkt unter der Mitte und links/rechts kaum Höhenunterschied
      // (sonst berührt der Panzer nur eine steile Flanke und rutscht sofort ab – z. B. an Inselrändern)
      const steady = (x, y) => {
        if (!this.solid(x, y + R + 2)) return false;
        const yl = this.groundBelow(x - 9, y), yr = this.groundBelow(x + 9, y);
        return yl !== null && yr !== null && Math.abs(yl - yr) < 14;
      };
      order.forEach((team, i) => {
        let pos = null;
        for (let a = 0; a < 80 && !pos; a++) {
          const spread = a < 40 ? 0.3 : 0.5;
          const x = clamp(margin + span * (i + 0.5) + rand(-span * spread, span * spread), 110, W - 110);
          const y = anyFloor(x);
          if (y === null || y > g.waterY - 45) continue;
          if (a < 60 && (!steady(x, y) || this.normalAt(x, y + R, 6)[1] > PHYS.SLIDE_NY)) continue;
          if (g.tanks.some((t) => Math.abs(t.x - x) < 70 && Math.abs(t.y - y) < 60)) continue;
          pos = [x, y];
        }
        for (let a = 0; a < 300 && !pos; a++) {
          const x = rand(110, W - 110), y = anyFloor(x);
          if (y !== null && y < g.waterY - 45 && (a >= 200 || steady(x, y)) && !g.tanks.some((t) => Math.abs(t.x - x) < 40 && Math.abs(t.y - y) < 40)) pos = [x, y];
        }
        if (!pos) pos = [W / 2, 100];
        const t = {
          id: g.nextId++, team: team.idx, x: pos[0], y: pos[1], vx: 0, vy: 0, grounded: false, hp: MAX_HP, alive: true, drowned: false,
          face: pos[0] < W / 2 ? 1 : -1, aim: 45, power: 55, tilt: 0, bounces: 0, lastHit: -1,
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
      const pool = ['cluster', 'drill', 'mine', 'strike', 'repair'];
      const content = Math.random() < 0.4 ? 'heal' : pick(pool);
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
      this.say(t, 'pickup', 10);
      this.sendMsg(`${team.name} sammelt Nachschub: ${text}`);
    }

    // ---------- Züge ----------
    teamOnline(team) {
      if (team.bot) return true;
      const pl = this.players.get(team.pid);
      return !!(pl && pl.connected);
    }
    nextTurn() {
      const g = this.g;
      g.turnCount++;
      g.waterRaised = false;
      g.crateDone = false;
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
      g.wind = r1(clamp(g.wind * 0.4 + rand(-0.7, 0.7), -1, 1));
      this.save();
      this.beginTurn();
    }
    // Zug beginnen (auch nach "Gefecht fortsetzen")
    beginTurn() {
      const g = this.g, team = g.teams[g.turnTeam], tank = g.active;
      g.stats = { team: g.turnTeam, dmg: 0, self: 0, kills: 0 };
      g.moved = false; g.turnHit = false;
      g.weapon = team.ammo[team.lastWeapon] !== 0 && WMAP[team.lastWeapon].from <= team.turns ? team.lastWeapon : 'shell';
      g.fuel = 100; g.driveV = 0; g.burst = null; g.fired = false; g.winch = null;
      g.input = noInput();
      g.hold = { u: 0, d: 0, pu: 0, pd: 0 };
      const online = this.teamOnline(team);
      g.timer = online ? (this.settings.turnTime || Infinity) : 5;
      g.phase = 'turn';
      g.bot = team.bot ? { t: 0, plan: null, done: false } : null;
      this.broadcast({ t: 'turn', team: g.turnTeam, tank: tank.id, online });
      if (!online) this.sendMsg(`${team.name} ist offline – Zug wird übersprungen`);
      else {
        this.say(tank, tank.hp < 30 ? 'lowhp' : 'turn', 40, 0.75);
        const foes = g.tanks.filter((k) => k.alive && k.team !== tank.team);
        if (foes.length && Math.random() < 0.3) this.say(pick(foes), 'taunt', 130, undefined, g.turnTeam);
      }
      this.sendState();
    }
    isActivePlayer(p) {
      const g = this.g;
      return g && g.active && g.teams[g.turnTeam].pid === p.id && !g.teams[g.turnTeam].bot;
    }
    startSettle() {
      const g = this.g;
      if (g.phase === 'settle' || g.phase === 'over' || g.phase === 'pause') return;
      g.phase = 'settle'; g.settleT = 0; g.driveV = 0;
      g.input = noInput();
      if (g.active) { g.active.aim = Math.round(g.active.aim); g.active.power = Math.round(g.active.power); }
    }

    // Sprüche: der Gastgeber wählt aus, damit alle denselben Spruch sehen/hören
    say(t, cat, delay, chance, foe) {
      const g = this.g;
      if (!g || !t || (chance !== undefined && Math.random() > chance)) return;
      const urgent = cat === 'death' || cat === 'drown' || cat === 'win';
      if (!urgent && t.lastSay && this.tickN - t.lastSay < 70) return;
      const list = this.lines[cat];
      if (!list || !list.length) return;
      let text = pick(list);
      if (list.length > 1 && text === g.lastLine[cat]) text = pick(list.filter((x) => x !== text));
      g.lastLine[cat] = text;
      // Platzhalter: {name} = eigener Name, {gegner} = passender Gegner
      const own = g.teams[t.team];
      let foeName = foe >= 0 && g.teams[foe] ? g.teams[foe].name : null;
      if (!foeName) { const others = g.teams.filter((x) => x.idx !== t.team && x.tanks.some((k) => k.alive)); foeName = others.length ? pick(others).name : 'ihr'; }
      text = text.replace(/\{name\}/gi, own ? own.name : '').replace(/\{gegner\}/gi, foeName);
      t.lastSay = this.tickN + (delay || 0);
      if (delay) g.sayQ.push({ at: this.tickN + delay, id: t.id, text });
      else this.broadcast({ t: 'say', id: t.id, text });
    }
    gameInput(p, m) {
      if (!this.g || !this.isActivePlayer(p)) return;
      this.applyInput(m);
    }
    applyInput(m) {
      const g = this.g;
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
          if (!canAct || g.fired || g.moved) return;
          const team = g.teams[g.turnTeam];
          const alive = team.tanks.filter((k) => k.alive);
          if (alive.length < 2) return;
          const nt = alive[(alive.indexOf(t) + 1) % alive.length];
          g.active = nt;
          team.next = team.tanks.indexOf(nt) + 1;
          g.input = noInput();
          this.broadcast({ t: 'switched', tank: nt.id });
          this.sendState();
          return;
        }
        case 'fire': {
          if (!canAct || g.winch) return;
          const w = WMAP[g.weapon];
          if (w.mode === 'target') return;
          this.useWeapon(w, null);
          return;
        }
        case 'target': {
          if (!canAct || g.winch) return;
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

    // Seilwinde: Haken in Rohrrichtung, die Winde zieht den Panzer hin. Der Zug geht danach weiter.
    useWinch(t, team) {
      const g = this.g;
      if (g.winch) return;
      const [px, py] = this.pivot(t);
      const [dx, dy] = this.aimDir(t);
      let x = px + dx * PHYS.MUZZLE, y = py + dy * PHYS.MUZZLE, hit = false;
      for (let i = 0; i < PHYS.WINCH_RANGE; i += 2) {
        x += dx * 2; y += dy * 2;
        if (x < 0 || x >= W || y < 0 || y >= H) break;
        if (this.solid(x, y)) { hit = true; break; }
      }
      this.broadcast({ t: 'fx', k: 'hook', x1: r1(px), y1: r1(py), x2: r1(x), y2: r1(y), hit: hit ? 1 : 0 });
      if (!hit) { this.sendMsg('Der Haken findet keinen Halt – näher ran oder anders zielen', 'err'); return; }
      if (team.ammo.winch > 0) team.ammo.winch--;
      g.winch = { ax: x - dx * 3, ay: y - dy * 3, t: 0, stuck: 0 };
      g.moved = true;
      g.input = noInput();
      t.grounded = false; t.vx = 0; t.vy = 0;
      g.weapon = team.ammo[team.lastWeapon] !== 0 && team.lastWeapon !== 'winch' ? team.lastWeapon : 'shell';
      this.say(t, 'winch', 0, 0.7);
    }
    updateWinch() {
      const g = this.g, w = g.winch, t = g.active;
      w.t++;
      const ddx = w.ax - t.x, ddy = w.ay - t.y, d = Math.hypot(ddx, ddy);
      if (!t.alive || d < R + 5 || w.t > 220 || w.stuck > 14) {
        g.winch = null;
        // nahe einer Kante? -> auf die Kante hochziehen
        let best = null;
        for (const ox of [0, 8, -8, 16, -16, 24, -24]) {
          const x = w.ax + ox * t.face;
          for (let y = w.ay - 60; y <= w.ay + 12; y++) {
            if (!this.circleHits(x, y, R) && this.circleHits(x, y + 1, R)) {
              const dd = Math.hypot(x - t.x, y - t.y);
              if (!best || dd < best.d) best = { x, y, d: dd };
              break;
            }
          }
        }
        if (best && best.d < 75) { t.x = best.x; t.y = best.y; t.grounded = true; t.vx = 0; t.vy = 0; }
        else { t.vx = (ddx / (d || 1)) * 0.5; t.vy = 0; t.grounded = false; }
        t.safeFall = true; // Seil lässt ab: kein Fallschaden
        this.broadcast({ t: 'fx', k: 'winchEnd', id: t.id });
        return;
      }
      const sp = Math.min(3.2, 0.6 + w.t * 0.12);
      const nx = t.x + (ddx / d) * sp, ny = t.y + (ddy / d) * sp;
      if (!this.circleHits(nx, ny, R)) { t.x = nx; t.y = ny; w.stuck = 0; }
      else if (!this.circleHits(nx, t.y - 2, R)) { t.x = nx; t.y -= 2; }
      else if (!this.circleHits(t.x, ny, R)) t.y = ny;
      else w.stuck++;
      t.vx = 0; t.vy = 0; t.grounded = false;
      if (t.y > g.waterY + 4) g.winch = null;
    }

    useWeapon(w, target) {
      const g = this.g, t = g.active, team = g.teams[g.turnTeam];
      if (team.ammo[w.id] === 0 || w.from > team.turns) return;
      if (w.id === 'winch') return this.useWinch(t, team);
      if (team.ammo[w.id] > 0) team.ammo[w.id]--;
      team.lastWeapon = w.id;
      t.aim = Math.round(t.aim); t.power = Math.round(t.power);
      g.input = noInput();
      g.fired = true;
      const [px, py] = this.pivot(t);
      const [dx, dy] = this.aimDir(t);
      const mx = px + dx * PHYS.MUZZLE, my = py + dy * PHYS.MUZZLE;
      const sp = PHYS.speed(t.power);
      const src = { team: team.idx, ox: t.x, oy: t.y };
      if (w.mode === 'fire' || w.mode === 'aim' || w.mode === 'target') team.st.shots++;
      g.firedMode = w.mode;
      if (w.mode === 'fire' || w.mode === 'aim') this.say(t, 'fire', 0, 0.45);
      else if (['mine', 'strike', 'ram', 'repair'].includes(w.id)) this.say(t, w.id, 0, 0.9);
      const shoot = (type, extra) => {
        const p = Object.assign({ id: g.nextId++, type, x: mx, y: my, vx: dx * sp, vy: dy * sp, owner: t.id, age: 0, fuse: -1, src }, extra || {});
        g.proj.push(p);
        return p;
      };
      switch (w.id) {
        case 'shell': shoot('shell'); break;
        case 'bouncer': shoot('bouncer', { fuse: 180 }); break;
        case 'cluster': shoot('cluster'); break;
        case 'drill': shoot('drill', { dl: 70 }); break;
        case 'mg': g.burst = { n: 5, t: 0, src }; break;
        case 'mine': {
          g.proj.push({ id: g.nextId++, type: 'mine', x: t.x - t.face * 20, y: t.y - 4, vx: -t.face * 0.6, vy: -1.2, owner: t.id, age: 0, fuse: -1, armed: false, src });
          break;
        }
        case 'strike': {
          for (let i = 0; i < 5; i++) {
            const x = target.x + (i - 2) * 30 + rand(-4, 4);
            g.queue.push({ at: this.tickN + i * 7, p: { id: 0, type: 'strike', x, y: -60, vx: -g.wind * 0.6, vy: 3, owner: -1, age: 0, fuse: -1, src } });
          }
          this.broadcast({ t: 'fx', k: 'strike', x: Math.round(target.x), y: Math.round(target.y) });
          break;
        }
        case 'ram': {
          const victim = g.tanks.find((o) => o.alive && o !== t && Math.sign(o.x - t.x) === t.face && Math.abs(o.x - t.x) < 2 * R + 26 && Math.abs(o.y - t.y) < 26);
          t.vx = t.face * 3.2; t.vy = -2.2; t.grounded = false;
          if (victim) {
            victim.vx = t.face * 6.5; victim.vy = -4.5; victim.grounded = false;
            this.damage(victim, 20, src);
            this.broadcast({ t: 'hit', x: r1(victim.x), y: r1(victim.y), n: 1, dmg: 20, self: 0, team: team.idx });
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

    // ---------- KI-Gegner ----------
    botThink() {
      const g = this.g, team = g.teams[g.turnTeam], t = g.active, b = g.bot;
      const sk = BOT_SKILL[team.bot] || BOT_SKILL[2];
      b.t += 1 / 60;
      if (!b.plan && b.t > sk.think * 0.5) b.plan = this.botPlan(team, t, sk);
      const plan = b.plan;
      if (!plan || b.done) return;
      // sichtbar zielen: Rohr und Kraft gleiten auf den Zielwert
      if (plan.face && t.face !== plan.face) t.face = plan.face;
      if (plan.aim !== undefined) { t.aim += clamp(plan.aim - t.aim, -1.2, 1.2); t.power += clamp(plan.power - t.power, -1.5, 1.5); }
      const ready = plan.aim === undefined || (Math.abs(plan.aim - t.aim) < 0.5 && Math.abs(plan.power - t.power) < 0.6);
      if (ready && b.t > sk.think) {
        b.done = true;
        if (plan.aim !== undefined) { t.aim = plan.aim; t.power = plan.power; }
        this.applyInput({ t: 'weapon', w: plan.w });
        if (plan.w === 'strike') this.applyInput({ t: 'target', x: plan.tx, y: plan.ty });
        else this.applyInput({ t: 'fire' });
        if (!g.fired) { this.applyInput({ t: 'weapon', w: 'shell' }); this.applyInput({ t: 'fire' }); }
      }
    }
    botPlan(team, t, sk) {
      const g = this.g;
      const avail = (id) => team.ammo[id] !== 0 && WMAP[id].from <= team.turns;
      const enemies = g.tanks.filter((k) => k.alive && k.team !== t.team);
      if (!enemies.length) return { w: 'skip' };
      if (t.hp < 35 && avail('repair') && Math.random() < 0.6 * sk.smart + 0.2) return { w: 'repair' };
      const adj = enemies.find((e) => Math.sign(e.x - t.x) === t.face && Math.abs(e.x - t.x) < 2 * R + 22 && Math.abs(e.y - t.y) < 22);
      if (adj && Math.random() < 0.6) return { w: 'ram' };
      // Ziel: Rekrut nimmt den Nächsten, Elite den Schwächsten in Reichweite
      const sorted = enemies.slice().sort((a, b) => (sk.smart > 0.8 ? a.hp - b.hp : 0) + (Math.abs(a.x - t.x) - Math.abs(b.x - t.x)) * 0.05);
      const target = sorted[0];
      if (avail('strike') && Math.random() < 0.25 * sk.smart + 0.05) {
        return { w: 'strike', tx: target.x + gauss() * sk.a * 4, ty: target.y };
      }
      let w = 'shell';
      const r = Math.random();
      if (avail('cluster') && r < 0.18) w = 'cluster';
      else if (avail('drill') && r < 0.3) w = 'drill';
      // Abpraller bewusst nicht: die Flugbahn-Suche unten kennt kein Abprallen + Zünder, die KI träfe damit fast nie
      // beste Lösung suchen
      const face = target.x < t.x ? -1 : 1;
      const tt = Object.assign({}, t, { face });
      const windK = g.wind * WIND_ACC * sk.wind * (PT[w] ? PT[w].wind : 1);
      let best = null;
      for (let aim = 10; aim <= 80; aim += 4) {
        tt.aim = aim;
        const [px, py] = this.pivot(tt);
        const A = (aim * Math.PI) / 180, dx = face * Math.cos(A), dy = -Math.sin(A);
        for (let pw = 14; pw <= 100; pw += 3) {
          let x = px + dx * PHYS.MUZZLE, y = py + dy * PHYS.MUZZLE, vx = dx * PHYS.speed(pw), vy = dy * PHYS.speed(pw);
          let d = 1e9;
          for (let i = 0; i < 360; i++) {
            vy += G; vx += windK; x += vx; y += vy;
            const dd = Math.hypot(x - target.x, y - target.y);
            if (dd < d) d = dd;
            if (dd < 10 || this.solid(x, y) || y > g.waterY || x < -200 || x > W + 200) break;
          }
          const fin = Math.hypot(x - target.x, y - target.y);
          const score = fin + (fin > 60 ? 0 : 0) + (Math.hypot(x - t.x, y - t.y) < 50 ? 500 : 0);
          if (!best || score < best.s) best = { s: score, aim, pw };
        }
      }
      if (!best) return { w: 'skip' };
      // kein sauberer Bogenschuss möglich (Decke, Deckung)? -> MG auf Sicht oder Bunkerbrecher
      if (best.s > 45) {
        const [px, py] = this.pivot(Object.assign({}, t, { face }));
        const dx = target.x - px, dy = target.y - py, dist = Math.hypot(dx, dy);
        let los = dist < 700;
        for (let i = 20; los && i < dist - 12; i += 3) if (this.solid(px + (dx * i) / dist, py + (dy * i) / dist)) los = false;
        const elev = (Math.atan2(-dy, Math.abs(dx)) * 180) / Math.PI;
        if (los && elev >= PHYS.AIM_MIN && elev <= PHYS.AIM_MAX) return { w: 'mg', face, aim: clamp(elev + gauss() * sk.a * 0.5, PHYS.AIM_MIN, PHYS.AIM_MAX), power: t.power };
        if (avail('drill')) w = 'drill';
      }
      return { w, face, aim: clamp(best.aim + gauss() * sk.a, PHYS.AIM_MIN, PHYS.AIM_MAX), power: clamp(best.pw + gauss() * sk.p, 5, 100) };
    }

    // ---------- Simulation pro Tick ----------
    stepGame() {
      const g = this.g;
      const dt = 1 / 60;
      if (g.sayQ.length) {
        const due = g.sayQ.filter((q) => q.at <= this.tickN);
        g.sayQ = g.sayQ.filter((q) => q.at > this.tickN);
        for (const q of due) this.broadcast({ t: 'say', id: q.id, text: q.text });
      }
      if (g.phase === 'over') {
        for (const t of g.tanks) this.updateTank(t);
        if (this.tickN % 6 === 0) this.sendState();
        return;
      }
      if (g.phase === 'pause') {
        g.timer -= dt;
        const allBack = g.teams.every((tm) => !tm.tanks.some((k) => k.alive) || this.teamOnline(tm));
        if (allBack || g.timer <= 0) { this.sendMsg(allBack ? 'Alle wieder da – weiter geht’s!' : 'Weiter ohne fehlende Spieler', 'warn'); this.beginTurn(); }
        if (this.tickN % 15 === 0) this.sendState();
        return;
      }
      const act = g.active;
      if ((g.phase === 'turn' || g.phase === 'retreat') && act) {
        if (!act.alive) this.startSettle();
        else {
          if (g.phase === 'turn' && g.bot) this.botThink();
          this.control(act);
        }
      }
      if (g.burst) {
        if (g.burst.t-- <= 0) {
          g.burst.t = 5; g.burst.n--;
          this.mgShot(act, g.burst.src);
          if (g.burst && g.burst.n <= 0) g.burst = null;
        }
      }
      if (g.queue.length) {
        const due = g.queue.filter((q) => q.at <= this.tickN);
        g.queue = g.queue.filter((q) => q.at > this.tickN);
        for (const q of due) { q.p.id = g.nextId++; g.proj.push(q.p); }
      }
      if (g.chain.length) {
        const due = g.chain.filter((c) => c.at <= this.tickN);
        g.chain = g.chain.filter((c) => c.at > this.tickN);
        for (const c of due) { const [r, d, k] = BOOM[c.kind]; this.explode(c.x, c.y, r, d, k, c.kind, c.src); }
      }
      if (g.winch && g.active) this.updateWinch();
      for (const t of g.tanks) this.updateTank(t);
      for (const o of g.objs) this.updateObj(o);
      for (const p of g.proj.slice()) if (!p.dead) this.updateProj(p);
      g.proj = g.proj.filter((p) => !p.dead);
      g.objs = g.objs.filter((o) => o.alive);

      if (g.phase === 'turn') {
        const before = g.timer;
        g.timer -= dt;
        if (before > 5 && g.timer <= 5 && !g.fired && act) this.say(act, 'hurry', 0, 0.5);
        if (g.timer <= 0) { g.timer = 0; if (!g.fired) this.sendMsg('Zeit abgelaufen'); this.startSettle(); }
      } else if (g.phase === 'retreat') {
        g.timer -= dt;
        if (g.timer <= 0 && !g.burst) this.startSettle();
      } else if (g.phase === 'settle') {
        g.settleT += dt;
        if ((this.stable() && g.settleT > 0.7) || g.settleT > 14) this.afterSettle();
      }
      const busy = g.proj.length > 0 || g.queue.length > 0 || g.burst || g.tanks.some((t) => t.alive && !t.grounded) || g.objs.some((o) => !o.grounded) ||
        Object.values(g.input).some(Boolean) || g.phase === 'settle' || (g.bot && g.bot.plan && !g.bot.done);
      if (this.tickN % (busy ? 2 : 6) === 0) this.sendState();
    }

    control(t) {
      const g = this.g, inp = g.input;
      if (g.winch) return;
      if (g.phase === 'turn') {
        const rate = (h) => (h < 18 ? 0 : Math.min(1.6, 0.25 + (h - 18) * 0.03));
        if (inp.u && !inp.d) { g.hold.u++; t.aim = clamp(t.aim + rate(g.hold.u), PHYS.AIM_MIN, PHYS.AIM_MAX); }
        if (inp.d && !inp.u) { g.hold.d++; t.aim = clamp(t.aim - rate(g.hold.d), PHYS.AIM_MIN, PHYS.AIM_MAX); }
        if (inp.pu && !inp.pd) { g.hold.pu++; t.power = clamp(t.power + rate(g.hold.pu), 0, 100); }
        if (inp.pd && !inp.pu) { g.hold.pd++; t.power = clamp(t.power - rate(g.hold.pd), 0, 100); }
      }
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

    physics(b, r, onImpact, grip) {
      if (b.grounded && !this.circleHits(b.x, b.y + 1, r)) { b.grounded = false; b.vx = 0; b.vy = 0; }
      // zu steil? -> abrutschen (außer der Panzer fährt gerade selbst: die Ketten greifen)
      if (b.grounded && !grip && (this.tickN + (b.id || 0)) % 4 === 0) {
        const [, ny] = this.normalAt(b.x, b.y + r, 6);
        if (ny > PHYS.SLIDE_NY) { b.grounded = false; b.vx = 0; b.vy = 0; b.sliding = 0; }
      }
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
        const dot0 = b.vx * ax + b.vy * ay;
        if (ay < PHYS.SLIDE_NY || ++b.bounces > 60) { b.grounded = true; b.vx = 0; b.vy = 0; b.bounces = 0; b.chute = false; }
        else if (ay < -0.05 && impact < 3) {
          // steiler Hang: entlang der Oberfläche abrutschen statt abprallen
          if (dot0 < 0) { b.vx -= dot0 * ax; b.vy -= dot0 * ay; }
          b.vx *= 0.97; b.vy *= 0.97;
          b.x += ax * 0.5; b.y += ay * 0.5;
        } else {
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
      if (g.winch && t === g.active) { /* wird gerade von der Seilwinde gezogen */ } else this.physics(t, R, (impact) => {
        if (t.safeFall) return;
        if (t.alive && impact > FALL_SAFE) this.damage(t, Math.round((impact - FALL_SAFE) * FALL_DMG), null);
      }, t === g.active && g.input && (g.input.l || g.input.r));
      if (t.grounded && t.safeFall) t.safeFall = false;
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
          const by = t.lastHit >= 0 && t.lastHit !== t.team ? t.lastHit : (g.turnTeam !== t.team ? g.turnTeam : -1);
          if (by >= 0) { g.teams[by].st.kills++; g.teams[by].st.drowns++; if (g.stats && g.stats.team === by) g.stats.kills++; }
          this.broadcast({ t: 'dead', id: t.id, how: 'drown', by });
          this.say(t, 'drown', 0, 1, by);
          this.slowmo(55);
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
          p.x += (p.dx * sp) / 2; p.y += (p.dy * sp) / 2; p.dl -= sp / 2;
          if (this.hitsTank(p.x, p.y, p)) return this.boomAt(p);
        }
        this.carveRaw(p.x, p.y, 7);
        if (p.age % 2 === 0) this.broadcast({ t: 'carve', x: Math.round(p.x), y: Math.round(p.y), r: 7, raw: 1 });
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
      // Bunkerbrecher zerstört auch Beton im vollen Radius
      if (p.type === 'drill') {
        const rr = Math.round(r * 0.7);
        this.carveRaw(p.x, p.y, rr);
        this.broadcast({ t: 'carve', x: Math.round(p.x), y: Math.round(p.y), r: rr, raw: 1 });
      }
      this.explode(p.x, p.y, r, d, k, p.type, p.src);
      if (p.type === 'cluster') {
        for (let i = 0; i < 5; i++) {
          this.g.proj.push({ id: this.g.nextId++, type: 'bomblet', x: p.x, y: p.y - 4, vx: rand(-2.2, 2.2), vy: rand(-5, -3), owner: -1, age: 0, fuse: -1, src: p.src });
        }
      }
    }

    mgShot(t, src) {
      if (!t || !t.alive) return;
      const [px, py] = this.pivot(t);
      const spread = ((rand(-1.2, 1.2) + t.aim) * Math.PI) / 180;
      const dx = t.face * Math.cos(spread), dy = -Math.sin(spread);
      let x = px + dx * PHYS.MUZZLE, y = py + dy * PHYS.MUZZLE;
      const sx = x, sy = y;
      let hit = false, target = null;
      for (let i = 0; i < 900; i++) {
        x += dx; y += dy;
        if (x < 0 || x > W || y < -200 || y > H) break;
        if (this.solid(x, y)) { hit = true; break; }
        target = this.hitsTank(x, y, { owner: t.id, age: 0 });
        if (target) { hit = true; break; }
      }
      this.broadcast({ t: 'fx', k: 'tracer', x1: r1(sx), y1: r1(sy), x2: r1(x), y2: r1(y) });
      if (!hit) return;
      const [r, d, k] = BOOM.mg;
      if (target && target.cs !== undefined && target.alive) {
        // direkter Treffer: voller Schaden + kleiner Stoß (die Mini-Explosion allein erreicht die Panzermitte nicht)
        target.vx += dx * k; target.vy += dy * k - 0.6; target.grounded = false;
        this.carve(x, y, r);
        this.broadcast({ t: 'boom', x: Math.round(x), y: Math.round(y), r, k: 'mg' });
        this.damage(target, d, src);
        if (src && target.team !== src.team) {
          const st = this.g.teams[src.team].st, dist = Math.hypot(target.x - src.ox, target.y - src.oy);
          if (dist > st.far) st.far = Math.round(dist);
        }
      } else this.explode(x, y, r, d, k, 'mg', src);
    }

    explode(x, y, r, dmg, knock, kind, src) {
      const g = this.g;
      this.carve(x, y, r);
      this.broadcast({ t: 'boom', x: Math.round(x), y: Math.round(y), r, k: kind });
      let n = 0, total = 0, self = 0, victim = null;
      for (const t of g.tanks) {
        if (!t.alive) continue;
        const dx = t.x - x, dy = t.y - y, d = Math.hypot(dx, dy), reach = r + R;
        if (d >= reach) continue;
        const f = 1 - d / reach;
        const amount = Math.round(dmg * Math.min(1, f * 1.35));
        const nx = d > 0.5 ? dx / d : 0, ny = d > 0.5 ? dy / d : -1;
        t.vx += nx * knock * f; t.vy += ny * knock * f - 1.8 * f;
        t.grounded = false;
        if (amount > 0) {
          const real = Math.min(t.hp, amount);
          this.damage(t, amount, src);
          if (src) {
            if (t.team === src.team) self += real;
            else {
              n++; total += real;
              if (!victim) victim = t;
              const dist = Math.hypot(t.x - src.ox, t.y - src.oy);
              const st = g.teams[src.team].st;
              if (dist > st.far) st.far = Math.round(dist);
            }
          }
        }
      }
      if (src && (n > 0 || self >= 15) && kind !== 'mg') {
        this.broadcast({ t: 'hit', x: Math.round(x), y: Math.round(y), n, dmg: total, self, team: src.team });
        if (total >= 40 || n >= 2) this.slowmo(40);
      }
      if (src) {
        const shooter = g.active && g.active.team === src.team ? g.active : null;
        if (victim) { this.say(victim, total >= 35 ? 'hurtbig' : 'hurt', 12, 0.8, src.team); this.say(shooter, 'hit', 40, 0.6, victim.team); }
        else if (self >= 15) this.say(shooter, 'self', 25, 0.9);
      }
      for (const t of g.tanks) if (!t.alive && !t.drowned) { const d = Math.hypot(t.x - x, t.y - y); if (d < r + R) t.grounded = false; }
      for (const o of g.objs) {
        if (!o.alive) continue;
        const d = Math.hypot(o.x - x, o.y - y);
        if (d < r + o.r) {
          o.alive = false;
          g.chain.push({ at: this.tickN + 8, x: o.x, y: o.y, kind: o.kind, src });
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

    // src = Verursacher {team, ox, oy}; ohne src zählt der Spieler, der gerade am Zug ist
    damage(t, amount, src) {
      const g = this.g;
      if (!t.alive || amount <= 0) return;
      const real = Math.min(t.hp, amount);
      const by = src ? src.team : (g.phase !== 'pause' ? g.turnTeam : -1);
      if (by >= 0) {
        const st = g.teams[by].st;
        if (t.team === by) st.self += real;
        else {
          st.dmg += real; t.lastHit = by;
          if (g.stats && g.stats.team === by && !g.turnHit) { g.turnHit = true; st.hits++; }
        }
      }
      if (g.stats) { if (t.team === g.stats.team) g.stats.self += real; else g.stats.dmg += real; }
      t.hp = Math.max(0, t.hp - amount);
      this.broadcast({ t: 'dmg', id: t.id, a: amount });
      if (t === g.active && (g.phase === 'turn' || g.phase === 'retreat')) this.startSettle();
    }

    stable() {
      const g = this.g;
      if (g.queue.length || g.burst || g.chain.length || g.winch) return false;
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
          const by = t.lastHit >= 0 && t.lastHit !== t.team ? t.lastHit : -1;
          if (by >= 0) g.teams[by].st.kills++;
          if (g.stats && by === g.stats.team) g.stats.kills++;
          this.broadcast({ t: 'dead', id: t.id, how: 'boom', by });
          this.say(t, 'death', 0, 1, by);
          const [r, d, k] = BOOM.death;
          this.explode(t.x, t.y, r, d, k, 'death', null);
        }
        this.slowmo(60);
        g.settleT = 0;
        return;
      }
      for (const team of g.teams) {
        if (!g.out.includes(team.idx) && !team.tanks.some((t) => t.alive)) {
          g.out.push(team.idx);
          this.sendMsg(`${team.name} ist ausgeschieden`, 'out');
        }
      }
      if (g.stats && !g.stats.reported) {
        g.stats.reported = true;
        const s = g.stats, tn = g.teams[s.team];
        if (tn) {
          if (s.dmg > tn.st.best) tn.st.best = s.dmg;
          if (g.fired && s.dmg === 0 && s.self === 0 && (g.firedMode === 'fire' || g.firedMode === 'target') && g.active && g.active.alive) this.say(g.active, 'miss', 0, 0.6);
          if (s.dmg > 0 || s.self > 0) {
            let txt = `${tn.name}: ${s.dmg} Schaden`;
            if (s.kills) txt += ` · ${s.kills} zerstört`;
            if (s.self) txt += ` · ${s.self} Eigenschaden`;
            this.broadcast({ t: 'msg', text: txt, k: s.dmg >= 40 || s.kills ? 'good' : '' });
          }
        }
      }
      const alive = g.teams.filter((t) => t.tanks.some((k) => k.alive));
      if (alive.length <= 1) return this.gameOver();
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

    // ---------- Spielende: Auszeichnungen + Bestenliste ----------
    gameOver() {
      const g = this.g;
      g.phase = 'over'; this.phase = 'over';
      const alive = g.teams.filter((t) => t.tanks.some((k) => k.alive));
      const winner = alive.length === 1 ? alive[0].idx : -1;
      const rank = [];
      if (winner >= 0) rank.push(winner);
      for (let i = g.out.length - 1; i >= 0; i--) rank.push(g.out[i]);
      for (const t of g.teams) if (!rank.includes(t.idx)) rank.push(t.idx);
      const top = (key, min) => {
        let best = null;
        for (const t of g.teams) if (t.st[key] >= (min || 1) && (!best || t.st[key] > best.st[key])) best = t;
        return best;
      };
      const awards = [];
      const add = (title, t, text) => { if (t) awards.push({ title, team: t.idx, text }); };
      add('Meisterschütze', top('dmg'), (t) => `${t.st.dmg} Schaden`);
      add('Volltreffer', top('best', 30), (t) => `${t.st.best} Schaden in einem Zug`);
      add('Scharfschütze', top('far', 300), (t) => `Treffer aus ${Math.round(t.st.far / 5)} m`);
      add('Bademeister', top('drowns'), (t) => `${t.st.drowns}× Gegner versenkt`);
      add('Eigentor-König', top('self', 20), (t) => `${t.st.self} Schaden an sich selbst`);
      for (const a of awards) a.text = a.text(g.teams[a.team]);
      const stats = g.teams.map((t) => ({ dmg: t.st.dmg, kills: t.st.kills, shots: t.st.shots, hits: t.st.hits, acc: t.st.shots ? Math.round((t.st.hits / t.st.shots) * 100) : 0 }));
      // Bestenliste über mehrere Abende (beim Gastgeber gespeichert)
      const b = this.board();
      for (const t of g.teams) {
        const key = t.bot ? `${t.name} (KI)` : t.name;
        const e = b[key] || { w: 0, g: 0, dmg: 0, k: 0 };
        e.g++; e.dmg += t.st.dmg; e.k += t.st.kills;
        if (t.idx === winner) e.w++;
        b[key] = e;
      }
      store.set(BOARD_KEY, JSON.stringify(b));
      store.del(SAVE_KEY);
      this.lastOver = { t: 'over', winner, rank, awards, stats };
      if (winner >= 0) { const wt = g.teams[winner].tanks.find((k) => k.alive); if (wt) this.say(wt, 'win'); }
      this.broadcast(this.lastOver);
      this.broadcastLobby();
      this.sendState();
    }

    // ---------- Spielstand speichern / fortsetzen ----------
    save() {
      const g = this.g;
      if (!g || !this.code) return;
      const tankKeys = ['id', 'team', 'x', 'y', 'hp', 'alive', 'drowned', 'face', 'aim', 'power', 'tilt', 'cs', 'lastHit'];
      const data = {
        v: 1, code: this.code, at: Date.now(), settings: this.settings, nextPid: this.nextPid, hostPid: this.hostPid,
        players: [...this.players.values()].map((q) => ({ id: q.id, token: q.token, name: q.name, color: q.color, spec: q.spec, bot: q.bot, look: q.look })),
        mask: this.rle(),
        g: {
          theme: g.theme, map: g.map, nextId: g.nextId, turnTeam: g.turnTeam, activeId: g.active.id, wind: g.wind, turnCount: g.turnCount,
          waterY: g.waterY, out: g.out, sinceCrate: g.sinceCrate,
          teams: g.teams.map((t) => ({ pid: t.pid, name: t.name, color: t.color, bot: t.bot, look: t.look, next: t.next, ammo: t.ammo, lastWeapon: t.lastWeapon, idx: t.idx, turns: t.turns, st: t.st, tankIds: t.tanks.map((k) => k.id) })),
          tanks: g.tanks.map((t) => { const o = {}; for (const k of tankKeys) o[k] = t[k]; return o; }),
          objs: g.objs.filter((o) => o.alive).map((o) => ({ id: o.id, kind: o.kind, x: o.x, y: o.y, r: o.r, content: o.content })),
          mines: g.proj.filter((p) => p.type === 'mine').map((p) => ({ id: p.id, x: p.x, y: p.y, owner: p.owner, armed: p.armed, src: p.src })),
        },
      };
      store.set(SAVE_KEY, JSON.stringify(data));
    }
    static loadSave() {
      try {
        const d = JSON.parse(store.get(SAVE_KEY) || 'null');
        if (!d || d.v !== 1 || Date.now() - d.at > 6 * 3600 * 1000) return null;
        return d;
      } catch (e) { return null; }
    }
    static clearSave() { store.del(SAVE_KEY); }
    restore(d) {
      this.code = d.code;
      this.settings = d.settings;
      this.nextPid = d.nextPid;
      this.hostPid = d.hostPid;
      this.players = new Map();
      for (const q of d.players) this.players.set(q.id, Object.assign({}, q, { conn: null, connected: !!q.bot }));
      this.unrle(d.mask);
      const s = d.g;
      const g = this.g = {
        theme: s.theme, map: s.map, teams: [], tanks: [], proj: [], queue: [], nextId: s.nextId,
        turnTeam: s.turnTeam, active: null, phase: 'pause', timer: RESUME_WAIT, wind: s.wind, weapon: 'shell', fuel: 100,
        input: noInput(), hold: { u: 0, d: 0, pu: 0, pd: 0 },
        driveV: 0, burst: null, turnCount: s.turnCount, waterY: s.waterY, settleT: 0, waterRaised: false, out: s.out, fired: false,
        objs: [], chain: [], moved: false, stats: null, crateDone: false, sinceCrate: s.sinceCrate, bot: null, turnHit: false, sayQ: [], lastLine: {}, firedMode: '',
      };
      const byId = {};
      for (const t of s.tanks) { const k = Object.assign({ vx: 0, vy: 0, grounded: false, bounces: 0 }, t); g.tanks.push(k); byId[k.id] = k; }
      for (const t of s.teams) g.teams.push(Object.assign({}, t, { tanks: t.tankIds.map((id) => byId[id]) }));
      g.active = byId[s.activeId];
      for (const o of s.objs) g.objs.push(Object.assign({ vx: 0, vy: 0, grounded: false, alive: true, bounces: 0 }, o));
      for (const p of s.mines) g.proj.push({ id: p.id, type: 'mine', x: p.x, y: p.y, vx: 0, vy: 0, owner: p.owner, age: 100, fuse: -1, armed: p.armed, src: p.src });
      this.phase = 'game';
    }

    sendState() {
      const g = this.g;
      if (!g) return;
      const team = g.teams[g.turnTeam];
      const am = team ? WEAPONS.map((w) => team.ammo[w.id]) : [];
      this.broadcast({
        t: 's', ph: g.phase, tm: g.timer === Infinity ? -1 : Math.ceil(g.timer), tt: g.turnTeam, tb: g.active ? g.active.id : 0,
        wi: Math.round(g.wind * 10), wp: g.weapon, fu: Math.round(g.fuel), am, wy: g.waterY, sl: this.slow > 0 ? 1 : 0,
        rd: team ? team.turns : 0, wn: g.winch ? [r1(g.winch.ax), r1(g.winch.ay)] : 0, sw: !g.fired && !g.moved && g.phase === 'turn' && team && !team.bot && team.tanks.filter((k) => k.alive).length > 1 ? 1 : 0,
        o: g.objs.map((o) => [o.id, o.kind === 'crate' ? 'c' : 'b', r1(o.x), r1(o.y), o.chute ? 1 : 0]),
        b: g.tanks.map((t) => [t.id, r1(t.x), r1(t.y), t.hp, t.face, r1(t.aim), t.alive ? 1 : 0, Math.round(t.tilt * 100), t.drowned ? 1 : 0, Math.round(t.power), t.grounded ? 1 : 0]),
        p: g.proj.map((p) => [p.id, p.type, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.fuse > 0 ? Math.ceil(p.fuse / 60) : 0, p.armed ? 1 : 0]),
      });
    }
  }

  root.StahlSim = Sim;
})(typeof self !== 'undefined' ? self : this);
