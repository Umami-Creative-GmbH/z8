import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { readOwnedFixtureDirectory } from './owned-fixture-path.mjs';
export const repo=resolve(process.cwd());
export async function fixtureFromPointer(pointer){
 const directory=await readOwnedFixtureDirectory(repo,pointer),json=async p=>JSON.parse((await readFile(join(directory,p),'utf8')).replace(/^\ufeff/,''));
 const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),services=await json('services.json');
 assert.equal(fixture.kind,'disposable');const u=new URL(runtime.origin);assert.equal(u.hostname,'localhost');assert.equal(u.protocol,'http:');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
 assert.equal(services.label,'z8-performance-fixture-1450');assert.equal(services.containers.length,3);
 for(const name of services.containers){assert.match(name,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',name],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
 return{runtime,fixture,directory};
}
export async function normalSignIn(page,runtime,actor){
 assert.ok(actor?.email&&actor?.password&&actor?.organizationId);await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'domcontentloaded',timeout:90000});
 const status=await page.evaluate(async actor=>{const a=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:actor.email,password:actor.password})});if(!a.ok)return{signIn:a.status};const b=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:actor.organizationId})});return{signIn:a.status,active:b.status};},actor);
 assert.deepEqual(status,{signIn:200,active:200});return status;
}
export const save=(out,name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
export const failure=error=>({name:error?.name??'Error',message:error?.code==='ERR_ASSERTION'?'Assertion failed; inspect named checks and private diagnostics.':'Runtime driver failed; inspect private diagnostics locally.'});
export async function outputDir(path){const out=resolve(path);await mkdir(out,{recursive:false});return out;}
export async function sourceProof(phase,ref){assert.equal(phase,'after');const declared=JSON.parse(await readFile(join(repo,'.tmp/1835-root-checks/declared-runtime-after.json'),'utf8'));assert.equal(declared.sourceCommit,ref);for(const pin of declared.sourcePins){const canonical=(await readFile(join(repo,pin.path),'utf8')).replaceAll('\r\n','\n');assert.equal(createHash('sha256').update(canonical).digest('hex'),pin.canonicalSha256);}return declared;}
export async function nextMcp(origin){
 const rpc=async(method,params)=>{const response=await fetch(origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});assert.ok(response.ok);const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?raw.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).find(x=>x.id===1):JSON.parse(raw);};
 const list=await rpc('tools/list',{}),available=list.result?.tools?.map(t=>t.name)??[],observations=[];for(const name of ['get_page_metadata','get_compilation_issues','get_errors'].filter(n=>available.includes(n)))observations.push({name,response:await rpc('tools/call',{name,arguments:{}})});return{available,observations};
}
