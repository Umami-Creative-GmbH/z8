param([Parameter(Mandatory=$true)][string]$RecordName)
$ErrorActionPreference='Stop'
$fixture1833=[IO.File]::ReadAllText((Join-Path (Get-Location).Path '.tmp/1833-root-fixture-pointer.txt')).Trim()
$manifest1833=Get-Content -LiteralPath (Join-Path $fixture1833 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime1833=Get-Content -LiteralPath (Join-Path $fixture1833 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1833=[IO.Path]::GetFullPath((Get-Location).Path)
if([IO.Path]::GetFullPath($manifest1833.repo) -ne $checkout1833 -or $manifest1833.origin -ne $runtime1833.origin){throw 'Owned manifest origin/path mismatch'}
$origin1833=[uri]$runtime1833.origin
if($origin1833.Host -ne 'localhost' -or $origin1833.Port -ne $runtime1833.port){throw 'Unexpected runtime origin'}
$root1833=Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest1833.pid)"
if(-not $root1833 -or -not $root1833.CommandLine.Contains($checkout1833) -or $root1833.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev'){throw 'Owned Next process identity mismatch'}
$records1833=New-Object System.Collections.Generic.List[object]
$records1833.Add($root1833)
for($index1833=0;$index1833 -lt $records1833.Count;$index1833++){
 $parent1833=$records1833[$index1833]
 foreach($child1833 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent1833.ProcessId)")){
  if($child1833.CreationDate -lt $root1833.CreationDate){throw 'Unexpected earlier descendant creation time'}
  if(@($records1833 | Where-Object ProcessId -eq $child1833.ProcessId).Count -eq 0){$records1833.Add($child1833)}
 }
}
$ids1833=@($records1833 | ForEach-Object {[int]$_.ProcessId})
$listeners1833=@(Get-NetTCPConnection -LocalPort $origin1833.Port -State Listen -ErrorAction SilentlyContinue)
if($listeners1833.Count -eq 0 -or @($listeners1833|Where-Object {$ids1833 -notcontains [int]$_.OwningProcess}).Count -gt 0){throw 'Owned listener mismatch'}
for($index1833=$records1833.Count-1;$index1833 -ge 0;$index1833--){
 $record1833=$records1833[$index1833]
 $current1833=Get-CimInstance Win32_Process -Filter "ProcessId=$($record1833.ProcessId)"
 if($current1833 -and $current1833.CreationDate -ne $record1833.CreationDate){throw 'PID reused'}
 if($current1833){Stop-Process -Id $record1833.ProcessId -Force}
}
if(@(Get-NetTCPConnection -LocalPort $origin1833.Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned port still listening'}
$value1833=@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1833.Port;stoppedPids=$ids1833;filteredProcessInventory=$true;cacheMoved=$false}
[IO.File]::WriteAllText((Join-Path (Get-Location).Path ('.tmp/1833-root-checks/'+$RecordName)),($value1833|ConvertTo-Json -Depth 5))
Write-Output 'Stopped only the path/creation/listener-verified owned Next tree.'
