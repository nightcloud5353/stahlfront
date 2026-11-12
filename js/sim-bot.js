// STAHLFRONT – Simulation: KI-Gegner. Wird in die Sim-Klasse (sim.js) eingemischt.
(function (root) {
  'use strict';
  const { W, PHYS, R, G, WIND_ACC, PT, BOT_SKILL, WMAP, clamp, gauss } = root.SimBase;

  class SimBot {
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
      else if (avail('napalm') && r < 0.45) w = 'napalm';
      // Atomgranate nur, wenn das Ziel weit genug weg ist (sonst trifft sie sich selbst)
      if (avail('nuke') && Math.abs(target.x - t.x) > 340 && Math.random() < 0.5 * sk.smart + 0.3) w = 'nuke';
      // Sprengladung nutzt die KI bewusst nicht (müsste eine Runde vorausplanen)
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
          const score = fin + (fin > 60 ? 0 : 0) + (Math.hypot(x - t.x, y - t.y) < (w === 'nuke' ? 200 : 50) ? 500 : 0);
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
        else if (w === 'nuke') w = 'shell'; // keine Atomgranate auf gut Glück
      }
      return { w, face, aim: clamp(best.aim + gauss() * sk.a, PHYS.AIM_MIN, PHYS.AIM_MAX), power: clamp(best.pw + gauss() * sk.p, 5, 100) };
    }
  }

  root.SimBase.mixin(root.StahlSim, SimBot);
})(typeof self !== 'undefined' ? self : globalThis);
