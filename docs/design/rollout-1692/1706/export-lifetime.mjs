// Real in-flight export lifetime and recovery. Success bodies are never substituted.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1706'),roundtrip=process.argv[3]==='roundtrip';
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth['small-admin'].cookies);const p=await c.newPage();p.setDefaultTimeout(30000);await p.goto(runtime.origin+'/en/analytics/work-hours',{waitUntil:'networkidle0',timeout:120000});
 const click=async(t,s='button')=>{await p.waitForFunction((t,s)=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length&&(n.textContent.trim()===t||n.getAttribute('aria-label')===t)),{},t,s);const n=await p.evaluateHandle((t,s)=>[...document.querySelectorAll(s)].find(n=>n.getClientRects().length&&(n.textContent.trim()===t||n.getAttribute('aria-label')===t)),t,s);assert.ok(n.asElement(),t);await n.asElement().click();};
 await p.waitForSelector('table');await click('Period');await click('Last Year','[role=option]');await p.waitForNetworkIdle({idleTime:500});
 await p.evaluate(()=>{window.__downloadCount=0;const old=URL.createObjectURL.bind(URL);URL.createObjectURL=b=>{window.__downloadCount++;return old(b);};});
 let held,ready,hold=true;const readyPromise=new Promise(r=>ready=r);await p.setRequestInterception(true);p.on('request',r=>{if(hold&&r.url().endsWith('/api/analytics/export')){held=r;ready();return;}void r.continue();});
 await click('Export');await click('Export as CSV','[role=menuitem]');await readyPromise;await click('Period');await click('Current Month','[role=option]');await p.waitForFunction(()=>document.body.innerText.includes('2026')&&document.querySelector('table'));
 if(roundtrip){await click('Period');await click('Last Year','[role=option]');await p.waitForFunction(()=>document.querySelector('section table tbody')?.innerText.includes('2,088.0h')&&!document.querySelector('[aria-label="Loading work hours analytics data"]'));}
 const response=p.waitForResponse(r=>r.url().endsWith('/api/analytics/export'));hold=false;await held.continue();assert.equal((await response).status(),200);await p.waitForNetworkIdle({idleTime:500});assert.equal(await p.evaluate(()=>window.__downloadCount),0);
 await click('Export');const recovered=p.waitForResponse(r=>r.url().endsWith('/api/analytics/export'));await click('Export as CSV','[role=menuitem]');assert.equal((await recovered).status(),200);await p.waitForFunction(()=>window.__downloadCount===1);
 await writeFile(join(out,roundtrip?'export-roundtrip-runtime.json':'export-lifetime-runtime.json'),JSON.stringify({oldPeriod:{status:200,downloadCount:0,meaning:roundtrip?'Real held Last Year export completed after Current Month and return to Last Year; root generation guard discarded it':'Real held Last Year export completed after Current Month selection and was discarded'},currentPeriod:{status:200,downloadCount:1,meaning:'Real current-period retry downloaded normally'}},null,2)+'\n');console.log('Verified real old-period export is discarded and current-period export recovers.');
}finally{await browser.close();}
