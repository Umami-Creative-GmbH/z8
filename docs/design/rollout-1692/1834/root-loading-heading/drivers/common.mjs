import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
export const repo=resolve(process.cwd());
export const baseline='bd160d9af22214d473ea603870cdc161572bbcad';
export const corrected='1230f61742be73ba436532cb1d1ad2ba61aa0cad';
export const client='apps/webapp/src/app/[locale]/onboarding/work-schedule/page-client.tsx';
export const route='/en/onboarding/work-schedule';
export const selector='#work-schedule-hours-per-week';
export const heading='Set your work schedule';
export const requireRoot=createRequire(join(repo,'package.json'));
export const requireWeb=createRequire(join(repo,'apps/webapp/package.json'));
export const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=b=>b.toString('utf8').replaceAll('\r\n','\n');
export async function sourceProof(phase){
 assert.ok(['before','after'].includes(phase),'Expected before or after');
 const paths=[client,'apps/webapp/src/app/[locale]/onboarding/work-schedule/work-schedule-fields.tsx','apps/webapp/src/app/[locale]/onboarding/work-schedule/actions.ts','apps/webapp/src/lib/effect/services/onboarding.service.ts'];
 const source=[];
 for(const path of paths){
  const ref=path===client&&phase==='before'?baseline:corrected;
  const expected=execFileSync('git',['show',ref+':'+path],{cwd:repo,windowsHide:true,maxBuffer:20*1024*1024});
  const actual=await readFile(join(repo,path));
  const entry={path,expectedCommit:ref,expectedCanonicalSha256:sha(canonical(expected)),canonicalSha256:sha(canonical(actual)),bytesSha256:sha(actual)};
  assert.equal(entry.canonicalSha256,entry.expectedCanonicalSha256,'Source pin mismatch: '+path);
  source.push(entry);
 }
 return{head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),baseline,corrected,source};
}
export async function fixtureFromPointer(pointer){
 assert.ok(pointer,'Expected fixture pointer pathname');
 const dir=resolve((await readFile(resolve(pointer),'utf8')).trim());
 const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
 const runtime=await read('runtime-private.json'),fixture=await read('fixture-private.json'),services=await read('services.json');
 assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
 assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');
 assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
 assert.ok(Array.isArray(services.containers)&&services.containers.length>0);assert.ok(services.label);
 for(const container of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
 return{runtime,fixture};
}
export async function actionsForRoute(){
 const manifest=JSON.parse(await readFile(join(repo,'apps/webapp/.next/dev/server/server-reference-manifest.json'),'utf8')),actions={};
 for(const name of ['checkIsAdmin','setWorkScheduleOnboarding','skipWorkScheduleSetup']){
  const found=Object.entries(manifest.node).filter(([,entry])=>entry.exportedName===name&&Object.keys(entry.workers??{}).some(worker=>worker.includes('/onboarding/work-schedule/page')));
  assert.equal(found.length,1,'One compiled work-schedule action: '+name);actions[name]=found[0][0];
 }
 return actions;
}
export async function outputDir(path){assert.ok(path,'Expected output directory');const out=resolve(path);await mkdir(out,{recursive:true});return out;}
export const save=(out,name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
export const failure=error=>({name:error?.name??'Error',message:error?.message??String(error),stack:error?.stack});
export async function normalSignIn(page,runtime,actor){
 assert.ok(actor?.email&&actor?.password&&actor?.organizationId,'Fixture actor incomplete');
 await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'domcontentloaded',timeout:90000});
 const status=await page.evaluate(async actor=>{
  const first=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:actor.email,password:actor.password})});
  if(!first.ok)return{signIn:first.status};
  const second=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:actor.organizationId})});
  return{signIn:first.status,active:second.status};
 },actor);
 assert.deepEqual(status,{signIn:200,active:200});return status;
}