// STAHLFRONT – Simulation: Panzer, Fässer, Kisten: Platzierung, Fahren und Physik. Wird in die Sim-Klasse (sim.js) eingemischt.
(function (root) {
  'use strict';
  const { W, PHYS, R, G, DRIVE_MAX, DRIVE_ACC, CLIMB, FUEL_COST, FALL_SAFE, FALL_DMG, MAX_HP, BARREL_R, CRATE_R, CRATE_HEAL, WMAP, rand, clamp, r1, shuffle, pick } = root.SimBase;

  class SimWorld {
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
      const pool = ['cluster', 'drill', 'mine', 'strike', 'repair', 'napalm', 'c4'];
      const r = Math.random();
      const content = r < 0.4 ? 'heal' : r < 0.47 ? 'nuke' : pick(pool);
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
  }

  root.SimBase.mixin(root.StahlSim, SimWorld);
})(typeof self !== 'undefined' ? self : globalThis);
