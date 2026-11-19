param([Parameter(Mandatory=$true)][string]$RecordName)
$ErrorActionPreference='Stop'
$fixture1832=[IO.File]::ReadAllText((Join-Path (Get-Location).Path '.tmp/1832-root-fixture-pointer.txt')).Trim()
$manifest1832=Get-Content -LiteralPath (Join-Path $fixture1832 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$runtime1832=Get-Content -LiteralPath (Join-Path $fixture1832 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1832=[IO.Path]::GetFullPath((Get-Location).Path)
if([IO.Path]::GetFullPath($manifest1832.repo) -ne $checkout1832 -or $manifest1832.origin -ne $runtime1832.origin){throw 'Owned manifest origin/path mismatch'}
$origin1832=[uri]$runtime1832.origin
if($origin1832.Host -ne 'localhost' -or $origin1832.Port -ne $runtime1832.port){throw 'Unexpected runtime origin'}
$root1832=Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest1832.pid)"
if(-not $root1832 -or -not $root1832.CommandLine.Contains($checkout1832) -or $root1832.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev'){throw 'Owned Next process identity mismatch'}
$records1832=New-Object System.Collections.Generic.List[object]
$records1832.Add($root1832)
for($index1832=0;$index1832 -lt $records1832.Count;$index1832++){
 $parent1832=$records1832[$index1832]
 foreach($child1832 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($parent1832.ProcessId)")){
  if($child1832.CreationDate -lt $root1832.CreationDate){throw 'Unexpected earlier descendant creation time'}
  if(@($records1832 | Where-Object ProcessId -eq $child1832.ProcessId).Count -eq 0){$records1832.Add($child1832)}
 }
}
$ids1832=@($records1832 | ForEach-Object {[int]$_.ProcessId})
$listeners1832=@(Get-NetTCPConnection -LocalPort $origin1832.Port -State Listen -ErrorAction SilentlyContinue)
if($listeners1832.Count -eq 0 -or @($listeners1832|Where-Object {$ids1832 -notcontains [int]$_.OwningProcess}).Count -gt 0){throw 'Owned listener mismatch'}
for($index1832=$records1832.Count-1;$index1832 -ge 0;$index1832--){
 $record1832=$records1832[$index1832]
 $current1832=Get-CimInstance Win32_Process -Filter "ProcessId=$($record1832.ProcessId)"
 if($current1832 -and $current1832.CreationDate -ne $record1832.CreationDate){throw 'PID reused'}
 if($current1832){Stop-Process -Id $record1832.ProcessId -Force}
}
if(@(Get-NetTCPConnection -LocalPort $origin1832.Port -State Listen -ErrorAction SilentlyContinue).Count -ne 0){throw 'Owned port still listening'}
$value1832=@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1832.Port;stoppedPids=$ids1832;filteredProcessInventory=$true;cacheMoved=$false}
[IO.File]::WriteAllText((Join-Path (Get-Location).Path ('.tmp/1832-root-checks/'+$RecordName)),($value1832|ConvertTo-Json -Depth 5))
Write-Output 'Stopped only the path/creation/listener-verified owned Next tree.'
