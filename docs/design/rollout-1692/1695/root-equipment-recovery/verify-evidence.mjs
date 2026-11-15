import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../../../../../',import.meta.url));
const json=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const lf=bytes=>Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'));
const baseline='f780ef50207e9415c16a87d44c769b94602cc528';
const implementation='6a9189f867c6349961511cd9bc4f4db77f51e9e1';
const names=['before-dev-indicator','before-toast','after-desktop-paired','after-desktop','after-phone','after-dev-indicator-limit'];
const runs=Object.fromEntries(await Promise.all(names.map(async name=>[name,await json(`${name}.json`)])));
for(const [name,run] of Object.entries(runs)) {
 assert.equal(run.sourceCommit,name.startsWith('before')?baseline:implementation);
 assert.deepEqual(run.errors,[]);
 assert.equal(Object.keys(run.sourceHashes).length,6);
 for(const [file,sha256] of Object.entries(run.sourceHashes)) {
  const captured=lf(execFileSync('git',['show',`${run.sourceCommit}:apps/webapp/${file}`],{cwd:repo}));
  assert.ok([hash(captured),hash(Buffer.from(captured.toString('utf8').replace(/\n/g,'\r\n')))].includes(sha256),`${name}/${file}: captured source hash`);
 }
}
for(const name of ['before-dev-indicator','before-toast']) {
 const run=runs[name];
 assert.equal(run.initialAssignments,0);assert.equal(run.finalAssignments,0);
 assert.equal(run.pointerCommandRequests,0);assert.equal(run.dialogAfterSettled,true);
 assert.equal(run.beforePointer.button.disabled,false);assert.ok(run.failure);
}
assert.equal(runs['before-dev-indicator'].beforePointer.hitChain[0].tag,'NEXTJS-PORTAL');
assert.equal(runs['before-toast'].beforePointer.hitChain[0].toast,true);
for(const name of ['after-desktop-paired','after-desktop','after-phone']) {
 const run=runs[name];
 assert.equal(run.pointerCommandRequests,1);assert.equal(run.finalAssignments,run.initialAssignments+1);
 assert.equal(run.dialogAfterSettled,false);assert.equal(run.beforePointer.button.disabled,false);
 assert.equal(run.beforePointer.buttonAtPoint,true);assert.equal(run.beforePointer.inlineAlerts.length,1);
 assert.deepEqual(run.beforePointer.toasts,[]);
 if(name==='after-desktop-paired') {assert.equal(run.initialAssignments,0);continue;}
 assert.equal(run.beforeClick.buttonAtPoint,true);
 assert.ok(run.pointerEvents.some(event=>event.trusted&&event.tag==='BUTTON'&&!event.toast));
 const {viewport,contrast,...presentation}=run.presentation;
 assert.ok(contrast>=4.5);
 for(const field of ['alert','button','heading']) {
  const rect=presentation[field];
  assert.ok(rect.x>=0&&rect.y>=0&&rect.right<=viewport.width&&rect.bottom<=viewport.height,`${name}/${field}: viewport bounds`);
 }
}
const phone=runs['after-phone'];
assert.equal(phone.presentation.dark,true);assert.equal(phone.presentation.font,'18px');
assert.deepEqual(phone.presentation.viewport,{width:390,height:844});
const limit=runs['after-dev-indicator-limit'];
assert.equal(limit.hover.hitChain[0].tag,'NEXTJS-PORTAL');
assert.equal(limit.pointerCommandRequests,0);assert.equal(limit.finalAssignments,limit.initialAssignments);assert.ok(limit.failure);
const next=await json('next-final.json');
assert.deepEqual(next.pageErrors,[]);assert.deepEqual(next.get_compilation_issues,{issues:[]});
assert.deepEqual(next.get_errors,{configErrors:[],sessionErrors:[]});
const quality=await json('quality.json');
assert.equal(quality.implementation,implementation);assert.equal(quality.fresh.unitFiles,14);assert.equal(quality.fresh.unitTests,125);
const sharp=createRequire(new URL('../../../../../apps/webapp/package.json',import.meta.url))('sharp');
const captures=(await readdir(new URL('.',import.meta.url))).filter(name=>name.endsWith('.png'));
assert.equal(captures.length,6);
for(const name of captures) {
 const {info}=await sharp(await readFile(new URL(name,import.meta.url))).raw().toBuffer({resolveWithObject:true});
 assert.ok(info.width>0&&info.height>0);
}
console.log('Verified six source-pinned observations, actual pointer/transport/readback, retained framework limit, contrast/bounds and clean final probes; fully decoded six PNGs. Artifact validation is not a fresh runtime run.');
