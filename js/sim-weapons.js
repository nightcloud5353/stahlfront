// STAHLFRONT – Simulation: Waffen, Geschosse, Explosionen und Feuer. Wird in die Sim-Klasse (sim.js) eingemischt.
(function (root) {
  'use strict';
  const { W, H, PHYS, R, G, WIND_ACC, RETREAT, MAX_HP, FIRE_REACH, FIRE_LAND, FIRE_DMG, FIRE_MAX, FIRE_ROUNDS, FLAMES, BOOM, PT, rand, r1, noInput } = root.SimBase;

  class SimWeapons {
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
      if (w.id === 'napalm' || w.id === 'nuke') this.say(t, w.id, 0, 0.9);
      else if (w.mode === 'fire' || w.mode === 'aim') this.say(t, 'fire', 0, 0.45);
      else if (['mine', 'strike', 'ram', 'repair', 'c4'].includes(w.id)) this.say(t, w.id, 0, 0.9);
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
        case 'napalm': shoot('napalm'); break;
        case 'nuke': shoot('nuke'); break;
        case 'c4': {
          // vor dem Panzer ablegen; geht erst zu Beginn des nächsten eigenen Zuges hoch
          g.proj.push({ id: g.nextId++, type: 'c4', x: t.x + t.face * 16, y: t.y - 4, vx: t.face * 0.7, vy: -1.2, owner: t.id, age: 0, fuse: -1, src });
          break;
        }
        case 'mine': {
          g.proj.push({ id: g.nextId++, type: 'mine', x: t.x - t.face * 20, y: t.y - 4, vx: -t.face * 0.6, vy: -1.2, owner: t.id, age: 0, fuse: -1, armed: false, src });
          break;
        }
        case 'strike': {
          for (let i = 0; i < 5; i++) {
            const x = target.x + (i - 2) * 24 + rand(-4, 4);
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
      // Brandtropfen: sobald er liegt (oder spätestens nach 2,5 s) wird er zur Flamme am Boden
      if (p.type === 'flame' && (p.rest || p.age > 150)) return this.ignite(p);
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
        // jedes Graben melden – sonst fehlen bei den Mitspielern Stücke des Tunnels
        this.carveRaw(p.x, p.y, 7);
        this.broadcast({ t: 'carve', x: Math.round(p.x), y: Math.round(p.y), r: 7, raw: 1 });
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
      if (p.type === 'nuke') {
        this.broadcast({ t: 'fx', k: 'nuke', x: r1(p.x), y: r1(p.y) });
        this.slowmo(80);
      }
      this.explode(p.x, p.y, r, d, k, p.type, p.src);
      if (p.type === 'napalm') {
        for (let i = 0; i < FLAMES; i++) {
          const a = -Math.PI / 2 + ((i - (FLAMES - 1) / 2) / FLAMES) * 2.4 + rand(-0.15, 0.15);
          const s = rand(1.6, 3.4);
          this.g.proj.push({ id: this.g.nextId++, type: 'flame', x: p.x, y: p.y - 4, vx: Math.cos(a) * s + p.vx * 0.15, vy: Math.sin(a) * s, owner: -1, age: 0, fuse: -1, src: p.src });
        }
        this.broadcast({ t: 'fx', k: 'ignite', x: r1(p.x), y: r1(p.y) });
      }
      if (p.type === 'cluster') {
        for (let i = 0; i < 5; i++) {
          this.g.proj.push({ id: this.g.nextId++, type: 'bomblet', x: p.x, y: p.y - 4, vx: rand(-2.2, 2.2), vy: rand(-5, -3), owner: -1, age: 0, fuse: -1, src: p.src });
        }
      }
    }

    // ---------- Napalm-Feuer ----------
    ignite(p) {
      const g = this.g;
      p.dead = true;
      const near = g.fires.find((f) => Math.hypot(f.x - p.x, f.y - p.y) < 6);
      const life = FIRE_ROUNDS * Math.max(1, g.teams.filter((tm) => tm.tanks.some((k) => k.alive)).length);
      if (near) near.life = Math.max(near.life, life);
      else g.fires.push({ id: g.nextId++, x: p.x, y: p.y, life, born: g.turnCount, src: p.src });
      // landet auf einem Panzer: sofort Brandschaden (einmal pro Panzer und Zug)
      for (const t of g.tanks) {
        if (!t.alive || t.burnT === g.turnCount || Math.hypot(t.x - p.x, t.y - p.y) >= FIRE_REACH) continue;
        t.burnT = g.turnCount;
        this.damage(t, FIRE_LAND, p.src);
        this.say(t, 'burn', 10, 0.7);
      }
    }
    updateFires() {
      const g = this.g;
      for (const f of g.fires) {
        // Boden weggesprengt? -> Flamme fällt nach (Feuer fließt hangabwärts)
        if (!this.solid(f.x, f.y + 4)) {
          f.y += 1.5;
          const l = this.solid(f.x - 3, f.y + 4), r = this.solid(f.x + 3, f.y + 4);
          if (l && !r) f.x += 0.6; else if (r && !l) f.x -= 0.6;
        }
        if (f.y > g.waterY || f.y > H) {
          f.life = 0;
          this.broadcast({ t: 'fx', k: 'steam', x: r1(f.x), y: g.waterY });
        }
      }
      g.fires = g.fires.filter((f) => f.life > 0);
    }
    // am Ende jedes Zuges: wer im Feuer steht, nimmt Schaden; Flammen brennen langsam aus
    burnFires() {
      const g = this.g;
      let any = false;
      const old = g.fires.filter((f) => f.born !== g.turnCount);
      for (const t of g.tanks) {
        if (!t.alive) continue;
        const near = old.filter((f) => Math.hypot(t.x - f.x, t.y - f.y) < FIRE_REACH);
        if (!near.length) continue;
        any = true;
        this.damage(t, Math.min(FIRE_MAX, FIRE_DMG + near.length - 1), near[0].src);
        this.broadcast({ t: 'fx', k: 'burn', id: t.id, x: r1(t.x), y: r1(t.y) });
        this.say(t, 'burn', 0, 0.5);
      }
      for (const f of old) f.life--;
      g.fires = g.fires.filter((f) => f.life > 0);
      return any;
    }
    // welches Team als Nächstes dran ist (gleiche Regel wie nextTurn)
    nextTeamIdx() {
      const g = this.g, n = g.teams.length;
      for (let i = 1; i <= n; i++) {
        const ti = (g.turnTeam + i) % n;
        if (g.teams[ti].tanks.some((t) => t.alive)) return ti;
      }
      return -1;
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
      if (r >= 15) this.landslide(x, y, r, src);
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
  }

  root.SimBase.mixin(root.StahlSim, SimWeapons);
})(typeof self !== 'undefined' ? self : globalThis);
