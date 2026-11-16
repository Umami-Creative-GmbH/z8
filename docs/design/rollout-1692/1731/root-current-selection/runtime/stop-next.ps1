$ErrorActionPreference='Stop'
$workspace=(Get-Location).Path
$out=Join-Path $workspace '.tmp/1731-root-checks/runtime'
$fixtureDirectory=[IO.File]::ReadAllText((Join-Path $out 'fixture-pointer-private.txt')).Trim()
$runtimeData=Get-Content -Raw -LiteralPath (Join-Path $fixtureDirectory 'runtime-private.json') | ConvertFrom-Json
$processData=Get-Content -Raw -LiteralPath (Join-Path $fixtureDirectory 'dev-process-private.json') | ConvertFrom-Json
$initial=Get-CimInstance Win32_Process -Filter "ProcessId = $($processData.pid)"
$saved=@(Get-Content -Raw -LiteralPath (Join-Path $out 'next-process-latest.json') | ConvertFrom-Json) | Where-Object {$_.ProcessId -eq $processData.pid} | Select-Object -First 1
$owned=@()
if($initial){
 if(-not $saved -or $initial.ParentProcessId -ne $saved.ParentProcessId -or $initial.CreationDate -ne ([datetime]$saved.CreationDate) -or $initial.ExecutablePath -ne $saved.ExecutablePath){throw 'Exact saved PID creation/parent/executable ownership mismatch'}
 if(-not $initial.CommandLine.Contains((Join-Path $workspace 'apps/webapp/node_modules/next/dist/bin/next').Replace('\','/')) -and -not $initial.CommandLine.Replace('\','/').Contains(($workspace.Replace('\','/')+'/apps/webapp/node_modules/next/dist/bin/next'))){throw 'Exact owned Next source path mismatch'}
 $queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue($initial)
 while($queue.Count){$parent=$queue.Dequeue();$owned+=@($parent);$children=Get-CimInstance Win32_Process -Filter "ParentProcessId = $($parent.ProcessId)";foreach($child in $children){if($child.CreationDate -ge $parent.CreationDate){$queue.Enqueue($child)}}}
 foreach($entry in ($owned | Sort-Object CreationDate -Descending)){
  $current=Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.ProcessId)"
  if($current -and $current.CreationDate -eq $entry.CreationDate -and $current.ParentProcessId -eq $entry.ParentProcessId -and $current.ExecutablePath -eq $entry.ExecutablePath){Stop-Process -Id $entry.ProcessId -Force}
 }
}
$remaining=@();foreach($entry in $owned){$current=Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.ProcessId)";if($current -and $current.CreationDate -eq $entry.CreationDate){$remaining+=@($entry.ProcessId)}}
$listeners=@(Get-NetTCPConnection -LocalPort $runtimeData.port -State Listen -ErrorAction SilentlyContinue)
if($remaining.Count -or $listeners.Count){throw 'Owned Next process/listener remains'}
$record=@{time=(Get-Date).ToUniversalTime().ToString('o');kind='Exact owned source path, PID, creation, parent and executable identity; own descendants only';stopped=@($owned | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath);processesRemaining=$remaining.Count;port=$runtimeData.port;listenersRemaining=$listeners.Count}
$name='next-stop-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfff')+'.json'
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $out $name)
Write-Output ('Owned Next stopped; processes remaining '+$remaining.Count+', listeners '+$listeners.Count)
