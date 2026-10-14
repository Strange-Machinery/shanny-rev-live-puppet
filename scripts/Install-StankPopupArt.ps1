# Installs the approved painted sprite snapshots into THIS checkout only.
# It never touches Unity, models, OBS, account tokens, or the user's other
# (possibly dirty) production checkout.
param(
  [Parameter(Mandatory=$true)]
  [string]$BundlePath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$archive = (Resolve-Path -LiteralPath $BundlePath).Path
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$target = Join-Path $root 'src\remote-web'
$expected = [ordered]@{
  'popup-art.webp' = 'd0ac1f5fbcb23f4d54331e6b1707c23c1901c90b303bbf81d5b910970af3c906'
  'popup-hotmic.webp' = '8a40c3369fdd8942cc0f9c1bbb3c81ab5e9b135c1f189a8f9fedfb21059beea0'
  'popup-art-still.webp' = '2db165ba516a9570a397149eeee1d2fa2855f5e512d72b8cab5f430a97811a89'
  'popup-hotmic-still.webp' = '56e6d9154ebccf770ab7e16f48f436de78bd3b6d8326cb5f3d1913bbbd7789a6'
}
$temp = Join-Path $env:TEMP ('stank-popup-art-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
  Expand-Archive -LiteralPath $archive -DestinationPath $temp -Force
  # Validate every payload BEFORE writing any file to the checkout.
  foreach ($entry in $expected.GetEnumerator()) {
    $src = Join-Path $temp $entry.Key
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) {
      throw "Missing approved painted asset: $($entry.Key)"
    }
    $digest = (Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -ne $entry.Value) { throw "Wrong artwork snapshot: $($entry.Key)" }
  }
  foreach ($name in $expected.Keys) {
    Copy-Item -LiteralPath (Join-Path $temp $name) -Destination (Join-Path $target $name) -Force
    Write-Host "INSTALLED $name"
  }
  Write-Host 'PAINTED_SPRITE_INSTALLED. Restart the local preview/producer host to load the artwork.'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
