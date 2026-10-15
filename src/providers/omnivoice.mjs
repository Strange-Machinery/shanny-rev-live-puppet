import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {liveMood,actorMoods} from '../live-moods.mjs';
import {requestedEpisodeCodes,availableEpisodeCodes} from '../approved-delivery.mjs';

/**
 * Thin client for the EXISTING /LIVE/python/omnivoice_live_worker.py protocol.
 * Model remains resident. Current worker emits a COMPLETE WAV, not PCM chunks.
 * Does not copy model, weights, voice reference assets or production code.
 */
export class OmniVoiceProvider {
  name = 'omnivoice-complete-wav';

  constructor(config) {
    for (const key of ['python', 'workerScript', 'appRoot', 'outputRoot',
      'shannyReference', 'revReference']) {
      if (typeof config[key] !== 'string' || !config[key].trim()) {
        throw new Error('OmniVoice configuration missing ' + key);
      }
    }
    for (const reference of [config.shannyReference, config.revReference]) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(reference)) {
        throw new Error('Invalid saved voice reference ID');
      }
    }
    if (config.cpuThreads !== undefined && (!Number.isInteger(config.cpuThreads) ||
      config.cpuThreads < 1 || config.cpuThreads > 8)) {
      throw new Error('OmniVoice cpuThreads must be an integer from 1 to 8');
    }
    if(config.approvedDelivery!==undefined&&typeof config.approvedDelivery!=='boolean')throw new Error('approvedDelivery must be a boolean');
    this.availableEpisodeCodes={};
    this.config = { ...config, startupMs: config.startupMs || 180_000,
      requestMs: config.requestMs || 120_000 };
    if(config.moodReferences!==undefined){
      if(!config.moodReferences||Array.isArray(config.moodReferences)||typeof config.moodReferences!=='object')throw new Error('Invalid moodReferences');
      for(const [actor,choices] of Object.entries(config.moodReferences)){
        if(!actorMoods[actor]||!choices||Array.isArray(choices)||typeof choices!=='object')throw new Error('Invalid moodReferences actor');
        for(const [mood,id] of Object.entries(choices)){
          liveMood(actor,mood);if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))throw new Error('Invalid moodReferences reference');
        }
      }
    }
    this.child = null;
    this.ready = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.startTimer = null;
    this.pending = new Map();
    this.stderrTail = '';
    this.stopping = false;
    this.busy = false;
    this.startupMs = null;
  }

  async #ensureWorker() {
    if (this.stopping) throw new Error('OmniVoice provider is stopping');
    if (this.ready) return this.ready;
    await fs.mkdir(this.config.outputRoot, { recursive: true });
    if (this.stopping) throw new Error('OmniVoice provider is stopping');
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      const c = this.config;
      this.startedAt = performance.now();
      const child = spawn(c.python, [
        c.workerScript, '--app-root', c.appRoot,
        '--output-root', c.outputRoot,
        '--shanny-reference', c.shannyReference,
        '--rev-reference', c.revReference,
        '--seed', String(c.seed || 73001),
        ...(c.moodReferences?['--mood-references',JSON.stringify(c.moodReferences)]:[]),
        ...(c.approvedDelivery?['--approved-delivery-codes',JSON.stringify(requestedEpisodeCodes)]:[])
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        // Limit only this worker; avoid CPU oversubscription alongside Whisper,
        // Qwen and Unity without changing the pinned voice generation settings.
        env: c.cpuThreads === undefined ? process.env : { ...process.env,
          OMP_NUM_THREADS: String(c.cpuThreads), MKL_NUM_THREADS: String(c.cpuThreads),
          OPENBLAS_NUM_THREADS: String(c.cpuThreads), OMP_WAIT_POLICY: 'PASSIVE' } });
      this.child = child;
      this.startTimer = setTimeout(() => {
        this.#fail(new Error('OmniVoice model startup timed out'));
      }, c.startupMs);
      const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
      reader.on('line', line => { if (this.child === child) this.#handleLine(line); });
      child.stdin.on('error', error => { if (this.child === child) this.#fail(error); });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', value => {
        this.stderrTail = (this.stderrTail + value).slice(-1000);
      });
      child.once('error', error => { if (this.child === child) this.#fail(error); });
      child.once('exit', (code, signal) => {
        if (this.child === child) {
          this.#fail(new Error('OmniVoice worker exited: ' + code + '/' + signal));
        }
      });
    });
    return this.ready;
  }

  #handleLine(line) {
    if (!line.startsWith('LIVE_WORKER ')) return;
    let message;
    try {
      message = JSON.parse(line.slice('LIVE_WORKER '.length));
    } catch {
      this.#fail(new Error('Malformed worker control message'));
      return;
    }
    if (message.type === 'READY') {
      const codes=availableEpisodeCodes(message.delivery_codes);
      if(this.config.approvedDelivery&&(!codes.SHANNY?.length||!codes.REV?.length)){
        this.#fail(new Error('Approved episode voices are unavailable for both characters'));
        return;
      }
      this.availableEpisodeCodes=codes;
      this.startupMs = performance.now() - this.startedAt;
      if (this.startTimer) clearTimeout(this.startTimer);
      this.startTimer = null;
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      return;
    }
    if (message.type === 'FATAL') {
      this.#fail(new Error('OmniVoice startup failure: ' +
        String(message?.error?.message || 'Unknown error').slice(0, 200)));
      return;
    }
    if (message.type !== 'RESULT') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.status !== 'SUCCEEDED') {
      pending.reject(new Error('OmniVoice synthesis failed: ' +
        String(message?.error?.message || 'Unknown error').slice(0, 200)));
      return;
    }
    if (message.relative_path !== pending.path) {
      pending.reject(new Error('OmniVoice returned unexpected output path'));
      return;
    }
    pending.resolve(message);
  }

  #fail(error) {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    const reject = this.readyReject;
    this.readyResolve = null;
    this.readyReject = null;
    this.ready = null;
    reject?.(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    const child = this.child;
    this.child = null;
    try { child?.kill(); } catch {}
  }

  async generate({ actor, text, mood, delivery }) {
    if (!['SHANNY', 'REV'].includes(actor)) throw new Error('Unknown actor');
    if(mood!==undefined)liveMood(actor,mood);
    if(delivery!==undefined&&(!this.config.approvedDelivery||!this.availableEpisodeCodes[actor]?.includes(delivery)))
      throw new Error('Unqualified episode voice delivery');
    if (this.busy) throw new Error('OmniVoice worker is busy');
    this.busy = true;
    try { return await this.#generate(actor, text, mood, delivery); }
    finally { this.busy = false; }
  }

  async warmup() {
    if (this.busy) throw new Error('OmniVoice worker is busy');
    this.busy = true;
    try { await this.#ensureWorker(); return { worker_cold_startup_ms: this.startupMs }; }
    finally { this.busy = false; }
  }

  async #generate(actor, text, mood, delivery) {
    const cold = !this.ready;
    await this.#ensureWorker();
    if (!this.child) throw new Error('Worker not running');
    const id = randomUUID();
    const relative = 'requests/' + id + '.wav';
    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#fail(new Error('OmniVoice generation timeout'));
      }, this.config.requestMs);
      this.pending.set(id, { resolve, reject, timer, path: relative });
      this.child.stdin.write(JSON.stringify({
        type: 'GENERATE', id, actor, text, ...(mood?{mood}:{}),
        ...(delivery?{delivery}:{}),relative_path: relative
      }) + '\n', error => {
        if (error) this.#fail(error);
      });
    });
    const root = await fs.realpath(this.config.outputRoot);
    const expected = path.resolve(root, relative);
    const real = await fs.realpath(expected);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Worker output escaped configured root');
    }
    try {
      const stat = await fs.stat(real);
      if (!stat.isFile() || stat.size > 24 * 1024 * 1024) throw new Error('Worker WAV exceeds bounded file size');
      const wav = await fs.readFile(real);
      return { wav, timings: { worker_cold_startup_ms: cold ? this.startupMs : null,
        mood:result.mood??mood??null,delivery:result.delivery??delivery??null,
        reference_id:result.reference_id??null,
        generation_ms: result.generation_ms ?? null,
        request_to_complete_wav_ms: performance.now() - started } };
    } finally {
      await fs.rm(real, { force: true });
    }
  }

  async close() {
    this.stopping = true;
    if (this.child) {
      try { this.child.stdin.write('{"type":"SHUTDOWN"}\n'); } catch {}
    }
    this.#fail(new Error('OmniVoice worker closed'));
  }
}
