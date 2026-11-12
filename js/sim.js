// STAHLFRONT – Spiel-Simulation. Läuft im Browser des Gastgebers und ist die einzige "Wahrheit".
// Konstanten/Hilfen: sim-base.js · weitere Teile der Klasse: sim-terrain.js, sim-world.js, sim-weapons.js, sim-bot.js
(function (root) {
  'use strict';
  const { S, W, H, WEAPONS, PHYS, SUDDEN_DEATH_ROUNDS, SUDDEN_DEATH_CAVES, WATER_RISE, CRATE_EVERY, CRATE_CHANCE, RESUME_WAIT, C4_FUSE, SAVE_KEY, BOARD_KEY, BOOM, WMAP, rand, clamp, r1, shuffle, pick, store, noInput, validLook } = root.SimBase;

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
        p = { id: this.nextPid++, token: S.randomId(24), name, color: spec ? -1 : this.freeColor(), conn, connected: true, spec, bot: 0, look: validLook(m.look) };
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
        fires: [], burnDone: false, c4Done: false, slides: [],
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
      // läuft gerade ein Erdrutsch? Noch nicht abgebrochene Brocken mitschicken (sonst bleibt bei ihm Erde in der Luft hängen)
      const pend = this.g.slides.filter((s) => !s.released);
      if (pend.length) {
        const d = [];
        for (const s of pend) d.push(s.id, s.x0, s.y0, Math.round(s.vx * 100), Math.max(0, s.rel - this.tickN), s.bits);
        p.conn.send({ t: 'slide', d });
      }
      if (this.phase === 'over' && this.lastOver) p.conn.send(this.lastOver);
      this.sendState();
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
      g.burnDone = false;
      g.c4Done = false;
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
      if (g.slides.length) this.updateSlides();
      if (g.winch && g.active) this.updateWinch();
      for (const t of g.tanks) this.updateTank(t);
      for (const o of g.objs) this.updateObj(o);
      if (g.fires.length) this.updateFires();
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
      if (g.queue.length || g.burst || g.chain.length || g.winch || g.slides.length) return false;
      if (g.proj.some((p) => !((p.type === 'mine' && p.rest && !p.triggered) || (p.type === 'c4' && p.rest && !(p.fuse > 0))))) return false;
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
      // Napalm brennt
      if (!g.burnDone) {
        g.burnDone = true;
        if (g.fires.length && this.burnFires()) { g.settleT = 0; return; }
      }
      // Sprengladungen gehen zu Beginn des nächsten Zuges ihres Teams hoch (oder sofort, wenn das Team schon raus ist)
      if (!g.c4Done) {
        g.c4Done = true;
        const nt = this.nextTeamIdx();
        const due = g.proj.filter((p) => p.type === 'c4' && !(p.fuse > 0) && (p.src.team === nt || !g.teams[p.src.team].tanks.some((k) => k.alive)));
        if (due.length) {
          for (const p of due) { p.fuse = C4_FUSE; this.broadcast({ t: 'fx', k: 'trigger', x: r1(p.x), y: r1(p.y) }); }
          this.sendMsg(due.length > 1 ? 'Sprengladungen gezündet!' : 'Sprengladung gezündet!', 'warn');
          g.settleT = 0;
          return;
        }
      }
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
      const sdRounds = g.map === 'hoehlen' ? SUDDEN_DEATH_CAVES : SUDDEN_DEATH_ROUNDS;
      if (!g.waterRaised && g.turnCount >= g.teams.length * sdRounds) {
        if (g.turnCount === g.teams.length * sdRounds) this.sendMsg('HOCHWASSER – das Wasser steigt jede Runde!', 'warn');
        g.waterY = Math.round(g.waterY - WATER_RISE / Math.max(1, alive.length));
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
          mines: g.proj.filter((p) => p.type === 'mine' || p.type === 'c4').map((p) => ({ id: p.id, type: p.type, x: p.x, y: p.y, owner: p.owner, armed: p.armed, src: p.src })),
          fires: g.fires.map((f) => ({ id: f.id, x: f.x, y: f.y, life: f.life, src: f.src })),
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
        fires: (s.fires || []).map((f) => Object.assign({ born: -1 }, f)), burnDone: false, c4Done: false, slides: [],
      };
      const byId = {};
      for (const t of s.tanks) { const k = Object.assign({ vx: 0, vy: 0, grounded: false, bounces: 0 }, t); g.tanks.push(k); byId[k.id] = k; }
      for (const t of s.teams) {
        // Spielstand aus älterer Version: fehlende (neue) Waffen mit Startmunition auffüllen
        const ammo = Object.assign({}, t.ammo);
        for (const w of WEAPONS) if (typeof ammo[w.id] !== 'number') ammo[w.id] = w.ammo;
        g.teams.push(Object.assign({}, t, { ammo, tanks: t.tankIds.map((id) => byId[id]) }));
      }
      g.active = byId[s.activeId];
      for (const o of s.objs) g.objs.push(Object.assign({ vx: 0, vy: 0, grounded: false, alive: true, bounces: 0 }, o));
      for (const p of s.mines) g.proj.push({ id: p.id, type: p.type || 'mine', x: p.x, y: p.y, vx: 0, vy: 0, owner: p.owner, age: 100, fuse: -1, armed: p.armed, src: p.src });
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
        f: g.fires.map((f) => [f.id, r1(f.x), r1(f.y), f.life]),
      });
    }
  }

  root.StahlSim = Sim;
})(typeof self !== 'undefined' ? self : globalThis);
