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
    Write-Host 'Opening painted donation preview on a separate loopback port.' -ForegroundColor Cyan
    Start-Process 'http://127.0.0.1:18785/donation?backdrop=1&long=1'
    Write-Host 'CTRL+C stops the preview. No paid event or Unity player is running.'
    & node scripts/preview-stank-popup.mjs
  }
} finally {
  Pop-Location
}
