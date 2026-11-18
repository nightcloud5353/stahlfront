// STAHLFRONT – Sichere Zustellung über den Internet-Server.
// Der öffentliche Server (MQTT, QoS 0) stellt Nachrichten nicht garantiert zu: einzelne gehen verloren,
// etwa wenn eine Verbindung kurz abreißt. Dann kam z. B. "Feuer" nie beim Gastgeber an oder der Mitspieler
// erfuhr nie seine Spieler-Nummer (und konnte nie zielen). Dieser Kanal sorgt dafür, dass jede wichtige
// Nachricht genau einmal und in der richtigen Reihenfolge ankommt:
//   - jede wichtige Nachricht bekommt eine Nummer, der Empfänger bestätigt, was er hat
//   - Unbestätigtes wird nach kurzer Zeit erneut geschickt, doppelt Ankommendes wird verworfen
//   - Nachrichten, die zu spät/zu früh kommen, werden zurückgehalten, bis die Lücke gefüllt ist
// Spielzustände ("u" = unwichtig, werden laufend ersetzt) gehen ohne Bestätigung, aber nie an einer
// verlorenen wichtigen Nachricht vorbei und nie veraltet (ältere als die zuletzt gezeigte werden verworfen).
//
// Rahmen auf der Leitung:
//   { k: 'm', n, m }        wichtige Nachricht Nr. n
//   { k: 'u', n, u, m }     Zustand Nr. u; n = Nummer der letzten wichtigen Nachricht davor
//   { k: 'a', n, g? }       "habe alles bis n"; g = 1: mir fehlt etwas, bitte sofort nachschicken
(function (root) {
  'use strict';
  const RESEND_MS = 450;   // so lange auf eine Bestätigung warten, dann erneut schicken
  const FAST_MS = 120;     // nach "mir fehlt etwas": Nachrichten, die so lange unterwegs sind, sofort nachschicken
  const ACK_MS = 90;       // Bestätigungen höchstens so oft (spart Daten)
  const MAX_AHEAD = 2000;  // so viele vorausgeeilte Nachrichten höchstens zwischenspeichern

  class Chan {
    // out(frame, all): Rahmen verschicken (all = über alle Wege, sonst nur über den besten)
    // deliver(msg): Nachricht an das Spiel geben
    constructor(out, deliver, now) {
      this.out = out; this.deliver = deliver;
      this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
      // Senden
      this.seq = 0; this.useq = 0; this.pending = new Map(); // n -> { m, t }
      // Empfangen
      this.got = 0; this.lastU = 0; this.ahead = new Map(); this.needAck = false; this.gap = false; this.lastAck = -1e9;
      this.stats = { resent: 0, dups: 0, staleU: 0 };
    }
    send(m, unreliable) {
      if (unreliable) { this.out({ k: 'u', n: this.seq, u: ++this.useq, m }, false); return; }
      const n = ++this.seq;
      this.pending.set(n, { m, t: this.now() });
      this.out({ k: 'm', n, m }, true);
    }
    recv(f) {
      if (!f || typeof f.n !== 'number') return;
      if (f.k === 'm') {
        if (f.n <= this.got || this.ahead.has(f.n)) { this.stats.dups++; this.needAck = true; return; }
        if (f.n === this.got + 1) {
          this.got++;
          this.give(f.m);
          while (this.ahead.has(this.got + 1)) { const m = this.ahead.get(this.got + 1); this.ahead.delete(++this.got); this.give(m); }
          if (!this.ahead.size) this.gap = false;
        } else {
          if (this.ahead.size < MAX_AHEAD) this.ahead.set(f.n, f.m);
          this.gap = true;
        }
        this.needAck = true;
        this.ackSoon();
      } else if (f.k === 'u') {
        if (f.u <= this.lastU) { this.stats.staleU++; return; }
        // davor kam eine wichtige Nachricht, die hier noch fehlt -> Zustand nicht zeigen (wäre "aus der Zukunft")
        if (f.n > this.got) { this.gap = true; this.needAck = true; this.ackSoon(); return; }
        this.lastU = f.u;
        this.give(f.m);
      } else if (f.k === 'a') {
        for (const n of this.pending.keys()) { if (n <= f.n) this.pending.delete(n); else break; }
        if (f.g) this.resend(FAST_MS);
      }
    }
    give(m) { try { this.deliver(m); } catch (e) { if (typeof console !== 'undefined') console.error(e); } }
    ackSoon() {
      // bei einer Lücke sofort Bescheid geben, sonst gesammelt
      if (this.gap && this.now() - this.lastAck >= ACK_MS / 2) this.sendAck();
    }
    sendAck() {
      this.needAck = false; this.lastAck = this.now();
      const f = { k: 'a', n: this.got };
      if (this.gap) f.g = 1;
      this.out(f, true);
    }
    resend(minAge) {
      const now = this.now();
      for (const [n, p] of this.pending) {
        if (now - p.t < minAge) continue;
        p.t = now; this.stats.resent++;
        this.out({ k: 'm', n, m: p.m }, true);
      }
    }
    // regelmäßig aufrufen (ca. alle 50–100 ms)
    tick() {
      if (this.needAck && this.now() - this.lastAck >= ACK_MS) this.sendAck();
      if (this.pending.size) this.resend(RESEND_MS);
    }
    get unacked() { return this.pending.size; }
  }

  root.RELCHAN = { Chan, RESEND_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RELCHAN;
})(typeof self !== 'undefined' ? self : globalThis);
