$ErrorActionPreference = 'Continue'
$env:pnpm_config_verify_deps_before_run = 'false'
$repo = (Resolve-Path .).Path
$out = Join-Path $repo 'docs/design/rollout-1692/1835'
$results = @()
Set-Location (Join-Path $repo 'apps/webapp')
function Invoke-Check([string]$name, [string[]]$arguments) {
    $started = [DateTimeOffset]::UtcNow.ToString('o')
    & pnpm --config.verify-deps-before-run=false @arguments *> (Join-Path $out ($name + '.log'))
    $script:results += [PSCustomObject]@{name=$name; command=('pnpm --config.verify-deps-before-run=false '+($arguments -join ' ')); cwd=(Get-Location).Path; exit=$LASTEXITCODE; started=$started; ended=[DateTimeOffset]::UtcNow.ToString('o')}
    $script:results | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $out 'quality-commands.json')
}
$files = @('src/app/[locale]/onboarding/work-templates/page-client.tsx', 'src/app/[locale]/onboarding/work-templates/page.test.tsx', 'src/app/[locale]/onboarding/work-templates/actions.integration.test.ts')
Invoke-Check 'unit-final' @('exec','vitest','run','--project','unit','src/app/[locale]/onboarding','src/components/onboarding','src/lib/effect/services/onboarding.service.test.ts','src/components/ui/tanstack-form.test.tsx','src/components/ui/page-header.test.tsx','src/components/ui/loading-region.test.tsx','src/tolgee/extracted-key-defaults.test.ts','--reporter=json',('--outputFile='+ (Join-Path $out 'unit-final.json')))
Invoke-Check 'types-final' @('run','typecheck')
Invoke-Check 'biome-normal' (@('exec','biome','check')+$files)
Invoke-Check 'biome-normal-crlf' (@('exec','biome','check','--line-ending=crlf')+$files)
Invoke-Check 'biome-explicit' (@('exec','biome','check','--config-path=biome.jsonc')+$files)
Invoke-Check 'biome-explicit-crlf' (@('exec','biome','check','--config-path=biome.jsonc','--line-ending=crlf')+$files)
Invoke-Check 'biome-normal-lint' (@('exec','biome','check','--formatter-enabled=false')+$files)
Invoke-Check 'biome-explicit-lint' (@('exec','biome','check','--config-path=biome.jsonc','--formatter-enabled=false')+$files)
Set-Location $repo
Invoke-Check 'doctor-final' @('exec','react-doctor','apps/webapp','--verbose','--scope','changed','--base','752c500833e751df9988a3b2434d240124b89a51','--include-untracked','--json','--no-parallel','--no-telemetry','--no-supply-chain','--output-dir','.tmp/1835/doctor-final')
