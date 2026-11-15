$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$commands1829=@()
$owned1829=@('src/app/[locale]/onboarding/organization/organization-page-client.tsx','src/app/[locale]/onboarding/organization/page.tsx','src/app/[locale]/onboarding/organization/page.test.tsx')
$profiles1829=@(
 @{name='ordinary-crlf';options=@('--line-ending=crlf');required=$true},
 @{name='ordinary-lint';options=@('--formatter-enabled=false');required=$true},
 @{name='explicit-lint';options=@('--config-path=biome.jsonc','--formatter-enabled=false');required=$true},
 @{name='default';options=@();required=$false},
 @{name='explicit-crlf';options=@('--config-path=biome.jsonc','--line-ending=crlf');required=$false}
)
foreach($profile1829 in $profiles1829){
 $args1829=@('--config.verify-deps-before-run=false','--filter','webapp','exec','biome','check','--error-on-warnings')+$profile1829.options+$owned1829
 & pnpm @args1829 *> (Join-Path '.tmp/1829-root-checks' ('biome-'+$profile1829.name+'.log'))
 $commands1829+=@{name=$profile1829.name;command=@('pnpm')+$args1829;exitCode=$LASTEXITCODE}
 if($profile1829.required -and $LASTEXITCODE -ne 0){throw ('Required quality failed: '+$profile1829.name)}
}
$args1829=@('--config.verify-deps-before-run=false','exec','react-doctor','apps/webapp','--scope','changed','--base','8a13b755220124c4ea1d3fd1ccacb770aae31241','--verbose','--no-supply-chain','--no-telemetry','--no-score','--max-duration','90','--json','--json-out',(Join-Path (Get-Location).Path '.tmp/1829-root-checks/doctor.json'))
& pnpm @args1829 *> .tmp/1829-root-checks/doctor.log
$commands1829+=@{name='doctor';command=@('pnpm')+$args1829;exitCode=$LASTEXITCODE}
if($LASTEXITCODE -ne 0){throw 'Doctor failed'}
$commands1829 | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath .tmp/1829-root-checks/quality-commands.json -Encoding UTF8
Write-Output 'Required three-file quality profiles and Doctor passed; formatter differences retained.'
