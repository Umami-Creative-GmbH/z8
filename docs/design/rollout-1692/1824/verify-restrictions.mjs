// Real public device refusals and real admin revocation; no response replacement.
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1824');
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),seed=await json('kiosk-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),{token}=await json('device-private.json');
assert.equal(fixture.kind,'disposable');assert.match(runtime.origin,/^http:\/\/localhost:\d+$/);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const evidence={checks:[]};
const ok=(check,detail)=>{evidence.checks.push({check,detail});console.log('PASS '+check);};
const page=await browser.newPage();
const api=async(path,body,withToken=true)=>{const r=await fetch(runtime.origin+'/api/kiosk/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(withToken?{'x-kiosk-token':token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
try{
 const missing=await api('session',undefined,false);assert.equal(missing.status,401);ok('unpaired API refuses missing device token',missing.status);
 const reused=await api('pair',{code:seed.pairingCode},false);assert.equal(reused.status,401);ok('consumed pairing code refuses reuse',reused.status);
 const foreign=await api('employee-status',{employeeId:fixture.actors['large-employee'].employeeId,pin:seed.pins['small-employee']});assert.notEqual(foreign.status,200);ok('foreign organization employee refused',foreign.body.code);
 const employeeId=fixture.actors['small-restricted'].employeeId;let failures=[];const wrong=seed.pins['small-restricted']==='0000'?'1111':'0000';
 for(let i=0;i<5;i++){const r=await api('employee-status',{employeeId,pin:wrong});failures.push({status:r.status,code:r.body.code});}
 const locked=await api('employee-status',{employeeId,pin:seed.pins['small-restricted']});assert.equal(locked.body.code,'pin_locked');ok('five real wrong PIN attempts enforce lockout even with correct PIN',{failures,correctAfterLock:{status:locked.status,code:locked.body.code}});
 const restricted=await browser.createBrowserContext();await restricted.setCookie(...auth['small-restricted'].cookies);const rp=await restricted.newPage();await rp.goto(runtime.origin+'/en/settings/kiosks',{waitUntil:'networkidle2',timeout:120000});await rp.waitForFunction(()=>!document.body.innerText.includes('Loading application'),{timeout:45000});assert.ok(!(await rp.$eval('body',n=>n.innerText)).includes('Add kiosk'));ok('restricted actual account cannot manage kiosk settings',{path:new URL(rp.url()).pathname});await restricted.close();
 const admin=await browser.createBrowserContext();await admin.setCookie(...auth['small-admin'].cookies);const ap=await admin.newPage();await ap.goto(runtime.origin+'/en/settings/kiosks',{waitUntil:'networkidle2',timeout:120000});await ap.waitForFunction(()=>document.body.innerText.includes('R025 entrance kiosk'),{timeout:45000});
 let revoke;
 for(const tr of await ap.$$('tr'))if((await tr.evaluate(n=>n.innerText)).includes('R025 entrance kiosk'))for(const b of await tr.$$('button'))if((await b.evaluate(n=>n.getAttribute('aria-label')||n.innerText)).toLowerCase().includes('revoke'))revoke=b;
 assert.ok(revoke,'Owned kiosk revoke control');await revoke.click();await ap.waitForSelector('[role=alertdialog]');
 for(const b of await ap.$$('[role=alertdialog] button'))if((await b.evaluate(n=>n.innerText.trim()))==='Revoke kiosk')await b.click();
 await ap.waitForFunction(()=>!document.querySelector('[role=alertdialog]'),{timeout:45000});
 const revoked=await api('session');assert.equal(revoked.body.code,'kiosk_revoked');
 await page.goto(runtime.origin+'/en/kiosk',{waitUntil:'networkidle2'});await page.evaluate(token=>localStorage.setItem('z8.kiosk.deviceToken',token),token);await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.innerText.includes('Kiosk revoked'));await page.screenshot({path:join(out,'after-revoked.png'),fullPage:true});
 assert.equal(await page.$('main input'),null);ok('actual authorized admin revocation removes device authority',{status:revoked.status,code:revoked.body.code,screen:'Kiosk revoked; pair with new code available'});await admin.close();
 await writeFile(join(out,'restrictions.json'),JSON.stringify(evidence,null,2));
}finally{await browser.close();}
