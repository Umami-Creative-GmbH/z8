import {readFile,writeFile,lstat,realpath,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo=resolve('.'),out=resolve('.tmp/1730-root-checks/runtime'),sha=b=>createHash('sha256').update(b).digest('hex');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(git('rev-parse','HEAD'),'a4e2d21f5ab0256bb072af2ef13b7982808f7570');
const paths=git('diff','--name-only','fb6c0d7b6289bb0c9d5dd108eff4be5697cd79a8','HEAD','--','apps/webapp/src').split(/\r?\n/).filter(Boolean),pins=[];
for(const path of paths){const b=await readFile(path);pins.push({path,raw:sha(b),lf:sha(b.toString().replaceAll('\r\n','\n'))});}
const all=git('ls-files','apps/webapp/src','packages','docs/design/rollout-1692').split(/\r?\n/).filter(Boolean),allPins=[];
for(const p of all){try{allPins.push([p,sha(await readFile(p))]);}catch{}}
const configs=[];for(const path of ['package.json','apps/webapp/package.json','pnpm-lock.yaml','pnpm-workspace.yaml','apps/webapp/next.config.ts'])configs.push({path,sha256:sha(await readFile(path))});
assert.equal(configs.find(x=>x.path==='pnpm-lock.yaml').sha256.toUpperCase(),'2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
const physical=[];for(const path of ['node_modules','apps/webapp/node_modules','node_modules/.pnpm']){assert.equal((await lstat(path)).isSymbolicLink(),false);physical.push({path,real:await realpath(path)});}
const links=[];for(const parent of ['node_modules','apps/webapp/node_modules'])for(const name of await readdir(parent)){const path=join(parent,name),s=await lstat(path);if(s.isSymbolicLink()){const target=await realpath(path);assert.ok(target.toLowerCase().startsWith(repo.toLowerCase()+'\\'));links.push({path,target});}else if(name.startsWith('@'))for(const child of await readdir(path)){const p=join(path,child);if((await lstat(p)).isSymbolicLink()){const target=await realpath(p);assert.ok(target.toLowerCase().startsWith(repo.toLowerCase()+'\\'));links.push({path:p,target});}}}
const source={head:git('rev-parse','HEAD'),pins,configs,physical,links,trackedSnapshot:{count:allPins.length,digest:sha(JSON.stringify(allPins))}};
await writeFile(join(out,'source-start.json'),JSON.stringify(source,null,2));
await writeFile(join(out,'tracked-pins-private.json'),JSON.stringify(allPins));
console.log(JSON.stringify({head:source.head,productionAndTestPaths:pins.length,trackedFiles:allPins.length,physicalParents:physical.length,internalLinks:links.length}));
