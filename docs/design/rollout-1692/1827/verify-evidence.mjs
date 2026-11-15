// Verify source pins and fully decode actual captures; explicit checkout/private fixture for secret exclusion only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const [repoInput,fixtureInput]=process.argv.slice(2),repo=resolve(repoInput),fixture=resolve(fixtureInput),output=join(repo,'docs/design/rollout-1692/1827');
const appRequire=createRequire(join(repo,'apps/webapp/package.json')),sharp=appRequire('sharp');
const files=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())await walk(p);else files.push(p);}}await walk(output);
let pngs=0,jsons=0;for(const file of files){if(file.endsWith('.png')){await sharp(file).raw().toBuffer();pngs++;}if(file.endsWith('.json')){JSON.parse(await readFile(file,'utf8'));jsons++;}}
const after=JSON.parse(await readFile(join(output,'after-runtime.json'),'utf8'));assert.deepEqual(after.failed,[]);
let pins=0;for(const capture of after.captures)for(const [p,pin] of Object.entries(capture.source.files)){assert.equal(createHash('sha256').update(await readFile(join(repo,p))).digest('hex'),pin.sha256);assert.equal(execFileSync('git',['hash-object','--path',p,p],{cwd:repo,encoding:'utf8'}).trim(),pin.blob);pins++;}
const native=JSON.parse(await readFile(join(output,'native-source.json'),'utf8'));assert.equal(native.blob,execFileSync('git',['hash-object','--path','apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx'],{cwd:repo,encoding:'utf8'}).trim());
const tree=JSON.parse(JSON.parse(await readFile(join(output,'native-tree-result.json'),'utf8')).out);assert.ok(tree.data.tree.includes('CompletionAttempt')&&tree.data.tree.includes('SetupSummary'));
const auth=JSON.parse(await readFile(join(fixture,'dev-auth-private.json'),'utf8')),fixtureData=JSON.parse(await readFile(join(fixture,'fixture-private.json'),'utf8'));
const forbidden=[...Object.values(auth).flatMap(a=>a.cookies.map(c=>c.value)),...Object.values(fixtureData.actors).map(a=>a.password)].filter(v=>v?.length>10);
const ownedSources=execFileSync('git',['diff','--name-only','--','apps/webapp'],{cwd:repo,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);for(const file of [...files,...ownedSources.map(p=>join(repo,p))]){if(file.endsWith('.png'))continue;const body=await readFile(file,'utf8');assert.ok(!forbidden.some(value=>body.includes(value)),'private value exclusion');}
await writeFile(join(output,'evidence-verification.json'),JSON.stringify({decodedPNGs:pngs,parsedJSON:jsons,matchingFinalCaptureSourcePins:pins,nativeTargetAndSourceMatch:true,successfulRuntimeChecks:after.checks.length,privateFixtureValuesExcluded:true},null,2));console.log('Capture/source/private-value verification passed.');
