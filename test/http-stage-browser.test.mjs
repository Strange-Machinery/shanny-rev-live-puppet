import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {LocalMediaPublisher} from '../src/remote-web/local-media-publisher.js';
import {HttpStagePlayer} from '../src/remote-web/http-stage-player.js';
import {stageEndpoint, validateManifest, selectLiveStart, playbackCounters,
  sanitizePresentation, presentationAt} from '../src/remote-web/http-stage-protocol.js';

const key = 'private-test-key-'.repeat(4);
const json = value => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}});
const binary = byte => new Response(Uint8Array.of(byte));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
};
async function until(check, message, timeoutMs = 1500) {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out: ' + message);
    await delay(5);
  }
}
const visible = {available: true, presentation_visible: true, presentation_mode: 'seated',
  presentation_nonce: 'presentation-one', popup: {type: 'test', message: 'Synthetic reaction'},
  caption: {actor: 'SHANNY', text: 'A local source can have silent monitoring.'}};

class Track extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.stops = 0; }
  clone() { this.cloned = new Track(this.kind); return this.cloned; }
  stop() { this.stops++; this.readyState = 'ended'; }
}
class Stream extends EventTarget {
  constructor(tracks = []) { super(); this.tracks = [...tracks]; }
  getTracks() { return [...this.tracks]; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
  addTrack(track) {
    this.tracks.push(track);
    const event = new Event('addtrack'); event.track = track; this.dispatchEvent(event);
  }
}
class AudioNode {
  constructor() { this.connections = []; this.gain = {value: 1}; }
  connect(destination) { this.connections.push(destination); }
  disconnect() { this.disconnected = true; }
}
class AudioContext {
  constructor() { this.state = 'suspended'; this.nodes = []; this.destination = new AudioNode(); }
  async resume() { this.state = 'running'; }
  createMediaStreamDestination() {
    const node = new AudioNode(); node.stream = new Stream([new Track('audio')]); this.nodes.push(node); return node;
  }
  createGain() { const node = new AudioNode(); this.nodes.push(node); return node; }
  createMediaStreamSource(stream) { const node = new AudioNode(); node.stream = stream; this.nodes.push(node); return node; }
  async close() { this.state = 'closed'; }
}
class Recorder {
  static isTypeSupported(type) { return type === 'video/webm;codecs=vp8,opus'; }
  constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  emit(size) { this.ondataavailable?.({data: new Blob([new Uint8Array(size)])}); }
  stop() { this.state = 'inactive'; }
}
class Video extends EventTarget {
  constructor() {
    super(); this.muted = true; this.volume = 1; this.readyState = 4;
    this.paused = false; this.ended = false; this.currentTime = 0;
    this.videoWidth = 1920; this.videoHeight = 1080; this.frames = 0; this.dropped = 0;
    this.ranges = [];
    this.buffered = {get length() { return this.owner.ranges.length; },
      owner: this, start: i => this.ranges[i][0], end: i => this.ranges[i][1]};
  }
  getVideoPlaybackQuality() { return {totalVideoFrames: this.frames, droppedVideoFrames: this.dropped}; }
  async play() { this.paused = false; }
  pause() { this.paused = true; }
  load() { if (!this.src) { this.readyState = 0; this.ranges = []; } }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

function publisherFixture(overrides = {}) {
  const video = new Video(), nativeVideo = new Track('video'), nativeAudio = new Track('audio');
  video.srcObject = new Stream([nativeVideo, nativeAudio]);
  const rain = new Video(), rainStream = new Stream(); rain.captureStream = () => rainStream;
  const requests = [], errors = [];
  const defaultFetch = async (url, options) => {
    requests.push({url, options, body: options.headers['Content-Type'] === 'application/json' ? JSON.parse(options.body) : null});
    if (url.endsWith('/publisher/open')) return json({publisher_id: 'publisher-one', stream_epoch: 'epoch-one',
      next_sequence: 0, max_chunk_bytes: 1024 * 1024});
    return json({accepted: true});
  };
  const publisher = new LocalMediaPublisher({video, rainAudio: rain, key,
    MediaRecorderClass: Recorder, MediaStreamClass: Stream, AudioContextClass: AudioContext,
    fetchImpl: defaultFetch, onError: error => errors.push(error), ...overrides});
  return {publisher, video, nativeVideo, nativeAudio, rain, rainStream, requests, errors, defaultFetch};
}

function manifest(extra = {}) {
  return {state: 'live', stream_epoch: 'epoch-one', mime_type: 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
    audio_present: true, target_buffer_seconds: 1.5, max_buffer_seconds: 6,
    fragments: [{sequence: 0, bytes: 1, keyframe: true, start_time: 0, end_time: 1}],
    presentation_events: [{media_time: 0, presentation: visible}], ...extra};
}

function receiverFixture({holdInit, holdFragment} = {}) {
  const video = new Video(); video.readyState = 0; video.paused = true;
  const sources = [], calls = [], revoked = [];
  let current = manifest();
  class SourceBuffer extends EventTarget {
    constructor() { super(); this.updating = false; this.appended = []; this.buffered = video.buffered; }
    appendBuffer(bytes) {
      this.updating = true;
      this.appended.push(new Uint8Array(bytes)[0]);
      queueMicrotask(() => {
        if (!this.updating) return;
        if (new Uint8Array(bytes)[0]) {
          video.ranges = [[0, 1]]; video.readyState = 4;
        }
        this.updating = false; this.dispatchEvent(new Event('updateend'));
      });
    }
    remove() { this.updating = true; queueMicrotask(() => { this.updating = false; this.dispatchEvent(new Event('updateend')); }); }
    abort() { this.updating = false; this.dispatchEvent(new Event('abort')); }
  }
  class MediaSource extends EventTarget {
    static isTypeSupported(type) { return type.startsWith('video/mp4'); }
    constructor() { super(); this.readyState = 'closed'; sources.push(this); }
    addSourceBuffer() { this.buffer = new SourceBuffer(); return this.buffer; }
  }
  const urlApi = {
    createObjectURL(source) {
      queueMicrotask(() => { source.readyState = 'open'; source.dispatchEvent(new Event('sourceopen')); });
      return 'blob:private-stage-' + sources.length;
    },
    revokeObjectURL(url) { revoked.push(url); }
  };
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    calls.push({path, url, options, body: options.body ? JSON.parse(options.body) : null});
    if (path.endsWith('/receiver/open')) return json({viewer_id: 'viewer-one', ...current});
    if (path.endsWith('/manifest')) return json(current);
    if (path.endsWith('/init')) return holdInit ? holdInit.promise : binary(0);
    if (path.endsWith('/fragment')) return holdFragment ? holdFragment.promise : binary(1);
    return json({accepted: true});
  };
  const presentations = [], rain = [];
  const player = new HttpStagePlayer({video, key, MediaSourceClass: MediaSource, urlApi, fetchImpl,
    autoReconnect: false, pollMs: 100, onPresentation: (show, status) => presentations.push({show, status}),
    onRainPlayback: status => rain.push(status)});
  return {player, video, calls, sources, revoked, presentations, rain, setManifest: value => { current = value; }};
}

test('HTTP media authentication stays on same origin and media windows require independent fragments', () => {
  for (const base of ['https://other.example', '//other.example', '/api/http-stage?key=secret'])
    assert.throws(() => stageEndpoint(base, '/init'), /same-origin/);
  assert.equal(stageEndpoint('/api/http-stage', '/init', {viewer_id: 'a/b'}), '/api/http-stage/init?viewer_id=a%2Fb');
  assert.throws(() => validateManifest(manifest({fragments: [{sequence: 0, bytes: 1, keyframe: false,
    start_time: 0, end_time: 1}]})), /fragment/);
  const parts = [0, 1, 2, 3, 4].map(sequence => ({sequence, bytes: 1, keyframe: true,
    start_time: sequence, end_time: sequence + 1}));
  assert.equal(selectLiveStart(validateManifest(manifest({fragments: parts})), 1.5).sequence, 4);
});

test('public timeline removes operator details and does not apply future captions', () => {
  const clean = sanitizePresentation({...visible, operator_key: 'must-not-escape', thoughts: 'private',
    popup: {...visible.popup, provider_token: 'also-private'}});
  assert.equal(JSON.stringify(clean).includes('private'), false);
  assert.equal(JSON.stringify(clean).includes('operator_key'), false);
  const events = [{media_time: 0, presentation: clean}, {media_time: 2,
    presentation: {...clean, caption: {actor: 'REV', text: 'Later'}}}];
  assert.equal(presentationAt(events, 1.9).presentation.caption.actor, 'SHANNY');
  assert.equal(presentationAt(events, 2).presentation.caption.actor, 'REV');
});

test('silent producer monitoring still records authorized program audio without acquiring a second source', async t => {
  const f = publisherFixture(); t.after(() => f.publisher.stop());
  f.video.muted = true; f.rain.muted = true; f.rain.volume = 0;
  f.publisher.setPresentation({...visible, presentation_mode: 'rain'});
  await f.publisher.start();
  const context = f.publisher.context;
  assert.equal(f.publisher.programGains.find(row => row.kind === 'voice').gain.gain.value, 1);
  assert.equal(f.publisher.programGains.find(row => row.kind === 'rain').gain.gain.value, 1);
  assert.ok(context.nodes.every(node => !node.connections.includes(context.destination)));
  const rainTrack = new Track('audio'); f.rainStream.addTrack(rainTrack);
  assert.ok(context.nodes.some(node => node.stream?.getAudioTracks().includes(rainTrack)));
  f.publisher.setPresentation({...visible, presentation_visible: false});
  assert.ok(f.publisher.programGains.every(row => row.gain.gain.value === 0));
  await f.publisher.stop();
  assert.equal(f.nativeVideo.stops, 0); assert.equal(f.nativeAudio.stops, 0);
  assert.equal(f.nativeVideo.cloned.stops, 1); assert.equal(rainTrack.stops, 1);
  assert.equal(f.video.muted, true); assert.equal(f.video.volume, 1);
});

test('publisher sends bounded ordered chunks and genuine timestamped soundtrack state', async t => {
  let clock = 1000;
  const f = publisherFixture({now: () => clock}); t.after(() => f.publisher.stop());
  f.publisher.setPresentation({...visible, presentation_mode: 'rain'});
  await f.publisher.start();
  f.publisher.setRainPlayback({nonce: visible.presentation_nonce, state: 'playing'});
  f.publisher.recorder.emit(10); f.publisher.recorder.emit(20);
  clock = 3000;
  f.publisher.setRainPlayback({nonce: 'wrong-nonce', state: 'ended'});
  f.publisher.setRainPlayback({nonce: visible.presentation_nonce, state: 'ended'});
  await f.publisher.metadataTail;
  await until(() => f.publisher.queuedBytes === 0, 'ordered media uploads');
  const chunks = f.requests.filter(row => row.url.includes('/publisher/chunk'));
  assert.deepEqual(chunks.map(row => new URL(row.url, 'http://localhost').searchParams.get('sequence')), ['0', '1']);
  const timeline = f.requests.filter(row => row.url.endsWith('/publisher/presentation')).map(row => row.body);
  assert.equal(timeline[0].media_time, 0);
  assert.equal(timeline.at(-1).media_time, 2);
  assert.equal(timeline.at(-1).presentation.rain_audio, 'ended');
  assert.ok(f.requests.every(row => !row.url.includes(key)));
});

test('genuine rain events cannot regress to stale native pending or replay a finished nonce', async t => {
  const f = publisherFixture(); t.after(() => f.publisher.stop());
  const rain = {...visible, presentation_mode: 'rain', rain_audio: 'pending'};
  f.publisher.setPresentation(rain);
  await f.publisher.start();
  f.publisher.setRainPlayback({nonce: visible.presentation_nonce, state: 'ended'});
  assert.equal(f.publisher.presentation.rain_audio, 'pending');
  f.publisher.setRainPlayback({nonce: visible.presentation_nonce, state: 'playing'});
  f.publisher.setPresentation({...rain, caption: {actor: 'REV', text: 'Native snapshot lags source playback'}});
  assert.equal(f.publisher.presentation.rain_audio, 'playing');
  f.publisher.setRainPlayback({nonce: visible.presentation_nonce, state: 'ended'});
  f.publisher.setPresentation(rain);
  f.publisher.setRainPlayback({nonce: visible.presentation_nonce, state: 'playing'});
  assert.equal(f.publisher.presentation.rain_audio, 'ended');
  await f.publisher.metadataTail;
  const states = f.requests.filter(row => row.url.endsWith('/publisher/presentation')).map(row => row.body.presentation.rain_audio);
  assert.equal(states.at(-1), 'ended');
  assert.equal(states.slice(states.indexOf('ended')).includes('playing'), false);
  await f.publisher.stop();
  await f.publisher.start();
  await f.publisher.metadataTail;
  assert.equal(f.requests.filter(row => row.url.endsWith('/publisher/presentation')).at(-1).body.presentation.rain_audio, null);
});

test('a suspended AudioContext cannot leave publisher startup pending indefinitely', async () => {
  class BlockedAudioContext extends AudioContext {
    resume() { return new Promise(() => {}); }
  }
  const f = publisherFixture({AudioContextClass: BlockedAudioContext, startupTimeoutMs: 500});
  await Promise.all([assert.rejects(f.publisher.start(), /did not start in time/), delay(550)]);
  assert.equal(f.publisher.starting, false);
  assert.equal(f.publisher.context, null);
  assert.equal(f.requests.some(row => row.url.endsWith('/publisher/open')), false);
});

test('a timed-out publisher open is cancelled and its late session is explicitly released', async t => {
  const opening = deferred();
  const f = publisherFixture({startupTimeoutMs: 500}); t.after(() => f.publisher.stop());
  const ordinary = f.defaultFetch;
  f.publisher.fetchImpl = (url, options) => url.endsWith('/publisher/open') ? opening.promise : ordinary(url, options);
  await Promise.all([assert.rejects(f.publisher.start(), /did not start in time/), delay(550)]);
  assert.equal(f.publisher.starting, false);
  assert.equal(f.publisher.running, false);
  opening.resolve(json({publisher_id: 'late-publisher', stream_epoch: 'late-epoch',
    next_sequence: 0, max_chunk_bytes: 1024}));
  await until(() => f.requests.some(row => row.body?.publisher_id === 'late-publisher' &&
    row.url.endsWith('/publisher/close')), 'late session cleanup');
  assert.equal(f.nativeVideo.stops, 0);
});

test('publisher start waits for old cleanup and a subsequent stop cancels that waiting start', async t => {
  const closing = deferred();
  const f = publisherFixture(); t.after(() => f.publisher.stop());
  await f.publisher.start();
  const ordinary = f.defaultFetch;
  let held = false;
  f.publisher.fetchImpl = (url, options) => {
    if (url.endsWith('/publisher/close') && !held) { held = true; return closing.promise; }
    return ordinary(url, options);
  };
  const stopped = f.publisher.stop();
  await until(() => held, 'old publisher session closing');
  const waiting = f.publisher.start();
  const cancelled = assert.rejects(waiting, {name: 'AbortError'});
  await delay(10);
  assert.equal(f.requests.filter(row => row.url.endsWith('/publisher/open')).length, 1);
  const stoppedAgain = f.publisher.stop();
  closing.resolve(json({accepted: true}));
  await Promise.all([stopped, stoppedAgain, cancelled]);
  assert.equal(f.publisher.running, false);
  assert.equal(f.publisher.starting, false);
  await f.publisher.start();
  assert.equal(f.requests.filter(row => row.url.endsWith('/publisher/open')).length, 2);
});

test('publisher stops an oversized backlog instead of dropping dependent recorder chunks', async t => {
  const upload = deferred();
  const f = publisherFixture({maxQueuedBytes: 65536});
  const ordinary = f.defaultFetch;
  f.publisher.fetchImpl = async (url, options) => {
    if (url.includes('/publisher/chunk')) return upload.promise;
    return ordinary(url, options);
  };
  t.after(() => f.publisher.stop());
  await f.publisher.start();
  const recorder = f.publisher.recorder;
  recorder.emit(40000); recorder.emit(40000);
  await until(() => !f.publisher.running, 'bounded queue stop');
  assert.equal(f.publisher.queuedBytes, 0);
  assert.equal(recorder.state, 'inactive');
  assert.equal(f.nativeVideo.stops, 0);
  upload.resolve(json({accepted: true}));
  await until(() => f.errors.length === 1, 'publisher reports bounded stop');
  assert.match(f.errors[0].message, /bounded upload queue/);
});

test('publisher reports STOP/409 before asynchronous cleanup so a page can latch explicit restart', async t => {
  const closing = deferred();
  const f = publisherFixture(); t.after(() => f.publisher.stop());
  await f.publisher.start();
  const ordinary = f.defaultFetch;
  let held = false;
  f.publisher.fetchImpl = (url, options) => {
    if (url.includes('/publisher/chunk')) return Promise.resolve(new Response('{}', {status: 409}));
    if (url.endsWith('/publisher/close')) { held = true; return closing.promise; }
    return ordinary(url, options);
  };
  f.publisher.recorder.emit(10);
  await until(() => held, 'publisher cleanup in flight');
  assert.equal(f.publisher.running, false);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].status, 409);
  closing.resolve(json({accepted: true}));
  await f.publisher.stopTask;
});

