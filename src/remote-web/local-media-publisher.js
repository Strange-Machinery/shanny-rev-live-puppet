import {HTTP_STAGE_BASE, stageEndpoint, validEpoch, sanitizePresentation} from './http-stage-protocol.js';

const INPUT_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus'
];

// AudioContext.resume() can remain pending behind autoplay policy. Deadline
// the promise itself as well as fetch, so a blocked start remains cancellable.
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(signal.reason || new DOMException('Cancelled', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', aborted);
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); aborted(); return; }
    signal.addEventListener('abort', aborted, {once: true});
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/**
 * Record-only tap on the ALREADY OPEN local Unity receiver.
 * Never creates a Unity viewer, changes an element's playback, or stops its
 * original tracks. The recorder has one video track and one Web Audio clock.
 */
export class LocalMediaPublisher {
  constructor({video, rainAudio, key, baseUrl = HTTP_STAGE_BASE, onStatus = () => {},
    onError = () => {}, fetchImpl = globalThis.fetch?.bind(globalThis),
    MediaRecorderClass = globalThis.MediaRecorder, MediaStreamClass = globalThis.MediaStream,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
    mimeTypes = INPUT_TYPES, timesliceMs = 250, videoBitsPerSecond = 6000000,
    maxQueuedBytes = 8 * 1024 * 1024, maxQueueAgeMs = 4000, startupTimeoutMs = 5000, continuousAudio = false,
    now = () => performance.now()} = {}) {
    if (!video || typeof key !== 'string' || !key || !fetchImpl)
      throw new Error('Local HTTP publisher requires its existing player and operator key');
    stageEndpoint(baseUrl, '/publisher/open');
    if (!Number.isInteger(timesliceMs) || timesliceMs < 100 || timesliceMs > 1000 ||
        !Number.isSafeInteger(videoBitsPerSecond) || videoBitsPerSecond < 500000 || videoBitsPerSecond > 12000000 ||
        !Number.isSafeInteger(maxQueuedBytes) || maxQueuedBytes < 65536 || maxQueuedBytes > 32 * 1024 * 1024 ||
        !Number.isFinite(maxQueueAgeMs) || maxQueueAgeMs < 500 || maxQueueAgeMs > 10000 ||
        !Number.isFinite(startupTimeoutMs) || startupTimeoutMs < 500 || startupTimeoutMs > 15000)
      throw new Error('Invalid local HTTP publisher limits');
    Object.assign(this, {video, rainAudio, key, baseUrl, onStatus, onError, fetchImpl,
      MediaRecorderClass, MediaStreamClass, AudioContextClass, mimeTypes, timesliceMs,
      videoBitsPerSecond, maxQueuedBytes, maxQueueAgeMs, startupTimeoutMs, continuousAudio, now});
    this.revision = 0;
    this.session = null;
    this.starting = false;
    this.running = false;
    this.queue = [];
    this.queuedBytes = 0;
    this.cleanups = [];
    this.ownedTracks = new Set();
    this.presentation = sanitizePresentation({available: false});
    this.programGains = [];
    this.metadataTail = Promise.resolve();
    this.metadataPending = 0;
    this.metadataQueuedTimes = [];
    this.stopTask = null;
    this.rainPlayback = null;
    this.recordedRainNonce = null;
  }

