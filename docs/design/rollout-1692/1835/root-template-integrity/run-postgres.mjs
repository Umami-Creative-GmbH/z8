import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
const root=resolve('.'),mode=process.argv[2];
assert.ok(['atomic-red','atomic-green','all'].includes(mode));
const directory=resolve((await readFile('.tmp/1835-root-fixture-pointer.txt','utf8')).trim());
assert.equal((await realpath(dirname(directory))).toLowerCase(),(await realpath(tmpdir())).toLowerCase());
assert.match(basename(directory),/^z8-1835-root-[a-f0-9]{32}$/);
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\ufeff/,''));
const runtime=await json(join(directory,'runtime-private.json')),fixture=await json(join(directory,'fixture-private.json')),services=await json(join(directory,'services.json'));
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const dbUrl=new URL(runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.pathname,'/'+runtime.env.POSTGRES_DB);assert.equal(runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL,'approval-workflow-repository-test');
assert.equal(services.containers.length,3);for(const container of services.containers){assert.match(container,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8'}).trim(),'z8-performance-fixture-1450');}
const output=resolve('.tmp/1835-root-checks'),argv=['--config.verify-deps-before-run=false','--dir','apps/webapp','exec','vitest','run','--project','integration','--maxWorkers','1','src/app/[locale]/onboarding/work-templates/atomicity.integration.test.ts'];
if(mode!=='all')argv.push('-t','second organization default|daily numeric overflow');
argv.push('--reporter=json','--outputFile='+join(output,'pg-'+mode+'.json'));
const sourcePins={};for(const path of ['apps/webapp/src/app/[locale]/onboarding/work-templates/actions.ts','apps/webapp/src/app/[locale]/onboarding/work-templates/atomicity.integration.test.ts','apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/lib/onboarding/work-template-mutation.ts','apps/webapp/src/lib/user-preferences/user-settings-mutation.ts']){try{sourcePins[path]=createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex');}catch(error){if(error.code!=='ENOENT')throw error;}}
const allowed=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i.test(key)));
assert.ok(process.env.npm_execpath,'Invoke through pnpm node');
const started=new Date().toISOString(),fd=openSync(join(output,'pg-'+mode+'-private.log'),'w');let child;
try{child=spawnSync(process.env.npm_execpath,argv,{cwd:root,env:{...allowed,...runtime.env,pnpm_config_verify_deps_before_run:'false'},windowsHide:true,stdio:['ignore',fd,fd]});}finally{closeSync(fd);}
const result={mode,argv,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourcePins,started,ended:new Date().toISOString(),exitCode:child.status??1};
await writeFile(join(output,'pg-'+mode+'-command.json'),JSON.stringify(result,null,2)+'\n');
try{const tests=await json(join(output,'pg-'+mode+'.json'));console.log(JSON.stringify({mode,passed:tests.numPassedTests,failed:tests.numFailedTests,pending:tests.numPendingTests,files:tests.testResults.length,exitCode:result.exitCode}));}catch{console.log(JSON.stringify({mode,exitCode:result.exitCode,reportAvailable:false}));}
process.exitCode=result.exitCode;
