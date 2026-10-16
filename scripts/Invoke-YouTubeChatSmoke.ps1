# Safe, source-only YouTube bridge preflight. No model, Unity, OBS, donations or stream.
[CmdletBinding()]
param([switch]$FullNodeSuite)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$root=Split-Path -Parent $PSScriptRoot
$expected='rd/youtube-live-chat-bridge-v01-20261016'
foreach($tool in @('git','node','python')) {
  if(-not (Get-Command $tool -ErrorAction SilentlyContinue)){throw "Missing prerequisite: $tool"}
}
$actual=(& git -C $root branch --show-current).Trim()
if($LASTEXITCODE -ne 0 -or $actual -ne $expected) {
  throw "Run this only from a private isolated checkout of $expected (got '$actual')"
}
$sha=(& git -C $root rev-parse HEAD).Trim()
$major=[int]((& node -p "process.versions.node.split('.')[0]").Trim())
if($major -lt 22){throw 'Node 22+ required'}
$report=[ordered]@{schema='youtube-chat-source-gate/v1';branch=$expected;git_sha=$sha;
  tests=[ordered]@{};result='INCOMPLETE';unity='NOT_TESTED';qwen='NOT_TESTED';
  actual_youtube='NOT_TESTED';obs='NOT_TESTED';error=$null}
$reportPath=Join-Path $root 'YOUTUBE_CHAT_GATE_RESULTS.json'
function RunCheck([string]$label,[string]$exe,[string[]]$params) {
  Write-Host ('--- '+$label+' ---') -ForegroundColor Cyan
  & $exe @params
  $code=$LASTEXITCODE
  $report.tests[$label]=[ordered]@{status=if($code -eq 0){'PASS'}else{'FAIL'};exit_code=$code}
  if($code -ne 0){throw "$label failed: $code"}
}
Push-Location $root
try {
  foreach($name in @('scripts/Start-BuffMicrodirectorTrial.ps1',
    'scripts/Invoke-BuffMicrodirectorGate.ps1',
    'scripts/Invoke-YouTubeChatSmoke.ps1')) {
    $errors=$null;$tokens=$null
    [System.Management.Automation.Language.Parser]::ParseFile(
      (Join-Path $root $name),[ref]$tokens,[ref]$errors) | Out-Null
    if($errors.Count -gt 0){throw "PowerShell parse failure in $name : $($errors | Out-String)"}
  }
  $report.tests['powershell_parse']='PASS'
  foreach($name in @('src/youtube-chat-bridge.mjs','src/conversation-session.mjs',
      'src/blackout-microdirector-director.mjs','src/real-host.mjs',
      'src/remote-panel.mjs','src/stage-media.mjs',
      'src/remote-web/stage-page.js','src/remote-web/popup-view.js',
      'src/remote-web/panel.js','test/youtube-chat-integration.test.mjs')) {
    RunCheck ('parse_'+[IO.Path]::GetFileName($name)) 'node' @('--check',$name)
  }
  RunCheck 'node_chat_tests' 'node' @('--test',
    'test/youtube-chat-bridge.test.mjs','test/youtube-chat-integration.test.mjs')
  RunCheck 'python_chat_tests' 'python' @('-m','unittest','discover',
    '-s','python','-p','test_youtube_chat_collector.py','-v')
  if($FullNodeSuite) {
    if(-not(Get-Command npm -ErrorAction SilentlyContinue)){throw 'npm required for full regression'}
    RunCheck 'npm_install' 'npm' @('install','--ignore-scripts','--no-audit','--fund=false')
    RunCheck 'full_node_regression' 'npm' @('test')
  }
  $fixture=Join-Path $env:TEMP ('buff-chat-smoke-'+[guid]::NewGuid().ToString('N')+'.jsonl')
  try {
    $row=[ordered]@{source='youtube';type='textMessage';id='offline-test-01';
      text='Rev, what is going on?';author='Smoke Viewer';
      published_ms=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();
      is_moderator=$false;is_member=$false}
    ConvertTo-Json -InputObject $row -Compress | Set-Content -LiteralPath $fixture -Encoding utf8
    $raw=@(& python -u 'python/youtube_chat_collector.py' --fixture $fixture)
    if($LASTEXITCODE -ne 0){throw 'Python collector fixture process failed'}
    if($raw.Count -ne 1){throw "Expected one fixture row; got $($raw.Count)"}
    $got=$raw[0] | ConvertFrom-Json
    if($got.id -ne 'offline-test-01' -or $got.text -ne $row.text){
      throw 'Collector fixture text/ID did not match'
    }
    $report.tests['python_jsonl_fixture']='PASS'
  } finally {Remove-Item -LiteralPath $fixture -Force -ErrorAction SilentlyContinue}
  $report.result='SOURCE_PASS_HARDWARE_NOT_TESTED'
} catch {
  $report.error=$_.Exception.Message
  $report.result='FAIL'
} finally {
  Pop-Location
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
  Write-Host ('Source SHA: '+$sha)
  Write-Host ('Report: '+$reportPath)
}
if($report.result -eq 'FAIL'){throw $report.error}
Write-Host 'Chat bridge source checks passed; real Qwen, OmniVoice, YouTube and OBS still need MSI acceptance.' -ForegroundColor Green
