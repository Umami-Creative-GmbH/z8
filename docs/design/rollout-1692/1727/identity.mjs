import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const files=[
 'apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.tsx',
 'apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/actions.ts',
 'apps/webapp/src/components/payroll/employee-balance-workspace.tsx',
 'apps/webapp/src/components/payroll/employee-balance-projection.tsx',
 ...['set-opening-balance-dialog.tsx','record-overtime-payout-dialog.tsx','cancel-balance-adjustment-dialog.tsx','balance-form-panel.tsx','balance-form-surface.ts','use-balance-form-request.ts','use-employee-work-balance.ts'].map(n=>'apps/webapp/src/components/settings/work-balance/'+n),
 'apps/webapp/src/app/[locale]/(app)/settings/employees/work-balance-actions.ts',
 'apps/webapp/src/app/[locale]/(app)/payroll/work-balances/coverage.ts',
 ...['store.ts','authorization.ts','rules.ts'].map(n=>'apps/webapp/src/lib/work-balance/adjustments/'+n),
 'apps/webapp/src/lib/work-balance/service.ts','apps/webapp/src/lib/navigation/route-metadata.ts',
];
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function sourceIdentity(){return {head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),integration:execFileSync('git',['rev-parse','ai/1692-app-wide-ui-refresh'],{encoding:'utf8'}).trim(),files:await Promise.all(files.map(async file=>{const bytes=await readFile(file);return{file,raw:hash(bytes),normalized:hash(bytes.toString('utf8').replaceAll('\r\n','\n'))};}))};}
