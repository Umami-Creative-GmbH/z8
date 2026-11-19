// Reuse repository integration database gate and public suites on the new fixture.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory=resolve(process.argv[2]);const json=async n=>JSON.parse(await readFile(join(directory,n),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),s=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of s.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),s.label);
const e=r.env;const url=`postgresql://${encodeURIComponent(e.POSTGRES_USER)}:${encodeURIComponent(e.POSTGRES_PASSWORD)}@127.0.0.1:${e.POSTGRES_PORT}/${e.POSTGRES_DB}`;
const result=spawnSync(process.env.npm_execpath,['--filter','webapp','exec','vitest','run','--project','integration','src/lib/employee-lifecycle/joining/joining.integration.test.ts','src/lib/auth/organization-joining.integration.test.ts','src/app/[locale]/(app)/settings/profile/user-configuration-access.integration.test.ts'],{stdio:'inherit',windowsHide:true,env:{...process.env,APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL:url,APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:'approval-workflow-repository-test'}});process.exitCode=result.status??1;
