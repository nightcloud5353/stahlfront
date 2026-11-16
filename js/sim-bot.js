// STAHLFRONT – Simulation: KI-Gegner. Wird in die Sim-Klasse (sim.js) eingemischt.
//
// Ablauf eines KI-Zuges:
//   1. Lage bewerten: Für jede verfügbare Waffe werden Flugbahnen vorausberechnet (Wind, Abprallen,
//      Bohren) und der erwartete Schaden an allen Panzern geschätzt – eigene zählen negativ,
//      Fässer und Kisten in der Nähe werden mitgerechnet.
//   2. Weitere Möglichkeiten: Panzer wechseln, Fahren (bessere Schussposition, Nachschub-Kisten,
//      Flucht vor Feuer, Sprengladungen, Minen und steigendem Wasser), Seilwinde, Rammen (ins Wasser!),
//      Mine, Sprengladung, Artillerieschlag, MG, Reparatur.
//   3. Ausführen: sichtbar fahren / zielen / feuern, danach ggf. Rückzug.
// Die Berechnung läuft als Generator in kleinen Häppchen über mehrere Frames, damit beim Gastgeber nichts ruckelt.
// Die Stufe (Rekrut/Veteran/Elite) bestimmt Genauigkeit, Windkenntnis und welche Tricks genutzt werden.
(function (root) {
  'use strict';
  const { W, PHYS, R, G, WIND_ACC, PT, BOT_SKILL, WMAP, BOOM, FUEL_COST, DRIVE_MAX, CLIMB, FIRE_REACH, clamp, gauss } = root.SimBase;

  // Kosten knapper Munition (in "Schadenspunkten"): Spezialwaffen nur, wenn sie sich lohnen.
  // Die Kosten sinken im Lauf des Gefechts – wer Munition hortet, nimmt sie mit ins Grab.
  const COST = { cluster: 5, drill: 4, mine: 3, strike: 7, napalm: 3, c4: 5, nuke: 10, winch: 3 };
  // Flugbahn-Art je Waffe
  const TRACE_KIND = { shell: 'impact', cluster: 'impact', napalm: 'impact', nuke: 'impact', drill: 'drill', bouncer: 'bounce' };
  const THROWERS = ['shell', 'bouncer', 'cluster', 'drill', 'napalm', 'nuke'];
  const BUDGET = 30000;  // Rechenschritte pro Frame
  const DT = 1 / 60;

  class SimBot {
    // ---------- Ausführung (jeden Tick, solange die KI am Zug ist) ----------
    botThink() {
      const g = this.g, team = g.teams[g.turnTeam], t = g.active, b = g.bot;
      if (!t || !t.alive) return;
      const sk = BOT_SKILL[team.bot] || BOT_SKILL[2];
      b.t += DT;
      if (g.phase === 'retreat') return this.botRetreat(b);
      if (g.phase !== 'turn' || g.winch || b.done) return;
      // Zeit wird knapp? Sofort zu Ende rechnen und schießen
      const hurry = g.timer < 2.5;
      if (!b.plan) {
        if (b.t < (b.wait || 0) && !hurry) return;
        if (!t.grounded && !hurry) return; // erst landen (nach Fahrt/Seilwinde/Treffer)
        if (!b.gen) b.gen = this.botPlan(team, t, sk, b);
        let r;
        do { this.botWork = 0; r = b.gen.next(); } while (hurry && !r.done);
        if (!r.done) return;
        b.gen = null;
        b.plan = r.value;
        b.t0 = b.t;
      }
      const plan = b.plan;
      if (hurry && (plan.kind === 'drive' || plan.kind === 'winch' || plan.kind === 'switch')) { b.plan = null; b.noMove = true; b.switched = true; return; }

      if (plan.kind === 'switch') {
        for (let i = 0; i < 8 && g.active !== plan.tank; i++) this.applyInput({ t: 'switch' });
        b.switched = true; b.plan = null; b.wait = b.t + 0.6;
        return;
      }
      if (plan.kind === 'drive') return this.botDrive(b, t, plan);
      // Rohr und Kraft gleiten sichtbar auf den Zielwert
      if (plan.face && t.face !== plan.face) t.face = plan.face;
      if (plan.aim !== undefined) { t.aim += clamp(plan.aim - t.aim, -1.2, 1.2); t.power += clamp(plan.power - t.power, -1.5, 1.5); }
      const ready = plan.aim === undefined || (Math.abs(plan.aim - t.aim) < 0.5 && Math.abs(plan.power - t.power) < 0.6);
      if (!hurry && !(ready && b.t > Math.max(sk.think, b.t0 + 0.35))) return;
      if (plan.aim !== undefined) { t.aim = plan.aim; t.power = plan.power; }
      if (plan.kind === 'winch') {
        this.applyInput({ t: 'weapon', w: 'winch' });
        if (g.weapon === 'winch') this.applyInput({ t: 'fire' });
        b.winched = true; b.noMove = !g.winch; b.plan = null; b.wait = b.t + 0.5;
        return;
      }
      b.done = true;
      b.retreat = plan.retreat || 0;
      this.applyInput({ t: 'weapon', w: plan.w });
      if (plan.w === 'strike') this.applyInput({ t: 'target', x: plan.tx, y: plan.ty });
      else this.applyInput({ t: 'fire' });
      if (!g.fired && plan.w !== 'skip') { this.applyInput({ t: 'weapon', w: 'shell' }); this.applyInput({ t: 'fire' }); }
    }
    botDrive(b, t, plan) {
      const g = this.g;
      const dir = Math.sign(plan.x - t.x);
      if (b.lastX === undefined || Math.abs(t.x - b.lastX) > 0.3) { b.lastX = t.x; b.stuck = 0; } else b.stuck++;
      if (Math.abs(plan.x - t.x) < 1.5 || !dir || g.fuel <= 0 || b.stuck > 25 || b.t - b.t0 > 6) {
        this.applyInput({ t: 'in', k: {} });
        b.plan = null; b.noMove = true; b.wait = b.t + 0.45; b.lastX = undefined;
        return;
      }
      this.applyInput({ t: 'in', k: { l: dir < 0, r: dir > 0 } });
    }
    // nach Mine/Sprengladung: weg vom Knall
    botRetreat(b) {
      if (!b.retreat) return;
      if (this.g.fuel <= 0) { b.retreat = 0; this.applyInput({ t: 'in', k: {} }); return; }
      this.applyInput({ t: 'in', k: { l: b.retreat < 0, r: b.retreat > 0 } });
    }
    // ---------- Planung (Generator: liefert am Ende den Plan) ----------
    *botPlan(team, t, sk, b) {
      const g = this.g;
      if (!g.tanks.some((k) => k.alive && k.team !== t.team)) return { kind: 'shot', w: 'skip' };
      // Fähigkeiten je Stufe: Rekrut nutzt Tricks nur manchmal, Elite immer
      const can = (min) => sk.smart >= min || Math.random() < 0.25 + sk.smart * 0.3;
      const avail = (id) => team.ammo[id] !== 0 && WMAP[id].from <= team.turns;
      const ctx = this.botCtx(team, t, sk);

      // 1) einen anderen eigenen Panzer nehmen? (nur vor Fahrt/Schuss erlaubt)
      const mine = team.tanks.filter((k) => k.alive);
      if (!b.switched && !g.moved && !g.fired && mine.length > 1 && can(0.6)) {
        let best = null, cur = 0;
        for (const k of mine) {
          this.botSetSelf(ctx, k);
          const v = (yield* this.botQuick(ctx, k.x, k.y, k.tilt)) + this.botDanger(ctx, k, k.x, k.y);
          if (k === t) cur = v;
          if (!best || v > best.v) best = { k, v };
        }
        this.botSetSelf(ctx, t);
        if (best.k !== t && best.v > cur + 12) return { kind: 'switch', tank: best.k };
      }

      // 2) alle Aktionen am aktuellen Standort
      const opts = yield* this.botOptions(ctx, team, t, sk, avail, can);
      opts.sort((a, c) => c.v - a.v);
      const best = opts[0];
      const here = this.botDanger(ctx, t, t.x, t.y);

      // 3) Standort wechseln (fahren/Seilwinde): bei Gefahr, ohne guten Schuss oder wenn Nachschub lockt
      if (!b.noMove && (here < -8 || !best || best.v < 20 || can(0.8))) {
        // Vergleich mit anderen Standorten über dieselbe Schnellschätzung – aber eine starke Aktion hier (Rammen, Mine …) zählt mit
        const cur = Math.max(yield* this.botQuick(ctx, t.x, t.y, t.tilt), best ? best.v * 0.9 : 0, 0) + here;
        const mv = yield* this.botMoveChoice(ctx, team, t, sk, b, avail, can, cur);
        if (mv) return mv;
      }
      if (!best || best.v <= -1) return { kind: 'shot', w: 'skip' };
      return best;
    }

    // Momentaufnahme der Welt für die Vorausberechnung
    botCtx(team, t, sk) {
      const g = this.g;
      const tanks = g.tanks.filter((k) => k.alive).map((k) => ({ id: k.id, team: k.team, x: k.x, y: k.y, hp: k.hp, me: k === t }));
      const objs = g.objs.filter((o) => o.alive).map((o) => ({ kind: o.kind, x: o.x, y: o.y, r: o.r, content: o.content }));
      return { team, sk, tanks, objs, wind: g.wind * sk.wind, self: tanks.find((k) => k.me) };
    }
    botSetSelf(ctx, k) {
      for (const s of ctx.tanks) s.me = s.id === k.id;
      ctx.self = ctx.tanks.find((s) => s.me);
    }

    // Wert einer Explosion bei (x,y): erwarteter Schaden an Gegnern minus Schaden am eigenen Team
    botBlast(ctx, x, y, r, dmg, depth) {
      const g = this.g;
      let v = 0;
      for (const k of ctx.tanks) {
        const d = Math.hypot(k.x - x, k.y - y), reach = r + R;
        if (d >= reach) continue;
        const f = 1 - d / reach;
        const a = Math.min(k.hp, Math.round(dmg * Math.min(1, f * 1.35)));
        const wet = k.y > g.waterY - 45 ? 12 * f : 0; // Rückstoß könnte ins Wasser schieben
        if (k.team === ctx.team.idx) v -= a * (k.me ? 1.6 : 1.3) + (a >= k.hp ? 60 : 0) + wet * 2;
        else v += a + (a >= k.hp ? 30 : 0) + wet;
      }
      if (!depth) {
        // Fässer und Kisten gehen mit hoch
        for (const o of ctx.objs) {
          if (Math.hypot(o.x - x, o.y - y) >= r + o.r) continue;
          const [br, bd] = BOOM[o.kind];
          v += 0.9 * this.botBlast(ctx, o.x, o.y, br, bd, 1);
          if (o.kind === 'crate') v -= o.content === 'nuke' ? 12 : 5; // Nachschub lieber einsammeln
        }
      }
      return v;
    }
    // Wert eines Einschlags je Waffe (inkl. Splitter und Feuer)
    botImpactValue(ctx, w, x, y) {
      const [r, d] = BOOM[w];
      let v = this.botBlast(ctx, x, y, r, d, 0);
      if (w === 'cluster') {
        const [br, bd] = BOOM.bomblet;
        for (const ox of [-55, -28, 0, 28, 55]) v += 0.45 * this.botBlast(ctx, x + ox, y, br, bd, 1);
      } else if (w === 'napalm') {
        // Feuer fließt hangabwärts und brennt zwei Runden
        for (const k of ctx.tanks) {
          if (Math.abs(k.x - x) > 50 || k.y < y - 40 || k.y > y + 80) continue;
          const fire = Math.min(k.hp, 22);
          v += k.team === ctx.team.idx ? -fire * 1.3 : fire * 0.9;
        }
      }
      return v;
    }

    // Flugbahn vorausberechnen (ohne Nebenwirkungen, gleiche Regeln wie updateProj). Liefert den Explosionspunkt oder null.
    botTrace(ctx, kind, windF, x, y, vx, vy) {
      const g = this.g, selfId = ctx.self.id;
      const windK = ctx.wind * WIND_ACC * windF;
      const hitTank = (px, py, age) => {
        for (const k of ctx.tanks) {
          if (k.id === selfId && age < 12) continue;
          if (Math.abs(k.x - px) < R + 9 && py > k.y - R - 5 && py < k.y + R + 1) return true;
        }
        for (const o of ctx.objs) if (Math.hypot(o.x - px, o.y - py) < o.r + 1) return true;
        return false;
      };
      let rest = false, work = 0, res = null;
      for (let age = 1; age <= 420; age++) {
        if (kind === 'bounce' && age >= 180) { res = { x, y }; break; }
        if (rest) { work++; if (this.circleHits(x, y + 1.5, 3)) continue; rest = false; }
        vy += G; vx += windK;
        const sp = Math.hypot(vx, vy), steps = Math.max(1, Math.ceil(sp / (kind === 'bounce' ? 1.5 : 2.5)));
        work += steps * (kind === 'bounce' ? 6 : 1);
        let stop = false;
        for (let i = 0; i < steps; i++) {
          const nx = x + vx / steps, ny = y + vy / steps;
          if (kind === 'impact') {
            if (this.solid(nx, ny) || hitTank(nx, ny, age)) { res = { x: nx, y: ny }; stop = true; break; }
          } else if (kind === 'drill') {
            if (hitTank(nx, ny, age)) { res = { x: nx, y: ny }; stop = true; break; }
            if (this.solid(nx, ny)) {
              // bohrt 70 px geradeaus weiter
              const l = Math.hypot(vx, vy) || 1, dx = vx / l, dy = vy / l;
              let bx = nx, by = ny;
              res = null;
              for (let s = 0; s < 70; s += 1.3) {
                bx += dx * 1.3; by += dy * 1.3;
                if (by > g.waterY) break;
                if (hitTank(bx, by, 99)) break;
              }
              if (by <= g.waterY) res = { x: bx, y: by };
              stop = true;
              break;
            }
          } else if (this.circleHits(nx, ny, 3)) {
            const [ax, ay] = this.normalAt(nx, ny, 5);
            const dot = vx * ax + vy * ay;
            if (dot < 0) { vx = (vx - 2 * dot * ax) * PT.bouncer.bounce; vy = (vy - 2 * dot * ay) * PT.bouncer.bounce; }
            else { x += ax; y += ay; }
            if (Math.hypot(vx, vy) < 0.6 && ay < -0.3) { vx = 0; vy = 0; rest = true; }
            work += 20;
            break;
          }
          x = nx; y = ny;
        }
        if (stop) break;
        if (y > g.waterY || x < -200 || x > W + 200) break;
      }
      this.botWork = (this.botWork || 0) + work;
      return res;
    }
    botLaunch(face, aim, power, px, py) {
      const A = (aim * Math.PI) / 180, dx = face * Math.cos(A), dy = -Math.sin(A), sp = PHYS.speed(power);
      return [px + dx * PHYS.MUZZLE, py + dy * PHYS.MUZZLE, dx * sp, dy * sp];
    }
    botPivot(x, y, tilt, face) {
      return this.pivot({ x, y, tilt: tilt || 0, face });
    }

    // Raster-Suche Winkel × Kraft. Waffen mit gleicher Flugbahn teilen sich ein Raster (ähnlicher Windeinfluss).
    // Liefert je Waffe die besten Kandidaten.
    *botGrid(ctx, weapons, kind, windF, x, y, tilt, step) {
      const cands = {};
      for (const w of weapons) cands[w] = [];
      for (const face of [-1, 1]) {
        const [px, py] = this.botPivot(x, y, tilt, face);
        for (let aim = step > 6 ? 6 : -9; aim <= PHYS.AIM_MAX; aim += step) {
          for (let pw = 16; pw <= 100; pw += step) {
            const hit = this.botTrace(ctx, kind, windF, ...this.botLaunch(face, aim, pw, px, py));
            if (hit) {
              for (const w of weapons) {
                const v = this.botImpactValue(ctx, w, hit.x, hit.y);
                if (v > 0) cands[w].push({ face, aim, pw, v });
              }
            }
            if (this.botWork > BUDGET) yield;
          }
        }
      }
      return cands;
    }
    // Feinsuche um die besten Kandidaten; Treffer, die schon bei kleinen Zielfehlern danebengehen, zählen weniger
    *botRefine(ctx, w, cands, x, y, tilt) {
      const kind = TRACE_KIND[w], windF = PT[w].wind;
      cands.sort((a, c) => c.v - a.v);
      const val = (face, px, py, a, p) => {
        const h = this.botTrace(ctx, kind, windF, ...this.botLaunch(face, clamp(a, PHYS.AIM_MIN, PHYS.AIM_MAX), clamp(p, 5, 100), px, py));
        return h ? this.botImpactValue(ctx, w, h.x, h.y) : 0;
      };
      const e = Math.max(0.7, ctx.sk.a * 0.8), ep = Math.max(1, ctx.sk.p * 0.8);
      let best = null;
      for (const c of cands.slice(0, 3)) {
        const [px, py] = this.botPivot(x, y, tilt, c.face);
        for (const [da, dp] of [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, 1], [-1, 1], [1, -1]]) {
          const aim = c.aim + da, pw = c.pw + dp;
          const v0 = val(c.face, px, py, aim, pw);
          if (v0 > 0 && (!best || v0 > best.v)) {
            const rob = (v0 * 2 + val(c.face, px, py, aim + e, pw) + val(c.face, px, py, aim - e, pw) + val(c.face, px, py, aim, pw + ep) + val(c.face, px, py, aim, pw - ep)) / 6;
            if (!best || rob > best.v) best = { face: c.face, aim: clamp(aim, PHYS.AIM_MIN, PHYS.AIM_MAX), pw: clamp(pw, 5, 100), v: rob };
          }
          if (this.botWork > BUDGET) yield;
        }
      }
      return best;
    }

    // schneller Schätzwert "wie gut kann ich von hier aus schießen?" (für Fahr-, Seilwinden- und Wechsel-Entscheidungen)
    *botQuick(ctx, x, y, tilt) {
      const s = (yield* this.botGrid(ctx, ['shell'], 'impact', 1, x, y, tilt, 9)).shell;
      const shell = s.reduce((a, c) => Math.max(a, c.v), 0);
      const mg = this.botMg(ctx, x, y, tilt);
      return Math.max(shell * 0.85, mg ? mg.v : 0);
    }

    // MG: gerade Linie, 5 Kugeln mit Streuung
    botMg(ctx, x, y, tilt) {
      let best = null;
      for (const e of ctx.tanks) {
        if (e.team === ctx.team.idx) continue;
        const face = e.x < x ? -1 : 1;
        const [px, py] = this.botPivot(x, y, tilt, face);
        const elev = (Math.atan2(-(e.y - py), Math.abs(e.x - px)) * 180) / Math.PI;
        if (elev < PHYS.AIM_MIN || elev > PHYS.AIM_MAX) continue;
        let v = 0, dealt = 0;
        for (const da of [-1.2, -0.6, 0, 0.6, 1.2]) {
          const a = ((elev + da) * Math.PI) / 180, dx = face * Math.cos(a), dy = -Math.sin(a);
          let bx = px + dx * PHYS.MUZZLE, by = py + dy * PHYS.MUZZLE, who = null;
          for (let i = 0; i < 900 && !who; i += 2) {
            bx += dx * 2; by += dy * 2;
            if (bx < 0 || bx > W || by > this.g.waterY || this.solid(bx, by)) break;
            for (const k of ctx.tanks) if (!k.me && Math.abs(k.x - bx) < R + 9 && by > k.y - R - 5 && by < k.y + R + 1) { who = k; break; }
          }
          this.botWork = (this.botWork || 0) + 200;
          if (!who) continue;
          if (who.team === ctx.team.idx) v -= 6 * 1.3;
          else { v += 6; dealt += 6; if (who === e && dealt >= e.hp) v += 30; }
        }
        if (v > 0 && (!best || v > best.v)) best = { face, aim: elev, v };
      }
      return best;
    }

    // Gefahr an einer Stelle (negativ = schlecht): Sprengladungen, Minen, Feuer, steigendes Wasser, Gegner direkt daneben
    botDanger(ctx, k, x, y) {
      const g = this.g;
      let v = 0;
      for (const p of g.proj) {
        if (p.dead) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (p.type === 'c4') { const reach = BOOM.c4[0] + R + 8; if (d < reach) v -= 62 * Math.min(1, (1 - d / reach) * 1.35) * 1.3; }
        else if (p.type === 'mine' && d < BOOM.mine[0] + R) v -= p.armed ? 30 : 18;
      }
      let burn = 0;
      for (const f of g.fires) if (Math.hypot(f.x - x, f.y - y) < FIRE_REACH + 4) burn++;
      if (burn) v -= 14 + burn * 3; // 6–12 Schaden pro Zug, zwei Runden lang
      const margin = g.waterY - y;
      if (margin < 80) v -= (80 - margin) * 0.9;
      for (const e of ctx.tanks) if (e.team !== ctx.team.idx && Math.hypot(e.x - x, e.y - y) < 40) v -= 4;
      if (k && k.hp < 30) v *= 1.3;
      return v;
    }

    // Fahrweg simulieren (gleiche Regeln wie control()): erreichbare Stellen in Fahrtrichtung
    botWalk(x, y, dir, maxDist) {
      const g = this.g, out = [];
      let dist = 0;
      while (dist < maxDist) {
        const nx = x + dir;
        let moved = false;
        for (let c = 0; c <= CLIMB; c++) if (!this.circleHits(nx, y - c, R)) { x = nx; y -= c; moved = true; break; }
        if (!moved || x < R + 4 || x > W - R - 4) break;
        for (let d = 0; d < CLIMB + 1; d++) { if (!this.circleHits(x, y + 1, R)) y += 1; else break; }
        if (!this.circleHits(x, y + 1, R)) break; // Kante: hier würde der Panzer abstürzen
        dist++;
        if (g.proj.some((p) => p.type === 'mine' && !p.triggered && Math.hypot(p.x - x, p.y - y) < R + 16)) break; // nicht über Minen fahren
        out.push({ x, y, d: dist });
        if (y > g.waterY - 14) break;
      }
      this.botWork = (this.botWork || 0) + dist * 40;
      return out;
    }

    // Wert einer Nachschub-Kiste
    botCrateValue(k, o) {
      if (o.content === 'heal') return Math.min(25, 100 - k.hp) * (k.hp < 50 ? 1.2 : 0.7) + 2;
      return o.content === 'nuke' ? 22 : 10;
    }

    // Fahren oder Seilwinde, wenn ein anderer Standort deutlich besser ist
    *botMoveChoice(ctx, team, t, sk, b, avail, can, curV) {
      const g = this.g;
      let best = null;
      const self = ctx.self, ox = self.x, oy = self.y;
      const consider = function* (x, y, extra, plan) {
        self.x = x; self.y = y;
        const v = (yield* this.botQuick(ctx, x, y, 0)) + this.botDanger(ctx, t, x, y) + extra;
        self.x = ox; self.y = oy;
        if (!best || v > best.v) best = Object.assign({ v }, plan);
      }.bind(this);
      // Fahren (Treibstoff reicht für ca. 160 px)
      const reach = (g.fuel / FUEL_COST) * DRIVE_MAX * 0.9;
      if (reach > 15 && t.grounded && can(0.3)) {
        for (const dir of [-1, 1]) {
          const path = this.botWalk(t.x, t.y, dir, reach);
          let crates = 0;
          const got = new Set();
          for (let i = 0; i < path.length; i++) {
            const p = path[i];
            for (const o of ctx.objs) {
              if (o.kind !== 'crate' || got.has(o) || Math.hypot(o.x - p.x, o.y - p.y) >= R + o.r + 3) continue;
              got.add(o);
              crates += this.botCrateValue(t, o) * (can(0.6) ? 1 : 0.4);
            }
            if ((i + 1) % 30 === 0 || i === path.length - 1) yield* consider(p.x, p.y, crates - 1, { kind: 'drive', x: p.x });
          }
          if (this.botWork > BUDGET) yield;
        }
      }
      // Seilwinde: hoch auf eine Kante oder aus einer Grube heraus (beendet den Zug nicht)
      if (!b.winched && avail('winch') && t.grounded && can(0.6)) {
        const seen = [];
        for (const face of [-1, 1]) {
          for (let aim = 25; aim <= 85 && seen.length < 8; aim += 6) {
            const dest = this.botWinchDest(t, face, aim);
            if (!dest || seen.some((s) => Math.hypot(s.x - dest.x, s.y - dest.y) < 25)) continue;
            seen.push(dest);
            yield* consider(dest.x, dest.y, -COST.winch, { kind: 'winch', face, aim, power: t.power });
          }
        }
      }
      // nur wechseln, wenn es sich deutlich lohnt (Rekrut ist träger)
      if (best && best.v > curV + 8 + (1 - sk.smart) * 10) { delete best.v; return best; }
      return null;
    }
    // Wohin zieht die Seilwinde? (gleiche Regeln wie useWinch/updateWinch)
    botWinchDest(t, face, aim) {
      const g = this.g;
      const [px, py] = this.botPivot(t.x, t.y, t.tilt, face);
      const A = (aim * Math.PI) / 180, dx = face * Math.cos(A), dy = -Math.sin(A);
      let x = px + dx * PHYS.MUZZLE, y = py + dy * PHYS.MUZZLE, hit = false;
      for (let i = 0; i < PHYS.WINCH_RANGE; i += 2) {
        x += dx * 2; y += dy * 2;
        if (x < 0 || x >= W || y < 0) break;
        if (this.solid(x, y)) { hit = true; break; }
      }
      this.botWork = (this.botWork || 0) + 150;
      if (!hit) return null;
      const ax = x - dx * 3, ay = y - dy * 3;
      let best = null;
      for (const ox of [0, 8, -8, 16, -16, 24, -24]) {
        const cx = ax + ox * face;
        for (let cy = ay - 60; cy <= ay + 12; cy++) {
          if (!this.circleHits(cx, cy, R) && this.circleHits(cx, cy + 1, R)) {
            const dd = Math.hypot(cx - ax, cy - ay);
            if (!best || dd < best.d) best = { x: cx, y: cy, d: dd };
            break;
          }
        }
      }
      this.botWork += 1500;
      // nur Ziele, die wirklich höher und sicher über dem Wasser liegen
      if (!best || best.d > 60 || best.y > t.y - 20 || best.y > g.waterY - 60) return null;
      return best;
    }

    // alle Angriffs- und Sonderaktionen am aktuellen Standort bewerten
    *botOptions(ctx, team, t, sk, avail, can) {
      const opts = [];
      const foes = ctx.tanks.filter((k) => k.team !== team.idx);
      const late = Math.max(0.3, 1 - team.turns / 14);
      const cost = (w) => (COST[w] || 0) * (foes.length > 1 ? 1 : 0.6) * late * (0.5 + sk.smart * 0.5);
      const noise = (1 - sk.smart) * 8; // Rekrut entscheidet launischer
      const add = (o) => { o.v += gauss() * noise; opts.push(o); };
      const aimNoise = (aim) => clamp(aim + gauss() * sk.a, PHYS.AIM_MIN, PHYS.AIM_MAX);
      const powNoise = (pw) => clamp(pw + gauss() * sk.p, 5, 100);

      // Wurfwaffen: Raster je Flugbahn-Art, danach Feinsuche je Waffe
      const throwers = THROWERS.filter((w) => avail(w) && (w === 'shell' || can(w === 'nuke' ? 0 : 0.5)));
      const groups = [];
      for (const w of throwers) {
        const kind = TRACE_KIND[w], windF = PT[w].wind;
        // gleicher Flug, ähnlicher Wind -> ein gemeinsames Raster
        const grp = groups.find((gr) => gr.kind === kind && Math.abs(ctx.wind * (gr.windF - windF)) < 0.12);
        if (grp) grp.ws.push(w); else groups.push({ kind, windF, ws: [w] });
      }
      for (const gr of groups) {
        const cands = yield* this.botGrid(ctx, gr.ws, gr.kind, gr.windF, t.x, t.y, t.tilt, gr.kind === 'bounce' ? 7 : 5);
        for (const w of gr.ws) {
          if (!cands[w].length) continue;
          const s = yield* this.botRefine(ctx, w, cands[w], t.x, t.y, t.tilt);
          if (s) add({ kind: 'shot', w, face: s.face, aim: aimNoise(s.aim), power: powNoise(s.pw), v: s.v - cost(w) });
        }
      }
      // MG (nur auf Sicht)
      const mg = this.botMg(ctx, t.x, t.y, t.tilt);
      if (mg) add({ kind: 'shot', w: 'mg', face: mg.face, aim: clamp(mg.aim + gauss() * sk.a * 0.4, PHYS.AIM_MIN, PHYS.AIM_MAX), power: t.power, v: mg.v });
      // Artillerieschlag: 5 Granaten von oben – gut gegen Gegner in Deckung
      if (avail('strike') && can(0.2)) {
        let best = null;
        for (const e of foes) {
          for (let ox = -36; ox <= 36; ox += 12) {
            const tx = clamp(e.x + ox, 0, W);
            let v = 0;
            for (let i = 0; i < 5; i++) {
              const h = this.botTrace(ctx, 'impact', PT.strike.wind, tx + (i - 2) * 24, -60, -ctx.wind * 0.6, 3);
              if (h) v += this.botBlast(ctx, h.x, h.y, BOOM.strike[0], BOOM.strike[1], 0) * 0.85;
            }
            if (!best || v > best.v) best = { tx, ty: e.y, v };
          }
          if (this.botWork > BUDGET) yield;
        }
        if (best && best.v > 0) add({ kind: 'shot', w: 'strike', tx: best.tx + gauss() * sk.a * 3, ty: best.ty, v: best.v - cost('strike') });
      }
      // Rammstoß: am liebsten ins Wasser oder in die Tiefe
      for (const face of [-1, 1]) {
        const v = this.botRamValue(ctx, t, face);
        if (v !== null) add({ kind: 'shot', w: 'ram', face, v });
      }
      // Mine: Gegner dicht hinter dem Panzer -> Mine dorthin ablegen, dann wegfahren
      if (avail('mine') && can(0.3)) {
        for (const e of foes) {
          const dx = e.x - t.x;
          if (Math.abs(dx) > 70 || Math.abs(e.y - t.y) > 30) continue;
          const face = -Math.sign(dx) || 1;
          const away = this.botWalk(t.x, t.y, face, 90);
          if (away.length < 60) continue;
          const s = ctx.self, ox = s.x, oy = s.y;
          s.x = away[away.length - 1].x; s.y = away[away.length - 1].y; // nach dem Ablegen fahren wir weg
          const v = this.botBlast(ctx, t.x - face * 26, t.y, BOOM.mine[0], BOOM.mine[1], 1) * (Math.abs(dx) < 45 ? 0.75 : 0.45);
          s.x = ox; s.y = oy;
          add({ kind: 'shot', w: 'mine', face, v: v - cost('mine'), retreat: face });
        }
      }
      // Sprengladung: Gegner in der Nähe, wir selbst können danach weg (geht erst im nächsten eigenen Zug hoch)
      if (avail('c4') && can(0.4)) {
        for (const face of [-1, 1]) {
          const back = this.botWalk(t.x, t.y, -face, 150);
          if (back.length < 90) continue;
          const s = ctx.self, ox = s.x, oy = s.y;
          s.x = back[back.length - 1].x; s.y = back[back.length - 1].y;
          const v = this.botBlast(ctx, t.x + face * 22, t.y, BOOM.c4[0], BOOM.c4[1], 1) * 0.65; // Gegner können noch flüchten
          s.x = ox; s.y = oy;
          if (v > 5) add({ kind: 'shot', w: 'c4', face, v: v - cost('c4'), retreat: -face });
        }
      }
      // Reparatur
      if (avail('repair') && t.hp < 75) {
        const heal = Math.min(30, 100 - t.hp);
        add({ kind: 'shot', w: 'repair', v: heal * (t.hp < 35 ? 1.4 : t.hp < 55 ? 0.9 : 0.45) });
      }
      // Notlösung: ein Schuss Richtung nächster Gegner ist besser als nichts
      if (!opts.some((o) => o.v > 0) && foes.length) {
        const e = foes.slice().sort((a, c) => Math.abs(a.x - t.x) - Math.abs(c.x - t.x))[0];
        opts.push({ kind: 'shot', w: 'shell', face: e.x < t.x ? -1 : 1, aim: clamp(45 + gauss() * 8, 20, 70), power: clamp(55 + gauss() * 10, 30, 90), v: 0 });
      }
      return opts;
    }
    // Rammen: 20 Schaden + wohin fliegt das Opfer (Wasser = versenkt, tiefer Sturz = Fallschaden)?
    botRamValue(ctx, t, face) {
      const g = this.g;
      const victim = ctx.tanks.find((o) => !o.me && Math.sign(o.x - t.x) === face && Math.abs(o.x - t.x) < 2 * R + 22 && Math.abs(o.y - t.y) < 22);
      if (!victim) return null;
      const fly = (x, y, vx, vy) => {
        for (let i = 0; i < 400; i++) {
          vy = Math.min(vy + G, 14); vx *= 0.995;
          const nx = x + vx, ny = y + vy;
          if (this.circleHits(nx, ny, R)) return { imp: Math.hypot(vx, vy), water: false };
          x = nx; y = ny;
          if (y > g.waterY + 4 || x < -50 || x > W + 50) return { water: true };
        }
        return { water: false, imp: 0 };
      };
      if (fly(t.x, t.y, face * 3.2, -2.2).water) return -200; // selbst hinterherfallen? Nein danke.
      const land = fly(victim.x, victim.y, face * 6.5, -4.5);
      const dmg = Math.min(victim.hp, 20 + (land.water ? victim.hp : Math.max(0, (land.imp - 7) * 1.5)));
      const kill = land.water || dmg >= victim.hp;
      return victim.team === ctx.team.idx ? -dmg * 1.5 - (kill ? 60 : 0) : dmg + (kill ? 30 : 0) + (land.water ? 15 : 0);
    }
  }

  root.SimBase.mixin(root.StahlSim, SimBot);
})(typeof self !== 'undefined' ? self : globalThis);
