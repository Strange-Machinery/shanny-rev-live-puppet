import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { parseDonationText } from './donations/parse.mjs';

/** A local adapter ingress, not a replacement payment/episode service. */
export class ShowRunner {
  constructor({ gateway, coordinator, controller, ledger, episodes, now = Date.now }) {
    Object.assign(this, { gateway, coordinator, controller, ledger, episodes, now });
    this.cursor = 0; this.sessionId = ''; this.running = false;
    this.turn = null; this.admitting = false;
  }
  async initialize() {
    this.coordinator.stop();
    await this.gateway.panic();
    const status = await this.gateway.status();
    this.sessionId = status.session_id; this.cursor = status.cursor;
  }
  async tick() {
    if (this.polling) return;
    this.polling = true;
    try {
      const page = await this.gateway.events({ after: this.cursor, session_id: this.sessionId });
      if (page.session_id !== this.sessionId || !Number.isSafeInteger(page.cursor) || page.cursor < this.cursor) throw new Error('Gateway session/cursor changed');
      for (const event of page.events) {
        this.coordinator.onEvent(event);
        if (event.type === 'panic' || event.type === 'interrupt') this.turn = null;
        if (this.turn && event.type === 'speech.ready' && event.prepared_release) this.turn.reactionId = event.id;
        if (this.turn && ['playback.finished','playback.stopped'].includes(event.type)) {
          if (event.id === this.turn.reactionId) this.turn = null;
          else if (event.id === this.turn.readId && this.coordinator.pending === 0 && !this.turn.reactionId) {
            // A successful release is asynchronous; retain the turn until its ready event.
            if (this.turn.cancelled) this.turn = null;
            else this.turn.readFinished = true;
          }
        }
      }
      this.cursor = page.cursor;
      this.coordinator.sweep();
      if (this.turn && this.now() > this.turn.expires) {
        // A missing playback receipt cannot authorize more speech.
        throw new Error('Donation turn playback timed out');
      }
    } catch (error) {
      this.coordinator.stop(); this.controller.mode = 'stop_pending';
      this.controller.modeEpoch++; this.controller.aborter?.abort();
      try { this.controller.stage?.stopNow(); } catch { /* gateway still must panic */ }
      await this.gateway.panic().catch(() => {});
      throw error;
    } finally { this.polling = false; }
  }
  async donate(input) {
    if (this.controller.mode !== 'live' || !this.coordinator.active ||
        input.session_id !== this.coordinator.sessionId || input.mode_epoch !== this.controller.modeEpoch) return { status: 'stale' };
    if (!Number.isSafeInteger(input.received_unix_ms) || this.now() - input.received_unix_ms > 30_000 || input.received_unix_ms > this.now() + 1000) return { status: 'expired' };
    parseDonationText(input.text);
    if (this.ledger.has(input.donation_id)) return { status: 'duplicate' };
    if (this.admitting || this.turn || this.coordinator.pending) return { status: 'busy' };
    this.admitting = true;
    try {
      if (!this.ledger.reserve(input.donation_id)) return { status: 'duplicate' };
      const result = await this.coordinator.admit(input);
      if (result.status === 'accepted') this.turn = { readId: result.read_id, expires: this.now() + 60_000 };
      return result;
    } finally { this.admitting = false; }
  }
  outcome(row) {
    if (row.status === 'release_failed') {
      this.coordinator.stop(); this.controller.mode = 'stop_pending'; this.controller.modeEpoch++;
      this.controller.aborter?.abort();
      try { this.controller.stage?.stopNow(); } finally { void this.gateway.panic().catch(() => {}); }
      return;
    }
    if (row.status !== 'released' && this.turn) {
      this.turn.cancelled = true;
      if (this.turn.readFinished || row.read_finished || !row.read_started) this.turn = null;
    }
  }
  async listen({ token, donationToken, port = 8771, host = '127.0.0.1' }) {
    if (!['127.0.0.1','::1'].includes(host) || [token, donationToken].some(t => typeof t !== 'string' || t.length < 12) || token === donationToken) throw new Error('Distinct operator/donation credentials and loopback host required');
    const equal = (a,b) => { const x=Buffer.from(a), y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); };
    this.server = createServer((req, res) => {
      void (async () => {
        const path = new URL(req.url, 'http://localhost').pathname;
        const expected = path === '/donations' ? donationToken : token;
        if (!equal(String(req.headers.authorization || ''), 'Bearer '+expected)) { res.writeHead(401); res.end(); return; }
        let data = {};
        if (req.method === 'POST') {
          if (!String(req.headers['content-type']).startsWith('application/json')) throw new Error('JSON required');
          let size = 0; const chunks = [];
          for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('Request too large'); chunks.push(chunk); }
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Object required');
        }
        let result;
        if (req.method === 'GET' && path === '/status') result = { ...this.controller.snapshot(), session_id: this.coordinator.sessionId || this.sessionId, coordinator_active: this.coordinator.active, turn_busy: Boolean(this.turn), reaction_metrics: this.coordinator.metrics(), episodes_available: this.episodes?.service?.accepted === true };
        else if (req.method === 'POST' && path === '/donations') result = await this.donate(data);
        else if (req.method === 'POST' && path === '/live') { result = await this.controller.live(); this.turn = null; }
        else if (req.method === 'POST' && path === '/stop') { result = await this.controller.stopAndResume(); this.turn = null; }
        else if (req.method === 'POST' && path === '/episodes/request') result = await this.episodes.request(data.input, data.request_id);
        else if (req.method === 'POST' && path === '/episodes/status') result = await this.episodes.poll(data.job_id);
        else if (req.method === 'POST' && path === '/episodes/retry') result = await this.episodes.retry(data.job_id, data.request_id);
        else { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' }); res.end(JSON.stringify(result));
      })().catch(() => { if (!res.headersSent) res.writeHead(409, { 'Content-Type':'application/json' }); res.end(JSON.stringify({ error:'Action failed or unavailable; inspect private operator diagnostics' })); });
    });
    this.server.requestTimeout = 10_000;
    await new Promise((resolve,reject) => { this.server.once('error',reject); this.server.listen(port,host,resolve); });
    return this.server.address();
  }
  async close() {
    this.coordinator.stop();
    try { this.controller.stage?.stopNow(); } finally {
      await this.gateway.panic().catch(() => {});
      if (this.server) { this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); }
      this.ledger.close();
    }
  }
}
