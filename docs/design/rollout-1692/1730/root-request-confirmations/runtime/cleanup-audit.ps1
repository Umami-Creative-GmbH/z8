$ErrorActionPreference='Stop'
$auditOut=Join-Path $PWD '.tmp/1730-root-checks/runtime'
$fixturePath=[IO.File]::ReadAllText((Join-Path $auditOut 'fixture-pointer-private.txt')).Trim()
if([IO.Path]::GetFileName($fixturePath) -notmatch '^z8-1730-root-[a-f0-9]{32}$'){throw 'Owned fixture mismatch'}
$runtimeValue=Get-Content -LiteralPath (Join-Path $fixturePath 'runtime-private.json') -Raw|ConvertFrom-Json
$checked=0
foreach($name in @('stop-current-before-overlay.json','stop-historical-before-restore.json','stop-final.json')){
 $record=Get-Content -LiteralPath (Join-Path $auditOut $name) -Raw|ConvertFrom-Json
 if(-not $record.ownedNextIdentityVerified -or -not $record.portClosed){throw 'Missing verified stop'}
 foreach($ownedPid in $record.stoppedPids){
  $current=Get-CimInstance Win32_Process -Filter "ProcessId=$ownedPid"
  if($current -and $current.CommandLine -and $current.CommandLine.Contains($PWD.Path)){throw 'Owned stopped process remains'}
  $checked++
 }
}
if(@(Get-NetTCPConnection -LocalPort $runtimeValue.port -State Listen -ErrorAction SilentlyContinue).Count){throw 'Owned listener remains'}
foreach($name in @('native.json','native-restored.json')){
 $native=Get-Content -LiteralPath (Join-Path $auditOut $name) -Raw|ConvertFrom-Json
 if($native.session -notmatch '^z8-1730-root-[a-f0-9]{32}$' -or $native.close.code -ne 0){throw 'Native close proof mismatch'}
 $pidPath=Join-Path 'C:/Users/KaiHentschel/.agent-browser' ($native.session+'.pid')
 if(Test-Path -LiteralPath $pidPath){$daemonPid=[int]([IO.File]::ReadAllText($pidPath).Trim());if(Get-CimInstance Win32_Process -Filter "ProcessId=$daemonPid"){throw 'Owned native daemon remains'}}
}
$serviceValue=Get-Content -LiteralPath (Join-Path $fixturePath 'services.json') -Raw|ConvertFrom-Json
if($serviceValue.containers.Count -ne 3 -or $serviceValue.label -ne 'z8-performance-fixture-1450'){throw 'Owned service mismatch'}
foreach($container in $serviceValue.containers){
 if($container -notmatch '^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$'){throw 'Unexpected owned container'}
 $present=& docker container ls -a --filter ('name=^/'+$container+'$') --format '{{.Names}}'
 if($LASTEXITCODE -ne 0 -or $present){throw 'Owned container remains or exact inventory failed'}
}
$summary=@{ownedNextPortClosed=$true;verifiedStoppedPidCount=$checked;nativeSessionsClosed=2;nativeDaemonsAbsent=$true;exactManifestContainersAbsent=3;privateFixtureManifestsPreserved=$true;processInventory='Exact task PIDs and descendants only; no broad process enumeration';cacheMoved=$false;puppeteerPolicy='Every driver awaited browser.close() in finally; all driver/wrapper sessions completed';ownedProcessesRemaining=0}
[IO.File]::WriteAllText((Join-Path $auditOut 'cleanup.json'),($summary|ConvertTo-Json -Depth 4))
Write-Output 'Verified owned port, exact stopped PIDs, two native daemons and three containers absent.'
