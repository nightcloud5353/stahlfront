// STAHLFRONT – Verbindung über einen öffentlichen Internet-Server (MQTT über WebSocket).
// Funktioniert in jedem Netz (auch wenn Router Direktverbindungen blockieren).
// Gastgeber und Mitspieler tauschen Nachrichten über "Themen" aus, die vom Raumcode abhängen.
// Alle Nachrichten sind mit AES-256-GCM verschlüsselt. Der Schlüssel wird beim Passwort-Eintippen
// aus dem Passwort abgeleitet (PBKDF2) – ohne Passwort sieht man auf dem Server nur Zeichensalat.
(function (root) {
  'use strict';
  const DEFAULT_BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  const enc = new TextEncoder(), dec = new TextDecoder();
  const TICK_MS = 60;        // so oft prüft der sichere Kanal, ob etwas nachgeschickt/bestätigt werden muss
  const PATH_FRESH = 12000;  // über einen Server, über den der Mitspieler so lange nichts sagte, nicht mehr schicken

  // Testbetrieb: ?relay=ws://127.0.0.1:8888 (mehrere mit Komma)
  function brokers() {
    const q = new URLSearchParams(location.search).get('relay');
    return q ? q.split(',') : DEFAULT_BROKERS;
  }
  const rid = () => root.SHARED.randomId(10);
  let KEY = null, SECRET = null;
  const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  // Kanalname hängt vom Schlüssel ab: Fremde erkennen nicht einmal, welche Nachrichten zu euch gehören
  const topicBase = (code) => `sf3/${SECRET.slice(0, 20)}/${code}`;
  async function setKey(b64) {
    if (!b64 || !root.crypto || !crypto.subtle) { KEY = null; SECRET = null; return false; }
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    KEY = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    SECRET = hex(await crypto.subtle.digest('SHA-256', concat([raw, enc.encode('stahlfront-topics')])));
    return true;
  }
  async function seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, enc.encode(JSON.stringify(obj)));
    return concat([iv, new Uint8Array(ct)]);
  }
  async function open(bytes) {
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, KEY, bytes.subarray(12));
      return JSON.parse(dec.decode(pt));
    } catch (e) { return null; } // falscher Schlüssel / kaputt -> ignorieren
  }

  // ---------- minimaler MQTT-3.1.1-Client (QoS 0) ----------
  function concat(parts) {
    let n = 0; for (const p of parts) n += p.length;
    const o = new Uint8Array(n); let i = 0;
    for (const p of parts) { o.set(p, i); i += p.length; }
    return o;
  }
  function varint(n) { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Uint8Array.from(o); }
  function mstr(s) { const b = enc.encode(s); return concat([Uint8Array.of(b.length >> 8, b.length & 255), b]); }
  function packet(type, body) { return concat([Uint8Array.of(type), varint(body.length), body]); }

  class Mqtt {
    constructor(url, onMsg, onDown) {
      this.url = url; this.onMsg = onMsg; this.onDown = onDown;
      this.ready = false; this.closed = false; this.buf = new Uint8Array(0); this.pid = 1;
      // Ver- und Entschlüsseln ist asynchron -> Warteschlangen halten die Reihenfolge der Nachrichten
      this.outQ = Promise.resolve(); this.inQ = Promise.resolve();
    }
    connect(onUp) {
      let ws;
      try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { this.fail(); return; }
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      this.onUp = onUp;
      const t = setTimeout(() => { if (!this.ready) this.fail(); }, 7000);
      ws.onopen = () => {
        const body = concat([mstr('MQTT'), Uint8Array.of(4, 0x02, 0, 30), mstr('sf' + rid())]);
        ws.send(packet(0x10, body));
      };
      ws.onmessage = (e) => { this.feed(new Uint8Array(e.data)); };
      ws.onerror = () => { clearTimeout(t); this.fail(); };
      ws.onclose = () => { clearTimeout(t); this.fail(); };
      this.pinger = setInterval(() => { if (this.ready) this.raw(Uint8Array.of(0xC0, 0)); }, 20000);
    }
    fail() {
      if (this.closed) return;
      this.closed = true; this.ready = false;
      clearInterval(this.pinger);
      try { this.ws && this.ws.close(); } catch (e) { /* egal */ }
      if (this.onDown) this.onDown();
    }
    close() { this.onDown = null; this.fail(); }
    raw(bytes) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(bytes); } catch (e) { /* egal */ } }
    sub(topic) {
      const id = this.pid++ & 0xffff;
      this.raw(packet(0x82, concat([Uint8Array.of(id >> 8, id & 255), mstr(topic), Uint8Array.of(0)])));
    }
    pub(topic, obj) {
      const t = mstr(topic);
      this.outQ = this.outQ.then(() => seal(obj)).then((body) => this.raw(packet(0x30, concat([t, body])))).catch(() => {});
    }
    feed(chunk) {
      this.buf = this.buf.length ? concat([this.buf, chunk]) : chunk;
      for (;;) {
        const b = this.buf;
        if (b.length < 2) return;
        let len = 0, mul = 1, i = 1, byte;
        do { if (i >= b.length) return; byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
        if (b.length < i + len) return;
        const type = b[0] & 0xf0, body = b.subarray(i, i + len);
        this.buf = b.subarray(i + len);
        if (type === 0x20) { // CONNACK
          if (body[1] === 0) { this.ready = true; if (this.onUp) this.onUp(this); } else this.fail();
        } else if (type === 0x30) { // PUBLISH
          const tl = (body[0] << 8) | body[1];
          const topic = dec.decode(body.subarray(2, 2 + tl));
          const qos = (b[0] >> 1) & 3;
          const payload = body.slice(2 + tl + (qos ? 2 : 0));
          this.inQ = this.inQ.then(() => open(payload)).then((msg) => { if (msg && this.onMsg) this.onMsg(topic, msg); }).catch(() => {});
        }
      }
    }
  }

  // ---------- Gastgeber ----------
  // Lauscht auf allen Servern gleichzeitig (damit jeder Mitspieler einen findet) und verbindet bei Abbruch neu.
  // Jeder Mitspieler hat einen sicheren Kanal (reliable.js); geschickt wird über jeden Server, über den er
  // zuletzt zu hören war (fällt einer aus, kommt die Nachricht über den anderen an).
  function host(code, sim, cb) {
    if (!KEY) { setTimeout(() => cb.onFail && cb.onFail(), 0); return { close() {} }; }
    const base = topicBase(code);
    const conns = new Map(); // Mitspieler-ID -> { conn, chan, to, paths: Map(Server-Verbindung -> zuletzt gehört), seen }
    const live = new Set();
    let readyOnce = false, failed = 0, closed = false;
    const list = brokers();
    // Wege zu einem Mitspieler: Server-Verbindungen, die noch stehen und über die er kürzlich sprach
    const routes = (e) => {
      const now = performance.now();
      const ok = [...e.paths].filter(([mq, t]) => live.has(mq) && now - t < PATH_FRESH).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      return ok;
    };
    const post = (e, obj, all) => {
      const r = routes(e);
      if (!r.length) return; // gerade kein Weg -> der sichere Kanal schickt später erneut
      for (const mq of all ? r : r.slice(0, 1)) mq.pub(e.to, obj);
    };
    const handle = (mq) => (topic, m) => {
      if (!m || typeof m.f !== 'string') return;
      let e = conns.get(m.f);
      if (m.k === 'hi') {
        if (!e) {
          let lastS = 0;
          e = { to: `${base}/c/${m.f}`, paths: new Map(), seen: 0 };
          e.chan = new root.RELCHAN.Chan((fr, all) => post(e, { k: 'r', r: fr }, all), (msg) => sim.onMessage(e.conn, msg));
          e.conn = {
            relay: true,
            send(msg) {
              // Zustand höchstens ~15x pro Sekunde über den Server schicken (spart Daten); er wird laufend ersetzt
              if (msg.t === 's') { const now = performance.now(); if (now - lastS < 66) return; lastS = now; e.chan.send(msg, true); return; }
              e.chan.send(msg);
            },
            close() { post(e, { k: 'bye' }, true); },
          };
          conns.set(m.f, e);
          sim.onConnect(e.conn);
        }
        e.paths.set(mq, performance.now()); e.seen = performance.now();
        mq.pub(e.to, { k: 'ok' });
        return;
      }
      if (!e) return;
      e.paths.set(mq, performance.now()); e.seen = performance.now();
      if (m.k === 'r') e.chan.recv(m.r);
      else if (m.k === 'bye') { conns.delete(m.f); sim.onDisconnect(e.conn); }
    };
    const start = (url) => {
      if (closed) return;
      let up = false;
      const mq = new Mqtt(url, null, () => {
        live.delete(mq);
        if (closed) return;
        if (!up) { failed++; if (!readyOnce && failed >= list.length && cb.onFail) cb.onFail(); }
        setTimeout(() => start(url), up ? 2000 : 8000);
      });
      mq.onMsg = handle(mq);
      mq.connect((c) => {
        up = true; live.add(c);
        c.sub(`${base}/h`);
        if (!readyOnce) { readyOnce = true; if (cb.onReady) cb.onReady(); }
      });
    };
    for (const url of list) start(url);
    // Nachschicken / Bestätigen
    const ticker = setInterval(() => { for (const [, e] of conns) e.chan.tick(); }, TICK_MS);
    // Herzschlag an alle Mitspieler (über jeden ihrer Wege) + tote Verbindungen aufräumen
    const timer = setInterval(() => {
      const now = performance.now();
      for (const [id, e] of conns) {
        if (now - e.seen > 15000) { conns.delete(id); sim.onDisconnect(e.conn); continue; }
        for (const [mq, t] of e.paths) if (now - t > 30000 || !live.has(mq)) e.paths.delete(mq);
        post(e, { k: 'p' }, true);
      }
    }, 4000);
    return {
      close() { closed = true; clearInterval(timer); clearInterval(ticker); for (const [, e] of conns) e.conn.close(); for (const c of live) c.close(); },
      // für Tests: Zustand der sicheren Kanäle
      stats() { return [...conns.values()].map((e) => Object.assign({ unacked: e.chan.unacked, paths: routes(e).length }, e.chan.stats)); },
    };
  }

  // ---------- Mitspieler ----------
  // Verbindet sich mit ALLEN Servern gleichzeitig und klopft überall an: Der Gastgeber muss nur auf einem
  // davon erreichbar sein. Danach wird über alle Server gesprochen, die der Gastgeber beantwortet.
  function join(code, cb) {
    const link = { send() {}, onmessage: null, onclose: null, close() {} };
    if (!KEY) { setTimeout(() => cb.onError && cb.onError('relay-unreachable'), 0); return { link, cancel() { cb.onError = null; } }; }
    const base = topicBase(code), me = rid(), list = brokers();
    const paths = new Map(); // Server-Adresse -> { mq, ok, heard, everUp, fails }
    let opened = false, done = false, lastHost = 0, beat = 0, watch = 0, ticker = 0, nBeat = 0;
    const toHost = `${base}/h`;
    const routes = () => [...paths.values()].filter((p) => p.mq && p.mq.ready && p.ok).sort((a, b) => b.heard - a.heard);
    const chan = new root.RELCHAN.Chan((fr, all) => {
      const r = routes();
      for (const p of all ? r : r.slice(0, 1)) p.mq.pub(toHost, { f: me, k: 'r', r: fr });
    }, (msg) => { if (link.onmessage) link.onmessage(msg); });
    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(beat); clearInterval(watch); clearInterval(ticker);
      for (const p of paths.values()) {
        if (!p.mq) continue;
        try { p.mq.pub(toHost, { f: me, k: 'bye' }); } catch (e) { /* egal */ }
        const mq = p.mq; setTimeout(() => mq.close(), 50); // "bye" noch rausgehen lassen
      }
      if (opened) { if (link.onclose) link.onclose(err); } else if (cb.onError) cb.onError(err);
    };
    const open = () => {
      opened = true;
      link.send = (msg) => chan.send(msg);
      link.close = () => { cb.onError = null; link.onclose = null; finish(); };
      watch = setInterval(() => { if (performance.now() - lastHost > 13000) finish('Verbindung zum Gastgeber getrennt.'); }, 2000);
      ticker = setInterval(() => chan.tick(), TICK_MS);
      if (cb.onReady) cb.onReady(code, link);
    };
    const onMsg = (p) => (topic, m) => {
      if (done) return;
      lastHost = p.heard = performance.now();
      p.ok = true; // der Gastgeber hört uns über diesen Server
      if (!opened) open();
      if (m.k === 'r') chan.recv(m.r);
      else if (m.k === 'bye') finish('Der Gastgeber hat das Spiel geschlossen.');
    };
    const start = (url) => {
      if (done) return;
      const p = paths.get(url) || { mq: null, ok: false, heard: 0, everUp: false, fails: 0 };
      paths.set(url, p);
      p.ok = false;
      const mq = new Mqtt(url, null, () => {
        if (p.mq === mq) p.mq = null;
        p.ok = false;
        if (done) return;
        p.fails++;
        // noch nie irgendein Server erreichbar -> aufgeben (dann versucht NET die Direktverbindung)
        if (!opened && [...paths.values()].every((x) => !x.everUp && x.fails > 0) && paths.size === list.length) { finish('relay-unreachable'); return; }
        setTimeout(() => start(url), p.everUp ? 2000 : 6000);
      });
      mq.onMsg = onMsg(p);
      p.mq = mq;
      mq.connect((c) => {
        p.everUp = true;
        c.sub(`${base}/c/${me}`);
        c.pub(toHost, { f: me, k: 'hi' });
      });
    };
    for (const url of list) start(url);
    // jede Sekunde: auf Servern anklopfen, über die der Gastgeber (noch) nicht antwortet; alle 4 s Lebenszeichen
    beat = setInterval(() => {
      nBeat++;
      for (const p of paths.values()) {
        if (!p.mq || !p.mq.ready) continue;
        if (!p.ok) p.mq.pub(toHost, { f: me, k: 'hi' });
        else if (nBeat % 4 === 0) p.mq.pub(toHost, { f: me, k: 'p' });
      }
    }, 1000);
    return { link, cancel() { cb.onError = null; finish(); }, stats: () => Object.assign({ unacked: chan.unacked, paths: routes().length }, chan.stats) };
  }

  root.RELAY = { host, join, setKey, hasKey: () => !!KEY };
})(typeof self !== 'undefined' ? self : this);
