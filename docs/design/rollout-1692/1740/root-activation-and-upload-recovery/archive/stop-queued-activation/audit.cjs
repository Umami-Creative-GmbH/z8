const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const sharp=createRequire(path.resolve('apps/webapp/package.json'))('sharp');
const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'expected-tree.json')));
const {root,incoming,base}=expected;
const git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8',maxBuffer:32*1024*1024}).trimEnd();
const blob=(ref,p)=>cp.execFileSync('git',['show',`${ref}:${p}`],{maxBuffer:32*1024*1024});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const modes=b=>{const s=b.toString().replace(/\r\n/g,'\n');return{Git:hash(b),LF:hash(s),CRLF:hash(s.replace(/\n/g,'\r\n'))};};
const fail=m=>{throw Error(m)};
const parseTree=r=>new Map(git('ls-tree','-r',r).split('\n').map(l=>{const[m,p]=l.split('\t');return[p,m]}));
(async()=>{
const candidate=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
if(tree!==expected.expectedTree)fail('Candidate mismatch');
const current=parseTree(candidate),original=parseTree(root),inc=parseTree(incoming);
let preservedRoot=0,preservedIncoming=0;
for(const[p,m]of original)if(!expected.delta.includes(p)){if(current.get(p)!==m)fail('Root preservation '+p);preservedRoot++;}
for(const p of expected.delta)if(!expected.overlap.includes(p)){if(current.get(p)!==inc.get(p))fail('Incoming preservation '+p);preservedIncoming++;}
for(const e of expected.entries)if(current.get(e.path)!==e.entry)fail('Expected entry mismatch '+e.path);
const prep='C:/Users/KAIHEN~1/AppData/Local/Temp/z8-team-merger-prep-352a34ec1ed24e7d8ca638f33d919442';
const receipt=JSON.parse(fs.readFileSync(path.join(prep,'owner-and-count-receipts.json')));
const ownerPins=receipt.ownerBlobs.map(e=>{const resolved=expected.overlap.includes(e.path);if(!resolved&&current.get(e.path)!==`100644 blob ${e.rootBlob}`)fail('Owner '+e.path);return{path:e.path,rootOid:e.rootBlob,candidate:current.get(e.path),resolved};});
const protectedAncestry=['769a2e7844ed1ff43d6a36145869b50cee921db6','00614f12ab899fca05b4b3096d194d4a2fa10979','03f1a8d0df8fcb2d8c73901fa6efe8e114310765','01771c655e179797b852adf217b684794e3266f7','512ac6f7b39bcf028c3c3a555ddfb140589b0796'];
for(const pin of protectedAncestry)git('merge-base','--is-ancestor',pin,candidate);
const audit=JSON.parse(fs.readFileSync(path.join(prep,'machine-audit.json'))).tickets['1740'];
let totalBytes=0;const artifacts=[];
for(const e of audit.publicArtifacts){const b=blob(candidate,e.path);if(hash(b)!==e.sha256 || b.length!==e.bytes)fail('Public artifact '+e.path);totalBytes+=b.length;const local=fs.readFileSync(e.path);if(e.path.endsWith('.png')?hash(local)!==hash(b):local.toString().replace(/\r\n/g,'\n')!==b.toString().replace(/\r\n/g,'\n'))fail('Materialization '+e.path);const a={path:e.path,oid:git('rev-parse',`${candidate}:${e.path}`),bytes:b.length,sha256:hash(b)};if(e.path.endsWith('.png')){const d=await sharp(b).raw().toBuffer({resolveWithObject:true});a.fullyDecoded={...d.info,rawSha256:hash(d.data)};}if(e.path.endsWith('.json'))JSON.parse(b);artifacts.push(a);}
if(artifacts.length!==20 || totalBytes!==2678953)fail('Public totals');
const directory='docs/design/rollout-1692/1740/';
const verification=JSON.parse(blob(candidate,directory+'verification.json'));
const declaredArtifacts=verification.artifacts.map(e=>{const b=blob(candidate,directory+e.file);if(hash(b)!==e.sha256||b.length!==e.bytes)fail('Declared artifact '+e.file);return{path:directory+e.file,sha256:e.sha256,bytes:e.bytes}});
const frozenOwners=verification.protectedOwners.map(e=>{if(!Object.values(modes(blob(candidate,e.path))).includes(e.sha256))fail('Frozen hash '+e.path);if(git('rev-parse',`${candidate}:${e.path}`)!==git('rev-parse',`${base}:${e.path}`))fail('Frozen changed '+e.path);return e;});
const refs=[base,'c0dc68bd0c7d89f81f3392d0d8a485c7dec4e00b','4180d4a8dcfbf4495ee1e6bd1bfb9e09922e0825'];
const captureSources={};
for(const name of ['before-matched','after-matched']){const data=JSON.parse(blob(candidate,directory+name+'.json'));captureSources[name]=data.sources.map(e=>{const matches=[];for(const r of refs){try{const hs=modes(blob(r,e.path));for(const [mode,h]of Object.entries(hs))if(h===e.sha256)matches.push({ref:r,mode,oid:git('rev-parse',`${r}:${e.path}`)});}catch{}}if(!matches.length)fail('Capture pin '+name+' '+e.path);return{...e,matches};});}
const restoration=JSON.parse(blob(candidate,directory+'overlay-restoration.json')).entries.map(e=>{if(!Object.values(modes(blob(base,e.path))).includes(e.beforeSha256)||!Object.values(modes(blob(refs[1],e.path))).includes(e.afterSha256))fail('Restoration '+e.path);return e;});
const sources=expected.delta.filter(p=>p.startsWith('apps/')).map(p=>({path:p,root:original.get(p)??null,incoming:inc.get(p),candidate:current.get(p)}));
const result={candidate,parents:git('show','-s','--format=%P','HEAD').split(' '),tree,appTree:git('rev-parse','HEAD:apps/webapp'),recipe:expected.recipe,preservedRoot,preservedIncoming,rootDelta:expected.rootDeltaCount,protectedAncestry,ownerPins,artifacts,totalBytes,declaredArtifacts,frozenOwners,captureSources,restoration,sources,lockSha256:hash(fs.readFileSync('pnpm-lock.yaml')),trackedStatus:git('status','--porcelain')};
fs.writeFileSync(path.join(__dirname,'candidate-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({candidate,tree,appTree:result.appTree,preservedRoot,preservedIncoming,protectedOwners:ownerPins.length,publicFiles:artifacts.length,totalBytes,fullyDecodedPNGs:artifacts.filter(e=>e.fullyDecoded).length,declaredArtifacts:declaredArtifacts.length,frozenOwners:frozenOwners.length,beforePins:captureSources['before-matched'].length,afterPins:captureSources['after-matched'].length,restoration:restoration.length,status:result.trackedStatus}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
