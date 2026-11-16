import puppeteer from 'puppeteer-core';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {prepareFixtureBrowserContext}=await import(pathToFileURL(resolve('scripts/performance/journey-steps.mjs')).href);
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('before or after required');
const dir=resolve('.tmp/1749/fixture'),out=resolve('docs/design/rollout-1692/1749');
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')),fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(fixture.kind!=='disposable'||new URL(runtime.origin).hostname!=='localhost')throw Error('Own disposable loopback fixture only');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--disable-extensions']});
try{
const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);const page=await context.newPage();await page.goto(`${runtime.origin}/en/sign-in`,{waitUntil:'networkidle0'});
const login=await page.evaluate(async actor=>{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:actor.email,password:actor.password})});if(!r.ok)return false;return (await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:actor.organizationId})})).ok;},fixture.actors['small-admin']);
if(!login)throw Error('Normal fixture login failed');await page.setViewport({width:1600,height:1000});await page.goto(`${runtime.origin}/en/travel-expenses/finance`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.innerText.includes('€69.40 outstanding'));
const menu=role=>page.locator(`[role=${role}]`);
async function clickNamed(role,name){await page.waitForFunction((role,name)=>[...document.querySelectorAll(`[role=${role}]`)].some(el=>el.textContent?.includes(name)),{},role,name);for(const handle of await page.$$(`[role=${role}]`)){if(await handle.evaluate((el,name)=>el.textContent?.includes(name),name)){if(await handle.boundingBox()){await handle.click();return;}}}throw Error(`Visible ${role} control missing`);}
async function preferences(font,theme){
 await page.locator('button[aria-label^="Account:"]').click();await clickNamed('menuitem','Font size');await clickNamed('menuitemradio',font);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 let clicked=false;for(const button of await page.$$('button')){if(await button.evaluate(el=>el.textContent?.includes('Toggle theme'))){const box=await button.boundingBox();if(box&&box.width>0&&box.height>0){await button.click();clicked=true;break;}}}if(!clicked)throw Error('Visible theme trigger missing');await clickNamed('menuitem',theme);await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.innerText.includes('€69.40 outstanding'));await page.evaluate(()=>document.fonts.ready);
}
const paths=[...JSON.parse(await readFile('.tmp/1749/overlay/manifest.json','utf8')).map(file=>file.path),'apps/webapp/src/components/travel-expenses/finance/finance-heading.tsx','apps/webapp/src/components/travel-expenses/finance/use-finance-command.ts'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');const sources=[];for(const path of paths)sources.push({path,sha256:hash(await readFile(path))});
for(const [theme,font,label]of [['Light','Default','light'],['Dark','Large','dark18']]){
 await preferences(font,theme);const observations=[];
 for(const[name,width,height]of [['desktop',1600,1000],['phone',390,844],['wide',2400,1200]]){
 await page.setViewport({width,height});await page.evaluate(()=>document.fonts.ready);await new Promise(done=>setTimeout(done,400));
 const geometry=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},font:getComputedStyle(document.documentElement).fontSize,dark:document.documentElement.classList.contains('dark'),notifications:Notification.permission,blockingDialogs:document.querySelectorAll('[role=dialog],[role=alertdialog]').length,overflow:document.documentElement.scrollWidth>innerWidth,headings:[...document.querySelectorAll('h1')].map(el=>el.textContent),accounts:[...document.querySelectorAll('main a[href*="/travel-expenses/"]')].map(el=>({href:el.getAttribute('href'),label:el.textContent})).filter(el=>!el.label.includes('Back'))}));
 if(geometry.notifications!=='denied'||geometry.blockingDialogs||geometry.overflow)throw Error('Capture precondition failed');
 const file=`${phase}-${label}-${name}.png`;const bytes=await(await page.$('main')).screenshot({path:join(out,file)});observations.push({name,geometry,screenshot:{file,bytes:bytes.length,sha256:hash(bytes)}});
 }
 await writeFile(join(out,`${phase}-${label}.json`),JSON.stringify({phase,sourceMode:phase==='before'?'11 exact base production consumers; new leaves present but unused; partial historical application':'current implementation',checkpoint:'89fe7fd5b6c1cdd155f7b503fb5534a673a89d72',policy:'Fresh own isolated Chromium context, normal private fixture login; prepareFixtureBrowserContext explicitly denies notifications. Main-region captures exclude private fixture contact text. Native viewport only; no cookie/session/storage copy/save/restore.',observations,sources},null,2));await page.setViewport({width:1600,height:1000});
}
console.log(`${phase}: six fully source-pinned matched captures with notifications denied`);
}finally{await browser.close();}
