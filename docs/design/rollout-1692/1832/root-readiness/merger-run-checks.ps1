param([string]$Phase='exact')
$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$auditRoot=Join-Path (Get-Location).Path '.tmp/merge1832-audit'
$utf8=New-Object System.Text.UTF8Encoding($false)
function Invoke-Recorded([string]$Name,[string[]]$Arguments) {
 $callArgs=@('--config.verify-deps-before-run=false')+$Arguments
 $record=[pscustomobject]@{name=$Name;cwd=(Get-Location).Path;sourceHead=(git rev-parse HEAD);env=@{pnpm_config_verify_deps_before_run='false'};argv=@('pnpm')+$callArgs;started=(Get-Date).ToUniversalTime().ToString('o')}
 & pnpm @callArgs *> (Join-Path $auditRoot ($Name+'.log'))
 $record | Add-Member exitCode $LASTEXITCODE
 [System.IO.File]::WriteAllText((Join-Path $auditRoot ($Name+'-command.json')),(($record|ConvertTo-Json -Depth 10)+"`n"),$utf8)
 Write-Output ($Name+' exit='+$LASTEXITCODE)
}
if($Phase -eq 'exact') {
 $selection=@('src/app/[locale]/onboarding','src/components/onboarding/progress-indicator.test.tsx','src/lib/effect/services/onboarding.service.test.ts','src/lib/validations/onboarding.test.ts','src/tolgee/extracted-key-defaults.test.ts')
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'exact-selection.txt'),(($selection -join "`n")+"`n"),$utf8)
 Invoke-Recorded 'exact-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1')+$selection+@('--reporter=json','--outputFile', (Join-Path $auditRoot 'exact-unit.json')))
}
if($Phase -eq 'compatibility') {
 $previous=(Get-Content -Raw -LiteralPath docs/design/rollout-1692/1831/root-authority-and-loading/compatibility-command.json|ConvertFrom-Json).argv
 $first=[array]::IndexOf($previous,'--maxWorkers')+2
 $last=[array]::IndexOf($previous,'--reporter=json')-1
 $selection=@($previous[$first..$last])+@(Get-Content -LiteralPath .tmp/merge1832-audit/exact-selection.txt)
 $selection=@($selection|Where-Object {$_ -and $_.Trim()}|Sort-Object -Unique)
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'compatibility-selection.txt'),(($selection -join "`n")+"`n"),$utf8)
 Invoke-Recorded 'compatibility-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1')+$selection+@('--reporter=json','--outputFile', (Join-Path $auditRoot 'compatibility-unit.json')))
}
if($Phase -eq 'types') {Invoke-Recorded 'types' @('--filter','webapp','typecheck')}
if($Phase -eq 'quality') {
 $owned=@('src/app/[locale]/onboarding/welcome/page-client.tsx','src/app/[locale]/onboarding/welcome/page.test.tsx','src/app/[locale]/onboarding/welcome/page.tsx')
 Invoke-Recorded 'biome-explicit-crlf' (@('--filter','webapp','exec','biome','check','--error-on-warnings','--config-path=biome.jsonc','--line-ending=crlf')+$owned)
 Invoke-Recorded 'biome-explicit-lint' (@('--filter','webapp','exec','biome','check','--error-on-warnings','--config-path=biome.jsonc','--formatter-enabled=false')+$owned)
}
if($Phase -eq 'doctor') {Invoke-Recorded 'doctor' @('exec','react-doctor','apps/webapp','--scope','changed','--base','ee0dcdc0923f725cfa06eafa83cc1f2039a95b97','--verbose','--no-supply-chain','--no-telemetry','--no-score','--json','--json-out',(Join-Path $auditRoot 'doctor.json'),'--max-duration','90')}
if($Phase -eq 'adversarial') {Invoke-Recorded 'adversarial-unit' @('--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1832-audit/vitest.config.ts','--project','audit','--maxWorkers','1','--reporter=json','--outputFile',(Join-Path $auditRoot 'adversarial-unit.json'))}
if($Phase -eq 'artifacts') {Invoke-Recorded 'artifacts' @('node','.tmp/merge1832-audit/verify-artifacts.mjs')}
if($Phase -eq 'quality-discovery') {Invoke-Recorded 'biome-discovery-crlf' @('--filter','webapp','exec','biome','check','--error-on-warnings','--line-ending=crlf','src/app/[locale]/onboarding/welcome/page-client.tsx','src/app/[locale]/onboarding/welcome/page.tsx','src/app/[locale]/onboarding/welcome/page.test.tsx')}
if($Phase -eq 'summary') {Invoke-Recorded 'summary' @('node','.tmp/merge1832-audit/summarize.mjs')}
