import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const repo=process.cwd(),dir=resolve('.tmp/1744'),mode=process.argv[2];
const paths=['apps/webapp/src/app/[locale]/(app)/team/presence/[locationId]/page.tsx','apps/webapp/src/app/[locale]/(app)/team/presence/location-presence-list.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const proof=JSON.parse(await readFile(join(dir,mode==='before'?'baseline-server-stopped.json':'baseline-restopped.json'),'utf8'));assert.equal(proof.ownedNextStopped,true);assert.equal(proof.portClosed,true);
const r=JSON.parse(await readFile(join(dir,'fixture/runtime-private.json'),'utf8'));
let unavailable=false;try{await fetch(r.origin,{signal:AbortSignal.timeout(3000)});}catch{unavailable=true;}assert.ok(unavailable,'Owned server must be stopped before overlay');
const sha=b=>createHash('sha256').update(b).digest('hex');
if(mode==='before'){
 const entries=[];for(const path of paths){const actual=await readFile(join(repo,path));const before=execFileSync('git',['show','a5c7f741c0df6816e0e2b10290d79b7409fc606f:'+path],{maxBuffer:2000000});entries.push({path,afterBase64:actual.toString('base64'),afterSha256:sha(actual),beforeSha256:sha(before)});}
 await writeFile(join(dir,'overlay-private.json'),JSON.stringify(entries));for(const entry of entries){const before=execFileSync('git',['show','a5c7f741c0df6816e0e2b10290d79b7409fc606f:'+entry.path]);await writeFile(join(repo,entry.path),before);}
 await writeFile(join(dir,'overlay-public.json'),JSON.stringify({mode,scope:'exact three original consumers on current verified supporting code; unused new route-state files remain',entries:entries.map(({afterBase64,...entry})=>entry)},null,2));
}else if(mode==='restore'){
 const entries=JSON.parse(await readFile(join(dir,'overlay-private.json'),'utf8'));for(const entry of entries){assert.ok(paths.includes(entry.path));assert.equal(sha(await readFile(join(repo,entry.path))),entry.beforeSha256);await writeFile(join(repo,entry.path),Buffer.from(entry.afterBase64,'base64'));assert.equal(sha(await readFile(join(repo,entry.path))),entry.afterSha256);}
 await writeFile(join(dir,'overlay-restored.json'),JSON.stringify({byteExact:true,serverStopped:true,files:entries.map(entry=>({path:entry.path,sha256:entry.afterSha256}))},null,2));
}else throw Error('before or restore only');
console.log('Owned stopped-server source overlay '+mode+' verified.');
