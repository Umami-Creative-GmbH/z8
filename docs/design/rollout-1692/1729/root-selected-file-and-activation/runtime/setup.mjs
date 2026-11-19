import {readFile,writeFile,readdir,lstat,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=resolve('.tmp/1729-root-checks/runtime');
const paths=execFileSync('git',['diff','--name-only','cab40dcbb6ea69cefb7aa919228298a881a66060','HEAD','--','apps/webapp/src'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(p=>p&&!/\.test\./.test(p));
const sha=b=>createHash('sha256').update(b).digest('hex');
const pins=[];for(const path of paths){const b=await readFile(path);pins.push({path,raw:sha(b),lf:sha(b.toString().replaceAll('\r\n','\n'))});}
const configs=[];for(const path of ['package.json','apps/webapp/package.json','pnpm-lock.yaml','pnpm-workspace.yaml','apps/webapp/next.config.ts']){try{configs.push({path,sha256:sha(await readFile(path))});}catch{}}
assert.equal(configs.find(p=>p.path==='pnpm-lock.yaml').sha256.toUpperCase(),'2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799');
const physical=[];for(const path of ['node_modules','apps/webapp/node_modules','node_modules/.pnpm']){assert.equal((await lstat(path)).isSymbolicLink(),false);physical.push({path,real:await realpath(path)});}
const links=[];for(const parent of ['node_modules','apps/webapp/node_modules'])for(const name of await readdir(parent)){const path=join(parent,name),s=await lstat(path);if(s.isSymbolicLink()){const target=await realpath(path);assert.ok(target.toLowerCase().startsWith(resolve('.').toLowerCase()+'\\'));links.push({path,target});}else if(name.startsWith('@'))for(const child of await readdir(path)){const p=join(path,child);if((await lstat(p)).isSymbolicLink()){const target=await realpath(p);assert.ok(target.toLowerCase().startsWith(resolve('.').toLowerCase()+'\\'));links.push({path:p,target});}}}
await writeFile(join(out,'source-start.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pins,configs,physical,links},null,2));
let common=await readFile('.tmp/1728-root-checks/acceptance/common.mjs','utf8');common=common.replaceAll(".tmp/1728-root-checks/acceptance",".tmp/1729-root-checks/runtime").replaceAll(".tmp/1728-root-fixture-pointer.txt",".tmp/1729-root-checks/runtime/fixture-pointer-private.txt").replaceAll('1728','1729');
await writeFile(join(out,'common.mjs'),common);
await writeFile(join(out,'attempt-01-pnpm-engine-lock.txt'),'Fixture prepare initial sandbox call failed ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK: C:\\Users\\KaiHentschel\\AppData\\Local\\pnpm-store-operation-locks\\all-stores.lock access denied. Approved require_escalated retry prepared fresh fixture. No install.\n');
console.log(JSON.stringify({productionPaths:pins.length,internalLinks:links.length,physicalParents:physical.length,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()}));
