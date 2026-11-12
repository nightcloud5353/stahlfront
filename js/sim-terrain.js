// STAHLFRONT – Simulation: Gelände: Erzeugung, Krater, Abfragen und Erdrutsche. Wird in die Sim-Klasse (sim.js) eingemischt.
(function (root) {
  'use strict';
  const { W, H, PHYS, R, G, SLIDE_THIN, SLIDE_SPAN_TH, SLIDE_CHUNK, SLIDE_MAX, GRAIN, rand, clamp, CIRC } = root.SimBase;

  class SimTerrain {
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

    // ---------- Erdrutsche ----------
    // Nach einer Explosion brechen dünne Überhänge und lose Brocken ab. Die Erde zerfällt in
    // kleine Brocken, die fallen, auseinanderspritzen, seitlich abrollen und Schuttkegel bilden.
    landslide(cx, cy, r, src) {
      const g = this.g, m = this.mask;
      const x0 = Math.max(0, Math.floor(cx - r - 56)), x1 = Math.min(W - 1, Math.ceil(cx + r + 56));
      const y0 = Math.max(0, Math.floor(cy - r - 40)), y1 = Math.min(H - 1, Math.ceil(cy + r + 16));
      // lose Pixel: Markierung über die ganze Karte (ein lockerer Brocken kann über den Suchbereich hinausragen)
      if (!this.looseBuf) this.looseBuf = new Uint8Array(W * H);
      const LB = this.looseBuf, looseIdx = [];
      const mark = (i) => { if (!LB[i]) { LB[i] = 1; looseIdx.push(i); } };
      const L = (x, y) => LB[y * W + x] === 1;
      let count = 0;
      // 1) dünne Überhänge (Erde mit Luft darunter)
      for (let x = x0; x <= x1; x++) {
        if (Math.abs(x - cx) > r + 50) continue;
        let y = y0;
        while (y <= y1) {
          if (m[y * W + x] !== 1) { y++; continue; }
          const top = y;
          while (y <= y1 && m[y * W + x] === 1) y++;
          const bot = y - 1;
          if (top === y0 && y0 > 0 && m[(y0 - 1) * W + x] !== 0) continue; // reicht über den Bereich hinaus
          const below = bot + 1 < H ? m[(bot + 1) * W + x] : 1;
          if (below !== 0) continue;
          const th = bot - top + 1;
          // dünn -> bricht immer; sonst: ragt der Überhang weiter als ~2× seine Dicke über die nächste Stütze hinaus?
          let fall = th <= SLIDE_THIN;
          // (frei schwebende Felsen ohne Stütze auf beiden Seiten gehören zur Karte und bleiben)
          if (!fall && th <= SLIDE_SPAN_TH) { const d = this.supportDist(x, bot); fall = d !== Infinity && d > Math.max(10, th * 2); }
          if (fall) {
            for (let k = top; k <= bot; k++) mark(k * W + x);
            count += th;
          }
        }
      }
      // 2) kleine, freischwebende Brocken (nicht mehr mit dem Rest verbunden)
      if (!this.visit) { this.visit = new Int32Array(W * H); this.visitN = 0; }
      if (this.visitN > 2e9) { this.visit.fill(0); this.visitN = 0; }
      const vis = this.visit, callBase = this.visitN;
      const stack = [], comp = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (m[i] !== 1 || L(x, y) || vis[i] > callBase) continue;
        const nearAir = (x > 0 && !m[i - 1]) || (x < W - 1 && !m[i + 1]) || (y > 0 && !m[i - W]) || (y < H - 1 && !m[i + W]);
        if (!nearAir) continue;
        const stamp = ++this.visitN;
        stack.length = 0; comp.length = 0;
        stack.push(i); vis[i] = stamp;
        let ok = true;
        while (stack.length) {
          const j = stack.pop();
          comp.push(j);
          if (comp.length > SLIDE_CHUNK) { ok = false; break; }
          const jx = j % W, jy = (j / W) | 0;
          if (jy >= H - 1) { ok = false; break; }
          for (const n of [j - 1, j + 1, j - W, j + W]) {
            const nx = n % W, ny = (n / W) | 0;
            if (n < 0 || n >= W * H || Math.abs(nx - jx) > 1) continue;
            const v = m[n];
            if (v === 2) { ok = false; break; }
            if (v !== 1 || vis[n] === stamp || L(nx, ny)) continue;
            vis[n] = stamp; stack.push(n);
          }
          if (!ok) break;
        }
        if (ok) for (const j of comp) { mark(j); count++; }
      }
      if (!count) return;
      // 3) in Brocken zerlegen (Raster an festen 3er-Positionen, damit alle Pixel eines Brockens zusammenbleiben)
      const cells = new Map();
      for (const i of looseIdx) {
        LB[i] = 0; // Markierung gleich wieder aufräumen
        if (m[i] !== 1) continue;
        const x = i % W, y = (i / W) | 0, gx = x - (x % GRAIN), gy = y - (y % GRAIN);
        const key = gy * W + gx;
        let c = cells.get(key);
        if (!c) { c = { gx, gy, bits: 0, n: 0 }; cells.set(key, c); }
        c.bits |= 1 << ((y - gy) * GRAIN + (x - gx)); c.n++;
      }
      const out = [];
      let total = 0;
      // jede Spalte bricht als Ganzes (sonst bleibt ein oberer Brocken auf dem noch festen unteren liegen)
      const colRel = {};
      // nächste Brocken zuerst (falls die Obergrenze greift, bricht das Material am Krater)
      const list = [...cells.values()].sort((a, b) => Math.hypot(a.gx - cx, a.gy - cy) - Math.hypot(b.gx - cx, b.gy - cy));
      for (const { gx, gy, bits, n } of list) {
        if ((total += n) > SLIDE_MAX) break;
        if (colRel[gx] === undefined) colRel[gx] = this.tickN + Math.round(Math.abs(gx + 1.5 - cx) * 0.12 + rand(0, 5));
        const gr = {
          id: g.nextId++, x: gx, y: gy, vx: ((gx + 1.5 - cx) / (r + 24)) * 0.5 + rand(-0.25, 0.25), vy: 0,
          bits, n, rel: colRel[gx], released: false, age: 0, src, x0: gx, y0: gy,
        };
        g.slides.push(gr);
        out.push(gr.id, gx, gy, Math.round(gr.vx * 100), gr.rel - this.tickN, bits);
      }
      if (out.length) this.broadcast({ t: 'slide', d: out });
    }
    // Abstand zur nächsten Spalte, in der die Decke auf festem Boden/Wand aufliegt (Infinity = keine Stütze)
    supportDist(x, bot) {
      const m = this.mask;
      let best = Infinity;
      for (const dir of [-1, 1]) {
        for (let d = 1; d <= 160; d++) {
          const xx = x + dir * d;
          if (xx < 0 || xx >= W) break;
          if (m[bot * W + xx] === 0) break;                       // Decke hier unterbrochen
          if (bot + 1 >= H || m[(bot + 1) * W + xx] !== 0) { best = Math.min(best, d); break; }
        }
      }
      return best;
    }
    grainBlocked(x, y) {
      const ix = Math.round(x), iy = Math.round(y), m = this.mask;
      if (ix < 0 || ix + GRAIN > W) return true;
      if (iy + GRAIN > H) return true;
      for (let dy = 0; dy < GRAIN; dy++) {
        const yy = iy + dy; if (yy < 0) continue;
        const row = yy * W;
        for (let dx = 0; dx < GRAIN; dx++) if (m[row + ix + dx] !== 0) return true;
      }
      return false;
    }
    updateSlides() {
      const g = this.g, m = this.mask, out = [];
      for (const gr of g.slides) {
        if (!gr.released) {
          if (this.tickN < gr.rel) continue;
          gr.released = true;
          for (let k = 0; k < GRAIN * GRAIN; k++) if (gr.bits & (1 << k)) { const i = (gr.y + ((k / GRAIN) | 0)) * W + gr.x + (k % GRAIN); if (m[i] === 1) m[i] = 0; }
          continue;
        }
        gr.age++;
        gr.vy = Math.min(gr.vy + G, 5);
        gr.vx *= 0.985;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(gr.vx), Math.abs(gr.vy))));
        let settle = false;
        for (let s = 0; s < steps && !settle; s++) {
          const nx = gr.x + gr.vx / steps, ny = gr.y + gr.vy / steps;
          if (!this.grainBlocked(nx, ny)) { gr.x = nx; gr.y = ny; continue; }
          if (!this.grainBlocked(gr.x, ny)) { gr.y = ny; gr.vx *= -0.3; continue; }
          if (!this.grainBlocked(nx, gr.y)) { gr.x = nx; }
          // Aufprall: schnelle Brocken spritzen auseinander, langsame rollen seitlich ab
          if (gr.vy > 1.6) { gr.vx += (Math.random() - 0.5) * gr.vy * 0.7; gr.vy *= -0.15; break; }
          const pref = gr.vx > 0.05 ? 1 : gr.vx < -0.05 ? -1 : (Math.random() < 0.5 ? 1 : -1);
          let rolled = false;
          for (const d of [pref, -pref]) {
            if (!this.grainBlocked(gr.x + d, gr.y + 1) && !this.grainBlocked(gr.x + d, gr.y)) { gr.x += d; gr.y += 1; gr.vx = d * 0.5; gr.vy = 0.4; rolled = true; break; }
          }
          if (!rolled) settle = true;
        }
        // noch nicht von der Stelle gekommen? Kurz warten – vielleicht fällt der Brocken darunter gleich weg
        if (settle && gr.age < 30 && Math.abs(gr.x - gr.x0) < 1 && Math.abs(gr.y - gr.y0) < 1) { settle = false; gr.vy = 0; }
        // trifft einen Panzer
        if (gr.vy > 1.4 && !gr.hit) {
          for (const t of g.tanks) {
            if (t.alive && Math.hypot(gr.x + 1.5 - t.x, gr.y + 1.5 - t.y) < R) { gr.hit = true; t.slideHits = (t.slideHits || 0) + 1; t.slideSrc = gr.src; break; }
          }
        }
        if (gr.y > g.waterY) { gr.done = true; out.push(gr.id, -1, -1, 0); continue; }
        if (settle || gr.age > 420) {
          gr.done = true;
          const ix = Math.round(gr.x), iy = Math.round(gr.y);
          let left = gr.n, sb = 0;
          // von unten nach oben auffüllen, nicht in Panzer, Fässer, Kisten oder liegende Minen
          for (let row = GRAIN - 1; row >= 0 && left > 0; row--) for (let col = 0; col < GRAIN && left > 0; col++) {
            const px = ix + col, py = iy + row;
            if (px < 0 || px >= W || py < 0 || py >= H || m[py * W + px] !== 0) continue;
            if (g.tanks.some((t) => !t.drowned && Math.hypot(px - t.x, py - t.y) < R + 1)) continue;
            if (g.objs.some((o) => o.alive && Math.hypot(px - o.x, py - o.y) < o.r + 1)) continue;
            if (g.proj.some((p) => p.rest && Math.hypot(px - p.x, py - p.y) < 5)) continue;
            m[py * W + px] = 1; sb |= 1 << (row * GRAIN + col); left--;
          }
          out.push(gr.id, ix, iy, sb);
        }
      }
      if (out.length) {
        g.slides = g.slides.filter((s) => !s.done);
        this.broadcast({ t: 'sl', d: out });
      }
      if (!g.slides.length) {
        // verschüttete Panzer: Schaden je nach Erdmenge (höchstens 20)
        for (const t of g.tanks) {
          if (!t.slideHits) continue;
          const dmg = Math.min(20, Math.round(t.slideHits * 0.7));
          if (dmg > 0 && t.alive) { this.damage(t, dmg, t.slideSrc || null); this.say(t, 'hurt', 0, 0.6); }
          t.slideHits = 0; t.slideSrc = null;
        }
      }
    }
  }

  root.SimBase.mixin(root.StahlSim, SimTerrain);
})(typeof self !== 'undefined' ? self : globalThis);
