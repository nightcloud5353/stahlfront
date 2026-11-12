// STAHLFRONT – Darstellung, Steuerung, Menüs
(() => {
  'use strict';
  const S = window.SHARED;
  const { W, H, WEAPONS, PHYS, THEMES } = S;
  const R = S.TANK_R;
  const WMAP = {};
  WEAPONS.forEach((w, i) => { WMAP[w.id] = w; w.idx = i; });
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* egal */ } },
  };
  const PW_HASH = 'f4cf2e1b28f483f8f5633f6b0d9dee12a54a9e42c7ded4f397756a6406149db5';

  const ICONS = {
    shell: '<path d="M8 21 V10 Q8 4 12 2.5 Q16 4 16 10 V21 Z"/><path d="M8 16 H16"/>',
    bouncer: '<circle cx="18" cy="6" r="3.5"/><path d="M2 20 Q5 9 8 20 Q11 13 14 20 Q15.5 17 17 20"/>',
    cluster: '<circle cx="12" cy="12" r="4"/><path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7 7 M17 17 L19 19 M19 5 L17 7 M5 19 L7 17"/>',
    mg: '<path d="M2 6 H10 M2 12 H10 M2 18 H10"/><path d="M13 4 L21 6 L13 8 Z M13 10 L21 12 L13 14 Z M13 16 L21 18 L13 20 Z"/>',
    drill: '<path d="M12 22 L7 11 H17 Z"/><path d="M7 11 V4 H17 V11 M9.5 15 H14.5 M10.5 18.5 H13.5"/>',
    mine: '<path d="M4 18 Q4 11 12 11 Q20 11 20 18 Z"/><path d="M2 18 H22 M12 11 V7 M9 3.5 L12 7 L15 3.5"/>',
    strike: '<path d="M6 2 V9 M12 2 V9 M18 2 V9 M4 7 L6 9 L8 7 M10 7 L12 9 L14 7 M16 7 L18 9 L20 7"/><path d="M2 21 H22 M7 21 Q12 13 17 21"/>',
    ram: '<path d="M2 8 H7 M1 12 H7 M2 16 H7"/><path d="M10 6 H16 L21 12 L16 18 H10 Z"/>',
    repair: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 7.5 V16.5 M7.5 12 H16.5"/>',
    skip: '<path d="M4 5 H11 L4 12 H11 M13 12 H20 L13 19 H20"/>',
  };

  // ---------- Zustand ----------
  let link = null, myId = null, amHost = false, roomCode = null, hostHandle = null;
  let lobby = null, G = null;
  let terrainParts = [];
  let snapPrev = null, snapCur = null, snapAt = 0, snapInt = 50;
  let particles = [], texts = [], tracers = [], marks = [];
  const cam = { x: W / 2, y: H / 2, z: 1, manualUntil: 0, shake: 0, overview: false };
  let zoomNow = 1;
  const keys = { l: false, r: false, u: false, d: false, pu: false, pd: false };
  let overInfo = null, myTurn = false, lastTurnTank = 0, reconnecting = false, wantLeave = false;
  let wakeLock = null;

  // ---------- Bildschirme ----------
  const screens = ['gate', 'menu', 'lobby', 'hud'];
  function show(id) {
    for (const s of screens) $(s).classList.toggle('hidden', s !== id);
    document.body.classList.toggle('ingame', id === 'hud');
  }
  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    $('toasts').appendChild(el);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => el.remove(), 3300);
  }
  let bannerT = 0;
  function banner(html, ms) {
    const b = $('banner');
    b.innerHTML = html;
    b.classList.add('show');
    clearTimeout(bannerT);
    bannerT = setTimeout(() => b.classList.remove('show'), ms || 1800);
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Ton (alles synthetisch) ----------
  let AC = null, master = null, noiseBuf = null, engine = null;
  let muted = store.get('sf_mute') === '1';
  function audio() {
    if (!AC) {
      try {
        AC = new (window.AudioContext || window.webkitAudioContext)();
        master = AC.createGain(); master.gain.value = 0.7; master.connect(AC.destination);
        noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { AC = null; }
    }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function noise(dur, type, f0, f1, vol, delay) {
    const a = audio(); if (!a || muted) return;
    const t = a.currentTime + (delay || 0);
    const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t); src.stop(t + dur + 0.05);
  }
  function tone(freq, dur, type, vol, slide, delay) {
    const a = audio(); if (!a || muted) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator(); o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  const SFX = {
    boom(r) { const s = clamp(r / 40, 0.3, 1.6); noise(0.5 + s * 0.6, 'lowpass', 1400, 50, 0.5 + s * 0.3); tone(90, 0.5 + s * 0.3, 'sine', 0.6 * s, 30); },
    cannon() { noise(0.35, 'lowpass', 2500, 120, 0.55); tone(70, 0.3, 'sine', 0.7, 35); },
    mg() { noise(0.06, 'highpass', 2000, 1500, 0.35); tone(160, 0.05, 'square', 0.12, 80); },
    bounce() { tone(220, 0.07, 'triangle', 0.18, 140); },
    splash() { noise(0.6, 'bandpass', 1800, 300, 0.35); },
    beep() { tone(1400, 0.08, 'square', 0.12); },
    turn(mine) { if (mine) { tone(660, 0.12, 'square', 0.12); tone(880, 0.2, 'square', 0.12, null, 0.13); } else tone(520, 0.12, 'triangle', 0.1); },
    tick() { tone(1000, 0.04, 'square', 0.08); },
    pickup() { tone(700, 0.08, 'square', 0.12); tone(1050, 0.14, 'square', 0.12, null, 0.08); },
    whistle() { tone(1800, 1.1, 'sine', 0.06, 500); },
    drill() { noise(0.5, 'bandpass', 600, 200, 0.25); },
    click() { tone(400, 0.03, 'square', 0.06); },
  };
  function engineSound(on) {
    const a = AC; if (!a) return;
    if (!engine) {
      const o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48;
      const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const g = a.createGain(); g.gain.value = 0;
      o.connect(f).connect(g).connect(master); o.start();
      engine = { o, g };
    }
    const target = on && !muted ? 0.07 : 0;
    engine.g.gain.setTargetAtTime(target, a.currentTime, 0.08);
    engine.o.frequency.setTargetAtTime(on ? 62 : 48, a.currentTime, 0.2);
  }
  function setMuted(m) {
    muted = m; store.set('sf_mute', m ? '1' : '0');
    $('btnSound').classList.toggle('off', m);
    $('sndWaves').style.display = m ? 'none' : '';
    if (m) engineSound(false);
  }

  // ---------- Passwort ----------
  async function sha(s) {
    if (window.crypto && crypto.subtle) {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
    return '';
  }
  $('gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const h = await sha('stahlfront:' + $('pw').value.trim().toLowerCase());
    if (h === PW_HASH) { store.set('sf_pw', h); toMenu(); }
    else { $('gateErr').textContent = 'Falsches Passwort'; $('pw').select(); }
  });

  // ---------- Hauptmenü ----------
  function toMenu(status) {
    G = null; lobby = null; overInfo = null;
    show('menu');
    $('menuStatus').textContent = status || '';
    $('btnHost').disabled = false; $('btnJoin').disabled = false;
    releaseWake();
  }
  $('name').value = store.get('sf_name') || '';
  const hashCode = NET.normCode(location.hash.slice(1));
  if (hashCode.length === 4) $('code').value = hashCode;
  $('code').addEventListener('input', () => { $('code').value = NET.normCode($('code').value); });
  function myName() {
    const n = $('name').value.trim().slice(0, 12);
    if (!n) { $('menuStatus').textContent = 'Bitte zuerst einen Namen eingeben.'; $('name').focus(); return null; }
    store.set('sf_name', n);
    return n;
  }
  $('btnHost').addEventListener('click', () => {
    audio();
    const n = myName(); if (!n) return;
    $('menuStatus').textContent = 'Erstelle Raum …';
    $('btnHost').disabled = true; $('btnJoin').disabled = true;
    hostHandle = NET.host({
      onReady(code, l) {
        roomCode = code; amHost = true; attach(l);
        history.replaceState(null, '', '#' + code);
        link.send({ t: 'join', name: n });
      },
      onError(msg) { hostHandle && hostHandle.link.close(); hostHandle = null; toMenu(msg); },
      onWarn(msg) { if (G) toast(msg, 'warn'); },
    });
  });
  function doJoin(code, name) {
    $('menuStatus').textContent = 'Verbinde mit ' + code + ' …';
    $('btnHost').disabled = true; $('btnJoin').disabled = true;
    NET.join(code, {
      onReady(c, l) {
        roomCode = c; amHost = false; attach(l);
        history.replaceState(null, '', '#' + c);
        reconnecting = false; $('conn').classList.add('hidden');
        link.send({ t: 'join', name, token: store.get('sf_tok_' + c) || undefined });
      },
      onError(msg) {
        if (reconnecting) { $('connText').textContent = msg; $('btnReconnect').disabled = false; return; }
        toMenu(msg);
      },
    });
  }
  $('btnJoin').addEventListener('click', () => {
    audio();
    const n = myName(); if (!n) return;
    const c = NET.normCode($('code').value);
    if (c.length !== 4) { $('menuStatus').textContent = 'Der Raumcode hat 4 Zeichen.'; return; }
    doJoin(c, n);
  });
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

  // ---------- Verbindung ----------
  function attach(l) {
    link = l;
    link.onmessage = onMsg;
    link.onclose = (why) => {
      if (wantLeave) return;
      engineSound(false);
      $('connText').textContent = (why || 'Die Verbindung wurde getrennt.') + ' Ist der Gastgeber noch da?';
      $('conn').classList.remove('hidden');
      $('btnReconnect').disabled = false;
      link = null;
      setTimeout(() => { if (!link && !wantLeave && $('btnReconnect').disabled === false) reconnect(); }, 1200);
    };
    wantLeave = false;
  }
  function reconnect() {
    if (!roomCode) return toMenu();
    reconnecting = true;
    $('btnReconnect').disabled = true;
    $('connText').textContent = 'Verbinde neu …';
    doJoin(roomCode, store.get('sf_name') || 'Soldat');
  }
  $('btnReconnect').addEventListener('click', reconnect);
  $('btnConnMenu').addEventListener('click', () => { $('conn').classList.add('hidden'); leave(); });
  function leave() {
    wantLeave = true;
    try { if (link) link.close(); } catch (e) { /* egal */ }
    link = null; hostHandle = null; amHost = false; roomCode = null;
    history.replaceState(null, '', location.pathname + location.search);
    engineSound(false);
    toMenu();
  }
  const send = (m) => { if (link) link.send(m); };

  function onMsg(m) {
    switch (m.t) {
      case 'welcome':
        myId = m.id; amHost = !!m.host;
        if (roomCode) store.set('sf_tok_' + roomCode, m.token);
        break;
      case 'lobby': onLobby(m); break;
      case 'terrain': terrainParts[m.i] = m.d; break;
      case 'start': onStart(m); break;
      case 's': onSnap(m); break;
      case 'boom': onBoom(m); break;
      case 'carve': if (G) { carveTerrain(m.x, m.y, m.r, false); if (Math.random() < 0.5) dirt(m.x, m.y, 3); } break;
      case 'dmg': onDmg(m); break;
      case 'dead': onDead(m); break;
      case 'fx': onFx(m); break;
      case 'turn': onTurn(m); break;
      case 'switched': if (G) { lastTurnTank = m.tank; cam.manualUntil = 0; const tk = G.tankInfo[m.tank]; if (tk) toast(`Panzer gewechselt: „${tk.cs}“`); } break;
      case 'msg': toast(m.text, m.k === 'err' ? 'err' : m.k === 'warn' || m.k === 'out' || m.k === 'good' ? 'warn' : ''); break;
      case 'over': onOver(m); break;
      case 'kicked': wantLeave = true; if (link) link.close(); link = null; roomCode = null; toMenu('Du wurdest vom Gastgeber entfernt.'); break;
      case 'replaced': wantLeave = true; toMenu('Das Spiel wurde in einem anderen Fenster geöffnet.'); break;
      default:
    }
  }

  // ---------- Lobby ----------
  function onLobby(m) {
    lobby = m;
    if (m.phase === 'lobby') {
      G = null; overInfo = null; myTurn = false;
      for (const id of ['over', 'gameMenu', 'weaponMenu']) $(id).classList.add('hidden');
      show('lobby');
      engineSound(false);
    }
    renderLobby();
  }
  function seg(el, opts, cur, onPick) {
    el.innerHTML = '';
    for (const [val, label] of opts) {
      const b = document.createElement('button');
      b.textContent = label;
      if (val === cur) b.classList.add('on');
      b.addEventListener('click', () => { SFX.click(); onPick(val); });
      el.appendChild(b);
    }
  }
  function renderLobby() {
    if (!lobby) return;
    const host = lobby.host === myId;
    amHost = host;
    $('lobbyCode').textContent = roomCode || '----';
    const pl = $('plist'); pl.innerHTML = '';
    const active = lobby.players.filter((p) => !p.spec);
    $('plCount').textContent = `Spieler ${active.length} / ${S.MAX_PLAYERS}`;
    for (const p of lobby.players) {
      const li = document.createElement('li');
      if (!p.connected) li.classList.add('off');
      const sw = document.createElement('span'); sw.className = 'sw';
      sw.style.background = p.spec ? '#555' : S.TEAM_COLORS[p.color];
      li.appendChild(sw);
      const nm = document.createElement('span'); nm.textContent = p.name; li.appendChild(nm);
      const tags = [];
      if (p.id === lobby.host) tags.push(['GASTGEBER', 'host']);
      if (p.id === myId) tags.push(['DU', '']);
      if (p.spec) tags.push(['ZUSCHAUER', '']);
      if (!p.connected) tags.push(['OFFLINE', '']);
      for (const [tx, cl] of tags) { const tg = document.createElement('span'); tg.className = 'tag ' + cl; tg.textContent = tx; li.appendChild(tg); }
      if (host && p.id !== myId && lobby.phase === 'lobby') {
        const k = document.createElement('button'); k.className = 'kick'; k.textContent = '✕'; k.setAttribute('aria-label', p.name + ' entfernen');
        k.addEventListener('click', () => send({ t: 'kick', id: p.id }));
        li.appendChild(k);
      }
      pl.appendChild(li);
    }
    const st = lobby.settings;
    $('settingsHost').classList.toggle('hidden', !host);
    $('btnStart').classList.toggle('hidden', !host);
    $('waitHost').classList.toggle('hidden', host);
    $('hostWarn').classList.toggle('hidden', !host);
    const themeName = st.theme < 0 ? 'Zufall' : THEMES[st.theme].name;
    $('settingsView').textContent = host ? '' : `${st.tanks} Panzer pro Spieler · ${st.turnTime} s Zugzeit · Karte: ${themeName}`;
    if (host) {
      const upd = (patch) => send(Object.assign({ t: 'settings' }, st, patch));
      seg($('segTanks'), [[1, '1'], [2, '2'], [3, '3'], [4, '4']], st.tanks, (v) => upd({ tanks: v }));
      seg($('segTime'), [[20, '20 s'], [30, '30 s'], [45, '45 s'], [60, '60 s']], st.turnTime, (v) => upd({ turnTime: v }));
      seg($('segTheme'), [[-1, 'Zufall']].concat(THEMES.map((t, i) => [i, t.name])), st.theme, (v) => upd({ theme: v }));
      const ready = active.filter((p) => p.connected).length >= 2;
      $('btnStart').disabled = !ready;
      $('btnStart').textContent = ready ? 'GEFECHT STARTEN' : 'WARTE AUF MITSPIELER';
    }
  }
  $('btnStart').addEventListener('click', () => { audio(); send({ t: 'start' }); });
  $('btnLeave').addEventListener('click', () => {
    if (amHost && !confirm('Du bist Gastgeber. Wenn du gehst, wird der Raum für alle geschlossen. Wirklich verlassen?')) return;
    leave();
  });
  $('btnShare').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#' + roomCode;
    const text = `Komm ins Gefecht! STAHLFRONT – Raumcode ${roomCode}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Stahlfront', text, url }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text + '\n' + url); toast('Einladungslink kopiert'); }
    catch (e) { prompt('Link kopieren:', url); }
  });

  // ---------- Spielstart ----------
  function onStart(m) {
    const theme = THEMES[m.theme] || THEMES[0];
    const rle = [].concat(...terrainParts.filter(Boolean));
    terrainParts = [];
    const mask = new Uint8Array(W * H);
    let i = 0, v = 0;
    for (const n of rle) { if (v) mask.fill(1, i, i + n); i += n; v ^= 1; }
    const tankInfo = {};
    m.teams.forEach((t, ti) => t.tanks.forEach((k) => { tankInfo[k.id] = { team: ti, cs: k.cs }; }));
    G = {
      theme, themeIdx: m.theme, teams: m.teams, tankInfo, mask, waterY: m.wy,
      myTeam: m.teams.findIndex((t) => t.pid === myId),
      terrain: buildTerrain(mask, theme), hills: makeHills(), dead: {},
    };
    snapPrev = snapCur = null;
    particles = []; texts = []; tracers = []; marks = [];
    cam.overview = false; cam.z = 1; cam.manualUntil = 0;
    overInfo = null;
    $('over').classList.add('hidden');
    $('weaponMenu').classList.add('hidden');
    $('gameMenu').classList.add('hidden');
    buildTeamsPanel();
    show('hud');
    requestWake();
    if (G.myTeam < 0) toast('Du schaust zu – nächste Runde bist du dabei.', 'warn');
  }

  function buildTerrain(mask, th) {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(W, H);
    const d = img.data;
    const hash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
    for (let x = 0; x < W; x++) {
      let depth = 0;
      const sx = Math.sin(x * 0.045);
      for (let y = 0; y < H; y++) {
        const k = y * W + x;
        if (!mask[k]) { depth = 0; continue; }
        depth++;
        const o = k * 4;
        const n = hash(x, y);
        let c;
        if (depth <= 3) c = th.top1;
        else if (depth <= 7) c = th.top2;
        else {
          const t = 0.5 + 0.25 * (Math.sin(x * 0.045 + Math.sin(y * 0.031) * 2.2) + Math.sin(y * 0.07 + sx));
          const dk = 1 - Math.min(depth, 300) / 300 * 0.28;
          const nz = (n - 0.5) * 16;
          d[o] = clamp((lerp(th.d1[0], th.d2[0], t) + nz) * dk, 0, 255);
          d[o + 1] = clamp((lerp(th.d1[1], th.d2[1], t) + nz) * dk, 0, 255);
          d[o + 2] = clamp((lerp(th.d1[2], th.d2[2], t) + nz) * dk, 0, 255);
          if (n > 0.996) { d[o] += 40; d[o + 1] += 38; d[o + 2] += 32; }
          d[o + 3] = 255;
          continue;
        }
        const nz = (n - 0.5) * 18;
        d[o] = clamp(c[0] + nz, 0, 255); d[o + 1] = clamp(c[1] + nz, 0, 255); d[o + 2] = clamp(c[2] + nz, 0, 255); d[o + 3] = 255;
      }
    }
    cx.putImageData(img, 0, 0);
    // Rückwand: dunkle Erde unter der ursprünglichen Oberfläche – Krater und Höhlen wirken dadurch wie Löcher im Boden
    const back = document.createElement('canvas');
    back.width = W; back.height = H;
    const bx = back.getContext('2d');
    const col = `rgb(${Math.round(th.d2[0] * 0.58)},${Math.round(th.d2[1] * 0.58)},${Math.round(th.d2[2] * 0.58)})`;
    bx.fillStyle = col;
    bx.beginPath(); bx.moveTo(0, H);
    for (let x = 0; x < W; x += 2) {
      let run = 0, top = H;
      for (let y = 0; y < H; y++) {
        if (mask[y * W + x]) { run++; if (run >= 40) { top = y - 39; break; } } else run = 0;
      }
      bx.lineTo(x, top + 6);
    }
    bx.lineTo(W, H); bx.closePath(); bx.fill();
    bx.globalAlpha = 0.18; bx.fillStyle = '#000';
    for (let i = 0; i < 900; i++) { bx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 6, 1 + Math.random() * 3); }
    return { cv, cx, back };
  }
  function carveTerrain(x, y, r, scorch) {
    if (!G) return;
    const t = G.terrain.cx;
    t.save();
    if (scorch) {
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = 'rgba(20, 16, 10, 0.5)';
      t.beginPath(); t.arc(x, y, r + 5, 0, Math.PI * 2); t.fill();
    }
    t.globalCompositeOperation = 'destination-out';
    t.beginPath(); t.arc(x, y, r, 0, Math.PI * 2); t.fill();
    t.restore();
    const m = G.mask, cx = Math.round(x), cy = Math.round(y);
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy; if (yy < 0 || yy >= H) continue;
      const sp = Math.floor(Math.sqrt(r * r - dy * dy));
      const x0 = Math.max(0, cx - sp), x1 = Math.min(W - 1, cx + sp);
      if (x0 <= x1) m.fill(0, yy * W + x0, yy * W + x1 + 1);
    }
  }
  const solid = (x, y) => { x = Math.floor(x); y = Math.floor(y); return x >= 0 && x < W && y >= 0 && y < H && G.mask[y * W + x] === 1; };
  function makeHills() {
    const L = [];
    for (let l = 0; l < 2; l++) {
      const w = [];
      for (let i = 0; i < 4; i++) w.push({ a: (60 - l * 20) / (i + 1) * (0.6 + Math.random() * 0.6), f: (0.002 + Math.random() * 0.002) * (i + 1) * 1.7, p: Math.random() * 6 });
      L.push(w);
    }
    const smokes = [];
    for (let i = 0; i < 3; i++) smokes.push({ x: 200 + Math.random() * (W - 400), seed: Math.random() * 100 });
    return { L, smokes };
  }

  // ---------- Schnappschüsse ----------
  function onSnap(m) {
    if (!G) return;
    const tanks = new Map();
    for (const a of m.b) tanks.set(a[0], { id: a[0], x: a[1], y: a[2], hp: a[3], face: a[4], aim: a[5], alive: a[6] === 1, tilt: a[7] / 100, dr: a[8] === 1, pw: a[9], gr: a[10] === 1 });
    const proj = new Map();
    for (const a of m.p) proj.set(a[0], { id: a[0], type: a[1], x: a[2], y: a[3], vx: a[4], vy: a[5], fuse: a[6], armed: a[7] === 1 });
    const objs = new Map();
    for (const a of m.o || []) objs.set(a[0], { id: a[0], kind: a[1], x: a[2], y: a[3], chute: a[4] === 1 });
    const now = performance.now();
    if (snapCur) snapInt = clamp(now - snapAt, 16, 220);
    snapPrev = snapCur;
    snapCur = { m, tanks, proj, objs };
    snapAt = now;
    G.waterY = m.wy;
    updateHud(m, tanks);
  }
  function interp(kind, id) {
    const cur = snapCur && snapCur[kind].get(id);
    if (!cur) return null;
    const prev = snapPrev && snapPrev[kind].get(id);
    if (!prev) return cur;
    const a = clamp((performance.now() - snapAt) / snapInt, 0, 1);
    const o = Object.assign({}, cur);
    o.x = lerp(prev.x, cur.x, a); o.y = lerp(prev.y, cur.y, a);
    if (cur.aim !== undefined) { o.aim = lerp(prev.aim, cur.aim, a); o.tilt = lerp(prev.tilt, cur.tilt, a); }
    return o;
  }

  // ---------- HUD ----------
  let hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function buildTeamsPanel() {
    const el = $('teams');
    el.innerHTML = '<div class="title">STAHLFRONT</div>';
    G.teams.forEach((t, i) => {
      const row = document.createElement('div'); row.className = 't'; row.id = 'tm' + i;
      row.innerHTML = `<span>${esc(t.name)}</span><div class="bar"><div style="background:${S.TEAM_COLORS[t.color]};width:100%"></div></div>`;
      el.appendChild(row);
    });
    hudCache = {};
  }
  function updateHud(m, tanks) {
    const team = G.teams[m.tt];
    myTurn = !!team && team.pid === myId && (m.ph === 'turn' || m.ph === 'retreat');
    // Teams
    G.teams.forEach((t, i) => {
      let hp = 0, alive = 0;
      for (const k of t.tanks) { const s = tanks.get(k.id); if (s && s.alive) { hp += s.hp; alive++; } }
      const row = $('tm' + i); if (!row) return;
      row.classList.toggle('cur', i === m.tt);
      row.classList.toggle('out', alive === 0);
      row.querySelector('.bar div').style.width = Math.round((hp / (t.tanks.length * 100)) * 100) + '%';
    });
    // Zuganzeige
    if (team) {
      const k = `${m.tt}|${m.tb}|${m.ph}`;
      if (hudCache.turn !== k) {
        hudCache.turn = k;
        const info = G.tankInfo[m.tb];
        $('turnInfo').innerHTML = m.ph === 'over' ? 'GEFECHT BEENDET' :
          `<i class="sw" style="background:${S.TEAM_COLORS[team.color]}"></i>ZUG: <b style="color:#F2C766">${esc(team.name.toUpperCase())}</b>${info ? ` <small style="color:#B3B096">„${esc(info.cs)}“</small>` : ''}`;
      }
    }
    const tm = $('timer');
    if (m.ph === 'turn' || m.ph === 'retreat') {
      setText('timer', String(m.tm));
      tm.classList.toggle('low', m.tm <= 5);
      tm.classList.remove('idle');
      if (myTurn && m.ph === 'turn' && m.tm <= 5 && hudCache.lastTick !== m.tm) { hudCache.lastTick = m.tm; SFX.tick(); }
    } else { setText('timer', '··'); tm.classList.add('idle'); tm.classList.remove('low'); }
    // Wind
    const wi = m.wi;
    setText('windVal', wi === 0 ? '0' : wi < 0 ? `◀ ${-wi}` : `${wi} ▶`);
    const wf = $('windFill');
    const w = Math.abs(wi) * 4;
    wf.style.width = w + 'px'; wf.style.left = (wi < 0 ? 40 - w : 40) + 'px';
    // Steuerung
    $('controls').classList.toggle('hidden', !myTurn);
    if (!myTurn && Object.values(keys).some(Boolean)) releaseKeys();
    if (myTurn) {
      const t = tanks.get(m.tb);
      const wpn = WMAP[m.wp];
      if (t) { setText('roAim', Math.round(t.aim) + '°'); setText('roPow', String(t.pw)); }
      $('fuelFill').style.width = m.fu + '%';
      if (hudCache.wp !== m.wp) { hudCache.wp = m.wp; $('wIcon').innerHTML = ICONS[m.wp]; setText('wName', wpn.short); }
      const ammo = m.am[wpn.idx];
      setText('wAmmo', ammo < 0 ? '∞' : String(ammo));
      const acting = m.ph === 'turn';
      $('btnFire').disabled = !acting || wpn.mode === 'target';
      $('btnFire').textContent = wpn.mode === 'target' ? 'ZIEL' : wpn.mode === 'now' && wpn.id !== 'mine' && wpn.id !== 'ram' ? 'OK' : 'FEUER';
      $('btnWeapon').disabled = !acting;
      for (const b of document.querySelectorAll('.cbtn.sm')) b.disabled = !acting;
      const needsAim = wpn.mode === 'fire' || wpn.mode === 'aim';
      $('readout').style.opacity = needsAim ? '1' : '0.55';
      let hint = '';
      if (m.ph === 'retreat') hint = 'RÜCKZUG – schnell in Deckung!';
      else if (wpn.mode === 'target') hint = 'Ziel auf der Karte antippen';
      else if (m.sw) hint = 'Tab / Doppeltipp auf Panzer = Panzer wechseln';
      setHint(hint);
      if (!$('weaponMenu').classList.contains('hidden')) renderWeapons(m);
    } else {
      setHint('');
      if (!$('weaponMenu').classList.contains('hidden')) $('weaponMenu').classList.add('hidden');
    }
  }
  function setHint(h) {
    if (hudCache.hint === h) return;
    hudCache.hint = h;
    $('hint').textContent = h;
    $('hint').classList.toggle('show', !!h);
  }

  // ---------- Munitionsmenü ----------
  function renderWeapons(m) {
    const grid = $('wgrid');
    const key = m.wp + '|' + m.am.join(',') + '|' + m.rd;
    if (grid.dataset.key === key) return;
    grid.dataset.key = key;
    grid.innerHTML = '';
    WEAPONS.forEach((w, i) => {
      const b = document.createElement('button');
      b.className = 'wbtn' + (w.id === m.wp ? ' on' : '');
      const ammo = m.am[i];
      const locked = w.from > m.rd;
      b.disabled = ammo === 0 || locked;
      b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[w.id]}</svg>${esc(w.name)}<i>${locked ? 'ab Zug ' + w.from : ammo < 0 ? '∞' : ammo}</i><kbd>${(i + 1) % 10}</kbd>`;
      b.addEventListener('click', () => { pickWeapon(w.id); $('weaponMenu').classList.add('hidden'); });
      b.addEventListener('pointerenter', () => { $('winfo').innerHTML = `<b>${esc(w.name)}:</b> ${esc(w.info)}`; });
      grid.appendChild(b);
    });
    const cw = WMAP[m.wp];
    $('winfo').innerHTML = `<b>${esc(cw.name)}:</b> ${esc(cw.info)}`;
  }
  function pickWeapon(id) {
    const m = snapCur && snapCur.m;
    if (!m || !myTurn) return;
    const w = WMAP[id];
    if (m.am[w.idx] === 0) { toast('Keine Munition mehr', 'err'); return; }
    if (w.from > m.rd) { toast(`${w.name} erst ab deinem ${w.from}. Zug`, 'err'); return; }
    send({ t: 'weapon', w: id });
    SFX.click();
    toast(w.name + ' geladen');
  }
  function toggleWeapons() {
    if (!myTurn || !snapCur) return;
    const wm = $('weaponMenu');
    if (wm.classList.contains('hidden')) { $('wgrid').dataset.key = ''; renderWeapons(snapCur.m); wm.classList.remove('hidden'); }
    else wm.classList.add('hidden');
  }
  $('btnWeapon').addEventListener('click', toggleWeapons);
  $('btnWClose').addEventListener('click', () => $('weaponMenu').classList.add('hidden'));
  $('weaponMenu').addEventListener('click', (e) => { if (e.target === $('weaponMenu')) $('weaponMenu').classList.add('hidden'); });

  // ---------- Steuerung ----------
  function sendKeys() { send({ t: 'in', k: Object.assign({}, keys) }); }
  function setKey(k, on) {
    if (keys[k] === on) return;
    keys[k] = on;
    if (on) audio();
    sendKeys();
  }
  function releaseKeys() {
    for (const k in keys) keys[k] = false;
    for (const b of document.querySelectorAll('.cbtn.on')) b.classList.remove('on');
    sendKeys();
  }
  function fire() {
    if (!myTurn || !snapCur || snapCur.m.ph !== 'turn') return;
    const w = WMAP[snapCur.m.wp];
    if (w.mode === 'target') { toast('Ziel auf der Karte antippen', 'warn'); return; }
    audio();
    send({ t: 'fire' });
    cam.manualUntil = 0;
  }
  for (const b of document.querySelectorAll('#controls [data-k]')) {
    const k = b.dataset.k;
    if (k === 'fire') {
      b.addEventListener('click', fire);
      continue;
    }
    const down = (e) => { e.preventDefault(); if (b.disabled) return; try { b.setPointerCapture(e.pointerId); } catch (err) { /* egal */ } b.classList.add('on'); setKey(k, true); };
    const up = (e) => { e.preventDefault(); b.classList.remove('on'); setKey(k, false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', KeyE: 'pu', Equal: 'pu', NumpadAdd: 'pu', BracketRight: 'pu', KeyQ: 'pd', Minus: 'pd', NumpadSubtract: 'pd', Slash: 'pd' };
  window.addEventListener('keydown', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!G) return;
    if (e.code === 'KeyO') { toggleOverview(); return; }
    if (e.code === 'Escape') { $('weaponMenu').classList.add('hidden'); $('gameMenu').classList.add('hidden'); $('help').classList.add('hidden'); return; }
    if (!myTurn) return;
    const k = KEYMAP[e.code];
    if (k) { e.preventDefault(); if (!e.repeat) setKey(k, true); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) fire(); return; }
    if (e.code === 'Tab') { e.preventDefault(); if (snapCur && snapCur.m.sw) send({ t: 'switch' }); else toggleWeapons(); return; }
    if (e.code === 'KeyM') { toggleWeapons(); return; }
    const dm = /^Digit(\d)$/.exec(e.code);
    if (dm) { const i = (Number(dm[1]) + 9) % 10; if (WEAPONS[i]) pickWeapon(WEAPONS[i].id); }
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) setKey(k, false); });
  window.addEventListener('blur', () => { if (Object.values(keys).some(Boolean)) releaseKeys(); });

  // Karte: verschieben, zoomen, Ziel antippen, Doppeltipp = Panzer wechseln
  const canvas = $('c');
  const ctx = canvas.getContext('2d');
  const ptrs = new Map();
  let pinch = null, lastTap = 0;
  canvas.addEventListener('pointerdown', (e) => {
    audio();
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 8) p.moved = true;
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.z = clamp(pinch.z * (d / pinch.d), 0.3, 2.4);
      cam.overview = false;
      cam.manualUntil = performance.now() + 4000;
    } else if (p.moved && ptrs.size === 1) {
      cam.x -= dx / zoomNow; cam.y -= dy / zoomNow;
      cam.manualUntil = performance.now() + 4000;
    }
  });
  const ptrUp = (e) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (!p || p.moved || e.type === 'pointercancel') return;
    const now = performance.now();
    const wx = (p.x - innerWidth / 2) / zoomNow + cam.x, wy = (p.y - innerHeight / 2) / zoomNow + cam.y;
    if (myTurn && snapCur && snapCur.m.ph === 'turn') {
      const w = WMAP[snapCur.m.wp];
      if (w.mode === 'target') {
        send({ t: 'target', x: wx, y: wy });
        marks.push({ x: wx, y: wy, t: now });
        return;
      }
      if (now - lastTap < 350 && snapCur.m.sw) { send({ t: 'switch' }); lastTap = 0; return; }
    }
    lastTap = now;
  };
  canvas.addEventListener('pointerup', ptrUp);
  canvas.addEventListener('pointercancel', ptrUp);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.z = clamp(cam.z * (e.deltaY > 0 ? 0.9 : 1.1), 0.3, 2.4);
    cam.overview = false;
  }, { passive: false });
  function toggleOverview() { cam.overview = !cam.overview; if (!cam.overview) cam.z = 1; cam.manualUntil = cam.overview ? Infinity : 0; }
  $('btnZoom').addEventListener('click', toggleOverview);
  $('btnSound').addEventListener('click', () => { audio(); setMuted(!muted); });
  $('btnMenu').addEventListener('click', () => {
    $('btnAbort').classList.toggle('hidden', !amHost);
    $('gameMenu').classList.remove('hidden');
  });
  $('btnGMClose').addEventListener('click', () => $('gameMenu').classList.add('hidden'));
  $('btnAbort').addEventListener('click', () => { if (confirm('Gefecht für alle abbrechen und zurück zur Lobby?')) { send({ t: 'lobby' }); $('gameMenu').classList.add('hidden'); } });
  $('btnQuit').addEventListener('click', () => {
    if (amHost && !confirm('Du bist Gastgeber – das Spiel endet dann für alle. Wirklich verlassen?')) return;
    $('gameMenu').classList.add('hidden');
    leave();
  });
  $('btnFull').addEventListener('click', () => {
    const d = document.documentElement;
    const req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (req) { req.call(d).then(() => { try { screen.orientation.lock('landscape'); } catch (e) { /* egal */ } }).catch(() => toast('Vollbild nicht möglich – auf dem iPhone: Teilen → Zum Home-Bildschirm', 'warn')); }
    else toast('Auf dem iPhone: Teilen → „Zum Home-Bildschirm“ für Vollbild', 'warn');
    $('gameMenu').classList.add('hidden');
  });
  const openHelp = () => $('help').classList.remove('hidden');
  $('btnHelp').addEventListener('click', openHelp);
  $('btnHelp2').addEventListener('click', () => { $('gameMenu').classList.add('hidden'); openHelp(); });
  $('btnHelpClose').addEventListener('click', () => $('help').classList.add('hidden'));
  $('btnRematch').addEventListener('click', () => send({ t: 'rematch' }));
  $('btnToLobby').addEventListener('click', () => send({ t: 'lobby' }));
  window.addEventListener('beforeunload', (e) => { if (amHost && link) { e.preventDefault(); e.returnValue = ''; } });

  async function requestWake() {
    try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* egal */ }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* egal */ } wakeLock = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && G) requestWake(); });

  // ---------- Ereignisse ----------
  function tankPos(id) { const t = interp('tanks', id); return t ? [t.x, t.y] : null; }
  function onTurn(m) {
    if (!G) return;
    releaseKeys();
    $('weaponMenu').classList.add('hidden');
    lastTurnTank = m.tank;
    cam.manualUntil = 0;
    if (cam.overview) { cam.overview = false; cam.z = 1; }
    const team = G.teams[m.team];
    const mine = team.pid === myId;
    const info = G.tankInfo[m.tank];
    if (mine) {
      banner(`DEIN ZUG<small>Panzer „${esc(info ? info.cs : '')}“</small>`, 1600);
      try { navigator.vibrate && navigator.vibrate([60, 40, 120]); } catch (e) { /* egal */ }
    } else banner(`<span style="color:${S.TEAM_COLORS[team.color]}">${esc(team.name.toUpperCase())}</span><small>ist am Zug</small>`, 1300);
    SFX.turn(mine);
  }
  function onBoom(m) {
    if (!G) return;
    carveTerrain(m.x, m.y, m.r, true);
    explosionFx(m.x, m.y, m.r, m.k);
    SFX.boom(m.r);
  }
  function onDmg(m) {
    const p = tankPos(m.id);
    if (!p) return;
    texts.push({ x: p[0], y: p[1] - 30, text: '-' + m.a, t: performance.now(), big: m.a >= 30 });
  }
  function onDead(m) {
    if (!G) return;
    const info = G.tankInfo[m.id];
    if (!info) return;
    const team = G.teams[info.team];
    toast(`${team.name}: „${info.cs}“ ${m.how === 'drown' ? 'versenkt' : 'zerstört'}`, 'warn');
  }
  function onFx(m) {
    if (!G) return;
    switch (m.k) {
      case 'shot': {
        SFX.cannon();
        cam.manualUntil = 0;
        for (let i = 0; i < 10; i++) particles.push({ x: m.x, y: m.y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 - 0.5, life: 0, max: 30 + Math.random() * 20, size: 4 + Math.random() * 4, col: '#9A9A90', type: 'smoke' });
        particles.push({ x: m.x, y: m.y, vx: 0, vy: 0, life: 0, max: 6, size: 10, col: '#FFE7A0', type: 'flash' });
        break;
      }
      case 'tracer': SFX.mg(); tracers.push({ x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, t: performance.now() }); break;
      case 'splash': {
        SFX.splash();
        for (let i = 0; i < (m.big ? 30 : 14); i++) particles.push({ x: m.x + (Math.random() - 0.5) * 10, y: m.y, vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 4, life: 0, max: 50, size: 2 + Math.random() * 2, col: '#BFD8E0', type: 'water' });
        break;
      }
      case 'bounce': SFX.bounce(); break;
      case 'trigger': SFX.beep(); SFX.beep(); break;
      case 'drill': SFX.drill(); break;
      case 'strike': SFX.whistle(); marks.push({ x: m.x, y: m.y, t: performance.now(), strike: true }); break;
      case 'ram': SFX.cannon(); break;
      case 'repair': {
        const p = tankPos(m.id); SFX.pickup();
        if (p) { texts.push({ x: p[0], y: p[1] - 30, text: '+' + m.a, t: performance.now(), heal: true }); for (let i = 0; i < 12; i++) particles.push({ x: p[0] + (Math.random() - 0.5) * 20, y: p[1], vx: 0, vy: -0.6 - Math.random(), life: 0, max: 50, size: 3, col: '#9BE07A', type: 'plus' }); }
        break;
      }
      case 'pickup': {
        SFX.pickup();
        texts.push({ x: m.x, y: m.y - 24, text: m.text, t: performance.now(), heal: true });
        break;
      }
      default:
    }
  }
  function onOver(m) {
    if (!G) return;
    overInfo = m;
    releaseKeys();
    engineSound(false);
    setTimeout(() => {
      if (!overInfo) return;
      const w = m.winner >= 0 ? G.teams[m.winner] : null;
      $('overTitle').textContent = w ? `${w.name.toUpperCase()} SIEGT` : 'UNENTSCHIEDEN';
      $('overTitle').style.color = w ? S.TEAM_COLORS[w.color] : '';
      const ol = $('rankList'); ol.innerHTML = '';
      for (const ti of m.rank) {
        const t = G.teams[ti]; if (!t) continue;
        const li = document.createElement('li');
        li.innerHTML = `<span class="sw" style="background:${S.TEAM_COLORS[t.color]}"></span>${esc(t.name)}${t.pid === myId ? ' <small>(du)</small>' : ''}`;
        ol.appendChild(li);
      }
      $('btnRematch').classList.toggle('hidden', !amHost);
      $('btnToLobby').classList.toggle('hidden', !amHost);
      $('overWait').classList.toggle('hidden', amHost);
      $('over').classList.remove('hidden');
      if (w && w.pid === myId) { SFX.pickup(); banner('SIEG!', 2500); }
    }, 1600);
  }

  // ---------- Partikel ----------
  function explosionFx(x, y, r, kind) {
    const th = G.theme;
    const dirtCol = `rgb(${th.d1[0]},${th.d1[1]},${th.d1[2]})`;
    particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 10, size: r * 1.5, col: '#FFE7A0', type: 'flash' });
    particles.push({ x, y, vx: 0, vy: 0, life: 0, max: 18, size: r, col: '#FFFFFF', type: 'ring' });
    const n = Math.min(40, 10 + r);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * r * 0.12 + 1;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 0, max: 18 + Math.random() * 18, size: 2 + Math.random() * 3, col: Math.random() < 0.5 ? '#FFB547' : '#FF7A2A', type: 'spark' });
    }
    for (let i = 0; i < n * 0.6; i++) {
      const a = -Math.PI * Math.random(), s = Math.random() * r * 0.13 + 1.5;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 0, max: 60 + Math.random() * 40, size: 1.5 + Math.random() * 2.5, col: dirtCol, type: 'dirt' });
    }
    for (let i = 0; i < 4 + r / 8; i++) particles.push({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r * 0.6, vx: (Math.random() - 0.5) * 0.6, vy: -0.4 - Math.random() * 0.5, life: 0, max: 80 + Math.random() * 60, size: r * 0.35 + Math.random() * 8, col: '#4A4A44', type: 'smoke' });
    cam.shake = Math.max(cam.shake, Math.min(16, r / 3));
  }
  function dirt(x, y, n) {
    const th = G.theme;
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 2, vy: -Math.random() * 2, life: 0, max: 40, size: 2, col: `rgb(${th.d1[0]},${th.d1[1]},${th.d1[2]})`, type: 'dirt' });
  }

  // ---------- Zeichnen ----------
  let vw = 0, vh = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    vw = innerWidth; vh = innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  function frame(now) {
    requestAnimationFrame(frame);
    if (canvas.width !== Math.round(innerWidth * Math.min(window.devicePixelRatio || 1, 2))) resize();
    try {
      if (G && snapCur) drawGame(now);
      else drawBackdrop(now);
    } catch (e) { console.error(e); }
  }

  function drawSky(th, now, px) {
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, th.sky1); g.addColorStop(1, th.sky2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
  }
  function drawBackdrop(now) {
    const th = THEMES[0];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky(th, now);
    const t = now / 1000;
    for (let s = 0; s < 2; s++) {
      const bx = vw * (0.25 + s * 0.5);
      for (let i = 0; i < 12; i++) {
        const k = ((t * 0.15 + i / 12 + s * 0.37) % 1);
        ctx.fillStyle = `rgba(70,74,72,${0.35 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(bx + Math.sin(k * 4 + s) * 20 + k * 60, vh * 0.62 - k * vh * 0.55, 14 + k * 50, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(138,143,128,.7)';
    ctx.beginPath(); ctx.moveTo(0, vh);
    for (let x = 0; x <= vw; x += 10) ctx.lineTo(x, vh * 0.66 + Math.sin(x * 0.006) * 30 + Math.sin(x * 0.017) * 12);
    ctx.lineTo(vw, vh); ctx.fill();
    ctx.fillStyle = '#4E4535';
    ctx.beginPath(); ctx.moveTo(0, vh);
    for (let x = 0; x <= vw; x += 10) ctx.lineTo(x, vh * 0.8 + Math.sin(x * 0.009 + 1) * 24 + Math.sin(x * 0.03) * 6);
    ctx.lineTo(vw, vh); ctx.fill();
  }

  function camTarget() {
    const m = snapCur.m;
    let best = null;
    for (const p of snapCur.proj.values()) {
      if (p.type === 'mine' && (p.armed || Math.abs(p.vx) + Math.abs(p.vy) < 0.2)) continue;
      if (!best || p.id > best.id) best = p;
    }
    if (best) { const p = interp('proj', best.id); return [p.x, p.y]; }
    for (const o of snapCur.objs.values()) if (o.kind === 'c' && o.chute && m.ph === 'settle') return [o.x, o.y];
    const t = interp('tanks', m.tb || lastTurnTank);
    if (t) return [t.x, t.y - 40];
    return null;
  }

  function drawGame(now) {
    const th = G.theme, m = snapCur.m;
    const base = Math.min(vw / 950, vh / 470);
    const fit = Math.min(vw / W, vh / (H - 60));
    const zTarget = cam.overview ? fit : clamp(base * cam.z, fit, base * 2.4);
    zoomNow = lerp(zoomNow || zTarget, zTarget, 0.15);
    const z = zoomNow;
    if (now > cam.manualUntil) {
      const tg = camTarget();
      if (tg) { cam.x = lerp(cam.x, tg[0], 0.08); cam.y = lerp(cam.y, tg[1], 0.08); }
    }
    if (cam.overview) { cam.x = lerp(cam.x, W / 2, 0.15); cam.y = lerp(cam.y, H / 2 + 30, 0.15); }
    const hw = vw / 2 / z, hh = vh / 2 / z;
    cam.x = W > 2 * hw ? clamp(cam.x, hw - 60, W - hw + 60) : W / 2;
    cam.y = clamp(cam.y, hh - 350, Math.max(hh - 350, H - hh + 20));
    let sx = 0, sy = 0;
    if (cam.shake > 0.3) { sx = (Math.random() - 0.5) * cam.shake; sy = (Math.random() - 0.5) * cam.shake; cam.shake *= 0.88; } else cam.shake = 0;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky(th, now);
    drawParallax(th, now, z);

    const ox = vw / 2 - (cam.x + sx) * z, oy = vh / 2 - (cam.y + sy) * z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);

    ctx.drawImage(G.terrain.back, 0, 0);
    ctx.drawImage(G.terrain.cv, 0, 0);
    // Objekte
    for (const o of snapCur.objs.values()) { const p = interp('objs', o.id) || o; drawObj(p, now); }
    // Panzer: erst Wracks, dann lebende
    const list = [...snapCur.tanks.values()].filter((t) => !t.dr).map((t) => interp('tanks', t.id));
    for (const t of list) if (!t.alive) drawTank(t, now, false);
    for (const t of list) if (t.alive) drawTank(t, now, t.id === m.tb && (m.ph === 'turn' || m.ph === 'retreat'));
    // Zielhilfe
    if (myTurn && m.ph === 'turn') drawAimHelp(m, now);
    // Geschosse
    for (const p0 of snapCur.proj.values()) { const p = interp('proj', p0.id); drawProj(p, now); }
    // Leuchtspur
    tracers = tracers.filter((t) => now - t.t < 220);
    for (const t of tracers) {
      ctx.strokeStyle = `rgba(255,220,140,${1 - (now - t.t) / 220})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(t.x1, t.y1); ctx.lineTo(t.x2, t.y2); ctx.stroke();
    }
    drawParticles();
    drawMarks(now);
    drawWater(th, now, z, ox);

    // Bildschirm-Ebene: Namensschilder, Zahlen
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toS = (x, y) => [(x - cam.x - sx) * z + vw / 2, (y - cam.y - sy) * z + vh / 2];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of list) {
      if (!t.alive) continue;
      const info = G.tankInfo[t.id]; if (!info) continue;
      const team = G.teams[info.team];
      const [x, y] = toS(t.x, t.y - 18);
      const act = t.id === m.tb && (m.ph === 'turn' || m.ph === 'retreat');
      const label = `${team.name.toUpperCase()}  ${t.hp}`;
      ctx.font = '700 13px "Barlow Condensed", sans-serif';
      const w = ctx.measureText(label).width + 22;
      ctx.fillStyle = act ? 'rgba(30,34,24,.95)' : 'rgba(30,34,24,.78)';
      ctx.fillRect(x - w / 2, y - 22, w, 17);
      if (act) { ctx.strokeStyle = '#E0A526'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y - 21.5, w - 1, 16); }
      ctx.fillStyle = S.TEAM_COLORS[team.color];
      ctx.fillRect(x - w / 2 + 5, y - 17, 7, 7);
      ctx.fillStyle = '#F0EDD6';
      ctx.fillText(label, x + 6, y - 13);
      // HP-Balken
      ctx.fillStyle = '#3A3F2E'; ctx.fillRect(x - w / 2, y - 5, w, 3);
      ctx.fillStyle = t.hp > 50 ? '#8FB04A' : t.hp > 25 ? '#E0A526' : '#D9483B';
      ctx.fillRect(x - w / 2, y - 5, w * t.hp / 100, 3);
      if (act) {
        const bob = Math.sin(now / 180) * 3;
        ctx.fillStyle = '#E0A526';
        ctx.beginPath(); ctx.moveTo(x - 7, y - 34 + bob); ctx.lineTo(x + 7, y - 34 + bob); ctx.lineTo(x, y - 26 + bob); ctx.closePath(); ctx.fill();
      }
    }
    texts = texts.filter((tx) => now - tx.t < 1600);
    for (const tx of texts) {
      const k = (now - tx.t) / 1600;
      const [x, y] = toS(tx.x, tx.y - k * 40);
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `400 ${tx.big ? 26 : 20}px "Black Ops One", sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#1E2218'; ctx.strokeText(tx.text, x, y);
      ctx.fillStyle = tx.heal ? '#9BE07A' : tx.big ? '#FF6A4A' : '#F2C766';
      ctx.fillText(tx.text, x, y);
      ctx.globalAlpha = 1;
    }
    // Motorgeräusch, wenn der aktive Panzer fährt
    if (snapPrev && m.tb) {
      const a = snapCur.tanks.get(m.tb), b = snapPrev.tanks.get(m.tb);
      engineSound(!!(a && b && a.gr && Math.abs(a.x - b.x) > 0.3 && m.ph !== 'settle'));
    }
  }

  function drawParallax(th, now, z) {
    const L = G.hills.L;
    // Rauchsäulen in der Ferne
    const t = now / 1000;
    for (const s of G.hills.smokes) {
      const bx = (s.x - cam.x) * z * 0.35 + vw / 2;
      if (bx < -200 || bx > vw + 200) continue;
      for (let i = 0; i < 10; i++) {
        const k = ((t * 0.06 + i / 10 + s.seed) % 1);
        ctx.fillStyle = th.smoke; ctx.globalAlpha = 0.28 * (1 - k);
        ctx.beginPath(); ctx.arc(bx + Math.sin(k * 3 + s.seed) * 14 + k * 50, vh * 0.6 - k * vh * 0.5, 10 + k * 40, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    L.forEach((waves, l) => {
      const par = 0.25 + l * 0.2;
      const baseY = vh * (0.55 + l * 0.08) + (H / 2 - cam.y) * z * par * 0.5;
      ctx.fillStyle = th.hills; ctx.globalAlpha = 0.45 + l * 0.2;
      ctx.beginPath(); ctx.moveTo(0, vh);
      for (let x = 0; x <= vw + 10; x += 12) {
        const wx = (x - vw / 2) / (z * par) + cam.x * 1;
        let h = 0; for (const w of waves) h += w.a * Math.sin(w.f * wx + w.p);
        ctx.lineTo(x, baseY - h * z * 0.8);
      }
      ctx.lineTo(vw, vh); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawWater(th, now, z, ox) {
    const wy = G.waterY, t = now / 1000;
    const x0 = cam.x - vw / 2 / z - 20, x1 = cam.x + vw / 2 / z + 20;
    ctx.fillStyle = th.water; ctx.globalAlpha = 0.92;
    ctx.beginPath(); ctx.moveTo(x0, H + 600);
    for (let x = x0; x <= x1; x += 10) ctx.lineTo(x, wy + Math.sin(x * 0.03 + t * 2) * 2.5 + Math.sin(x * 0.011 - t) * 2);
    ctx.lineTo(x1, H + 600); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.25; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 10) { const y = wy + 6 + Math.sin(x * 0.04 - t * 1.6) * 2; if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const K = 0.78; // Maßstab: Entwurfskoordinaten -> Welt
  const P = (x, y) => [(x - 30) * K, (y - 16) * K];
  function poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => { const [a, b] = P(x, y); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }); ctx.closePath(); }
  function drawTank(t, now, active) {
    const info = G.tankInfo[t.id];
    const team = info ? G.teams[info.team] : null;
    const th = G.theme;
    const [base, turret, dark] = t.alive ? th.tank : ['#2C2C26', '#33332C', '#18180F'];
    const band = team ? S.TEAM_COLORS[team.color] : '#888';
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.tilt);
    // Rohr (Weltwinkel)
    const aim = t.alive ? t.aim : -18;
    const a = (aim * Math.PI) / 180;
    const ang = Math.atan2(-Math.sin(a), t.face * Math.cos(a));
    ctx.save();
    ctx.translate(PHYS.PIVOT_X * t.face, PHYS.PIVOT_Y);
    ctx.rotate(ang - t.tilt);
    ctx.fillStyle = dark;
    ctx.fillRect(0, -1.2, 16, 2.4);
    ctx.fillRect(14, -1.9, 4, 3.8);
    ctx.restore();
    ctx.scale(t.face, 1);
    // Ketten
    ctx.fillStyle = '#24261F';
    const [kx, ky] = P(2, 20);
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(kx, ky, 56 * K, 9 * K, 4.5 * K) : ctx.rect(kx, ky, 56 * K, 9 * K); ctx.fill();
    ctx.fillStyle = t.alive ? '#4A4C42' : '#2A2A24';
    for (let i = 0; i < 7; i++) { const [wx, wy] = P(8 + i * 7, 24.5); ctx.beginPath(); ctx.arc(wx, wy, 2.9 * K, 0, Math.PI * 2); ctx.fill(); }
    // Wanne
    ctx.fillStyle = base; poly([[3, 21], [9, 14], [51, 14], [57, 21]]); ctx.fill();
    ctx.strokeStyle = dark; ctx.lineWidth = 0.6; ctx.stroke();
    if (t.alive) {
      ctx.fillStyle = dark; ctx.globalAlpha = 0.35;
      for (const [cx, cy, rx, ry] of [[18, 17, 5, 1.6], [38, 18, 6, 1.5], [47, 16.5, 3, 1.2]]) { const [ex, ey] = P(cx, cy); ctx.beginPath(); ctx.ellipse(ex, ey, rx * K, ry * K, 0, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    // Turm
    ctx.fillStyle = turret; poly([[17, 14], [21, 7], [37, 7], [42, 10], [42, 14]]); ctx.fill();
    ctx.strokeStyle = dark; ctx.stroke();
    if (t.alive) {
      // Teamstreifen
      const [bx, by] = P(21, 9.8);
      ctx.fillStyle = band; ctx.fillRect(bx, by, 15 * K, 2.6 * K);
      // Klecks-Kommandant in der Luke
      const [hx, hy] = P(28, 7.2);
      const bounce = active ? Math.sin(now / 160) * 0.5 : 0;
      ctx.fillStyle = band;
      ctx.beginPath(); ctx.ellipse(hx, hy + bounce, 4.2, 4.0, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.ellipse(hx - 1.6, hy - 2.6 + bounce, 1.2, 0.7, 0, 0, Math.PI * 2); ctx.fill();
      // Augen schauen in Zielrichtung
      const look = clamp(-aim / 60, -1, 1) * 0.6;
      for (const ex of [hx + 0.4, hx + 2.6]) {
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(ex, hy - 1.6 + bounce, 1.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#16160F'; ctx.beginPath(); ctx.arc(ex + 0.35, hy - 1.6 + bounce + look, 0.55, 0, Math.PI * 2); ctx.fill();
      }
      // Luke
      const [lx, ly] = P(22, 6.4);
      ctx.fillStyle = dark; ctx.fillRect(lx, ly, 4 * K, 1.4 * K);
      // Antenne
      const [ax, ay] = P(20, 7);
      ctx.strokeStyle = dark; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 2, ay - 10); ctx.stroke();
      ctx.fillStyle = band; ctx.fillRect(ax - 2, ay - 10, 3, 2);
    } else if (Math.random() < 0.06) {
      particles.push({ x: t.x + (Math.random() - 0.5) * 8, y: t.y - 6, vx: 0.1, vy: -0.5, life: 0, max: 90, size: 5, col: '#3B3B36', type: 'smoke' });
    }
    ctx.restore();
  }

  function drawAimHelp(m, now) {
    const t = interp('tanks', m.tb);
    if (!t) return;
    const w = WMAP[m.wp];
    const c = Math.cos(t.tilt), s = Math.sin(t.tilt);
    const px = PHYS.PIVOT_X * t.face, py = PHYS.PIVOT_Y;
    const ox = t.x + px * c - py * s, oy = t.y + px * s + py * c;
    const a = (t.aim * Math.PI) / 180;
    const dx = t.face * Math.cos(a), dy = -Math.sin(a);
    let x = ox + dx * PHYS.MUZZLE, y = oy + dy * PHYS.MUZZLE;
    if (w.mode === 'aim') {
      ctx.strokeStyle = 'rgba(224,165,38,.75)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * 170, y + dy * 170); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    if (w.mode !== 'fire') return;
    const sp = PHYS.speed(t.pw);
    let vx = dx * sp, vy = dy * sp;
    ctx.fillStyle = '#E0A526';
    for (let i = 1; i <= 42; i++) {
      vy += PHYS.G; x += vx; y += vy;
      if (solid(x, y)) break;
      if (i % 3 === 0) { ctx.globalAlpha = 1 - i / 46; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  function drawProj(p, now) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const ang = Math.atan2(p.vy, p.vx);
    const blink = Math.floor(now / 200) % 2 === 0;
    switch (p.type) {
      case 'shell': case 'strike': case 'cluster': case 'drill': {
        if (Math.random() < 0.7) particles.push({ x: p.x, y: p.y, vx: 0, vy: -0.2, life: 0, max: 40, size: 2.5 + Math.random() * 2, col: '#B9B9B0', type: 'smoke' });
        ctx.rotate(ang);
        ctx.fillStyle = p.type === 'cluster' ? '#6E5A2A' : p.type === 'drill' ? '#77808A' : '#3A3D33';
        ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(3, -2); ctx.lineTo(6.5, 0); ctx.lineTo(3, 2); ctx.lineTo(-5, 2); ctx.closePath(); ctx.fill();
        if (p.type === 'drill') { ctx.strokeStyle = '#C9D0D6'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(2, 2); ctx.moveTo(3, -2); ctx.lineTo(5, 1); ctx.stroke(); }
        ctx.fillStyle = '#E0A526'; ctx.fillRect(-5, -2, 1.5, 4);
        break;
      }
      case 'bomblet':
        ctx.fillStyle = '#6E5A2A'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill(); break;
      case 'bouncer':
        ctx.fillStyle = '#3F4A2A'; ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = blink ? '#FF4A3A' : '#5A1A14'; ctx.beginPath(); ctx.arc(0, -1, 1, 0, Math.PI * 2); ctx.fill();
        break;
      case 'mine':
        ctx.fillStyle = '#2E3226'; ctx.beginPath(); ctx.ellipse(0, 1, 5, 3.2, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(-5.5, 1, 11, 1.6);
        ctx.fillStyle = p.armed ? (blink ? '#FF3A2A' : '#5A1A14') : '#8FB04A'; ctx.beginPath(); ctx.arc(0, -1.5, 1, 0, Math.PI * 2); ctx.fill();
        break;
      default:
    }
    ctx.restore();
    if (p.fuse > 0 && (p.type === 'bouncer')) {
      ctx.font = '700 9px "Barlow Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#F0EDD6';
      ctx.fillText(String(p.fuse), p.x, p.y - 7);
    }
  }

  function drawObj(o, now) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.kind === 'b') {
      ctx.fillStyle = '#8C2A20'; ctx.fillRect(-5, -7, 10, 14);
      ctx.fillStyle = '#5A1A14'; ctx.fillRect(-5, -4, 10, 1.4); ctx.fillRect(-5, 3, 10, 1.4);
      ctx.fillStyle = '#E0A526'; ctx.font = '700 6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, 0);
    } else {
      if (o.chute) {
        ctx.strokeStyle = '#D8D4C0'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-12, -24); ctx.moveTo(6, -6); ctx.lineTo(12, -24); ctx.moveTo(0, -6); ctx.lineTo(0, -26); ctx.stroke();
        ctx.fillStyle = '#C9C2A4';
        ctx.beginPath(); ctx.ellipse(0, -24, 16, 8, 0, Math.PI, 0); ctx.fill();
        ctx.fillStyle = '#9C9478'; ctx.fillRect(-16, -25, 32, 1.5);
      }
      ctx.fillStyle = '#6B5A3A'; ctx.fillRect(-7, -7, 14, 14);
      ctx.strokeStyle = '#3E3322'; ctx.lineWidth = 1; ctx.strokeRect(-6.5, -6.5, 13, 13);
      ctx.beginPath(); ctx.moveTo(-6.5, -6.5); ctx.lineTo(6.5, 6.5); ctx.stroke();
      ctx.fillStyle = '#E0A526'; ctx.fillRect(-2, -3, 4, 6); ctx.fillRect(-3, -2, 6, 4);
    }
    ctx.restore();
  }

  function drawParticles() {
    const g = PHYS.G;
    particles = particles.filter((p) => p.life < p.max);
    if (particles.length > 900) particles.splice(0, particles.length - 900);
    for (const p of particles) {
      p.life++;
      const k = p.life / p.max;
      switch (p.type) {
        case 'spark':
          p.x += p.vx; p.y += p.vy; p.vy += g * 0.4; p.vx *= 0.96;
          ctx.globalAlpha = 1 - k; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
          break;
        case 'dirt': case 'water':
          p.x += p.vx; p.y += p.vy; p.vy += g;
          if (p.type === 'water' && p.y > G.waterY + 4) p.life = p.max;
          ctx.globalAlpha = 1 - k * k; ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.size, p.size);
          break;
        case 'smoke':
          p.x += p.vx; p.y += p.vy; p.vx *= 0.99;
          ctx.globalAlpha = 0.5 * (1 - k); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + k), 0, Math.PI * 2); ctx.fill();
          break;
        case 'flash':
          ctx.globalAlpha = 1 - k; ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + k * 0.4), 0, Math.PI * 2); ctx.fill();
          break;
        case 'ring':
          ctx.globalAlpha = 0.7 * (1 - k); ctx.strokeStyle = p.col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, Math.PI * 2); ctx.stroke();
          break;
        case 'plus':
          p.y += p.vy;
          ctx.globalAlpha = 1 - k; ctx.fillStyle = p.col; ctx.fillRect(p.x - 2.5, p.y - 0.8, 5, 1.6); ctx.fillRect(p.x - 0.8, p.y - 2.5, 1.6, 5);
          break;
        default:
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawMarks(now) {
    marks = marks.filter((mk) => now - mk.t < (mk.strike ? 2600 : 900));
    for (const mk of marks) {
      const k = (now - mk.t) / (mk.strike ? 2600 : 900);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = mk.strike ? '#D9483B' : '#E0A526'; ctx.lineWidth = 1.5;
      const r = 10 + (mk.strike ? Math.sin(now / 100) * 2 : k * 10);
      ctx.beginPath(); ctx.arc(mk.x, mk.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mk.x - r - 5, mk.y); ctx.lineTo(mk.x + r + 5, mk.y); ctx.moveTo(mk.x, mk.y - r - 5); ctx.lineTo(mk.x, mk.y + r + 5); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Start ----------
  setMuted(muted);
  requestAnimationFrame(frame);
  if (store.get('sf_pw') === PW_HASH) toMenu(); else show('gate');
})();
