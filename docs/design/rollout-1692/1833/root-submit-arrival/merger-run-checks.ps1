param([string]$Phase='exact')
$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$audit1833=Join-Path (Get-Location).Path '.tmp/merge1833-audit'
$utf1833=New-Object System.Text.UTF8Encoding($false)
function Invoke-Recorded1833([string]$Name,[string[]]$Arguments) {
 $guarded1833=@('--config.verify-deps-before-run=false')+$Arguments
 $record1833=[pscustomobject]@{name=$Name;cwd=(Get-Location).Path;sourceHead=(git rev-parse HEAD);env=@{pnpm_config_verify_deps_before_run='false'};argv=@('pnpm')+$guarded1833;started=(Get-Date).ToUniversalTime().ToString('o')}
 & pnpm @guarded1833 *> (Join-Path $audit1833 ($Name+'.log'))
 $exit1833=$LASTEXITCODE
 $record1833 | Add-Member exitCode $exit1833
 [System.IO.File]::WriteAllText((Join-Path $audit1833 ($Name+'-command.json')),(($record1833|ConvertTo-Json -Depth 12)+"`n"),$utf1833)
 Write-Output ($Name+' exit='+$exit1833)
}
if($Phase -eq 'exact') {
 $selection1833=@('src/app/[locale]/onboarding','src/components/onboarding/progress-indicator.test.tsx','src/components/ui/tanstack-form.test.tsx','src/lib/effect/services/onboarding.service.test.ts','src/lib/user-preferences','src/lib/validations/onboarding.test.ts','src/tolgee/extracted-key-defaults.test.ts')
 [System.IO.File]::WriteAllText((Join-Path $audit1833 'exact-selection.txt'),(($selection1833 -join "`n")+"`n"),$utf1833)
 Invoke-Recorded1833 'exact-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1')+$selection1833+@('--reporter=json','--outputFile',(Join-Path $audit1833 'exact-unit.json')))
}
if($Phase -eq 'compatibility') {
 $previous1833=(Get-Content -Raw -LiteralPath 'docs/design/rollout-1692/1832/root-readiness/compatibility-command.json'|ConvertFrom-Json).argv
 $first1833=[array]::IndexOf($previous1833,'--maxWorkers')+2
 $last1833=[array]::IndexOf($previous1833,'--reporter=json')-1
 $selection1833=@($previous1833[$first1833..$last1833])+@(Get-Content -LiteralPath (Join-Path $audit1833 'exact-selection.txt'))
 $selection1833=@($selection1833|Where-Object {$_ -and $_.Trim()}|Sort-Object -Unique)
 [System.IO.File]::WriteAllText((Join-Path $audit1833 'compatibility-selection.txt'),(($selection1833 -join "`n")+"`n"),$utf1833)
 Invoke-Recorded1833 'compatibility-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1')+$selection1833+@('--reporter=json','--outputFile',(Join-Path $audit1833 'compatibility-unit.json')))
}
if($Phase -eq 'probes') {Invoke-Recorded1833 'public-probes' @('--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1833-audit/vitest.config.ts','--project','audit','--maxWorkers','1','--reporter=json','--outputFile',(Join-Path $audit1833 'public-probes.json'))}
if($Phase -eq 'types') {Invoke-Recorded1833 'types' @('--filter','webapp','typecheck')}
if($Phase -eq 'quality') {
 $owned1833=@('src/app/[locale]/onboarding/wellness/page-client.tsx','src/app/[locale]/onboarding/wellness/page.test.tsx')
 Invoke-Recorded1833 'biome-explicit-crlf' (@('--filter','webapp','exec','biome','check','--error-on-warnings','--config-path=biome.jsonc','--line-width=100','--line-ending=crlf')+$owned1833)
 Invoke-Recorded1833 'biome-explicit-lint' (@('--filter','webapp','exec','biome','check','--error-on-warnings','--config-path=biome.jsonc','--formatter-enabled=false')+$owned1833)
 Invoke-Recorded1833 'biome-discovery-crlf' (@('--filter','webapp','exec','biome','check','--error-on-warnings','--line-ending=crlf')+$owned1833)
}
if($Phase -eq 'doctor') {Invoke-Recorded1833 'doctor' @('exec','react-doctor','apps/webapp','--scope','changed','--base','87f0d1ae0fd7eb1d23f394b5bddb1b740e186dc1','--verbose','--no-supply-chain','--no-telemetry','--no-score','--json','--json-out',(Join-Path $audit1833 'doctor.json'),'--max-duration','90')}
if($Phase -eq 'artifacts') {Invoke-Recorded1833 'artifacts' @('node','.tmp/merge1833-audit/verify-artifacts.mjs')}
if($Phase -eq 'summary') {Invoke-Recorded1833 'summary' @('node','.tmp/merge1833-audit/summarize.mjs')}
