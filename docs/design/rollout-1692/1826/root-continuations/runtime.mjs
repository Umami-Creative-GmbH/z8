import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHmac,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=process.argv[2],phase=process.argv[3],out=resolve('.tmp/1826-root-runtime');await mkdir(out,{recursive:true});
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(resolve('apps/webapp/package.json'))('pg'),pool=new Pool({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
const actor=fixture.actors['small-admin'],person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
const other=(await pool.query('SELECT id,name FROM organization WHERE id<>$1 ORDER BY id LIMIT 1',[actor.organizationId])).rows[0];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);
const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});
const result={phase,classification:'Real local auth and client navigation; held actual successful response, no provider requests',checks:[],captures:[],pageErrors:[]};
page.on('pageerror',error=>result.pageErrors.push(error.message));
const check=(name,passed,details)=>{assert.ok(passed,name);result.checks.push({name,passed:true,...(details?{details}:{})});console.log('Passed: '+name);};
const post=async(path,body)=>page.evaluate(async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};},path,body);
const otp=uri=>{const secret=new URL(uri).searchParams.get('secret');let bits='';for(const c of secret.toUpperCase().replace(/=+$/,''))bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();return((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).toString().padStart(6,'0');};
const mfaUrl=id=>`${runtime.origin}/en/mfa?organizationId=${id}&callbackUrl=%2Fen%2Flicenses`;
const open=async()=>{await page.goto(mfaUrl(actor.organizationId),{waitUntil:'domcontentloaded'});await page.waitForSelector('input[name="code"]:not(:disabled)');};
const button=async name=>(await page.waitForFunction(name=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===name&&el.getBoundingClientRect().width>0),{},name)).asElement();
const submit=async code=>{const input=await page.$('input[name="code"]');await input.focus();await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await input.type(code);await page.keyboard.press('Enter');};
const capture=async label=>{
 await page.evaluate(()=>document.fonts.ready);const mask=await page.addStyleTag({content:'input[name="code"] { -webkit-text-security: disc !important; }'});
 const name=`${phase}-${label}.png`;await page.screenshot({path:join(out,name),fullPage:true});await mask.dispose();
 const png=await readFile(join(out,name));const paths=['apps/webapp/src/app/[locale]/mfa/page.tsx','apps/webapp/src/components/organization-mfa/requirements.tsx','apps/webapp/src/components/organization-mfa/verification.tsx','apps/webapp/src/components/organization-mfa/sign-out.tsx'];
 result.captures.push({name,codeFieldRedacted:true,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},...await page.evaluate(()=>({css:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.body).fontFamily,rootFont:getComputedStyle(document.documentElement).fontSize,fonts:document.fonts.status,pathname:location.pathname}))});
};
let cdp;
try {
 if(phase==='setup'){
  await pool.query("INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES('root-mfa-other-membership',$1,$2,'member','approved',now()) ON CONFLICT(id) DO NOTHING",[person,other.id]);
  for(const id of [actor.organizationId,other.id])await pool.query('INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES($1,true,0,$2) ON CONFLICT(organization_id) DO UPDATE SET enabled=true,grace_period_days=0',[id,person]);
  await open();
  check('synthetic actor reaches real MFA route',new URL(page.url()).pathname==='/en/mfa');
  check('actual password verification succeeds',(await post('/api/auth/organization-mfa/verify-password',{password:actor.password})).status===200);
  const enrollment=await post('/api/auth/two-factor/enable',{password:actor.password});assert.equal(enrollment.status,200);assert.ok(enrollment.body.totpURI);
  await writeFile(join(directory,'root-enrollment-private.json'),JSON.stringify(enrollment.body),{mode:0o600});
  const verified=await post('/api/auth/two-factor/verify-totp',{code:otp(enrollment.body.totpURI),trustDevice:false});check('real synthetic authenticator enrollment is confirmed',verified.status===200);
 }else{
  const enrollment=await json('root-enrollment-private.json');await open();
  check('primary verification renews through real endpoint',(await post('/api/auth/organization-mfa/verify-password',{password:actor.password})).status===200);
  cdp=await page.createCDPSession();let release,held;const received=new Promise(done=>release=done);
  cdp.on('Fetch.requestPaused',event=>{held=event;release();});await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/two-factor/verify-totp',requestStage:'Response'}]});
  let initRequests=0;page.on('request',request=>{if(request.isNavigationRequest()&&new URL(request.url()).pathname==='/init')initRequests++;});
  await page.evaluate(()=>{window.__mfaInput=document.querySelector('input[name="code"]');});
  await submit(otp(enrollment.totpURI));await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(Error('Actual TOTP response was not intercepted')),45000))]);
  const body=await cdp.send('Fetch.getResponseBody',{requestId:held.requestId});const response=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body);check('held response is an actual successful TOTP',held.responseStatusCode===200&&!response.error,{status:held.responseStatusCode});
  const link=(await page.waitForFunction(id=>[...document.querySelectorAll('a')].find(el=>new URL(el.href).searchParams.get('organizationId')===id),{},other.id)).asElement();await link.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(id=>new URL(location.href).searchParams.get('organizationId')===id,{},other.id);await page.waitForSelector('input[name="code"]:not(:disabled)');
  check('real organization link enters B while TOTP response is held',new URL(page.url()).searchParams.get('organizationId')===other.id);
  await page.evaluate(()=>history.back());await page.waitForFunction(id=>new URL(location.href).searchParams.get('organizationId')===id,{},actor.organizationId);await page.waitForSelector('input[name="code"]');
  result.cachedInputRestored=await page.evaluate(()=>document.querySelector('input[name="code"]')===window.__mfaInput);
  await cdp.send('Fetch.continueResponse',{requestId:held.requestId});await cdp.send('Fetch.disable');
  await page.evaluate(()=>new Promise(done=>setTimeout(done,1800)));
  result.staleInitRequests=initRequests;result.staleCompletionPath=new URL(page.url()).pathname;
  if(phase==='before'){
   check('baseline reproduces an abandoned verification continuation',initRequests>0,{initRequests});
  }else{
   check('abandoned successful response sends no init navigation',initRequests===0&&new URL(page.url()).pathname==='/en/mfa',{cachedInputRestored:result.cachedInputRestored});
   await capture('stale-success-discarded');
   const denied=page.waitForResponse(r=>r.url().endsWith('/two-factor/verify-totp'));
   const valid=otp(enrollment.totpURI);await submit(valid==='000000'?'111111':'000000');const invalid=await denied;const invalidBody=await invalid.json();
   check('invalid TOTP after renewed primary verification is rejected cryptographically',invalid.status()>=400&&!JSON.stringify(invalidBody).includes('password before'));
   await page.waitForSelector('input[name="code"]:not(:disabled)');await capture('invalid-code-refused');
   const accepted=page.waitForResponse(r=>r.url().endsWith('/two-factor/verify-totp'));await submit(otp(enrollment.totpURI));check('new explicit current verification succeeds',(await accepted).status()===200);
   await page.waitForFunction(()=>location.pathname==='/en/licenses');check('new action follows existing init and safe callback',initRequests===1);await capture('current-success');
  }
  assert.deepEqual(result.pageErrors,[]);
 }
}catch(error){result.failure=error.message;throw error;}
finally{
 auth['small-admin'].cookies=await context.cookies();await writeFile(join(directory,'dev-auth-private.json'),JSON.stringify(auth),{mode:0o600});await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2)+'\n');
 await browser.close();await pool.end();
}
