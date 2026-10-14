param([Parameter(Mandatory=$true)][int]$RootProcessId)
$ErrorActionPreference = 'Stop'
# One startup snapshot: only the owned host and its existing descendants.
# AboveNormal leaves Windows, audio and OBS room to remain responsive.
$processRows = @(Get-CimInstance Win32_Process)
$ownedIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$ownedIds.Add($RootProcessId)
do {
    $added = $false
    foreach ($row in $processRows) {
        if ($ownedIds.Contains([int]$row.ParentProcessId) -and $ownedIds.Add([int]$row.ProcessId)) { $added = $true }
    }
} while ($added)
$boosted = 0
foreach ($ownedId in $ownedIds) {
    if ($ownedId -eq $PID) { continue }
    try {
        $targetProcess = Get-Process -Id $ownedId -ErrorAction Stop
        $targetProcess.PriorityClass = 'AboveNormal'
        $boosted++
    } catch { }
}
if ($boosted -eq 0) { throw 'No owned show processes could be prioritized' }
Write-Output $boosted
