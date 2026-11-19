$ErrorActionPreference='Stop'
$workspace=(Get-Location).Path
$out=Join-Path $workspace '.tmp/1731-root-checks/runtime'
$fixtureDirectory=[IO.File]::ReadAllText((Join-Path $out 'fixture-pointer-private.txt')).Trim()
$processData=Get-Content -Raw -LiteralPath (Join-Path $fixtureDirectory 'dev-process-private.json') | ConvertFrom-Json
$initial=Get-CimInstance Win32_Process -Filter "ProcessId = $($processData.pid)"
if(-not $initial){throw 'Owned Next root missing'}
$queue=[Collections.Generic.Queue[object]]::new();$queue.Enqueue($initial);$owned=@()
while($queue.Count){$parent=$queue.Dequeue();$owned+=@($parent);$children=Get-CimInstance Win32_Process -Filter "ParentProcessId = $($parent.ProcessId)";foreach($child in $children){if($child.CreationDate -ge $parent.CreationDate){$queue.Enqueue($child)}}}
$rows=@($owned | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,@{Name='CommandLine';Expression={$_.CommandLine.Replace($fixtureDirectory,'<owned-private-fixture>')}})
$json=$rows | ConvertTo-Json -Depth 6
$json | Set-Content -LiteralPath (Join-Path $out 'next-process-latest.json')
$json | Set-Content -LiteralPath (Join-Path $out ('next-process-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfff')+'.json'))
Write-Output ('Owned Next process tree recorded: '+$rows.Count)
