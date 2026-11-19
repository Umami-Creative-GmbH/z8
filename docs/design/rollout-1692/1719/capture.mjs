// Same synthetic holder, role, scope and post-action data on both sides.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const phase=process.argv[3],out=join(repo,'docs/design/rollout-1692/1719');
assert.ok(['before','after'].includes(phase));
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const evidence={phase,actor:'small-admin',organization:'Performance small',holder:'Fixture Person 2',observations:[],errors:[]};
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push({message:e.message,stack:e.stack}));
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['wide-dark',1920,1080,true]]){
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);
  await page.goto(new URL('/en/equipment/employees/'+fixture.actors['small-employee'].employeeId,runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});
  await page.waitForFunction(()=>document.querySelector('main')?.innerText.includes('EQ-HELD'),{timeout:120000});
  await page.waitForFunction(()=>!document.body.innerText.includes('Loading clock status'),{timeout:120000});
  await page.evaluate(()=>document.fonts.ready);await new Promise(resolve=>setTimeout(resolve,1200));
  const observation=await page.evaluate(()=>({headings:[...document.querySelectorAll('h1')].map(n=>n.textContent),text:document.querySelector('main')?.innerText,width:document.documentElement.scrollWidth,viewport:innerWidth,rows:[...document.querySelectorAll('tbody tr')].map(n=>n.textContent.replace(/\s+/g,' ').trim()),dark:document.documentElement.classList.contains('dark')}));
  if(observation.width!==width){await page.screenshot({path:join(out,phase+'-capture-failure.png'),fullPage:true});console.log(JSON.stringify(observation));}
  assert.equal(observation.width,width);assert.equal(observation.dark,dark);evidence.observations.push({name,...observation});await page.screenshot({path:join(out,`${phase}-${name}.png`),fullPage:true});
  if(width===390){await page.$eval('input[type="search"]',n=>n.scrollIntoView({block:'start'}));await page.screenshot({path:join(out,`${phase}-phone-records.png`),fullPage:true});}
 }
 assert.deepEqual(evidence.errors,[]);await writeFile(join(out,phase+'.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({phase,views:evidence.observations.map(({name,headings,width,rows})=>({name,headings,width,rows:rows.length})),errors:evidence.errors}));
}finally{await browser.close();await pool.end();}
