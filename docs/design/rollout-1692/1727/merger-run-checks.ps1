$ErrorActionPreference = 'Continue'
$env:pnpm_config_verify_deps_before_run = 'false'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$auditRuns = @()
$exact = @('src/components/payroll/employee-balance-workspace.test.tsx','src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.test.tsx','src/components/payroll/payroll-workspace.test.tsx','src/lib/navigation/route-metadata.test.ts','src/components/site-header.test.tsx','src/components/ui/action-panel.test.tsx','src/components/ui/dialog.test.tsx','src/components/ui/sheet.test.tsx','src/components/providers/view-refresh-provider.test.tsx','src/tolgee/extracted-key-defaults.test.ts','src/app/[locale]/(app)/settings/employees/work-balance-actions.test.ts')
$compatibility = @(Get-Content .tmp/merge1726-audit/compatibility-selection.txt) + @('src/app/[locale]/(app)/settings/employees/work-balance-actions.test.ts','src/lib/employee-lifecycle/final-payout.test.ts','src/components/settings/employee-offboarding')
foreach ($selection in @(@{name='exact';files=$exact},@{name='compatibility';files=$compatibility})) {
 $callArgs = @('--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2') + $selection.files + @('--reporter=json',('--outputFile=../../.tmp/merge1727-audit/'+$selection.name+'-unit.json'))
 $started = [DateTimeOffset]::UtcNow.ToString('o')
 & pnpm @callArgs *> ('.tmp/merge1727-audit/'+$selection.name+'-unit.log')
 $auditRuns += [pscustomobject]@{name=$selection.name;command=@('pnpm')+$callArgs;startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$LASTEXITCODE;log=('.tmp/merge1727-audit/'+$selection.name+'-unit.log')}
 $auditRuns | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath .tmp/merge1727-audit/check-commands.json -Encoding UTF8
 Write-Output ($selection.name+' exit='+$LASTEXITCODE)
}
$started = [DateTimeOffset]::UtcNow.ToString('o')
& pnpm --filter webapp typecheck *> .tmp/merge1727-audit/types.log
$auditRuns += [pscustomobject]@{name='types';command=@('pnpm','--filter','webapp','typecheck');startedAt=$started;finishedAt=[DateTimeOffset]::UtcNow.ToString('o');exitCode=$LASTEXITCODE;log='.tmp/merge1727-audit/types.log'}
$auditRuns | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath .tmp/merge1727-audit/check-commands.json -Encoding UTF8
Write-Output ('types exit='+$LASTEXITCODE)
