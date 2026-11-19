import {readFile,writeFile,readdir,unlink,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {join,resolve} from 'node:path';
const root=resolve('.'),out=join(root,'docs/design/rollout-1692/1738'),sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(await readFile(join(out,'checks/source-36c60f925612dbdab3e9ba5b6166dd816325300ee4ebe124726dd230a3b7f51d.json'),'utf8'));
for(const [f,hash] of Object.entries(manifest.hashes))if(sha(await readFile(join(root,f)))!==hash)throw Error('Final source drift: '+f);
const archive={};for(const f of await readdir('.tmp/1738'))if(/\.(log|txt)$/.test(f)&&f!=='agent-browser-guide.txt')archive[f]=(await readFile(join('.tmp/1738',f))).toString('base64');
const bytes=Buffer.from(JSON.stringify(archive));const zipped=gzipSync(bytes,{level:9});if(!gunzipSync(zipped).equals(bytes))throw Error('archive verification');await writeFile(join(out,'raw-exploratory-logs.json.gz'),zipped);
const compressed=[];for(const f of await readdir(join(out,'checks'))){if(!f.endsWith('.log')||f.startsWith('final-'))continue;const path=join(out,'checks',f);const bytes=await readFile(path);if(bytes.length<65536)continue;const zip=gzipSync(bytes,{level:9});if(!gunzipSync(zip).equals(bytes))throw Error('gzip verification');await writeFile(path+'.gz',zip);compressed.push({original:f,sha256:sha(bytes),bytes:bytes.length,archive:f+'.gz',archiveSha256:sha(zip)});await unlink(path);}
await writeFile(join(out,'compressed-logs.json'),JSON.stringify(compressed,null,2));
await writeFile(join(out,'doctor-final-diagnostics.json'),await readFile('.tmp/1738/doctor-final/diagnostics.json'));
const files=[];async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.isDirectory())await walk(p);else if(entry.name!=='artifact-manifest.json'){const bytes=await readFile(p);files.push({path:p.slice(out.length+1).replaceAll('\\','/'),bytes:bytes.length,sha256:sha(bytes)});}}}
await walk(out);await writeFile(join(out,'artifact-manifest.json'),JSON.stringify({sourceCommit:'b4f913b5fec05fc93897e5e6c8a9a11509f484f4',finalSourceVerified:true,exclusions:['artifact-manifest.json (self)','../1738.md (handoff prose, separate docs commit)'],files},null,2));console.log('Verified final source hashes; preserved and verified lossless logs; artifacts',files.length);
