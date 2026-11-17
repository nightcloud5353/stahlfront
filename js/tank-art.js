// STAHLFRONT – Panzer zeichnen (Kampfpanzer mit Tarnmuster, Ketten, Rückstoß und Kommandant).
// Reine Zeichenfunktionen ohne Spielzustand; game.js ruft TANKART.draw() auf und bekommt Partikel über TANKART.onParticle.
(function (root) {
  'use strict';
  const S = root.SHARED;
  const { PHYS } = S;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const CAMO = {}; S.CAMOS.forEach((c) => { CAMO[c.id] = c; });
  let onParticle = null;
  const emit = (p) => { if (onParticle) onParticle(p); };

  // ---------- Panzer zeichnen: Kampfpanzer (Tarnmuster, laufende Ketten, Rückstoß, Klecks-Kommandant) ----------
  // Gezeichnet in "Modell-Einheiten" (Ursprung = Bodenmitte, Blick nach rechts), skaliert mit TK.
  // Drehpunkt und Länge des Rohrs passen genau zu PHYS.PIVOT_* und PHYS.MUZZLE (dort startet die Granate).
  const TK = 0.88;
  const TK_LEN = PHYS.MUZZLE / TK;
  const tankAnim = new Map(); // Panzer-ID -> { travel, lastX, shot, sway }
  const prand = (s) => { const v = Math.sin(s * 12.9898) * 43758.5453; return v - Math.floor(v); };
  function tkShade(hex, f) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const k = (v) => Math.round(clamp(f < 0 ? v * (1 + f) : v + (255 - v) * f, 0, 255));
    return `rgb(${k(r)},${k(g)},${k(b)})`;
  }
  function tkPoly(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }
  function tkCamo(c, cm, x0, y0, x1, y1, seed) {
    const w = x1 - x0, h = y1 - y0;
    c.fillStyle = cm.spot; c.strokeStyle = cm.spot;
    if (cm.pat === 'spots') for (let i = 0; i < Math.ceil(w / 6); i++) { c.beginPath(); c.ellipse(x0 + prand(seed + i) * w, y0 + prand(seed + i + 40) * h, 1.6 + prand(seed + i + 9) * 2.6, 0.8 + prand(seed + i + 3) * 1.1, prand(i) * 0.6, 0, 6.283); c.fill(); }
    else if (cm.pat === 'blobs') for (let i = 0; i < Math.ceil(w / 5); i++) { c.beginPath(); c.ellipse(x0 + prand(seed + i) * w, y0 + prand(seed + i + 40) * h, 2 + prand(seed + i + 9) * 3, 1 + prand(seed + i + 3) * 1.4, prand(i + 7) * 3, 0, 6.283); c.fill(); }
    else if (cm.pat === 'digital') for (let i = 0; i < Math.ceil(w * h / 7); i++) c.fillRect(Math.round((x0 + prand(seed + i) * w) * 2) / 2, Math.round((y0 + prand(seed + i + 70) * h) * 2) / 2, 0.9, 0.9);
    else if (cm.pat === 'unicorn') tkUnicorn(c, x0, y0, x1, y1, seed);
    else if (cm.pat === 'stripes') { c.lineWidth = 0.9; for (let x = x0 - 6; x < x1 + 6; x += 3.2 + prand(seed + x) * 1.6) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x - 2.5 + prand(x) * 2, y1); c.stroke(); } }
  }
  // Einhorn-Tarnung: Regenbogen-Bogen, Glitzersterne und kleine Herzen
  const RAINBOW = ['#FF7FAF', '#FFB86B', '#FFE97A', '#8FE3A6', '#7FC8FF', '#B79BFF'];
  function tkStar(c, x, y, r) {
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283, d = i % 2 ? r * 0.32 : r; c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
    c.closePath(); c.fill();
  }
  function tkHeart(c, x, y, s) {
    c.beginPath();
    c.moveTo(x, y + s * 0.9);
    c.bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.6, y - s * 1.1, x, y - s * 0.35);
    c.bezierCurveTo(x + s * 0.6, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9);
    c.fill();
  }
  function tkUnicorn(c, x0, y0, x1, y1, seed) {
    const w = x1 - x0, h = y1 - y0;
    // Regenbogen: Bögen um einen Punkt unterhalb der Platte, nur oben sichtbar
    const cx = x0 + w * (0.3 + prand(seed) * 0.4), cy = y1 + h * 0.9;
    const band = Math.max(0.55, h / 10), r0 = h * 1.55;
    c.lineWidth = band; c.globalAlpha = 0.8;
    RAINBOW.forEach((col, i) => { c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, r0 - i * band, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); });
    c.globalAlpha = 1;
    for (let i = 0; i < Math.ceil(w / 7); i++) {
      const x = x0 + prand(seed + i * 3) * w, y = y0 + prand(seed + i * 3 + 50) * h;
      if (prand(seed + i + 90) < 0.35) { c.fillStyle = '#E8457F'; tkHeart(c, x, y, 0.7 + prand(seed + i + 7) * 0.4); }
      else { c.fillStyle = prand(seed + i + 20) < 0.5 ? '#FFFFFF' : '#FFF3A8'; tkStar(c, x, y, 0.9 + prand(seed + i + 11) * 0.8); }
    }
  }
  // Panzerplatte: Grundfarbe, Tarnmuster, Licht von oben, Schmutz unten, Kanten
  function tkPlate(c, pts, col, cm, o) {
    o = o || {};
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    tkPoly(c, pts); c.fillStyle = col; c.fill();
    c.save(); tkPoly(c, pts); c.clip();
    if (cm.spot && o.camo !== false) tkCamo(c, cm, x0, y0, x1, y1, o.seed || 1);
    let g = c.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(255,250,225,.30)'); g.addColorStop(0.35, 'rgba(255,250,225,.04)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
    c.fillStyle = g; c.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
    if (o.dirt) { g = c.createLinearGradient(0, y1 - o.dirt, 0, y1); g.addColorStop(0, 'rgba(92,74,50,0)'); g.addColorStop(1, 'rgba(92,74,50,.7)'); c.fillStyle = g; c.fillRect(x0 - 1, y1 - o.dirt, x1 - x0 + 2, o.dirt + 1); }
    c.restore();
    c.lineJoin = 'round'; c.lineWidth = 0.45; c.strokeStyle = 'rgba(20,22,14,.75)'; tkPoly(c, pts); c.stroke();
    const a = pts[o.edgeA || 1], b = pts[o.edgeB || 2];
    c.strokeStyle = 'rgba(255,250,220,.35)'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(a[0], a[1] + 0.3); c.lineTo(b[0], b[1] + 0.3); c.stroke();
  }
  function tkWheel(c, x, y, r, rot, bolts) {
    c.fillStyle = '#1d1e18'; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill();
    const g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r * 0.85);
    g.addColorStop(0, '#7d7f70'); g.addColorStop(1, '#4a4c40');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 0.78, 0, 6.283); c.fill();
    c.fillStyle = '#34352c'; c.beginPath(); c.arc(x, y, r * 0.32, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(210,205,180,.75)';
    for (let i = 0; i < bolts; i++) { const a = rot + (i / bolts) * 6.283; c.beginPath(); c.arc(x + Math.cos(a) * r * 0.52, y + Math.sin(a) * r * 0.52, r * 0.07 + 0.08, 0, 6.283); c.fill(); }
  }
  function tkSprocket(c, x, y, r, rot) {
    c.fillStyle = '#2a2b23'; c.beginPath();
    for (let i = 0; i < 24; i++) { const a = rot + (i / 24) * 6.283, rr = i % 2 ? r : r * 0.82; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    c.closePath(); c.fill();
    tkWheel(c, x, y, r * 0.8, rot, 5);
  }
  // Kettenbahn um Antriebsrad (hinten) und Leitrad (vorn)
  const TK_BELT = (() => {
    const pts = [], xr = -20.5, yr = -4.3, rr = 3.6, xf = 20.8, yf = -4.6, rf = 3.4;
    for (let a = Math.PI / 2; a <= Math.PI * 1.5; a += 0.2) pts.push([xr + Math.cos(a) * rr, yr + Math.sin(a) * rr]);
    for (let i = 0; i <= 14; i++) pts.push([lerp(xr, xf, i / 14), -8.1]);
    for (let a = -Math.PI / 2; a <= Math.PI / 2; a += 0.2) pts.push([xf + Math.cos(a) * rf, yf + Math.sin(a) * rf]);
    pts.push([xf - 2, -0.5]); pts.push([xr + 2, -0.5]);
    return pts;
  })();
  function tkTrack(c, travel, alive) {
    c.lineJoin = 'round';
    tkPoly(c, TK_BELT); c.lineWidth = 1.6; c.strokeStyle = '#22231c'; c.stroke();
    if (alive) { c.setLineDash([0.9, 0.85]); c.lineDashOffset = travel; c.lineWidth = 1.5; c.strokeStyle = '#46473b'; c.stroke(); c.setLineDash([]); }
  }
  function tkRivets(c, x0, x1, y, step) { c.fillStyle = 'rgba(230,225,200,.55)'; for (let x = x0; x <= x1; x += step) { c.beginPath(); c.arc(x, y, 0.28, 0, 6.283); c.fill(); } }
  const TK_DECK = [[-23.5, -10.6], [-22.8, -13.3], [14.5, -13.3], [25.5, -10.2], [25.2, -8.6], [-23.5, -8.6]];
  const TK_SKIRT = [[-24.6, -11.2], [21.5, -11.2], [25.8, -8.7], [25.2, -5.6], [-24.6, -5.6]];
  const TK_TURRET = [[-15.6, -13.2], [-16.6, -15.6], [-15.4, -18.9], [-3.5, -20.6], [9.2, -20.6], [15.6, -17.4], [15.4, -14.6], [11.8, -13.2]];
  const DEAD = { base: '#2C2C26', turret: '#33332C', dark: '#18180F' };

  // Kopfbedeckung des Klecks-Kommandanten. Kopf: Halbkreis um (hx, hy), Radius ~4, Blick nach rechts (+x),
  // Augenoberkante bei hy - 2.65 – nichts darf tiefer reichen, sonst verschwinden die Augen.
  const HAT_LINE = 'rgba(0,0,0,.5)';
  function hatGrad(c, x0, y0, x1, y1, stops) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    stops.forEach((col, i) => g.addColorStop(i / (stops.length - 1), col));
    return g;
  }
  function hatShine(c, x, y, rx, ry, rot, a) {
    c.fillStyle = `rgba(255,255,255,${a})`; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, 6.283); c.fill();
  }
  function drawHat(c, hat, hx, hy) {
    c.save();
    c.translate(hx, hy);
    c.lineJoin = 'round'; c.lineCap = 'round';
    switch (hat) {
      case 'helm': {
        // Stahlhelm: gewölbte Kuppel, ausgestellter Rand, Tarnnetz-Streifen und Niete
        c.fillStyle = hatGrad(c, -3, -7, 2, -2.6, ['#7C8A52', '#56633A', '#38411F']);
        c.beginPath();
        c.moveTo(-5.6, -2.75);
        c.quadraticCurveTo(-5.2, -3.6, -4.4, -3.6);
        c.bezierCurveTo(-4.4, -8.4, 4.6, -8.4, 4.6, -3.6);
        c.quadraticCurveTo(5.6, -3.5, 6, -2.75);
        c.closePath(); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.45; c.stroke();
        c.strokeStyle = 'rgba(25,30,12,.55)'; c.lineWidth = 0.35;
        c.beginPath(); c.moveTo(-4.4, -3.6); c.lineTo(4.6, -3.6); c.stroke();
        c.strokeStyle = 'rgba(40,46,22,.6)'; c.lineWidth = 0.3;
        for (const dx of [-2.6, 0.1, 2.7]) { c.beginPath(); c.moveTo(dx - 0.4, -6.9 + Math.abs(dx) * 0.35); c.quadraticCurveTo(dx + 0.3, -5.4, dx - 0.2, -3.8); c.stroke(); }
        c.fillStyle = '#2A3016'; c.beginPath(); c.arc(-3.3, -4.5, 0.35, 0, 6.283); c.fill();
        hatShine(c, -1.4, -6.6, 1.8, 0.6, -0.25, 0.35);
        break;
      }
      case 'barett': {
        // Barett: schräg getragen – vorn knapp über der Stirn, nach hinten über den Kopf heruntergezogen
        c.fillStyle = hatGrad(c, 2, -6.5, -4, -1.5, ['#B33434', '#8A2020', '#5A1212']);
        c.beginPath();
        c.moveTo(4.1, -3);
        c.bezierCurveTo(4.3, -5.4, 1.4, -6.6, -1.4, -5.9);
        c.bezierCurveTo(-4.6, -5.1, -6.2, -2.8, -5.6, -1.2);
        c.quadraticCurveTo(-5, -0.6, -4.2, -1.1);
        c.quadraticCurveTo(-2.4, -4.6, 4.1, -3);
        c.closePath(); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.45; c.stroke();
        // Falte, wo der Stoff nach hinten fällt
        c.strokeStyle = 'rgba(60,10,10,.6)'; c.lineWidth = 0.3;
        c.beginPath(); c.moveTo(-0.6, -5.7); c.quadraticCurveTo(-3.4, -4.4, -4.9, -1.6); c.stroke();
        // Lederband entlang der Kopfrundung
        c.strokeStyle = '#2B1A12'; c.lineWidth = 0.55;
        c.beginPath(); c.moveTo(-4.1, -1.25); c.quadraticCurveTo(-2.4, -4.4, 4, -3.15); c.stroke();
        // Abzeichen vorn über dem Auge
        c.fillStyle = '#F2C230'; c.strokeStyle = '#8A6410'; c.lineWidth = 0.25;
        c.beginPath(); c.moveTo(2.4, -5.2); c.lineTo(3.1, -4.5); c.lineTo(2.4, -3.7); c.lineTo(1.7, -4.5); c.closePath(); c.fill(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.75)'; c.beginPath(); c.arc(2.25, -4.7, 0.2, 0, 6.283); c.fill();
        hatShine(c, 0.2, -5.6, 1.5, 0.45, -0.3, 0.25);
        break;
      }
      case 'muetze': {
        // Offiziersmütze: hoher Deckel, dunkles Band mit Goldkordel, glänzender Schirm, Kokarde
        c.translate(0, -3); c.scale(0.8, 0.8); c.translate(0.4, 3);
        c.fillStyle = hatGrad(c, 0, -9, 0, -4.4, ['#6B7A44', '#4F5A30']);
        c.beginPath();
        c.moveTo(-3.8, -4.6);
        c.lineTo(-5.4, -7.6); c.quadraticCurveTo(-5.4, -8.8, -3.4, -8.9);
        c.lineTo(3.8, -8.9); c.quadraticCurveTo(6, -8.8, 5.8, -7.6);
        c.lineTo(4, -4.6); c.closePath(); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.45; c.stroke();
        hatShine(c, -1.6, -8.2, 2.4, 0.45, 0, 0.3);
        c.fillStyle = '#2B3018'; c.fillRect(-3.9, -5.2, 7.9, 1.6);
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.35; c.strokeRect(-3.9, -5.2, 7.9, 1.6);
        c.strokeStyle = '#E0B23A'; c.lineWidth = 0.35;
        c.beginPath(); c.moveTo(-3.6, -4.95); c.quadraticCurveTo(0.2, -4.3, 3.8, -4.95); c.stroke();
        c.fillStyle = '#F2C230'; c.beginPath(); c.arc(2.4, -6.4, 0.75, 0, 6.283); c.fill();
        c.fillStyle = '#B3262B'; c.beginPath(); c.arc(2.4, -6.4, 0.4, 0, 6.283); c.fill();
        c.fillStyle = hatGrad(c, 0, -3.8, 0, -2.6, ['#3A3A34', '#0E0E0A']);
        c.beginPath(); c.moveTo(1.6, -3.7); c.lineTo(4.4, -3.7); c.quadraticCurveTo(6.7, -3.4, 6.8, -2.8); c.quadraticCurveTo(4.2, -2.7, 1.6, -3.1); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 0.25; c.beginPath(); c.moveTo(3, -3.55); c.quadraticCurveTo(5, -3.4, 6.2, -3.05); c.stroke();
        break;
      }
      case 'kappe': {
        // Panzerkappe: gepolsterte Lederhaube mit Wülsten, Ohrenklappe und Schutzbrille
        c.fillStyle = hatGrad(c, -2, -8, 1, -2.6, ['#4A443C', '#26231F', '#141210']);
        c.beginPath();
        c.moveTo(-4.7, -2.75);
        c.bezierCurveTo(-5.4, -8.3, 4.8, -8.6, 4.9, -2.75);
        c.closePath(); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.45; c.stroke();
        c.strokeStyle = 'rgba(120,110,95,.55)'; c.lineWidth = 0.45;
        for (const dx of [-2.6, -0.3, 2]) { c.beginPath(); c.moveTo(dx * 0.75, -7); c.quadraticCurveTo(dx * 1.25, -5, dx * 1.15, -2.9); c.stroke(); }
        c.fillStyle = '#2E2A24'; c.beginPath(); c.ellipse(-3.7, -3.3, 0.9, 1.3, 0.2, 0, 6.283); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.35; c.stroke();
        c.fillStyle = '#6B5A3A'; c.fillRect(-2.6, -6.6, 6.6, 0.7);
        for (const gx of [0.9, 3.1]) {
          c.fillStyle = '#5C5A50'; c.beginPath(); c.arc(gx, -6.3, 1.15, 0, 6.283); c.fill();
          c.fillStyle = hatGrad(c, gx - 0.8, -7.1, gx + 0.8, -5.5, ['#CFEFFF', '#4E9CC4']);
          c.beginPath(); c.arc(gx, -6.3, 0.78, 0, 6.283); c.fill();
          c.fillStyle = 'rgba(255,255,255,.8)'; c.beginPath(); c.arc(gx - 0.3, -6.6, 0.22, 0, 6.283); c.fill();
        }
        hatShine(c, -1.9, -6.9, 1.2, 0.45, -0.4, 0.22);
        break;
      }
      case 'morion': {
        // Morion der Schweizergarde: bläulich polierter Stahl mit Relief, Rosettenband, Krempe hinten hoch und spitz,
        // obenauf ein großer roter Federbusch, der wie ein Kamm von vorn bis hinten über den Helm läuft
        const steel = hatGrad(c, -3, -9.5, 3.5, -3.5, ['#E3EAF2', '#8E9DB3', '#4A566B']);
        // Federbusch (hinter der Helmkuppel)
        const cx0 = -0.3, cy0 = -8.2;
        const ring = [];
        for (let k = 0; k <= 13; k++) {
          const a = (-182 + k * 12.6) * Math.PI / 180, j = prand(k * 7.3);
          ring.push([cx0 + Math.cos(a) * (5.5 + j * 0.6), cy0 + Math.sin(a) * (5 + j * 0.5) + (j - 0.5) * 0.4, 1.2 + 0.5 * Math.sin((k / 13) * Math.PI) + prand(k * 3.1) * 0.5]);
        }
        c.fillStyle = '#7E1016';
        for (const [px, py, pr] of ring) { c.beginPath(); c.arc(px, py + 0.3, pr + 0.3, 0, 6.283); c.fill(); }
        c.beginPath(); c.ellipse(cx0, cy0, 5.2, 4.3, 0, Math.PI, 0); c.fill();
        ring.forEach(([px, py, pr], i) => {
          c.fillStyle = ['#D8222B', '#C21820', '#E8343C', '#CC1C24'][i % 4];
          c.beginPath(); c.arc(px, py, pr, 0, 6.283); c.fill();
        });
        c.fillStyle = '#CF1E27'; c.beginPath(); c.ellipse(cx0, cy0, 4.8, 3.9, 0, Math.PI, 0); c.fill();
        // Straußenfedern: viele feine Strähnen, die über den Rand hinaus ausfransen
        c.lineWidth = 0.2;
        for (let k = 0; k < 40; k++) {
          const a = (-184 + k * 4.6 + prand(k) * 3) * Math.PI / 180, r0 = 1.4 + prand(k + 9) * 1.5, r1 = 6.6 + prand(k + 3) * 1.6;
          c.strokeStyle = ['rgba(255,140,140,.55)', 'rgba(120,10,15,.5)', 'rgba(232,52,60,.9)'][k % 3];
          const bend = (prand(k + 21) - 0.3) * 0.35;
          c.beginPath();
          c.moveTo(cx0 + Math.cos(a) * r0, cy0 + Math.sin(a) * r0 * 0.9);
          c.quadraticCurveTo(cx0 + Math.cos(a + bend) * r1 * 0.7, cy0 + Math.sin(a + bend) * r1 * 0.62, cx0 + Math.cos(a + bend * 0.6) * r1, cy0 + Math.sin(a + bend * 0.6) * r1 * 0.84);
          c.stroke();
        }
        hatShine(c, -1.4, -12.4, 1.6, 0.45, -0.1, 0.3);
        // Kuppel mit Kamm
        c.fillStyle = steel;
        c.beginPath(); c.moveTo(-3.9, -3.9);
        c.bezierCurveTo(-4.4, -7.2, -2.6, -9.2, 0.2, -9.2);
        c.bezierCurveTo(3, -9.2, 4.6, -7, 4.1, -3.9);
        c.closePath(); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.45; c.stroke();
        // Relief: Ranken und Blätter um einen Stamm
        c.strokeStyle = 'rgba(40,50,70,.4)'; c.lineWidth = 0.2;
        c.beginPath(); c.moveTo(0.9, -4.9); c.lineTo(0.9, -7.6); c.stroke();
        for (const [lx, ly, rot] of [[0.3, -7, -0.7], [1.5, -6.8, 0.7], [0.3, -6, -0.5], [1.5, -5.8, 0.5]]) { c.beginPath(); c.ellipse(lx, ly, 0.45, 0.22, rot, 0, 6.283); c.stroke(); }
        c.beginPath(); c.moveTo(-2.8, -5.2); c.quadraticCurveTo(-1.8, -7.6, -0.4, -6.9); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.4)'; c.lineWidth = 0.18;
        c.beginPath(); c.moveTo(1.1, -5); c.lineTo(1.1, -7.5); c.stroke();
        // Rosettenband über der Krempe
        c.strokeStyle = 'rgba(40,50,70,.6)'; c.lineWidth = 0.25;
        c.beginPath(); c.moveTo(-3.8, -4.6); c.quadraticCurveTo(0.2, -5.3, 4, -4.6); c.stroke();
        for (const nx of [-3, -1.5, 0, 1.5, 3]) {
          const ny = -4.65 - 0.5 * (1 - (nx / 4) * (nx / 4));
          c.fillStyle = '#B9C4D2'; c.beginPath(); c.arc(nx + 0.2, ny, 0.36, 0, 6.283); c.fill();
          c.fillStyle = '#4A566B'; c.beginPath(); c.arc(nx + 0.2, ny, 0.14, 0, 6.283); c.fill();
        }
        hatShine(c, -2, -7.2, 1.1, 0.4, -0.7, 0.65);
        hatShine(c, 2.6, -6, 0.3, 0.9, 0.3, 0.3);
        // Krempe: hinten hoch und spitz, vorn flacher
        c.fillStyle = hatGrad(c, -6, -8, 6, -3, ['#2E3646', '#8E9DB3', '#C9D3E0', '#5A667A']);
        c.beginPath();
        c.moveTo(-6.3, -8.6);
        c.quadraticCurveTo(-5.4, -3, 0.2, -2.85);
        c.quadraticCurveTo(5.4, -2.7, 6.9, -6);
        c.quadraticCurveTo(4.8, -3.9, 0.2, -3.85);
        c.quadraticCurveTo(-4.6, -4, -6.3, -8.6);
        c.closePath(); c.fill();
        c.strokeStyle = HAT_LINE; c.lineWidth = 0.4; c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.45)'; c.lineWidth = 0.2;
        c.beginPath(); c.moveTo(-1.5, -3.15); c.quadraticCurveTo(2.5, -3, 5, -3.6); c.stroke();
        break;
      }
      case 'horn': {
        // Einhorn: Spiralhorn mit Glanz, bunte Mähnenlocken und ein Glitzerstern
        [['#FF9ACB', -3.4, -3.6, 1.7, 1.2, -0.6], ['#B79BFF', -4.6, -2.6, 1.5, 1.1, -0.2], ['#7FC8FF', -5.2, -1.2, 1.2, 0.95, 0.3], ['#9EEBB0', -2.2, -4.4, 1.2, 0.9, -0.9]].forEach(([col, x, y, rx, ry, r]) => {
          c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, r, 0, 6.283); c.fill();
          c.strokeStyle = 'rgba(80,40,90,.35)'; c.lineWidth = 0.25; c.stroke();
        });
        const tip = [1.9, -11];
        c.fillStyle = hatGrad(c, -1.6, 0, 1.8, 0, ['#FFF2B8', '#F6D36B', '#D9A53A']);
        c.beginPath(); c.moveTo(-1.7, -3.1); c.lineTo(tip[0], tip[1]); c.lineTo(1.8, -3.1); c.quadraticCurveTo(0, -2.6, -1.7, -3.1); c.fill();
        c.strokeStyle = '#A9781E'; c.lineWidth = 0.35; c.stroke();
        c.strokeStyle = '#C9962E'; c.lineWidth = 0.4;
        for (let k = 1; k <= 4; k++) { const f = k / 5, y = -3.1 - f * 7.9, half = 1.75 * (1 - f), x = f * 1.9; c.beginPath(); c.moveTo(x - half, y + 0.55); c.quadraticCurveTo(x, y + 0.5, x + half, y - 0.35); c.stroke(); }
        c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 0.3; c.beginPath(); c.moveTo(-0.9, -3.6); c.lineTo(1.3, -9.4); c.stroke();
        c.fillStyle = '#FFFFFF';
        c.beginPath(); c.moveTo(4, -8.3); c.lineTo(4.18, -7.88); c.lineTo(4.6, -7.7); c.lineTo(4.18, -7.52); c.lineTo(4, -7.1); c.lineTo(3.82, -7.52); c.lineTo(3.4, -7.7); c.lineTo(3.82, -7.88); c.closePath(); c.fill();
        break;
      }
      default:
    }
    c.restore();
  }
  function tankShot(id) { const a = tankAnim.get(id); if (a) a.shot = performance.now(); }

  // animate = Panzer steht im Spielfeld (Ketten, Rückstoß, Abgase); in der Lobby-Vorschau nicht
  function drawTank(c, t, look, band, now, active, animate) {
    const alive = t.alive;
    const cm = alive ? (CAMO[look && look.camo] || CAMO.oliv) : DEAD;
    const face = t.face, tilt = t.tilt || 0;
    // Animation (nur im Spielfeld): Kettenlauf, Rückstoß, Nicken, Antenne
    let travel = 0, recoil = 0, pitch = 0, moving = 0, sway = 0;
    if (animate && t.id) {
      let a = tankAnim.get(t.id);
      if (!a) { a = { travel: 0, lastX: t.x, shot: -1e9, sway: 0, swayV: 0 }; tankAnim.set(t.id, a); }
      const dx = t.x - a.lastX; a.lastX = t.x;
      if (Math.abs(dx) < 30) { a.travel += (dx * face) / TK; moving = Math.abs(dx); }
      a.swayV += (-a.sway * 0.08 - a.swayV * 0.08) + (moving > 0.15 ? (Math.random() - 0.5) * 0.12 : 0);
      a.sway += a.swayV;
      travel = a.travel; sway = a.sway;
      const ts = (now - a.shot) / 1000;
      if (ts >= 0 && ts < 0.8) {
        recoil = 4 * (ts < 0.05 ? ts / 0.05 : Math.exp(-(ts - 0.05) * 6));
        pitch = -0.05 * face * Math.exp(-ts * 5) * Math.cos(ts * 13);
        if (ts < 0.03) { a.sway -= 0.6 * face; }
      }
      // Auspuff + Staub beim Fahren, Qualm bei Wracks
      if (alive && moving > 0.15) {
        const cs = Math.cos(tilt), sn = Math.sin(tilt);
        const L = (lx, ly) => [t.x + lx * cs - ly * sn, t.y + lx * sn + ly * cs];
        if (Math.random() < 0.35) { const [ex, ey] = L(-22 * face, -2); emit({ x: ex, y: ey, vx: -face * 0.3, vy: -0.3, life: 0, max: 45, size: 2.2, col: '#4A4A44', type: 'smoke' }); }
        if (Math.random() < 0.45) { const [ex, ey] = L(-18 * face * Math.sign(dx * face || 1), 9); emit({ x: ex, y: ey, vx: -dx * 0.6 + (Math.random() - 0.5) * 0.3, vy: -0.25 - Math.random() * 0.3, life: 0, max: 40, size: 2.4 + Math.random() * 2, col: '#A8977A', type: 'smoke' }); }
      } else if (!alive && Math.random() < 0.06) emit({ x: t.x + (Math.random() - 0.5) * 8, y: t.y - 6, vx: 0.1, vy: -0.5, life: 0, max: 90, size: 5, col: '#3B3B36', type: 'smoke' });
    }
    const aimDeg = alive ? t.aim : -12;
    const a = (aimDeg * Math.PI) / 180;
    const ang = Math.atan2(-Math.sin(a), face * Math.cos(a));
    const rot = travel / 3.1;
    c.save();
    c.translate(t.x, t.y); c.rotate(tilt + pitch);
    // Schatten auf dem Boden
    c.fillStyle = 'rgba(20,18,12,.32)'; c.beginPath(); c.ellipse(0, 10.6, 23, 1.6, 0, 0, 6.283); c.fill();

    // 1) Fahrwerk, Wanne, Schürzen, Antenne, Staukorb
    c.save(); c.translate(0, 10); c.scale(face * TK, TK);
    tkTrack(c, travel, alive);
    tkSprocket(c, -20.5, -4.3, 2.9, rot);
    tkWheel(c, 20.8, -4.6, 2.6, rot, 5);
    for (let i = 0; i < 6; i++) tkWheel(c, -14.6 + i * 5.9, -3.6, 3.05, rot, 6);
    tkPlate(c, TK_DECK, tkShade(cm.base, -0.12), cm, { seed: (t.id || 1) * 3 });
    tkPlate(c, TK_SKIRT, cm.base, cm, { seed: (t.id || 1) * 7, dirt: 2.4 });
    c.strokeStyle = 'rgba(20,22,14,.55)'; c.lineWidth = 0.3;
    for (let x = -16.5; x < 22; x += 8) { c.beginPath(); c.moveTo(x, -11.1); c.lineTo(x, -5.7); c.stroke(); }
    tkRivets(c, -23.5, 21, -10.3, 2.6);
    c.fillStyle = '#26281e'; for (let i = 0; i < 4; i++) c.fillRect(-24.2, -12.8 + i * 0.6, 2.2, 0.3);
    if (alive) {
      const sw = sway * 3 + (tilt + pitch) * 20 * face;
      c.strokeStyle = '#1d1f16'; c.lineWidth = 0.35; c.beginPath(); c.moveTo(-13, -19.6); c.quadraticCurveTo(-13 - sw * 0.3, -27, -13 - sw, -34); c.stroke();
      c.fillStyle = band; c.fillRect(-13.6 - sw, -34.5, 1.4, 1.2);
    }
    c.strokeStyle = '#2a2c22'; c.lineWidth = 0.35; c.strokeRect(-19.4, -18.5, 4.2, 3.6);
    for (let x = -18.6; x < -15.4; x += 1) { c.beginPath(); c.moveTo(x, -18.5); c.lineTo(x, -14.9); c.stroke(); }
    c.restore();

    // 2) Rohr (Richtung in Weltkoordinaten wie in der Simulation, ohne Neigung)
    c.save();
    c.translate(PHYS.PIVOT_X * face, PHYS.PIVOT_Y);
    c.rotate(ang - tilt);
    c.scale(TK, TK * face);
    c.save(); c.translate(-recoil, 0);
    const bg = c.createLinearGradient(0, -1.2, 0, 1.2);
    bg.addColorStop(0, alive ? '#8a8c7a' : '#3a3a34'); bg.addColorStop(0.35, tkShade(cm.base, -0.35)); bg.addColorStop(1, '#1d1f16');
    c.fillStyle = bg; c.strokeStyle = 'rgba(15,16,10,.8)'; c.lineWidth = 0.3;
    c.fillRect(0, -1.15, TK_LEN, 2.3); c.strokeRect(0, -1.15, TK_LEN, 2.3);
    for (const [x, w, r, bands] of [[4, 8, 1.45, 3], [12, 3.4, 1.85, 0], [16.5, 6, 1.35, 2], [TK_LEN - 1.5, 1.5, 1.3, 0]]) {
      c.fillStyle = bg; c.fillRect(x, -r, w, r * 2); c.strokeRect(x, -r, w, r * 2);
      for (let i = 1; i < bands; i++) { c.beginPath(); c.moveTo(x + (w * i) / bands, -r); c.lineTo(x + (w * i) / bands, r); c.stroke(); }
    }
    c.restore();
    c.fillStyle = tkShade(cm.turret, -0.2); c.fillRect(-2.6, -2.6, 3.6, 5.2); c.strokeRect(-2.6, -2.6, 3.6, 5.2);
    c.restore();

    // 3) Turm mit Zielgerät, Nebelwerfern, Luke und Kommandant
    c.save(); c.translate(0, 10); c.scale(face * TK, TK);
    tkPlate(c, TK_TURRET, cm.turret, cm, { seed: (t.id || 1) * 11, edgeA: 3, edgeB: 4 });
    c.strokeStyle = 'rgba(20,22,14,.5)'; c.lineWidth = 0.3; c.beginPath(); c.moveTo(-15.5, -16.4); c.lineTo(14.8, -16.4); c.stroke();
    if (alive) { c.fillStyle = band; c.fillRect(-9, -16.1, 10, 1.3); }
    c.fillStyle = tkShade(cm.turret, -0.25); c.fillRect(3, -22.3, 4.4, 1.8); c.fillStyle = alive ? '#9bc7d6' : '#2a2a26'; c.fillRect(6.6, -22, 0.7, 1.1);
    c.fillStyle = '#26281e'; for (let i = 0; i < 3; i++) { c.save(); c.translate(9.5 + i * 1.3, -19.6); c.rotate(-0.6); c.fillRect(0, -0.4, 2.2, 0.8); c.restore(); }
    if (alive) {
      // Klecks-Kommandant schaut aus der Luke
      const hx = -6.5, hy = -20.4 + (active ? Math.sin(now / 160) * 0.5 : 0);
      c.save(); c.translate(hx, hy); c.scale(0.85, 0.85);
      c.fillStyle = band; c.beginPath(); c.ellipse(0, 0, 4.2, 4.0, 0, Math.PI, 0); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 0.6; c.stroke();
      c.fillStyle = 'rgba(255,255,255,.4)'; c.beginPath(); c.ellipse(-1.6, -2.6, 1.2, 0.7, 0, 0, Math.PI * 2); c.fill();
      const lookY = clamp(-aimDeg / 60, -1, 1) * 0.6;
      for (const ex of [0.4, 2.6]) {
        c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(ex, -1.6, 1.05, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#16160F'; c.beginPath(); c.arc(ex + 0.35, -1.6 + lookY, 0.55, 0, Math.PI * 2); c.fill();
      }
      drawHat(c, look && look.hat, 0, 0);
      c.restore();
    }
    c.fillStyle = '#26281e'; c.beginPath(); c.ellipse(-6.5, -20.4, 4.2, 0.9, 0, 0, 6.283); c.fill();
    c.restore();

    c.restore();
  }

  root.TANKART = {
    draw: drawTank,
    shot: tankShot,
    reset() { tankAnim.clear(); },
    set onParticle(fn) { onParticle = fn; },
  };
})(typeof self !== 'undefined' ? self : globalThis);
