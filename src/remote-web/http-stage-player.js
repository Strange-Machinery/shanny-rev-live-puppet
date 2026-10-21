import {HTTP_STAGE_BASE, stageEndpoint, validEpoch, validateManifest, selectLiveStart,
  playbackCounters, waitForMediaEvent, sanitizePresentation, presentationAt} from './http-stage-protocol.js';

/**
 * A same-origin MSE receiver. Fetch success is never reported as video readiness.
 * The existing stage page owns presentation/muting; this class owns transport,
 * bounded buffering, playback receipts and immediate STOP/epoch invalidation.
 */
export class HttpStagePlayer {
  constructor({video, key, viewerRole = 'obs', baseUrl = HTTP_STAGE_BASE,
    onStatus = () => {}, onStats = () => {}, onPresentation = () => {},
    onRainPlayback = () => {}, autoReconnect = true,
    fetchImpl = globalThis.fetch?.bind(globalThis), MediaSourceClass = globalThis.MediaSource,
    urlApi = globalThis.URL, now = () => performance.now(), pollMs = 250,
    maxBufferSeconds = 6, targetBufferSeconds = 1.5, maxStallMs = 5000} = {}) {
    if (!video || typeof key !== 'string' || !key || !fetchImpl ||
        !['obs', 'preview'].includes(viewerRole) || !Number.isInteger(pollMs) || pollMs < 100 || pollMs > 1000 ||
        !Number.isFinite(maxBufferSeconds) || maxBufferSeconds < 1 || maxBufferSeconds > 12 ||
        !Number.isFinite(targetBufferSeconds) || targetBufferSeconds < .25 || targetBufferSeconds >= maxBufferSeconds ||
        !Number.isFinite(maxStallMs) || maxStallMs < 1000 || maxStallMs > 15000)
      throw new Error('Invalid HTTP stage receiver configuration');
    stageEndpoint(baseUrl, '/receiver/open');
    Object.assign(this, {video, key, viewerRole, baseUrl, onStatus, onStats,
      onPresentation, onRainPlayback, autoReconnect, fetchImpl, MediaSourceClass,
      urlApi, now, pollMs, maxBufferSeconds, targetBufferSeconds, maxStallMs});
    this.revision = 0;
    this.mediaGeneration = 0;
    this.closed = false;
    this.connected = false;
    this.id = null;
    this.manifest = null;
    this.retries = 0;
    this.seenRainEvents = new Set();
    this.totalDecodedFrames = 0;
    this.lastRawFrames = null;
  }

  get isReady() {
    return this.connected && this.manifest?.audio_present === true;
  }

