$ErrorActionPreference = 'Continue'
$env:pnpm_config_verify_deps_before_run = 'false'
$auditRuns = @()
$exact = @('src/components/payroll/employee-balance-workspace.test.tsx','src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.test.tsx','src/components/payroll/payroll-workspace.test.tsx','src/lib/navigation/route-metadata.test.ts','src/components/site-header.test.tsx','src/components/ui/action-panel.test.tsx','src/components/ui/dialog.test.tsx','src/components/ui/sheet.test.tsx','src/components/providers/view-refresh-provider.test.tsx','src/tolgee/extracted-key-defaults.test.ts','src/app/[locale]/(app)/settings/employees/work-balance-actions.test.ts')
$compatibility = @([System.IO.File]::ReadAllLines((Join-Path (Get-Location) '.tmp/merge1726-audit/compatibility-selection.txt'))) + @('src/app/[locale]/(app)/settings/employees/work-balance-actions.test.ts','src/lib/employee-lifecycle/final-payout.test.ts','src/components/settings/employee-offboarding')
foreach ($selection in @(@{name='exact';files=$exact},@{name='compatibility';files=$compatibility})) {
  $callArgs = @('--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2') + $selection.files + @('--reporter=json',('--outputFile=../../.tmp/1727-root-checks/'+$selection.name+'-unit.json'))
  $started = [DateTimeOffset]::UtcNow.ToString('o')
  & pnpm @callArgs *> ('.tmp/1727-root-checks/'+$selection.name+'-unit.log')
  $r044Exit = $LASTEXITCODE
  $auditRuns += [pscustomobject]@{name=$selection.name;command=@('pnpm')+$callArgs;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$r044Exit}
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) '.tmp/1727-root-checks/commands.json'), (($auditRuns | ConvertTo-Json -Depth 5) + "`n"))
  Write-Output ($selection.name+' exit='+$r044Exit)
  if ($r044Exit -ne 0) { exit $r044Exit }
}
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --config ../../.tmp/merge1727-audit/vitest.config.mts --project audit --maxWorkers 2 --reporter=json --outputFile=X:/t3-code/worktrees/z8/t3-36de3f4a-69b59b59b97cbc3d/.tmp/1727-root-checks/adversarial-unit.json *> .tmp/1727-root-checks/adversarial-unit.log
exit $LASTEXITCODE
