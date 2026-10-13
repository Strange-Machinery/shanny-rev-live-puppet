param(
 [Parameter(Mandatory=$true)][string]$Config,
 [ValidateSet('mock','omnivoice')][string]$Provider='omnivoice'
)
$ErrorActionPreference='Stop'
$settings=Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$repo=Split-Path $PSScriptRoot -Parent
if (!(Test-Path -LiteralPath $settings.player)) {throw 'Build the private Unity player first.'}
$tokenBytes=New-Object byte[] 24
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try {$rng.GetBytes($tokenBytes)} finally {$rng.Dispose()}
$env:LIVE_PUPPET_TOKEN=[BitConverter]::ToString($tokenBytes).Replace('-','')
$env:LIVE_PUPPET_PROVIDER=$Provider
$env:LIVE_PUPPET_PORT=if($settings.port){[string]$settings.port}else{'8770'}
$env:LIVE_PUPPET_URL='http://127.0.0.1:'+$env:LIVE_PUPPET_PORT
if($Provider -eq 'omnivoice') {
 foreach($key in @('OV_PYTHON','OV_WORKER_SCRIPT','OV_APP_ROOT','OV_OUTPUT_ROOT','OV_SHANNY_REFERENCE','OV_REV_REFERENCE')) {
  $value=$settings.$key
  if([string]::IsNullOrWhiteSpace($value)){throw "Private configuration is missing $key"}
  [Environment]::SetEnvironmentVariable($key,$value,'Process')
 }
}
$run=Join-Path ([IO.Path]::GetDirectoryName((Resolve-Path -LiteralPath $Config).Path)) ('sessions/'+[DateTime]::Now.ToString('yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$gateway=$null
try {
 $node=(Get-Command node.exe -ErrorAction Stop).Source
 $gateway=Start-Process $node -ArgumentList @('"'+(Join-Path $repo 'src/cli.mjs')+'"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'gateway.log') -RedirectStandardError (Join-Path $run 'gateway-errors.log')
 Write-Host 'Preparing the puppet voices. First model load may take a minute.'
 $ready=$false;$deadline=[DateTime]::UtcNow.AddMinutes(5)
 while([DateTime]::UtcNow -lt $deadline) {
  if($gateway.HasExited){throw "Gateway exited. See $run"}
  try {$null=Invoke-RestMethod ($env:LIVE_PUPPET_URL+'/v1/status') -Headers @{Authorization='Bearer '+$env:LIVE_PUPPET_TOKEN} -TimeoutSec 2;$ready=$true;break}catch{Start-Sleep -Milliseconds 300}
 }
 if(!$ready){throw "Voice startup timed out. See $run"}
 Write-Host 'Ready. Use the typed-speech buttons. Closing the puppet window also stops its gateway and worker.'
 # This is the interactive player the operator needs to see and control.
 $playerProcess=Start-Process -FilePath $settings.player -ArgumentList @('-force-d3d11','-screen-fullscreen','0','-logFile',('"'+(Join-Path $run 'player.log')+'"')) -Wait -PassThru
 if ($playerProcess.ExitCode -ne 0) {throw "Unity player exited with code $($playerProcess.ExitCode). See $run"}
} finally {
 if($gateway -and !$gateway.HasExited) {
  try{$null=Invoke-RestMethod ($env:LIVE_PUPPET_URL+'/v1/panic') -Method Post -Headers @{Authorization='Bearer '+$env:LIVE_PUPPET_TOKEN} -TimeoutSec 2}catch{}
  # Only terminate the process tree launched and owned by this invocation.
  & taskkill.exe /PID $gateway.Id /T /F | Out-Null
 }
 $env:LIVE_PUPPET_TOKEN=$null
}
