import { randomUUID } from 'node:crypto';

export async function deadline(action, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Adapter acknowledgement timed out')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Player/stage adapters are injected only after their real APIs are inspected.
 * stopNow MUST synchronously stop both local AudioSources. Player resume MUST
 * persistently dedupe transition_id, including a lost response and retry.
 */
export class ShowController {
  constructor({ gateway, coordinator, player, stage, timeoutMs = 5000 }) {
    Object.assign(this, { gateway, coordinator, player, stage, timeoutMs });
    this.mode = 'muted'; this.modeEpoch = 0; this.paused = null;
    this.microphoneEnabled = false;
  }
  get available() {
    return this.player?.accepted === true && this.stage?.accepted === true &&
      ['pause', 'resume'].every(k => typeof this.player[k] === 'function') &&
      ['stopNow', 'resume', 'confirmStopped'].every(k => typeof this.stage[k] === 'function');
  }
  live() {
    if (this.enableTask) return this.enableTask;
    if (this.mode === 'live') return Promise.resolve(this.snapshot());
    if (this.stopTask || !this.available || this.paused) return Promise.reject(new Error('Live player/stage adapter unavailable or stop unresolved'));
    const captured = ++this.modeEpoch;
    this.mode = 'starting'; this.aborter = new AbortController();
    const signal = this.aborter.signal;
    this.enableTask = (async () => {
      this.pauseUncertain = true;
      const pause = Promise.resolve().then(() => this.player.pause({ transition_id: randomUUID(), signal })).then(value => {
        if (value && typeof value.playback_id === 'string' && Number.isFinite(value.position_ms) && value.position_ms >= 0) {
          this.paused = { ...value, transition_id: randomUUID() }; this.pauseUncertain = false;
        }
        return value;
      });
      const paused = await deadline(() => pause, this.timeoutMs);
      if (!paused || typeof paused.playback_id !== 'string' || !Number.isFinite(paused.position_ms) || paused.position_ms < 0) throw new Error('Player did not retain a verified playhead');
      if (captured !== this.modeEpoch) throw new Error('Live transition cancelled');
      await this.gateway.panic();
      const scope = await this.gateway.status();
      if (captured !== this.modeEpoch) throw new Error('Live transition cancelled');
      await this.gateway.resume({ session_id: scope.session_id, epoch: scope.epoch });
      if (captured !== this.modeEpoch) throw new Error('Live transition cancelled');
      await deadline(() => this.stage.resume({ ...scope, signal }), this.timeoutMs);
      if (captured !== this.modeEpoch) throw new Error('Live transition cancelled');
      this.coordinator.start({ ...scope, mode_epoch: captured });
      this.mode = 'live'; return this.snapshot();
    })().catch(async error => {
      this.coordinator.stop();
      try { this.stage.stopNow(); } finally { await this.gateway.panic().catch(() => {}); }
      if (captured === this.modeEpoch) this.mode = 'stop_pending';
      throw error;
    }).finally(() => { this.enableTask = null; });
    return this.enableTask;
  }
  stopAndResume() {
    // Admission and cancellation change synchronously before any network await.
    this.microphoneEnabled = false;
    if (this.stopTask) return this.stopTask;
    if (this.mode === 'show' && !this.paused && !this.enableTask) return Promise.resolve(this.snapshot());
    ++this.modeEpoch; this.aborter?.abort(); this.coordinator.stop(); this.mode = 'stopping';
    let localError;
    try { this.stage?.stopNow(); } catch (error) { localError = error; }
    const enabling = this.enableTask;
    this.stopTask = (async () => {
      await this.gateway.panic();
      if (enabling) await enabling.catch(() => {});
      await this.gateway.panic();
      const scope = await this.gateway.status();
      if (!scope.muted) throw new Error('Gateway mute not confirmed');
      if (localError) throw localError;
      if (this.pauseUncertain) throw new Error('Player pause outcome unknown; reconcile before resuming');
      if (!this.available) throw new Error('Local stage stop / episode resume adapter unavailable');
      const stopped = await deadline(() => this.stage.confirmStopped(scope), this.timeoutMs);
      if (stopped !== true) throw new Error('Both local AudioSources must acknowledge stop');
      if (this.paused) {
        const ack = await deadline(() => this.player.resume(this.paused), this.timeoutMs);
        if (ack?.playback_id !== this.paused.playback_id || ack?.position_ms !== this.paused.position_ms || ack?.resumed !== true) {
          throw new Error('Player resume playhead not confirmed');
        }
        this.paused = null;
      }
      this.mode = 'show'; return this.snapshot();
    })().catch(error => { this.mode = 'stop_pending'; throw error; })
      .finally(() => { this.stopTask = null; });
    return this.stopTask;
  }
  snapshot() {
    return { mode: this.mode, mode_epoch: this.modeEpoch, microphone_enabled: false,
      live_available: this.available, retained_playhead_ms: this.paused?.position_ms ?? null };
  }
}

/** Existing service functions, never guessed network routes. */
export class EpisodeJobs {
  constructor({ service, deliveryOrigins = [], now = Date.now }) {
    Object.assign(this, { service, deliveryOrigins: new Set(deliveryOrigins), now });
    this.jobs = new Map(); this.requests = new Map();
  }
  async request(input, requestId) {
    if (!this.service?.accepted || typeof this.service.request !== 'function') throw new Error('Existing episode service unavailable');
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128) throw new Error('Durable episode request ID required');
    if (this.requests.has(requestId)) return this.requests.get(requestId);
    if (this.jobs.size >= 100 || this.requests.size >= 100) throw new Error('Episode job capacity reached');
    const task = deadline(() => input?.retry_job_id ? this.service.retry(input.retry_job_id, { request_id: requestId }) :
      this.service.request(input, { request_id: requestId })).then(row => {
      if (typeof row?.job_id !== 'string' || !row.job_id || row.job_id.length > 128) throw new Error('Episode job ID missing');
      this.jobs.set(row.job_id, { job_id: row.job_id, state: 'queued', download_url: null, retry_available: false });
      return this.jobs.get(row.job_id);
    });
    // Keep unknown outcomes deduped. Service must reconcile request_id on restart.
    this.requests.set(requestId, task); return task;
  }
  async poll(jobId) {
    if (!this.jobs.has(jobId)) throw new Error('Unknown episode job');
    const raw = await deadline(() => this.service.status(jobId));
    if (raw?.job_id !== jobId || !['queued','generating','ready','failed','expired'].includes(raw.state)) throw new Error('Invalid episode status');
    const row = { job_id: jobId, state: raw.state, download_url: null,
      retry_available: ['failed','expired'].includes(raw.state) };
    if (raw.state === 'ready') {
      if (!Number.isSafeInteger(raw.expires_unix_ms) || raw.expires_unix_ms <= this.now()) {
        row.state = 'expired'; row.retry_available = true;
      } else {
        const link = new URL(raw.download_url);
        if (link.protocol !== 'https:' || !this.deliveryOrigins.has(link.origin) || link.username || link.password ||
            !/^[a-f0-9]{64}$/.test(raw.sha256) || raw.private !== true ||
            await deadline(() => this.service.verifyDelivery(raw)) !== true) throw new Error('Private episode delivery not verified');
        Object.assign(row, { download_url: link.href, expires_unix_ms: raw.expires_unix_ms, sha256: raw.sha256 });
      }
    }
    this.jobs.set(jobId, row); return row;
  }
  retry(jobId, requestId) {
    const row = this.jobs.get(jobId);
    if (!row?.retry_available || typeof this.service.retry !== 'function') throw new Error('Retry unavailable');
    return this.request({ retry_job_id: jobId }, requestId);
  }
}
