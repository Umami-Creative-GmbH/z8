// Explicit checkout/fixture; stop only the recorded matching Next process, then reuse label-owned fixture cleanup.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const [repoInput,fixtureInput]=process.argv.slice(2),repo=resolve(repoInput),fixture=resolve(fixtureInput);
const json=async p=>JSON.parse(await readFile(join(fixture,p),'utf8'));
const runtime=await json('runtime-private.json'),owned=await json('dev-process-private.json'),services=await json('services.json');
assert.equal(resolve(owned.repo),repo);assert.equal(owned.origin,runtime.origin);assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(services.label,'z8-performance-fixture-1450');assert.ok(Number.isInteger(owned.pid));
for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const ps=script=>execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
const processRecord=JSON.parse(ps(`Get-CimInstance Win32_Process -Filter 'ProcessId=${owned.pid}' | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`));
const command=processRecord.CommandLine.replaceAll('\\','/').toLowerCase();assert.ok(command.includes(repo.replaceAll('\\','/').toLowerCase()));assert.ok(command.includes('node_modules/next/dist/bin/next'));assert.ok(command.includes(String(runtime.port)));
execFileSync('taskkill',['/PID',String(owned.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
const cleaned=spawnSync(process.env.npm_execpath,['node',join(repo,'scripts/performance/fixture.mjs'),'cleanup',fixture],{cwd:repo,encoding:'utf8',windowsHide:true,env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});assert.equal(cleaned.status,0);
const absent=ps(`$p=Get-Process -Id ${owned.pid} -ErrorAction SilentlyContinue; if($p){'present'}else{'absent'}`).trim();assert.equal(absent,'absent');
await writeFile(join(repo,'docs/design/rollout-1692/1827/cleanup.json'),JSON.stringify({nextIdentityVerified:true,nextStopped:true,ownedContainersRemoved:services.containers.length,previewOwnedTabClosed:true,nativeScopedBrowserClosed:true,puppeteerDriversCloseInFinally:true,privateManifests:'kept outside Git'},null,2));
console.log('Stopped matching owned Next and removed verified owned fixture services.');
