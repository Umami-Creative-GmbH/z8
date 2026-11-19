import {createRequire} from 'node:module';import {readFile,writeFile,stat} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(resolve('apps/webapp/package.json'));const ExcelJS=require('exceljs'),Papa=require('papaparse');
const csv=Papa.parse(await readFile('docs/design/rollout-1692/1737/actual.csv','utf8'),{skipEmptyLines:true}).data;
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await readFile('docs/design/rollout-1692/1737/actual.xlsx'));const rows=[];workbook.worksheets.forEach(sheet=>sheet.eachRow(row=>rows.push(row.values.slice(1))));
for(const data of [csv,rows]){
 const total=data.find(row=>row[0]==='Total');assert.deepEqual(total.slice(3).map(Number),[101,46,0,0,0,0,0,0,0,0,0,0,147]);
 const van=data.find(row=>row[0]==='Archived fixture van (archived)');assert.equal(van[1],'FIX-1737');assert.equal(van[2],'Person 0');assert.deepEqual(van.slice(3).map(Number),[101,17,0,0,0,0,0,0,0,0,0,0,118]);
 const own=data.find(row=>row[0]==='Own vehicle');assert.deepEqual(own.slice(3).map(Number),[0,29,0,0,0,0,0,0,0,0,0,0,29]);
 assert(data.some(row=>row[0]==='Period'&&String(row[1]).includes('2026')));assert(data.some(row=>row[0]==='Generated on'&&row[1]));
}
await writeFile('docs/design/rollout-1692/1737/download-parity.json',JSON.stringify({at:new Date().toISOString(),csvBytes:(await stat('docs/design/rollout-1692/1737/actual.csv')).size,xlsxBytes:(await stat('docs/design/rollout-1692/1737/actual.xlsx')).size,passed:['147 whole km','January 101 / February 46; March 0 despite UTC March start','archived van identity, plate, employee and 118 total','own vehicle row 29','all 12 month columns and zeros','period and captured generated timestamp'],csvRows:csv,excelRows:rows},null,2)+'\n');console.log('Actual CSV and Excel parsed; exact monthly, vehicle, employee, scope and totals parity passed.');
