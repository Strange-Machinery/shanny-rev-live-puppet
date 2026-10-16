# YouTube Live Chat → Blackout Microdirector — research v0.1

Status: source-only research branch rd/youtube-live-chat-bridge-v01-20261016, **feature default OFF**.
Parent baseline: rd/buff-natural-voice-qwen-audit-20261014 (the draft V620-preferred Microdirector branch). NOT deployed, merged, qualified on MSI, or enabled on a livestream.

## Design

Read-only YouTube chat (optional pytchat-ng library) → Python JSON-Lines collector → Node bounded low-priority priority queue → a chat turn in the EXISTING ConversationSession → the EXISTING single-pass Blackout Microdirector and V620/CPU failover → EXISTING approved OmniVoice and Unity/OBS stage.

No ChatGPT/OpenAI API, no paid LLM API, no YouTube posting, no Google developer credentials.

Ordinary textMessage packets are the ONLY source admitted. Super Chats, Super Stickers, memberships, and paid events never enter the ordinary chat bridge and remain under the authenticated donation intake. Trial profile forcibly disables paid intake.

The two operator modes are:
- react: Qwen writes a 2–3-line in-character response to a selected comment; chat author/message appear as a separate YOUTUBE LIVE CHAT popup with no payment amount.
- read: selected addressed Shanny or Rev first reads the comment in the existing TTS voice, then the same Qwen director answers.

Only the existing two-character live dyad is supported here; the separate episode grammar (rev), (shanny, rev, nanny) is not yet connected to the live show.

## Admission and trust

The listener is default OFF and requires authenticated producer Enable YouTube chat. Max 24 queued text events, max 1024 dedup IDs, message expiry 45 seconds, initial-history cutoff 10 seconds, 12-second minimum between accepted chat reactions (tunable 5–120). Moderator text and member text have higher selection priority. Busy stage, STOP/muted mode, and pending paid queue reject or defer chat. An ordinary viewer typing Shut up is a quoted audience remark, not the trusted operator control. Chat cannot authorize money rain.

Input author and message are length-limited. No author channel IDs, private tokens or transaction IDs are exposed by the panel diagnostics. The public overlay uses textContent, not HTML interpretation. If Qwen rejects a viewer-generated plan, it silences/re-arms only that turn rather than permanently latching STOP.

Limitations: the web-client reader is unofficial and could break if YouTube changes transport. The official liveChatMessages.streamList source backend is a *future adapter*, not implemented. The 12-second minimum is a chat admission gap, not a first-audio latency guarantee. Chat can still occupy the single voice stage once already admitted, even if a paid event arrives moments later; strict mid-turn paid preemption is not yet qualified.

## Isolated Windows source preflight (NO launch)

Use Node 22+, Python, Git, and private GitHub read access. Keep >=2 GiB free in Temp (the existing trial guard refuses if lower).

```powershell
$ErrorActionPreference = 'Stop'
$branch = 'rd/youtube-live-chat-bridge-v01-20261016'
$bootstrap = Join-Path $env:TEMP ('youtube-chat-bootstrap-' + (Get-Date -Format yyyyMMdd-HHmmss))
git clone --quiet --depth 1 --single-branch --branch $branch https://github.com/Strange-Machinery/shanny-rev-live-puppet.git $bootstrap
if ($LASTEXITCODE -ne 0) { throw 'Private branch checkout failed' }
& (Join-Path $bootstrap 'scripts/Invoke-BuffMicrodirectorGate.ps1')
```

The gate clones another isolated checkout, parses Node files and the launcher/collector, runs focused, complete Node and Python suites and writes exact SHA/log output. It does not modify the accepted original producer install, Unity player, private profile, model, OBS configuration, donations or artwork.

## Collector-only test (NO Qwen or stage)

pytchat-ng 0.6.0 is the September 2026 release. Install in the same Python interpreter that the trial launcher will use.

