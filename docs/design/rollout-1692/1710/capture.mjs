import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),mode=process.argv[3];
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
const out=resolve('docs/design/rollout-1692/1710');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-manager'].cookies);
 const page=await context.newPage();page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(runtime.origin+'/en/approvals/inbox',{waitUntil:'networkidle0',timeout:120000});
 const list=await page.evaluate(async()=>{const r=await fetch('/api/approvals/inbox?status=pending&limit=20');if(!r.ok)throw Error('Inbox refused');return r.json();});assert.equal(list.items.length,2);
 const item=list.items[0],path=`/en/approvals/review/${fixture.actors['small-manager'].organizationId}/compatibility/${item.id}`;
 await writeFile(join(dir,'target-private.json'),JSON.stringify({path,item}));
 await page.setViewport({width:1600,height:1000});await page.goto(runtime.origin+path,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('[role=dialog]');
 await page.screenshot({path:join(out,`${mode}-detail.png`),fullPage:true});await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 const checks=[];
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['wide-dark',2400,1200,true]]){
 await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);await page.screenshot({path:join(out,`${mode}-${name}.png`),fullPage:true});
 const c=await page.evaluate(name=>({name,width:innerWidth,documentWidth:document.documentElement.scrollWidth,h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),main:document.querySelector('main')?.innerText}),name);assert.equal(c.documentWidth,width);checks.push(c);
 }
 await writeFile(join(out,`${mode}-runtime.json`),JSON.stringify({mode,actor:'small-manager',scope:'same two actual submitted deletions; no decisions between captures',target:item.id,checks,errors},null,2)+'\n');console.log(JSON.stringify({mode,checks:checks.map(({main,...c})=>c),errors}));
}finally{await browser.close();}
