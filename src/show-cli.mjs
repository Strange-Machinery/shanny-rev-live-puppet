import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLocalPuppetGateway } from './donations/gateway-client.mjs';
import { createReactionDirector } from './donations/reaction.mjs';
import { DonationReactionCoordinator } from './donations/coordinator.mjs';
import { DonationLedger } from './donations/ledger.mjs';
import { createQwenCompletion } from './providers/qwen.mjs';
import { ShowController, EpisodeJobs } from './show-controller.mjs';
import { ShowRunner } from './show-runner.mjs';

const config = JSON.parse(await readFile(resolve(process.argv[2] || 'show.local.json'), 'utf8'));
const notes = JSON.parse(await readFile(resolve(config.personaFile), 'utf8'));
for (const actor of ['SHANNY','REV']) if (typeof notes[actor] !== 'string' || !notes[actor].trim() || notes[actor].length > 4000) throw new Error('External approved persona instructions required for both characters');
const gateway = createLocalPuppetGateway({ url: config.gatewayUrl, token: process.env.LIVE_PUPPET_TOKEN });
const complete = createQwenCompletion({ ...config.qwen, apiKey: process.env.QWEN_API_KEY });
// A trusted local adapter module is operator configuration, never model/audience input.
const adapters = config.adapterModule ? await import(pathToFileURL(resolve(config.adapterModule)).href) : {};
const installed = await adapters.createAdapters?.({ gateway, config: config.adapters }) || {};
let runner;
const coordinator = new DonationReactionCoordinator({ gateway, director: createReactionDirector({ complete, personaNotes: notes }),
  onError: error => console.error('Reaction failed:', error.name), onOutcome: row => runner?.outcome(row) });
const controller = new ShowController({ gateway, coordinator, player: installed.player, stage: installed.stage });
const ledger = new DonationLedger(resolve(config.ledgerFile));
runner = new ShowRunner({ gateway, coordinator, controller, ledger,
  episodes: new EpisodeJobs({ service: installed.episodes, deliveryOrigins: config.deliveryOrigins }) });
try {
  await runner.initialize();
  const addr = await runner.listen({ port: config.port || 8771, token: process.env.SHOW_OPERATOR_TOKEN, donationToken: process.env.SHOW_DONATION_TOKEN });
  console.log('Show controller: http://127.0.0.1:' + addr.port + ' — muted; explicit /live required.');
  console.log('Player/stage acceptance: ' + controller.available + '. Microphone disabled.');
} catch (error) { await runner.close(); throw error; }
let closing = false;
const timer = setInterval(() => { void runner.tick().catch(error => console.error('Event pump failed closed:',error.name)); }, 100);
async function close() { if (closing) return; closing = true; clearInterval(timer); await runner.close(); }
process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
