# Read-only Buff native / OBS readiness survey. No services started and no secrets read.
[CmdletBinding()]
param(
  [string]$LocalRoot = (Join-Path $HOME 'Documents\Codex\2026-10-13\files-pasted-by-the-user-codex\work\shanny-rev-live-puppet')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function IsFile([string]$p) { return [bool]($p -and (Test-Path -LiteralPath $p -PathType Leaf)) }
$unity=Join-Path $LocalRoot 'work\stanktank-unity'
$exe=Join-Path $unity 'Build\BuffStankTank.exe'
$dll=Join-Path $unity 'Build\BuffStankTank_Data\Managed\Assembly-CSharp.dll'
$stage=Join-Path $unity 'Assets\ShannyRevLivePuppet\Runtime\LiveM16Stage.cs'
$version=Join-Path $unity 'ProjectSettings\ProjectVersion.txt'
$runtime=Join-Path $LocalRoot 'work\real-runtime'
$artNames=@('popup-art.webp','popup-hotmic.webp','popup-art-still.webp','popup-hotmic-still.webp','rain-intro.mp3')
$artRoot=Join-Path (Split-Path $PSScriptRoot -Parent) 'src\remote-web'
$artMissing=@($artNames | Where-Object {-not (IsFile (Join-Path $artRoot $_))})
$binFiles=[ordered]@{}
foreach($entry in @(@('native_exe',$exe),@('managed_dll',$dll),@('m16_source',$stage))) {
  $name=$entry[0];$path=$entry[1]
  if(IsFile $path){
    $f=Get-Item -LiteralPath $path
    $binFiles[$name]=[ordered]@{exists=$true;sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;last_write_utc=$f.LastWriteTimeUtc.ToString('o');bytes=$f.Length}
  }else{$binFiles[$name]=[ordered]@{exists=$false}}
}
$nativeStatus='BLOCKED_MISSING_BINARY'
if((IsFile $exe) -and (IsFile $dll)) {
  $nativeStatus='PRESENT_BUT_CURRENT_CODE_UNVERIFIED'
  if((IsFile $stage) -and (Get-Item $stage).LastWriteTimeUtc -gt (Get-Item $dll).LastWriteTimeUtc) {
    $nativeStatus='M16_SOURCE_NEWER_THAN_DLL_REBUILD_POSSIBLY_REQUIRED'
  }
}
$editorRoots=@(
  (Join-Path $env:ProgramFiles 'Unity\Hub\Editor'),
  (Join-Path $env:ProgramFiles 'Unity Hub\Editor'),
  (Join-Path $env:LOCALAPPDATA 'Programs\Unity\Hub\Editor'),
  'D:\Unity\Hub\Editor','E:\Unity\Hub\Editor'
)
$editors=@()
foreach($dir in $editorRoots){
  if(Test-Path -LiteralPath $dir -PathType Container){
    $editors+=@(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue |
      ForEach-Object {Join-Path $_.FullName 'Editor\Unity.exe'} | Where-Object {IsFile $_})
  }
}
$obsRoots=@(
  (Join-Path $env:ProgramFiles 'obs-studio\bin\64bit\obs64.exe'),
  (Join-Path $env:LOCALAPPDATA 'Programs\obs-studio\bin\64bit\obs64.exe')
)
$obsExe=@($obsRoots | Where-Object{IsFile $_})
$profiles=@()
$profileRoots=@($LocalRoot,$runtime,(Join-Path $LocalRoot 'work'))
foreach($p in $profileRoots){
  if(Test-Path -LiteralPath $p -PathType Container){
    $profiles+=@(Get-ChildItem -LiteralPath $p -File -Filter 'producer.local.json' -ErrorAction SilentlyContinue)
  }
}
if($env:BUFF_REAL_PROFILE -and (IsFile $env:BUFF_REAL_PROFILE)){
  $profiles+=@(Get-Item -LiteralPath $env:BUFF_REAL_PROFILE)
}
$profiles=@($profiles | Select-Object -Unique FullName)
$processCounts=[ordered]@{}
foreach($name in @('obs64','BuffStankTank','Unity','llama-server','python','pythonw')){
  $processCounts[$name]=@(Get-Process -Name $name -ErrorAction SilentlyContinue).Count
}
$freeDiskGiB=$null
try {
  $disk=[IO.DriveInfo]::new([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($env:TEMP)))
  if($disk.IsReady){$freeDiskGiB=[Math]::Round($disk.AvailableFreeSpace/1GB,2)}
}catch{}
$gpu='UNAVAILABLE'
if(Get-Command nvidia-smi -ErrorAction SilentlyContinue){
  try{
    $lines=@(& nvidia-smi '--query-gpu=memory.free,memory.total' '--format=csv,noheader,nounits' 2>$null)
    if($LASTEXITCODE -eq 0 -and $lines.Count){$gpu=$lines[0].Trim()+' MiB free / total'}
  }catch{}
}
$report=[ordered]@{
  schema='buff-native-obs-readiness/v1'
  recorded_utc=[DateTimeOffset]::UtcNow.ToString('o')
  native_status=$nativeStatus
  unity_version=if(IsFile $version){(Get-Content -LiteralPath $version -TotalCount 1)}else{'MISSING'}
  native_files=$binFiles
  unity_editor_count=$editors.Count
  obs_installed=($obsExe.Count -gt 0)
  running_process_counts=$processCounts
  real_profile_count=$profiles.Count
  qwen_model_present=(IsFile (Join-Path $runtime 'Qwen3.5-2B-Q4_K_M.gguf'))
  qwen_server_present=(IsFile (Join-Path $runtime 'llama-b11429-cpu\llama-server.exe'))
  missing_approved_art=$artMissing
  free_temp_disk_gib=$freeDiskGiB
  gpu_memory=$gpu
  note='Read-only inventory. No account authentication or media verification. Private profile contents and paths are not included.'
}
$path=Join-Path $env:TEMP ('buff-native-survey-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding utf8
Write-Host '=== BUFF NATIVE / OBS READINESS ===' -ForegroundColor Cyan
Write-Host "Native: $nativeStatus"
Write-Host "Unity version: $($report.unity_version)"
Write-Host "Unity editors found: $($editors.Count)"
Write-Host "OBS installed: $($report.obs_installed); OBS running processes: $($processCounts.obs64)"
Write-Host "Qwen model/server: $($report.qwen_model_present)/$($report.qwen_server_present)"
Write-Host "Private real-character runtime profiles (not read): $($profiles.Count)"
Write-Host "Approved artwork/music missing: $($artMissing -join ', ')"
Write-Host "Free Temp disk: $freeDiskGiB GiB; GPU memory: $gpu"
Write-Host "Report: $path"
Write-Host 'No Unity, Qwen, OmniVoice, OBS, or paid provider started or modified.' -ForegroundColor Green
