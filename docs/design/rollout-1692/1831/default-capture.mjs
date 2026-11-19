import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {repo,dir,runtime,pool} from '../1719/fixture.mjs';
const stage=process.argv[3];assert.ok(['before','after'].includes(stage));
const out=join(repo,'docs/design/rollout-1692/1831'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const c=await browser.createBrowserContext();await c.setCookie(...auth['small-admin'].cookies);const p=await c.newPage();await p.setViewport({width:1600,height:1000});await p.goto(runtime.origin+'/en/onboarding/vacation-policy',{waitUntil:'networkidle2',timeout:120000});await p.waitForSelector('#vacation-policy-name',{timeout:60000});
await p.screenshot({path:join(out,'default-'+stage+'-desktop.png'),fullPage:true});await p.setViewport({width:390,height:844});await p.screenshot({path:join(out,'default-'+stage+'-phone.png'),fullPage:true});
const f='apps/webapp/src/app/[locale]/onboarding/vacation-policy/page-client.tsx',sha=b=>createHash('sha256').update(b).digest('hex');
await writeFile(join(out,'default-'+stage+'.json'),JSON.stringify({stage,config:'default committed config; workspace-local copy dependencies; no resolver/compiler overlay',sourceSha256:sha(await readFile(join(repo,f))),configSha256:sha(await readFile(join(repo,'apps/webapp/next.config.ts'))),scope:'second owned synthetic fixture, small-admin / Performance small',fields:await p.$$eval('form input',els=>els.map(e=>({id:e.id,value:e.value}))),h1:await p.$$eval('h1',els=>els.map(e=>e.textContent)),overflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)},null,2)+'\n');
}finally{await browser.close();await pool.end();}
