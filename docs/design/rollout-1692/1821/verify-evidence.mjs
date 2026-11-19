import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const base='docs/design/rollout-1692/1821/';
const json=async name=>JSON.parse(await readFile(base+name,'utf8'));
const before=await json('before-runtime.json'),after=await json(process.argv[2]??'after-runtime.json'),quality=await json('quality.json');
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const component='apps/webapp/src/components/forgot-password-form.tsx';
assert.equal(after.source.files[component],await hash(component));
assert.equal(quality.componentSha256,await hash(component));
assert.equal(before.captures.length,6); assert.equal(after.captures.length,14);
assert.equal(after.actions.length,5); assert.deepEqual(after.errors,[]); assert.equal(after.failure,undefined);
for(const capture of before.captures){
 const paired=after.captures.find(x=>x.label===capture.label); assert.ok(paired);
 for(const key of ['width','documentWidth','fontSize'])assert.equal(paired[key],capture[key]);
 if(capture.label.startsWith('branded')){assert.ok(capture.text.includes('z8'));assert.equal(paired.brand,'#2563eb');assert.ok(paired.text.includes('Performance small'));}
}
assert.equal(after.actions.find(x=>x.label==='known-neutral-de').newVerificationCount,1);
assert.equal(after.actions.find(x=>x.label==='known-neutral-de').sameNeutralResponse,true);
assert.equal(after.actions.find(x=>x.label==='actual-server-captcha-refusal-and-widget-retry').refusalStatus,400);
assert.equal(after.actions.find(x=>x.label==='actual-server-captcha-refusal-and-widget-retry').retryStatus,200);
assert.ok(quality.checks.every(x=>x.exitCode===0));
const manifest={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceSha256:await hash(component),paired:6,afterStates:14,actionChecks:5,qualityChecks:quality.checks.length,images:[]};
for(const [mode,record] of [['before',before],[process.argv[2]?.startsWith('combined')?'combined':'after',after]])for(const capture of record.captures){
 const file=`${mode}-${capture.label}.png`;manifest.images.push({file,sha256:await hash(base+file)});
}
await writeFile(base+'evidence-verification.json',JSON.stringify(manifest,null,2),'utf8');
console.log('Verified 6 matched pairs, 14 after states, 5 real action checks and all source-pinned quality checks.');
