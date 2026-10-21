import {LocalMediaPublisher} from '/local-media-publisher.js';

const key = new URLSearchParams(location.hash.slice(1)).get('key') || '';
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
const canvas = $('canvas'), context = canvas.getContext('2d'), video = $('input');
let publisher = null, audio = null, oscillator = null, stream = null, frame = null, captions = null;
let revision = 0, starting = false, clearing = null;
const request = (path, body) => fetch(path, {method: body === undefined ? 'GET' : 'POST',
  headers: {Authorization: 'Bearer ' + key, ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
  ...(body === undefined ? {} : {body: JSON.stringify(body)}), cache: 'no-store', redirect: 'error',
  signal: AbortSignal.timeout(4000)});

async function clearSource() {
  revision++;
  if (clearing) return clearing;
  cancelAnimationFrame(frame); clearInterval(captions); captions = null;
  const old = publisher, oldAudio = audio, oldOscillator = oscillator, oldStream = stream;
  publisher = null; audio = null; oscillator = null; stream = null;
  video.pause(); video.srcObject = null;
  $('start').disabled = true; $('stop').disabled = true;
  clearing = (async () => {
    await old?.stop();
    try { oldOscillator?.stop(); } catch {}
    for (const track of oldStream?.getTracks() || []) track.stop();
    if (oldAudio) await oldAudio.close().catch(() => {});
  })().finally(() => { clearing = null; starting = false; $('start').disabled = false; });
  return clearing;
}

$('start').onclick = async () => {
  if (starting || clearing || publisher?.running) return;
  starting = true; $('start').disabled = true;
  const own = ++revision;
  try {
    // Resume within this click's user-activation scope. All audio goes to a
    // MediaStream destination, so this producer tab remains silent.
    audio = new AudioContext({sampleRate: 48000});
    await audio.resume();
    if (own !== revision) return;
    const destination = audio.createMediaStreamDestination(), gain = audio.createGain();
    gain.gain.value = .035; gain.connect(destination);
    oscillator = audio.createOscillator(); oscillator.frequency.value = 440;
    oscillator.connect(gain); oscillator.start();
    const began = audio.currentTime;
    const draw = () => {
      if (own !== revision) return;
      const elapsed = audio.currentTime - began, band = Math.floor(elapsed / 2) % 2;
      context.fillStyle = band ? '#133849' : '#22334e'; context.fillRect(0, 0, 1280, 720);
      context.fillStyle = '#eef7ff'; context.font = 'bold 56px system-ui';
      context.fillText('SYNTHETIC HTTP STAGE', 60, 115);
      context.font = '36px system-ui'; context.fillText('Moving video + generated test tone', 60, 185);
      context.fillText(elapsed.toFixed(2) + ' s', 60, 265);
      context.fillText(band ? 'REV tone: 660 Hz' : 'SHANNY tone: 440 Hz', 60, 335);
      context.fillStyle = band ? '#ffce6e' : '#72d8dd';
      context.fillRect(60 + (elapsed * 160) % 1020, 420, 100, 150);
      context.fillStyle = '#bdd0e0'; context.font = '24px system-ui';
      context.fillText('Local fixture only. No Unity, voices, donation, stream, or recording.', 60, 665);
      oscillator.frequency.setValueAtTime(band ? 660 : 440, audio.currentTime);
      frame = requestAnimationFrame(draw);
    };
    draw();
    stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...destination.stream.getAudioTracks()]);
    video.srcObject = stream; video.muted = true;
    await video.play();
    if (own !== revision) return;
    if (video.readyState < 2) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic input did not start')), 4000);
      video.addEventListener('loadeddata', () => { clearTimeout(timer); resolve(); }, {once: true});
    });
    if (own !== revision) return;
    const nonce = 'smoke-' + crypto.randomUUID();
    publisher = new LocalMediaPublisher({video, key,
      onStatus: text => { $('state').textContent = text; },
      onError: error => { $('state').textContent = error.message; void clearSource(); }});
    const presentation = () => {
      const band = Math.floor((audio.currentTime - began) / 2) % 2;
      publisher?.setPresentation({available: true, presentation_visible: true, presentation_mode: 'seated',
        presentation_nonce: nonce, popup: {type: 'test', message: 'LOCAL SYNTHETIC HTTP PIPE TEST — no payment'},
        caption: {actor: band ? 'REV' : 'SHANNY', text: band ? 'Synthetic 660 Hz test tone' : 'Synthetic 440 Hz test tone'}});
    };
    presentation();
    await publisher.start();
    if (own !== revision) return;
    captions = setInterval(presentation, 100);
    $('stop').disabled = false; $('state').textContent = 'Synthetic feed is running. Open the receiver and enable sound.';
  } catch (error) {
    if (own !== revision) return;
    $('state').textContent = error.message;
    await clearSource();
  } finally { if (own === revision) starting = false; }
};
$('stop').onclick = async () => {
  try {
    const response = await request('/api/smoke/stop', {});
    if (!response.ok) throw new Error('The local STOP request failed');
    $('state').textContent = 'STOP revoked the old epoch. The receiver must now be hidden and silent.';
  } catch (error) { $('state').textContent = error.message; }
  await clearSource();
};
let polling = false;
const statusTimer = setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    const response = await request('/api/smoke/status');
    if (!response.ok) throw new Error('Local fixture authorization failed');
    $('status').textContent = JSON.stringify(await response.json(), null, 2);
  } catch (error) { $('status').textContent = error.message; }
  finally { polling = false; }
}, 1000);
window.addEventListener('pagehide', () => { clearInterval(statusTimer); void clearSource(); });
