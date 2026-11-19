// pnpm node docs/design/rollout-1692/1830/runtime.mjs <private-fixture> <before|after>
// Credentials, cookies and raw runtime logs are deliberately private.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=resolve(process.argv[2]), phase=process.argv[3];
assert.ok(['before','after'].includes(phase));
const json=async n=>JSON.parse(await readFile(join(directory,n),'utf8'));
const runtime=await json('runtime-private.json'), fixture=await json('fixture-private.json'), auth=await json('dev-auth-private.json'), services=await json('services.json');
assert.equal(fixture.kind,'disposable'); assert.equal(new URL(runtime.origin).hostname,'localhost');
assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers) assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const files=['apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/profile/actions.ts','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/components/onboarding/progress-indicator.tsx','apps/webapp/src/lib/validations/onboarding.ts'];
const source={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),localAI:execFileSync('git',['rev-parse','ai/1692-app-wide-ui-refresh'],{encoding:'utf8'}).trim(),files:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])))};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);
await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
const p=await context.newPage();p.setDefaultTimeout(45000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
const results={phase,fixture:'new disposable synthetic small-admin / Performance small',source,captures:[],errors};
const click=async name=>{const b=await p.$(`::-p-aria(${name}[role="button"])`);assert.ok(b,`button ${name}`);await b.click();};
try {
 await p.setViewport({width:1600,height:1000});await p.emulateTimezone('America/Los_Angeles');
 await p.goto(runtime.origin+'/en/onboarding/profile',{waitUntil:'networkidle0'});await p.waitForSelector('#profile-first-name');
 await p.type('#profile-first-name','Ada');await p.type('#profile-last-name','Lovelace');
 // Freeze the randomly chosen *existing* auth photo for matched source comparisons.
 const background=await p.$eval('img[alt=""][class*="object-cover"]',e=>e.getAttribute('src')).catch(()=>null);
 if(phase==='before') await writeFile(join(directory,'profile-background-private.json'),JSON.stringify(background));
 else {const saved=await json('profile-background-private.json');assert.ok(saved);await p.$eval('img[alt=""][class*="object-cover"]',async(im,src)=>{im.srcset='';im.src=src;im.style.backgroundImage='none';await im.decode();},saved);}
 results.backgroundSha256=createHash('sha256').update(await json('profile-background-private.json')).digest('hex');
 for(const [name,width,height,dark,font] of [['desktop',1600,1000,false,16],['wide',2400,1200,false,16],['phone',390,844,false,16],['phone-dark-large',390,844,true,18],['desktop-dark-large',1600,1000,true,18]]){
  await p.setViewport({width,height});
  await p.evaluate((dark,font)=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.style.fontSize=font+'px';},dark,font);
  await p.waitForFunction(()=>document.querySelector('#profile-first-name')?.getBoundingClientRect().width>0&&document.querySelectorAll('h1').length===1);
  await p.screenshot({path:`docs/design/rollout-1692/1830/${phase}-${name}.png`,fullPage:true});
  const dimensions=await p.evaluate(()=>({viewport:innerWidth,body:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length}));
  assert.equal(dimensions.h1,1);assert.ok(dimensions.body<=width,JSON.stringify(dimensions));results.captures.push({name,width,height,dark,font,...dimensions});
 }
 await p.setViewport({width:390,height:844});
 await p.click('#profile-birthday');await p.waitForSelector('[data-slot="calendar"]');
 const calendar=await p.$eval('[data-slot="calendar"]',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
 results.calendar={...calendar,viewport:390};await p.screenshot({path:`docs/design/rollout-1692/1830/${phase}-calendar.png`,fullPage:true});
 await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.id==='profile-birthday');results.focusReturn=true;
 if(phase==='after'){
  const buttonByText=async text=>{const buttons=await p.$$('button');for(const b of buttons)if((await b.evaluate(e=>e.textContent)).includes(text)){await b.click();return;}throw Error('Missing button '+text);};
  await buttonByText('Toggle theme');await p.waitForSelector('[role=menuitem]');const dark=await p.$('::-p-aria(Dark[role="menuitem"])');assert.ok(dark);await dark.click();
  await buttonByText('Font size');await p.waitForSelector('[role=menuitemradio]');const large=await p.$('::-p-aria(Large[role="menuitemradio"])');assert.ok(large);await large.click();
  await p.reload({waitUntil:'networkidle0'});await p.waitForSelector('#profile-first-name');
  results.savedShellPreferences=await p.evaluate(()=>({dark:document.documentElement.classList.contains('dark'),font:document.documentElement.dataset.fontSize,pixels:getComputedStyle(document.documentElement).fontSize}));
  assert.equal(results.savedShellPreferences.dark,true);assert.equal(results.savedShellPreferences.font,'large');assert.equal(results.savedShellPreferences.pixels,'18px');
  await p.setViewport({width:320,height:700});await p.click('#profile-birthday');await p.waitForSelector('[data-slot="calendar"]');
  results.calendar320=await p.$eval('[data-slot="calendar"]',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));assert.ok(results.calendar320.left>=0&&results.calendar320.right<=320);
  await p.screenshot({path:'docs/design/rollout-1692/1830/after-calendar320.png',fullPage:true});await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.id==='profile-birthday');await p.setViewport({width:390,height:844});
  await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await p.goto(runtime.origin+'/de/onboarding/profile',{waitUntil:'networkidle0'});await p.waitForSelector('#profile-first-name');
  results.germanAndReducedMotion=await p.evaluate(()=>({language:document.documentElement.lang,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,overflow:document.documentElement.scrollWidth>innerWidth,firstLabel:document.querySelector('label[for="profile-first-name"]')?.textContent}));
  assert.equal(results.germanAndReducedMotion.overflow,false);
  await p.screenshot({path:'docs/design/rollout-1692/1830/after-saved-dark-large-german.png',fullPage:true});
 }
}finally{await writeFile(`docs/design/rollout-1692/1830/${phase}.json`,JSON.stringify(results,null,2));await browser.close();}
