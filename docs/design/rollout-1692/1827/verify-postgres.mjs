// Existing guarded fixture environment only. Explicit checkout/fixture; test runner never prints credentials.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const [repoInput,fixtureInput]=process.argv.slice(2),repo=resolve(repoInput),fixture=resolve(fixtureInput);
const read=async p=>JSON.parse(await readFile(join(fixture,p),'utf8'));
const runtime=await read('runtime-private.json'),services=await read('services.json');
assert.equal(services.label,'z8-performance-fixture-1450');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.test(k))),...runtime.env,NODE_ENV:'test',CI:'true',pnpm_config_verify_deps_before_run:'false'};
const child=spawn(process.env.npm_execpath,['--filter','webapp','exec','vitest','run','--project','integration','--maxWorkers','1','src/app/[locale]/onboarding/complete/actions.integration.test.ts','src/lib/organization-mfa/authentication.integration.test.ts','src/lib/organization-mfa/policy.integration.test.ts'],{cwd:repo,env,windowsHide:true,stdio:'inherit'});
child.on('exit',code=>process.exitCode=code??1);