test('receiver does not send a negative-sequence readiness receipt while init/first fragment is pending', async t => {
  const held = deferred();
  const f = receiverFixture({holdInit: held}); t.after(() => f.player.close({permanent: true}));
  await f.player.connect();
  await until(() => f.calls.some(call => call.path.endsWith('/init')), 'init fetch');
  await delay(130);
  assert.equal(f.calls.filter(call => call.path.endsWith('/receiver/receipt')).length, 0);
  assert.equal(f.player.connected, false);
  held.resolve(binary(0));
  await until(() => f.player.lastAppendedSequence === 0, 'first complete media fragment');
  f.video.frames = 3; f.video.currentTime = .2;
  await until(() => f.calls.some(call => call.path.endsWith('/receiver/receipt')), 'post-playback receipt');
  assert.ok(f.calls.filter(call => call.path.endsWith('/receiver/receipt')).every(call => call.body.sequence >= 0));
});

test('receiver concurrent reconnect cannot revive an older connect waiting for close', async t => {
  const closing = deferred();
  const f = receiverFixture(); t.after(() => f.player.close({permanent: true}));
  f.setManifest(manifest({state: 'idle', fragments: []}));
  await f.player.connect();
  const ordinary = f.player.fetchImpl;
  let held = false;
  f.player.fetchImpl = (url, options) => {
    if (url.endsWith('/receiver/close') && !held) { held = true; return closing.promise; }
    return ordinary(url, options);
  };
  const older = f.player.connect();
  await until(() => held, 'old receiver closing');
  await f.player.connect();
  closing.resolve(json({accepted: true}));
  await older;
  assert.equal(f.calls.filter(row => row.path.endsWith('/receiver/open')).length, 2);
  assert.equal(f.player.id, 'viewer-one');
});

