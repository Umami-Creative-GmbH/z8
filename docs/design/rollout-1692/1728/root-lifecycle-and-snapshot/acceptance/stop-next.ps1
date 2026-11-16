param(
 [Parameter(Mandatory=$true)][string]$FixturePointer,
 [Parameter(Mandatory=$true)][string]$RecordPath
)
$ErrorActionPreference='Stop'
$fixture1728=[IO.File]::ReadAllText([IO.Path]::GetFullPath($FixturePointer)).Trim()
$manifest1728=Get-Content -LiteralPath (Join-Path $fixture1728 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime1728=Get-Content -LiteralPath (Join-Path $fixture1728 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1728=[IO.Path]::GetFullPath((Get-Location).Path)
if([IO.Path]::GetFullPath($manifest1728.repo) -ne $checkout1728 -or $manifest1728.origin -ne $runtime1728.origin){throw 'Owned manifest origin/path mismatch'}
$origin1728=[uri]$runtime1728.origin
if($origin1728.Host -ne 'localhost' -or $origin1728.Port -ne $runtime1728.port){throw 'Unexpected runtime origin'}
$root1728=Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest1728.pid)"
if(-not $root1728 -or -not $root1728.CommandLine.Contains($checkout1728) -or $root1728.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev'){throw 'Owned Next process identity mismatch'}
$records1728=New-Object System.Collections.Generic.List[object]
$records1728.Add($root1728)
for($index1728=0;$index1728 -lt $records1728.Count;$index1728++){
 $parent1728=$records1728[$index1728]
 foreach($child1728 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent1728.ProcessId)")){
  if($child1728.CreationDate -lt $root1728.CreationDate){throw 'Unexpected earlier descendant creation time'}
  if(@($records1728 | Where-Object ProcessId -eq $child1728.ProcessId).Count -eq 0){$records1728.Add($child1728)}
 }
}
$ids1728=@($records1728 | ForEach-Object {[int]$_.ProcessId})
$listeners1728=@(Get-NetTCPConnection -LocalPort $origin1728.Port -State Listen -ErrorAction SilentlyContinue)
if($listeners1728.Count -eq 0 -or @($listeners1728|Where-Object {$ids1728 -notcontains [int]$_.OwningProcess}).Count -gt 0){throw 'Owned listener mismatch'}
for($index1728=$records1728.Count-1;$index1728 -ge 0;$index1728--){
 $record1728=$records1728[$index1728]
 $current1728=Get-CimInstance Win32_Process -Filter "ProcessId=$($record1728.ProcessId)"
 if($current1728 -and $current1728.CreationDate -ne $record1728.CreationDate){throw 'PID reused'}
 if($current1728){try{Stop-Process -Id $record1728.ProcessId -Force -ErrorAction Stop}catch{if(Get-CimInstance Win32_Process -Filter "ProcessId=$($record1728.ProcessId)"){throw}}}
}
if(@(Get-NetTCPConnection -LocalPort $origin1728.Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned port still listening'}
$value1728=@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1728.Port;stoppedPids=$ids1728;filteredProcessInventory=$true;cacheMoved=$false}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($RecordPath),($value1728|ConvertTo-Json -Depth 5))
Write-Output 'Stopped only the path/creation/listener-verified owned Next tree.'