import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const path='apps/webapp/src/components/organization-mfa/verification.tsx',saved=await readFile(path);
const baseline=execFileSync('git',['show','877b12279ec992cf282e0ba775ac4849579aef86:'+path]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await writeFile('.tmp/1826-root-runtime/comparison-source.json',JSON.stringify({baselineCommit:'877b12279ec992cf282e0ba775ac4849579aef86',path,beforeSha256:hash(baseline),afterSha256:hash(saved),scope:'Only this owned MFA consumer replaced; all other app bytes stay fixed'},null,2)+'\n');
const run=phase=>new Promise((resolve,reject)=>{const executable=process.env.npm_execpath.endsWith('.exe')?process.env.npm_execpath:process.execPath;const args=['node','docs/design/rollout-1692/1826/root-continuations/runtime.mjs',process.argv[2],phase];const child=spawn(executable,executable===process.execPath?[process.env.npm_execpath,...args]:args,{env:process.env,windowsHide:true,stdio:'inherit'});child.once('error',reject);child.once('close',resolve);});
try{await writeFile(path,baseline);const status=await run('before');console.log('Baseline runtime exit: '+status);}
finally{assert.equal(hash(await readFile(path)),hash(baseline),'Owned source changed concurrently; refusing restore');await writeFile(path,saved);}
assert.equal(hash(await readFile(path)),hash(saved));
const status=await run('after');console.log('Corrected runtime exit: '+status);process.exitCode=status;
