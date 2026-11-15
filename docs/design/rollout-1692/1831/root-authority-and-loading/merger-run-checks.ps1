param([string]$Phase='exact')
$ErrorActionPreference='Continue'
$env:pnpm_config_verify_deps_before_run='false'
$auditRoot=Join-Path (Get-Location).Path '.tmp/merge1831-audit'
$utf8=New-Object System.Text.UTF8Encoding($false)
function Invoke-Recorded([string]$Name,[string[]]$Arguments) {
 $callArgs=@('--config.verify-deps-before-run=false')+$Arguments
 $record=[pscustomobject]@{name=$Name;cwd=(Get-Location).Path;env=@{pnpm_config_verify_deps_before_run='false'};argv=@('pnpm')+$callArgs;started=(Get-Date).ToUniversalTime().ToString('o')}
 & pnpm @callArgs *> (Join-Path $auditRoot ($Name+'.log'))
 $record | Add-Member exitCode $LASTEXITCODE
 [System.IO.File]::WriteAllText((Join-Path $auditRoot ($Name+'-command.json')),(($record|ConvertTo-Json -Depth 10)+"`n"),$utf8)
 Write-Output ($Name+' exit='+$LASTEXITCODE)
}
if($Phase -eq 'exact') {
 $selection=@('src/app/[locale]/onboarding','src/components/onboarding/progress-indicator.test.tsx','src/components/ui/tanstack-form.test.tsx','src/lib/effect/services/onboarding.service.test.ts','src/lib/user-preferences','src/lib/datetime/birthday.test.ts','src/lib/datetime/calendar-date.test.ts','src/lib/validations/onboarding.test.ts','src/tolgee/extracted-key-defaults.test.ts','src/components/settings/work-balance/opening-balance-upload-dialog.test.tsx','src/lib/navigation/route-metadata.test.ts')
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'exact-selection.txt'),(($selection -join "`n")+"`n"),$utf8)
 Invoke-Recorded 'exact-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2')+$selection+@('--reporter=json','--outputFile', (Join-Path $auditRoot 'exact-unit.json')))
}
if($Phase -eq 'compatibility') {
 $previous=(Get-Content -Raw -LiteralPath .tmp/1830-root-checks/compatibility-command.json|ConvertFrom-Json).argv; $selection=@($previous[11..([array]::IndexOf($previous,'--reporter=json')-1)])+@(Get-Content .tmp/merge1831-audit/exact-selection.txt)
 $selection=@($selection|Where-Object {$_ -and $_.Trim()}|Sort-Object -Unique)
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'compatibility-selection.txt'),(($selection -join "`n")+"`n"),$utf8)
 Invoke-Recorded 'compatibility-unit' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2')+$selection+@('--reporter=json','--outputFile', (Join-Path $auditRoot 'compatibility-unit.json')))
}
if($Phase -eq 'types') {Invoke-Recorded 'types' @('--filter','webapp','typecheck')}
if($Phase -eq 'quality') {
 $owned=@('src/app/[locale]/onboarding/vacation-policy/page-client.tsx','src/app/[locale]/onboarding/vacation-policy/page.test.tsx','src/app/[locale]/onboarding/vacation-policy/use-policy-arrival.ts')
 $profiles=@(@{name='biome-default';options=@()},@{name='biome-crlf';options=@('--line-ending=crlf')},@{name='biome-explicit';options=@('--config-path=biome.jsonc')},@{name='biome-explicit-crlf';options=@('--config-path=biome.jsonc','--line-ending=crlf')},@{name='biome-lint-import';options=@('--formatter-enabled=false')},@{name='biome-explicit-lint';options=@('--config-path=biome.jsonc','--formatter-enabled=false')})
 foreach($profile in $profiles) {Invoke-Recorded $profile.name (@('--filter','webapp','exec','biome','check','--error-on-warnings')+$profile.options+$owned)}
}
if($Phase -eq 'doctor') {Invoke-Recorded 'doctor' @('exec','react-doctor','apps/webapp','--scope','changed','--base','96dea2d9b2dfa5f83325fd7c0bf925e0da9b1ecb','--verbose','--no-supply-chain','--no-telemetry','--no-score','--json','--json-out',(Join-Path $auditRoot 'doctor.json'),'--max-duration','90')}
if($Phase -eq 'adversarial') {Invoke-Recorded 'adversarial-unit' @('--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1831-audit/vitest.config.ts','--project','audit','--maxWorkers','1','--reporter=json','--outputFile',(Join-Path $auditRoot 'adversarial-unit.json'))}
if($Phase -eq 'archive') {Invoke-Recorded 'archive' @('node','.tmp/merge1831-audit/verify-artifacts.mjs')}

if($Phase -eq 'summary') {Invoke-Recorded 'summary' @('node','.tmp/merge1831-audit/summarize.mjs')}
