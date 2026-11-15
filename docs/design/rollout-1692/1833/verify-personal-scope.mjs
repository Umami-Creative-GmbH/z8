// Public auth endpoints + actual personal onboarding actions. No membership writes/deletion.
import puppeteer from 'puppeteer-core';import{readFile,writeFile}from'node:fs/promises';import{resolve,join}from'node:path';
const dir=resolve(process.argv[2]||'.tmp/1833/fixture'),out=resolve('docs/design/rollout-1692/1833');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
if(fixture.kind!=='disposable'||services.label!=='z8-performance-fixture-1450'||new URL(runtime.origin).hostname!=='localhost'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Disposable loopback only');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.createBrowserContext();await context.setCookie(...auth['small-restricted'].cookies);const page=await context.newPage();
const checks=[];const check=(name,passed)=>{checks.push({name,passed});if(!passed)throw Error(name)};
const go=async path=>{await page.goto(runtime.origin+'/en'+path,{waitUntil:'networkidle2',timeout:120000});await page.waitForSelector('#wellness-enable-reminder')};
const click=async label=>{const el=(await page.waitForFunction(label=>[...document.querySelectorAll('form button')].find(e=>e.textContent.trim()===label),{},label)).asElement();await el.click()};
try{
await go('/onboarding/wellness');
const unavailable=await page.evaluate(async id=>(await fetch('/api/auth/organization/get-full-organization?organizationId='+id)).status,fixture.actors['large-admin'].organizationId);check('restricted actor cannot read unrelated organization before preferences',unavailable>=400);
const cleared=await page.evaluate(async()=> (await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:null})})).status);check('real active organization can be cleared without membership mutation',cleared===200);
await go('/onboarding/wellness');await click('Skip for now');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications'));check('real no-organization skip continues to notifications',true);
await go('/onboarding/wellness');await page.click('#wellness-enable-reminder');await click('Continue');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications'));check('real no-organization disabled save continues to notifications',true);
const active=await page.evaluate(async()=>{const r=await fetch('/api/auth/get-session');const s=await r.json();return s?.session?.activeOrganizationId??null});check('personal save does not assign an active organization',active===null);
const stillUnavailable=await page.evaluate(async id=>(await fetch('/api/auth/organization/get-full-organization?organizationId='+id)).status,fixture.actors['large-admin'].organizationId);check('personal save grants no unrelated organization access',stillUnavailable>=400);
const restored=await page.evaluate(async id=>(await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:id})})).status,fixture.actors['small-restricted'].organizationId);check('existing approved membership restores organization through its owner',restored===200);
await page.goto(runtime.origin+'/en/settings/wellness',{waitUntil:'networkidle2',timeout:120000});await page.waitForSelector('input[type=range]');check('personal disabled preference survives organization restoration and public settings readback',await page.$eval('input[type=range]',e=>e.disabled));
console.log('Passed '+checks.length+' real personal/organization boundary assertions.');
}finally{await writeFile(join(out,'personal-scope-runtime.json'),JSON.stringify({classification:'real restricted fixture session, public organization/session endpoints and actual save/skip/settings actions; no membership mutation',checks},null,2));await browser.close()}
