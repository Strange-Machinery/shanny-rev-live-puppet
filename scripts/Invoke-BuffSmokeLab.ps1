# Buff Offline Smoke Lab. PowerShell 7.6+. No Work/Codex, real accounts, OBS changes, paid events or native build.
# This ALWAYS clones a new isolated checkout. It does not touch the producer's existing project.
[CmdletBinding()]
param(
  [switch]$Preview,
  [switch]$SkipPython,
  [string]$NativeProjectPath = (Join-Path $HOME 'Documents\Codex\2026-10-13\files-pasted-by-the-user-codex\work\shanny-rev-live-puppet\work\stanktank-unity')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$repository='https://github.com/Strange-Machinery/shanny-rev-live-puppet.git'
$branch='rd/buff-offline-smokelab-20261014'
$runId=Get-Date -Format 'yyyyMMdd-HHmmss'
$checkout=Join-Path $env:TEMP ('buff-smokelab-'+$runId+'-'+(Get-Random -Minimum 100 -Maximum 999))
$reportPath=Join-Path $checkout 'BUFF_SMOKELAB_RESULTS.json'
$report=[ordered]@{
  schema='buff-offline-smokelab/v1'
  run_id=$runId
  utc_time=[DateTimeOffset]::UtcNow.ToString('o')
  repository=$repository
  branch=$branch
  commit=$null
  checkout=$checkout
  tests=[ordered]@{}
  visual_preview='NOT_STARTED'
  native_build='NOT_INSPECTED'
  obs_video_audio='NOT_MEASURED'
  real_provider_authentication='NOT_TESTED'
  real_provider_paid_events='NOT_TESTED'
  real_youtube_live_chat='NOT_TESTED'
  note='Simulation is not proof of real payments, real OBS audio/video, native playback, or external credentials.'
  error=$null
}
function Require-Tool([string]$name) {
  $cmd=Get-Command $name -ErrorAction SilentlyContinue
  if(-not $cmd){throw "Missing executable: $name. No producer files modified."}
  return $cmd.Source
}
function Invoke-SmokeStep([string]$name,[string]$command,[string[]]$arguments) {
  $log=Join-Path $checkout ($name+'.log')
  Write-Host ("\n--- "+$name+" ---") -ForegroundColor Cyan
  & $command @arguments *> $log
  $exit=[int]$LASTEXITCODE
  $report.tests[$name]=[ordered]@{
    status=if($exit -eq 0){'PASS'}else{'FAIL'}
    exit_code=$exit
    log=$log
  }
  Get-Content -LiteralPath $log -Tail 12 | ForEach-Object {Write-Host $_}
  if($exit -ne 0){throw "$name failed (exit $exit). See $log"}
}
Write-Host 'BUFF DONATIONS: OFFLINE THREE-PROVIDER SMOKE LAB' -ForegroundColor Green
Write-Host 'Only synthetic payment events and a fresh temporary checkout are permitted.'
try {
  $git=Require-Tool 'git'
  $node=Require-Tool 'node'
  $npm=Require-Tool 'npm'
  $major=[int]((& $node -p "process.versions.node.split('.')[0]").Trim())
  if($major -lt 22){throw "Node 22+ required (found $major)."}
  $tempRoot=[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($env:TEMP))
  $disk=[IO.DriveInfo]::new($tempRoot)
  if($disk.IsReady -and $disk.AvailableFreeSpace -lt 2GB) {
    throw "Less than 2 GiB free on $tempRoot; no disk cleanup was attempted."
  }
  & $git clone --depth 1 --single-branch --branch $branch $repository $checkout
  if($LASTEXITCODE -ne 0){throw 'Git clone failed. Check private GitHub authorization.'}
  $report.commit=((& $git -C $checkout rev-parse HEAD).Trim())
  $foundBranch=((& $git -C $checkout branch --show-current).Trim())
  if($foundBranch -ne $branch){throw "Wrong checkout branch: $foundBranch"}
  Write-Host "Isolated source: $checkout"
  Write-Host "Source SHA: $($report.commit)"

  $exe=Join-Path $NativeProjectPath 'Build\BuffStankTank.exe'
  $dll=Join-Path $NativeProjectPath 'Build\BuffStankTank_Data\Managed\Assembly-CSharp.dll'
  $version=Join-Path $NativeProjectPath 'ProjectSettings\ProjectVersion.txt'
  if((Test-Path -LiteralPath $exe -PathType Leaf) -and
     (Test-Path -LiteralPath $dll -PathType Leaf)) {
    $player=Get-Item -LiteralPath $exe
    $report.native_build=[ordered]@{
      status='EXISTING_BINARY_PRESENT_UNVERIFIED'
      exe=$exe
      sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash
      bytes=$player.Length
      modified=$player.LastWriteTime.ToString('o')
      unity_version=if(Test-Path -LiteralPath $version){(Get-Content -LiteralPath $version -TotalCount 1)}else{'UNKNOWN'}
      warning='Binary inventory is NOT proof that the current donation integration was compiled into the player.'
    }
  }else{
    $report.native_build='BLOCKED_NATIVE_EXE_OR_DLL_MISSING'
  }
  $obs=Get-Process -Name 'obs64' -ErrorAction SilentlyContinue
  if($obs){
    $report.obs_video_audio='OBS_PROCESS_FOUND_BUT_NOT_CAPTURED_OR_VERIFIED'
  }
  Push-Location -LiteralPath $checkout
  try {
    Invoke-SmokeStep 'npm_install' $npm @('install','--ignore-scripts','--no-audit','--fund=false')
    Invoke-SmokeStep 'provider_three_way' $node @('--test','test/buff-offline-smokelab.test.mjs')
    Invoke-SmokeStep 'full_node_regression' $npm @('test')
    if($SkipPython){
      $report.tests['offline_python']=[ordered]@{status='SKIPPED_BY_USER'}
    }else {
      $python=Get-Command py -ErrorAction SilentlyContinue
      if($python){
        Invoke-SmokeStep 'offline_python' $python.Source @('-3','-m','unittest','discover','-s','python','-p','test_offline.py','-v')
      }else{
        $python=Get-Command python -ErrorAction SilentlyContinue
        if($python){
          Invoke-SmokeStep 'offline_python' $python.Source @('-m','unittest','discover','-s','python','-p','test_offline.py','-v')
        }else{
          $report.tests['offline_python']=[ordered]@{status='BLOCKED_NO_PYTHON'}
        }
      }
    }
    $artNames=@('popup-art.webp','popup-hotmic.webp','popup-art-still.webp','popup-hotmic-still.webp','rain-intro.mp3')
    $artMissing=@($artNames | Where-Object {-not (Test-Path -LiteralPath (Join-Path $checkout ('src\remote-web\'+$_)))})
    $report.tests['approved_art_files']=[ordered]@{
      status=if($artMissing.Count -eq 0){'PRESENT_HASH_UNVERIFIED'}else{'BLOCKED_MISSING_ART'}
      missing=$artMissing
      note='Never invent or replace the approved painted assets/soundtrack.'
    }
    if($Preview){
      $url='http://127.0.0.1:18786/donation?backdrop=1&long=1'
      $proc=Start-Process -FilePath $node -ArgumentList 'scripts/preview-stank-popup.mjs' -WorkingDirectory $checkout -Environment @{STANK_PREVIEW_PORT='18786'} -PassThru
      Start-Sleep -Milliseconds 900
      if($proc.HasExited){throw 'Preview failed to start. Local port 18786 might be in use.'}
      $report.visual_preview=[ordered]@{
        status='LOCAL_STATIC_PREVIEW_LAUNCHED_NOT_OBS_VERIFIED'
        url=$url
        hotmic_url='http://127.0.0.1:18786/hotmic?backdrop=1'
        preview_pid=$proc.Id
      }
      Write-Host ("Local 16:9 preview: "+$url) -ForegroundColor Green
      Write-Host "This is not native Unity video or verified OBS capture."
      Start-Process $url
    }
  }finally{
    Pop-Location
  }
} catch {
  $report.error=$_.Exception.Message
  Write-Warning $report.error
} finally {
  if(Test-Path -LiteralPath $checkout -PathType Container){
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
    Write-Host "\nREPORT: $reportPath" -ForegroundColor Cyan
  }
  Write-Host 'No production checkout, provider account, paid event, Unity project, or OBS scene was altered.' -ForegroundColor Yellow
}
if($report.error){throw "Buff smoke lab did not pass: $($report.error)"}
Write-Host 'Offline source and provider simulations completed; native/real OBS/Buff acceptance remain separate.' -ForegroundColor Green
