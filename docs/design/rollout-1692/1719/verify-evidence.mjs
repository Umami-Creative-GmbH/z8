import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const json=async f=>JSON.parse(await readFile(new URL(f,import.meta.url),'utf8'));
const [before,after,comparison,runtime,preferences]=await Promise.all(['before.json','after.json','comparison.json','runtime.json','preferences.json'].map(json));
assert.equal(before.actor,after.actor);assert.equal(before.holder,after.holder);assert.equal(before.organization,after.organization);
for(let i=0;i<3;i++){
 const b=before.observations[i],a=after.observations[i];assert.equal(b.name,a.name);assert.equal(a.width,a.viewport);assert.equal(b.width,b.viewport);assert.equal(b.headings.length,2);assert.deepEqual(a.headings,['Fixture Person 2']);assert.deepEqual(b.rows,a.rows);assert.equal(a.rows.length,3);assert.equal(a.dark,a.name==='wide-dark');
}
assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);assert.deepEqual(runtime.errors,[]);assert.ok(runtime.checks.length>=25);assert.equal(preferences.checks.length,6);
const [switched,next,native]=await Promise.all(['after-switch.json','next-runtime.json','react-runtime.json'].map(json));
assert.equal(switched.response.status,200);assert.equal(switched.databaseActiveTarget,true);assert.equal(switched.afterReload.hasHolding,false);assert.equal(switched.afterReentry.hasHolding,false);assert.deepEqual(switched.errors,[]);
assert.deepEqual(next,{get_compilation_issues:{issues:[]},get_errors:{configErrors:[],sessionErrors:[]}});assert.ok(native.components.every(n=>n.present));
const retry=await json('retry.json');assert.equal(retry.checks.length,8);assert.equal(retry.pointerCommandRequests,1);assert.equal(retry.pointerTarget.receivesPointer,true);assert.equal(retry.pointerEvents[0].trusted,true);assert.deepEqual(retry.errors,[]);
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const entry of comparison.sourceFiles??comparison.restored){
 const blob=execFileSync('git',['show',`${comparison.sourceVersion}:${entry.file}`],{cwd:root,maxBuffer:4*1024*1024});
 const lf=blob.toString('utf8').replace(/\r\n/g,'\n');assert.ok([hash(blob),hash(Buffer.from(lf)),hash(Buffer.from(lf.replace(/\n/g,'\r\n')))].includes(entry.sha256),entry.file+' captured bytes must encode the pinned Git source exactly');
 if(process.argv.includes('--current-source')){
  const current=await readFile(new URL('../../../../'+entry.file,import.meta.url),'utf8');
  if(entry.file.endsWith('route-metadata.ts'))assert.ok(current.includes('/^\\/equipment\\/employees\\/[^/]+$/.test(path)'));
  else assert.equal(current.replace(/\r\n/g,'\n'),lf,entry.file+' current consumer');
 }
}
console.log(JSON.stringify({matchedPairs:3,retainedRows:3,runtimeAssertions:runtime.checks.length,preferenceAssertions:preferences.checks.length,pinnedSource:comparison.sourceVersion,currentSource:process.argv.includes('--current-source')}));
