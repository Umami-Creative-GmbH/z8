import{spawnSync,execFileSync}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';import{resolve,join}from'node:path';import assert from'node:assert/strict';
const out=resolve('.tmp/1733-final-runtime-checks/runtime'),dir=readFileSync(join(out,'pg-pointer-private.txt'),'utf8').trim();
const r=JSON.parse(readFileSync(join(dir,'runtime-private.json'),'utf8')),s=JSON.parse(readFileSync(join(dir,'services.json'),'utf8'));
assert.equal(s.containers.length,3);assert.equal(s.label,'z8-performance-fixture-1450');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL,'approval-workflow-repository-test');
for(const c of s.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),s.label);}
const args=['--config.verify-deps-before-run=false','exec','vitest','run','--project','integration','--maxWorkers','1','src/lib/personnel-file/payslip-batch.integration.test.ts','--reporter=json','--outputFile='+join(out,'pg20-raw-private.json')];
const child=spawnSync(process.env.npm_execpath,args,{cwd:resolve('apps/webapp'),env:{...process.env,...r.env,pnpm_config_verify_deps_before_run:'false'},encoding:'utf8',windowsHide:true,maxBuffer:5e6});
writeFileSync(join(dir,'pg-suite-private.log'),(child.stdout??'')+(child.stderr??''));
writeFileSync(join(out,'pg-command.json'),JSON.stringify({command:['pnpm',...args.slice(0,-1),'--outputFile=<owned-output>'],exit:child.status,error:child.error?.code??null,standardGuard:true,integrationPools:true,physicalFiles:1,ownLabelContainers:3},null,2)+'\n');
console.log(JSON.stringify({stage:'pg20',exit:child.status}));process.exitCode=child.status??1;
