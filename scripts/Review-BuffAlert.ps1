# Safe throwaway review. Does NOT reset/stash/merge/commit/push the producer's
# dirty checkout. No Unity build, account login, paid event or OBS changes.
# PowerShell 7 + git + Node 22+ required.
param([switch]$SkipPreview,[switch]$SkipPython,[switch]$UseCurrentCleanClone)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest

$repository='https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$branch='rd/buff-donation-provider-isolation-20261014'
$review=if($UseCurrentCleanClone){(Resolve-Path (Join-Path $PSScriptRoot '..')).Path}else{
    Join-Path $env:TEMP ('buff-alert-review-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+(Get-Random -Minimum 100 -Maximum 999))
}
foreach($tool in @('git','node','npm')){
    if(-not (Get-Command $tool -ErrorAction SilentlyContinue)){throw "$tool is required."}
}
Write-Host 'BUFF — SAFE VARIANT A REVIEW' -ForegroundColor Green
if($UseCurrentCleanClone) {
    $dirty=& git -C $review status --porcelain
    if($LASTEXITCODE -ne 0 -or $dirty){throw 'Refusing to use a dirty or non-git checkout.'}
    Write-Host "Reviewing EXISTING clean clone at $review"
} else {
    Write-Host "Cloning the review branch into $review"
    & git clone --depth 1 --single-branch --branch $branch $repository $review
    if($LASTEXITCODE -ne 0){throw 'Clone failed; original checkout remains untouched.'}
}
$checked=& git -C $review branch --show-current
if($checked.Trim() -ne $branch){throw "Unexpected branch: $checked"}
$head=& git -C $review rev-parse --short HEAD
Write-Host "Review branch at $head"
Push-Location -LiteralPath $review
try {
    Write-Host 'Installing local-test dependencies...' -ForegroundColor Cyan
    & npm install --ignore-scripts --no-audit --fund=false
    if($LASTEXITCODE -ne 0){throw 'npm install failed.'}
    Write-Host 'Running Node tests (no Unity)...' -ForegroundColor Cyan
    & npm test
    if($LASTEXITCODE -ne 0){throw 'Node tests failed; do NOT deploy.'}
    if(-not $SkipPython) {
        $py=Get-Command py -ErrorAction SilentlyContinue
        if($py){
            Write-Host 'Running offline Python tests...' -ForegroundColor Cyan
            & py -3 -m unittest discover -s python -p test_offline.py
            if($LASTEXITCODE -ne 0){throw 'Python tests failed; do NOT deploy.'}
        } elseif(Get-Command python -ErrorAction SilentlyContinue) {
            Write-Host 'Running offline Python tests...' -ForegroundColor Cyan
            & python -m unittest discover -s python -p test_offline.py
            if($LASTEXITCODE -ne 0){throw 'Python tests failed; do NOT deploy.'}
        } else {
            Write-Warning 'Python not on PATH; offline Python tests skipped.'
        }
    }
} finally {
    Pop-Location
}
Write-Host 'Source tests passed. No Unity, provider login, or OBS changes performed.' -ForegroundColor Green
if(-not $SkipPreview) {
    $node=(Get-Command node -ErrorAction Stop).Source
    $process=Start-Process -FilePath $node -ArgumentList 'scripts/preview-stank-popup.mjs' -WorkingDirectory $review -PassThru -WindowStyle Hidden
    Start-Sleep -Milliseconds 1100
    if($process.HasExited){throw 'Visual preview exited; port 18781 may be occupied.'}
    $donation='http://127.0.0.1:18781/donation'
    $hotmic='http://127.0.0.1:18781/hotmic'
    Start-Process $donation
    Write-Host "Preview opened: $donation" -ForegroundColor Green
    Write-Host "Hotmic preview: $hotmic"
    Write-Host "Preview process ID: $($process.Id) (Stop-Process -Id $($process.Id) when finished)"
}
Write-Host "Safe review checkout: $review"
Write-Host 'Next: real host/remote Buff OBS acceptance (not run here).'
