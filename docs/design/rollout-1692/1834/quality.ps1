$ErrorActionPreference = 'Continue'
$env:pnpm_config_verify_deps_before_run = 'false'
$env:SKIP_ENV_VALIDATION = 'true'
$env:CI = 'true'
$repo = 'X:/t3-code/worktrees/z8/t3-fdc2d97a-f605ff250f82822d'
Set-Location -LiteralPath $repo
$out = Join-Path $repo 'docs/design/rollout-1692/1834'
$results = @()
function Check([string]$name, [string[]]$arguments) {
  & pnpm --config.verify-deps-before-run=false @arguments *> (Join-Path $out "$name.log")
  $script:results += [pscustomobject]@{name=$name;command=('pnpm --config.verify-deps-before-run=false '+($arguments -join ' '));exit=$LASTEXITCODE}
  Write-Output "$name exit $LASTEXITCODE"
}
Check 'typegen' @('--dir','apps/webapp','exec','next','typegen')
Check 'types-app' @('--dir','apps/webapp','exec','tsc','--project','tsconfig.typecheck.json','--noEmit','--incremental','false')
Check 'types-workflow' @('--dir','apps/webapp','exec','tsc','--project','tsconfig.workflow-contracts.json','--noEmit','--incremental','false')
Check 'types-smoke' @('--dir','apps/webapp','exec','tsc','--project','tsconfig.smoke.json','--noEmit','--incremental','false')
Check 'unit' @('--dir','apps/webapp','exec','vitest','run','--project','unit','src/app/[locale]/onboarding','src/components/onboarding','src/lib/effect/services/onboarding.service.test.ts','src/lib/validations/onboarding','src/components/ui/tanstack-form.test.tsx','src/components/ui/action-panel.test.tsx','src/components/ui/loading-region.test.tsx','src/tolgee/extracted-key-defaults.test.ts','--maxWorkers=2','--reporter=json',"--outputFile=$out/unit.json")
Check 'biome-crlf' @('--dir','apps/webapp','exec','biome','check','--line-ending=crlf','src/app/[locale]/onboarding/work-schedule/page-client.tsx','src/app/[locale]/onboarding/work-schedule/page.test.tsx','src/app/[locale]/onboarding/work-schedule/work-schedule-fields.tsx')
Check 'biome-default' @('--dir','apps/webapp','exec','biome','check','src/app/[locale]/onboarding/work-schedule/page-client.tsx','src/app/[locale]/onboarding/work-schedule/page.test.tsx','src/app/[locale]/onboarding/work-schedule/work-schedule-fields.tsx')
Check 'biome-lint-imports' @('--dir','apps/webapp','exec','biome','check','--formatter-enabled=false','src/app/[locale]/onboarding/work-schedule/page-client.tsx','src/app/[locale]/onboarding/work-schedule/page.test.tsx','src/app/[locale]/onboarding/work-schedule/work-schedule-fields.tsx')
Check 'doctor' @('exec','react-doctor','apps/webapp','--diff','383c64f06a86bf94b89b980f9ec1091c6040d554','--verbose','--offline')
$results | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'quality.json') -Encoding UTF8
