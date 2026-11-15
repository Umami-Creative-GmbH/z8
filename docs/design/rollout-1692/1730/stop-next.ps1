param([string]$FixtureDirectory = '.tmp/1730-fixture', [string]$EvidenceName = 'stop-next.json')
$ErrorActionPreference = 'Stop'
$taskRoot = (Get-Location).Path
$manifest = Get-Content -LiteralPath (Join-Path $FixtureDirectory 'dev-process-private.json') -Raw | ConvertFrom-Json
if ([IO.Path]::GetFullPath($manifest.repo) -ne $taskRoot) { throw 'Wrong checkout manifest' }
$recorded = Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest.pid)"
if (!$recorded -or !$recorded.CommandLine.Contains($taskRoot) -or !$recorded.CommandLine.Contains('next')) { throw 'Owned Next path/PID mismatch' }
$all = @(Get-CimInstance Win32_Process)
$owned = @($recorded)
do {
 $add = @($all | Where-Object { $_.ParentProcessId -in $owned.ProcessId -and $_.ProcessId -notin $owned.ProcessId })
 $owned += $add
} while ($add.Count -gt 0)
$port = ([uri]$manifest.origin).Port
$listener = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if (!$listener.Count -or @($listener | Where-Object OwningProcess -notin $owned.ProcessId).Count) { throw 'Listener does not belong to recorded Next tree' }
$proof = [ordered]@{repo=$taskRoot; port=$port; processes=@($owned | Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine); listener=@($listener | Select-Object LocalPort,OwningProcess)}
foreach ($entry in @($owned | Sort-Object CreationDate -Descending)) { Stop-Process -Id $entry.ProcessId -Force -ErrorAction SilentlyContinue }
$proof.portClosed = !(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if (!$proof.portClosed) { throw 'Owned listener still open' }
$proof | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path 'docs/design/rollout-1692/1730' $EvidenceName)
Write-Output 'Stopped only the manifest/path/PID/creation/listener-verified Next tree; owned port closed.'
