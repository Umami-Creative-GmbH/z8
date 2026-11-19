// Warm matched consumer-source comparison in the same owned runtime. Swaps only
// this ticket's known source files; preserves every byte in finally. No git reset.
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const repo=process.cwd(),base='273320a9376b4deb60b57ba3882fc17b37ae308a';
const files=['apps/webapp/src/app/[locale]/(app)/equipment/page.tsx',...['equipment-overview.tsx','equipment-assignments-card.tsx','equipment-header-actions.tsx','equipment-loading.tsx'].map(f=>'apps/webapp/src/components/equipment/'+f),'apps/webapp/src/lib/navigation/route-metadata.ts'];
const saved=new Map();for(const file of files)saved.set(file,await readFile(join(repo,file)));
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const run=phase=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(repo,'docs/design/rollout-1692/1717/capture.mjs'),process.argv[2],phase],{cwd:repo,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),stdio:'inherit',windowsHide:true});child.on('exit',code=>code===0?resolve():reject(Error('Capture failed '+phase)));});
const out=join(repo,'docs/design/rollout-1692/1717');
for(const phase of ['before','after'])await copyFile(join(out,phase+'.json'),join(out,'initial-'+phase+'.json'),1).catch(error=>{if(error.code!=='EEXIST')throw error;});
try{
 for(const [file,buffer] of saved){const source=file.endsWith('route-metadata.ts')?Buffer.from(buffer.toString('utf8').replace(/\s*path === "\/equipment" \|\|/,'')):execFileSync('git',['show',`${base}:${file}`],{maxBuffer:4*1024*1024});await writeFile(join(repo,file),source);}
 await run('before');
}finally{for(const [file,buffer] of saved)await writeFile(join(repo,file),buffer);}
await run('after');
const restored=[];for(const [file,buffer] of saved){assert.deepEqual(await readFile(join(repo,file)),buffer);restored.push({file,sha256:createHash('sha256').update(buffer).digest('hex')});}
await writeFile(join(out,'comparison.json'),JSON.stringify({base,method:'Exact owned consumer sources; current shared shell retained; same synthetic actor, organization and post-action data; source restored byte-for-byte',restored},null,2));
