import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const [input,phase]=process.argv.slice(2),dir=resolve(input),out=resolve('.tmp/1830-root-checks/runtime');
assert.ok(['before','after'].includes(phase));await mkdir(out,{recursive:true});
const read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),services=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(services.label,'z8-performance-fixture-1450');
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const actor=f.actors['small-admin'],require=createRequire(resolve('apps/webapp/package.json')),{Pool}=require('pg');
const pool=new Pool({host:r.env.POSTGRES_HOST,port:Number(r.env.POSTGRES_PORT),database:r.env.POSTGRES_DB,user:r.env.POSTGRES_USER,password:r.env.POSTGRES_PASSWORD});
const sha=x=>createHash('sha256').update(x).digest('hex'),file='apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx';
const bytes=await readFile(file),result={phase,source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),path:file,sha256:sha(bytes),canonicalSha256:sha(bytes.toString('utf8').replaceAll('\r\n','\n'))},checks:[],captures:[],errors:[],requests:{aborted:0,held:0,completed:[]},qualification:'Real unchanged profile action and own-fixture PostgreSQL readback. These normal submission/recovery observations do not reproduce the microtask scope-arrival race, which is proven at the actual TanStack component seam. No cookie/state files are created, read or transferred.'};
const check=(name,condition)=>{assert.ok(condition,name);result.checks.push(name);};
const dbRead=async()=>({identity:(await pool.query('SELECT first_name,last_name FROM "user" WHERE email=$1',[actor.email])).rows[0],settings:(await pool.query('SELECT week_start_day,time_format,help_improve_product,onboarding_step FROM user_settings WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',[actor.email])).rows[0]});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});let held=null;
try {
 const context=await browser.createBrowserContext(),p=await context.newPage();p.setDefaultTimeout(45000);p.on('pageerror',e=>result.errors.push(e.message));await p.setViewport({width:1600,height:1000});await p.emulateTimezone('America/Los_Angeles');
 await p.goto(r.origin+'/en/sign-in',{waitUntil:'domcontentloaded',timeout:90000});
 const auth=await p.evaluate(async actor=>{const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:actor.email,password:actor.password})});if(!response.ok)return{signIn:response.status};const active=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:actor.organizationId})});return{signIn:response.status,active:active.status};},actor);
 assert.deepEqual(auth,{signIn:200,active:200});result.authentication={method:'normal BetterAuth endpoints in isolated ephemeral browser',...auth,cookieStateTransferred:false};
 await p.goto(r.origin+'/en/onboarding/profile',{waitUntil:'networkidle0',timeout:90000});await p.waitForFunction(()=>document.querySelector('#profile-first-name')&&!document.querySelector('button[type=submit]')?.disabled);
 const manifest=JSON.parse(await readFile('apps/webapp/.next/dev/server/server-reference-manifest.json','utf8'));
 const matches=Object.entries(manifest.node).filter(([,v])=>v.exportedName==='updateProfileOnboarding'&&Object.keys(v.workers??{}).some(k=>k.includes('/onboarding/profile/page')));assert.equal(matches.length,1);const actionId=matches[0][0];result.action={id:actionId,exportedName:'updateProfileOnboarding'};
 await p.type('#profile-first-name','Retained');await p.type('#profile-last-name','Profile');
 const before=await dbRead();await p.setRequestInterception(true);let aborted=false;
 p.on('request',req=>{if(req.method()==='POST'&&req.headers()['next-action']===actionId){if(!aborted){aborted=true;result.requests.aborted++;void req.abort('failed');}else{held=req;result.requests.held++;}}else void req.continue();});
 p.on('response',res=>{if(res.request().headers()['next-action']===actionId)result.requests.completed.push(res.status());});
 // Native Enter is preserved with the client submit handler.
 await p.focus('#profile-last-name');await p.keyboard.press('Enter');await p.waitForSelector('main [role=alert]');
 check('Enter submits through the actual action; one transport failure is recoverable',result.requests.aborted===1);
 check('Transport failure retains both names',await p.$eval('#profile-first-name',e=>e.value==='Retained')&&await p.$eval('#profile-last-name',e=>e.value==='Profile'));
 check('Failed transport made no profile/settings writes',JSON.stringify(await dbRead())===JSON.stringify(before));
 for(const [name,width,height]of [['desktop',1600,1000],['phone',390,844]]){
  await p.setViewport({width,height});await p.evaluate(()=>document.fonts.ready);
  const seen=await p.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,headings:[...document.querySelectorAll('main h1')].filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()),alert:document.querySelector('main [role=alert]')?.textContent.trim(),firstName:document.querySelector('#profile-first-name')?.value,lastName:document.querySelector('#profile-last-name')?.value}));
  assert.deepEqual(seen.headings,['Complete your profile']);assert.ok(seen.documentWidth<=width);assert.equal(seen.firstName,'Retained');assert.equal(seen.lastName,'Profile');
  const filename=phase+'-'+name+'.png',png=Buffer.from(await p.screenshot({path:join(out,filename),fullPage:true}));result.captures.push({name:filename,...seen,sha256:sha(png),source:result.source});
 }
 const retry=await p.$('::-p-aria(Retry save)');assert.ok(retry);await retry.click();
 await p.waitForFunction(()=>document.querySelector('#profile-first-name')?.disabled);assert.ok(held);check('Retry invokes exactly one pending real action',result.requests.held===1);
 await p.$eval('main form',form=>{form.requestSubmit();form.requestSubmit();});await p.keyboard.press('Enter');check('Pending Save/Enter cannot duplicate the action',result.requests.held===1);
 await held.continue();held=null;await p.waitForFunction(()=>location.pathname.endsWith('/onboarding/work-schedule'));
 const saved=await dbRead();check('Real retry persists the retained profile through the canonical owner',saved.identity.first_name==='Retained'&&saved.identity.last_name==='Profile');
 check('Time display/default product choice remain unchanged',saved.settings.week_start_day==='monday'&&saved.settings.time_format==='24h'&&saved.settings.help_improve_product===true);
 check('Successful response preserves authoritative admin continuation',result.requests.completed.length===1&&result.requests.completed[0]===200);check('No browser exceptions',result.errors.length===0);
 // Keep the real page connected while Next diagnoses itself; preserve raw results privately.
 const call=async(method,params)=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(30000)});assert.ok(response.ok);const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?raw.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).find(x=>x.id===1):JSON.parse(raw);};
 const listed=await call('tools/list');assert.ok(listed.result.tools.some(x=>x.name==='get_compilation_issues'));result.next={tools:listed.result.tools.map(x=>x.name),results:[]};
 for(const name of ['get_compilation_issues','get_errors'])result.next.results.push({name,result:await call('tools/call',{name,arguments:{}})});
 await context.close();
} finally {
 if(held)await held.abort('failed').catch(()=>{});
 await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();
}
console.log(JSON.stringify({phase,checks:result.checks.length,captures:result.captures.length,requests:result.requests,browserErrors:result.errors.length}));
