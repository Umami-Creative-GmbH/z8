// pnpm node docs/design/rollout-1692/1717/capture.mjs <owned-fixture> <before|after>
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,pool} from './fixture.mjs';
const phase=process.argv[3],out=join(repo,'docs/design/rollout-1692/1717');await mkdir(out,{recursive:true});
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const evidence={phase,route:'/en/equipment',actor:'small-admin',observations:[],errors:[]};
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['wide-dark',1920,1080,true]]){
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);
  await page.goto(new URL('/en/equipment',runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});await page.waitForFunction(()=>document.body.textContent.includes('EQ-HELD'),{timeout:120000});
  await page.waitForFunction(()=>!document.body.innerText.includes('Loading clock status'),{timeout:120000});
  await new Promise(resolve=>setTimeout(resolve,1200));
  const observation=await page.evaluate(()=>({headings:[...document.querySelectorAll('h1')].map(n=>n.textContent),text:document.querySelector('main')?.innerText,width:document.documentElement.scrollWidth,viewport:innerWidth,rows:document.querySelectorAll('tbody tr').length,dark:document.documentElement.classList.contains('dark')}));
  evidence.observations.push({name,...observation});await page.screenshot({path:join(out,`${phase}-${name}.png`),fullPage:true});
  if(width===390){await page.$eval('[role="tablist"]',n=>n.scrollIntoView({block:'start'}));await new Promise(resolve=>setTimeout(resolve,500));await page.screenshot({path:join(out,`${phase}-phone-records.png`),fullPage:true});}
 }
 await writeFile(join(out,`${phase}.json`),JSON.stringify(evidence,null,2));console.log(JSON.stringify({phase,views:evidence.observations.map(({name,headings,width,viewport,rows})=>({name,headings,width,viewport,rows})),errors:evidence.errors}));
}finally{await browser.close();await pool.end();}
