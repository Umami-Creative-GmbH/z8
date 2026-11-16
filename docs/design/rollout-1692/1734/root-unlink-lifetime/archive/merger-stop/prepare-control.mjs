import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const parent='a904b3d19815bd511c67514fb48078cd4aec262f',root=process.cwd(),out=path.join(root,'.tmp/merge1734-audit'),bridge=path.join(root,'apps/webapp/src/.tmp');
const files={overview:'apps/webapp/src/components/personnel-file/sick-leave-overview.tsx',panel:'apps/webapp/src/components/absences/sick-notes/absence-sick-notes-panel.tsx'};
const manifest=[];
for(const [kind,p] of Object.entries(files)){
 const raw=execFileSync('git',['show',parent+':'+p],{maxBuffer:8*1024*1024,windowsHide:true});fs.writeFileSync(path.join(out,`parent-${kind}.raw.tsx`),raw);
 let source=raw.toString();
 if(kind==='overview')source=source.replaceAll('"@/components/absences/sick-notes/absence-sick-notes-panel"','"./parent-panel"').replaceAll('"./document-labels"','"@/components/personnel-file/document-labels"');
 if(kind==='panel')source=source.replaceAll('"./attach-sick-note-dialog"','"@/components/absences/sick-notes/attach-sick-note-dialog"');
 fs.writeFileSync(path.join(out,`parent-${kind}.tsx`),source);fs.writeFileSync(path.join(bridge,`parent-${kind}.tsx`),source);
 manifest.push({parent,path:p,rawSha256:crypto.createHash('sha256').update(raw).digest('hex'),adaptedSha256:crypto.createHash('sha256').update(source).digest('hex'),adaptation:'Import destinations only; parent product logic unchanged'});
}
fs.writeFileSync(path.join(out,'control-source.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(manifest);
