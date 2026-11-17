const fs=require('node:fs'); const path=require('node:path'); const cp=require('node:child_process'); const crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'); const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const hash=(bytes)=>crypto.createHash('sha256').update(bytes).digest('hex');
const candidate='e42b89a3d739541f884f90c5f9a6179ee2dd29e0'; const previous='e597efc34bc2bdc1fa5369496781fe6bb0105888'; const source='55b79c4720a689395e58c8b459a47e394656b6e0';
const changed=git('diff','--name-only',previous,candidate).split('\n');
const selected=[...changed.filter(p=>p.startsWith('apps/')), 'apps/webapp/vitest.config.ts','package.json','apps/webapp/package.json','pnpm-lock.yaml','pnpm-workspace.yaml'];
const pins=selected.map(file=>({path:file,bytes:fs.statSync(path.join(root,file)).size,sha256:hash(fs.readFileSync(path.join(root,file))),blob:git('rev-parse',`${candidate}:${file}`)}));
const dependencies=[];
for(const part of ['node_modules','apps/webapp/node_modules']){
 const base=path.join(root,part);
 for(const entry of fs.readdirSync(base,{withFileTypes:true})){
  if(entry.name.startsWith('.')||entry.name==='node_modules') continue;
  const p=path.join(base,entry.name); const stat=fs.lstatSync(p);
  const children=entry.name.startsWith('@')&&!stat.isSymbolicLink()?fs.readdirSync(p).map(name=>path.join(p,name)):[p];
  for(const child of children) if(fs.lstatSync(child).isSymbolicLink()){
   const resolved=fs.realpathSync(child); if(!resolved.startsWith(root+path.sep))throw Error('Dependency escapes owned checkout');
   dependencies.push({path:path.relative(root,child),target:path.relative(root,resolved)});
  }
 }
}
for(const part of ['node_modules','apps/webapp/node_modules','node_modules/.pnpm']){
 const full=path.join(root,part);if(fs.lstatSync(full).isSymbolicLink()||fs.realpathSync(full)!==full)throw Error('Dependency root not physical');
}
if(git('rev-parse','HEAD')!==candidate||git('status','--porcelain')!=='')throw Error('Candidate not restored clean');
const result={candidate,branch:git('branch','--show-current'),applicationTree:git('rev-parse',`${candidate}:apps/webapp`),sourceApplicationTree:git('rev-parse',`${source}:apps/webapp`),historicalControl:previous,historicalAppTree:git('rev-parse',`${previous}:apps/webapp`),clean:true,pins,changedPaths:changed,productionOwnerDiff:changed.filter(p=>p.startsWith('apps/')&&!p.includes('.test.')),dependencies:{manager:'12.16.1',guards:['pnpm_config_verify_deps_before_run=false','--config.verify-deps-before-run=false'],install:'offline frozen-lockfile ignore-scripts package-import-method=copy verify-store-integrity',physicalRoots:3,linkCount:dependencies.length,rootLinks:dependencies.filter(p=>!p.path.startsWith('apps')).length,appLinks:dependencies.filter(p=>p.path.startsWith('apps')).length,allLinksInternal:true,links:dependencies},bridgeRemoved:!fs.existsSync(path.join(root,'apps/webapp/src/test/1740-upload-independent-bridge.test.tsx')),verifiedCommit:null};
fs.writeFileSync(path.join(__dirname,'candidate-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({candidate,clean:result.clean,appMatchesSource:result.applicationTree===result.sourceApplicationTree,dependencyLinks:dependencies.length,bridgeRemoved:result.bridgeRemoved}));
