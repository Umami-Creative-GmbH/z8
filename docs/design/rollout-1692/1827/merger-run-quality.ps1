$ErrorActionPreference = 'Continue'
$env:pnpm_config_verify_deps_before_run = 'false'
$auditRoot = Join-Path (Get-Location) '.tmp/merge1827-audit'
$owned = @('src/app/[locale]/onboarding/complete/actions.integration.test.ts','src/app/[locale]/onboarding/complete/page-client.tsx','src/app/[locale]/onboarding/complete/page.test.tsx')
$profiles = @(@{name='biome-default';options=@()},@{name='biome-crlf';options=@('--line-ending=crlf')},@{name='biome-explicit';options=@('--config-path=biome.jsonc')},@{name='biome-explicit-crlf';options=@('--config-path=biome.jsonc','--line-ending=crlf')},@{name='biome-lint-import';options=@('--formatter-enabled=false')},@{name='biome-explicit-lint';options=@('--config-path=biome.jsonc','--formatter-enabled=false')})
$auditRuns = @()
foreach ($profile in $profiles) {
 $callArgs = @('--config.verify-deps-before-run=false','--filter','webapp','exec','biome','check','--error-on-warnings') + $profile.options + $owned
 & pnpm @callArgs *> (Join-Path $auditRoot ($profile.name+'.log'))
 $auditRuns += [pscustomobject]@{name=$profile.name;command=@('pnpm')+$callArgs;exitCode=$LASTEXITCODE}
 Write-Output ($profile.name+' exit='+$LASTEXITCODE)
 [System.IO.File]::WriteAllText((Join-Path $auditRoot 'quality-commands.json'),(($auditRuns | ConvertTo-Json -Depth 8)+"`n"))
}
$callArgs = @('--config.verify-deps-before-run=false','exec','react-doctor','apps/webapp','--scope','changed','--base','584db58aa2e5789e6f0e94d0f2c2f69b62f18807','--verbose','--no-supply-chain','--no-telemetry','--no-score','--json','--json-out','.tmp/merge1827-audit/doctor.json','--max-duration','90')
& pnpm @callArgs *> (Join-Path $auditRoot 'doctor.log')
$auditRuns += [pscustomobject]@{name='doctor';command=@('pnpm')+$callArgs;exitCode=$LASTEXITCODE}
Write-Output ('doctor exit='+$LASTEXITCODE)
[System.IO.File]::WriteAllText((Join-Path $auditRoot 'quality-commands.json'),(($auditRuns | ConvertTo-Json -Depth 8)+"`n"))
