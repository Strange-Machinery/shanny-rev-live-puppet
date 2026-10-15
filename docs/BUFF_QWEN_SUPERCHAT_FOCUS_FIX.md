# Live Qwen Donation-Focus Fix — Blackout Microdirector v1

## What created the off-topic recipe/sandwich spiral

The original Microdirector assembled an apparently topic-gated user payload,
but **still inserted the complete private character-notes string in the system
message on EVERY new Qwen request**. This is a long, high-salience set of
source background and show behavior, with specific object/food examples. The
small CPU Qwen3.5-2B model may copy the strongest nouns even while being told
not to. Older episodes and recent model lines could then reinforce a tangent.

The problem is in **Qwen's generated text**, not the OmniVoice reference
catalog. The voice worker only performs the text Qwen already wrote.
Do NOT retune the working 20 Shanny / 23 Rev natural voice-category mapping.

## Opt-in branch correction

In the Microdirector path ONLY (legacy director unchanged):

1. Keep the original private notes in producer memory for source-contamination
   flags, but do NOT paste them into each Qwen completion. Use a short,
   purpose-written **behavior spine**: what Shanny objects to, what Rev
   disputes, interruptions, motivations, exceptions and possible cooperation.
2. Send the actual **current donation text**, up to five deterministic
   `focus_terms`, and only one currently matched lore grievance. Example:
   "Rev go dump the bucket" → `bucket` and its caretaker-duty argument.
   An unrelated donation → NO lore cards, no default prop or food tangent.
3. Only include producer-approved few-shot dialogue if the earlier example's
   original audience *subject* matches the incoming topic. Never include an
   arbitrary old scene solely because it is marked `microdirector: true`.
4. The existing topic-continuity layer brings forward only played lines
   grounded in the prior audience subject and only when the new input
   explicitly continues it or matches the subject. Stale bread, sandwich,
   food and recipe tangents from an unrelated input do not carry over.
5. A new, **pure-JS off-topic food gate** validates the Qwen final plan
   before any speech is released. The exact same guard suppresses speculative
   first-line voice synthesis when it is already clearly off-topic.
   This gate is NOT a global food ban: cooking questions and specifically
   matched food-lore hooks remain fully permitted.
6. Keep one Qwen call, the same 12-second model timeout, the same encoded
   voice-reference set, the same OBS and provider integration, and the
   existing `temperature:0.7, topP:0.9` for Microdirector only.
   There is no second semantic model, no external search, and no new GPU worker.

The tool reports private operator marker
`microdirector.topic_focus=superchat-only-v1` and
`background_notes_in_qwen_prompt=false` to distinguish the new code from
an older running launcher. A process launched from an old checkout will NOT
automatically reload these edits; close the test host normally and start the
new isolated version.

## Measured/required performance

The deterministic index already has 119 callback families and >600 aliases.
On the MSI, the source gate additionally benchmarks not just lookup, but the
**combined** lore + memory shaping + focus-word extraction + topic-drift
check at p99 <30 ms. Qwen inference and OmniVoice synthesis are measured
separately and excluded from that microcontroller-only budget.

Test `npm test`, `node --test test/live-topic-focus.test.mjs`,
and `node scripts/Benchmark-BuffLore.mjs` in a new isolated checkout.
A local no-model V8 simulation confirmed that this design sends no unrelated
private food notes to Qwen, passes only the bucket cue for a bucket donation,
uses one Qwen call, and suppresses an off-topic first line. A real Qwen
response quality/latency gate on the MSI remains required.

**Important failure policy:** In this draft qualification build, an
off-topic generated plan is rejected instead of being voiced. This can stop a
synthetic test turn and require operator re-arm. It is NOT yet approved for
live paid donations; before production promotion, validate fallbacks/recovery
so a real paid message is not silently consumed without a response.

## Practice inputs

- "Rev, go dump the bucket again." → bucket lore, no unasked meal talk.
- "Are you defending that KittyDoomz persona?" → Kitty Dooms lore.
- "Was your moon theory about rock or light?" → moon argument.
- "What do you think about my new graphics card?" → direct response to
  graphics card; **no lore**.
- "Can you explain this Fallout 76 weapon?" → game topic; **no lore**.
- "What ingredients are in the sandwiches?" → relevant food is explicitly
  requested and may be discussed.
- "Tell us about the Hungry Boy stream." → recognized food-related lore.
- "Hey Shanny, the weather was nice today." → social response or teasing
  about the actual remark; not source food material.

Record the exact injected lore ID, Qwen-generated text, warning state and
first-response latency locally. Do not upload producer credentials, audience
identities, raw private character notes or saved speaker prompts to GitHub.
