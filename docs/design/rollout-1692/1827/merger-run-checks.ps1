$ErrorActionPreference = 'Continue'
$env:pnpm_config_verify_deps_before_run = 'false'
$auditRoot = Join-Path (Get-Location) '.tmp/merge1827-audit'
$auditRuns = @()
$exact = @('src/app/[locale]/onboarding/complete/page.test.tsx','src/app/[locale]/onboarding/layout.test.tsx','src/components/onboarding/progress-indicator.test.tsx','src/lib/effect/services/onboarding.service.test.ts')
$compatibility = @([System.IO.File]::ReadAllLines((Join-Path (Get-Location) '.tmp/merge1726-audit/compatibility-selection.txt'))) + @('src/app/[locale]/onboarding','src/components/onboarding','src/app/[locale]/init/page-client.test.tsx','src/lib/effect/services/auth.service.test.ts','src/lib/effect/services/onboarding.service.test.ts','src/lib/auth/use-auth-page-session.test.tsx','src/lib/auth/request-session.test.ts','src/lib/auth/organization-session-revocation.test.ts','src/lib/enterprise-identity/session-sso.test.ts','src/lib/organization-mfa/authentication-plugin.test.ts','src/components/organization-mfa','src/app/[locale]/(auth)/layout.test.tsx','src/components/auth-shell-controls.test.tsx','src/app/[locale]/(app)/settings/employees/work-balance-actions.test.ts','src/lib/employee-lifecycle/final-payout.test.ts','src/components/settings/employee-offboarding')
[System.IO.File]::WriteAllLines((Join-Path $auditRoot 'compatibility-selection.txt'),$compatibility)
foreach ($selection in @(@{name='exact';files=$exact},@{name='compatibility';files=$compatibility})) {
  $callArgs = @('--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2') + $selection.files + @('--reporter=json',('--outputFile='+((Join-Path $auditRoot ($selection.name+'-unit.json')) -replace '\\','/')))
  $started = [DateTimeOffset]::UtcNow.ToString('o')
  & pnpm @callArgs *> (Join-Path $auditRoot ($selection.name+'-unit.log'))
  $auditExit = $LASTEXITCODE
  $auditRuns += [pscustomobject]@{name=$selection.name;command=@('pnpm')+$callArgs;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$auditExit}
  [System.IO.File]::WriteAllText((Join-Path $auditRoot 'check-commands.json'), (($auditRuns | ConvertTo-Json -Depth 8) + "`n"))
  Write-Output ($selection.name+' exit='+$auditExit)
}
$callArgs = @('--config.verify-deps-before-run=false','--filter','webapp','typecheck')
$started = [DateTimeOffset]::UtcNow.ToString('o')
& pnpm @callArgs *> (Join-Path $auditRoot 'types.log')
$auditRuns += [pscustomobject]@{name='types';command=@('pnpm')+$callArgs;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$LASTEXITCODE}
[System.IO.File]::WriteAllText((Join-Path $auditRoot 'check-commands.json'), (($auditRuns | ConvertTo-Json -Depth 8) + "`n"))
Write-Output ('types exit='+$LASTEXITCODE)
if (@($auditRuns | Where-Object exitCode -ne 0).Count -gt 0) { exit 1 }
