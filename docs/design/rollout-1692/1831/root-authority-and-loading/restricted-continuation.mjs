import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('.tmp/1831-root-checks/runtime');
const read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),s=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(s.containers.length,3);
for(const c of s.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),s.label);
const require=createRequire(resolve('apps/webapp/package.json')),{Pool}=require('pg'),pool=new Pool({host:r.env.POSTGRES_HOST,port:Number(r.env.POSTGRES_PORT),database:r.env.POSTGRES_DB,user:r.env.POSTGRES_USER,password:r.env.POSTGRES_PASSWORD});
const previous=JSON.parse(await readFile(join(out,'after.json'),'utf8'));
assert.equal(previous.checks.length,9);assert.deepEqual(previous.errors,[]);assert.deepEqual(previous.commands,{aborted:1,held:1,completed:[200]});
const result={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:[],checks:[],errors:[],qualification:'Separate continuation after the preceding run passed nine Save/readback checks but timed out only in member-page waitForNetworkIdle. This continuation uses a fresh normal member sign-in and explicit settled route/control assertions; no persisted browser state or cookies transferred.'};
for(const pin of previous.source){const b=await readFile(pin.path),canonicalSha256=createHash('sha256').update(b.toString('utf8').replaceAll('\r\n','\n')).digest('hex');assert.equal(canonicalSha256,pin.canonicalSha256);result.source.push({path:pin.path,canonicalSha256});}
const check=(n,v)=>{assert.ok(v,n);result.checks.push(n);};
const actor=f.actors['small-restricted'],snapshot=async()=>({policies:(await pool.query('select id,name from vacation_allowance where organization_id=$1 order by id',[actor.organizationId])).rows,settings:(await pool.query('select onboarding_step from user_settings where user_id=(select id from "user" where email=$1)',[actor.email])).rows});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const page=await browser.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>result.errors.push(e.message));await page.goto(r.origin+'/en/sign-in',{waitUntil:'domcontentloaded',timeout:90000});
 const status=await page.evaluate(async actor=>{const a=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:actor.email,password:actor.password})});if(!a.ok)return{signIn:a.status};const b=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:actor.organizationId})});return{signIn:a.status,active:b.status};},actor);assert.deepEqual(status,{signIn:200,active:200});
 const path='/en/onboarding/vacation-policy';await page.goto(r.origin+path,{waitUntil:'domcontentloaded',timeout:90000});await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications')&&!!document.querySelector('main h1')&&!document.querySelector('#vacation-policy-name'));
 check('Real member page admission redirects to the settled notifications task without policy controls',await page.$('#vacation-policy-name')===null);
 const before=await snapshot(),action=previous.actions;
 result.restrictedActions=await page.evaluate(async({path,action})=>{const results=[];for(const[name,args]of[['createVacationPolicyOnboarding',[{name:'Refused member policy',defaultAnnualDays:25,accrualType:'annual',allowCarryover:true,maxCarryoverDays:5}]],['skipVacationPolicySetup',[]]]){const response=await fetch(path,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8','next-action':action[name]},body:JSON.stringify(args)});const raw=await response.text();let result;for(const line of raw.split('\n')){const at=line.indexOf(':');if(at<0)continue;try{const candidate=JSON.parse(line.slice(at+1));if(typeof candidate?.success==='boolean')result=candidate;}catch{}}results.push({name,http:response.status,success:result?.success??null,code:result?.code??null});}return results;},{path,action});
 check('Both real direct member commands return typed authority refusal',result.restrictedActions.every(x=>x.http===200&&x.success===false&&x.code==='AuthorizationError'));
 check('Refused member commands make no policy or progress writes',JSON.stringify(await snapshot())===JSON.stringify(before));
 const call=async(method,params)=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(30000)});assert.ok(response.ok);const text=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?text.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).find(x=>x.id===1):JSON.parse(text);};
 result.next=[];for(const name of ['get_compilation_issues','get_errors'])result.next.push({name,result:await call('tools/call',{name,arguments:{}})});
 check('No browser exceptions',result.errors.length===0);
}finally{await writeFile(join(out,'restricted-continuation.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
console.log(JSON.stringify({checks:result.checks.length,refusedActions:result.restrictedActions,browserErrors:result.errors.length}));
