$env:pnpm_config_verify_deps_before_run='false'
$quality1828 = @()
$owned1828 = @('src/app/[locale]/onboarding/notifications/page-client.tsx','src/app/[locale]/onboarding/notifications/page.test.tsx','src/app/[locale]/onboarding/notifications/actions.integration.test.ts')
foreach ($profile1828 in @('explicit-crlf','explicit-lint','default','ordinary-crlf')) {
 $options1828 = switch ($profile1828) {
  'explicit-crlf' { @('--config-path=biome.jsonc','--error-on-warnings','--line-ending=crlf') }
  'explicit-lint' { @('--config-path=biome.jsonc','--error-on-warnings','--formatter-enabled=false') }
  'default' { @('--error-on-warnings') }
  'ordinary-crlf' { @('--error-on-warnings','--line-ending=crlf') }
 }
 $command1828 = @('--config.verify-deps-before-run=false','--filter','webapp','exec','biome','check') + $options1828 + $owned1828
 & pnpm @command1828 > (Join-Path '.tmp/1828-root-checks' ('biome-'+$profile1828+'.log')) 2>&1
 $quality1828 += @{name=$profile1828;command=@('pnpm')+$command1828;exitCode=$LASTEXITCODE}
 if ($profile1828.StartsWith('explicit') -and $LASTEXITCODE -ne 0) { throw 'Required explicit quality profile failed' }
}
$command1828 = @('--config.verify-deps-before-run=false','exec','react-doctor','apps/webapp','--scope','changed','--base','383c64f06a86bf94b89b980f9ec1091c6040d554','--verbose','--no-supply-chain','--no-telemetry','--no-score','--max-duration','90','--json')
& pnpm @command1828 | Set-Content -LiteralPath .tmp/1828-root-checks/doctor.json -Encoding UTF8
$quality1828 += @{name='doctor';command=@('pnpm')+$command1828;exitCode=$LASTEXITCODE}
if ($LASTEXITCODE -ne 0) { throw 'Doctor failed' }
$quality1828 | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath .tmp/1828-root-checks/quality-commands.json -Encoding UTF8
Write-Output 'Required explicit quality profiles and Doctor passed; ordinary results retained.'
