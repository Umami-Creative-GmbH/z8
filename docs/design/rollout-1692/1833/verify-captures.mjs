import puppeteer from 'puppeteer-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const repo = process.cwd(), fixture = join(repo,'.tmp/1833/fixture');
const out=join(repo,'docs/design/rollout-1692/1833'); await mkdir(out,{recursive:true});
const runtime=JSON.parse(await readFile(join(fixture,'runtime-private.json'),'utf8'));
const auth=JSON.parse(await readFile(join(fixture,'dev-auth-private.json'),'utf8'));
if(!['localhost','127.0.0.1'].includes(new URL(runtime.origin).hostname))throw Error('Loopback only');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,userDataDir:join(fixture,'1833-chromium'),args:['--no-first-run','--disable-default-apps']});
const page=await browser.newPage();await page.setViewport({width:1600,height:1000});
await page.setCookie(...auth['small-admin'].cookies);
const path=join(repo,'apps/webapp/src/app/[locale]/onboarding/wellness/page-client.tsx');
const owned=await readFile(path); const baseline=execFileSync('git',['show','111dc9e50908ec7f8c478b97c5a96f809b696c0a:apps/webapp/src/app/[locale]/onboarding/wellness/page-client.tsx']);
const notes=[];
try {
 for(const phase of ['before','after']){
  if(phase==='before')await writeFile(path,baseline);else await writeFile(path,owned);
  await page.goto(runtime.origin+'/en/onboarding/wellness',{waitUntil:'networkidle2',timeout:120000});
  await page.waitForSelector('#wellness-enable-reminder',{timeout:90000});
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:join(out,`${phase}-desktop-light.png`),fullPage:true});
  notes.push({phase,sourceSHA256:createHash('sha256').update(phase==='before'?baseline:owned).digest('hex'),url:new URL(page.url()).pathname,viewport:{width:1600,height:1000},role:'small-admin',controls:await page.$$eval('h1,[role=switch],[role=slider],button[type=submit]',els=>els.map(e=>({role:e.getAttribute('role'),text:e.textContent,value:e.getAttribute('aria-valuenow')})))});
 }
 await writeFile(join(out,'capture-provenance.json'),JSON.stringify({baseline:'111dc9e50908ec7f8c478b97c5a96f809b696c0a',comparison:'Matched page-client source only; same real synthetic account, fixture and local default-config Next runtime. No full historical application or provider claim.',notes},null,2));
 console.log('Captured matched desktop baseline and implementation.');
} finally {await writeFile(path,owned);await browser.close();}
