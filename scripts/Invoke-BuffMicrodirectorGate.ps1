# Isolated PowerShell preflight for Blackout Microdirector and all approved voice categories.
# No production changes, paid events, Unity, microphone capture or model load.
[CmdletBinding()]
param([switch]$SkipFullSuite)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$branch='rd/buff-natural-voice-qwen-audit-20261014'
$repo='https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$checkout=Join-Path $env:TEMP ('buff-directed-voice-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+(Get-Random -Minimum 100 -Maximum 999))
foreach($name in @('git','node','npm','python')){
 if(-not(Get-Command $name -ErrorAction SilentlyContinue)){throw "Missing prerequisite: $name"}
}
$nodeMajor=[int]((& node -p "process.versions.node.split('.')[0]").Trim())
if($nodeMajor -lt 22){throw 'Node 22+ required'}
$disk=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($env:TEMP)))
if($disk.IsReady -and $disk.AvailableFreeSpace -lt 2GB){throw 'Less than 2 GiB free on Temp drive; no cleanup attempted'}
Write-Host 'BUFF BLACKOUT MICRODIRECTOR / FULL EPISODE VOICE AUDIT' -ForegroundColor Cyan
Write-Host 'New Temp checkout, no production changes, no live workers or provider connections.'
git clone --depth 1 --single-branch --branch $branch $repo $checkout
if($LASTEXITCODE -ne 0){throw 'Private branch clone failed'}
$sha=(git -C $checkout rev-parse HEAD).Trim()
$reportPath=Join-Path $checkout 'MICRODIRECTOR_GATE_RESULTS.json'
$report=[ordered]@{schema='buff-microdirector-gate/v1';git_sha=$sha;checkout=$checkout;
  tests=[ordered]@{};result='INCOMPLETE';native_player='NOT_TESTED';real_voice_samples='NOT_TESTED';
  qwen_runtime='NOT_TESTED';obs_audio='NOT_TESTED';error=$null}
function Gate([string]$label,[string]$exe,[string[]]$argv) {
 $log=Join-Path $checkout ($label+'.log')
 Write-Host ('--- '+$label+' ---') -ForegroundColor Cyan
 & $exe @argv *> $log
 $code=$LASTEXITCODE
 $report.tests[$label]=[ordered]@{status=if($code -eq 0){'PASS'}else{'FAIL'};exit_code=$code;log=$log}
 if($code -ne 0){
  # Print the actionable assertion, not only the final stack-trace footer.
  $failureMatches=@(Select-String -LiteralPath $log -Pattern 'not ok\s+\d+\s+-|^\s*(FAIL|FAILED)(\s|:)|^\s*(error|failureType|expected|actual):' -Context 2,8)
  if($failureMatches.Count -gt 0){
   Write-Host ('Failure diagnostics from '+$label+':') -ForegroundColor Red
   foreach($match in ($failureMatches | Select-Object -First 4)){
    @($match.Context.PreContext,$match.Line,$match.Context.PostContext) |
      ForEach-Object { if($_){Write-Host $_} }
   }
  }else{
   Get-Content -LiteralPath $log -Tail 30 | ForEach-Object {Write-Host $_}
  }
  throw "$label failed: $code (see $log)"
 }
 Get-Content -LiteralPath $log -Tail 9 | ForEach-Object {Write-Host $_}
}
Push-Location $checkout
try{
 Gate 'node_dependency_install' 'npm' @('install','--ignore-scripts','--no-audit','--fund=false')
 foreach($path in @('src/approved-delivery.mjs','src/blackout-microdirector.mjs',
   'src/blackout-microdirector-director.mjs','src/live-lore-index.mjs',
   'src/live-lore-catalog.v2.mjs','src/live-lore-extras-a.mjs','src/live-lore-extras-b.mjs',
   'src/live-lore-extras-c.mjs','src/live-topic-focus.mjs',
   'src/audience-addressee.mjs','src/blackout-shanny-heat.mjs','src/live-server.mjs',
   'src/conversation-session.mjs','src/providers/qwen.mjs','src/providers/qwen-failover.mjs',
   'src/providers/omnivoice.mjs','src/donations/parse.mjs','src/real-host.mjs')){
    Gate ('parse-'+[IO.Path]::GetFileName($path)) 'node' @('--check',$path)
 }
 Gate 'focused_microdirector' 'node' @('--test','test/blackout-microdirector.test.mjs',
  'test/voice-microdirector-smoke.test.mjs','test/live-lore-index.test.mjs',
  'test/live-topic-focus.test.mjs','test/qwen-topic-drift.test.mjs',
  'test/audience-addressee.test.mjs','test/blackout-shanny-heat.test.mjs',
  'test/conversation-session.test.mjs','test/qwen.test.mjs','test/qwen-failover.test.mjs',
  'test/qwen-character-identity.test.mjs')
 Gate 'indexed_lore_30ms_budget' 'node' @('scripts/Benchmark-BuffLore.mjs')
 Gate 'python_episode_reference_selection' 'python' @('-m','unittest','discover',
  '-s','python','-p','test_live_episode_delivery.py','-v')
 if(-not $SkipFullSuite){
  Gate 'full_node_regression' 'npm' @('test')
  Gate 'original_offline_python' 'python' @('-m','unittest','discover',
    '-s','python','-p','test_offline.py','-v')
 }
 $report.result=if($SkipFullSuite){'FOCUSED_PASS_FULL_SUITE_SKIPPED'}else{'SOURCE_GATE_PASS_HARDWARE_PENDING'}
}catch{
 $report.result='FAIL';$report.error=$_.Exception.Message
 Write-Warning $report.error
}finally{
 Pop-Location
 $report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $reportPath -Encoding utf8
 Write-Host ('Report: '+$reportPath) -ForegroundColor Cyan
 Write-Host ('Isolated checkout: '+$checkout)
 Write-Host ('Source SHA: '+$sha)
}
if($report.result -eq 'FAIL'){throw $report.error}
Write-Host 'Microdirector source tests passed; native OmniVoice and real Qwen are not yet qualified.' -ForegroundColor Green
