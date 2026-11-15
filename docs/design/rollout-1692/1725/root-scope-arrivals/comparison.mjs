import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const path='apps/webapp/src/components/payroll/payroll-workspace.tsx',baseline='37e46ce8bea19e69e112d11186e0c271d77e9738';
const saved=await readFile(path),before=execFileSync('git',['show',baseline+':'+path]),hash=bytes=>createHash('sha256').update(bytes).digest('hex');await mkdir('.tmp/1725-root-runtime',{recursive:true});
await writeFile('.tmp/1725-root-runtime/comparison-source.json',JSON.stringify({baseline,overlay:[path],qualification:'Only the owned workspace presentation/lifetime file is overlaid. The new organization identity remains in the actual server summary in both phases; this is not a historical full-app execution.',beforeSha256:hash(before),afterSha256:hash(saved)},null,2)+'\n');
const run=phase=>new Promise((done,reject)=>{const pnpm=process.env.npm_execpath,exe=pnpm.endsWith('.exe')?pnpm:process.execPath,args=['node','.tmp/1725-root-runtime.mjs',process.argv[2],phase];const child=spawn(exe,exe===process.execPath?[pnpm,...args]:args,{windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('close',done);});
try{await writeFile(path,before);console.log('Baseline exit: '+await run('before'));}finally{assert.equal(hash(await readFile(path)),hash(before),'Concurrent owned source edit');await writeFile(path,saved);}
const code=await run('after');console.log('Correction exit: '+code);process.exitCode=code;
