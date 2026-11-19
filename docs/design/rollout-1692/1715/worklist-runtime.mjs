import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1715');
const json=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg'),pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const results=[],e=fixture.actors['small-employee'];let prior;
const save=()=>writeFile(join(out,'worklist-runtime.json'),JSON.stringify({results},null,2));const check=async(name,value,expected=true)=>{assert.deepEqual(value,expected,name);results.push({name,value});await save();};
try{
const c=await browser.createBrowserContext();await prepareFixtureBrowserContext(c,runtime.origin);await c.setCookie(...auth['small-admin'].cookies);const page=await c.newPage();await page.setViewport({width:390,height:844});
const {rows:[person]}=await pool.query('select u.id,u.name from "user" u join employee e on e.user_id=u.id where e.organization_id=$1 and e.id=$2',[e.organizationId,e.employeeId]);prior=person;
await pool.query('update "user" set name=$1 where id=$2',['Person 2 with a deliberately long employee name for authorization review and necessary driving restrictions',person.id]);
await page.goto(new URL('/en/driving-licence?tab=checks',runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('table a');
await check('long employee action and all fields fit phone',await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth})),{document:390,viewport:390});await page.screenshot({path:join(out,'phone-long-name.png'),fullPage:true});
await page.setViewport({width:1600,height:1000});await clickVisible(page,'table button::-p-text(Name)');await page.waitForFunction(()=>document.querySelector('th[aria-sort="ascending"]')?.textContent.includes('Name')&&document.body.innerText.includes('Sorted by the selected column'));await check('server sorting retains named order feedback',await page.evaluate(()=>document.body.innerText.includes('Sorted by the selected column')));
let held,block=true;await page.setRequestInterception(true);page.on('request',r=>{if(block&&r.headers()['next-action']&&r.postData()?.includes('"sort":"name"')&&r.postData()?.includes('"direction":"asc"')){held=r;}else void r.continue();});
await clickVisible(page,'button::-p-text(Refresh check worklist)');for(let i=0;i<30&&!held;i++)await new Promise(r=>setTimeout(r,100));assert.ok(held,'hold exact worklist read payload');
await check('pending worklist retains actual rows',await page.$('table a')!==null);await page.screenshot({path:join(out,'worklist-pending.png'),fullPage:true});block=false;await held.abort('failed');await page.waitForSelector('[role="alert"]');await check('failed refresh retains actual worklist',await page.$('table a')!==null);await page.screenshot({path:join(out,'worklist-failed.png'),fullPage:true});
await clickVisible(page,'button::-p-text(Retry)');await page.waitForFunction(()=>!document.querySelector('[role="alert"]'));await check('Retry refetches real worklist after transport recovery',await page.$('table a')!==null);await page.screenshot({path:join(out,'worklist-recovered.png'),fullPage:true});
}finally{if(prior)await pool.query('update "user" set name=$1 where id=$2',[prior.name,prior.id]);await save();await browser.close();await pool.end();}
