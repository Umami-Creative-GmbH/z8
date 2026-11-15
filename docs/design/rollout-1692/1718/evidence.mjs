import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const repo=process.cwd(),out=join(repo,'docs/design/rollout-1692/1718'),scratch=join(repo,'.tmp/1718/source');
const files=['apps/webapp/src/components/equipment/equipment-assignment-detail.tsx','apps/webapp/src/components/equipment/equipment-loading.tsx','apps/webapp/src/lib/navigation/route-metadata.ts','apps/webapp/src/app/[locale]/(app)/equipment/assignments/[assignmentId]/page.tsx'];
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',windowsHide:true}).trim();
const [command,name,capture,encoded]=process.argv.slice(2);
if(command==='before'){
 assert.equal(git('diff','--name-only','--',...files),'','Commit owned sources before comparison');await mkdir(scratch,{recursive:true});
 for(const [i,f]of files.entries()){await copyFile(f,join(scratch,String(i)));await writeFile(f,execFileSync('git',['show',`${name}:${f}`]),'utf8');}
 await writeFile(join(scratch,'override.json'),JSON.stringify({baseline:name,files},null,2),'utf8');
}else if(command==='restore'){
 for(const [i,f]of files.entries()){await copyFile(join(scratch,String(i)),f);assert.equal(createHash('sha256').update(await readFile(f)).digest('hex'),createHash('sha256').update(await readFile(join(scratch,String(i)))).digest('hex'));}
 await writeFile(join(scratch,'override.json'),'null','utf8');
}else if(command==='record'){
 assert.match(name,/^[a-z0-9-]+$/);const observation=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
 let override=null;try{override=JSON.parse(await readFile(join(scratch,'override.json'),'utf8'));}catch{}
 const identity={head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),override,hashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])))};
 if(capture!=='none')await copyFile(resolve(capture),join(out,name+'.png'));
 await writeFile(join(out,name+'.json'),JSON.stringify({identity,observation},null,2)+'\n','utf8');console.log('Recorded '+name+' at actual HEAD '+identity.head);
}else throw Error('before <baseline> | restore | record <name> <PNG or none> <base64 JSON observation>');
