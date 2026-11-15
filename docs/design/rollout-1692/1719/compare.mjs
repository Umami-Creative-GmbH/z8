// Source comparison only, current shared shell retained. Restore exact bytes in finally.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const repo=process.cwd(),base='f780ef50207e9415c16a87d44c769b94602cc528';
const files=['apps/webapp/src/app/[locale]/(app)/equipment/employees/[employeeId]/page.tsx','apps/webapp/src/components/equipment/equipment-employee.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const saved=new Map();for(const file of files)saved.set(file,await readFile(join(repo,file)));
const allowed=/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const run=phase=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(repo,'docs/design/rollout-1692/1719/capture.mjs'),process.argv[2],phase],{cwd:repo,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.test(key))),stdio:'inherit',windowsHide:true});child.on('exit',code=>code===0?resolve():reject(Error('Capture failed '+phase)));});
try{
 for(const [file,buffer] of saved){const source=file.endsWith('route-metadata.ts')?Buffer.from(buffer.toString('utf8').replace(/\s*\/\^\\\/equipment\\\/employees\\\/\[\^\/\]\+\$\/\.test\(path\) \|\|/,'')):execFileSync('git',['show',`${base}:${file}`],{maxBuffer:4*1024*1024});if(file.endsWith('route-metadata.ts'))assert.notDeepEqual(source,buffer);await writeFile(join(repo,file),source);}
 await run('before');
}finally{for(const [file,buffer] of saved)await writeFile(join(repo,file),buffer);}
await run('after');
const restored=[];for(const [file,buffer] of saved){assert.deepEqual(await readFile(join(repo,file)),buffer);restored.push({file,sha256:createHash('sha256').update(buffer).digest('hex')});}
const observations=await Promise.all(['before','after'].map(async p=>JSON.parse(await readFile(join(repo,'docs/design/rollout-1692/1719',p+'.json'),'utf8'))));
assert.equal(observations[0].actor,observations[1].actor);assert.equal(observations[0].holder,observations[1].holder);
for(let i=0;i<3;i++){assert.deepEqual(observations[0].observations[i].rows,observations[1].observations[i].rows);assert.equal(observations[0].observations[i].headings.length,2);assert.equal(observations[1].observations[i].headings.length,1);}
const sourceVersion=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceFiles=[...restored];for(const name of ['equipment-employee-header.tsx','equipment-employee-loading.tsx']){const file='apps/webapp/src/components/equipment/'+name;sourceFiles.push({file,sha256:createHash('sha256').update(await readFile(join(repo,file))).digest('hex')});}
await writeFile(join(repo,'docs/design/rollout-1692/1719/comparison.json'),JSON.stringify({base,sourceVersion,method:'Same fixture/holder/admin/scope/post-action records; only employee consumer sources and own heading opt-in replaced; current shared shell retained; exact byte restoration',restored,sourceFiles},null,2));
