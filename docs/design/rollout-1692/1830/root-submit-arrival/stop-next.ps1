param([Parameter(Mandatory=$true)][string]$RecordName)
$ErrorActionPreference='Stop'
$fixture1830 = Get-Content -LiteralPath .tmp/1830-root-fixture-pointer.txt -Raw -Encoding UTF8
$manifest1830 = Get-Content -LiteralPath (Join-Path $fixture1830 'dev-process-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$checkout1830 = [IO.Path]::GetFullPath((Get-Location).Path)
if ([IO.Path]::GetFullPath($manifest1830.repo) -ne $checkout1830) { throw 'Manifest belongs to another checkout' }
$origin1830 = [uri]$manifest1830.origin
$runtime1830 = Get-Content -LiteralPath (Join-Path $fixture1830 'runtime-private.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($origin1830.Host -ne 'localhost' -or $origin1830.Port -ne $runtime1830.port -or $manifest1830.origin -ne $runtime1830.origin) { throw 'Unexpected owned origin' }
$processes1830 = @(Get-CimInstance Win32_Process)
$root1830 = $processes1830 | Where-Object { $_.ProcessId -eq $manifest1830.pid }
if (-not $root1830 -or -not $root1830.CommandLine.Contains($checkout1830) -or $root1830.CommandLine -notmatch 'next[\\/]dist[\\/]bin[\\/]next.*dev') { throw 'Owned Next process identity mismatch' }
$owned1830 = @([int]$manifest1830.pid)
do {
 $children1830 = @($processes1830 | Where-Object { $owned1830 -contains [int]$_.ParentProcessId -and $owned1830 -notcontains [int]$_.ProcessId })
 $owned1830 += @($children1830 | ForEach-Object { [int]$_.ProcessId })
} while ($children1830.Count -gt 0)
$listeners1830 = @(Get-NetTCPConnection -State Listen -LocalPort $origin1830.Port -ErrorAction SilentlyContinue)
if ($listeners1830.Count -eq 0 -or @($listeners1830 | Where-Object { $owned1830 -notcontains [int]$_.OwningProcess }).Count -gt 0) { throw 'Listener ownership mismatch' }
foreach ($id1830 in @($owned1830 | Sort-Object -Descending)) {
 $record1830 = $processes1830 | Where-Object { $_.ProcessId -eq $id1830 }
 $current1830 = Get-CimInstance Win32_Process -Filter "ProcessId=$id1830"
 if ($current1830 -and $current1830.CreationDate -ne $record1830.CreationDate) { throw 'PID was reused' }
 if ($current1830) { Stop-Process -Id $id1830 -Force -ErrorAction Stop }
}
if (@(Get-NetTCPConnection -State Listen -LocalPort $origin1830.Port -ErrorAction SilentlyContinue).Count -ne 0) { throw 'Owned port still listening' }
@{ownedNextIdentityVerified=$true;ownedNextStopped=$true;portClosed=$true;port=$origin1830.Port;stoppedPids=$owned1830;cacheMoved=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path '.tmp/1830-root-checks' $RecordName) -Encoding UTF8
Write-Output 'Stopped only the manifest/path/listener-verified owned Next tree.'