test('permanent receiver close cancels a connect still waiting for previous cleanup', async t => {
  const closing = deferred();
  const f = receiverFixture(); t.after(() => f.player.close({permanent: true}));
  f.setManifest(manifest({state: 'idle', fragments: []}));
  await f.player.connect();
  const ordinary = f.player.fetchImpl;
  let held = false;
  f.player.fetchImpl = (url, options) => {
    if (url.endsWith('/receiver/close') && !held) { held = true; return closing.promise; }
    return ordinary(url, options);
  };
  const reconnecting = f.player.connect();
  await until(() => held, 'receiver cleanup in flight');
  await f.player.close({permanent: true});
  closing.resolve(json({accepted: true}));
  await reconnecting;
  assert.equal(f.calls.filter(row => row.path.endsWith('/receiver/open')).length, 1);
  assert.equal(f.player.id, null);
  assert.equal(f.player.controlAbort, null);
});

test('STOP invalidates an in-flight old fragment before it can append or unmute', async t => {
  const held = deferred();
  const f = receiverFixture({holdFragment: held}); t.after(() => f.player.close({permanent: true}));
  await f.player.connect();
  await until(() => f.calls.some(call => call.path.endsWith('/fragment')), 'old fragment in flight');
  const old = f.sources[0].buffer;
  const stopped = manifest({state: 'stopped', stream_epoch: 'epoch-two', fragments: [], presentation_events: []});
  f.setManifest(stopped); f.player.acceptManifest(stopped);
  assert.equal(f.video.muted, true); assert.equal(f.video.paused, true);
  assert.equal(f.player.sourceBuffer, null); assert.equal(f.player.connected, false);
  held.resolve(binary(1));
  await delay(20);
  assert.deepEqual(old.appended, [0]);
  assert.ok(f.revoked.length > 0);
  assert.equal(f.calls.filter(call => call.path.endsWith('/receiver/receipt')).length, 0);
});

