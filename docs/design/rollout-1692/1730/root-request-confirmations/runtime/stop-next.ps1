param(
 [Parameter(Mandatory=$true)][string]$FixturePointer,
 [Parameter(Mandatory=$true)][string]$RecordPath
)
$ErrorActionPreference='Stop'
$fixture1730=[IO.File]::ReadAllText([IO.Path]::GetFullPath($FixturePointer)).Trim()
$manifest1730=Get-Content -LiteralPath (Join-Path $fixture1730 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime1730=Get-Content -LiteralPath (Join-Path $fixture1730 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1730=[IO.Path]::GetFullPath((Get-Location).Path)
if([IO.Path]::GetFullPath($manifest1730.repo) -ne $checkout1730 -or $manifest1730.origin -ne $runtime1730.origin){throw 'Owned manifest origin/path mismatch'}
$origin1730=[uri]$runtime1730.origin
if($origin1730.Host -ne 'localhost' -or $origin1730.Port -ne $runtime1730.port){throw 'Unexpected runtime origin'}
$root1730=Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest1730.pid)"
if(-not $root1730 -or -not $root1730.CommandLine.Contains($checkout1730) -or $root1730.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev'){throw 'Owned Next process identity mismatch'}
$records1730=New-Object System.Collections.Generic.List[object]
$records1730.Add($root1730)
for($index1730=0;$index1730 -lt $records1730.Count;$index1730++){
 $parent1730=$records1730[$index1730]
 foreach($child1730 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent1730.ProcessId)")){
  if($child1730.CreationDate -lt $root1730.CreationDate){throw 'Unexpected earlier descendant creation time'}
  if(@($records1730 | Where-Object ProcessId -eq $child1730.ProcessId).Count -eq 0){$records1730.Add($child1730)}
 }
}
$ids1730=@($records1730 | ForEach-Object {[int]$_.ProcessId})
$listeners1730=@(Get-NetTCPConnection -LocalPort $origin1730.Port -State Listen -ErrorAction SilentlyContinue)
if($listeners1730.Count -eq 0 -or @($listeners1730|Where-Object {$ids1730 -notcontains [int]$_.OwningProcess}).Count -gt 0){throw 'Owned listener mismatch'}
for($index1730=$records1730.Count-1;$index1730 -ge 0;$index1730--){
 $record1730=$records1730[$index1730]
 $current1730=Get-CimInstance Win32_Process -Filter "ProcessId=$($record1730.ProcessId)"
 if($current1730 -and $current1730.CreationDate -ne $record1730.CreationDate){throw 'PID reused'}
 if($current1730){try{Stop-Process -Id $record1730.ProcessId -Force -ErrorAction Stop}catch{if(Get-CimInstance Win32_Process -Filter "ProcessId=$($record1730.ProcessId)"){throw}}}
}
if(@(Get-NetTCPConnection -LocalPort $origin1730.Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned port still listening'}
$value1730=@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1730.Port;stoppedPids=$ids1730;filteredProcessInventory=$true;cacheMoved=$false}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($RecordPath),($value1730|ConvertTo-Json -Depth 5))
Write-Output 'Stopped only the path/creation/listener-verified owned Next tree.'