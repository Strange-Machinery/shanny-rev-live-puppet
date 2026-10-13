import { DonationAdmission } from './parse.mjs';
import { validateReactionDraft } from './reaction.mjs';

const MAX_ACTIVE_READS = 32;
const MAX_WAIT_MS = 45_000;

/**
 * Schedules one prepared Qwen reaction per donation.
 *
 * The platform adapter authenticates events and passes them to admit().
 * The stage event pump passes session/epoch-scoped events to onEvent().
 * Real microphone/episode control intentionally lives elsewhere.
 *
 * A reaction is PREPARED while the donation plays; it is RELEASED only
 * after an actual playback.finished receipt from Unity. This avoids
 * delaying synthesis until the donation has already ended.
 */
export class DonationReactionCoordinator {
  constructor({ gateway, director, admission = new DonationAdmission(),
    now = Date.now, onError = () => {} } = {}) {
    if (!gateway || !['speak', 'release', 'discard'].every(k => typeof gateway[k] === 'function') ||
        !director || typeof director.generate !== 'function' ||
        typeof now !== 'function' || typeof onError !== 'function') {
      throw new TypeError('Gateway speak/release/discard, director, clock and error callback required');
    }
    this.gateway = gateway;
    this.director = director;
    this.admission = admission;
    this.now = now;
    this.onError = onError;
    this.generation = 0;
    this.active = false;
    this.sessionId = '';
    this.epoch = -1;
    this.modeEpoch = -1;
    this.reads = new Map();
    this.reactions = new Map();
    this.lastSeq = 0;
  }

  start({ session_id, epoch, mode_epoch }) {
    if (typeof session_id !== 'string' || !session_id.trim() ||
        !Number.isSafeInteger(epoch) || epoch < 0 ||
        !Number.isSafeInteger(mode_epoch) || mode_epoch < 0) {
      throw new Error('Session, gateway epoch and mode epoch are required');
    }
    this.stop();
    this.sessionId = session_id;
    this.epoch = epoch;
    this.modeEpoch = mode_epoch;
    this.lastSeq = 0;
    this.active = true;
  }

  stop() {
    this.generation++;
    this.active = false;
    for (const read of this.reads.values()) {
      read.aborter.abort();
      this._dropPrepared(read);
    }
    this.reads.clear();
    this.reactions.clear();
  }

  get pending() { return this.reads.size; }

  async admit({ donation_id, text, session_id, mode_epoch }) {
    if (!this.active || session_id !== this.sessionId || mode_epoch !== this.modeEpoch) {
      return { status: 'stale' };
    }
    this.sweep();
    if (this.reads.size >= MAX_ACTIVE_READS) return { status: 'busy' };
    const accepted = this.admission.admit({ donation_id, text });
    if (accepted.status !== 'accepted') return accepted;
    const captured = this.generation;
    const response = await this.gateway.speak({
      actor: accepted.actor, text: accepted.text, delivery: 'queue'
    });
    if (!this._current(captured)) {
      // Transition owner must also panic the stage; never automatically
      // reopen audio or clear the operator's mute latch here.
      return { status: 'stale' };
    }
    if (!response || typeof response.request_id !== 'string' ||
        !response.request_id) throw new Error('Speech gateway did not return a request_id');
    const read = {
      donationId: donation_id, readId: response.request_id,
      actor: accepted.actor, text: accepted.text,
      generation: captured, aborter: new AbortController(),
      started: false, finished: false, reactionId: '',
      prepared: false, released: false, expiry: this.now() + MAX_WAIT_MS
    };
    this.reads.set(read.readId, read);
    return { status: 'accepted', donation_id, read_id: read.readId,
      reader: read.actor, text: read.text };
  }

  onEvent(event) {
    if (!this.active || !event || event.session_id !== this.sessionId ||
        event.epoch !== this.epoch) return;
    if (Number.isSafeInteger(event.seq) && event.seq <= this.lastSeq) return;
    if (Number.isSafeInteger(event.seq)) this.lastSeq = event.seq;
    this.sweep();

    if (event.type === 'panic' || event.type === 'interrupt') {
      this.stop(); return;
    }

    const read = this.reads.get(event.id);
    if (read) {
      if (event.type === 'playback.started' && !read.started) {
        read.started = true;
        void this._prepare(read);
      } else if (event.type === 'playback.finished' && read.started) {
        read.finished = true;
        this._releaseWhenReady(read);
      } else if (event.type === 'playback.stopped') {
        this._cancel(read);
      }
    }

    const reactionRead = this.reactions.get(event.id);
    if (reactionRead && event.type === 'speech.prepared') {
      reactionRead.prepared = true;
      reactionRead.durationMs = event.duration_ms;
      this._releaseWhenReady(reactionRead);
    }
  }

  sweep() {
    const now = this.now();
    for (const read of this.reads.values()) {
      if (now > read.expiry) this._cancel(read);
    }
  }

  _current(captured) {
    return this.active && this.generation === captured;
  }

  _dropPrepared(read) {
    if (!read.reactionId || read.released) return;
    const id = read.reactionId;
    void Promise.resolve().then(() => this.gateway.discard({
      id, session_id: this.sessionId, epoch: this.epoch
    })).catch(e => this.onError(e));
  }

  _cancel(read) {
    read.aborter.abort();
    this._dropPrepared(read);
    this.reads.delete(read.readId);
    if (read.reactionId) this.reactions.delete(read.reactionId);
  }

  async _prepare(read) {
    const captured = read.generation;
    try {
      const draft = validateReactionDraft(await this.director.generate({
        donationText: read.text, actor: read.actor,
        donationId: read.donationId, signal: read.aborter.signal
      }), read.actor);
      if (!this._current(captured) || !this.reads.has(read.readId)) return;
      const response = await this.gateway.speak({
        actor: draft.actor, text: draft.text,
        delivery: 'queue', prepare_only: true
      });
      if (!response || typeof response.request_id !== 'string') {
        throw new Error('Prepared reaction missing request_id');
      }
      read.reactionId = response.request_id;
      if (!this._current(captured) || !this.reads.has(read.readId)) {
        this._dropPrepared(read);
        return;
      }
      this.reactions.set(read.reactionId, read);
    } catch (error) {
      if (this._current(captured) && this.reads.has(read.readId)) {
        this.onError(error);
        this._cancel(read);
      }
    }
  }

  _releaseWhenReady(read) {
    if (!read.finished || !read.prepared || read.released) return;
    if (!this._current(read.generation) || this.now() > read.expiry ||
        !Number.isFinite(read.durationMs) ||
        read.durationMs < 8_000 || read.durationMs > 12_000) {
      this._cancel(read);
      return;
    }
    read.released = true;
    this.reads.delete(read.readId);
    this.reactions.delete(read.reactionId);
    void Promise.resolve().then(() => this.gateway.release({
      id: read.reactionId, session_id: this.sessionId, epoch: this.epoch
    })).catch(error => {
      this.onError(error);
      // Never retry blindly after a timeout: release may already have won.
    });
  }
}
