import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,relative} from 'node:path';
import {createConnection} from 'node:net';
const root=resolve('.'),directory=resolve('.tmp/1749/overlay'),mode=process.argv[2];
const runtime=JSON.parse(await readFile('.tmp/1749/fixture/runtime-private.json','utf8'));
await new Promise((done,reject)=>{const socket=createConnection({host:'localhost',port:runtime.port});socket.once('connect',()=>{socket.destroy();reject(Error('Stop owned Next before source overlay'))});socket.once('error',()=>done());});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(directory,{recursive:true});
if(mode==='before'){
 // Freeze the eleven historical consumers actually exercised; later unrelated changes are excluded.
 const paths=JSON.parse(await readFile('docs/design/rollout-1692/1749/source-overlay.json','utf8')).files.map(file=>file.path);
 const manifest=[];
 for(const [index,path] of paths.entries()){
  const current=await readFile(path),before=execFileSync('git',['show',`89fe7fd5b6c1cdd155f7b503fb5534a673a89d72:${path}`]);
  await writeFile(join(directory,`${index}.bin`),current);manifest.push({path,index,sha256:digest(current),beforeSha256:digest(before)});
 }
 await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
 for(const file of manifest)await writeFile(file.path,execFileSync('git',['show',`89fe7fd5b6c1cdd155f7b503fb5534a673a89d72:${file.path}`]));
 console.log(`Installed ${manifest.length} exact historical production consumers; partial historical application only`);
}else if(mode==='restore'){
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 for(const file of manifest){const absolute=resolve(file.path);if(relative(root,absolute).startsWith('..'))throw Error('Outside own checkout');const bytes=await readFile(join(directory,`${file.index}.bin`));if(digest(bytes)!==file.sha256)throw Error('Backup mismatch');await writeFile(absolute,bytes);if(digest(await readFile(absolute))!==file.sha256)throw Error('Restore mismatch');}
 await writeFile('.tmp/1749/overlay-restored.json',JSON.stringify({restored:true,files:manifest},null,2));console.log('Byte-exact current source restored');
}else throw Error('before or restore');