  async request(route, {body, query, signal, binary = false} = {}) {
    const headers = {Authorization: 'Bearer ' + this.key,
      'Content-Type': binary ? 'application/octet-stream' : 'application/json'};
    const response = await this.fetchImpl(stageEndpoint(this.baseUrl, route, query), {
      method: 'POST', headers, body: binary ? body : JSON.stringify(body ?? {}),
      signal, redirect: 'error', cache: 'no-store', credentials: 'same-origin'
    });
    if (!response.ok) {
      const error = new Error(response.status === 409 ?
        'HTTP publisher epoch ended; start a fresh local stream' :
        'HTTP publisher request failed (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async start() {
    if (this.running) return this.session;
    if (this.starting) throw new Error('HTTP publisher is already starting');
    this.starting = true;
    const revision = ++this.revision;
    try {
      // A new recorder must not overlap the previous FFmpeg publisher session
      // or its AudioContext cleanup. A later stop also cancels this waiting start.
      if (this.stopTask) await this.stopTask;
      if (revision !== this.revision) throw new DOMException('Cancelled', 'AbortError');
      const abort = new AbortController();
      this.abort = abort;
      const startupSignal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.startupTimeoutMs)]);
      if (!this.MediaRecorderClass || !this.AudioContextClass || !this.MediaStreamClass)
        throw new Error('This local browser cannot record the stage stream');
      const input = this.video.srcObject;
      const videoTracks = input?.getVideoTracks?.().filter(track => track.readyState === 'live') || [];
      const audioTracks = input?.getAudioTracks?.().filter(track => track.readyState === 'live') || [];
      if (videoTracks.length !== 1 || audioTracks.length !== 1 || this.video.readyState < 2)
        throw new Error('Wait for the existing local picture and character audio before publishing');
      const mime = this.mimeTypes.find(type => this.MediaRecorderClass.isTypeSupported(type));
      if (!mime) throw new Error('The local browser cannot record an accepted stage codec');
      // A media-element capture is an observational tap. Unlike
      // createMediaElementSource(), it does not reroute the existing soundtrack.
      if (this.rainAudio && typeof this.rainAudio.captureStream !== 'function')
        throw new Error('This local browser cannot capture the show soundtrack');
      const context = new this.AudioContextClass({sampleRate: 48000, latencyHint: 'interactive'});
      this.context = context;
      await abortable(context.resume(), startupSignal);
      if (revision !== this.revision) throw new DOMException('Cancelled', 'AbortError');
      if (context.state !== 'running')
        throw new Error('Enable sound in the local show before starting HTTP publishing');
      const destination = context.createMediaStreamDestination();
      this.destination = destination;
      for (const track of destination.stream.getTracks()) this.ownedTracks.add(track);
      this.connectAudio(input, context, destination, {owned: false, kind: 'voice'});
      if (this.rainAudio) {
        const rainStream = this.rainAudio.captureStream();
        this.connectAudio(rainStream, context, destination, {owned: true, kind: 'rain'});
      }
      const picture = videoTracks[0].clone();
      this.ownedTracks.add(picture);
      const output = new this.MediaStreamClass([picture, ...destination.stream.getAudioTracks()]);
      const recorder = new this.MediaRecorderClass(output, {
        mimeType: mime, videoBitsPerSecond: this.videoBitsPerSecond, audioBitsPerSecond: 128000
      });
      this.recorder = recorder;
      const opening = this.request('/publisher/open', {body: {mime_type: mime}, signal: startupSignal});
      // Some embedded-browser/network implementations settle late after abort.
      // Dispose only that expired session; never touch a subsequent recorder.
      void opening.then(session => {
        if (revision !== this.revision || startupSignal.aborted) void this.closeSession(session);
      }, () => {});
      const session = await abortable(opening, startupSignal);
      if (revision !== this.revision) {
        throw new DOMException('Cancelled', 'AbortError');
      }
      if (!session || !validEpoch(session.stream_epoch) || !validEpoch(session.publisher_id) ||
          session.next_sequence !== 0 || !Number.isSafeInteger(session.max_chunk_bytes) ||
          session.max_chunk_bytes < 1 || session.max_chunk_bytes > 16 * 1024 * 1024)
        throw new Error('Invalid local HTTP publishing session');
      this.session = session;
      this.sequence = 0;
      this.queue = [];
      this.queuedBytes = 0;
      this.running = true;
      this.startedAt = this.now();
      this.recordedRainNonce = null;
      recorder.ondataavailable = event => this.enqueue(event.data, revision);
      recorder.onerror = () => void this.fail(new Error('Local stage recording failed'), revision);
      const sourceEnded = () => void this.fail(new Error('The local stage source ended'), revision);
      for (const track of [...videoTracks, ...audioTracks]) {
        track.addEventListener('ended', sourceEnded);
        this.cleanups.push(() => track.removeEventListener('ended', sourceEnded));
      }
      recorder.start(this.timesliceMs);
      this.publishPresentation(revision, 0);
      this.watchdog = setInterval(() => {
        if (this.queue.length && this.now() - this.queue[0].queuedAt > this.maxQueueAgeMs)
          void this.fail(new Error('Local media upload fell behind; its stream was stopped'), revision);
        else if (this.metadataQueuedTimes.length && this.now() - this.metadataQueuedTimes[0] > this.maxQueueAgeMs)
          void this.fail(new Error('Presentation metadata upload exceeded its delay budget'), revision);
      }, Math.min(250, this.maxQueueAgeMs / 2));
      this.onStatus('Publishing the existing local show over HTTP');
      return session;
    } catch (error) {
      if (revision === this.revision) await this.stop();
      if (error.name === 'TimeoutError')
        throw new Error('Local HTTP publishing did not start in time; enable sound and start the feed again');
      throw error;
    } finally {
      if (revision === this.revision) this.starting = false;
    }
  }

  connectAudio(stream, context, destination, {owned, kind}) {
    const gain = context.createGain();
    gain.connect(destination);
    this.programGains.push({gain, kind});
    this.syncProgramGains();
    const connected = new Map();
    const add = track => {
      if (track.kind !== 'audio' || connected.has(track) || track.readyState === 'ended') return;
      if (owned) this.ownedTracks.add(track);
      const source = context.createMediaStreamSource(new this.MediaStreamClass([track]));
      source.connect(gain);
      connected.set(track, source);
    };
    const remove = track => {
      connected.get(track)?.disconnect();
      connected.delete(track);
    };
    const added = event => add(event.track), removed = event => remove(event.track);
    for (const track of stream.getAudioTracks()) add(track);
    stream.addEventListener('addtrack', added);
    stream.addEventListener('removetrack', removed);
    this.cleanups.push(() => {
      stream.removeEventListener('addtrack', added);
      stream.removeEventListener('removetrack', removed);
      for (const source of connected.values()) source.disconnect();
      connected.clear();
      gain.disconnect();
    });
  }

  syncProgramGains() {
    // Monitoring and program audio are separate. A silent local ingest must
    // still deliver its authorized program to Buff. No node reaches speakers.
    const active = this.presentation.available &&
      (this.continuousAudio || this.presentation.presentation_visible);
    for (const {gain, kind} of this.programGains)
      gain.gain.value = active && (kind !== 'rain' || this.presentation.presentation_mode === 'rain') ? 1 : 0;
  }

  setPresentation(status) {
    const next = sanitizePresentation(status);
    if (this.rainPlayback?.nonce !== next.presentation_nonce) this.rainPlayback = null;
    // Native polling can lag the local element's play/ended events. Preserve
    // actual source playback facts instead of regressing to a stale "pending".
    if (this.rainPlayback && next.presentation_mode === 'rain') next.rain_audio = this.rainPlayback.state;
    if (JSON.stringify(next) === JSON.stringify(this.presentation)) return;
    this.presentation = next;
    this.syncProgramGains();
    if (this.running) this.publishPresentation(this.revision);
  }

  setRainPlayback({nonce, state}) {
    if (!validEpoch(nonce) || nonce !== this.presentation.presentation_nonce ||
        this.presentation.presentation_mode !== 'rain' || !['playing', 'ended', 'failed'].includes(state)) return;
    const previous = this.rainPlayback?.nonce === nonce ? this.rainPlayback.state : null;
    if (['ended', 'failed'].includes(previous) || (state === 'ended' && previous !== 'playing')) return;
    const newlyRecorded = state === 'playing' && this.running && this.recordedRainNonce !== nonce;
    if (newlyRecorded) this.recordedRainNonce = nonce;
    this.rainPlayback = {nonce, state};
    const unchanged = this.presentation.rain_audio === state;
    this.setPresentation({...this.presentation, rain_audio: state});
    if (newlyRecorded && unchanged) this.publishPresentation(this.revision);
  }

  publishPresentation(revision, mediaTime) {
    if (revision !== this.revision || !this.session || !this.running) return;
    if (++this.metadataPending > 64) {
      void this.fail(new Error('Presentation metadata upload fell behind'), revision);
      return;
    }
    this.metadataQueuedTimes.push(this.now());
    const session = this.session;
    const presentation = {...this.presentation};
    // Reopening during/after a soundtrack cannot prove a new receiver heard
    // its start. Only carry playing/ended after this recorder's genuine event.
    if (['playing', 'ended'].includes(presentation.rain_audio) &&
        this.recordedRainNonce !== presentation.presentation_nonce)
      presentation.rain_audio = null;
    const body = {publisher_id: session.publisher_id, stream_epoch: session.stream_epoch,
      media_time: mediaTime ?? Math.max(0, (this.now() - this.startedAt) / 1000),
      presentation};
    this.metadataTail = this.metadataTail.catch(() => {}).then(async () => {
      if (revision !== this.revision || !this.running) return;
      await this.request('/publisher/presentation', {body, signal: this.abort.signal});
    }).catch(error => {
      if (revision === this.revision) void this.fail(error, revision);
    }).finally(() => {
      if (revision === this.revision) { this.metadataPending--; this.metadataQueuedTimes.shift(); }
    });
  }

  enqueue(blob, revision) {
    if (revision !== this.revision || !this.running || !blob?.size) return;
    if (blob.size > this.session.max_chunk_bytes || this.queuedBytes + blob.size > this.maxQueuedBytes) {
      void this.fail(new Error('Local media exceeded its bounded upload queue; its stream was stopped'), revision);
      return;
    }
    this.queue.push({blob, sequence: this.sequence++, queuedAt: this.now()});
    this.queuedBytes += blob.size;
    void this.drain(revision);
  }

  async drain(revision) {
    if (this.drainingRevision === revision) return;
    this.drainingRevision = revision;
    try {
      while (revision === this.revision && this.running && this.queue.length) {
        const next = this.queue[0];
        if (this.now() - next.queuedAt > this.maxQueueAgeMs)
          throw new Error('Local media upload exceeded its delay budget');
        await this.request('/publisher/chunk', {binary: true, body: next.blob,
          query: {publisher_id: this.session.publisher_id,
            stream_epoch: this.session.stream_epoch, sequence: next.sequence}, signal: this.abort.signal});
        if (revision !== this.revision) return;
        this.queue.shift();
        this.queuedBytes -= next.blob.size;
      }
    } catch (error) {
      if (revision === this.revision) await this.fail(error, revision);
    } finally {
      if (this.drainingRevision === revision) this.drainingRevision = null;
    }
  }

  async fail(error, revision) {
    if (revision !== this.revision) return;
    const stopping = this.stop();
    // Signal STOP/409 immediately after releasing active ownership. The page
    // must latch its explicit-start requirement before another native poll can
    // request a restart while asynchronous session cleanup is still pending.
    this.onStatus(error.message);
    this.onError(error);
    await stopping;
  }

  async closeSession(session) {
    if (!validEpoch(session?.publisher_id) || !validEpoch(session?.stream_epoch)) return;
    const signal = AbortSignal.timeout(2000);
    try {
      await abortable(this.request('/publisher/close', {body: {
        publisher_id: session.publisher_id, stream_epoch: session.stream_epoch
      }, signal}), signal);
    } catch {}
  }

  stop() {
    ++this.revision;
    this.running = false;
    this.starting = false;
    clearInterval(this.watchdog);
    this.watchdog = null;
    this.abort?.abort();
    this.abort = null;
    if (this.stopTask) return this.stopTask;
    const session = this.session;
    this.session = null;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch {}
      }
    }
    for (const cleanup of this.cleanups.splice(0)) { try { cleanup(); } catch {} }
    for (const track of this.ownedTracks) { try { track.stop(); } catch {} }
    this.ownedTracks.clear();
    this.queue = [];
    this.queuedBytes = 0;
    this.metadataPending = 0;
    this.metadataQueuedTimes = [];
    this.metadataTail = Promise.resolve();
    this.programGains = [];
    this.recordedRainNonce = null;
    const context = this.context;
    this.context = null;
    this.destination = null;
    this.stopTask = (async () => {
      if (context && context.state !== 'closed') {
        try { await abortable(context.close(), AbortSignal.timeout(2000)); } catch {}
      }
      if (session) await this.closeSession(session);
    })().finally(() => { this.stopTask = null; });
    return this.stopTask;
  }
}
