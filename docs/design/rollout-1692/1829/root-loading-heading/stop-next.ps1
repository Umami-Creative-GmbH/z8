param([Parameter(Mandatory=$true)][string]$RecordName)
$ErrorActionPreference='Stop'
$fixture1829 = Get-Content -LiteralPath .tmp/1829-root-fixture-pointer.txt -Raw -Encoding UTF8
$manifest1829 = Get-Content -LiteralPath (Join-Path $fixture1829 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1829 = [IO.Path]::GetFullPath((Get-Location).Path)
if ([IO.Path]::GetFullPath($manifest1829.repo) -ne $checkout1829) { throw 'Manifest belongs to another checkout' }
$origin1829 = [uri]$manifest1829.origin
$runtime1829 = Get-Content -LiteralPath (Join-Path $fixture1829 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($origin1829.Host -ne 'localhost' -or $origin1829.Port -ne $runtime1829.port -or $manifest1829.origin -ne $runtime1829.origin) { throw 'Unexpected owned origin' }
$processes1829 = @(Get-CimInstance Win32_Process)
$root1829 = $processes1829 | Where-Object { $_.ProcessId -eq $manifest1829.pid }
if (-not $root1829 -or -not $root1829.CommandLine.Contains($checkout1829) -or $root1829.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev') { throw 'Owned Next process identity mismatch' }
$owned1829 = @([int]$manifest1829.pid)
do {
 $children1829 = @($processes1829 | Where-Object { $owned1829 -contains [int]$_.ParentProcessId -and $owned1829 -notcontains [int]$_.ProcessId })
 $owned1829 += @($children1829 | ForEach-Object { [int]$_.ProcessId })
} while ($children1829.Count -gt 0)
$listeners1829 = @(Get-NetTCPConnection -State Listen -LocalPort $origin1829.Port -ErrorAction SilentlyContinue)
if ($listeners1829.Count -eq 0 -or @($listeners1829 | Where-Object { $owned1829 -notcontains [int]$_.OwningProcess }).Count -gt 0) { throw 'Listener ownership mismatch' }
foreach ($id1829 in @($owned1829 | Sort-Object -Descending)) {
 $record1829 = $processes1829 | Where-Object { $_.ProcessId -eq $id1829 }
 $current1829 = Get-CimInstance Win32_Process -Filter "ProcessId=$id1829"
 if ($current1829 -and $current1829.CreationDate -ne $record1829.CreationDate) { throw 'PID was reused' }
 if ($current1829) { Stop-Process -Id $id1829 -Force -ErrorAction Stop }
}
if (@(Get-NetTCPConnection -State Listen -LocalPort $origin1829.Port -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Owned port still listening' }
@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1829.Port;stoppedPids=$owned1829;cacheMoved=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path '.tmp/1829-root-checks' $RecordName) -Encoding UTF8
Write-Output 'Stopped only the manifest/path/listener-verified owned Next tree.'
