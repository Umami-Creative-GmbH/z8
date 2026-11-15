// pnpm node docs/design/rollout-1692/1703/runtime.mjs <private-fixture-directory> before|after
// Before runs untouched base source, before implementation. No response substitution.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const dir = resolve(process.argv[2]), mode = process.argv[3];
assert.ok(['before','after'].includes(mode));
const json = async f => JSON.parse(await readFile(join(dir, f), 'utf8'));
const runtime = await json('runtime-private.json'), fixture = await json('fixture-private.json'), auth = await json('dev-auth-private.json');
assert.equal(fixture.kind,'disposable'); assert.equal(new URL(runtime.origin).hostname,'localhost');
const out = resolve('docs/design/rollout-1692/1703'); await mkdir(out,{recursive:true});
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const context = await browser.createBrowserContext();
 await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
 await context.setCookie(...auth['small-admin'].cookies);
 const page = await context.newPage(); page.setDefaultTimeout(45000);
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const click=async(text,selector='button')=>{const n=await page.evaluateHandle((text,selector)=>[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length&&(n.textContent.trim()===text||n.getAttribute('aria-label')===text)),text,selector);assert.ok(n.asElement(),text);await n.asElement().click();await n.dispose();};
 await page.setViewport({width:1600,height:1000});
 await page.goto(runtime.origin+'/en/analytics/overtime-burn-down',{waitUntil:'networkidle0',timeout:120000});
 await page.waitForFunction(()=>document.body.innerText.includes('Current Overtime'));
 await click('Period'); await page.waitForSelector('[role=option]'); await click('Last Year','[role=option]');
 await page.waitForFunction(()=>document.body.innerText.includes('2025')&&!document.querySelector('output[aria-label="Loading analytics data"]'));
 await page.waitForNetworkIdle({idleTime:1000,timeout:45000});
 await page.waitForSelector('tbody tr');
 const checks=[];
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['wide-dark',2400,1200,true]]){
  await page.setViewport({width,height}); await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.screenshot({path:join(out,`${mode}-${name}.png`),fullPage:true});
  checks.push(await page.evaluate(name=>({name,width:innerWidth,documentWidth:document.documentElement.scrollWidth,h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),main:document.querySelector('main')?.innerText}),name));
 }
 const result={mode,scope:'same small-admin / Performance small / Last Year 2025; original synthetic fixture history; no data mutations',checks,errors};
 await writeFile(join(out,`${mode}-runtime.json`),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({mode,checks:checks.map(({main,...x})=>x),errors}));
}finally{await browser.close();}
