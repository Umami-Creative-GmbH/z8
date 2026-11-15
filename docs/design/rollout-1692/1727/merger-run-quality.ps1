$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$auditRuns=@()
$files=@(git diff --name-only 11671b30d78f9bc12be6f991ed4638218cc75777 HEAD -- apps/webapp | ForEach-Object { $_ -replace '^apps/webapp/','' })
$profiles=@(
 @{name='biome-default';args=@('--filter','webapp','exec','biome','check')},
 @{name='biome-crlf';args=@('--filter','webapp','exec','biome','check','--line-ending=crlf')},
 @{name='biome-explicit';args=@('--filter','webapp','exec','biome','check','--config-path','biome.jsonc')},
 @{name='biome-lint-import';args=@('--filter','webapp','exec','biome','check','--formatter-enabled=false')},
 @{name='biome-explicit-lint';args=@('--filter','webapp','exec','biome','check','--config-path','biome.jsonc','--formatter-enabled=false','--assist-enabled=false')}
)
foreach($profile in $profiles){
 $callArgs=@($profile.args)+$files;$started=[DateTimeOffset]::UtcNow.ToString('o')
 & pnpm @callArgs *> ('.tmp/merge1727-audit/'+$profile.name+'.log')
 $auditRuns += [pscustomobject]@{name=$profile.name;command=@('pnpm')+$callArgs;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$LASTEXITCODE;files=$files;log=('.tmp/merge1727-audit/'+$profile.name+'.log')}
 $auditRuns | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath .tmp/merge1727-audit/quality-commands.json -Encoding UTF8
 Write-Output ($profile.name+' exit='+$LASTEXITCODE)
}
$doctorArgs=@('exec','react-doctor','--project','webapp','--scope','changed','--base','11671b30d78f9bc12be6f991ed4638218cc75777','--verbose','--no-score','--no-supply-chain','--no-telemetry','--json','--json-out','.tmp/merge1727-audit/doctor.json')
$started=[DateTimeOffset]::UtcNow.ToString('o')
& pnpm @doctorArgs *> .tmp/merge1727-audit/doctor.log
$auditRuns += [pscustomobject]@{name='doctor';command=@('pnpm')+$doctorArgs;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$LASTEXITCODE;log='.tmp/merge1727-audit/doctor.log'}
$auditRuns | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath .tmp/merge1727-audit/quality-commands.json -Encoding UTF8
Write-Output ('doctor exit='+$LASTEXITCODE)
