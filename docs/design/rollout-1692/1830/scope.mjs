// Real Better Auth scope changes while actual save/skip HTTP responses are held.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=resolve(process.argv[2]);const json=async n=>JSON.parse(await readFile(join(directory,n),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const result={source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),profileSha256:createHash('sha256').update(await readFile('apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx')).digest('hex')},checks:[]};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 for(const scope of ['organization','account'])for(const action of ['save','skip']){
  const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);
  const p=await context.newPage();p.setDefaultTimeout(30000);await p.goto(runtime.origin+'/en/onboarding/profile',{waitUntil:'networkidle0'});await p.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  await p.type('#profile-first-name','Scope');await p.type('#profile-last-name','Draft');
  const cdp=await p.createCDPSession();let held=null;
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/onboarding/profile',requestStage:'Response'}]});
  cdp.on('Fetch.requestPaused',ev=>{if(ev.request.method==='POST')held=ev;else cdp.send('Fetch.continueRequest',{requestId:ev.requestId}).catch(()=>{});});
  if(action==='save')await p.click('button[type=submit]');else await p.$eval('button',()=>{}).then(async()=>{const b=await p.$('::-p-text(Skip for now)');await b.click();});
  for(let n=0;n<300&&!held;n++)await new Promise(r=>setTimeout(r,50));assert.ok(held,'HTTP response held after actual server action');
  const readSession=async()=>{const r=await p.waitForResponse(r=>r.url().includes('/api/auth/get-session')&&r.status()===200);return r.json();};
  const refresh=async()=>{const request=readSession();await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await request;};
  // Better Auth throttles focus refresh for five seconds. Keep that guard.
  if(scope==='organization'){
   const change=async id=>{const ok=await p.evaluate(async organizationId=>(await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})})).ok,id);assert.ok(ok,'real authorized active-org update');await new Promise(r=>setTimeout(r,5100));await refresh();};
   await change(null);await change(fixture.actors['small-admin'].organizationId);
  }else{
   for(const label of ['small-restricted','small-admin']){await context.deleteCookie(...await context.cookies());await context.setCookie(...auth[label].cookies);await new Promise(r=>setTimeout(r,5100));await refresh();await p.waitForFunction(()=>document.querySelector('#profile-first-name')?.value==='');}
  }
  await cdp.send('Fetch.continueResponse',{requestId:held.requestId});await cdp.send('Fetch.disable');
  await p.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  assert.ok(p.url().endsWith('/onboarding/profile'),'obsolete response did not navigate');
  assert.equal(await p.$eval('#profile-first-name',e=>e.value),scope==='organization'?'Scope':'');
  result.checks.push({scope,action,actualResponseHeld:true,roundTrip:true,noObsoleteNavigation:true,draft:scope==='organization'?'retained for same account':'cleared across accounts'});
  await context.close();
 }
}finally{await writeFile('docs/design/rollout-1692/1830/scope.json',JSON.stringify(result,null,2));await browser.close();}
