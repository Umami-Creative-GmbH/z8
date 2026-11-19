const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const out = '.tmp/review1748';
const root = '85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4';
const incoming = '6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8';
const base = 'cab40dcbb6ea69cefb7aa919228298a881a66060';
const git = (...args) => cp.execFileSync('git', args, {maxBuffer: 40*1024*1024});
const str = (...args) => git(...args).toString('utf8').trim();
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const object = (type,b) => crypto.createHash('sha1').update(Buffer.from(`${type} ${b.length}\0`)).update(b).digest('hex');
const treeMap = ref => new Map(git('ls-tree','-rz','--full-tree',ref).toString().split('\0').filter(Boolean).map(line => {
  const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
  if(!m) throw Error('tree parse'); return [m[4],{mode:m[1],type:m[2],oid:m[3]}];
}));
const r=treeMap(root), b=treeMap(base), i=treeMap(incoming), expected=new Map(r);
const changed=[...new Set([...b.keys(),...i.keys()])].filter(p => JSON.stringify(b.get(p))!==JSON.stringify(i.get(p))).sort();
const overlaps=changed.filter(p=>JSON.stringify(b.get(p))!==JSON.stringify(r.get(p)));
const metadata='apps/webapp/src/lib/navigation/route-metadata.ts';
const tests='apps/webapp/src/lib/navigation/route-metadata.test.ts';
if(JSON.stringify(overlaps)!==JSON.stringify([tests,metadata])) throw Error('Unexpected overlap '+JSON.stringify(overlaps));
if(changed.length!==83 || str('rev-parse','HEAD')!==root || str('status','--porcelain=v1')) throw Error('Pins/cleanliness changed');
if(str('rev-parse','HEAD:apps/webapp')!=='0ada8178304098b103daa1284f9158cdf59384d8' || str('merge-base',root,incoming)!==base) throw Error('Pin mismatch');
const read=(ref,p)=>git('show',`${ref}:${p}`).toString('utf8');
let composed='import { z } from "zod";\n'+read(root,metadata);
const needle='\tconst path = normalizeAppPath(pathname);\n\treturn (\n';
if(composed.split(needle).length!==2) throw Error('Ambiguous metadata anchor');
composed=composed.replace(needle,'\tconst path = normalizeAppPath(pathname);\n\tconst legacyClaimId = /^\\/travel-expenses\\/([^/]+)$/.exec(path)?.[1];\n\treturn (\n\t\tBoolean(legacyClaimId && z.uuid().safeParse(legacyClaimId).success) ||\n');
const baseTests=read(base,tests), incomingTests=read(incoming,tests);
if(!incomingTests.startsWith(baseTests)) throw Error('Tests are not purely additive');
const resolutions = {[metadata]:composed,[tests]:read(root,tests)+incomingTests.slice(baseTests.length)};
fs.mkdirSync(out,{recursive:true});
for(const p of changed) {
  if(resolutions[p]!==undefined){
    const bytes=Buffer.from(resolutions[p]);
    expected.set(p,{...r.get(p),oid:object('blob',bytes)});
    fs.writeFileSync(`${out}/${p.endsWith('.test.ts')?'resolved-test':'resolved-metadata'}.txt`,bytes);
  }else if(i.has(p)) expected.set(p,i.get(p)); else expected.delete(p);
}
function hashTree(map,prefix=''){
  const children=new Map();
  for(const [p,e] of map){
    if(!p.startsWith(prefix))continue;
    const rest=p.slice(prefix.length), n=rest.split('/')[0];
    if(rest.includes('/')) children.set(n,{mode:'40000',type:'tree'});else children.set(n,e);
  }
  const sorted=[...children].sort((a,b)=>Buffer.compare(Buffer.from(a[0]+(a[1].type==='tree'?'/':'')),Buffer.from(b[0]+(b[1].type==='tree'?'/':''))));
  const bytes=Buffer.concat(sorted.map(([name,e])=>Buffer.concat([Buffer.from(`${e.mode} ${name}\0`),Buffer.from(e.type==='tree'?hashTree(map,prefix+name+'/'):e.oid,'hex')])));
  return object('tree',bytes);
}
if(hashTree(r)!==str('rev-parse',`${root}^{tree}`)) throw Error('Tree algorithm control failed');
const report={root,incoming,base,rootTree:hashTree(r),predictedTree:hashTree(expected),predictedApp:hashTree(expected,'apps/webapp/'),rootPaths:r.size,incomingPaths:changed.length,sourceTestPaths:changed.filter(p=>p.startsWith('apps/')).length,overlaps,recipe:'Root map plus incoming base delta, except metadata = root with incoming z import and exact UUID predicate; metadata tests = root plus incoming additive suffix. Full root tree algorithm control passed before merge.',changes:changed.map(p=>({path:p,base:b.get(p)||null,root:r.get(p)||null,incoming:i.get(p)||null,expected:expected.get(p)||null}))};
fs.writeFileSync(`${out}/prediction.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,changes:undefined}));
