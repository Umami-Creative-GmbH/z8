import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,pool} from './fixture.mjs';
const phase=process.argv[3],out=join(repo,'docs/design/rollout-1692/1721');
assert.ok(['before','after'].includes(phase));await mkdir(out,{recursive:true});await pool.end();
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');
const files=['apps/webapp/src/components/equipment/equipment-personal.tsx','apps/webapp/src/components/equipment/equipment-personal-header.tsx','apps/webapp/src/components/equipment/equipment-personal-loading.tsx','apps/webapp/src/app/[locale]/(app)/my-equipment/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const identity=async()=>({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,await readFile(f).then(b=>createHash('sha256').update(b).digest('hex')).catch(()=>null)])))});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results={phase,actor:'small-employee',organization:'Performance small',observations:[],errors:[],failures:[]};
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-employee'].cookies);const page=await context.newPage();page.on('pageerror',e=>results.errors.push(e.message));
 for(const [name,width,height,dark] of [['desktop-light',1600,1000,false],['phone-light',390,844,false],['wide-dark',1920,1080,true]]){
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);await page.goto(new URL('/en/my-equipment',runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('R029 Recovered kit'),{timeout:120000});await page.evaluate(()=>document.fonts.ready);
  for(const row of await page.$$('main li > button'))await row.evaluate(n=>n.scrollIntoView({block:'center'}));await page.evaluate(()=>scrollTo(0,0));
  const observed=await page.evaluate(()=>({text:document.querySelector('main')?.innerText,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.textContent),cssViewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,dark:document.documentElement.classList.contains('dark'),fontsStatus:document.fonts.status,fonts:[...document.querySelectorAll('h1,main button')].slice(0,10).map(n=>({text:n.textContent,font:getComputedStyle(n).fontFamily,size:getComputedStyle(n).fontSize})),devicePixelRatio,visualScale:visualViewport.scale}));
  const path=join(out,`${phase}-${name}.png`);await page.screenshot({path,fullPage:true});const {width:pngWidth,height:pngHeight}=await sharp(path).metadata();results.observations.push({name,identity:await identity(),...observed,png:{width:pngWidth,height:pngHeight}});await writeFile(join(out,phase+'.json'),JSON.stringify(results,null,2)+'\n');assert.equal(observed.scrollWidth,width);assert.equal(observed.dark,dark);
 }
 assert.deepEqual(results.errors,[]);console.log(`${phase}: three matched real employee reads captured.`);
}catch(e){results.failures.push(e.message);throw e;}finally{await writeFile(join(out,phase+'.json'),JSON.stringify(results,null,2)+'\n');await browser.close();}
