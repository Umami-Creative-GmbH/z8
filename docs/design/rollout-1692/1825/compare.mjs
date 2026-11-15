// Consumer-source comparison only: F1/F2 and the same local fixture stay installed.
// pnpm node docs/design/rollout-1692/1825/compare.mjs <owned-private-fixture>
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const files=['apps/webapp/src/app/[locale]/(auth)/licenses/page.tsx','apps/webapp/src/components/licenses/license-table.tsx'];
const saved=await Promise.all(files.map(file=>readFile(file)));
const run=mode=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['docs/design/rollout-1692/1825/runtime.mjs',process.argv[2],mode],{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`runtime ${mode} exited ${code}`)));});
try {
 for(const file of files) await writeFile(file,execFileSync('git',['show',`1ab2a066a:${file}`],{maxBuffer:1024*1024,windowsHide:true}));
 await run('before');
} finally {
 for(let i=0;i<files.length;i++){await writeFile(files[i],saved[i]);assert.deepEqual(await readFile(files[i]),saved[i]);}
}
await run('final');
