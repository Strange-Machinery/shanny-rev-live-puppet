import { randomBytes } from 'node:crypto';
import { createLiveServer } from './live-server.mjs';
import { MockVoiceProvider } from './providers/mock.mjs';
import { OmniVoiceProvider } from './providers/omnivoice.mjs';

const mode = process.env.LIVE_PUPPET_PROVIDER || 'mock';
if (!['mock', 'omnivoice'].includes(mode)) {
  throw new Error('LIVE_PUPPET_PROVIDER must be mock or omnivoice');
}

const provider = mode === 'mock'
  ? new MockVoiceProvider()
  : new OmniVoiceProvider({
    python: process.env.OV_PYTHON,
    workerScript: process.env.OV_WORKER_SCRIPT,
    appRoot: process.env.OV_APP_ROOT,
    outputRoot: process.env.OV_OUTPUT_ROOT,
    shannyReference: process.env.OV_SHANNY_REFERENCE,
    revReference: process.env.OV_REV_REFERENCE,
    seed: Number(process.env.OV_SEED || 73001)
  });

const generatedToken = !process.env.LIVE_PUPPET_TOKEN;
const token = process.env.LIVE_PUPPET_TOKEN || randomBytes(24).toString('hex');
const port = Number(process.env.LIVE_PUPPET_PORT || 8770);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('LIVE_PUPPET_PORT must be in the range 1-65535');
}
const app = createLiveServer({ provider, token, port, startMuted: true });
if (provider.warmup) {
  console.log('Loading existing private OmniVoice worker; gateway opens when ready.');
  const startup = await provider.warmup();
  console.log('Voice worker ready in ' + Math.round(startup.worker_cold_startup_ms) + ' ms.');
}
const endpoint = await app.start();

console.log('Shanny & Rev Live Puppet — ' + provider.name);
console.log('Local endpoint: http://' + endpoint.host + ':' + endpoint.port);
if (generatedToken) {
  console.log('TEMPORARY LOCAL TOKEN (paste into Unity inspector / test client): ' + token);
} else {
  console.log('Using LIVE_PUPPET_TOKEN from environment (not echoed).');
}
console.log('API remains loopback-only. Stage and provider are not cloud services.');

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exitCode = 0;
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
