# SAFE, isolated, LOCAL source-and-art preflight for the approved STANK TANK AI stack.
# Never modifies dirty producer checkouts, Unity projects, OBS, or provider accounts.
# Windows PowerShell 7, Git, Node 22+, and Python 3 required.
param(
  [Parameter(Mandatory=$true)]
  [string]$BundlePath,
  [switch]$OpenPreview
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repository = 'https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$branch = 'rd/buff-pre-msi-gate-20261014'
$archive = (Resolve-Path -LiteralPath $BundlePath -ErrorAction Stop).Path
$review = Join-Path $env:TEMP ('buff-pre-msi-' +
  (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' +
  (Get-Random -Minimum 100 -Maximum 999))
foreach ($tool in @('git','node','npm')) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool is required. No files were modified."
  }
}
# Protect the producer's nearly-full MSI drive. A test clone must not
# silently consume the remaining disk if Temp lives on the system volume.
$nodeMajor = [int]((& node -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -lt 22) {
  throw "Node 22+ is required; found Node $nodeMajor. No files were modified."
}
$tempRoot = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetFullPath($env:TEMP))
$disk = [System.IO.DriveInfo]::new($tempRoot)
if ($disk.IsReady -and $disk.AvailableFreeSpace -lt 2GB) {
  throw "Less than 2 GiB free on the Temp volume ($tempRoot). Stop and reclaim space manually; do not delete producer work or Unity caches automatically."
}
Write-Host 'STANK TANK AI - SAFE PRE-MSI VALIDATION' -ForegroundColor Green
Write-Host 'Clean throwaway clone; NO Unity build, accounts, payments or OBS changes.'
& git clone --depth 1 --single-branch --branch $branch $repository $review
if ($LASTEXITCODE -ne 0) {
  throw 'Clone failed. Existing producer checkout untouched.'
}
Push-Location -LiteralPath $review
try {
  $actualBranch = (& git branch --show-current).Trim()
  if ($actualBranch -ne $branch) { throw "Wrong branch: $actualBranch" }
  $head = (& git rev-parse HEAD).Trim()
  Write-Host "Isolated branch revision: $head" -ForegroundColor Cyan
  # The installation script checks exact SHA256 for all 4 animated/still
  # painted assets and the FINAL user-edited MP3 before copying any of them.
  & (Join-Path $review 'scripts\Install-StankPopupArt.ps1') -BundlePath $archive
  if ($LASTEXITCODE -ne 0) { throw 'Approved painted art / rain cue installation failed.' }
  foreach ($name in @('popup-art.webp','popup-hotmic.webp',
      'popup-art-still.webp','popup-hotmic-still.webp','rain-intro.mp3')) {
    if (-not (Test-Path -LiteralPath (Join-Path $review "src\remote-web\$name") -PathType Leaf)) {
      throw "Approved art missing after installation: $name"
    }
  }
  Write-Host 'Running complete Node regression and virtual OBS/provider emulation…' -ForegroundColor Cyan
  & npm install --ignore-scripts --no-audit --fund=false
  if ($LASTEXITCODE -ne 0) { throw 'npm dependency preparation failed.' }
  & npm test
  if ($LASTEXITCODE -ne 0) { throw 'Node tests failed. Do NOT deploy.' }
  $python = Get-Command py -ErrorAction SilentlyContinue
  if ($python) {
    & py -3 -m unittest discover -s python -p test_offline.py
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m unittest discover -s python -p test_offline.py
  } else {
    throw 'Python 3 not found. The full acceptance preflight was NOT completed.'
  }
  if ($LASTEXITCODE -ne 0) { throw 'Offline Python tests failed. Do NOT deploy.' }
  Write-Host 'All supported offline preflight checks passed.' -ForegroundColor Green
  Write-Host "Clean validation checkout: $review"
  Write-Host 'HARDWARE CHECK STILL REQUIRED: Unity character rigs and real OBS audio/H.264.' -ForegroundColor Yellow
  Write-Host 'PROVIDER AUTH STILL REQUIRED: user-owned Streamlabs/StreamElements account test.' -ForegroundColor Yellow
  if ($OpenPreview) {
    $env:STANK_PREVIEW_PORT='18785'
    Write-Host 'Starting isolated painted preview on port 18785.' -ForegroundColor Cyan
    Write-Host 'Wait for LONG_DONATION URL below, then open it in Chrome/Edge on THIS PC.'
    Write-Host 'http://127.0.0.1:18785/donation?backdrop=1&long=1'
    Write-Host 'Keep PowerShell open while previewing. CTRL+C stops the server.'
    Write-Host 'No paid event, account login or Unity player is started.'
    & node scripts/preview-stank-popup.mjs
  }
} finally {
  Pop-Location
}
