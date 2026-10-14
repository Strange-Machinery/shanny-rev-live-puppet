param([string]$Python)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
if(!$Python){$Python=(Get-Command python.exe -ErrorAction Stop).Source}
# This is the visible interactive test window requested by the operator.
& $Python (Join-Path $repo 'python/testing_tab.py')
