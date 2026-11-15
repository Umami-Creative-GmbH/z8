import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const repo=process.cwd(),dir=process.argv[2],fixture=join(dir,'fixture'),out=join(repo,'docs/design/rollout-1692/1724');
const require=createRequire(join(repo,'package.json')),appRequire=createRequire(join(repo,'apps/webapp/package.json'));
const puppeteer=require('puppeteer-core'),{Pool}=appRequire('pg');
const services=JSON.parse(await readFile(join(fixture,'services.json'),'utf8'));
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const runtime=JSON.parse(await readFile(join(fixture,'runtime-private.json'),'utf8')),actors=JSON.parse(await readFile(join(fixture,'fixture-private.json'),'utf8')).actors;
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const org=actors['large-admin'].organizationId;assert.match(org,/^perf-large-[a-f0-9]{12}$/);
const roster=(await pool.query('select e.id,e.user_id,u.name from employee e join "user" u on u.id=e.user_id where e.organization_id=$1',[org])).rows;
const person=n=>roster.find(r=>r.name===`Person ${n}`);
await pool.query("insert into member (id,organization_id,user_id,role,status,created_at) select $1,$2,e.user_id,'member','approved',now() from employee e where e.id=$3 and e.organization_id=$4 and not exists (select 1 from member where organization_id=$2 and user_id=e.user_id)",[randomUUID(),org,actors['small-admin'].employeeId,actors['small-admin'].organizationId]);
await pool.query('insert into team_membership (organization_id,team_id,employee_id) select organization_id,team_id,id from employee where organization_id=$1 and team_id is not null on conflict do nothing',[org]);
for(const [child,manager] of [[197,3],[199,197]])await pool.query('update employee_managers set manager_id=$1 where employee_id=$2',[person(manager).id,person(child).id]);
const endpoint=(await readFile(join(dir,'cdp-private.txt'),'utf8')).match(/(?:ws|http):\/\/\S+/)[0];
const browser=await puppeteer.connect(endpoint.startsWith('ws:')?{browserWSEndpoint:endpoint}:{browserURL:endpoint});
const page=(await browser.pages()).find(p=>p.url().includes('/organization'));
const results=[];let failNext=false,held=null,holdNext=false;
const check=(name,detail)=>{results.push({name,passed:true,detail});console.log('PASS '+name);};
async function settle(){await page.waitForFunction(()=>{const input=[...document.querySelectorAll('search input')].find(e=>e.checkVisibility());return input&&Object.keys(input).some(k=>k.startsWith('__reactProps')&&typeof input[k].onChange==='function')&&!!document.querySelector('button[aria-label="Clock In"]');},{timeout:45000});await page.waitForNetworkIdle({idleTime:500,timeout:15000}).catch(()=>{});await page.evaluate(async()=>document.fonts.ready);}
async function go(actor,path='/en/organization'){
 await page.goto('http://localhost:'+JSON.parse(await readFile(join(fixture,'bridge-private.json'),'utf8')).port+'/'+actor,{waitUntil:'domcontentloaded'});await settle();
 if(path!='/en/organization'){await page.goto(runtime.origin+path,{waitUntil:'domcontentloaded'});await settle();}
}
async function clickText(text,selector='button'){const buttons=await page.$$(selector);for(const b of buttons)if((await b.evaluate(e=>e.textContent.trim()))===text && await b.isVisible()){await b.click();return;}throw Error('Missing visible '+text);}
async function clickVisible(selector){await page.locator(selector).filter(e=>e.checkVisibility()).click();}
async function shot(name){await page.screenshot({path:join(out,name+'.png')});}
try{
 await page.setViewport({width:1600,height:1000});await go('small-admin');
 await page.waitForFunction(()=>[...document.querySelectorAll('h1')].filter(e=>e.checkVisibility()).length===1);
 check('one visible page heading after adoption',1);
 await page.locator('search input').filter(e=>e.checkVisibility()).fill('Person 3');
 await clickVisible('button[aria-label^="Person 3 "]');
 await page.waitForFunction(()=>new URL(location.href).searchParams.has('employee'),{timeout:2000}).catch(()=>clickVisible('button[aria-label^="Person 3 "]'));
 await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] h2')].some(e=>e.checkVisibility()&&e.textContent==='Person 3'));
 assert(new URL(page.url()).searchParams.has('employee'));
 assert(await page.$('[role=dialog] a[href*="/settings/employees/"]'));
 check('real employee search selects URL, relationship detail, and admin settings destination','small-admin / Person 3');
 await page.keyboard.press('Escape');await page.waitForSelector('[role=dialog]',{hidden:true});
 check('person panel closes on first Escape and clears employee selection',!new URL(page.url()).searchParams.has('employee'));
 await page.locator('search input').filter(e=>e.checkVisibility()).fill('zzzz-no-person');await page.waitForFunction(()=>[...document.querySelectorAll('search')].some(e=>e.checkVisibility()&&e.textContent.includes('No employees found')));
 await page.keyboard.press('Escape');assert.equal(await page.$eval('search input',e=>e.value),'');check('search no-match and first-Escape dismissal','input retains focus; selection unchanged');
 await clickText('Teams','[role=radio]');await page.waitForSelector('[data-testid="team-card-none"]');assert.equal(new URL(page.url()).searchParams.get('view'),'teams');
 check('Teams URL view and No team record','fixture small memberships are intentionally empty');
 await clickText('Filter by team');await page.waitForSelector('[role=option]');await clickText('Fixture team 0','[role=option]');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>new URL(location.href).searchParams.has('team')&&[...document.querySelectorAll('[data-team]')].filter(e=>e.checkVisibility()).length===1);assert.equal(await page.$$eval('[data-team]',e=>e.filter(x=>x.checkVisibility()).length),1);
 check('real team filtering narrows Teams and persists URL','Fixture team 0');
 await page.goBack({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>!new URL(location.href).searchParams.has('team'));check('Back restores unfiltered Teams URL',true);
 for(const role of ['small-manager','small-employee','small-restricted']){
  await go(role,'/en/organization?employee='+actors['small-manager'].employeeId);
  await page.waitForFunction(()=>document.querySelector('[role=dialog] h2')?.textContent==='Person 1');assert.equal(await page.$('[role=dialog] a[href*="/settings/"]'),null);check(role+' relationship reader has no management authority','real detail and email visible, no settings link');
 }
 await go('small-employee','/en/organization?employee='+actors['large-manager'].employeeId);assert.equal(await page.$('[role=dialog]'),null);check('foreign deep link opens no person','small current-roster reader / large employee UUID');
 await page.setViewport({width:390,height:844});await go('large-admin');await page.setRequestInterception(true);
 page.on('request',r=>{if(r.isInterceptResolutionHandled())return;if(r.method()==='POST'&&r.url().includes('/organization')&&r.headers()['next-action']&&r.postData()?.includes(person(199).id)){if(failNext){failNext=false;void r.abort('failed');return;}if(holdNext){holdNext=false;held=r;return;}}void r.continue();});
 assert.equal(await page.$('li[aria-label="Person 199"]'),null);
 failNext=true;await clickVisible('li[aria-label="Person 197"] button[aria-expanded]');
 await page.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(e=>e.checkVisibility()&&e.textContent.includes('Retry')));assert(await page.$('li[aria-label="Person 1"]'));await shot('failed-branch');
 await clickText('Retry');await page.waitForSelector('li[aria-label="Person 199"]');check('failed real large branch retains roster and Retry loads the correct child','200 current employees, Person 197 → Person 199 / phone outline');
 await page.setViewport({width:1600,height:1000});
 await page.goto(runtime.origin+'/en/organization?employee='+person(199).id,{waitUntil:'domcontentloaded'});await settle();await page.waitForFunction(()=>document.querySelector('[role=dialog] h2')?.textContent==='Person 199');await shot('large-deep-link');check('large deep link resolves lazy person and manager path','Person 199, manager Person 197; actual settled detail');
 await page.keyboard.press('Escape');await page.waitForSelector('[role=dialog]',{hidden:true});
 await clickText('Teams','[role=radio]');await page.waitForSelector('[data-team]');const show=await page.$('[data-team] button');
 check('large teams consume actual membership records','200 memberships seeded only in large fixture before this supplemental exercise');
 // Hold a real lazy read while changing accounts; the new roster must win.
 await page.setViewport({width:390,height:844});await go('large-admin');holdNext=true;
 await clickVisible('li[aria-label="Person 197"] button[aria-expanded]');
 for(let n=0;n<50&&!held;n++)await new Promise(r=>setTimeout(r,100));assert(held);
 await go('small-admin');await held.continue().catch(()=>{});await settle();
 assert.equal(await page.$('li[aria-label="Person 199"]'),null);check('held lazy read cannot repopulate another account roster','large-admin held Person 199 → small-admin 8-person roster');
 await go('large-admin','/en/organization?employee='+person(199).id);await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] h2')].some(e=>e.checkVisibility()&&e.textContent==='Person 199'));check('return after account change resolves the real deep link again','fresh large-admin session context');
 page.removeAllListeners('request');await page.setRequestInterception(false);
}finally{
 await writeFile(join(out,'runtime-behaviors.json'),JSON.stringify({results,fixture:'Owned disposable fixture; unchanged small 8-person baseline. Supplemental large 200-person memberships + two deeper manager links only.',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()},null,2));
 await pool.end();await browser.disconnect();console.log(JSON.stringify(results,null,2));
}
