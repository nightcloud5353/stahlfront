// STAHLFRONT – Netzwerk über WebRTC (PeerJS). Der Gastgeber-Browser betreibt die Simulation.
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
    const o = { debug: 0 };
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
  function host(cb) {
    let tries = 0;
    const sim = new root.StahlSim();
    const link = makeLink();
    let peer = null, code = null, destroyed = false;

    // Lokale Verbindung (Gastgeber spielt selbst mit)
    const localConn = {
      send(m) { Promise.resolve().then(() => { if (link.onmessage) link.onmessage(m); }); },
      close() {},
    };
    sim.onConnect(localConn);
    link.send = (m) => Promise.resolve().then(() => sim.onMessage(localConn, m));
    link.close = () => { destroyed = true; sim.destroy(); if (peer) peer.destroy(); };

    function attempt() {
      code = randomCode();
      peer = new root.Peer(S.PEER_PREFIX + code, peerOptions());
      peer.on('open', () => { cb.onReady && cb.onReady(code, link); });
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
            const s = dc.peerConnection.iceConnectionState;
            if (s === 'failed' || s === 'closed') bye();
          });
        }
      });
      peer.on('disconnected', () => { if (!destroyed) setTimeout(() => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { /* egal */ } }, 1500); });
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id' && tries++ < 5) { peer.destroy(); attempt(); return; }
        if (e.type === 'peer-unavailable') return;
        if (!code || !peer.open) cb.onError && cb.onError(errText(e));
        else cb.onWarn && cb.onWarn(errText(e));
      });
    }
    attempt();
    return { sim, link, getCode: () => code };
  }

  // ---------- Mitspieler ----------
  function join(rawCode, cb) {
    const code = normCode(rawCode);
    const link = makeLink();
    let peer = null, dc = null, opened = false, closed = false;
    const fail = (msg) => {
      if (closed) return;
      closed = true;
      try { if (peer) peer.destroy(); } catch (e) { /* egal */ }
      if (opened) { link.onclose && link.onclose(msg); } else cb.onError && cb.onError(msg);
    };
    peer = new root.Peer(undefined, peerOptions());
    const timer = setTimeout(() => { if (!opened) fail('Zeitüberschreitung. Ist der Gastgeber noch online und im selben WLAN?'); }, 15000);
    peer.on('open', () => {
      dc = peer.connect(S.PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      dc.on('open', () => {
        opened = true; clearTimeout(timer);
        link.send = (m) => { try { if (dc.open) dc.send(m); } catch (e) { /* weg */ } };
        link.close = () => { closed = true; try { peer.destroy(); } catch (e) { /* egal */ } };
        cb.onReady && cb.onReady(code, link);
      });
      dc.on('data', (m) => { if (link.onmessage) link.onmessage(m); });
      dc.on('close', () => fail('Verbindung zum Gastgeber getrennt.'));
      dc.on('error', () => fail('Verbindung zum Gastgeber getrennt.'));
      if (dc.peerConnection) {
        dc.peerConnection.addEventListener('iceconnectionstatechange', () => {
          const s = dc.peerConnection.iceConnectionState;
          if (s === 'failed') fail(opened ? 'Verbindung zum Gastgeber verloren.' : 'Direktverbindung fehlgeschlagen.');
        });
      }
    });
    peer.on('error', (e) => fail(errText(e)));
    peer.on('disconnected', () => { /* Vermittlung weg ist egal, solange die Direktverbindung steht */ });
    return { link, code };
  }

  root.NET = { host, join, normCode };
})(typeof self !== 'undefined' ? self : this);
