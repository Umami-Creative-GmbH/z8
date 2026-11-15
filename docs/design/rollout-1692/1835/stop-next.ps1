$ErrorActionPreference='Stop'
$repo=(Resolve-Path .).Path
$fixture=Join-Path $repo '.tmp/1835/fixture'
$manifest=Get-Content (Join-Path $fixture 'dev-process-private.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($manifest.repo) -ne $repo) { throw 'Owned Next manifest checkout mismatch' }
$origin=[uri]$manifest.origin
if ($origin.Host -ne 'localhost' -or $origin.Port -ne 57703) { throw 'Owned origin mismatch' }
$next=Get-CimInstance Win32_Process -Filter ('ProcessId='+$manifest.pid)
if (!$next -or !$next.CommandLine.Contains((Join-Path $repo 'apps/webapp/node_modules/next/dist/bin/next')) -or !$next.CommandLine.Contains('--port 57703')) { throw 'Owned Next PID/path/port mismatch' }
$all=@(Get-CimInstance Win32_Process)
$owned=@([uint32]$next.ProcessId)
do {
    $added=@($all | Where-Object { $owned -contains [uint32]$_.ParentProcessId -and $owned -notcontains [uint32]$_.ProcessId } | ForEach-Object { [uint32]$_.ProcessId })
    $owned += $added
} while ($added.Count -gt 0)
$listeners=@(Get-NetTCPConnection -LocalPort 57703 -State Listen -ErrorAction SilentlyContinue)
if (!$listeners.Count -or @($listeners | Where-Object { $owned -notcontains [uint32]$_.OwningProcess }).Count) { throw 'Listener is outside the owned manifest process tree' }
$record=[ordered]@{repo=$repo;port=57703;manifestPid=$manifest.pid;listenerPids=@($listeners.OwningProcess);verifiedTree=$owned;pathAndManifestVerified=$true;stopped=$false;portClosed=$false}
# Only the positively identified manifest Next process and its descendants.
foreach ($processId in @($owned | Sort-Object -Descending)) {
    $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+$processId)
    $before=$all | Where-Object ProcessId -eq $processId | Select-Object -First 1
    if ($live -and $before -and $live.CreationDate -eq $before.CreationDate) { Stop-Process -Id $processId -Force }
}
$record.stopped=$true
$record.portClosed=(@(Get-NetTCPConnection -LocalPort 57703 -State Listen -ErrorAction SilentlyContinue).Count -eq 0)
if (!$record.portClosed) { throw 'Owned port remains open' }
$record | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 docs/design/rollout-1692/1835/cleanup-next.json
