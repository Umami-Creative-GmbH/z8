import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
const root=resolve(process.argv[2]??'.'), out=join(root,'.tmp/merge1828-audit');
const base='383c64f06a86bf94b89b980f9ec1091c6040d554',incoming='028b4c0a026419567874190ce20b019180c7f304';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:30*1024*1024}).trim();
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=p=>readFileSync(join(root,p));
const json=p=>JSON.parse(read(p).toString('utf8').replace(/^\uFEFF/,''));
const walk=p=>readdirSync(join(root,p)).flatMap(n=>statSync(join(root,p,n)).isDirectory()?walk(`${p}/${n}`):[`${p}/${n}`]);
const tree=rev=>new Map(git('ls-tree','-r',rev).split('\n').map(l=>{const [meta,path]=l.split('\t');return[path,meta];}));
const before=tree(base),after=tree('HEAD'),incomingTree=tree(incoming);
const changed=new Set(git('diff','--name-only',base,'HEAD').split('\n').filter(Boolean));
const badPreserved=[...before].filter(([p,v])=>!changed.has(p)&&after.get(p)!==v);
const originals=[...before].filter(([p])=>p.startsWith('docs/design/rollout-1692/'));
const rawPreservation=originals.filter(([p,v])=>after.get(p)!==v);
const incomingPaths=git('diff','--name-only',`${base}...${incoming}`).split('\n').filter(Boolean);
const incomingMismatch=incomingPaths.filter(p=>incomingTree.get(p)!==after.get(p));
const ledger=json('docs/design/rollout-1692/integration.json');
const ancestors=ledger.tickets.filter(t=>t.verifiedCommit).map(t=>({issue:t.issue,commit:t.verifiedCommit,ancestor:spawnSync('git',['merge-base','--is-ancestor',t.verifiedCommit,'HEAD'],{cwd:root}).status===0}));
const store=join(root,'node_modules/.pnpm'),pngPackage=readdirSync(store).find(n=>n.startsWith('pngjs@'));
if(!pngPackage)throw Error('PNG decoder missing: no dependency repair authorized');
const require=createRequire(join(root,'package.json')),{PNG}=require(join(store,pngPackage,'node_modules/pngjs'));
const artifacts=walk('docs/design/rollout-1692/1828'),images=[],jsonFiles=[],scripts=[],pins=[];
for(const p of artifacts){
 const bytes=read(p);
 if(p.endsWith('.png')){const decoded=PNG.sync.read(bytes);images.push({file:p,width:decoded.width,height:decoded.height,sha256:sha(bytes),fullDecoded:true});}
 if(p.endsWith('.json')){const value=json(p);jsonFiles.push({file:p,bom:bytes[0]===239,endsLF:bytes.at(-1)===10});collectPins(value,p);}
 if(p.endsWith('.mjs')){const checked=spawnSync(process.execPath,['--check',join(root,p)],{encoding:'utf8'});scripts.push({file:p,status:checked.status,stderr:checked.stderr});}
}
function collectPins(value,source){
 if(!value||typeof value!=='object')return;
 if(value.files&&typeof value.files==='object')for(const [file,hash]of Object.entries(value.files))if(typeof hash==='string'&&/^[0-9a-f]{64}$/i.test(hash))pins.push({source,file,hash});
 if(value.pins&&typeof value.pins==='object')for(const [file,pin]of Object.entries(value.pins))if(pin&&typeof pin.sha256==='string')pins.push({source,file,hash:pin.sha256,recordedGitBlob:pin.gitBlob,actualGitBlob:git('rev-parse',`${incoming}:${file}`)});
 if(typeof value.pageSha256==='string')pins.push({source,file:'apps/webapp/src/app/[locale]/onboarding/notifications/page-client.tsx',hash:value.pageSha256});
 for(const child of Object.values(value))if(child&&typeof child==='object')collectPins(child,source);
}
const candidateCommits=['HEAD',base,incoming,'19862ee6586b4e07831c6f5a8b7e06d0f698cedd','898e02935a740f4c47c9b10e28551498779f4eea'];
const variants=new Map();
for(const file of new Set(pins.map(p=>p.file))){
 const matches=[];
 for(const commit of candidateCommits){try{const bytes=execFileSync('git',['show',`${commit}:${file}`],{cwd:root,maxBuffer:8*1024*1024});const canonical=bytes.toString('utf8').replace(/\r\n/g,'\n');matches.push({hash:sha(bytes),commit,kind:'canonical git blob',gitBlob:git('rev-parse',`${commit}:${file}`)},{hash:sha(Buffer.from(canonical.replace(/\n/g,'\r\n'))),commit,kind:'CRLF checkout reconstruction'});}catch{}}
 if(existsSync(join(root,file)))matches.push({hash:sha(read(file)),commit:'working tree',kind:'actual raw bytes'});
 variants.set(file,matches);
}
const pinResults=[...new Map(pins.map(p=>[`${p.source}\0${p.file}\0${p.hash}`,p])).values()].map(p=>({...p,matches:variants.get(p.file).filter(v=>v.hash===p.hash)}));
const links=[...read('docs/design/rollout-1692/1828.md').toString('utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m=>m[1]).filter(l=>!/^https?:/.test(l)).map(link=>({link,exists:existsSync(resolve(root,'docs/design/rollout-1692',decodeURIComponent(link.split('#')[0])))}));
const reports=['unit-exact','unit-compat'].map(name=>({name,value:json(`.tmp/merge1828-audit/${name}.json`)}));
const identities=new Map(),fileSet=new Set();
const testCounts=reports.map(({name,value})=>{let counted=0;for(const suite of value.testResults){const physical=realpathSync(suite.name).toLowerCase(),occurrences=new Map();fileSet.add(physical);for(const a of suite.assertionResults){const n=(occurrences.get(a.fullName)??0)+1;occurrences.set(a.fullName,n);const id=`${physical}\0${a.fullName}\0${n}`;identities.set(id,{file:physical,fullName:a.fullName,occurrence:n,status:a.status});counted++;}}return{name,files:value.testResults.length,tests:counted,passed:value.numPassedTests,failed:value.numFailedTests};});
const pageFiles=walk('apps/webapp/src/app/[locale]').filter(p=>p.endsWith('/page.tsx'));
const routeOf=p=>'/'+p.slice('apps/webapp/src/app/[locale]/'.length).split('/').filter(s=>!s.startsWith('(')&&s!=='page.tsx').join('/');
const sourceRoutes=new Map(pageFiles.map(p=>[routeOf(p),p]));
const aliasRows=read('docs/design/2026-11-14-webapp-ui-ux-publication.md').toString('utf8').split('## Redirect aliases')[1].split('\n').filter(l=>/^\| R\d+ \|/.test(l)).map(l=>l.split('|').map(c=>c.trim()));
const aliases=aliasRows.map(c=>{const route=c[2].replaceAll('`',''),target=c[3].replaceAll('`','');return{id:c[1],route,target,file:sourceRoutes.get(route),ownerRoutePresent:sourceRoutes.has(target),sourcePreserved:before.get(sourceRoutes.get(route))===after.get(sourceRoutes.get(route))};});
const dependencies=json('.tmp/1727-root-checks/dependency-restored-links.json').map(link=>({path:link.path,target:realpathSync(link.path),insideRoot:realpathSync(link.path).toLowerCase().startsWith(root.toLowerCase()+'\\')}));
const directoryTypes=['node_modules','apps/webapp/node_modules'].map(p=>({path:p,symbolic:statSync(join(root,p)).isSymbolicLink(),real:realpathSync(join(root,p))}));
const proof=json('.tmp/merge1828-audit/unit-adversarial-proof.json');
const result={head:git('rev-parse','HEAD'),parents:git('show','-s','--format=%P','HEAD').split(' '),tree:git('rev-parse','HEAD^{tree}'),independentTree:readFileSync(join(out,'independent-merge-tree.txt'),'utf8').trim(),sourceChanged:[...changed].filter(p=>p.startsWith('apps/')),preservation:{unaffectedPaths:[...before.keys()].filter(p=>!changed.has(p)).length,unaffectedMismatch:badPreserved,priorRolloutPaths:originals.length,priorRolloutMismatch:rawPreservation,incomingPaths:incomingPaths.length,incomingMismatch},ancestors,inventory:{pageFiles:pageFiles.length,aliases,ledgerRoutes:ledger.tickets.filter(t=>t.id.startsWith('R')).length,ledgerNodes:ledger.tickets.length,edges:ledger.tickets.reduce((s,t)=>s+t.blockedBy.length,0)},dependencies:{directoryTypes,leafLinks:dependencies.length,external:dependencies.filter(l=>!l.insideRoot)},artifacts:{images,jsonFiles,scripts,links,pins:pinResults},checks:{testCounts,uniquePhysicalFiles:fileSet.size,uniqueCases:identities.size,failed:[...identities.values()].filter(a=>a.status!=='passed'),adversarial:{tests:proof.numTotalTests,failed:proof.numFailedTests,assertions:proof.testResults.flatMap(s=>s.assertionResults)}},lockSha256:sha(read('pnpm-lock.yaml')),status:git('status','--short')};
writeFileSync(join(out,'audit-result.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({head:result.head,treeMatch:result.tree===result.independentTree,preservation:result.preservation,verified:ancestors.length,failedAncestors:ancestors.filter(a=>!a.ancestor),images:images.length,jsons:jsonFiles.length,scripts:scripts.length,links:links.length,missingLinks:links.filter(l=>!l.exists),sourcePins:pinResults.length,unmatchedPins:pinResults.filter(p=>!p.matches.length),checks:result.checks,inventory:result.inventory},null,2));