test('rain completion and overlay changes follow receiver media time, with a separate moving-frame receipt', async t => {
  const f = receiverFixture(); t.after(() => f.player.close({permanent: true}));
  const rain = {...visible, presentation_mode: 'rain', rain_audio: 'playing'};
  f.setManifest(manifest({presentation_events: [
    {media_time: 0, presentation: rain},
    {media_time: .5, presentation: {...rain, rain_audio: 'ended'}},
    {media_time: .7, presentation: {...visible, presentation_nonce: 'presentation-two'}}
  ]}));
  await f.player.connect();
  await until(() => f.player.lastAppendedSequence === 0, 'decoded fixture ready');
  f.video.frames = 1; f.video.currentTime = .2; f.player.samplePlayback();
  assert.equal(f.player.lastRain.state, 'playing');
  assert.equal(f.rain.some(row => row.state === 'ended'), false);
  f.video.frames = 2; f.video.currentTime = .6; f.player.samplePlayback();
  assert.equal(f.player.lastRain.state, 'ended');
  assert.equal(f.player.lastPresentation.presentation_nonce, 'presentation-one');
  f.video.frames = 3; f.video.currentTime = .8; f.player.samplePlayback();
  assert.equal(f.player.lastPresentation.presentation_nonce, 'presentation-two');
  await f.player.sendReceipt(f.player.revision);
  const receipt = f.calls.filter(call => call.path.endsWith('/receiver/receipt')).at(-1).body;
  assert.equal(receipt.rain_nonce, 'presentation-one'); assert.equal(receipt.rain_state, 'ended');
  assert.equal(receipt.presentation_nonce, 'presentation-two'); assert.equal(receipt.frames_decoded, 3);
});

test('all-dropped frames and missing decoder metrics cannot count as moving video', () => {
  const video = new Video(); video.frames = 100; video.dropped = 100;
  assert.equal(playbackCounters(video).frames_decoded, 0);
  video.getVideoPlaybackQuality = () => undefined;
  assert.equal(playbackCounters(video).frames_decoded, null);
  video.webkitDecodedFrameCount = 7;
  assert.equal(playbackCounters(video).frames_decoded, 7);
});
