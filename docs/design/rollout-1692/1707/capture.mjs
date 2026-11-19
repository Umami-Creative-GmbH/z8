// Same disposable scope before/after; never replaces app responses.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]), mode=process.argv[3];
assert.ok(['before','after'].includes(mode));
const load=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await load('runtime-private.json'), fixture=await load('fixture-private.json'), auth=await load('dev-auth-private.json');
assert.equal(fixture.kind,'disposable'); assert.equal(new URL(runtime.origin).hostname,'localhost');
const out=resolve('docs/design/rollout-1692/1707');await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth['small-manager'].cookies);
 const page=await c.newPage();page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1600,height:1000});await page.goto(runtime.origin+'/en/approvals',{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('tbody');
 const checks=[];
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['wide-dark',2400,1200,true]]) {
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.screenshot({path:join(out,`${mode}-${name}.png`),fullPage:true});
  checks.push(await page.evaluate(name=>({name,width:innerWidth,documentWidth:document.documentElement.scrollWidth,h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),main:document.querySelector('main')?.innerText,tabs:[...document.querySelectorAll('[role=tab]')].map(n=>({text:n.textContent,selected:n.getAttribute('aria-selected')}))}),name));
 }
 await writeFile(join(out,`${mode}-runtime.json`),JSON.stringify({mode,scope:'small-manager / Performance small, original seeded pending requests; same fixture before mutations',checks,errors},null,2)+'\n');
 console.log(JSON.stringify({mode,checks:checks.map(({main,...rest})=>rest),errors}));
}finally{await browser.close();}
