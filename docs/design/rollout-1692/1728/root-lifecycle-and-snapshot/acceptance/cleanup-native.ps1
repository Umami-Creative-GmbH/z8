$ErrorActionPreference='Stop'
$proof1728=Get-Content -LiteralPath .tmp/1728-root-checks/acceptance/native-02.json -Raw | ConvertFrom-Json
if($proof1728.session -notmatch '^z8-1728-correction-[a-f0-9]{32}$'){throw 'Unexpected own session'}
$sidecar1728=Join-Path 'C:/Users/KaiHentschel/.agent-browser' ($proof1728.session+'.pid')
$daemonId1728=[int]([IO.File]::ReadAllText($sidecar1728).Trim())
$daemon1728=Get-CimInstance Win32_Process -Filter "ProcessId=$daemonId1728"
if(-not $daemon1728 -or $daemon1728.CommandLine -notmatch 'agent-browser-win32-x64.exe' -or $daemon1728.CreationDate -lt (Get-Date '2026-11-16T07:40:00+01:00')){throw 'Own daemon identity mismatch'}
$records1728=New-Object System.Collections.Generic.List[object]
$records1728.Add($daemon1728)
for($n1728=0;$n1728 -lt $records1728.Count;$n1728++){foreach($child1728 in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($records1728[$n1728].ProcessId)")){if($child1728.CreationDate -lt $daemon1728.CreationDate){throw 'Unexpected prior child'};$records1728.Add($child1728)}}
$ids1728=@($records1728 | ForEach-Object {[int]$_.ProcessId})
for($n1728=$records1728.Count-1;$n1728 -ge 0;$n1728--){$old1728=$records1728[$n1728];$live1728=Get-CimInstance Win32_Process -Filter "ProcessId=$($old1728.ProcessId)";if($live1728 -and $live1728.CreationDate -ne $old1728.CreationDate){throw 'PID reused'};if($live1728){Stop-Process -Id $old1728.ProcessId -Force}}
$left1728=@($ids1728 | ForEach-Object {Get-CimInstance Win32_Process -Filter "ProcessId=$_"})
if($left1728.Count){throw 'Own native descendants remain'}
@{session=$proof1728.session;sidecarMatchedDaemon=$true;daemonPid=$daemonId1728;stoppedPids=$ids1728;remaining=0;qualification='Close command timed out following actual tree command timeout. Stopped exact session PID sidecar matched daemon and creation-verified descendants only.'} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath .tmp/1728-root-checks/acceptance/native-cleanup.json
Write-Output 'Stopped only exact own native daemon tree.'
