param([Parameter(Mandatory=$true)][string]$RecordName)
$ErrorActionPreference='Stop'
$fixture1831=[IO.File]::ReadAllText((Join-Path (Get-Location).Path '.tmp/1831-root-fixture-pointer.txt')).Trim()
$manifest1831=Get-Content -LiteralPath (Join-Path $fixture1831 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime1831=Get-Content -LiteralPath (Join-Path $fixture1831 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1831=[IO.Path]::GetFullPath((Get-Location).Path)
if([IO.Path]::GetFullPath($manifest1831.repo) -ne $checkout1831 -or $manifest1831.origin -ne $runtime1831.origin){throw 'Owned manifest origin/path mismatch'}
$origin1831=[uri]$runtime1831.origin
if($origin1831.Host -ne 'localhost' -or $origin1831.Port -ne $runtime1831.port){throw 'Unexpected runtime origin'}
$root1831=Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest1831.pid)"
if(-not $root1831 -or -not $root1831.CommandLine.Contains($checkout1831) -or $root1831.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev'){throw 'Owned Next process identity mismatch'}
$records1831=New-Object System.Collections.Generic.List[object]
$records1831.Add($root1831)
for($index1831=0;$index1831 -lt $records1831.Count;$index1831++){
 $parent1831=$records1831[$index1831]
 foreach($child1831 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent1831.ProcessId)")){
  if($child1831.CreationDate -lt $root1831.CreationDate){throw 'Unexpected earlier descendant creation time'}
  if(@($records1831 | Where-Object ProcessId -eq $child1831.ProcessId).Count -eq 0){$records1831.Add($child1831)}
 }
}
$ids1831=@($records1831 | ForEach-Object {[int]$_.ProcessId})
$listeners1831=@(Get-NetTCPConnection -LocalPort $origin1831.Port -State Listen -ErrorAction SilentlyContinue)
if($listeners1831.Count -eq 0 -or @($listeners1831|Where-Object {$ids1831 -notcontains [int]$_.OwningProcess}).Count -gt 0){throw 'Owned listener mismatch'}
for($index1831=$records1831.Count-1;$index1831 -ge 0;$index1831--){
 $record1831=$records1831[$index1831]
 $current1831=Get-CimInstance Win32_Process -Filter "ProcessId=$($record1831.ProcessId)"
 if($current1831 -and $current1831.CreationDate -ne $record1831.CreationDate){throw 'PID reused'}
 if($current1831){Stop-Process -Id $record1831.ProcessId -Force}
}
if(@(Get-NetTCPConnection -LocalPort $origin1831.Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned port still listening'}
$value1831=@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1831.Port;stoppedPids=$ids1831;filteredProcessInventory=$true;cacheMoved=$false}
[IO.File]::WriteAllText((Join-Path (Get-Location).Path ('.tmp/1831-root-checks/'+$RecordName)),($value1831|ConvertTo-Json -Depth 5))
Write-Output 'Stopped only the path/creation/listener-verified owned Next tree.'
