import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=process.cwd(), out=path.join(root,'.tmp/merge1734-audit');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:128*1024*1024}); if(r.status!==0) throw new Error(JSON.stringify({args,status:r.status,error:String(r.error),stderr:r.stderr}));return r.stdout.trim();};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>fs.readFileSync(path.join(root,p));
const parent='a904b3d19815bd511c67514fb48078cd4aec262f',incoming='e194f9f367ff747ecab779ebd47c2ba34c684b84';
if(git('rev-parse','HEAD')!==parent||git('status','--porcelain=v1'))throw new Error('Unexpected checkout');
const ledger=JSON.parse(read('docs/design/rollout-1692/integration.json'));
const arrays=Object.entries(ledger).filter(([,v])=>Array.isArray(v));
const entries=arrays.find(([,v])=>v.some(x=>x?.id==='F1'))?.[1]; if(!entries)throw new Error('ledger entries');
const verified=entries.filter(x=>x.verifiedCommit);
for(const x of verified)git('merge-base','--is-ancestor',x.verifiedCommit,parent);
const topology={parents:['node_modules','apps/webapp/node_modules','node_modules/.pnpm'].map(p=>({path:p,physical:!fs.lstatSync(path.join(root,p)).isSymbolicLink(),real:fs.realpathSync(path.join(root,p))})),leafLinks:[]};
for(const base of ['node_modules','apps/webapp/node_modules'])for(const name of fs.readdirSync(path.join(root,base))){
 if(name.startsWith('.'))continue;const a=path.join(root,base,name);const paths=name.startsWith('@')&&!fs.lstatSync(a).isSymbolicLink()?fs.readdirSync(a).map(n=>path.join(a,n)):[a];
 for(const p of paths)if(fs.lstatSync(p).isSymbolicLink()){const real=fs.realpathSync(p); if(!real.toLowerCase().startsWith(root.toLowerCase()+path.sep))throw new Error('External link '+p);topology.leafLinks.push({path:path.relative(root,p).replaceAll('\\','/'),real:path.relative(root,real).replaceAll('\\','/')});}
}
const configPaths=['package.json','apps/webapp/package.json','pnpm-lock.yaml','pnpm-workspace.yaml','biome.json','apps/webapp/next.config.ts','apps/webapp/vitest.config.ts','apps/webapp/tsconfig.typecheck.json','apps/webapp/tsconfig.workflow-contracts.json','apps/webapp/tsconfig.smoke.json'];
const configs=Object.fromEntries(configPaths.filter(p=>fs.existsSync(path.join(root,p))).map(p=>[p,sha(read(p))]));
if(configs['pnpm-lock.yaml'].toUpperCase()!=='2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799')throw new Error('Lock mismatch');
const license='apps/webapp/src/data/licenses.json';
const summary={recorded:new Date().toISOString(),root,parent,incoming,branch:git('branch','--show-current'),origin:git('rev-parse','origin/ai/1692-app-wide-ui-refresh'),parentTree:git('rev-parse',parent+'^{tree}'),verifiedProduct:'a114c3392e2e9edb97069ddcce1c4e8d1d58c3c0',mergeBase:git('merge-base',parent,incoming),verified:verified.map(({id,issue,verifiedCommit})=>({id,issue,verifiedCommit})),statusCounts:entries.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{}),configs,topology,licenses:{path:license,count:JSON.parse(read(license)).length,sha256:sha(read(license)),provenance:'Inherited; not regenerated'},inventory:JSON.parse(read('docs/design/rollout-1692/route-inventory.json'))};
fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(out,'parent-tree.txt'),git('ls-tree','-r',parent)+'\n');
fs.writeFileSync(path.join(out,'incoming-delta.txt'),git('diff','--name-status',summary.mergeBase,incoming)+'\n');
console.log(JSON.stringify({...summary,inventory:Object.keys(summary.inventory),topology:{parents:topology.parents,leafLinkCount:topology.leafLinks.length},verified:verified.length},null,2));
