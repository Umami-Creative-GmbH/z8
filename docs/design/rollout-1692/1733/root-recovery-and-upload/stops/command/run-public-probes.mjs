import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const out='.tmp/1733-root-checks/runtime';
const args=['--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','2',
 'src/components/personnel-file/independent1733-command-probe.test.tsx',
 'src/components/personnel-file/independent1733-heading-probe.test.tsx',
 'src/components/personnel-file/payslip-batch-workspace.test.tsx',
 'src/components/personnel-file/payslip-batch-start.test.tsx',
 '--reporter=json','--outputFile=../../'+out+'/public-probes.json'];
const pnpm=process.env.npm_execpath;assert.ok(pnpm,'pnpm must launch this runner');
const exe=pnpm.toLowerCase().endsWith('.exe')?pnpm:process.execPath;
const argv=exe===pnpm?args:[pnpm,...args];
const result=spawnSync(exe,argv,{encoding:'utf8',env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
assert.ifError(result.error);
const log=(result.stdout??'')+(result.stderr??'');
writeFileSync(out+'/public-probes.log',log);
writeFileSync(out+'/public-probe-command.json',JSON.stringify({executable:'pnpm',argv:args,exit:result.status,physicalFiles:4,defaultTimeoutMs:5000},null,2)+'\n');
console.log(JSON.stringify({exit:result.status,logFile:out+'/public-probes.log'}));
process.exitCode=result.status??1;
