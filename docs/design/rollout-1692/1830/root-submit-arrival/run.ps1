param([string]$Phase)
$ErrorActionPreference='Stop'
$env:pnpm_config_verify_deps_before_run='false'
$out=Join-Path (Get-Location).Path '.tmp/1830-root-checks'
$utf8=New-Object System.Text.UTF8Encoding($false)
function Run-Check([string]$Name,[string[]]$Arguments) {
 $args1830=@('--config.verify-deps-before-run=false')+$Arguments
 $record=@{cwd=(Get-Location).Path;argv=@('pnpm')+$args1830;env=@{pnpm_config_verify_deps_before_run='false'}}
 & pnpm @args1830 *> (Join-Path $out ($Name+'.log'))
 $record.exitCode=$LASTEXITCODE
 [IO.File]::WriteAllText((Join-Path $out ($Name+'-command.json')),($record|ConvertTo-Json -Depth 8),$utf8)
 Write-Output "$Name exit=$LASTEXITCODE"
 if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}
if($Phase -eq 'compatibility') {
 $selection=@(Get-Content -LiteralPath '.tmp/merge1830-audit/compatibility-selection.txt')
 Run-Check 'compatibility' (@('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1')+$selection+@('--reporter=json','--outputFile',(Join-Path $out 'compatibility.json')))
}
if($Phase -eq 'independent') { Run-Check 'independent' @('--filter','webapp','exec','vitest','run','--config','../../.tmp/merge1830-audit/vitest.config.ts','--project','audit','--maxWorkers','1','--reporter=json','--outputFile',(Join-Path $out 'independent.json')) }
if($Phase -eq 'types') { Run-Check 'types' @('--filter','webapp','typecheck') }
if($Phase -eq 'quality') {
 $files=@('src/app/[locale]/onboarding/profile/page-client.tsx','src/app/[locale]/onboarding/profile/page.test.tsx','src/app/[locale]/onboarding/profile/actions.test.ts','src/lib/validations/onboarding.ts')
 Run-Check 'biome-explicit-crlf' (@('--filter','webapp','exec','biome','check','--config-path=./biome.jsonc','--line-ending=crlf')+$files)
 Run-Check 'biome-explicit-lint' (@('--filter','webapp','exec','biome','check','--config-path=./biome.jsonc','--formatter-enabled=false')+$files)
 Run-Check 'doctor' @('exec','react-doctor','apps/webapp','--scope','changed','--base','1fb2263e97bf266522f1cf50be957889383701cd','--include-untracked','--verbose','--no-supply-chain','--no-telemetry','--no-score','--json','--json-out',(Join-Path $out 'doctor.json'),'--max-duration','90')
}
