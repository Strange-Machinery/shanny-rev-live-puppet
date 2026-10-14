import { DonationAdmission } from './parse.mjs';
import { validateReactionDraft } from './reaction.mjs';

/** Receipts, not estimates, authorize synthesis and held-WAV release. */
export class DonationReactionCoordinator {
  constructor({ gateway, director, admission = new DonationAdmission(), now = Date.now,
    onError = () => {}, onOutcome = () => {}, maxLateMs = 1500 } = {}) {
    if (!gateway || !['speak', 'release', 'discard'].every(k => typeof gateway[k] === 'function') ||
        typeof director?.generate !== 'function' || typeof now !== 'function' ||
        typeof onError !== 'function' || typeof onOutcome !== 'function' ||
        !Number.isInteger(maxLateMs) || maxLateMs < 0 || maxLateMs > 5000) throw new TypeError('Invalid coordinator dependencies');
    Object.assign(this, { gateway, director, admission, now, onError, onOutcome, maxLateMs });
    this.generation = 0; this.active = false; this.lastSeq = 0;
    this.reads = new Map(); this.reactions = new Map(); this.early = [];
    this.inflight = 0; this.playing = new Set(); this.samples = [];
  }
  start({ session_id, epoch, mode_epoch, cursor = 0 }) {
    if (typeof session_id !== 'string' || !session_id.trim() ||
        !Number.isSafeInteger(epoch) || epoch < 0 ||
        !Number.isSafeInteger(mode_epoch) || mode_epoch < 0) throw new Error('Session, gateway epoch and mode epoch are required');
    this.stop();
    Object.assign(this, { sessionId: session_id, epoch, modeEpoch: mode_epoch, lastSeq: cursor, active: true });
    this.baselineCursor = cursor;
  }
  stop() {
    this.generation++; this.active = false;
    for (const read of [...this.reads.values()]) this._cancel(read, 'cancelled');
    this.early.length = 0; this.playing.clear();
  }
  get pending() { return this.reads.size + this.inflight; }
  async admit({ donation_id, text, session_id, mode_epoch }) {
    if (!this.active || session_id !== this.sessionId || mode_epoch !== this.modeEpoch) return { status: 'stale' };
    this.sweep();
    if (this.pending >= 32) return { status: 'busy' };
    const accepted = this.admission.admit({ donation_id, text });
    if (accepted.status !== 'accepted') return accepted;
    const generation = this.generation;
    const scope = { session_id: this.sessionId, epoch: this.epoch };
    this.inflight++;
    try {
      const response = await this.gateway.speak({ actor: accepted.actor, text: accepted.text, delivery: 'queue', ...scope });
      if (!this._current(generation)) return { status: 'stale' };
      if (typeof response?.request_id !== 'string' || !response.request_id) throw new Error('Speech gateway did not return a request_id');
      const read = { donationId: donation_id, readId: response.request_id,
        actor: accepted.actor, text: accepted.text, generation, scope,
        aborter: new AbortController(), started: false, finished: false,
        reactionId: '', prepared: false, released: false, expiry: this.now() + 45_000 };
      this.reads.set(read.readId, read);
      this._replay(read.readId);
      return { status: 'accepted', donation_id, read_id: read.readId, reader: read.actor, text: read.text };
    } finally { this.inflight--; }
  }
  onEvent(event) {
    if (!this.active || !event) return;
    if (event.session_id !== this.sessionId || event.epoch !== this.epoch) {
      // Old receipts are ignored; a new gateway session or newer epoch invalidates everything.
      if (event.session_id !== this.sessionId || event.epoch > this.epoch) this.stop();
      return;
    }
    if (Number.isSafeInteger(event.seq)) {
      if (event.seq <= this.lastSeq) return;
      this.lastSeq = event.seq;
    }
    this.sweep();
    if (event.type === 'panic' || event.type === 'interrupt') { this.stop(); return; }
    if (event.type === 'playback.started') {
      this.playing.add(event.id);
      if (this.playing.size > 32) { this.stop(); return; }
    }
    if (event.type === 'playback.finished' || event.type === 'playback.stopped') this.playing.delete(event.id);
    const known = this.reads.has(event.id) || this.reactions.has(event.id);
    if (!known && this.inflight > 0) {
      if (this.early.length >= 256) { this.stop(); return; }
      this.early.push(event);
    }
    this._dispatch(event);
    if (this.playing.size > 1) {
      for (const read of [...this.reads.values()]) if (read.started && !read.finished) this._cancel(read, 'overlap');
    }
  }
  _replay(id) {
    const matching = this.early.filter(e => e.id === id);
    this.early = this.early.filter(e => e.id !== id);
    for (const event of matching) this._dispatch(event);
  }
  _dispatch(event) {
    const read = this.reads.get(event.id);
    if (read) {
      if (event.type === 'playback.started' && !read.started) {
        read.started = true; read.startedAt = this.now();
        void this._prepare(read);
      } else if (event.type === 'playback.finished' && read.started && !read.finished) {
        read.finished = true; read.finishedAt = this.now();
        read.expiry = Math.min(read.expiry, read.finishedAt + this.maxLateMs);
        this._releaseWhenReady(read);
      } else if (['playback.stopped', 'speech.failed'].includes(event.type)) this._cancel(read, event.type);
    }
    const reactionRead = this.reactions.get(event.id);
    if (reactionRead) {
      if (event.type === 'speech.prepared' && !reactionRead.prepared) {
        reactionRead.prepared = true; reactionRead.readyAt = this.now();
        reactionRead.durationMs = event.duration_ms;
        if (!Number.isFinite(event.duration_ms) || event.duration_ms < 8000 || event.duration_ms > 12000) {
          this._cancel(reactionRead, 'duration');
        } else this._releaseWhenReady(reactionRead);
      } else if (['speech.failed', 'speech.discarded'].includes(event.type)) this._cancel(reactionRead, event.type);
    }
  }
  sweep() {
    for (const read of [...this.reads.values()]) if (this.now() > read.expiry) this._cancel(read, 'expired');
  }
  _current(generation) { return this.active && this.generation === generation; }
  _dropPrepared(read) {
    if (!read.reactionId || read.released) return;
    // Scope is captured per read. A restart cannot redirect old discard/release to a new session.
    try { void Promise.resolve(this.gateway.discard({ id: read.reactionId, ...read.scope })).catch(this.onError); }
    catch (e) { this.onError(e); }
  }
  _outcome(read, status) {
    if (read.outcome) return;
    read.outcome = status;
    const row = { status, read_id: read.readId, read_started: read.started, read_finished: read.finished,
      qwen_ms: read.qwenDoneAt === undefined ? null : read.qwenDoneAt - read.startedAt,
      qwen_to_ready_ms: read.readyAt === undefined ? null : read.readyAt - read.startedAt,
      prepared_before_end: read.readyAt !== undefined && read.finishedAt !== undefined && read.readyAt <= read.finishedAt };
    this.samples.push(row); if (this.samples.length > 200) this.samples.shift();
    this.onOutcome(row);
  }
  _cancel(read, reason) {
    read.aborter.abort(); this._dropPrepared(read);
    this.reads.delete(read.readId); if (read.reactionId) this.reactions.delete(read.reactionId);
    this._outcome(read, reason);
  }
  async _prepare(read) {
    try {
      const draft = validateReactionDraft(await this.director.generate({ donationText: read.text,
        actor: read.actor, donationId: read.donationId, signal: read.aborter.signal }), read.actor);
      read.qwenDoneAt = this.now(); this.sweep();
      if (!this._current(read.generation) || !this.reads.has(read.readId)) return;
      this.inflight++;
      try {
        const response = await this.gateway.speak({ actor: draft.actor, text: draft.text,
          delivery: 'queue', prepare_only: true, ...read.scope });
        if (typeof response?.request_id !== 'string' || !response.request_id) throw new Error('Prepared reaction missing request_id');
        read.reactionId = response.request_id;
        this.sweep();
        if (!this._current(read.generation) || !this.reads.has(read.readId)) { this._dropPrepared(read); return; }
        this.reactions.set(read.reactionId, read); this._replay(read.reactionId);
      } finally { this.inflight--; }
    } catch (error) {
      if (this._current(read.generation) && this.reads.has(read.readId)) {
        this.onError(error); this._cancel(read, 'failed');
      }
    }
  }
  _releaseWhenReady(read) {
    if (!read.finished || !read.prepared || read.released) return;
    if (!this._current(read.generation) || this.now() > read.expiry || this.playing.size) {
      this._cancel(read, 'late_or_overlap'); return;
    }
    read.released = true;
    // Call now, with captured scope. Never enqueue a deferred release that can race stop().
    void this.gateway.release({ id: read.reactionId, after_read_id: read.readId, ...read.scope }).then(() => {
      this._outcome(read, 'released');
    }).catch(error => { this.onError(error); this._outcome(read, 'release_failed'); });
    this.reads.delete(read.readId); this.reactions.delete(read.reactionId);
  }
  metrics() {
    const quantile = (key, q) => {
      const data = this.samples.map(s => s[key]).filter(Number.isFinite).sort((a,b) => a-b);
      return data.length ? data[Math.ceil(data.length * q)-1] : null;
    };
    return { sample_count: this.samples.length, qwen_p50_ms: quantile('qwen_ms', .5), qwen_p95_ms: quantile('qwen_ms', .95),
      qwen_to_ready_p50_ms: quantile('qwen_to_ready_ms', .5), qwen_to_ready_p95_ms: quantile('qwen_to_ready_ms', .95),
      prepared_before_end_percent: this.samples.length ? 100 * this.samples.filter(s => s.prepared_before_end).length / this.samples.length : null,
      outcomes: this.samples.reduce((out, s) => { out[s.status] = (out[s.status] || 0)+1; return out; }, {}) };
  }
}