```powershell
python -m pip install 'pytchat-ng==0.6.0'
python -u (Join-Path $bootstrap 'python/youtube_chat_collector.py') --video-id 'YOUR_11_CHAR_VIDEO_ID'
```

The collector prints JSONL only when ordinary public live chat is available. Ctrl+C stops. If the stream has disabled chat, is offline, or the unofficial client fails, it may print nothing or an error. It NEVER calls Qwen on its own.

## Offline fixture test (NO YouTube account or OAuth)

```powershell
$fixture = Join-Path $env:TEMP 'buff-chat-fixture.jsonl'
$ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$rows = @(
  [ordered]@{source='youtube';type='textMessage';id='test-chat-01';text='Rev, where is the bucket?';author='Viewer One';published_ms=$ms;is_moderator=$false;is_member=$false},
  [ordered]@{source='youtube';type='textMessage';id='test-chat-02';text='Shanny, what did Rev actually say?';author='Mod Two';published_ms=$ms;is_moderator=$true;is_member=$false}
)
$rows | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress } | Set-Content -LiteralPath $fixture -Encoding utf8
python -u (Join-Path $bootstrap 'python/youtube_chat_collector.py') --fixture $fixture
```

Recreate the fixture immediately before starting the staged show: normal freshness filtering will reject old timestamps. IDs are deduplicated on repeated fixture playback.

## Isolated real-character trial

The existing Start-BuffMicrodirectorTrial.ps1 on THIS research branch now specifically clones the YouTube bridge branch and accepts YouTube video ID / fixture, reaction mode and reaction gap options. It *still requires* the accepted private producer.local.json, native player, approved five-asset music/HUD bundle, proper GPU headroom and an inactive old producer session. It makes a separate Temp profile/scratch, explicitly strips all donations provider config, and does NOT auto-enable chat.

Dry-run first:

```powershell
& (Join-Path $bootstrap 'scripts/Start-BuffMicrodirectorTrial.ps1') -YouTubeVideoId 'YOUR_11_CHAR_VIDEO_ID' -YouTubeChatMode react
```

Only after tests pass and existing producer has been safely closed, launch:

```powershell
& (Join-Path $bootstrap 'scripts/Start-BuffMicrodirectorTrial.ps1') -YouTubeVideoId 'YOUR_11_CHAR_VIDEO_ID' -YouTubeChatMode react -Launch
```

For read-aloud-before-reply use -YouTubeChatMode read. For fixture-only use -YouTubeChatFixture $fixture instead of the video ID and no pytchat-ng install is required. The existing -QwenBackend msi flag forces local CPU Qwen instead of V620-preferred.

Connect the private producer preview and paired stage, then press Enable YouTube chat in the authenticated Buff launcher. To stop: Disable YouTube chat; trusted Shut up or STOP also disables the collector. The OBS Browser Source is view-only and cannot toggle it.

## Acceptance / rollback

Before any real stream:
1. Source gate full PASS with pinned SHA; specifically new youtube-chat-bridge and youtube-chat-integration tests plus all existing suites.
2. Python fixture → producer panel → Microdirector → held voice → native visible OBS → audible Shanny/Rev, with reader routing and correct speaker identity.
3. Prompt-injection / fake payment / bogus rain / STOP attempts remain untrusted; duplicate/stale and paid event types never reach Qwen.
4. Chat disable / operator STOP / bad chat generation / Python collector exit leave no stale speech or unintended restart.
5. Measure Qwen and TTS/OBS latency p50/p95 and live chat delivery cadence. Record any lag/drop.
6. Genuine paid $100+ behavior must still be accepted separately under the existing authenticated money pipeline; NEVER test genuine payments in the disconnected research trial.

Rollback: use the original rd/buff-natural-voice-qwen-audit-20261014 source and its original private profile. No source merge and no production promotion until Windows source gates and actual producer hardware/OBS listening are accepted.
