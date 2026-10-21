/** Small, browser-independent checks shared by the HTTP media clients. */
export const HTTP_STAGE_BASE = '/api/http-stage';

export function stageEndpoint(base, route, query = {}) {
  if (typeof base !== 'string' || !/^\/(?!\/)[a-z0-9/_-]+$/i.test(base))
    throw new Error('HTTP stage endpoint must be a same-origin path');
  const suffix = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined) suffix.set(key, String(value));
  }
  return base.replace(/\/$/, '') + route + (suffix.size ? '?' + suffix : '');
}

export function validEpoch(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/** Public overlay fields only; never serialize the complete producer status. */
export function sanitizePresentation(status = {}) {
  const visible = status.presentation_visible === true;
  const mode = status.presentation_mode === 'rain' ? 'rain' : 'seated';
  const nonce = validEpoch(status.presentation_nonce) ? status.presentation_nonce : null;
  const output = {available: status.available !== false, presentation_visible: visible,
    presentation_mode: mode, presentation_nonce: nonce, popup: null, caption: null,
    rain_audio: ['pending', 'playing', 'ended', 'failed'].includes(status.rain_audio) ? status.rain_audio : null};
  const popup = status.popup;
  if (popup && ['hotmic', 'donation', 'test', 'celebration'].includes(popup.type)) {
    output.popup = {type: popup.type};
    if (['test', 'donation'].includes(popup.type) && typeof popup.message === 'string')
      output.popup.message = popup.message.slice(0, 1000);
    if (popup.type === 'donation') {
      output.popup.donor = typeof popup.donor === 'string' ? popup.donor.slice(0, 80) : '';
      output.popup.amount = Number.isFinite(popup.amount) && popup.amount > 0 ? popup.amount : 0;
      output.popup.currency = /^[A-Z]{3}$/.test(popup.currency) ? popup.currency : '';
    }
  }
  if (status.caption && ['SHANNY', 'REV'].includes(status.caption.actor) && typeof status.caption.text === 'string')
    output.caption = {actor: status.caption.actor, text: status.caption.text.slice(0, 1000)};
  return output;
}

export function presentationAt(events, currentTime) {
  let selected = null;
  for (const event of events || []) {
    if (!Number.isFinite(event.media_time) || event.media_time < 0 || event.media_time > currentTime) continue;
    if (!selected || event.media_time >= selected.media_time) selected = event;
  }
  return selected;
}

export function validateManifest(input) {
  if (!input || typeof input !== 'object' || !validEpoch(input.stream_epoch) ||
      !['disabled', 'idle', 'starting', 'live', 'stopped', 'error'].includes(input.state))
    throw new Error('Invalid HTTP stage manifest');
  const fragments = input.fragments ?? [];
  if (!Array.isArray(fragments) || fragments.length > 128)
    throw new Error('Invalid HTTP stage fragment window');
  let previous = -1;
  for (const part of fragments) {
    if (!part || !Number.isSafeInteger(part.sequence) || part.sequence < 0 ||
        part.sequence <= previous || !Number.isSafeInteger(part.bytes) ||
        part.bytes <= 0 || part.bytes > 16 * 1024 * 1024 || part.keyframe !== true ||
        !Number.isFinite(part.start_time) || part.start_time < 0 ||
        !Number.isFinite(part.end_time) || part.end_time <= part.start_time)
      throw new Error('Invalid HTTP stage fragment');
    previous = part.sequence;
  }
  if (input.state === 'live' && (typeof input.mime_type !== 'string' ||
      input.mime_type.length > 200 || !input.mime_type.startsWith('video/mp4')))
    throw new Error('Invalid HTTP stage codec');
  return input;
}

/** A join or recovery always starts at a complete, independent keyframe. */
export function selectLiveStart(manifest, targetSeconds = 1.5) {
  const parts = manifest.fragments;
  if (!parts.length) return null;
  const edge = parts.at(-1).end_time;
  return parts.find(part => edge - part.start_time <= targetSeconds) || parts.at(-1);
}

export function playbackCounters(video) {
  const quality = video.getVideoPlaybackQuality?.();
  // totalVideoFrames includes dropped frames in the standardized quality API.
  // Prefer an explicit decoder counter; otherwise use the conservative
  // non-dropped frame count so all-dropped input cannot establish readiness.
  const explicit = video.webkitDecodedFrameCount;
  const decoded = Number.isFinite(explicit) ? explicit :
    Number.isFinite(quality?.totalVideoFrames) && Number.isFinite(quality?.droppedVideoFrames) ?
      Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames) : null;
  const audioBytes = video.webkitAudioDecodedByteCount;
  return {
    frames_decoded: Number.isFinite(decoded) && decoded >= 0 ? decoded : null,
    frame_counter_kind: Number.isFinite(explicit) ? 'decoded' : 'non-dropped',
    frames_dropped: Number.isFinite(quality?.droppedVideoFrames) ? quality.droppedVideoFrames : null,
    audio_decoded_bytes: Number.isFinite(audioBytes) && audioBytes >= 0 ? audioBytes : null,
    current_time: Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0,
    playing: !video.paused && !video.ended && video.readyState >= 2,
    muted: video.muted === true,
    volume: Number.isFinite(video.volume) ? video.volume : 0
  };
}

/** Await one DOM event with cancellation and a finite deadline. */
export function waitForMediaEvent(target, success, {signal, timeoutMs = 8000,
  failure = ['error'], label = 'Media operation'} = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const done = error => {
      clearTimeout(timer);
      target.removeEventListener(success, complete);
      for (const name of failure) target.removeEventListener(name, failed);
      signal?.removeEventListener('abort', aborted);
      error ? reject(error) : resolve();
    };
    const complete = () => done();
    const failed = () => done(new Error(label + ' failed'));
    const aborted = () => done(signal.reason || new DOMException('Cancelled', 'AbortError'));
    if (signal?.aborted) { aborted(); return; }
    target.addEventListener(success, complete, {once: true});
    for (const name of failure) target.addEventListener(name, failed, {once: true});
    signal?.addEventListener('abort', aborted, {once: true});
    timer = setTimeout(() => done(new Error(label + ' timed out')), timeoutMs);
  });
}
