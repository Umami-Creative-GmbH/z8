// pnpm node docs/design/rollout-1692/1703/verify-evidence.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
const dir=resolve('docs/design/rollout-1692/1703');
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const before=await json('before-runtime.json'),after=await json('after-runtime.json');
assert.equal(before.scope,after.scope);assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);
for(let i=0;i<3;i++){
 const a=before.checks[i],b=after.checks[i];assert.equal(a.name,b.name);assert.equal(a.width,a.documentWidth);assert.equal(b.width,b.documentWidth);assert.equal(a.width,b.width);assert.equal(a.h1.length,3);assert.deepEqual(b.h1,['Overtime Burn-Down']);
 for(const x of [a,b])for(const label of ['Fixture team 0','Fixture team 1','Previous Overtime','0.0h'])assert.ok(x.main.includes(label));
 const size=async mode=>{const png=await readFile(join(dir,`${mode}-${a.name}.png`));return [png.readUInt32BE(16),png.readUInt32BE(20)];};assert.deepEqual(await size('before'),await size('after'));
}
const actions=await json('actions-runtime.json');assert.deepEqual(actions.errors,[]);assert.equal(actions.observations.filter(x=>x.grouping).length,3);assert.equal(actions.observations.filter(x=>x.actor).length,3);
const boundaries=await json('boundaries-runtime.json');assert.deepEqual(boundaries.errors,[]);assert.equal(boundaries.organizationSwitch.destination.stale,false);assert.deepEqual(boundaries.organizationSwitch.destination.headings,['Overtime Burn-Down','Access Restricted']);
const csv=await readFile(join(dir,'actual-filtered-export.csv'),'utf8');assert.ok(csv.includes('Fixture team 0'));assert.ok(!csv.includes('Fixture team 1'));
const ExcelJS=createRequire(resolve('apps/webapp/package.json'))('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await readFile(join(dir,'actual-filtered-export.xlsx')));const sheet=book.worksheets[0];assert.deepEqual(sheet.getRow(1).values.slice(1),['Team','Current Overtime','Previous Overtime','Week-over-Week','Trend Direction']);assert.deepEqual(sheet.getRow(2).values.slice(1),['Fixture team 0',0,0,0,'Flat']);assert.equal(sheet.rowCount,2);
const next=await json('next-final-runtime.json');const values=next.map(x=>JSON.parse(x.result.result.content[0].text));assert.deepEqual(values,[{issues:[]},{configErrors:[],sessionErrors:[]}]);
console.log('Verified matched loaded scope/PNG sizes, headings, real grouping/roles/security results, parsed CSV/XLSX scope and final connected Next diagnostics.');
