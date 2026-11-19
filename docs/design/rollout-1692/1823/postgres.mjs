import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const repo=process.cwd(), directory=process.argv[2];
assert.equal(resolve(execFileSync('git',['rev-parse','--show-toplevel'],{encoding:'utf8'}).trim()),resolve(repo));
const runtime=JSON.parse(await readFile(join(directory,'runtime-private.json'),'utf8'));
const services=JSON.parse(await readFile(join(directory,'services.json'),'utf8'));
assert.equal(JSON.parse(await readFile(join(directory,'fixture-private.json'),'utf8')).kind,'disposable');
assert.equal(services.label,'z8-performance-fixture-1450');
const container=services.containers.find(x=>x.endsWith('_postgres'));
assert.match(container,/^z8_perf_[a-f0-9]{12}_postgres$/);
assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8'}).trim(),'z8-performance-fixture-1450');
const name='approval_workflow_repository_test_r024_'+randomBytes(6).toString('hex');
assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');
execFileSync('docker',['exec',container,'createdb','-U','postgres',name]);
const systemEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i.test(key)));
const env={...systemEnv,...runtime.env, POSTGRES_DB:name,SKIP_ENV_VALIDATION:'true',APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL:'postgresql://postgres:'+encodeURIComponent(runtime.env.POSTGRES_PASSWORD)+'@127.0.0.1:'+runtime.env.POSTGRES_PORT+'/'+name,APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:'approval-workflow-repository-test',pnpm_config_verify_deps_before_run:'false'};
const log=createWriteStream(join(directory,'postgres-private.log'),{mode:0o600}); await once(log,'open');
try {
 for(const args of [
 ['exec','tsx','scripts/verify-approval-migration-recovery.ts'],
 ['exec','vitest','run','--project','integration','src/lib/employee-lifecycle/joining/joining.integration.test.ts','src/lib/employee-lifecycle/reactivation-paths.integration.test.ts','src/lib/auth/organization-joining.integration.test.ts']
 ]){
  const child=spawn(process.env.npm_execpath,args,{cwd:join(repo,'apps/webapp'),env,windowsHide:true,stdio:['ignore',log,log]});
  const [code]=await once(child,'exit'); assert.equal(code,0,'Owned PostgreSQL command failed; inspect private log');
 }
 console.log('Owned migration verifier and three joining integration suites passed.');
} finally { log.end(); }