  async request(route, {body, query, signal, binary = false, maxBytes = 16 * 1024 * 1024} = {}) {
    const response = await this.fetchImpl(stageEndpoint(this.baseUrl, route, query), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {Authorization: 'Bearer ' + this.key,
        ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal, redirect: 'error', cache: 'no-store', credentials: 'same-origin'
    });
    if (!response.ok) {
      const error = new Error(response.status === 409 ? 'HTTP stage stream changed' :
        'HTTP stage request failed (' + response.status + ')');
      error.status = response.status;
      throw error;
    }
    if (!binary) return response.json();
    const declared = Number(response.headers?.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel?.();
      throw new Error('HTTP stage media exceeded its size limit');
    }
    if (!response.body?.getReader) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxBytes) throw new Error('HTTP stage media exceeded its size limit');
      return bytes;
    }
    const reader = response.body.getReader(), pieces = [];
    let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) throw new Error('HTTP stage media exceeded its size limit');
        pieces.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const piece of pieces) { result.set(piece, offset); offset += piece.byteLength; }
    return result.buffer;
  }

  requestSignal(parent, timeoutMs = 5000) {
    return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
  }

  async connect() {
    if (this.closed) return;
    const closing = this.close();
    const revision = this.revision;
    await closing;
    if (revision !== this.revision || this.closed) return;
    this.controlAbort = new AbortController();
    this.onStatus('Connecting to the private HTTP stage…');
    try {
      if (!this.MediaSourceClass) throw new Error('This OBS browser does not support Media Source Extensions');
      const setup = await this.request('/receiver/open', {body: {viewer_role: this.viewerRole},
        signal: this.requestSignal(this.controlAbort.signal)});
      if (revision !== this.revision) {
        if (validEpoch(setup?.viewer_id)) void this.request('/receiver/close', {
          body: {viewer_id: setup.viewer_id}, signal: AbortSignal.timeout(2000)
        }).catch(() => {});
        return;
      }
      if (!validEpoch(setup.viewer_id)) throw new Error('Invalid HTTP stage viewer session');
      this.id = setup.viewer_id;
      this.acceptManifest(setup);
      void this.controlTick(revision);
    } catch (error) {
      if (revision === this.revision) await this.connectionFailed(error);
    }
  }

  acceptManifest(input) {
    const manifest = validateManifest(input);
    const epochChanged = this.manifest?.stream_epoch !== manifest.stream_epoch;
    if (epochChanged) {
      this.flushMedia();
      this.seenRainEvents.clear();
      this.lastRain = null;
      this.lastPresentation = null;
      this.totalDecodedFrames = 0;
      this.lastRawFrames = null;
    }
    this.manifest = manifest;
    if (manifest.state !== 'live') {
      if (this.mediaSource || this.connected) this.flushMedia();
      this.onStatus({stopped: 'Stage stopped', disabled: 'HTTP stage is disabled',
        error: 'Producer HTTP stage needs attention', idle: 'Waiting for the producer stage',
        starting: 'Preparing the producer media stream…'}[manifest.state]);
      return;
    }
    if (!this.MediaSourceClass.isTypeSupported(manifest.mime_type))
      throw new Error('This OBS browser cannot decode the producer HTTP codec');
    void this.pump();
  }

  async controlTick(revision) {
    if (revision !== this.revision || !this.id || this.closed) return;
    try {
      const manifest = await this.request('/manifest', {query: {viewer_id: this.id},
        signal: this.requestSignal(this.controlAbort.signal, 3000)});
      if (revision !== this.revision) return;
      this.acceptManifest(manifest);
      if (manifest.state === 'live') {
        this.samplePlayback();
        await this.sendReceipt(revision);
      }
    } catch (error) {
      if (revision === this.revision) { await this.connectionFailed(error); return; }
    }
    if (revision === this.revision && !this.closed)
      this.timer = setTimeout(() => void this.controlTick(revision), this.pollMs);
  }

  async makeSource(generation) {
    if (this.mediaSource) return;
    const manifest = this.manifest;
    const first = selectLiveStart(manifest, Math.min(this.targetBufferSeconds,
      manifest.target_buffer_seconds || this.targetBufferSeconds));
    if (!first) return;
    this.mediaAbort = new AbortController();
    const signal = this.mediaAbort.signal;
    const mediaSource = new this.MediaSourceClass();
    this.mediaSource = mediaSource;
    this.video.muted = true;
    this.video.srcObject = null;
    const opened = waitForMediaEvent(mediaSource, 'sourceopen', {signal, label: 'HTTP media source'});
    this.mediaUrl = this.urlApi.createObjectURL(mediaSource);
    this.video.src = this.mediaUrl;
    this.video.load?.();
    await opened;
    if (generation !== this.mediaGeneration) return;
    const source = mediaSource.addSourceBuffer(manifest.mime_type);
    source.mode = 'segments';
    this.sourceBuffer = source;
    const init = await this.request('/init', {query: {viewer_id: this.id, stream_epoch: manifest.stream_epoch},
      signal: this.requestSignal(signal), binary: true, maxBytes: 1024 * 1024});
    if (generation !== this.mediaGeneration) return;
    await this.append(init, generation);
    this.nextSequence = first.sequence;
    this.lastAppendedSequence = null;
    this.initialSeek = first.start_time;
    this.lastProgressAt = this.now();
    this.lastPlaybackTime = null;
  }

  async append(bytes, generation) {
    if (generation !== this.mediaGeneration || !this.sourceBuffer) return;
    const source = this.sourceBuffer;
    const completed = waitForMediaEvent(source, 'updateend', {
      signal: this.mediaAbort.signal, timeoutMs: 5000, failure: ['error', 'abort'], label: 'HTTP media append'
    });
    try { source.appendBuffer(bytes); }
    catch (error) {
      this.mediaAbort.abort(error);
      await completed.catch(() => {});
      throw error;
    }
    await completed;
  }

  async pump() {
    if (this.pumping || this.closed || this.manifest?.state !== 'live' || !this.id) return;
    this.pumping = true;
    const revision = this.revision, generation = this.mediaGeneration;
    try {
      await this.makeSource(generation);
      while (revision === this.revision && generation === this.mediaGeneration && this.sourceBuffer &&
          this.manifest?.state === 'live') {
        const parts = this.manifest.fragments;
        if (!parts.length || this.nextSequence > parts.at(-1).sequence) break;
        const part = parts.find(row => row.sequence === this.nextSequence);
        if (!part) { this.recoverLiveEdge('Recovering the HTTP stage at its live edge…'); break; }
        const bytes = await this.request('/fragment', {query: {viewer_id: this.id,
          stream_epoch: this.manifest.stream_epoch, sequence: part.sequence},
          signal: this.requestSignal(this.mediaAbort.signal), binary: true, maxBytes: part.bytes});
        if (revision !== this.revision || generation !== this.mediaGeneration) return;
        if (bytes.byteLength !== part.bytes) throw new Error('Incomplete HTTP stage fragment');
        await this.append(bytes, generation);
        if (revision !== this.revision || generation !== this.mediaGeneration) return;
        this.lastAppendedSequence = part.sequence;
        this.nextSequence = part.sequence + 1;
        if (this.initialSeek !== null && this.video.buffered?.length) {
          const start = this.video.buffered.start(0), end = this.video.buffered.end(this.video.buffered.length - 1);
          this.video.currentTime = Math.min(end - .001, Math.max(start, this.initialSeek + .001));
          this.initialSeek = null;
        }
        if (this.video.paused) void this.video.play().catch(() =>
          this.onStatus('OBS blocked playback; enable Control audio via OBS and retry'));
        await this.pruneBackBuffer(generation);
        if (this.bufferAhead() > this.effectiveMaxBuffer()) {
          this.recoverLiveEdge('HTTP stage buffer exceeded its limit; reconnecting at the live edge…');
          break;
        }
      }
    } catch (error) {
      if (revision === this.revision && generation === this.mediaGeneration) {
        if (error.status === 409 || error.status === 410)
          this.recoverLiveEdge('HTTP stage changed; waiting for its new stream…');
        else await this.connectionFailed(error);
      }
    } finally {
      this.pumping = false;
      if (revision === this.revision && generation !== this.mediaGeneration && this.manifest?.state === 'live')
        queueMicrotask(() => void this.pump());
    }
  }

  effectiveMaxBuffer() {
    const offered = this.manifest?.max_buffer_seconds;
    return Number.isFinite(offered) && offered >= 1 ? Math.min(offered, this.maxBufferSeconds) : this.maxBufferSeconds;
  }

  bufferAhead() {
    const ranges = this.video.buffered;
    return ranges?.length ? Math.max(0, ranges.end(ranges.length - 1) - this.video.currentTime) : 0;
  }

  async pruneBackBuffer(generation) {
    const before = this.video.currentTime - 2;
    if (!this.sourceBuffer || before <= 0 || !this.sourceBuffer.buffered?.length ||
        this.sourceBuffer.buffered.start(0) >= before) return;
    const completed = waitForMediaEvent(this.sourceBuffer, 'updateend', {
      signal: this.mediaAbort.signal, failure: ['error', 'abort'], label: 'HTTP back-buffer cleanup'
    });
    try { this.sourceBuffer.remove(0, before); }
    catch (error) {
      this.mediaAbort.abort(error);
      await completed.catch(() => {});
      throw error;
    }
    await completed;
    if (generation !== this.mediaGeneration) return;
  }

  samplePlayback() {
    if (!this.sourceBuffer || !Number.isSafeInteger(this.lastAppendedSequence) || this.lastAppendedSequence < 0) return;
    const counters = playbackCounters(this.video);
    if (counters.frames_decoded !== null && this.video.readyState >= 2) {
      const delta = this.lastRawFrames === null || counters.frames_decoded < this.lastRawFrames ?
        counters.frames_decoded : counters.frames_decoded - this.lastRawFrames;
      this.totalDecodedFrames += Math.max(0, delta);
      this.lastRawFrames = counters.frames_decoded;
      if (delta > 0 && (this.lastPlaybackTime === null || counters.current_time > this.lastPlaybackTime))
        this.lastProgressAt = this.now();
    }
    this.lastPlaybackTime = counters.current_time;
    this.connected = counters.playing && this.totalDecodedFrames > 0 &&
      this.now() - this.lastProgressAt <= this.maxStallMs;
    if (this.connected) {
      this.retries = 0;
      this.onStatus('Connected · private HTTP stage');
    }
    this.emitTimeline(counters.current_time);
    this.onStats({transport: 'HTTP-fMP4', frames_decoded: this.totalDecodedFrames,
      frame_counter_kind: counters.frame_counter_kind,
      frames_dropped: counters.frames_dropped, width: this.video.videoWidth, height: this.video.videoHeight,
      buffer_seconds: this.bufferAhead(), audio_track_present: this.manifest.audio_present === true,
      audio_output_unmuted: !counters.muted && counters.volume > 0, stream_epoch: this.manifest.stream_epoch});
    if (this.bufferAhead() > this.effectiveMaxBuffer() ||
        this.now() - this.lastProgressAt > this.maxStallMs)
      this.recoverLiveEdge('HTTP playback fell behind; recovering at the live edge…');
  }

  emitTimeline(currentTime) {
    const events = this.manifest.presentation_events || [];
    const selected = presentationAt(events, currentTime);
    const status = selected ? sanitizePresentation(selected.presentation) : sanitizePresentation({available: false});
    status.available = this.connected && status.available;
    this.lastPresentation = status;
    this.onPresentation(status.presentation_visible && status.available, status);
    for (const event of events) {
      if (!Number.isFinite(event.media_time) || event.media_time > currentTime || event.media_time < 0) continue;
      const presentation = sanitizePresentation(event.presentation);
      if (!presentation.presentation_nonce || !['playing', 'ended', 'failed'].includes(presentation.rain_audio)) continue;
      const identity = event.media_time + ':' + presentation.presentation_nonce + ':' + presentation.rain_audio;
      if (this.seenRainEvents.has(identity)) continue;
      this.seenRainEvents.add(identity);
      while (this.seenRainEvents.size > 256) this.seenRainEvents.delete(this.seenRainEvents.values().next().value);
      this.lastRain = {nonce: presentation.presentation_nonce, state: presentation.rain_audio};
      this.onRainPlayback(this.lastRain);
    }
  }

  async sendReceipt(revision) {
    if (revision !== this.revision || !this.id || this.manifest?.state !== 'live' ||
        !this.sourceBuffer || !Number.isSafeInteger(this.lastAppendedSequence) || this.lastAppendedSequence < 0) return;
    const counters = playbackCounters(this.video);
    const presentation = this.lastPresentation;
    const body = {viewer_id: this.id, stream_epoch: this.manifest.stream_epoch,
      sequence: this.lastAppendedSequence ?? -1, frames_decoded: this.totalDecodedFrames,
      current_time: counters.current_time, playing: counters.playing, muted: counters.muted,
      volume: counters.volume, audio_present: this.manifest.audio_present === true,
      ...(counters.audio_decoded_bytes === null ? {} : {audio_decoded_bytes: counters.audio_decoded_bytes}),
      presentation_nonce: presentation?.presentation_nonce || null,
      presentation_visible: this.connected && presentation?.presentation_visible === true,
      rain_nonce: this.lastRain?.nonce || null, rain_state: this.lastRain?.state || null};
    try {
      await this.request('/receiver/receipt', {body,
        signal: this.requestSignal(this.controlAbort.signal, 3000)});
    } catch (error) {
      // The next control poll observes a legitimate producer epoch change.
      if (error.status !== 409) throw error;
    }
  }

  recoverLiveEdge(message) {
    this.flushMedia();
    this.onStatus(message);
  }

  flushMedia() {
    ++this.mediaGeneration;
    this.connected = false;
    this.video.muted = true;
    this.video.pause?.();
    this.mediaAbort?.abort();
    this.mediaAbort = null;
    const source = this.sourceBuffer;
    this.sourceBuffer = null;
    if (source?.updating) { try { source.abort(); } catch {} }
    this.mediaSource = null;
    this.nextSequence = null;
    this.lastAppendedSequence = null;
    this.initialSeek = null;
    this.video.srcObject = null;
    this.video.removeAttribute?.('src');
    this.video.load?.();
    if (this.mediaUrl) this.urlApi.revokeObjectURL(this.mediaUrl);
    this.mediaUrl = null;
    this.onPresentation(false, {available: false, presentation_visible: false,
      popup: null, caption: null, presentation_nonce: null});
  }

  async connectionFailed(error) {
    const closing = this.close(), revision = this.revision;
    await closing;
    if (revision !== this.revision) return;
    this.onStatus(error.message);
    if (this.closed || !this.autoReconnect || [401, 403].includes(error.status)) return;
    const delay = Math.min(15000, 500 * 2 ** Math.min(this.retries++, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) void this.connect();
    }, delay);
  }

  async close({permanent = false} = {}) {
    if (permanent) this.closed = true;
    ++this.revision;
    clearTimeout(this.timer);
    clearTimeout(this.reconnectTimer);
    this.timer = null;
    this.reconnectTimer = null;
    this.controlAbort?.abort();
    this.controlAbort = null;
    const viewer = this.id;
    this.id = null;
    this.flushMedia();
    this.manifest = null;
    this.lastPresentation = null;
    this.lastRain = null;
    this.seenRainEvents.clear();
    this.totalDecodedFrames = 0;
    this.lastRawFrames = null;
    if (viewer) {
      try {
        await this.request('/receiver/close', {body: {viewer_id: viewer}, signal: AbortSignal.timeout(2000)});
      } catch {}
    }
  }
}
