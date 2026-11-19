import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const path='apps/webapp/src/components/payroll/payroll-workspace.tsx';
const saved=await readFile(path),before=execFileSync('git',['show','37e46ce8bea19e69e112d11186e0c271d77e9738:'+path]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 await writeFile(path,before);
 const args=['--filter','webapp','exec','vitest','run','--project','unit','src/components/payroll/payroll-workspace.test.tsx','-t','scope leaves and returns','--maxWorkers','1','--reporter=json','--outputFile=../../.tmp/1725-root-checks/boundary-matrix-red.json'];
 const pnpm=process.env.npm_execpath,exe=pnpm.endsWith('.exe')?pnpm:process.execPath;
 const status=await new Promise((done,reject)=>{const child=spawn(exe,exe===process.execPath?[pnpm,...args]:args,{windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('close',done);});
 assert.equal(status,1,'Expected meaningful old-boundary failures');
}finally{assert.equal(hash(await readFile(path)),hash(before),'Concurrent owned source edit');await writeFile(path,saved);}
console.log('Restored the exact correction after old-boundary regression matrix.');
