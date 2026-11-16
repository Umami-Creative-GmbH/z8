param(
 [Parameter(Mandatory=$true)][string]$FixturePointer,
 [Parameter(Mandatory=$true)][string]$RecordPath
)
$ErrorActionPreference='Stop'
$fixture1834=[IO.File]::ReadAllText([IO.Path]::GetFullPath($FixturePointer)).Trim()
$manifest1834=Get-Content -LiteralPath (Join-Path $fixture1834 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime1834=Get-Content -LiteralPath (Join-Path $fixture1834 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1834=[IO.Path]::GetFullPath((Get-Location).Path)
if([IO.Path]::GetFullPath($manifest1834.repo) -ne $checkout1834 -or $manifest1834.origin -ne $runtime1834.origin){throw 'Owned manifest origin/path mismatch'}
$origin1834=[uri]$runtime1834.origin
if($origin1834.Host -ne 'localhost' -or $origin1834.Port -ne $runtime1834.port){throw 'Unexpected runtime origin'}
$root1834=Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest1834.pid)"
if(-not $root1834 -or -not $root1834.CommandLine.Contains($checkout1834) -or $root1834.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev'){throw 'Owned Next process identity mismatch'}
$records1834=New-Object System.Collections.Generic.List[object]
$records1834.Add($root1834)
for($index1834=0;$index1834 -lt $records1834.Count;$index1834++){
 $parent1834=$records1834[$index1834]
 foreach($child1834 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent1834.ProcessId)")){
  if($child1834.CreationDate -lt $root1834.CreationDate){throw 'Unexpected earlier descendant creation time'}
  if(@($records1834 | Where-Object ProcessId -eq $child1834.ProcessId).Count -eq 0){$records1834.Add($child1834)}
 }
}
$ids1834=@($records1834 | ForEach-Object {[int]$_.ProcessId})
$listeners1834=@(Get-NetTCPConnection -LocalPort $origin1834.Port -State Listen -ErrorAction SilentlyContinue)
if($listeners1834.Count -eq 0 -or @($listeners1834|Where-Object {$ids1834 -notcontains [int]$_.OwningProcess}).Count -gt 0){throw 'Owned listener mismatch'}
for($index1834=$records1834.Count-1;$index1834 -ge 0;$index1834--){
 $record1834=$records1834[$index1834]
 $current1834=Get-CimInstance Win32_Process -Filter "ProcessId=$($record1834.ProcessId)"
 if($current1834 -and $current1834.CreationDate -ne $record1834.CreationDate){throw 'PID reused'}
 if($current1834){Stop-Process -Id $record1834.ProcessId -Force}
}
if(@(Get-NetTCPConnection -LocalPort $origin1834.Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned port still listening'}
$value1834=@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1834.Port;stoppedPids=$ids1834;filteredProcessInventory=$true;cacheMoved=$false}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($RecordPath),($value1834|ConvertTo-Json -Depth 5))
Write-Output 'Stopped only the path/creation/listener-verified owned Next tree.'