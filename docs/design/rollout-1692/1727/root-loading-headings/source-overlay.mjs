import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const files=['apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.tsx','apps/webapp/src/components/payroll/employee-balance-workspace.tsx'];
const base='111dc9e50908ec7f8c478b97c5a96f809b696c0a',out='.tmp/1727-root-checks/';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),'fix/1727-work-balance-loading-headings');
if(process.argv[2]==='before'){
 const pins=[];
 for(const[index,path]of files.entries()){
  const after=await readFile(path),before=execFileSync('git',['show',base+':'+path]);
  assert.notEqual(sha(after),sha(before));await writeFile(out+'after-'+index+'.tsx.txt',after);await writeFile(out+'before-'+index+'.tsx.txt',before);
  pins.push({path,before:sha(before),after:sha(after)});
 }
 await writeFile(out+'source-overlay.json',JSON.stringify({base,pins,scope:'Two exact consumers over current infrastructure; new heading module is present but unused before'},null,2)+'\n');
 for(const[index,path]of files.entries())await writeFile(path,await readFile(out+'before-'+index+'.tsx.txt'));
}else if(process.argv[2]==='restore'){
 const {pins}=JSON.parse(await readFile(out+'source-overlay.json','utf8'));
 for(const pin of pins)assert.equal(sha(await readFile(pin.path)),pin.before,'Unexpected intervening edit '+pin.path);
 for(const[index,pin]of pins.entries()){const bytes=await readFile(out+'after-'+index+'.tsx.txt');assert.equal(sha(bytes),pin.after);await writeFile(pin.path,bytes);}
}else throw Error('Use before or restore');
console.log('Applied the guarded two-consumer overlay.');
