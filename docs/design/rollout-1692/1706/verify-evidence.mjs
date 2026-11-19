// Offline assertions for reviewed synthetic runtime artifacts.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {join,resolve} from 'node:path';
const dir=resolve('docs/design/rollout-1692/1706');
const json=async f=>JSON.parse((await readFile(join(dir,f),'utf8')).replace(/^\uFEFF/,''));
const before=await json('before-runtime.json'),after=await json('after-runtime.json');assert.equal(before.scope,after.scope);
const dimensions=[];
for(const observation of [before,after]) {
 assert.deepEqual(observation.errors,[]);
 for(const c of observation.checks){assert.equal(c.width,c.documentWidth);assert.deepEqual(c.h1,observation.mode==='before'?['Analytics','Analytics']:['Work Hours']);for(const label of ['Person 0','Person 7','Total Hours','Expected Hours','Variance','Status','40h/wk','Daily Work Hours','Overtime & Undertime Trend','Employee Work Hours','Work Hours Distribution'])assert.ok(c.main.includes(label),label);const bytes=await readFile(join(dir,observation.mode+'-'+c.name+'.png'));dimensions.push({mode:observation.mode,layout:c.name,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)});}
}
const actions=await json('actions-runtime.json');assert.deepEqual(actions.errors,[]);assert.equal(actions.observations.filter(o=>o.actor).length,3);assert.equal(actions.observations[0].rows.length,8);
const ExcelJS=createRequire(resolve('apps/webapp/package.json'))('exceljs');const xlsx=new ExcelJS.Workbook();await xlsx.xlsx.load(await readFile(join(dir,'actual-export.xlsx')));const csv=new ExcelJS.Workbook();const sheet=await csv.csv.read(Readable.from([await readFile(join(dir,'actual-export.csv'))]));
for(const s of [xlsx.worksheets[0],sheet]){assert.equal(s.rowCount,9);assert.deepEqual(s.getRow(1).values.slice(1),['Employee','Total Hours','Overtime Hours','Undertime Hours','Avg Hours/Week']);const rows=[];s.eachRow((row,index)=>{if(index>1)rows.push(row.values.slice(1));});assert.deepEqual(rows.sort((a,b)=>a[0].localeCompare(b[0])),Array.from({length:8},(_,i)=>['Person '+i,2088,0,0,40]));}
const customBook=new ExcelJS.Workbook();const customSheet=await customBook.csv.read(Readable.from([await readFile(join(dir,'actual-custom-export.csv'))]));assert.equal(customSheet.rowCount,9);const customRows=[];customSheet.eachRow((row,index)=>{if(index>1)customRows.push(row.values.slice(1));});assert.deepEqual(customRows.sort((a,b)=>a[0].localeCompare(b[0])),Array.from({length:8},(_,i)=>['Person '+i,16,0,0,40]));
const recovery=await json('export-recovery-runtime.json');assert.equal(recovery.failedTransport.downloads,0);assert.equal(recovery.retry.downloads,1);assert.equal(recovery.retry.rows,8);
const boundaries=await json('boundaries-runtime.json');assert.deepEqual(boundaries.errors,[]);assert.equal(boundaries.organizationSwitch.destination.stale,false);assert.deepEqual(boundaries.organizationSwitch.destination.headings,['Work Hours','Access Restricted']);
const journeys=await json('route-journeys-runtime.json');assert.deepEqual(journeys.errors,[]);assert.equal(journeys.dailyRows,261);assert.equal(journeys.customRows.length,8);assert.equal(journeys.navigation.title,'Work Hours');assert.equal(journeys.browserZone,'America/Los_Angeles');
for(const f of ['export-lifetime-runtime.json','export-roundtrip-runtime.json']){const r=await json(f);assert.equal(r.oldPeriod.downloadCount,0);assert.equal(r.currentPeriod.downloadCount,1);}
const native=await json('react-runtime.json');assert.equal(native.treeSuccess,true);assert.equal(native.inspectSuccess,true);assert.ok(native.inspect.includes('Europe/Berlin'));
const axe=await json('a11y-runtime.json');assert.equal(axe.counts.violations,0);
const next=await json('next-final-runtime.json');assert.deepEqual(next.map(x=>JSON.parse(x.result.result.content[0].text)),[{issues:[]},{configErrors:[],sessionErrors:[]}]);
await writeFile(join(dir,'capture-dimensions.json'),JSON.stringify(dimensions,null,2)+'\n');
console.log('Verified matched fixture capability coverage, parsed original exports, roles/scopes, period and native React/Next diagnostics. PNG dimensions recorded separately.');
