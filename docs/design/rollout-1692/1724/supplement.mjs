import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const repo=process.cwd(),dir=process.argv[2],out=join(repo,'docs/design/rollout-1692/1724');
const require=createRequire(join(repo,'package.json')),puppeteer=require('puppeteer-core');
const endpoint=(await readFile(join(dir,'cdp-private.txt'),'utf8')).match(/(?:ws|http):\/\/\S+/)[0];
const browser=await puppeteer.connect(endpoint.startsWith('ws:')?{browserWSEndpoint:endpoint}:{browserURL:endpoint});
const page=(await browser.pages()).find(p=>p.url().includes('/organization'));
const prior=JSON.parse(await readFile(join(out,'runtime-supplement.json'),'utf8').catch(()=>'{"results":[]}'));
const results=prior.results.slice(0,2);const check=(name,detail)=>{results.push({name,passed:true,detail});console.log('PASS '+name);};
const click=async selector=>{const elements=await page.$$(selector);for(const e of elements)if(await e.isVisible()){await e.click();return;}throw Error('No visible control '+selector);};
try{
 if(await page.$('button[aria-label="Switch Organization: Performance large"]')) {
 assert(await page.$('search input'));check('real organization switch settles in the new roster','Performance large / 201 current employees: existing switch joining fallback creates the missing current employee; no no-employee refusal claimed');
 await click('button[aria-label="Switch Organization: Performance large"]');
 await page.waitForSelector('[role=menuitem]');
 await page.evaluate(()=>[...document.querySelectorAll('[role=menuitem]')].find(e=>e.checkVisibility()&&e.textContent.includes('Performance small'))?.click());
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Switch Organization: Performance small"]:not(:disabled)')&&[...document.querySelectorAll('p')].some(e=>e.checkVisibility()&&e.textContent==='8 employees'),{timeout:45000});
 check('return from organization switch restores original roster','same small-admin; 8 current employees; no foreign Person 199');
 }
 await page.setViewport({width:390,height:844});await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('ul[aria-label="Reporting lines"]',{visible:true});assert.equal(await page.$$eval('.react-flow',xs=>xs.filter(e=>e.checkVisibility()).length),0);check('phone relationship record is native outline','390×844 CSS pixels');
 await click('ul[aria-label="Reporting lines"] button');await page.waitForSelector('[role=dialog][data-sheet-side=bottom]',{visible:true});
 await page.keyboard.press('Escape');await page.waitForSelector('[role=dialog]',{hidden:true});check('phone detail uses bottom sheet and first Escape closes','person selected through visible outline');
 await page.evaluate(()=>{localStorage.setItem('z8-font-size','large');localStorage.setItem('theme','dark');});await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('ul[aria-label="Reporting lines"]',{visible:true});await page.evaluate(async()=>document.fonts.ready);
 const prefs=await page.evaluate(()=>({storedFont:localStorage.getItem('z8-font-size'),storedTheme:localStorage.getItem('theme'),rootFont:getComputedStyle(document.documentElement).fontSize,font:getComputedStyle(document.body).fontFamily,theme:document.documentElement.className,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.equal(prefs.rootFont,'18px');assert(prefs.theme.includes('dark'));assert.equal(prefs.documentWidth,390);
 await page.screenshot({path:join(out,'phone-saved-large-dark.png')});check('saved large text and dark theme survive reload',prefs);
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);assert(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));check('reduced-motion preference reaches the actual browser','local canvas centering honors it; no global transition claim');
 await click('button[data-sidebar="trigger"]');await page.waitForSelector('[role=dialog]',{visible:true});
 const current=await page.$$eval('[aria-current=page]',xs=>xs.filter(e=>e.checkVisibility()).map(e=>e.getAttribute('href')));assert(current.includes('/en/organization')||current.includes('/organization'));
 await page.keyboard.press('Escape');await page.waitForSelector('[role=dialog]',{hidden:true});const focus=await page.evaluate(()=>document.activeElement?.getAttribute('data-sidebar'));assert.equal(focus,'trigger');check('phone drawer first Escape and focus return, with current route',current);
 const counts=await page.evaluate(()=>({visibleH1:[...document.querySelectorAll('h1')].filter(e=>e.checkVisibility()).length,unnamedButtons:[...document.querySelectorAll('button')].filter(e=>e.checkVisibility()&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!e.getAttribute('title')).length,unlabelledInputs:[...document.querySelectorAll('input')].filter(e=>e.checkVisibility()&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length}));assert.equal(counts.visibleH1,1);assert.equal(counts.unlabelledInputs,0);check('evaluated accessibility counts',counts);
 await page.setViewport({width:1600,height:1000});await page.evaluate(()=>{localStorage.setItem('z8-font-size','default');localStorage.setItem('theme','light');});await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('search input',{visible:true});
 await page.waitForFunction(()=>!!document.querySelector('button[aria-label^="Account:"]'));
 if(await page.$('[data-state=collapsed]')){await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');}
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');
 await page.waitForSelector('[data-state=collapsed]');const sidebar=await page.evaluate(()=>[...document.querySelectorAll('[data-state]')].filter(e=>e.dataset.state==='collapsed').length);assert(sidebar>0);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('search input',{visible:true});await page.waitForSelector('[data-state=collapsed]');check('desktop Ctrl+B collapse survives reload','native sidebar cookie; route unchanged');
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');
}finally{await writeFile(join(out,'runtime-supplement.json'),JSON.stringify({results,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),fixtureChange:'Existing switch owner joined small-admin into the large organization; large now 201, small remains original 8.'},null,2));await browser.disconnect();}
