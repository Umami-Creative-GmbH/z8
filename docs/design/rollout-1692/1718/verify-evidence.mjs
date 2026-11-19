import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const json=async name=>JSON.parse(await readFile(new URL(name+'.json',import.meta.url),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const names=(await readdir(new URL('.',import.meta.url))).filter(n=>n.endsWith('.json'));
let observations=0;
for(const name of names){
 const run=await json(name.slice(0,-5));if(!run.identity)continue;observations++;
 assert.match(run.identity.head,/^[a-f0-9]{40}$/);
 for(const [file,sha]of Object.entries(run.identity.hashes)){
  const version=run.identity.override?.baseline??run.identity.head;
  const bytes=execFileSync('git',['show',`${version}:${file}`],{cwd:repo});
  const lf=bytes.toString('utf8').replace(/\r\n/g,'\n');
  assert.ok([hash(Buffer.from(lf)),hash(Buffer.from(lf.replace(/\n/g,'\r\n')))].includes(sha),`${name}: ${file} source provenance`);
 }
}
for(const variant of ['desktop-light','phone-light','wide-dark']){
 const before=(await json('before-'+variant)).observation,after=(await json('after-'+variant)).observation;
 assert.equal(before.scope,after.scope);assert.equal(before.url,after.url);assert.deepEqual(before.viewport,after.viewport);assert.equal(before.dark,after.dark);assert.equal(before.font,after.font);
 assert.deepEqual(before.headings,['Equipment','EQ-HELD']);assert.deepEqual(after.headings,['EQ-HELD']);
 assert.equal(before.documentWidth,before.viewport.width);assert.equal(after.documentWidth,after.viewport.width);
 for(const row of ['Issued quantity\n1','Physically received quantity\n0','Outstanding quantity\n1','Nov 1, 2026','SERIAL-EQ-HELD']){assert.ok(before.record.includes(row));assert.ok(after.record.includes(row));}
}
const phone=(await json('after-phone-light')).observation;
assert.ok(phone.holder.y<phone.receipt.y&&phone.receipt.y<phone.history.y);
const failure=(await json('after-receipt-failure')).observation;
assert.equal(failure.dialog,true);assert.equal(failure.fields.find(f=>f.name==='notes').value,'R020 synthetic damaged return');assert.equal(failure.alerts.length,1);assert.deepEqual(failure.toasts,[]);
const receipt=(await json('after-damaged-receipt')).observation;
assert.equal(receipt.dialog,false);assert.ok(receipt.pointerEvents.some(e=>e.trusted&&e.button==='Record receipt'));assert.ok(receipt.record.includes('separate clearance before reissue'));
const amended=(await json('after-amended-evidence')).observation.record;
for(const value of ['R020 synthetic damaged return','R020 corrected evidence; damage remains','R020 signed return notes corrected'])assert.ok(amended.includes(value));
const recovery=(await json('after-linked-recovery')).observation.record;
for(const value of ['Physically received quantity\n3','Outstanding quantity\n0','Lost quantity\n1','Recovered quantity\n1','Physical recovery','Linked decision:'])assert.ok(recovery.includes(value));
const stale=(await json('after-stale-recovery')).observation;assert.equal(stale.dialog,true);assert.ok(stale.alerts[0].includes('This record changed'));
const authority=(await json('after-authority-loss')).observation;assert.equal(authority.dialog,true);assert.equal(authority.fields.find(f=>f.name==='reason').value,'R020 retained authority-loss draft');assert.ok(authority.alerts[0].includes('not authorized'));
for(const name of ['after-manager-refused','after-restricted-refused','after-other-org-feature-off','after-revoked-route'])assert.deepEqual((await json(name)).observation.headings,['Page not found']);
const employee=(await json('after-employee-role')).observation;assert.deepEqual(employee.headings,['EQ-HELD']);assert.ok(!employee.text.includes('Correct a record')&&!employee.text.includes('Place case hold'));
const drawer=(await json('after-current-route-first-escape')).observation;assert.equal(drawer.drawer,false);assert.equal(drawer.keys.length,1);assert.equal(drawer.keys[0].trusted,true);assert.equal(drawer.focus['data-slot'],'sidebar-trigger');
const preferences=(await json('after-phone-saved-large-dark')).observation;assert.equal(preferences.font,'18px');assert.equal(preferences.dark,true);assert.equal(preferences.sidebar,'false');assert.equal(preferences.documentWidth,390);
const pending=(await json('after-real-pending-guard')).observation;assert.equal(pending.dialog,true);assert.equal(pending.submitDisabled,true);assert.equal(pending.fields[0].disabled,true);assert.deepEqual(pending.keys.map(k=>k.key),['Enter','Enter','Escape']);assert.ok(pending.keys.every(k=>k.trusted));
const scope=(await json('after-switch-during-read')).observation;assert.equal(scope.priorObserved.refreshBusy,true);assert.equal(scope.oldRecordVisible,false);assert.deepEqual(scope.headings,['Page not found']);
const db=await json('persisted-readback'),laptop=db.find(x=>x.identifier==='EQ-HELD'),shirts=db.find(x=>x.type==='Fixture shirts');assert.equal(laptop.status,'unavailable');assert.equal(laptop.holds_placed,1);assert.equal(laptop.holds_released,1);assert.equal(laptop.amendments,1);assert.equal(laptop.handovers,2);assert.equal(shirts.quantity,3);assert.equal(shirts.received_quantity,3);assert.equal(shirts.lost_quantity,1);assert.equal(shirts.handovers,3);
const next=await json('next-final');assert.deepEqual(next.get_compilation_issues,{issues:[]});assert.deepEqual(next.get_errors,{configErrors:[],sessionErrors:[]});assert.equal(next.assignmentRouteListed,true);
const native=await json('native-react');assert.ok(native.components.every(c=>c.present));assert.equal(native.inspectionSuccess,true);
const sharp=createRequire(new URL('../../../../apps/webapp/package.json',import.meta.url))('sharp');
const pngs=(await readdir(new URL('.',import.meta.url))).filter(n=>n.endsWith('.png'));
for(const name of pngs){const {info}=await sharp(await readFile(new URL(name,import.meta.url))).raw().toBuffer({resolveWithObject:true});assert.ok(info.width>0&&info.height>0);}
console.log(`Verified ${observations} source-pinned observations, three matched pairs, action/readback/role/scope/pending/focus/preferences evidence and fully decoded ${pngs.length} PNGs. This validates the archive, not a fresh runtime run.`);
