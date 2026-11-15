// Explicit checkout + owned disposable fixture. Does not read ambient application secrets.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const[checkout,input]=process.argv.slice(2),repo=resolve(checkout),dir=resolve(input);
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(services.label,'z8-performance-fixture-1450');
for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),...runtime.env,NODE_ENV:'test',BILLING_ENABLED:'false',TELEMETRY_ENABLED:'false',ENABLE_CRON_JOBS:'false',pnpm_config_verify_deps_before_run:'false'};
const args=['--config.verify-deps-before-run=false','--filter','webapp','exec','vitest','run','--project','integration','src/lib/auth/organization-joining.integration.test.ts','src/lib/work-balance/tracking-start.integration.test.ts','src/lib/employee-lifecycle/joining/joining.integration.test.ts','--maxWorkers=2','--reporter=json','--outputFile=../../docs/design/rollout-1692/1832/postgres.json'];
const binary=process.env.npm_execpath,native=binary.endsWith('.exe');
const child=spawn(native?binary:process.execPath,native?args:[binary,...args],{cwd:repo,env,stdio:'inherit',windowsHide:true});
const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',done);});
await writeFile(join(repo,'docs/design/rollout-1692/1832/postgres-command.json'),JSON.stringify({command:['pnpm',...args],exitCode:code,fixture:'owned generated loopback disposable DB; billing/telemetry/cron disabled'},null,2)+'\n');process.exitCode=code??1;
