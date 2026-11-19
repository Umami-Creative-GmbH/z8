// Real local actions only. Failures abort transport or change guarded synthetic grants.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1716');
const json=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg'),pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
await writeFile(join(dir,'browser-ready-private.json'),JSON.stringify({ws:browser.wsEndpoint(),pid:browser.process().pid}),{mode:0o600});
const a=fixture.actors['small-admin'],e=fixture.actors['small-employee'],m=fixture.actors['small-manager'];
const route='/en/driving-licence/checks/'+e.employeeId,continuation=process.argv[3]==='--continue',results=continuation?JSON.parse(await readFile(join(out,'runtime.json'),'utf8')).results:[],errors=[];let page,context,revoked=false;
const save=()=>writeFile(join(out,'runtime.json'),JSON.stringify({boundary:'Fresh #1716 isolated real application; no mocked successes',results,errors},null,2));
const check=async(name,value,expected=true)=>{assert.deepEqual(value,expected,name);results.push({name,value});await save();};
const wait=text=>page.waitForFunction(t=>document.body.innerText.includes(t),{timeout:90000},text);
const click=s=>clickVisible(page,s);
const go=path=>page.goto(new URL(path,runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});
const snap=n=>page.screenshot({path:join(out,n+'.png'),fullPage:true});
async function actor(name){if(context)await context.close();context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth[name].cookies);page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});page.on('pageerror',e=>errors.push(e.message));}
async function original(){
 await wait('Classes actually inspected');
 await page.$$eval('form input[type=date]',nodes=>{for(const [n,v] of [[nodes[0],'2020-01-01'],[nodes[1],'2035-01-01']]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,v);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));}});
 for(const label of await page.$$('label'))if(await label.evaluate(n=>n.textContent.trim()==='B'))await label.click();
 await page.type('input[name="B-restrictions"]','Corrective lenses');
 for(const phrase of ['I personally inspected','I confirmed that the original','The employee personally made','I confirm that the recorded'])await click('label::-p-text('+phrase+')');
}
try {
 await actor('small-admin');await go(route);await wait('Classes actually inspected');
 await check('one selected-employee heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Driving licence check for Person 2']);
 if(!continuation){
 await original();
 await pool.query('update driving_licence_verifier_grant set revoked_at=now(),revoked_by=granted_by where organization_id=$1 and verifier_employee_id=$2 and revoked_at is null',[a.organizationId,a.employeeId]);revoked=true;
 await click('button::-p-text(Record original check)');await page.waitForSelector('form [role=alert]');
 await check('actual revoked grant refuses submitted draft',await page.$eval('input[name="B-restrictions"]',n=>n.value),'Corrective lenses');await snap('original-refused');
 await pool.query('update driving_licence_verifier_grant set revoked_at=null,revoked_by=null where organization_id=$1 and verifier_employee_id=$2',[a.organizationId,a.employeeId]);revoked=false;
 await click('button::-p-text(Record original check)');await wait('Original check recorded');await page.reload({waitUntil:'networkidle0'});await wait('Original check evidence');
 await check('retried original persists through reader reload',(await page.$$eval('h2',ns=>ns.map(n=>n.textContent))).includes('Driving authorization active'));await snap('original-saved');
 await actor('small-employee');await go('/en/driving-licence');await wait('Unable to drive?');await click('button::-p-text(Report that I cannot drive)');await wait('All your class authorizations are suspended');
 await actor('small-admin');await go(route);await wait('Driving authorization suspended');await original();await click('button::-p-text(Record original check)');await wait('Original check recorded');await page.reload({waitUntil:'networkidle0'});await wait('Explicitly reinstate driving authorization');
 await check('new successful original does not reinstate reported suspension',await page.$$eval('h2',ns=>ns.some(n=>n.textContent==='Driving authorization suspended')));await snap('new-check-still-suspended');
 for(const label of await page.$$('label'))if(await label.evaluate(n=>n.htmlFor.endsWith('-class-B')||n.htmlFor.endsWith('-resolved')))await label.click();
 await click('button::-p-text(Reinstate selected classes)');await wait('Driving authorization active');await page.reload({waitUntil:'networkidle0'});await wait('Driving authorization active');
 await check('explicit reinstatement persists and disappears when no longer needed',await page.$('button::-p-text(Reinstate selected classes)')===null);await snap('explicit-reinstatement');
 }
 if(!results.some(r=>r.name==='real retry restores authorized record')){
 await page.waitForSelector('a[href^="/api/driving-licence/evidence"]');
 if(!await page.evaluate(()=>document.querySelector('main').textContent.includes('2020-01-02'))){
 await click('button::-p-text(Supplement original check)');await wait('Corrected value');
 await page.$$eval('input[type=date]',nodes=>{const n=nodes.at(-1);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'2020-01-02');n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));});
 await click('button::-p-text(Save supplement)');await wait('Supplement saved');await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('a[href^="/api/driving-licence/evidence"]');
 }
 await page.evaluate(()=>[...document.querySelectorAll('ol li')].find(n=>n.textContent.includes('2020-01-02'))?.scrollIntoView());
 await wait('2020-01-02');
 await check('supplement readback preserves immutable original',await page.evaluate(()=>document.querySelector('main').textContent.includes('Document issued 2020-01-01')&&document.querySelector('main').textContent.includes('2020-01-02')));await snap('supplement-original-retained');
 const pdf=await page.$eval('a[href^="/api/driving-licence/evidence"]',n=>n.href);
 const download=await page.evaluate(async url=>{const r=await fetch(url);const b=new Uint8Array(await r.arrayBuffer());return{status:r.status,type:r.headers.get('content-type'),prefix:String.fromCharCode(...b.slice(0,5))};},pdf);
 await check('real authorized native evidence PDF',download,{status:200,type:'application/pdf',prefix:'%PDF-'});
 // Abort actual POST reads after a clean load. No successful response is fabricated.
 let abort=true;await page.setRequestInterception(true);page.on('request',r=>{if(abort&&r.method()==='POST'&&r.headers()['next-action'])void r.abort('failed').catch(()=>{});else void r.continue().catch(()=>{});});
 await click('button[aria-label="Refresh data"]');await page.waitForSelector('[role=alert]');
 await check('failed real record refresh withdraws original and evidence',await page.$('button::-p-text(Record original check)')===null&&await page.$('a[href^="/api/driving-licence/evidence"]')===null);await snap('read-failed');
 abort=false;await click('button::-p-text(Retry)');await wait('Classes actually inspected');
 await check('real retry restores authorized record',await page.$('button::-p-text(Record original check)')!==null);page.removeAllListeners('request');await page.setRequestInterception(false);
 }
 await go('/en/driving-licence/checks/'+m.employeeId);await wait('is not an intended driver');await check('missing intended driver retains no-check path',await page.$('button::-p-text(Record original check)')===null);await snap('not-intended');
 const {rows:[ended]}=await pool.query("select employee_id from driving_authorization where organization_id=$1 and state='ended' limit 1",[a.organizationId]);
 await pool.query('update employee set is_active=false,deactivated_at=now() where organization_id=$1 and id=$2',[a.organizationId,ended.employee_id]);
 await go('/en/driving-licence/checks/'+ended.employee_id);await wait('Former employee');await wait('Download evidence PDF');await check('former ended evidence readable without a new check',await page.$('button::-p-text(Record original check)')===null);await snap('former-ended');
 await go('/en/driving-licence/checks/'+a.employeeId);await check('self-check excluded by actual route guard',await page.$('button::-p-text(Record original check)')===null);
 for(const role of ['small-manager','small-restricted','small-employee']){await actor(role);await go(route);await check(role+' has no independent verifier route access',await page.$('button::-p-text(Record original check)')===null&&await page.$('a[href^="/api/driving-licence/evidence"]')===null);}
 await actor('small-admin');await go(route);await wait('Classes actually inspected');
 await pool.query('update driving_licence_policy set enabled=false where organization_id=$1',[a.organizationId]);await page.reload({waitUntil:'networkidle0'});await check('feature off refuses check route',await page.$('button::-p-text(Record original check)')===null);await pool.query('update driving_licence_policy set enabled=true where organization_id=$1',[a.organizationId]);
 await go(route);await wait('Classes actually inspected');
 await check('uncaught browser errors',errors,[]);
 await writeFile(join(dir,'browser-ready-private.json'),JSON.stringify({ws:browser.wsEndpoint()}),{mode:0o600});
 console.log('Fresh action checks passed; browser connected for Next MCP.');await new Promise(done=>browser.once('disconnected',done));
} catch(error){await snap('runtime-failure').catch(()=>{});throw error;} finally {
 if(revoked)await pool.query('update driving_licence_verifier_grant set revoked_at=null,revoked_by=null where organization_id=$1 and verifier_employee_id=$2',[a.organizationId,a.employeeId]);
 await pool.query('update driving_licence_policy set enabled=true where organization_id=$1',[a.organizationId]);await save();await browser.close();await pool.end();
}
