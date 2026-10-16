# Safely launches the separate Blackout Microdirector / full-voice experiment.
# Explicit -Launch required. No production player, profiles, tokens or commits modified.
[CmdletBinding()]
param(
 [string]$LocalRoot=(Join-Path $HOME 'Documents\Codex\2026-10-13\files-pasted-by-the-user-codex\work\shanny-rev-live-puppet'),
 [string]$ProfilePath='',
 [string]$BundlePath=(Join-Path $HOME 'Downloads\STANK_TANK_AI_Approved_Make_It_Rain_Bundle.zip'),
 [ValidateSet('v620','msi')][string]$QwenBackend='v620',
 [string]$V620Host='100.79.20.28',
 [string]$V620Model='qwen3.8-27b',
 [string]$YouTubeVideoId='',
 [string]$YouTubeChatFixture='',
 [ValidateSet('react','read')][string]$YouTubeChatMode='react',
 [ValidateRange(5,120)][int]$YouTubeChatCooldownSeconds=12,
 [string]$YouTubeChatPython='python',
 [switch]$Launch
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$repo='https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
if($YouTubeVideoId -and $YouTubeVideoId -cnotmatch '^[a-zA-Z0-9_-]{11}$'){throw 'Invalid YouTube video ID (expected 11 characters)'}
if(-not $YouTubeChatPython){throw 'YouTube collector Python executable is required'}
if($YouTubeChatFixture -and -not(Test-Path -LiteralPath $YouTubeChatFixture -PathType Leaf)){throw 'YouTube chat fixture file not found'}
if($YouTubeVideoId -and $YouTubeChatFixture){throw 'Choose either live video ID or offline fixture, not both'}
$branch='rd/youtube-live-chat-bridge-v01-20261016'
$dir=Join-Path $env:TEMP ('buff-microdirector-trial-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+(Get-Random -Minimum 100 -Maximum 999))
$checkout=Join-Path $dir 'source'
$reportFile=Join-Path $dir 'gate.json'
foreach($name in @('git','node','npm','python')){
 if(-not(Get-Command $name -ErrorAction SilentlyContinue)){throw "Missing prerequisite: $name"}
}
if($QwenBackend -eq 'v620'){
 if($V620Host -notmatch '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.\d{1,3}\.\d{1,3}$'){
  throw 'V620 must be an explicit private Tailscale IPv4 peer'
 }
 if($V620Model -notmatch '^[a-zA-Z0-9._@/+\-]{1,200}$'){
  throw 'Invalid V620 model identifier'
 }
}
if(-not(Test-Path -LiteralPath $BundlePath -PathType Leaf)){
 throw "Approved painted HUD/music bundle not found: $BundlePath"
}
$expectedPlayer=Join-Path $LocalRoot 'work\stanktank-unity\Build\BuffStankTank.exe'
if(-not(Test-Path -LiteralPath $expectedPlayer -PathType Leaf)){
 throw "Existing isolated Buff player not found: $expectedPlayer"
}
if(-not $ProfilePath) {
 if($env:BUFF_REAL_PROFILE -and (Test-Path -LiteralPath $env:BUFF_REAL_PROFILE -PathType Leaf)){
  $ProfilePath=$env:BUFF_REAL_PROFILE
 }else{
  $candidates=@(Get-ChildItem -LiteralPath $LocalRoot -Filter producer.local.json -File -Recurse -Depth 3 -ErrorAction SilentlyContinue)
  if($candidates.Count -ne 1){throw "Need exactly one private producer.local.json; found $($candidates.Count)"}
  $ProfilePath=$candidates[0].FullName
 }
}
$cfg=Get-Content -LiteralPath $ProfilePath -Raw | ConvertFrom-Json
if($cfg.mode -ne 'real-characters' -or $cfg.media.enabled -ne $true -or
   $cfg.resourceHeadroomVerified -ne $true -or $cfg.player -ine $expectedPlayer){
 throw 'The existing private real-character profile does not match the accepted player/media/resource settings'
}
# The experiment uses its own scratch and lock. An abandoned lock in the
# ORIGINAL scratch must remain untouched; inspect the PID before deciding.
# Never bypass a live owner and never delete another session's lock.
$previousLock=Join-Path $cfg.scratch 'host.lock'
if(Test-Path -LiteralPath $previousLock -PathType Leaf){
 try {
  $previousOwner=Get-Content -LiteralPath $previousLock -Raw | ConvertFrom-Json
 }catch{
  throw 'Previous host lock is unreadable. Inspect it manually; nothing changed.'
 }
 $previousPid=0
 if(-not [int]::TryParse([string]$previousOwner.pid,[ref]$previousPid) -or $previousPid -le 0){
  throw 'Previous host lock has no valid owner PID. Inspect it manually; nothing changed.'
 }
 try {
  $previousProcess=Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = {0}" -f $previousPid) -ErrorAction Stop
 }catch{
  throw 'Could not verify original lock owner PID; refusing to start a second host.'
 }
 if($previousProcess){
  throw "Previous host-lock PID $previousPid is still active. Close the original host cleanly before running the trial."
 }
 Write-Warning "Original character host lock belongs to exited PID $previousPid. Leaving that file untouched; trial uses separate scratch."
}
$running=@(Get-Process -Name BuffStankTank,llama-server -ErrorAction SilentlyContinue)
if($running.Count){
 throw 'A native Buff/Qwen process is already running. Close the previous real-character test first.'
}
$disk=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($env:TEMP)))
if($disk.IsReady -and $disk.AvailableFreeSpace -lt 2GB){
 throw 'Less than 2 GiB free. No automatic disk cleanup is permitted.'
}
New-Item -ItemType Directory -Path $dir -Force | Out-Null
git clone --quiet --depth 1 --single-branch --branch $branch $repo $checkout
if($LASTEXITCODE -ne 0){throw 'Private isolated clone failed'}
$commit=(git -C $checkout rev-parse HEAD).Trim()
Write-Host ('Blackout Microdirector trial source: '+$commit) -ForegroundColor Cyan
& (Join-Path $checkout 'scripts\Install-StankPopupArt.ps1') -BundlePath $BundlePath
if(-not $?){throw 'Approved art and music installation failed'}
$report=[ordered]@{git_sha=$commit;checkout=$checkout;passed=@();blocked=@();deployed=$false}
function CheckCommand([string]$name,[string]$exe,[string[]]$argv){
 Push-Location $checkout
 try {
  & $exe @argv
  if($LASTEXITCODE -ne 0){throw "$name failed (exit code $LASTEXITCODE)"}
  $report.passed+=,$name
 } finally {Pop-Location}
}
try{
 CheckCommand 'npm setup' 'npm' @('install','--ignore-scripts','--no-audit','--fund=false')
 CheckCommand 'new microdirector and chat Node tests' 'node' @('--test','test/blackout-microdirector.test.mjs','test/voice-microdirector-smoke.test.mjs','test/qwen-failover.test.mjs','test/qwen.test.mjs','test/youtube-chat-bridge.test.mjs','test/youtube-chat-integration.test.mjs')
 CheckCommand 'full Node regression' 'npm' @('test')
 CheckCommand 'chat collector Python tests' 'python' @('-m','unittest','discover','-s','python','-p','test_youtube_chat_collector.py','-v')
 CheckCommand 'new episode voice sample routing tests' 'python' @('-m','unittest','discover','-s','python','-p','test_live_episode_delivery.py','-v')
 CheckCommand 'existing offline Python regression' 'python' @('-m','unittest','discover','-s','python','-p','test_offline.py','-v')
 # The source config is never modified. Trial credentials stay producer-local,
 # and this private config explicitly disables all paid donation providers.
 $cfg.scratch=Join-Path $dir 'scratch'
 $cfg.omnivoice.outputRoot=Join-Path $dir 'voice-output'
 $cfg.omnivoice.workerScript=Join-Path $checkout 'python\buff_omnivoice_worker.py'
 $cfg.omnivoice | Add-Member -MemberType NoteProperty -Name approvedDelivery -Value $true -Force
 $selectedPriority=if($QwenBackend -eq 'v620'){'v620-preferred'}else{'msi-only'}
 $remoteConfig=[pscustomobject]@{enabled=$true;qwenPriority=$selectedPriority}
 if($QwenBackend -eq 'v620'){
  $remoteConfig | Add-Member -MemberType NoteProperty -Name v620 -Value ([pscustomobject]@{host=$V620Host;model=$V620Model}) -Force
 }
 $cfg | Add-Member -MemberType NoteProperty -Name microdirector -Value $remoteConfig -Force
 $cfg | Add-Member -MemberType NoteProperty -Name donations -Value ([pscustomobject]@{}) -Force
 # Trial-only chat intake. Video ID set does NOT automatically enable chat.
 $cfg | Add-Member -MemberType NoteProperty -Name youtubeChat -Value ([pscustomobject]@{
   videoId=$YouTubeVideoId;fixture=$YouTubeChatFixture;mode=$YouTubeChatMode
   minGapMs=1000*$YouTubeChatCooldownSeconds;python=$YouTubeChatPython
 }) -Force
 $private=Join-Path $dir 'producer.trial.local.json'
 $cfg | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $private -Encoding utf8
 $report.passed+='Private trial profile prepared (no real donation credentials)'
 $report.youtube_chat_configured=([bool]($YouTubeVideoId -or $YouTubeChatFixture))
 $report.youtube_chat_default_off=$true
 $report.qwen_preference=$QwenBackend
 $report.msi_cpu_fallback=($QwenBackend -eq 'v620')
 if($QwenBackend -eq 'v620'){
  Write-Host ('Qwen trial routing: V620 LM Studio '+$V620Model+' preferred; MSI CPU 2B standby.') -ForegroundColor Cyan
  Write-Host 'V620 unavailable/unloaded causes automatic MSI CPU Qwen fallback.'
 }else{
  Write-Host 'Qwen trial routing: MSI CPU only (manual rollback mode).' -ForegroundColor Yellow
 }
 $report.private_profile='CREATED_LOCAL_NOT_SHARED'
 $report.original_profile_untouched=$true
 $report.production_player_untouched=$true
 $report.actual_episode_sample_audio='PENDING_REAL_RUNTIME_TEST'
 $report.qwen_causal_latency='PENDING_REAL_RUNTIME_TEST'
 if(-not $Launch){
  Write-Host 'DRY RUN COMPLETE. Add -Launch to start the isolated natural-voice experiment.' -ForegroundColor Yellow
 }else{
  Write-Host 'Source gates passed. Launching ONE private real-character worker in this window.' -ForegroundColor Green
  Write-Host 'Connect your own private OBS Browser Source; do NOT click Enable donation reactions.'
  Write-Host 'STOP and close the producer window when finished.'
  $previous=$env:BUFF_REAL_PROFILE
  $env:BUFF_REAL_PROFILE=$private
  try{
   Push-Location $checkout
   try{
    & python python/easy_testing.py --real
    if($LASTEXITCODE -ne 0){throw 'Real-character trial GUI exited unsuccessfully'}
   }finally{Pop-Location}
  }finally{
   if($null -ne $previous){$env:BUFF_REAL_PROFILE=$previous}else{Remove-Item Env:\BUFF_REAL_PROFILE -ErrorAction SilentlyContinue}
  }
  $report.deployed=$true
 }
}catch{
 $report.blocked+=$_.Exception.Message
 Write-Warning $_.Exception.Message
}finally{
 $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportFile -Encoding utf8
 Write-Host ('Safe trial folder: '+$dir)
 Write-Host ('Gate report: '+$reportFile)
}
if($report.blocked.Count){throw $report.blocked[0]}
