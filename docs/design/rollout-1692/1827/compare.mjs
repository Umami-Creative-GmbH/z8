// Explicit checkout/fixture. Temporarily substitutes only this ticket-owned consumer, always restores exact bytes.
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const [checkoutInput,fixtureInput,beforeRef]=process.argv.slice(2),checkout=resolve(checkoutInput),fixture=resolve(fixtureInput);
const runtime=JSON.parse(await readFile(join(fixture,'runtime-private.json'),'utf8')),services=JSON.parse(await readFile(join(fixture,'services.json'),'utf8'));assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(services.label,'z8-performance-fixture-1450');for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const path=join(checkout,'apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx'),saved=await readFile(path);
assert.ok(beforeRef,'Explicit before-source ref required');
const base=execFileSync('git',['rev-parse',beforeRef],{cwd:checkout,encoding:'utf8'}).trim();
const run=phase=>{const result=spawnSync(process.execPath,[join(checkout,'docs/design/rollout-1692/1827/verify-runtime.mjs'),checkout,fixture,phase],{cwd:checkout,stdio:'inherit',windowsHide:true});assert.equal(result.status,0,phase+' runtime');};
try {await writeFile(path,execFileSync('git',['show',base+':apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx'],{cwd:checkout}));run('before');}
finally {await writeFile(path,saved);assert.deepEqual(await readFile(path),saved);}
if(process.argv[5]!=='before-only')run('after');
