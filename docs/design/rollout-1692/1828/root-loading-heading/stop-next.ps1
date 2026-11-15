param([Parameter(Mandatory=$true)][string]$RecordName)
$ErrorActionPreference='Stop'
$fixture1828 = Get-Content -LiteralPath .tmp/1828-root-fixture-pointer.txt -Raw -Encoding UTF8
$manifest1828 = Get-Content -LiteralPath (Join-Path $fixture1828 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1828 = [IO.Path]::GetFullPath((Get-Location).Path)
if ([IO.Path]::GetFullPath($manifest1828.repo) -ne $checkout1828) { throw 'Manifest belongs to another checkout' }
$origin1828 = [uri]$manifest1828.origin
if ($origin1828.Host -ne 'localhost' -or $origin1828.Port -ne 59169) { throw 'Unexpected owned origin' }
$processes1828 = @(Get-CimInstance Win32_Process)
$root1828 = $processes1828 | Where-Object { $_.ProcessId -eq $manifest1828.pid }
if (-not $root1828 -or -not $root1828.CommandLine.Contains($checkout1828) -or $root1828.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev') { throw 'Owned Next process identity mismatch' }
$owned1828 = @([int]$manifest1828.pid)
do {
 $children1828 = @($processes1828 | Where-Object { $owned1828 -contains [int]$_.ParentProcessId -and $owned1828 -notcontains [int]$_.ProcessId })
 $owned1828 += @($children1828 | ForEach-Object { [int]$_.ProcessId })
} while ($children1828.Count -gt 0)
$listeners1828 = @(Get-NetTCPConnection -State Listen -LocalPort $origin1828.Port -ErrorAction SilentlyContinue)
if ($listeners1828.Count -eq 0 -or @($listeners1828 | Where-Object { $owned1828 -notcontains [int]$_.OwningProcess }).Count -gt 0) { throw 'Listener ownership mismatch' }
foreach ($id1828 in @($owned1828 | Sort-Object -Descending)) {
 $record1828 = $processes1828 | Where-Object { $_.ProcessId -eq $id1828 }
 $current1828 = Get-CimInstance Win32_Process -Filter "ProcessId=$id1828"
 if ($current1828 -and $current1828.CreationDate -ne $record1828.CreationDate) { throw 'PID was reused' }
 if ($current1828) { Stop-Process -Id $id1828 -Force -ErrorAction Stop }
}
if (@(Get-NetTCPConnection -State Listen -LocalPort $origin1828.Port -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Owned port still listening' }
@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1828.Port;stoppedPids=$owned1828;cacheMoved=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path '.tmp/1828-root-checks' $RecordName) -Encoding UTF8
Write-Output 'Stopped only the manifest/path/listener-verified owned Next tree.'
