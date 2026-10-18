# Voice-dyad-lite and dialogue comparison evidence

The current candidate is [voice-dyad-lite](VOICE_DYAD_LITE.md): GOLD writes the dialogue and supplies its existing mood; a local voice adapter selects approved saved recordings without an additional model call. It is opt-in through `omnivoice.voiceDyadLite: true` in a future isolated configuration, with `approvedDelivery: true`. No installed configuration has been changed. The standalone dialogue experiments below remain for reproducibility and are not imported by the lite voice path.

## Earlier dialogue experiment

This branch adds a single-call dialogue candidate and a paired text-only benchmark. It is based on frozen MSI BLACKOUT GOLD `d3bdbe609b8287e77ca5741f484161cdc5405aef`, rather than the older prototype on `main`. It does not connect the candidate to the host or alter installed behavior. Review the comparison evidence before considering integration.

## What changes

`src/dyad/prompt.mjs` compresses the behavioral references into a causal writing flow: identify the question and addressee, preserve facts versus accusations, select relevant lore, develop the competing claims through actual replies, and choose delivery and length. It keeps short conditional character guidance and a semantic lore library in the same writer call. There is no extra planner, keyword retrieval call, retry, streaming speech or fallback.

After a failed pilot, three worked examples were added for a direct preference, a permission/return disagreement, and an accusation that leads to an intelligible partner dispute. They are explicitly examples, not current history. A leading explicit address such as `Rev,` also constrains the first JSON row to that actor; indirect addressees remain the writer’s responsibility. Both benchmark arms receive this identical constraint. Validation rejects wrong speaker order; it cannot establish whether the words answer the question.

Ordinary exchanges remain 2–3 sentences. An incensed contextual argument may earn 6–8; every sentence beyond the first three must be rage. Rev can remain briefly irritated while Shanny builds her case. The targeted bucket accusation earns both characters’ rage without turning the accusation into narrator fact. WARTZ is optional and restricted to Rev rage.

All 100 producer jokes and contextual cards are preserved. ARGUE passes only a selected card’s subject, context and dispute to the writer. Explanatory metaphors in the source joke list do not become literal situations. Ordinary chat selects relevant anchors by meaning within the same call.

The input builder distinguishes trusted donation events from quoted chat. A blank or whitespace-only verified donation still yields a donor/amount announcement and a money-only reaction request. The requested reaction resents Buff receiving money while their phone bill or hotel remains unpaid. It does not thank the donor or invent a donor message. A string containing payment metadata cannot enable this event.

## Experiment API

```js
import {createDyadCompletion} from '../../src/dyad/completion.mjs';
import {createDyadDirector} from '../../src/dyad/director.mjs';
import {prepareDyadInput} from '../../src/dyad/input.mjs';

const complete = createDyadCompletion({endpoint:process.env.DYAD_V620_ENDPOINT});
const writer = createDyadDirector({complete, notes:privateNotesLoadedByCaller});
const plan = await writer.generate({kind:'chat', text:comment, history, signal});
// No speech occurs here. Only a complete, validated plan is returned.
```

`generate` supports `chat`, `microphone`, `argument` and `donation`. ARGUE can supply `cardId` or use the bounded non-repeating random selection. Donation input is `{kind:'donation', donation:{donor,amountMinor,currency,message}}`, supplied only after the host’s existing verification/deduplication. The experiment accepts positive integer minor amounts and two-decimal currencies. It is not a payment verifier.

Call `prepareDyadInput` at the host boundary to obtain the separate trusted `announcement`; it must be queued before the model’s reaction. `generate` deliberately returns only the original plan shape plus `rage_bonus`, not an execution command. The writer cannot announce, display or play anything by itself. `cancel()` invalidates the generation even if a transport ignores its abort signal. A concurrent generation is rejected.

The optional `routeDyad` adapter forwards OFF to the caller’s unchanged GOLD/ARGUE routes and keeps warmup on GOLD. It is not installed anywhere. Checkbox default/persistence and donation UI verification belong to the originating installation task and are not claimed here.

The future host must cancel pending work when STOP, route changes or a new presentation epoch invalidates it. Toggling a selector alone is not cancellation. This standalone adapter does not own that UI or lifecycle.

## Reproduce safely

Offline inventory and all tests require no model:

```powershell
npm install --ignore-scripts --no-audit --fund=false
npm test
node experiments/dyad/benchmark.mjs
```

Live comparison is explicit and requires a producer-confirmed idle show. Supply the approved V620 URL in the process environment and an external character-notes path; never copy private configuration or notes into this repository. The CLI does not discover/read producer configuration itself.

```powershell
# Set DYAD_V620_ENDPOINT in this process from your approved local configuration.
node experiments/dyad/benchmark.mjs --live --quiet-window --notes <external-notes-path> --rounds 2 --warm 1 --out evidence.local/comparison.json
```

Both arms use the same model, 1,024 maximum output tokens, temperature 1, top_p 1, disabled thinking, schema, validator and input. Ten cases cover the exact bucket prompt, ordinary preference, Diet Coke, palette, floor, blank donation, payment spoofing, ARGUE, supplied history and cooperation. Two rounds reverse arm order. Each fresh-prefix request is followed immediately by the identical repeated request. No requests overlap. A unique leading measurement identifier reduces shared-prefix reuse without evicting or reloading the model; actual cache state is uninstrumented. These are cold/warm *prefix proxies*, not proven cold/warm model residency.

The runner keeps every complete output, provider usage, hash, duration and failure. It stops after three consecutive transport failures and never treats blocked networking as a model failure. Use `--cases bucket,wrestling` for a smaller explicitly selected run. Results go to ignored `evidence.local/`; only deliberately reviewed evidence should be published. Prompts, endpoint, notes and credentials are not serialized. Generated dialogue and synthetic inputs are serialized for review.

Timing is writer-request duration, not first speech or whole-show latency. Equal maximum budgets do not imply equal generated token counts. Case checks cover only observable requirements; read the dialogue against each supplied rubric. Schema compliance cannot certify contextual truth, threats in general, intelligibility or artistic quality. The threat regex blocks one known regression, not all possible unsafe language.

## Integration gates still outside this experiment

- Preserve the original GOLD files/configuration; no Microdirector or BLACKOUT_LIVE replacement.
- Keep one host/player/voice worker/chat collector and one audio owner. Preserve STOP epochs, singing ownership and stale-work rejection through the existing host.
- Prepare the entire validated 6–8-line plan through the installed bounded queue. Reveal only after all approved presentation is ready, before the first syllable, through completion/rain return. Do not infer this behavior from writer tests.
- Preserve the installed saved-voice worker: Shanny S06/full for incensed rage (17 approved recordings in the handoff), S06/medium for moderate anger (four). The copied voice-input adapter requires S06 for rage, lowercases only Shanny’s TTS input, and leaves authored captions intact. This branch neither copies nor counts voice assets and does not claim a new listening qualification.
- No UI, paid-intake, OBS, native-player, model-tuning or deployment changes are included. No merge or deployment is authorized by this draft.

See `PROVENANCE.json` for source hashes and the evidence report for measured results and remaining quality failures.
