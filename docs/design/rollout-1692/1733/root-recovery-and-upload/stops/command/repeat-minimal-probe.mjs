import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir='.tmp/1733-root-checks/runtime';
const args=['--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','unit','--maxWorkers','1',
 'src/components/personnel-file/independent1733-command-probe.test.tsx','--testNamePattern','prevents a duplicate pending confirmation',
 '--reporter=json','--outputFile=../../'+dir+'/minimal-repeat.json'];
const pnpm=process.env.npm_execpath;assert.ok(pnpm);
const exe=pnpm.toLowerCase().endsWith('.exe')?pnpm:process.execPath;
const argv=exe===pnpm?args:[pnpm,...args];
const run=spawnSync(exe,argv,{encoding:'utf8',env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
assert.ifError(run.error);
writeFileSync(dir+'/minimal-repeat.log',(run.stdout??'')+(run.stderr??''));
writeFileSync(dir+'/minimal-repeat-command.json',JSON.stringify({executable:'pnpm',argv:args,exit:run.status,physicalFiles:1,selectedCaseInstances:2},null,2)+'\n');
const json=JSON.parse(readFileSync(dir+'/minimal-repeat.json','utf8'));
console.log(JSON.stringify({exit:run.status,passed:json.numPassedTests,failed:json.numFailedTests,pending:json.numPendingTests}));
process.exitCode=run.status??1;
