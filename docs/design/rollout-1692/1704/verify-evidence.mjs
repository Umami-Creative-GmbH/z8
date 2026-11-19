// pnpm node docs/design/rollout-1692/1704/verify-evidence.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
const dir=resolve('docs/design/rollout-1692/1704');const json=async f=>JSON.parse((await readFile(join(dir,f),'utf8')).replace(/^\uFEFF/,''));
const before=await json('before-runtime.json'),after=await json('after-runtime.json');assert.equal(before.scope,after.scope);
for(const observation of [before,after]){assert.deepEqual(observation.errors,[]);for(const check of observation.checks){assert.equal(check.width,check.documentWidth);for(const label of ['Fixture team 0','Fixture team 1','Team Comparison','Team Performance Details','Avg per Employee','Employee Count','Status','On Track','Overtime & Undertime'])assert.ok(check.main.includes(label),label);assert.ok(!check.main.includes('No Team'));for(const name of ['Person 0','Person 7'])if(check.width>1000)assert.ok(check.main.includes(name));}}
for(const check of before.checks)assert.deepEqual(check.h1,['Analytics','Analytics']);for(const check of after.checks){assert.deepEqual(check.h1,['Team Performance']);assert.ok(check.main.includes('8,352.0h'));assert.ok(check.main.includes('2,088.0h'));}
const actions=await json('actions-runtime.json');assert.deepEqual(actions.errors,[]);assert.equal(actions.observations.filter(x=>x.actor).length,3);assert.equal(actions.observations.filter(x=>x.export).length,2);
const boundaries=await json('boundaries-runtime.json');assert.deepEqual(boundaries.errors,[]);assert.equal(boundaries.organizationSwitch.destination.stale,false);assert.deepEqual(boundaries.organizationSwitch.destination.headings,['Team Performance','Access Restricted']);
const ExcelJS=createRequire(resolve('apps/webapp/package.json'))('exceljs');const xlsx=new ExcelJS.Workbook();await xlsx.xlsx.load(await readFile(join(dir,'actual-export.xlsx')));const csv=new ExcelJS.Workbook();const csvSheet=await csv.csv.read(Readable.from([await readFile(join(dir,'actual-export.csv'))]));
for(const sheet of [xlsx.worksheets[0],csvSheet]){assert.equal(sheet.rowCount,3);assert.deepEqual(sheet.getRow(1).values.slice(1),['Team','Total Hours','Avg per Employee','Employee Count']);assert.deepEqual([sheet.getRow(2).values.slice(1),sheet.getRow(3).values.slice(1)].sort((a,b)=>a[0].localeCompare(b[0])),[['Fixture team 0',8352,2088,4],['Fixture team 1',8352,2088,4]]);}
const native=await json('react-runtime.json');assert.equal(native.treeSuccess,true);assert.equal(native.inspectSuccess,true);assert.ok(native.inspect.includes('timezone: "Europe/Berlin"'));
const next=await json('next-final-runtime.json');assert.deepEqual(next.map(x=>JSON.parse(x.result.result.content[0].text)),[{issues:[]},{configErrors:[],sessionErrors:[]}]);
const lifetime=await json('export-lifetime-runtime.json');assert.equal(lifetime.oldPeriod.downloadCount,0);assert.equal(lifetime.currentPeriod.downloadCount,1);
console.log('Verified matched real loaded scope and all prior fields/sections, single task heading, roles/security, CSV/XLSX values, native React evidence, final connected Next diagnostics and export lifetime.');
