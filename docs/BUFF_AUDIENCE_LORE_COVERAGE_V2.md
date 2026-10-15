# Blackout Microdirector — audience-recognizable lore coverage v2

**Scope:** fictional adult AI_SHANNY/AI_REV characters. **Goal:** recognize the
viewer’s actual callback instantly and supply a small, motivated dispute for
one Qwen completion. This is not a timeline, documentary, conviction ledger,
voice training corpus, or license to introduce off-topic jokes.

## Corpus coverage

- **119 distinct keyed callback families, 627 exact/variant aliases** after
  deduplication review (23 previously recovered + 96 additional families).
- `src/live-lore-catalog.v2.mjs` loads the existing v1 card library and three
  curated source-labelled extension files, all without I/O, a model or network.
- `src/live-lore-index.mjs` compiles the alias → first-token map **once at
  startup**. One lookup reads only the latest bounded viewer superchat;
  returns the most relevant single cue by default, maximum two on request.
- `src/blackout-lore-router.mjs` injects these cues into the already-running
  one-pass Blackout Microdirector. Old line history is separately topic-gated.
  The whole database is NEVER put into Qwen's prompt.
- Source `evidence` is an **audience-reference class**, not a truth grade.
  `weight` is a hand-tuned alias collision precedence score, not measured
  audience frequency, confidence of the claim or moral severity.
- **No new latency-bearing model, embeddings, SQLite query, scraping,
  transcription, audio analysis or graph traversal occurs live.**
  A dedicated 20,000-input MSI benchmark must meet lookup p99 <30 ms.
  Qwen generation and OmniVoice are **outside that 30 ms lookup contract.**
  Do not claim a measured Windows result before the MSI gate runs.

## What was missing from the 23-hook v1

| Group | Audience reference examples | Character-specific response pressure |
|---|---|---|
| Shelter logistics | Tento, tent sequel, secret tent/Walmart clues, hotel/motel, eviction, house condemned, trashed home | Rev insists the practical plan has dignity; Shanny hears viewers mocking their situation and seeks attribution/blame |
| Car saga | Railroad tracks, GPS, Shanny pushing the car, "Jason call the cops" | Rev defends following directions; Shanny wants credit for rescuing the situation |
| Money | $750K inheritance, spending on games, Dogecoin, tip trains, donation-score rivalry, marathon streams | Who earned/received the money versus who spent it; gratitude does not erase resentments |
| Online figures | Von Helton, G-Man, Shabisky, Vain Veen, Foodie Beauty/Chantal, AVGN/James Rolfe, Alex Jones | How loyalty, public recognition, moral certainty and debate credit are defined |
| Catfish/romance | Ezzie/Ezzy, Norway DMs, shirt modeling, Viking, lumberjack, cybersecurity-model story, failed apology | Jealousy, disputed romantic intent, personal embarrassment; characters may deny each rumor |
| Persona/rebrands | KittyDoomz, Rev anime/drag/escort story, "arc" language, Queen Shanny, wizard/Rev(e)glio, cloak theft, fishnets/cross, OnlyFans | Performative identity versus independence, audience ridicule and the right to be taken seriously |
| Community nicknames | Baby Carrot and shirt, WARTZ, wart-as-ear/magic, "congealed," "horrorcow," whale-cry label | Humiliation, failed reassurance, facial/physical self-presentation, contempt for chat |
| Streaming props | Government phone, cigarette math, no phone/no cigarettes, donation alerts, deleted channel, algorithm uploads | Who owes what, who gets attention and ownership of technical/public space |
| Specific stream bits | Rev karaoke, Hungry Boy, Hungry Smash, kitchen-nightmare episodes, air fryer, burger/fries, earbud/Steve Austin | Each is eligible ONLY when a superchat invokes its specific bit; there is no blanket food trigger |
| Conflict signatures | "Let me SPEAK," "Shanny STOP," "YOU GET IT?," "what have I done," "this is abusive," "my house," "nevered," "mook" | Floor theft, defensive over-explanation, failed reassurance and conflicting definitions |
| Public incident/claim | Police interruption, protective-order/court headlines, custody allegations, hospital/missing rumors, house condition | Their responses are actor perspectives: affirm, deny, dispute scope, counterclaim, request context, or dismiss chat |
| Pair dynamics | Temporary alliances, breakup/reunion, giving away credit, cigarette favor, shifting blame, online loyalty tests | Both characters must have agency; neither is locked into aggressor/victim or winner/loser |

## Examples of expected Qwen context

**Superchat:** "Rev, go dump the shitbucket again."

**Deterministic cue:** `bucket` — Rev resents the degrading cleanup
responsibility; Shanny treats it as his practical duty and rejects the audience
framing. NOT a claim that the cartoon is currently animating a physical bucket.

