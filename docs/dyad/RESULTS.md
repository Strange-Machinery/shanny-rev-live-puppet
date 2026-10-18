# Compact live Dyad — development comparison

The single-call candidate is implemented and tested in an isolated clone. It remains experimental: text quality is uneven, especially on the targeted bucket accusation, object/claim attribution, unverified payment claims and explicit cooperation. No host, OBS, voice assets, native player, private configuration or installed GOLD source was changed; nothing was merged or deployed.

The candidate prompt is 11,497 characters versus 53,430 for the paired full control, including the same external notes (78% smaller by characters). Both get one call, a 1,024-token maximum, temperature 1, top_p 1 and thinking off.

## Paired writer measurements

80 sequential requests: 10 cases × two arms × two rounds × fresh/repeated prefix. Arm order alternates and reverses in round two. An isolated leading identifier supplies the fresh-prefix proxy; the repeat immediately reuses that request. Cache residency was not instrumented. No model reload or eviction occurred.

| Arm | Prefix proxy | Attempts | Transport failures | Contract failures | Case-check failures | Median request ms | Median output tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| full | fresh-prefix | 20 | 0 | 4 | 1 | 36935.5 | 162 |
| full | repeat-prefix | 20 | 0 | 5 | 0 | 5174 | 167.5 |
| compact | fresh-prefix | 20 | 0 | 0 | 0 | 9676 | 94.5 |
| compact | repeat-prefix | 20 | 0 | 0 | 3 | 3328 | 95.5 |

These are writer durations, including failed validation attempts, not first-speech or show latency. Equal maximum output budgets do not mean equal generated lengths. The matched-output subset below limits that confound, but is small and exploratory.

- fresh-prefix: 1 pairs with equal line counts and output tokens within 80–125%; median full/compact duration ratio 3.91×.

- repeat-prefix: 3 pairs with equal line counts and output tokens within 80–125%; median full/compact duration ratio 1.05×.

## Dialogue review

Codex read every final response against the supplied case rubric. This is a development review, not blinded evaluation or producer approval. PASS means the main textual requirements were met; MIXED retains a material weakness; FAIL misses the request or has a material contextual/attribution/heat error. The cases were known during development, so this is not a held-out quality claim.

| Arm | Pass | Mixed | Fail |
| --- | ---: | ---: | ---: |
| full | 2 | 7 | 31 |
| compact | 9 | 12 | 19 |

| Case | Full pass / mixed / fail | Compact pass / mixed / fail |
| --- | --- | --- |
| bucket | 0 / 0 / 4 | 0 / 0 / 4 |
| wrestling | 0 / 0 / 4 | 1 / 2 / 1 |
| diet-coke | 1 / 0 / 3 | 1 / 2 / 1 |
| palette | 0 / 1 / 3 | 0 / 2 / 2 |
| floor | 1 / 0 / 3 | 2 / 2 / 0 |
| money-only | 0 / 2 / 2 | 2 / 2 / 0 |
| spoof-payment | 0 / 0 / 4 | 0 / 0 / 4 |
| argue-coke | 0 / 1 / 3 | 0 / 1 / 3 |
| history | 0 / 1 / 3 | 2 / 1 / 1 |
| cooperate | 0 / 2 / 2 | 1 / 0 / 3 |

The user-facing complete transcript includes every failure and a per-response review note. JSON evidence contains original responses, token usage, timings and prompt hashes. Per-response raw hashes bind the review to those outputs. Structural validation is not semantic or artistic approval; the guard for physical threats covers observed regressions, not all possible phrasing.

## Preserved control and rejected pilot

The historical six-call full-dyad baseline remains byte-preserved: 12.482, 5.287, 5.096, 4.358, 5.418 and 7.203 seconds, median 5.353 seconds, with apparent uninstrumented prefix caching. Its 6/6 original structural passes did not establish quality. Historical GOLD runs used a smaller output budget and are not a fair speed comparator.

The paired control is byte-equivalent at prompt construction to the read-only installed full prompt using the same external notes. It is 53,430 characters, whereas the older historical hash describes 52,839. The later money-only directive accounts for 587 characters; a remaining four-character difference is not attributed. Provenance records both hashes, so this comparison is not presented as an exact replay of the older prompt.

An initial compact pilot was stopped after 18 completed responses exposed missed questions, attribution drift and a thrown-shoe threat; a following in-flight request was interrupted. Those outputs remain in pilot-v1.json. The revised candidate adds three connected-dialogue examples, explicit leading-addressee constraints and the observed threat regression guard. A separate restricted-network attempt produced no model outputs and is excluded from inference results.

## Verification and scope

289 Node tests, eight approved-voice selection tests, ten offline UI tests and seven PowerShell parser checks passed. The GOLD hash-test fix reconstructs installed CRLF bytes for comparison on LF checkouts; all four actual GOLD files already matched the installed manifest and were never edited.

The experiment preserves all 100 ARGUE cards and the full-reference control. It provides trusted blank-donation input/announcement preparation, rage-only 6–8-sentence validation, cancellation/stale-output rejection, optional GOLD routing, and the saved S06 Shanny input policy. Checkbox persistence, actual saved-voice listening, bounded eight-line preparation, STOP/presentation/audio ownership in the running installation, and show integration remain outside this draft. Passing fixture tests is not a new live-installation qualification.

Review before integration: improve the bucket response and factual attribution, stop unverified payment acknowledgements in dialogue, honor explicit cooperation, and audition retained lines through the existing approved delivery path in a separately authorized session.


Concrete writing gains were limited: the candidate named a wrestler in three of four preference samples versus zero of four for the full control; it also produced clearer floor/permission exchanges and avoided explicit thanks in all four blank-donation samples. All eight bucket outputs still failed the textual rubric, and all eight unverified-payment outputs falsely acknowledged or mishandled the claim. These are development observations, not a general quality guarantee.

GitHub CI did not run test steps: the initial PR workflow failed/cancelled at startup and no job logs were available. Its underlying cause is unconfirmed. Local verification passed; remote CI is not claimed green.

[Draft PR #13](https://github.com/Strange-Machinery/shanny-rev-live-puppet/pull/13) · [Full dialogue review](DIALOGUE_REVIEW.md)
