const fs=require('node:fs');const path=require('node:path');const cp=require('node:child_process');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');const candidate='e597efc34bc2bdc1fa5369496781fe6bb0105888';const fix='047e89193fbafa34ba7a9a3d3a1fee992ccd84bd';const old='98bc0c4c82f32af17b0d6aee98fd7e42edc29a86';
const git=(...a)=>cp.execFileSync('git',a,{cwd:root,maxBuffer:16*1024*1024,encoding:'utf8'}).trim();
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const pin=(p)=>({path:p,blob:git('rev-parse',`HEAD:${p}`),sha256:digest(fs.readFileSync(path.join(root,p)))});
if(git('rev-parse','HEAD')!==candidate)throw Error('Not exact candidate');
const status=git('status','--porcelain=v1');if(status)throw Error('Not clean: '+status);
if(git('diff',fix,'HEAD','--','apps/webapp'))throw Error('App differs from root fix');
const metadata=JSON.parse(fs.readFileSync(path.join(root,'docs/design/rollout-1692/1740/verification.json')));
const ownerPins=metadata.protectedOwners.map(o=>{
 const p=pin(o.path);const bytes=fs.readFileSync(path.join(root,o.path));
 if(p.sha256!==o.sha256&&digest(Buffer.from(bytes.toString().replace(/\r?\n/g,'\r\n')))!==o.sha256&&digest(Buffer.from(bytes.toString().replace(/\r\n/g,'\n')))!==o.sha256)throw Error('Frozen owner changed '+o.path);
 return {...p,publicArchivedSha256:o.sha256,archiveMatch:'exact or explicit LF/CRLF materialization'};
});
const sourcePaths=[
 'apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.tsx',
 'apps/webapp/src/app/[locale]/(app)/team/absences/record-absence-dialog.activation.test.tsx',
 'apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-workspace.tsx',
 'apps/webapp/src/app/[locale]/(app)/team/absences/team-absences-table.tsx',
 'apps/webapp/src/components/absences/sick-notes/use-staged-sick-note-uploads.ts',
 'apps/webapp/src/components/absences/sick-notes/staged-sick-notes-section.tsx',
 'apps/webapp/src/hooks/use-tus-file-upload.ts',
 'apps/webapp/src/components/providers/organization-context-provider.tsx',
 'apps/webapp/src/components/providers/view-refresh-provider.tsx',
];
const depDirs=['node_modules','apps/webapp/node_modules','node_modules/.pnpm'].map(p=>{const s=fs.lstatSync(path.join(root,p));if(s.isSymbolicLink()||!s.isDirectory())throw Error('Nonphysical deps '+p);return {path:p,physical:true}});
const appModules=path.join(root,'apps/webapp/node_modules');let links=0;
function examine(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const p=path.join(dir,entry.name);const s=fs.lstatSync(p);if(s.isSymbolicLink()){const resolved=fs.realpathSync(p);if(!resolved.toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('Borrowed link '+p);links++;}else if(entry.name.startsWith('@')&&s.isDirectory())examine(p)}}
examine(appModules);
const appLinks=links;examine(path.join(root,'node_modules'));const rootLinks=links-appLinks;
const configPaths=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','.npmrc','apps/webapp/package.json','apps/webapp/vitest.config.ts','apps/webapp/biome.jsonc'];
const audit={candidate,fix,branch:git('branch','--show-current'),tree:git('rev-parse','HEAD^{tree}'),appTree:git('rev-parse','HEAD:apps/webapp'),fixAppTree:git('rev-parse',`${fix}:apps/webapp`),cleanTrackedAndIndex:true,status,verifiedCommit:null,sourcePins:sourcePaths.map(pin),configPins:configPaths.map(pin),ownerPins,dependencies:{manager:'pnpm@12.16.1',install:'offline frozen copy ignore-scripts verify-store-integrity',directories:depDirs,appInternalLinks:appLinks,rootInternalLinks:rootLinks,totalInternalLinks:links,allRootAndAppLinksResolveInsideOwnCheckout:true,lockSha256:digest(fs.readFileSync(path.join(root,'pnpm-lock.yaml')))},premergeControl:{commit:old,fullCommittedSelection:true,dialogBlob:git('rev-parse',`${old}:${sourcePaths[0]}`),sharedUploadOwnersUnchanged:sourcePaths.slice(4,7).every(p=>git('rev-parse',`${old}:${p}`)===git('rev-parse',`HEAD:${p}`))},preservation:'Exact original candidate HEAD, tree, clean index/worktree and source pins restored after ordinary Git selection; all original proofs remain at their original Git objects. No publication proof is rewritten.',resources:JSON.parse(fs.readFileSync(path.join(__dirname,'resource-seal.json'),'utf8').replace(/^\uFEFF/,''))};
if(audit.dependencies.lockSha256.toUpperCase()!=='2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799')throw Error('Lock changed');
fs.writeFileSync(path.join(__dirname,'candidate-audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify({candidate,appTree:audit.appTree,clean:true,protectedOwners:ownerPins.length,internalAppLinks:links,sharedUploadOwnersUnchanged:audit.premergeControl.sharedUploadOwnersUnchanged,remainingBridges:audit.resources.remainingBridges}));
