// A separate prepared fixture is mandatory; integration suites own and clean their own synthetic rows.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
const repo=process.cwd(),dir=resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')),fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8')),services=JSON.parse(await readFile(join(dir,'services.json'),'utf8'));
if(fixture.kind!=='disposable'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Guarded isolated database required');
for(const c of services.containers)if(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim()!==services.label)throw Error('Ownership mismatch');
const e=runtime.env,url=`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:${e.POSTGRES_PORT}/${e.POSTGRES_DB}`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS)$/i.test(key))),...e,CI:'true',BILLING_ENABLED:'false',TELEMETRY_ENABLED:'false',ENABLE_CRON_JOBS:'false',APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL:url,APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:'approval-workflow-repository-test'};
const child=spawn(process.execPath,[join(repo,'apps/webapp/node_modules/vitest/vitest.mjs'),'run','--project','integration','--maxWorkers','1',...['worklist','visibility','operational','impediments','history','feature-switch','checks','export','lifecycle'].map(name=>`src/lib/organization/driving-licence/${name}.integration.test.ts`)],{cwd:join(repo,'apps/webapp'),env,windowsHide:true});
let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);const code=await new Promise(done=>child.once('exit',done));await writeFile(join(dir,'integration-private.log'),log,{mode:0o600});console.log(log.split(/\r?\n/).filter(line=>/Test Files|Tests |Duration|✓|❯|FAIL |Error:/.test(line)).join('\n'));process.exitCode=code;
