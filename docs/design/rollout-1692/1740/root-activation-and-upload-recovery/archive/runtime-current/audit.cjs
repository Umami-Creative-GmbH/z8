const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),peer='X:/t3-code/worktrees/z8/t3-36de3f4a-69b59b59b97cbc3d';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=git('ls-files','--','*package.json','pnpm-lock.yaml','pnpm-workspace.yaml').split('\n');
const manifests=files.map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(root,p))),matchesArtifactDonor:sha(fs.readFileSync(path.join(root,p)))===sha(fs.readFileSync(path.join(peer,p)))}));
if(manifests.some(p=>!p.matchesArtifactDonor))throw Error('Manifests differ');
const licensePath='apps/webapp/src/data/licenses.json',license=fs.readFileSync(path.join(peer,licensePath));
if(JSON.parse(license).length!==125)throw Error('Unexpected genuine license length');
if(!fs.existsSync(path.join(root,licensePath))){fs.mkdirSync(path.dirname(path.join(root,licensePath)),{recursive:true});fs.writeFileSync(path.join(root,licensePath),license,{flag:'wx'});}
const topology=['node_modules','node_modules/.pnpm','apps/webapp/node_modules'].map(p=>({path:p,physical:fs.lstatSync(path.join(root,p)).isDirectory()&&!fs.lstatSync(path.join(root,p)).isSymbolicLink()}));
const links=[];for(const dir of ['node_modules','apps/webapp/node_modules'])for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){if(entry.name.startsWith('.'))continue;const p=path.join(root,dir,entry.name);const children=entry.name.startsWith('@')?fs.readdirSync(p).map(n=>path.join(p,n)):[p];for(const f of children)if(fs.lstatSync(f).isSymbolicLink())links.push({path:path.relative(root,f),owned:fs.realpathSync(f).startsWith(root+path.sep)});}
if(topology.some(p=>!p.physical)||links.some(p=>!p.owned))throw Error('Dependency topology mismatch');
const r=JSON.parse(fs.readFileSync(path.join(peer,'.tmp/1740-availability-root-checks/correction-summary.json')));
const sourcePins=r.sources.map(p=>({...p,matches:sha(fs.readFileSync(path.join(root,p.path)))===p.sha256}));
const integration=JSON.parse(fs.readFileSync(path.join(root,'docs/design/rollout-1692/integration.json')));
const data={head:git('rev-parse','HEAD'),appTree:git('rev-parse','HEAD:apps/webapp'),sourceTree:git('rev-parse','6757981b:apps/webapp'),sourcePins,manifests,topology,directLinkCount:links.length,allLinksOwned:true,license:{path:licensePath,sha256:sha(license),entries:125,donor:peer,provenance:'genuine generated artifact; all tracked package manifests and lock byte equal; no fabrication'},trackedStatus:git('status','--short','--untracked-files=no'),configPins:['apps/webapp/vitest.config.ts','apps/webapp/next.config.ts','package.json','apps/webapp/package.json','pnpm-lock.yaml','pnpm-workspace.yaml'].filter(p=>fs.existsSync(path.join(root,p))).map(p=>({path:p,sha256:sha(fs.readFileSync(path.join(root,p)))}))};
if(data.appTree!==data.sourceTree||sourcePins.some(p=>!p.matches)||data.trackedStatus)throw Error('Candidate differs');
fs.writeFileSync(path.join(__dirname,'candidate-audit.json'),JSON.stringify(data,null,2));console.log(JSON.stringify({head:data.head,appMatches:true,pins:sourcePins.length,directLinks:links.length,allLinksOwned:true,genuineLicenseEntries:125,trackedClean:true}));
