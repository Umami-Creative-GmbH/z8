param([string]$Phase='exact')
$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$auditRoot=Join-Path (Get-Location).Path '.tmp/merge1829-audit'
$appRoot=Join-Path (Get-Location).Path 'apps/webapp'
$utf8=New-Object System.Text.UTF8Encoding($false)
function Invoke-Recorded([string]$Name,[string[]]$Arguments) {
 $callArgs=@('--config.verify-deps-before-run=false')+$Arguments
 $command=[pscustomobject]@{name=$Name;cwd=(Get-Location).Path;env=@{pnpm_config_verify_deps_before_run='false'};argv=@('pnpm')+$callArgs;started=(Get-Date).ToUniversalTime().ToString('o')}
 & pnpm @callArgs *> (Join-Path $auditRoot ($Name+'.log'))
 $command | Add-Member exitCode $LASTEXITCODE
 [System.IO.File]::WriteAllText((Join-Path $auditRoot ($Name+'-command.json')),(($command|ConvertTo-Json -Depth 10)+"`n"),$utf8)
 Write-Output ($Name+' exit='+$LASTEXITCODE)
 return $LASTEXITCODE
}
if($Phase -eq 'exact') {
 $worker=Get-Content docs/design/rollout-1692/1829/final-unit.json -Raw|ConvertFrom-Json
 $selection=@($worker.testResults|ForEach-Object {$_.name -replace '^.*?[/\\]apps[/\\]webapp[/\\]',''})
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'exact-selection.txt'),(($selection -join "`n")+"`n"),$utf8)
 Invoke-Recorded 'exact-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2')+$selection+@('--reporter=json','--outputFile='+ (Join-Path $auditRoot 'exact-unit.json')))
}
if($Phase -eq 'compatibility') {
 $selection=@(Get-Content .tmp/merge1827-audit/compatibility-selection.txt)+@('src/app/[locale]/onboarding','src/components/onboarding','src/components/organization','src/lib/organization/creation-policy.test.ts','src/lib/effect/services/onboarding.service.test.ts','src/lib/employee-lifecycle/joining/employee-writers.test.ts')
 $selection=@($selection|Where-Object {$_ -and $_.Trim()}|Sort-Object -Unique)
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'compatibility-selection.txt'),(($selection -join "`n")+"`n"),$utf8)
 Invoke-Recorded 'compatibility-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2')+$selection+@('--reporter=json','--outputFile='+ (Join-Path $auditRoot 'compatibility-unit.json')))
}
if($Phase -eq 'types') {Invoke-Recorded 'types' @('--filter','webapp','typecheck')}
if($Phase -eq 'quality') {
 $owned=@('src/app/[locale]/onboarding/organization/organization-page-client.tsx','src/app/[locale]/onboarding/organization/page.tsx','src/app/[locale]/onboarding/organization/page.test.tsx')
 $profiles=@(@{name='biome-default';options=@()},@{name='biome-crlf';options=@('--line-ending=crlf')},@{name='biome-explicit';options=@('--config-path=biome.jsonc')},@{name='biome-explicit-crlf';options=@('--config-path=biome.jsonc','--line-ending=crlf')},@{name='biome-lint-import';options=@('--formatter-enabled=false')},@{name='biome-explicit-lint';options=@('--config-path=biome.jsonc','--formatter-enabled=false')})
 foreach($profile in $profiles) {Invoke-Recorded $profile.name (@('--filter','webapp','exec','biome','check','--error-on-warnings')+$profile.options+$owned)}
}
if($Phase -eq 'doctor') {Invoke-Recorded 'doctor' @('exec','react-doctor','apps/webapp','--scope','changed','--base','8a13b755220124c4ea1d3fd1ccacb770aae31241','--verbose','--no-supply-chain','--no-telemetry','--no-score','--json','--json-out',(Join-Path $auditRoot 'doctor.json'),'--max-duration','90')}
if($Phase -eq 'adversarial') {Invoke-Recorded 'adversarial-unit' @('--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1829-audit/vitest.config.ts','--project','audit','--maxWorkers','1','--reporter=json','--outputFile',(Join-Path $auditRoot 'adversarial-unit.json'))}
if($Phase -eq 'translation-retry') {Invoke-Recorded 'translation-retry' @('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1','src/tolgee/extracted-key-defaults.test.ts','--reporter=json','--outputFile',(Join-Path $auditRoot 'translation-retry.json'))}
if($Phase -eq 'archive') {Invoke-Recorded 'archive' @('node','.tmp/merge1829-audit/verify-artifacts.mjs')}
if($Phase -eq 'summary') {Invoke-Recorded 'summary' @('node','.tmp/merge1829-audit/summarize.mjs')}
if($Phase -eq 'preservation') {Invoke-Recorded 'preservation-unit' @('--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1829-audit/vitest-preservation.config.mts','--project','preservation','--maxWorkers','1','--reporter=json','--outputFile',(Join-Path $auditRoot 'preservation-unit.json'))}
