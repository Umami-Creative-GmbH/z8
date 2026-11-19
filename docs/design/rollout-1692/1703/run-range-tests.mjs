// pnpm node docs/design/rollout-1692/1703/run-range-tests.mjs <owned-private-fixture-directory>
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const dir=resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const services=JSON.parse(await readFile(join(dir,'services.json'),'utf8'));
assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const executable=process.env.npm_execpath;
const args=['exec','vitest','run','--project','integration','src/lib/analytics/overtime-range.integration.test.ts','src/lib/analytics/work-hours-range.integration.test.ts','src/lib/analytics/team-performance-range.integration.test.ts'];
const result=spawnSync(executable.endsWith('.exe')?executable:process.execPath,executable.endsWith('.exe')?args:[executable,...args],{cwd:resolve('apps/webapp'),env:{...process.env,APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL,APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL},stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
