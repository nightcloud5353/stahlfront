// STAHLFRONT – Netzwerk. Der Gastgeber-Browser betreibt die Simulation.
// 1. Wahl: Internet-Server (relay.js) – funktioniert in jedem Netz.
// Notlösung: Direktverbindung zwischen den Browsern (WebRTC über PeerJS).
(function (root) {
  'use strict';
  const S = root.SHARED;
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function randomCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    return s;
  }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); }

  // Optional eigener PeerJS-Server (nur für Tests): ?peerhost=localhost&peerport=9000
  function peerOptions() {
    const q = new URLSearchParams(location.search);
    const o = {
      debug: 0,
      config: { iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
      ] },
    };
    if (q.get('peerhost')) {
      o.host = q.get('peerhost');
      o.port = Number(q.get('peerport') || 9000);
      o.path = q.get('peerpath') || '/';
      o.secure = q.get('peersecure') === '1';
      o.config = { iceServers: [] };
    }
    return o;
  }

  const ERR = {
    'browser-incompatible': 'Dieser Browser unterstützt keine Direktverbindungen (WebRTC).',
    'network': 'Keine Verbindung zum Vermittlungsserver. Hat der Hotspot Internet?',
    'server-error': 'Der Vermittlungsserver antwortet nicht. Bitte gleich nochmal versuchen.',
    'socket-error': 'Verbindung zum Vermittlungsserver unterbrochen.',
    'socket-closed': 'Verbindung zum Vermittlungsserver unterbrochen.',
    'peer-unavailable': 'Kein Spiel mit diesem Code gefunden. Code richtig? Ist der Gastgeber noch da?',
    'webrtc': 'Die Direktverbindung ist fehlgeschlagen.',
  };
  const errText = (e) => ERR[e && e.type] || ('Verbindungsfehler: ' + ((e && (e.type || e.message)) || 'unbekannt'));

  // Ein "Link" ist das, womit das Spiel redet: link.send(obj), link.onmessage, link.onclose
  function makeLink() { return { send() {}, onmessage: null, onclose: null, close() {} }; }

  // ---------- Gastgeber ----------
  // opts.resume = gespeicherter Spielstand -> gleicher Raumcode, Spiel geht weiter
  function host(cb, opts) {
    let tries = 0;
    const resume = opts && opts.resume;
    const sim = new root.StahlSim();
    if (resume) sim.restore(resume);
    const link = makeLink();
    let peer = null, relay = null, code = null, destroyed = false, ready = false, relayDead = false, peerDead = false;

    // Lokale Verbindung (Gastgeber spielt selbst mit)
    const localConn = {
      send(m) { Promise.resolve().then(() => { if (link.onmessage) link.onmessage(m); }); },
      close() {},
    };
    sim.onConnect(localConn);
    link.send = (m) => Promise.resolve().then(() => sim.onMessage(localConn, m));
    link.close = () => { destroyed = true; sim.destroy(); if (relay) relay.close(); if (peer) peer.destroy(); };

    const fireReady = () => { if (ready || destroyed) return; ready = true; sim.code = code; if (cb.onReady) cb.onReady(code, link); };
    const bothDead = () => { if (!ready && relayDead && peerDead && cb.onError) cb.onError('Keine Verbindung zum Internet. Hat das WLAN bzw. der Hotspot Internet?'); };

    function attempt() {
      code = resume ? resume.code : randomCode();
      relayDead = false; peerDead = false;
      // 1. Wahl: Internet-Server
      relay = root.RELAY.host(code, sim, { onReady: fireReady, onFail: () => { relayDead = true; bothDead(); } });
      // Notlösung: Direktverbindung
      peer = new root.Peer(S.PEER_PREFIX + code, peerOptions());
      peer.on('open', fireReady);
      peer.on('connection', (dc) => {
        const conn = {
          send(m) { try { if (dc.open) dc.send(m); } catch (e) { /* weg */ } },
          close() { try { dc.close(); } catch (e) { /* weg */ } },
        };
        let gone = false;
        const bye = () => { if (gone) return; gone = true; sim.onDisconnect(conn); };
        dc.on('open', () => sim.onConnect(conn));
        dc.on('data', (m) => sim.onMessage(conn, m));
        dc.on('close', bye);
        dc.on('error', bye);
        if (dc.peerConnection) {
          dc.peerConnection.addEventListener('iceconnectionstatechange', () => {
            const st = dc.peerConnection.iceConnectionState;
            if (st === 'failed' || st === 'closed') bye();
          });
        }
      });
      peer.on('disconnected', () => { if (!destroyed && !peerDead) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* egal */ } }, 1500); });
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && !ready) {
          // Code schon belegt (oder beim Fortsetzen noch nicht freigegeben) -> neu versuchen
          relay.close(); peer.destroy();
          if (resume && tries++ < 15) { if (cb.onWarn) cb.onWarn('Raum ' + code + ' wird noch freigegeben …'); setTimeout(attempt, 2000); return; }
          if (!resume && tries++ < 5) { attempt(); return; }
        }
        if (e.type === 'peer-unavailable') return;
        if (!peer.open) { peerDead = true; bothDead(); }
      });
    }
    attempt();
    return { sim, link, getCode: () => code };
  }

  // ---------- Mitspieler: Direktverbindung (Notlösung) ----------
  function directJoin(code, cb) {
    const link = makeLink();
    let peer = null, dc = null, opened = false, closed = false;
    const fail = (msg) => {
      if (closed) return;
      closed = true;
      try { if (peer) peer.destroy(); } catch (e) { /* egal */ }
      if (opened) { if (link.onclose) link.onclose(msg); } else if (cb.onError) cb.onError(msg);
    };
    peer = new root.Peer(undefined, peerOptions());
    peer.on('open', () => {
      dc = peer.connect(S.PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        opened = true;
        link.send = (m) => { try { if (dc.open) dc.send(m); } catch (e) { /* weg */ } };
        link.close = () => { closed = true; try { peer.destroy(); } catch (e) { /* egal */ } };
        if (cb.onReady) cb.onReady(code, link);
      });
      dc.on('data', (m) => { if (link.onmessage) link.onmessage(m); });
      dc.on('close', () => fail('Verbindung zum Gastgeber getrennt.'));
      dc.on('error', () => fail('Verbindung zum Gastgeber getrennt.'));
      if (dc.peerConnection) {
        dc.peerConnection.addEventListener('iceconnectionstatechange', () => {
          if (dc.peerConnection.iceConnectionState === 'failed') fail(opened ? 'Verbindung zum Gastgeber verloren.' : 'Direktverbindung fehlgeschlagen.');
        });
      }
    });
    peer.on('error', (e) => fail(errText(e)));
    return { link, cancel() { cb.onError = null; cb.onReady = null; closed = true; try { peer.destroy(); } catch (e) { /* egal */ } } };
  }

  // ---------- Mitspieler: erst Internet-Server, nach 6 s zusätzlich die Direktverbindung ----------
  function join(rawCode, cb) {
    const code = normCode(rawCode);
    let settled = false, rj = null, dj = null, relayErr = null, directErr = null;
    const q = new URLSearchParams(location.search);
    const stop = () => { clearTimeout(t1); clearTimeout(t2); };
    const win = (c, l) => {
      if (settled) { try { l.close(); } catch (e) { /* egal */ } return; }
      settled = true; stop();
      if (rj && rj.link !== l) rj.cancel();
      if (dj && dj.link !== l) dj.cancel();
      if (cb.onReady) cb.onReady(c, l);
    };
    const lose = (msg) => {
      if (settled) return;
      settled = true; stop();
      if (rj) rj.cancel();
      if (dj) dj.cancel();
      if (cb.onError) cb.onError(msg);
    };
    const startDirect = () => {
      if (dj || settled || q.has('noDirect')) return;
      dj = directJoin(code, { onReady: win, onError: (m) => { directErr = m; if (relayErr) lose(m); else setTimeout(() => lose(m), 3000); } });
    };
    rj = root.RELAY.join(code, {
      onReady: win,
      onError: (m) => { relayErr = m; if (directErr) lose(directErr); else startDirect(); },
    });
    const t1 = setTimeout(startDirect, 6000);
    const t2 = setTimeout(() => lose('Kein Spiel mit diesem Code erreichbar. Code richtig? Ist die Seite beim Gastgeber noch offen?'), 22000);
    return { code };
  }

  root.NET = { host, join, normCode };
})(typeof self !== 'undefined' ? self : this);
