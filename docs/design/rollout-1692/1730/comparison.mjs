import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const repo=process.cwd(),backup=resolve('.tmp/1730/comparison'),out=resolve('docs/design/rollout-1692/1730/comparison-source.json'),command=process.argv[2];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const paths=['apps/webapp/src/app/[locale]/(app)/personnel-files/document-requests/page.tsx','apps/webapp/src/components/personnel-file/document-requests-overview.tsx','apps/webapp/src/components/personnel-file/bulk-document-requests-dialog.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
if(command==='prepare') {
 await mkdir(backup,{recursive:true});const manifest={historical:'9847f784dfcdca922fd41936493ea07d4b896675',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),qualification:'Only historical page/overview/bulk consumers and their heading opt-in are replaced; current app/shared foundations/dependencies remain.',files:[],restored:false};
 for(const [index,path] of paths.entries()) {
  const current=await readFile(path);await writeFile(join(backup,index+'.bin'),current);
  const before=path.endsWith('route-metadata.ts')?Buffer.from(current.toString().replace(/\s*path === "\/personnel-files\/document-requests" \|\|/,'') ):execFileSync('git',['show',manifest.historical+':'+path]);
  manifest.files.push({path,backupSha256:hash(current),historicalSha256:hash(before),historicalCanonicalLfSha256:hash(before.toString().replaceAll('\r\n','\n'))});await writeFile(path,before);
 }
 await writeFile(out,JSON.stringify(manifest,null,2)+'\n');console.log('Prepared exact historical consumers after owned Next stop.');
} else if(command==='restore') {
 const manifest=JSON.parse(await readFile(out,'utf8'));
 for(const[index,entry]of manifest.files.entries()){const bytes=await readFile(join(backup,index+'.bin'));assert.equal(hash(bytes),entry.backupSha256);await writeFile(entry.path,bytes);entry.restoredSha256=hash(await readFile(entry.path));}
 manifest.restored=true;await writeFile(out,JSON.stringify(manifest,null,2)+'\n');console.log('Restored every current consumer byte for byte after owned Next stop.');
} else throw Error('prepare or restore required');
