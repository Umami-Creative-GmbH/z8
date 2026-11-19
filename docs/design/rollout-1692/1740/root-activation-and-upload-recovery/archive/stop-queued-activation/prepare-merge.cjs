const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root='98bc0c4c82f32af17b0d6aee98fd7e42edc29a86';
const incoming='6473c5b41f387f9bfe1798b91be415c0f43dec02';
const base='ab309161695fe1cf6e2739f4727598fa3fa28c04';
const dir=__dirname;
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024}).trimEnd();
const blob=(ref,p)=>cp.execFileSync('git',['show',`${ref}:${p}`]);
const tree=ref=>new Map(git('ls-tree','-r',ref).split('\n').map(l=>{const [meta,p]=l.split('\t');return[p,meta];}));
const delta=git('diff','--name-only',base,incoming).split('\n');
const rootDelta=git('diff','--name-only',base,root).split('\n');
const overlap=delta.filter(p=>rootDelta.includes(p));
if(delta.length!==31 || overlap.length!==2 || overlap.some(p=>!p.includes('/navigation/route-metadata.')))throw Error('Unexpected overlap');
if(git('status','--porcelain') || git('rev-parse','HEAD')!==root || git('branch','--show-current')!=='review/1740-team-absences')throw Error('Bad checkout');
const ancestors=['b6595389e0ebf15b4ec9afc44d6d8f92ff2017c5','382b8f5be837dad724d3a54274d3050b0104881f','bfacad421ffe77f50729ea5895c546698ef28383','26d1d8fd016d6daa0c9fe71e0f671571dd45c211'];
for(const a of ancestors)for(const target of [root,incoming])git('merge-base','--is-ancestor',a,target);
const prefix='apps/webapp/src/lib/navigation/route-metadata';
const sourcePath=prefix+'.ts', testPath=prefix+'.test.ts';
let source=blob(root,sourcePath).toString();
source=source.replace('\t\tpath === "/team" ||','\t\tpath === "/team" ||\n\t\tpath === "/team/absences" ||');
let test=blob(root,testPath).toString();
test=test.replace('adopts only the team directory heading, preserving descendant ownership','adopts the team directory heading, preserving independently staged descendants');
test=test.replace('\t\t\t"/en/team/absences",\n','');
const newCase=blob(incoming,testPath).toString().match(/\tit\("adopts only the team absence heading[\s\S]*?\n\t\}\);/)[0].replace('adopts only the team absence heading, keeping team and descendants independent','adopts the team absence heading, retaining team ownership and independent descendants').replace('appPageOwnsHeading("/en/team")).toBe(false)','appPageOwnsHeading("/en/team")).toBe(true)');
test=test.replace('describe("route metadata", () => {','describe("route metadata", () => {\n'+newCase);
fs.writeFileSync(path.join(dir,'resolved-route-metadata.ts'),source);
fs.writeFileSync(path.join(dir,'resolved-route-metadata.test.ts'),test);
const expected=tree(root), incomingTree=tree(incoming);
for(const p of delta)if(!overlap.includes(p))expected.set(p,incomingTree.get(p));
for(const [p,s]of [[sourcePath,source],[testPath,test]]){const oid=cp.execFileSync('git',['hash-object','-w','--stdin'],{input:s,encoding:'utf8'}).trim();expected.set(p,`100644 blob ${oid}`);}
// Separate index prepared BEFORE normal merge. This is a manual additive resolution,
// deliberately not described as a pure git merge-tree match.
const env={...process.env,GIT_INDEX_FILE:path.join(dir,'expected.index')};
const ix=(...args)=>cp.execFileSync('git',args,{encoding:'utf8',env}).trimEnd();
ix('read-tree',root);
for(const p of delta){const [mode,,oid]=expected.get(p).split(' ');ix('update-index','--add','--cacheinfo',mode,oid,p);}
const expectedTree=ix('write-tree');
fs.writeFileSync(path.join(dir,'expected-tree.json'),JSON.stringify({root,incoming,base,branch:git('branch','--show-current'),ancestors,delta,rootDeltaCount:rootDelta.length,overlap,expectedTree,recipe:'Start from complete root tree. Overlay 29 incoming nonoverlap entries exactly. Metadata source adds exact /team/absences after /team. Root tests retain all cases, move /en/team/absences from negative loop to incoming positive case, reconcile incoming /team to true; preserve /team/driving false and newer personnel/vehicles positives.',entries:[...expected].map(([path,entry])=>({path,entry}))},null,2));
console.log(JSON.stringify({expectedTree,delta:delta.length,rootDelta:rootDelta.length,overlap}));