**Superchat:** "Rev, weren't you KittyDoomz?"

**Cue:** `kitty-dooms` — Rev can claim the persona as performance or
independence; Shanny may question whether it used her makeup. The original
self-introduction is unresolved; neither actor must admit any particular rumor.

**Superchat:** "Remember Rev dropkicking Will?"

**Cue:** `will-dropkick` — the audience is invoking a recognizable
producer-named account. Rev can exaggerate or reject it; Shanny can contest his
self-image. No additional invented victim details or consequences.

**Superchat:** "What ingredients are in a sandwich?"

**Cue:** none. Qwen answers the incoming question, without inventing Ezzie,
Tento, buckets or other old scenes.

## Provenance / research sources

1. Earlier producer-owned [60-item lore idiom prospect bank](https://github.com/DoofWizard/character_details/blob/main/thought_bubble/LORE_INTRUSION_PROSPECT_BANK_V0_1.tsv) and
   [lore callback usage rules](https://github.com/DoofWizard/character_details/blob/main/thought_bubble/LORE_CALLBACK_EMOJI_IDIOMS_V0_1.md).
   A callback's status of source-confirmed may describe an archived reaction
   **title**, not a direct verification of the underlying story.
2. Episode writer's [source notes](https://github.com/DoofWizard/character_details/blob/main/LORE.md) and [timecoded media index](https://github.com/DoofWizard/character_details/blob/main/SOURCES.md).
3. The separate producer Library **SOURCE_INDEX.md** and
   **LOREGRAPH_BLACKOUT_AUDIT_HANDOFF_2026-10-07**, whose original raw
   Dramatis/LoreGraph transcript archive is outside Git.
4. Drunken Peasants public episode titles (e.g. `#1555–#1567`,
   `#1607–#1649`, `#1673`, and later 2026 retrospectives), which
   expose what reaction audiences refer to; titles are NOT independent
   corroboration of events.
5. Archived community discussion [G-Man/Von loyalty timeline](https://www.reddit.com/r/drunkenpeasants/comments/dd2si5),
   [community railroad-tracks recollection](https://www.reddit.com/r/FoodieBeauty/comments/1121u9n),
   and [Tento audience discussion](https://www.reddit.com/r/drunkenpeasants/comments/1rp6wg4/).
   These are audience allegations and jokes, not the show asserting them.

## Eligible audience-claim stance

Do NOT filter a lore hook out merely because it is a disputed community story.
The system records who says it, the joke viewers associate with it, and the
characters' plausible competing goals. Qwen can react as SHANNY/REV with:
- denial or literal correction;
- deflection and argument over wording;
- offended acceptance of the implication but contesting blame;
- boastful exaggeration;
- turning the allegation back on the donor;
- rare agreement or a moment of recognition.

**Not acceptable:** presenting rumor as independently proved, inventing new
named participants or criminal details, producing medical diagnoses, sharing
private locations, bullying by default, unprompted flashbacks, or repeatedly
hijacking an unrelated comment into food, insults or old lore.

## Still missing — honest coverage gaps

119 families are a substantial retrieval improvement, **not the entire lore
universe**. The next corpus expansion must be mined OFFLINE from the private
Dramatis/LoreGraph transcript lineage and 2026 reaction-community archive:

- Exact timecoded variants and misspellings fans quote, plus meme captions.
- Multi-incident chains (what earlier joke is implied by a clipped comment).
- Event-relation graph: “X happened because Y,” “Rev denies X but Shanny
  contests the intent,” “friend A later became critic.”
- Actors' actual argumentative responses to those specific references, as
  distinct from reaction-host commentary.
- Frequency/salience from **independent** audience occurrences, deduping
  reposted video mirrors.
- Show-only versus historical source jokes without contaminating one another.
- Negative/no-hook superchats and collision/adversarial tests from real viewers.

The runtime continues to use **one compiled index**. Offline harvesting can
produce hundreds or thousands of additional aliases without adding Qwen calls.
Do not move raw private transcripts or paid-provider credentials into GitHub.

## Acceptance before enabling on MSI

- `node --test test/live-lore-index.test.mjs` tests fan recall and source
  tags; full Node and Python regressions must pass.
- `node scripts/Benchmark-BuffLore.mjs` measures 20,000 representative
  lookups and enforces **p99 <30ms** on the producer computer.
- Run a review pack of unrelated and lore-challenging superchats, verify
  the exact injected hook, actor disagreement, and no food tangent.
- Keep the Microdirector and the natural OmniVoice routing **opt-in** in
  isolated trial until real Qwen listening and performance pass.
