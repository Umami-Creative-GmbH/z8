import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
const mode=process.argv[2];assert.ok(['red','green','all','payslip'].includes(mode));
const root=process.cwd(),output=resolve('.tmp/1728-root-checks/acceptance'),directory=resolve((await readFile('.tmp/1728-root-fixture-pointer.txt','utf8')).trim());
assert.equal((await realpath(dirname(directory))).toLowerCase(),(await realpath(tmpdir())).toLowerCase());assert.match(basename(directory),/^z8-1728-root-[a-f0-9]{32}$/);
const json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));
const runtime=await json(join(directory,'runtime-private.json')),fixture=await json(join(directory,'fixture-private.json')),services=await json(join(directory,'services.json'));
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL,'approval-workflow-repository-test');
const url=new URL(runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/'+runtime.env.POSTGRES_DB);
assert.equal(services.containers.length,3);for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8'}).trim(),'z8-performance-fixture-1450');}
const files=mode==='payslip'?['src/lib/personnel-file/payslip-batch.integration.test.ts']:['src/lib/personnel-file/managed-employee-lifecycle.integration.test.ts'];
if(mode==='all')files.push('src/lib/personnel-file/officer-grants.integration.test.ts','src/lib/personnel-file/expiry-reminders.integration.test.ts','src/lib/personnel-file/personnel-file.integration.test.ts','src/lib/personnel-file/document-request-officer.integration.test.ts','src/app/[locale]/onboarding/work-templates/atomicity.integration.test.ts','src/app/[locale]/onboarding/work-templates/actions.integration.test.ts','src/lib/employee-lifecycle/current-roster.integration.test.ts','src/lib/employee-lifecycle/access.integration.test.ts','src/lib/personnel-file/payslip-batch.integration.test.ts','src/lib/personnel-file/sick-leave-overview.integration.test.ts');
const argv=['--config.verify-deps-before-run=false','--dir','apps/webapp','exec','vitest','run','--project','integration','--maxWorkers','1',...files,'--reporter=json','--outputFile='+join(output,'pg-'+mode+'.json')];
const pins={};for(const p of ['apps/webapp/src/lib/personnel-file/access-store.ts','apps/webapp/src/lib/personnel-file/managed-employee-lifecycle.integration.test.ts','apps/webapp/src/lib/personnel-file/payslip-batch.integration.test.ts'])pins[p]=createHash('sha256').update((await readFile(p,'utf8')).replaceAll('\r\n','\n')).digest('hex');
const allowed=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i.test(k)));
const fd=openSync(join(output,'pg-'+mode+'-private.log'),'w');let child;const start=new Date().toISOString();try{child=spawnSync(process.env.npm_execpath,argv,{cwd:root,env:{...allowed,...runtime.env,pnpm_config_verify_deps_before_run:'false'},windowsHide:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
const exit=child.status??1;await writeFile(join(output,'pg-'+mode+'-command.json'),JSON.stringify({argv,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourcePins:pins,start,end:new Date().toISOString(),exitCode:exit},null,2)+'\n');
try{const r=await json(join(output,'pg-'+mode+'.json'));console.log(JSON.stringify({mode,passed:r.numPassedTests,failed:r.numFailedTests,skipped:r.numPendingTests,files:r.testResults.length,exit}));}catch{console.log(JSON.stringify({mode,exit,reportAvailable:false}));}process.exitCode=exit;
