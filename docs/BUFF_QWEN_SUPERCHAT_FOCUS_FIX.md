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


## BLACKOUT_SHANNY producer behavior update — October 15

This is the `(blackout_shanny)` **writing treatment**, translated from
`Strange-Machinery/shanny-rev-engine` producer performance branch
`rd/performance-release-v01-20261008:outputs/app/producer_performance.py`,
rather than a generic pitch/volume filter.

### Content and ratio

- **Artistic target:** approximately 65% of ordinary eligible superchats draw
  a HIGH_PRESSURE Blackout moment; a direct insult or coercive demand may
  override the probabilistic baseline, while genuinely tender input may soften
  it. This is not a quota of swear words, a rule to scream 65% of the time, or
  a measurement of the original humans.
- **HIGH_PRESSURE emotional lanes:** direct pointed anger (39% of heated
  moments), disgust/contempt (22%), wounded self-victimization (21%), and
  insular withdrawn crying/sadness (18%). The remaining nonheated turns are
  bitter, sulky, resigned, wary, or momentarily sincere when earned.
- **Self-victimization matters:** Shanny can cast the *actual* comment,
  correction or missed consideration as proof that she is being treated
  unfairly; her tears can keep accusing Rev or chat rather than signaling
  reconciliation. Do not invent traumatic backstories to fill the gap.
- Swearing and personal counterattacks can be intense when earned, including
  an occasional explicit "fuck you," but they must address the active
  provocation rather than appear as a catchphrase counter.
- This is **not** a replacement for Rev's agency or the audience-address
  controller. A Shanny hot beat is valid only on Shanny's own spoken turn;
  it must NOT make Rev pretend Shanny was the person the viewer addressed.

### Implementation and performance

`src/blackout-shanny-heat.mjs` makes one bounded deterministic SHA-256-based
high-pressure/lane choice from the latest audience text, current addressee,
and at most two matched lore IDs. All cues are computed locally before
the same single Qwen call; no extra model or GPU work, no cached transcript
retrieval. It supplies a short `shanny_blackout` acting-objective object to
the user turn. Voice hints are based on the **already approved** category
codes: e.g. S11 disgust, S01/S03/S04/S05/S14 hurt/crying, S06 extreme
rage only for appropriately severe affronts. Existing face moods are
unchanged; no new Unity/OmniVoice persona is invented.

`src/audience-addressee.mjs` separately supplies viewer addressee, stage
reader, and intended reply target. The first line must be spoken by the
named recipient TO VIEWER; the second actor responds TO the named first
speaker. The `to` field is required by the Qwen schema, validated before
speech, then removed before the voice gateway; it is NOT a TTS instruction.

A reproducible internal SHA-256 distribution check across 1,000 plain
synthetic prompts yielded **663 HIGH_PRESSURE choices**, of which 251 were
anger, 155 disgust, 132 wounded victim and 125 insular crying; this is
deterministic selection evidence, **not generated Qwen quality evidence**.
The Windows MSI gate must still run the real Node assertion suite and the
combined <30 ms p99 deterministic benchmark on the latest source SHA.

### Listen to specific cases before enabling paid providers

- "Shanny, you're lying again." → Shanny answers, potentially a hard
  accusation and direct profanity when earned; Rev challenges her claim,
  not the donor's identity.
- "Shanny, why are you always the victim?" → anger, hurt or
  self-victimization from this accusation; crying is allowed, no fabricated past.
- "Rev, what did you do with KittyDoomz?" → **Rev** answers first; Shanny
  only joins in reaction to his response.
- "Shanny, thank you for helping me." → genuine warmth is permissible; not
  a compulsory humiliation or profanity.
- "What do you think about my new graphics card?" → no random food or
  historical grievance; couple retain their personality on that subject.

**Deployment hold:** Default OFF, PR remains draft; no production/voice or
mouth edits. Rejecting a malformed or off-topic model plan still stops a turn
without an autonomous retry. Test the safe synthetic paths before enabling
any authenticated paid provider.
