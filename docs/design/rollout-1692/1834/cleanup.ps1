$ErrorActionPreference = 'Stop'
$repo = 'X:/t3-code/worktrees/z8/t3-fdc2d97a-f605ff250f82822d'
Set-Location -LiteralPath $repo
$dir = Join-Path $repo '.tmp/1834/fixture-final'
$r = Get-Content (Join-Path $dir 'runtime-private.json') -Raw | ConvertFrom-Json
$f = Get-Content (Join-Path $dir 'fixture-private.json') -Raw | ConvertFrom-Json
$manifest = Get-Content (Join-Path $dir 'dev-process-private.json') -Raw | ConvertFrom-Json
$services = Get-Content (Join-Path $dir 'services.json') -Raw | ConvertFrom-Json
if($f.kind -ne 'disposable' -or $r.env.POSTGRES_DB -notmatch '^approval_workflow_repository_test_perf_[a-f0-9]{12}$' -or ([uri]$r.origin).Host -ne 'localhost' -or $manifest.origin -ne $r.origin -or [IO.Path]::GetFullPath($manifest.repo) -ne [IO.Path]::GetFullPath($repo)) { throw 'Own runtime identity mismatch' }
if($services.containers.Count -ne 3) { throw 'Expected exactly three owned services' }
foreach($container in $services.containers) {
 if($container -notmatch '^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$') { throw 'Unexpected service name' }
 $label = (& docker inspect --format '{{ index .Config.Labels "z8.agent-owned" }}' $container).Trim()
 if($LASTEXITCODE -ne 0 -or $label -ne 'z8-performance-fixture-1450') { throw 'Own label mismatch' }
}
$all = @(Get-CimInstance Win32_Process)
$tree = @($all | Where-Object { $_.ProcessId -eq $manifest.pid })
if($tree.Count -ne 1 -or $tree[0].CommandLine -notlike '*t3-fdc2d97a-f605ff250f82822d*next*dev*turbopack*') { throw 'Manifest process path mismatch' }
do {
 $add = @($all | Where-Object { $_.ParentProcessId -in $tree.ProcessId -and $_.ProcessId -notin $tree.ProcessId })
 $tree += $add
} while($add.Count -gt 0)
$listeners = @(Get-NetTCPConnection -LocalPort $r.port -State Listen -ErrorAction SilentlyContinue)
if($listeners.Count -eq 0 -or @($listeners | Where-Object { $_.OwningProcess -notin $tree.ProcessId }).Count -gt 0) { throw 'Port is not owned by the manifest tree' }
$proof = [ordered]@{origin=$r.origin;repo=$repo;port=$r.port;processes=@($tree | Select-Object ProcessId,ParentProcessId,CommandLine);listeners=@($listeners | Select-Object OwningProcess,LocalPort);containers=@($services.containers);labelsVerified=$true;nativeBrowserClosed=$true}
$proof | ConvertTo-Json -Depth 8 | Set-Content docs/design/rollout-1692/1834/cleanup-start.json -Encoding UTF8
foreach($process in @($tree | Sort-Object ProcessId -Descending)) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
foreach($container in $services.containers) { & docker rm --force $container | Out-Null; if($LASTEXITCODE -ne 0){throw 'Owned container removal failed'} }
Start-Sleep -Milliseconds 500
$proof.portClosed = @(Get-NetTCPConnection -LocalPort $r.port -State Listen -ErrorAction SilentlyContinue).Count -eq 0
$proof.servicesAbsent = @($services.containers | Where-Object { @(& docker ps -aq --filter "name=^/$_`$").Count -gt 0 }).Count -eq 0
if(-not $proof.portClosed -or -not $proof.servicesAbsent) { throw 'Cleanup incomplete' }
$proof | ConvertTo-Json -Depth 8 | Set-Content docs/design/rollout-1692/1834/cleanup.json -Encoding UTF8
Write-Output 'Own manifest/path/port verified Next tree and three labeled services removed; port closed.'
