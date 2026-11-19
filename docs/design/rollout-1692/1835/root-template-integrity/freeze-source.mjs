import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
const out='.tmp/1835-root-checks',json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\ufeff/,''));
const unit=await json(out+'/unit.json');assert.equal(unit.numFailedTests,0);assert.equal(unit.numPendingTests,0);assert.equal(unit.numPassedTests,383);assert.equal(unit.testResults.length,30);
const pg=await json(out+'/pg-all.json');assert.equal(pg.numFailedTests,0);assert.equal(pg.numPendingTests,0);assert.equal(pg.numPassedTests,13);assert.equal(pg.testResults.length,1);
const expected=(await json(out+'/unit-command.json')).sourcePins,current={};assert.equal(Object.keys(expected).length,9);
for(const path of Object.keys(expected))current[path]=createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex');
const mismatches=[];for(const name of ['unit','types','lint','format','doctor','pg-all']){const command=await json(out+'/'+name+'-command.json');assert.equal(command.exitCode,0,name);for(const[path,pin]of Object.entries(command.sourcePins))if(current[path]!==pin)mismatches.push({command:name,path});}
if(mismatches.length){console.log(JSON.stringify({mismatches}));process.exitCode=1;}else{
 const doctor=await json(out+'/doctor.json');assert.equal(doctor.summary.errorCount,0);assert.equal(doctor.summary.warningCount,0);
 await writeFile(out+'/source-pins.json',JSON.stringify({sourcePins:current,unit:{physicalFiles:30,cases:383},postgres:{physicalFiles:1,cases:13},doctor:{errors:0,warnings:0},allCommandPinsMatch:true,qualification:'Dirty provisional revision fields are not source declarations; exact canonical pins identify the tested correction. Retained service formatting qualification is separate.'},null,2)+'\n');console.log(JSON.stringify({passed:true,sourceFiles:9,unitCases:383,postgresCases:13}));
}
