$ErrorActionPreference='Stop'
$out1729=Join-Path $PWD '.tmp/1729-root-checks/runtime'
$fixture1729=[IO.File]::ReadAllText((Join-Path $out1729 'fixture-pointer-private.txt')).Trim()
if([IO.Path]::GetFileName($fixture1729) -notmatch '^z8-1729-root-[a-f0-9]{32}$'){throw 'Owned fixture path mismatch'}
$runtime1729=Get-Content -LiteralPath (Join-Path $fixture1729 'runtime-private.json') -Raw | ConvertFrom-Json
$stops1729=@('next-stop-before-overlay.json','next-stop-after-overlay.json','next-stop-final.json')
$checked1729=New-Object System.Collections.Generic.List[int]
foreach($name1729 in $stops1729){$record1729=Get-Content -LiteralPath (Join-Path $out1729 $name1729) -Raw | ConvertFrom-Json; if(-not $record1729.ownedNextIdentityVerified -or -not $record1729.portClosed){throw 'Missing owned stop proof'}; foreach($processId1729 in $record1729.stoppedPids){$process1729=Get-CimInstance Win32_Process -Filter "ProcessId=$processId1729";if($process1729 -and $process1729.CommandLine -and $process1729.CommandLine.Contains($PWD.Path)){throw 'An exact owned stopped PID still runs from this checkout'};$checked1729.Add([int]$processId1729)}}
if(@(Get-NetTCPConnection -LocalPort $runtime1729.port -State Listen -ErrorAction SilentlyContinue).Count){throw 'Owned Next listener remains'}
$native1729=Get-Content -LiteralPath (Join-Path $out1729 'native.json') -Raw | ConvertFrom-Json
if($native1729.session -notmatch '^z8-1729-root-[a-f0-9]{32}$' -or $native1729.close.code -ne 0){throw 'Native close proof mismatch'}
$pidFile1729=Join-Path 'C:/Users/KaiHentschel/.agent-browser' ($native1729.session+'.pid')
if(Test-Path -LiteralPath $pidFile1729){$nativeProcessId1729=[int]([IO.File]::ReadAllText($pidFile1729).Trim());if(Get-CimInstance Win32_Process -Filter "ProcessId=$nativeProcessId1729"){throw 'Owned native daemon remains'}}
$services1729=Get-Content -LiteralPath (Join-Path $fixture1729 'services.json') -Raw | ConvertFrom-Json
if($services1729.containers.Count -ne 3 -or $services1729.label -ne 'z8-performance-fixture-1450'){throw 'Owned service manifest mismatch'}
foreach($container1729 in $services1729.containers){if($container1729 -notmatch '^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$'){throw 'Unexpected exact container name'};$present1729=& docker container ls -a --filter ('name=^/'+$container1729+'$') --format '{{.Names}}';if($LASTEXITCODE -ne 0 -or $present1729){throw 'Owned container remains or inventory failed'}}
$audit1729=@{ownedNextPortClosed=$true;verifiedStoppedPidCount=$checked1729.Count;nativeClosed=$true;nativeDaemonAbsent=$true;exactManifestContainersAbsent=3;privateFixtureManifestsPreserved=$true;processInventory='Exact task manifest PIDs only; no broad process enumeration';cacheMoved=$false}
[IO.File]::WriteAllText((Join-Path $out1729 'cleanup.json'),($audit1729|ConvertTo-Json -Depth 4))
Write-Output 'Verified owned Next port, exact PIDs, native daemon and exactly three containers are absent.'
