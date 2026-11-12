// STAHLFRONT – Geräusche. Alles wird im Browser erzeugt (keine Dateien nötig):
// mehrere Schichten (Knall, Druckwelle, Grollen, Trümmer) + Raumhall + Stereo-Position.
(function (root) {
  'use strict';
  let AC = null, out = null, dry = null, wet = null, noiseBuf = null, brownBuf = null, shaper = null;
  let muted = false;
  let engine = null, nextClank = 0;

  function irBuffer(a, secs, decay) {
    const len = Math.floor(a.sampleRate * secs);
    const b = a.createBuffer(2, len, a.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function init() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return AC; }
    try { AC = new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { return null; }
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    out = AC.createGain(); out.gain.value = 0.85;
    out.connect(comp).connect(AC.destination);
    dry = AC.createGain(); dry.gain.value = 1; dry.connect(out);
    const conv = AC.createConvolver(); conv.buffer = irBuffer(AC, 2.4, 2.6);
    wet = AC.createGain(); wet.gain.value = 0.32;
    wet.connect(conv).connect(out);
    // weißes + braunes Rauschen
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    brownBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const n = noiseBuf.getChannelData(0), br = brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n.length; i++) { n[i] = Math.random() * 2 - 1; last = (last + 0.02 * n[i]) / 1.02; br[i] = last * 3.5; }
    shaper = AC.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 3); }
    shaper.curve = curve;
    return AC;
  }
  // Ausgang mit Stereo-Position (-1..1) und Hall-Anteil
  function bus(pan, rev) {
    const g = AC.createGain();
    let node = g;
    if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(p); node = p; }
    node.connect(dry);
    if (rev) { const s = AC.createGain(); s.gain.value = rev; node.connect(s); s.connect(wet); }
    return g;
  }
  function env(g, t, a, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + decay);
  }
  function noiseSrc(t, dur, brown) {
    const s = AC.createBufferSource(); s.buffer = brown ? brownBuf : noiseBuf; s.loop = true;
    s.start(t, Math.random()); s.stop(t + dur + 0.1);
    return s;
  }
  function osc(type, f, t, dur) {
    const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    o.start(t); o.stop(t + dur + 0.1);
    return o;
  }
  function filt(type, f, q) { const x = AC.createBiquadFilter(); x.type = type; x.frequency.value = f; if (q) x.Q.value = q; return x; }
  const ok = () => init() && !muted;

  const SND = {
    unlock() { init(); },
    setMuted(m) { muted = m; if (m) SND.engine(false); },

    // Explosion: Knall + Druckwelle + Grollen + Trümmerprasseln
    boom(size, pan, vol) {
      if (!ok()) return;
      const s = Math.max(0.3, Math.min(1.8, size / 40)), v = vol === undefined ? 1 : vol;
      const t = AC.currentTime;
      const o = bus(pan, 0.45);
      // Knall
      { const n = noiseSrc(t, 0.12), f = filt('highpass', 900), g = AC.createGain(); env(g, t, 0.002, 0.9 * v, 0.1); n.connect(f).connect(g).connect(o); }
      // Druckwelle (tiefer Schlag)
      { const x = osc('sine', 70 + 20 / s, t, 1.0), g = AC.createGain(); x.frequency.exponentialRampToValueAtTime(26, t + 0.6 + s * 0.2); env(g, t, 0.005, 1.1 * v * Math.min(1, s), 0.55 + s * 0.3); x.connect(g).connect(o); }
      // Körper (verzerrtes Rauschen, Filter schließt sich)
      { const n = noiseSrc(t, 2), f = filt('lowpass', 1600), g = AC.createGain(); f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(90, t + 0.9 + s * 0.4); env(g, t, 0.004, 0.65 * v, 0.7 + s * 0.6); n.connect(f).connect(shaper).connect(g).connect(o); }
      // Nachgrollen
      { const n = noiseSrc(t, 3, true), f = filt('lowpass', 220), g = AC.createGain(); env(g, t + 0.05, 0.12, 0.5 * v * s, 1.4 + s); n.connect(f).connect(g).connect(o); }
      // Trümmer
      const k = Math.round(6 + s * 8);
      for (let i = 0; i < k; i++) {
        const tt = t + 0.15 + Math.random() * (0.5 + s * 0.6);
        const n = noiseSrc(tt, 0.05), f = filt('bandpass', 1500 + Math.random() * 3500, 4), g = AC.createGain();
        env(g, tt, 0.001, 0.12 * v * Math.random(), 0.04);
        n.connect(f).connect(g).connect(o);
      }
    },
    // Kanonenschuss: scharfer Knall, Mündungsdruck, Metallnachklang
    cannon(pan) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.35);
      { const n = noiseSrc(t, 0.1), f = filt('highpass', 1400), g = AC.createGain(); env(g, t, 0.001, 1.0, 0.08); n.connect(f).connect(g).connect(o); }
      { const x = osc('sine', 110, t, 0.5), g = AC.createGain(); x.frequency.exponentialRampToValueAtTime(34, t + 0.35); env(g, t, 0.003, 1.0, 0.38); x.connect(g).connect(o); }
      { const n = noiseSrc(t, 0.6), f = filt('lowpass', 900), g = AC.createGain(); env(g, t, 0.002, 0.5, 0.35); n.connect(f).connect(shaper).connect(g).connect(o); }
      for (const [fr, vol] of [[392, 0.05], [611, 0.035], [1043, 0.02]]) { const x = osc('triangle', fr, t, 0.5), g = AC.createGain(); env(g, t + 0.01, 0.002, vol, 0.4); x.connect(g).connect(o); }
    },
    // MG-Schuss + Hülse
    mg(pan) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.2);
      { const n = noiseSrc(t, 0.06), f = filt('bandpass', 2400, 0.8), g = AC.createGain(); env(g, t, 0.001, 0.55, 0.05); n.connect(f).connect(g).connect(o); }
      { const x = osc('square', 180, t, 0.08), g = AC.createGain(); x.frequency.exponentialRampToValueAtTime(60, t + 0.06); env(g, t, 0.001, 0.15, 0.06); x.connect(filt('lowpass', 600)).connect(g).connect(o); }
      { const tt = t + 0.25 + Math.random() * 0.15, x = osc('sine', 4200 + Math.random() * 900, tt, 0.06), g = AC.createGain(); env(g, tt, 0.001, 0.03, 0.05); x.connect(g).connect(o); }
    },
    // Treffer auf Panzerstahl
    metal(pan) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.4);
      for (const [fr, vol, d] of [[523, 0.12, 0.5], [1270, 0.08, 0.35], [2093, 0.05, 0.25], [3150, 0.03, 0.15]]) {
        const x = osc('sine', fr * (0.97 + Math.random() * 0.06), t, d), g = AC.createGain(); env(g, t, 0.001, vol, d); x.connect(g).connect(o);
      }
      { const n = noiseSrc(t, 0.08), f = filt('highpass', 2500), g = AC.createGain(); env(g, t, 0.001, 0.25, 0.06); n.connect(f).connect(g).connect(o); }
    },
    bounce(pan) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.15);
      { const x = osc('sine', 160, t, 0.15), g = AC.createGain(); x.frequency.exponentialRampToValueAtTime(70, t + 0.1); env(g, t, 0.002, 0.35, 0.1); x.connect(g).connect(o); }
      { const n = noiseSrc(t, 0.06), f = filt('lowpass', 1200), g = AC.createGain(); env(g, t, 0.001, 0.2, 0.05); n.connect(f).connect(g).connect(o); }
    },
    splash(pan, big) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.3), s = big ? 1.4 : 1;
      { const n = noiseSrc(t, 1.2), f = filt('bandpass', 2600, 0.7), g = AC.createGain(); f.frequency.exponentialRampToValueAtTime(380, t + 0.9 * s); env(g, t, 0.01, 0.5 * s, 0.8 * s); n.connect(f).connect(g).connect(o); }
      for (let i = 0; i < 6 * s; i++) { const tt = t + 0.2 + Math.random() * 0.8, x = osc('sine', 300 + Math.random() * 500, tt, 0.08), g = AC.createGain(); x.frequency.exponentialRampToValueAtTime(900, tt + 0.06); env(g, tt, 0.002, 0.05, 0.06); x.connect(g).connect(o); }
    },
    // Artillerie-Pfeifen (fallende Granaten)
    whistle() {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(0, 0.3);
      const x = osc('sine', 2300, t, 1.6), g = AC.createGain(), lfo = osc('sine', 7, t, 1.6), lg = AC.createGain();
      lg.gain.value = 25; lfo.connect(lg).connect(x.frequency);
      x.frequency.exponentialRampToValueAtTime(520, t + 1.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
      x.connect(g).connect(o);
    },
    drill(pan) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.2);
      { const x = osc('sawtooth', 85, t, 0.8), g = AC.createGain(); env(g, t, 0.02, 0.12, 0.7); x.connect(filt('lowpass', 500)).connect(g).connect(o); }
      { const n = noiseSrc(t, 0.8), f = filt('bandpass', 700, 2), g = AC.createGain(); env(g, t, 0.02, 0.3, 0.7); n.connect(f).connect(g).connect(o); }
    },
    // Feuer: Fauchen + Knistern (Napalm)
    fire(pan) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(pan, 0.25);
      { const n = noiseSrc(t, 1.2), f = filt('lowpass', 900), g = AC.createGain(); f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(400, t + 1.1); env(g, t, 0.04, 0.45, 1.0); n.connect(f).connect(g).connect(o); }
      for (let i = 0; i < 9; i++) {
        const tt = t + 0.05 + Math.random() * 0.9;
        const n = noiseSrc(tt, 0.03), f = filt('bandpass', 2500 + Math.random() * 3000, 5), g = AC.createGain();
        env(g, tt, 0.001, 0.2 * Math.random(), 0.02);
        n.connect(f).connect(g).connect(o);
      }
    },
    beep() { if (!ok()) return; const t = AC.currentTime, o = bus(0, 0); for (const d of [0, 0.14]) { const x = osc('square', 1500, t + d, 0.06), g = AC.createGain(); env(g, t + d, 0.002, 0.08, 0.05); x.connect(filt('bandpass', 1500, 3)).connect(g).connect(o); } },
    // Funkspruch beim Zugwechsel
    radio(mine) {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(0, 0.05);
      { const n = noiseSrc(t, 0.25), f = filt('bandpass', 1800, 1.2), g = AC.createGain(); env(g, t, 0.005, 0.12, 0.2); n.connect(f).connect(g).connect(o); }
      const tones = mine ? [[880, 0.12], [1175, 0.2]] : [[740, 0.14]];
      let d = 0.08;
      for (const [fr, len] of tones) { const x = osc('square', fr, t + d, len), g = AC.createGain(); env(g, t + d, 0.004, 0.07, len); x.connect(filt('bandpass', fr, 4)).connect(g).connect(o); d += len + 0.02; }
    },
    tick() { if (!ok()) return; const t = AC.currentTime, o = bus(0, 0); const x = osc('square', 1100, t, 0.04), g = AC.createGain(); env(g, t, 0.001, 0.06, 0.03); x.connect(g).connect(o); },
    pickup() { if (!ok()) return; const t = AC.currentTime, o = bus(0, 0.2); [523, 659, 784, 1047].forEach((fr, i) => { const x = osc('triangle', fr, t + i * 0.07, 0.2), g = AC.createGain(); env(g, t + i * 0.07, 0.003, 0.09, 0.18); x.connect(g).connect(o); }); },
    click() { if (!ok()) return; const t = AC.currentTime, o = bus(0, 0); const n = noiseSrc(t, 0.02), f = filt('bandpass', 3000, 2), g = AC.createGain(); env(g, t, 0.001, 0.15, 0.015); n.connect(f).connect(g).connect(o); },
    // Fanfare für große Momente
    sting() {
      if (!ok()) return;
      const t = AC.currentTime, o = bus(0, 0.4);
      [[196, 0], [294, 0.0], [392, 0.12]].forEach(([fr, d]) => { const x = osc('sawtooth', fr, t + d, 0.7), g = AC.createGain(); env(g, t + d, 0.01, 0.06, 0.6); x.connect(filt('lowpass', 1400)).connect(g).connect(o); });
    },
    // Dieselmotor + Kettenrasseln, solange ein Panzer fährt
    engine(on) {
      if (!AC) return;
      const t = AC.currentTime;
      if (!engine) {
        const o1 = AC.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 36;
        const o2 = AC.createOscillator(); o2.type = 'square'; o2.frequency.value = 72;
        const f = filt('lowpass', 380);
        const am = AC.createGain(); am.gain.value = 0.6;
        const lfo = AC.createOscillator(); lfo.frequency.value = 11; const lg = AC.createGain(); lg.gain.value = 0.4;
        lfo.connect(lg).connect(am.gain);
        const g = AC.createGain(); g.gain.value = 0;
        o1.connect(f); o2.connect(f); f.connect(am).connect(g).connect(bus(0, 0.1));
        o1.start(); o2.start(); lfo.start();
        engine = { o1, o2, g, lfo };
      }
      const target = on && !muted ? 0.11 : 0;
      engine.g.gain.setTargetAtTime(target, t, 0.1);
      engine.o1.frequency.setTargetAtTime(on ? 44 : 36, t, 0.3);
      engine.o2.frequency.setTargetAtTime(on ? 88 : 72, t, 0.3);
      engine.lfo.frequency.setTargetAtTime(on ? 15 : 11, t, 0.3);
      if (on && !muted && t > nextClank) {
        nextClank = t + 0.07 + Math.random() * 0.05;
        const n = noiseSrc(t, 0.03), fl = filt('bandpass', 1600 + Math.random() * 900, 6), g = AC.createGain();
        env(g, t, 0.001, 0.07, 0.025);
        n.connect(fl).connect(g).connect(bus(0, 0));
      }
    },
  };
  root.SND = SND;
})(typeof self !== 'undefined' ? self : this);
