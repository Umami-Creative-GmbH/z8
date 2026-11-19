import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import {createHash} from 'node:crypto';
import { join, resolve } from 'node:path';
const repo=process.cwd(), privateDir=process.argv[2], phase=process.argv[3];
const require=createRequire(join(repo,'package.json'));
const puppeteer=require('puppeteer-core');
const endpoint=(await readFile(join(privateDir,'cdp-private.txt'),'utf8')).match(/(?:ws|http):\/\/\S+/)?.[0];
if(!endpoint) throw Error('Owned browser endpoint missing');
const browser=await puppeteer.connect(endpoint.startsWith('ws:')?{browserWSEndpoint:endpoint}:{browserURL:endpoint});
const page=(await browser.pages()).find(p=>p.url().includes('/organization'));
if(!page) throw Error('Owned explorer page missing');
const output=resolve('docs/design/rollout-1692/1724'); await mkdir(output,{recursive:true});
const captures=[];
const sourcePin=async()=>{const changed=execFileSync('git',['diff','--name-only','--','apps/webapp/src'],{encoding:'utf8'}).trim().split(/\r?\n/);const added=execFileSync('git',['ls-files','--others','--exclude-standard','--','apps/webapp/src'],{encoding:'utf8'}).trim().split(/\r?\n/);return {head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtySource:await Promise.all([...new Set([...changed,...added])].filter(Boolean).sort().map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})))};};
await page.browserContext().overridePermissions(new URL(page.url()).origin,[]);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.querySelector('[data-testid^="org-person-"]'),{timeout:60000});
const notNow=await page.$('button');
await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Not Now')?.click());
async function capture(name,width,height,theme){
 await page.setViewport({width,height,deviceScaleFactor:1});
 await page.evaluate(theme=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size','default');},theme);
 await page.goto(new URL('/en/organization',page.url()).href,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid^="org-person-"],ul[aria-label="Reporting lines"]')].some(e=>e.checkVisibility())&&!!document.querySelector('button[aria-label="Clock In"]'),{timeout:45000});
 await page.waitForNetworkIdle({idleTime:500,timeout:15000}).catch(()=>{});
 await page.evaluate(async()=>{await document.fonts.ready;});
 const measurements=await page.evaluate(()=>({url:location.pathname+location.search,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,theme:document.documentElement.className,font:getComputedStyle(document.body).fontFamily,rootFont:getComputedStyle(document.documentElement).fontSize,visibleHeadings:[...document.querySelectorAll('h1')].filter(e=>e.checkVisibility()).map(x=>x.textContent),cards:document.querySelectorAll('[data-testid^="org-person-"]').length,outline:!!document.querySelector('ul[aria-label="Reporting lines"]'),dialogs:[...document.querySelectorAll('[role=dialog]')].map(x=>x.textContent)}));
 await new Promise(r=>setTimeout(r,600));
 const path=join(output,phase+'-'+name+'.png');await page.screenshot({path});
 const png=await readFile(path);
 captures.push({name,actor:'small-admin',scope:'Performance small / 8 current employees / unchanged fixture',...measurements,png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},pin:await sourcePin()});
}
try{
 await capture('desktop-light',1600,1000,'light');
 await capture('wide-dark',2200,1100,'dark');
 await capture('phone-light',390,844,'light');
 await page.setViewport({width:1600,height:1000});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-testid^="org-person-"] button')].some(e=>e.checkVisibility()));
 await page.evaluate(()=>[...document.querySelectorAll('[data-testid^="org-person-"] button')].find(e=>e.checkVisibility())?.click());
 await page.waitForSelector('[role=dialog] h2');
 await page.evaluate(async()=>{await document.fonts.ready;});
 await new Promise(resolve=>setTimeout(resolve,450));
 const path=join(output,phase+'-detail.png');await page.screenshot({path});
 const png=await readFile(path); captures.push({name:'detail',actor:'small-admin',scope:'same fixture, manager selection',url:await page.url(),text:await page.$eval('[role=dialog]',e=>e.textContent),png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},pin:await sourcePin()});
 await writeFile(join(output,phase+'-captures.json'),JSON.stringify(captures,null,2));
 console.log(JSON.stringify(captures.map(({pin,...c})=>c),null,2));
}finally{await browser.disconnect();}
