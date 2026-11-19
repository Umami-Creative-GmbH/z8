import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const paths=['apps/webapp/src/app/[locale]/(app)/organization/org-explorer-client.tsx','apps/webapp/src/app/[locale]/(app)/organization/use-org-explorer-people.ts'];
const base='11ad20e2251742960e6ccf3db17b1227ca3f17da',hash=bytes=>createHash('sha256').update(bytes).digest('hex');await mkdir('.tmp/1724-root-runtime',{recursive:true});
const files=await Promise.all(paths.map(async path=>({path,saved:await readFile(path),before:execFileSync('git',['show',base+':'+path])})));
await writeFile('.tmp/1724-root-runtime/comparison-source.json',JSON.stringify({baselineCommit:base,scope:'Two owned client/loader sources only; all other integrated code remains current',files:files.map(({path,saved,before})=>({path,beforeSha256:hash(before),afterSha256:hash(saved)}))},null,2)+'\n');
const run=phase=>new Promise((resolve,reject)=>{const pnpm=process.env.npm_execpath,exe=pnpm.endsWith('.exe')?pnpm:process.execPath,args=['node','.tmp/1724-root-runtime.mjs',process.argv[2],phase];const child=spawn(exe,exe===process.execPath?[pnpm,...args]:args,{windowsHide:true,stdio:'inherit',env:process.env});child.once('error',reject);child.once('close',resolve);});
try{for(const file of files)await writeFile(file.path,file.before);console.log('Baseline runtime exit: '+await run('before'));}
finally{for(const file of files){assert.equal(hash(await readFile(file.path)),hash(file.before),'Concurrent owned source edit');await writeFile(file.path,file.saved);}}
const status=await run('after');console.log('Corrected runtime exit: '+status);process.exitCode=status;
