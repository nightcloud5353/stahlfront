// Winziger MQTT-über-WebSocket-Server für die Browser-Tests (ersetzt den öffentlichen Internet-Server).
// Kann genau das, was js/relay.js braucht: CONNECT, SUBSCRIBE (exakte Themen), PUBLISH (QoS 0), PING.
// opts.drop(topic, n): true = diese Nachricht (n = laufende Nummer pro Thema) geht verloren – wie bei QoS 0.
// broker.refuse = true: neue Verbindungen werden abgewiesen (Server für diesen Teilnehmer nicht erreichbar).
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

function wsFrame(payload) {
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x82, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x82; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x82; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, payload]);
}
const varint = (n) => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return Buffer.from(o); };
const mqttPacket = (type, body) => Buffer.concat([Buffer.from([type]), varint(body.length), body]);

function startBroker(opts) {
  const o = Object.assign({ maxPacket: Infinity }, opts);
  const subs = new Map(); // Thema -> Set(Client)
  const stats = { published: 0, biggest: 0, dropped: 0, lost: 0 };
  const perTopic = new Map();
  const state = { refuse: false };
  const srv = http.createServer((q, r) => { r.writeHead(426); r.end(); });
  srv.on('upgrade', (req, sock) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: mqtt\r\n\r\n`);
    const client = { sock, topics: new Set(), send(b) { if (!sock.destroyed) sock.write(wsFrame(b)); } };
    let wsBuf = Buffer.alloc(0), mq = Buffer.alloc(0), frag = [];
    const bye = () => { for (const t of client.topics) { const s = subs.get(t); if (s) s.delete(client); } };
    sock.on('close', bye);
    sock.on('error', bye);
    sock.on('data', (chunk) => {
      wsBuf = Buffer.concat([wsBuf, chunk]);
      for (;;) {
        if (wsBuf.length < 2) return;
        const fin = wsBuf[0] & 0x80, op = wsBuf[0] & 0x0f, masked = wsBuf[1] & 0x80;
        let len = wsBuf[1] & 0x7f, p = 2;
        if (len === 126) { if (wsBuf.length < 4) return; len = wsBuf.readUInt16BE(2); p = 4; }
        else if (len === 127) { if (wsBuf.length < 10) return; len = Number(wsBuf.readBigUInt64BE(2)); p = 10; }
        const mask = masked ? wsBuf.subarray(p, p + 4) : null;
        if (masked) p += 4;
        if (wsBuf.length < p + len) return;
        const data = Buffer.from(wsBuf.subarray(p, p + len));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        wsBuf = wsBuf.subarray(p + len);
        if (op === 8) { sock.end(); return; }
        if (op === 9 || op === 10) continue;
        frag.push(data);
        if (!fin) continue;
        mq = Buffer.concat([mq, ...frag]); frag = [];
        mq = handleMqtt(mq);
      }
    });
    function handleMqtt(b) {
      for (;;) {
        if (b.length < 2) return b;
        let len = 0, mul = 1, i = 1, byte;
        do { if (i >= b.length) return b; byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
        if (b.length < i + len) return b;
        const type = b[0] & 0xf0, body = b.subarray(i, i + len), whole = b.subarray(0, i + len);
        b = b.subarray(i + len);
        if (type === 0x10) {
          if (state.refuse) { sock.destroy(); return b; }
          client.send(mqttPacket(0x20, Buffer.from([0, 0])));
        }
        else if (type === 0x80) {
          const tl = body.readUInt16BE(2), topic = body.subarray(4, 4 + tl).toString();
          client.topics.add(topic);
          if (!subs.has(topic)) subs.set(topic, new Set());
          subs.get(topic).add(client);
          client.send(mqttPacket(0x90, Buffer.from([body[0], body[1], 0])));
        } else if (type === 0x30) {
          const tl = body.readUInt16BE(0), topic = body.subarray(2, 2 + tl).toString();
          stats.published++;
          stats.biggest = Math.max(stats.biggest, whole.length);
          if (whole.length > o.maxPacket) { stats.dropped++; continue; } // wie ein öffentlicher Server mit Größenlimit
          const n = perTopic.get(topic) || 0; perTopic.set(topic, n + 1);
          if (o.drop && o.drop(topic, n)) { stats.lost++; continue; }
          const out = Buffer.from(whole);
          for (const c of subs.get(topic) || []) c.send(out);
        } else if (type === 0xc0) client.send(Buffer.from([0xd0, 0]));
      }
    }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    url: `ws://127.0.0.1:${srv.address().port}`, stats,
    get refuse() { return state.refuse; }, set refuse(v) { state.refuse = !!v; },
    // Verbindungen trennen, die ein Thema mit dieser Endung abonniert haben (z. B. '/h' = Gastgeber)
    kick(suffix) {
      const hit = new Set();
      for (const [t, set] of subs) if (t.endsWith(suffix)) for (const c of set) hit.add(c);
      for (const c of hit) c.sock.destroy();
      return hit.size;
    }, close() { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); },
  })));
}

module.exports = { startBroker };
