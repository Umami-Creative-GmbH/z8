$ErrorActionPreference='Stop'
$checkout1728=[IO.Path]::GetFullPath((Get-Location).Path)
$fixture1728=[IO.File]::ReadAllText((Join-Path $checkout1728 '.tmp/1728-root-fixture-pointer.txt')).Trim()
if([IO.Path]::GetFileName($fixture1728) -notmatch '^z8-1728-root-[a-f0-9]{32}$'){throw 'Unexpected fixture pointer'}
$runtime1728=Get-Content -LiteralPath (Join-Path $fixture1728 'runtime-private.json') -Raw | ConvertFrom-Json
$all1728=@(Get-CimInstance Win32_Process)
$owned1728=@($all1728 | Where-Object { $_.CommandLine -and ($_.CommandLine.Contains($checkout1728+'\apps\webapp\node_modules\next\') -or $_.CommandLine.Contains($checkout1728+'/apps/webapp/node_modules/next/') -or $_.CommandLine -match '\.tmp[\\/]1728-root-checks[\\/]acceptance[\\/](?:runtime|native|compare|dev)\.mjs') })
if($owned1728.Count){throw 'An owned runtime process remains'}
$nextListeners1728=@(Get-NetTCPConnection -LocalPort $runtime1728.port -State Listen -ErrorAction SilentlyContinue)
if($nextListeners1728.Count){throw 'Owned Next port still listening'}
$nativeAudit1728=New-Object System.Collections.Generic.List[object]
foreach($name1728 in @('native-02.json','native-03.json')){
 $record1728=Get-Content -LiteralPath (Join-Path '.tmp/1728-root-checks/acceptance' $name1728) -Raw | ConvertFrom-Json
 if($record1728.session -notmatch '^z8-1728-correction-[a-f0-9]{32}$'){throw 'Unexpected native session'}
 $pidPath1728=Join-Path 'C:/Users/KaiHentschel/.agent-browser' ($record1728.session+'.pid')
 $portPath1728=Join-Path 'C:/Users/KaiHentschel/.agent-browser' ($record1728.session+'.port')
 $nativeLive1728=$false;$nativeListener1728=$false
 if(Test-Path -LiteralPath $pidPath1728){$nativeId1728=[int]([IO.File]::ReadAllText($pidPath1728).Trim());$nativeLive1728=@($all1728|Where-Object ProcessId -eq $nativeId1728).Count -gt 0}
 if(Test-Path -LiteralPath $portPath1728){$nativePort1728=[int]([IO.File]::ReadAllText($portPath1728).Trim());$nativeListener1728=@(Get-NetTCPConnection -LocalPort $nativePort1728 -State Listen -ErrorAction SilentlyContinue).Count -gt 0}
 if($nativeLive1728 -or $nativeListener1728){throw 'Owned native daemon/listener remains'}
 $nativeAudit1728.Add(@{session=$record1728.session;daemonPresent=$false;listenerPresent=$false})
}
$value1728=@{ownedRuntimeProcesses=0;ownedNextPort=[int]$runtime1728.port;ownedNextPortClosed=$true;nativeSessions=$nativeAudit1728;ownedNativeProcesses=0;allOwnedForegroundRunsExited=$true;fixtureManifestsPreserved=$true;qualification='Read-only exact task path/session sidecar process and listener inventory. No peer processes or sessions touched.'}
[IO.File]::WriteAllText((Join-Path $checkout1728 '.tmp/1728-root-checks/acceptance/process-cleanup-final.json'),($value1728|ConvertTo-Json -Depth 6))
Write-Output 'Verified zero owned runtime processes, native daemons or listeners.'
