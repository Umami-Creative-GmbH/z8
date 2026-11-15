import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
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
const a=fixture.actors['small-admin'],e=fixture.actors['small-employee'],large=fixture.actors['large-admin'],route='/en/driving-licence/checks/'+e.employeeId,results=[],errors=[];
let extraMember,revoked=false,held;
const save=()=>writeFile(join(out,'context.json'),JSON.stringify({results,errors},null,2));
const check=async(name,value,expected=true)=>{assert.deepEqual(value,expected,name);results.push({name,value});await save();};
const c=await browser.createBrowserContext();await prepareFixtureBrowserContext(c,runtime.origin);await c.setCookie(...auth['small-admin'].cookies);const page=await c.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});page.on('pageerror',e=>errors.push(e.message));
const click=s=>clickVisible(page,s),go=()=>page.goto(new URL(route,runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});
try{
 await go();await page.waitForSelector('a[href^="/api/driving-licence/evidence"]');
 for(const [label,date] of [['From date (UTC)','2026-11-01'],['Before date (UTC)','2026-11-16']]){
  const id=await page.$$eval('label',(ns,label)=>ns.find(n=>n.textContent===label)?.htmlFor,label);assert.ok(id);
  await click('[id="'+id+'"]');await click('button[data-day="'+date+'"]');
 }
 await click('button::-p-text(Apply period)');await page.waitForFunction(()=>document.querySelector('a[href^="/api/driving-licence/evidence"]')?.href.includes('to=2026-11-16'));
 const period=await page.$eval('a[href^="/api/driving-licence/evidence"]',n=>n.href);
 await check('real applied period preserves inclusive/exclusive UTC boundaries',Object.fromEntries(new URL(period).searchParams),{employeeId:e.employeeId,from:'2026-11-01T00:00:00Z',to:'2026-11-16T00:00:00Z'});
 await check('period PDF is the real authorized PDF',await page.evaluate(async url=>{const r=await fetch(url);return [r.status,(await r.text()).slice(0,5)];},period),[200,'%PDF-']);
 // Actual saved shell controls, trusted Escape and no route/global workaround.
 for(const [width,height] of [[390,844],[1600,1000]]){
  await page.setViewport({width,height});
  if(width===390){await click('button[data-sidebar="trigger"]');await page.waitForSelector('[role=dialog][data-sheet-open=true]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog][data-sheet-open]'));await check('phone first trusted Escape closes drawer and restores trigger focus',await page.evaluate(()=>document.activeElement?.getAttribute('data-sidebar')),'trigger');}
  await check('layout fits '+width,await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]),[width,width]);
 }
 // An independent second organization for the same synthetic actor; no fixture evidence is copied.
 const {rows:[employee]}=await pool.query('select user_id from employee where organization_id=$1 and id=$2',[a.organizationId,a.employeeId]);extraMember=randomUUID();
 await pool.query("insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,employee.user_id]);await go();
 await page.setRequestInterception(true);page.on('request',r=>{if(!held&&r.method()==='POST'&&r.headers()['next-action'])held=r;else void r.continue().catch(()=>{});});
 await click('button[aria-label="Refresh data"]');for(let i=0;i<100&&!held;i++)await new Promise(r=>setTimeout(r,50));assert.ok(held);
 await click('button[aria-label^="Switch Organization:"]');const navigation=page.waitForNavigation({waitUntil:'networkidle0',timeout:90000});await click('[role=menuitem]::-p-text(Performance large)');await held.continue().catch(()=>{});await navigation;await page.waitForFunction(()=>document.body.innerText.includes('Page not found'),{timeout:90000});
 await check('organization switch during held record read withdraws old check target',await page.$$eval('button',ns=>ns.filter(n=>n.checkVisibility()).every(n=>n.textContent!=='Record original check')));await page.screenshot({path:join(out,'organization-switch.png')});
 await click('button[aria-label^="Switch Organization:"]');await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:90000}),click('[role=menuitem]::-p-text(Performance small)')]);await page.waitForSelector('input[name=documentIssuedOn]');
 page.removeAllListeners('request');await page.setRequestInterception(false);
 // Load failure followed by actual grant loss: retry must re-read the page guard.
 let abort=true;await page.setRequestInterception(true);page.on('request',r=>{if(abort&&r.method()==='POST'&&r.headers()['next-action'])void r.abort('failed').catch(()=>{});else void r.continue().catch(()=>{});});
 await click('button[aria-label="Refresh data"]');await page.waitForSelector('[role=alert]');
 await pool.query('update driving_licence_verifier_grant set revoked_at=now(),revoked_by=granted_by where organization_id=$1 and verifier_employee_id=$2 and revoked_at is null',[a.organizationId,a.employeeId]);revoked=true;abort=false;
 await click('button::-p-text(Retry)');await page.waitForFunction(()=>document.body.innerText.includes('Page not found'));
 await check('retry after load failure uses fresh verifier rights',await page.$$eval('button',ns=>ns.filter(n=>n.checkVisibility()).every(n=>n.textContent!=='Record original check')));await page.screenshot({path:join(out,'retry-current-denial.png')});
 await check('context browser errors',errors,[]);
} finally {
 if(revoked)await pool.query('update driving_licence_verifier_grant set revoked_at=null,revoked_by=null where organization_id=$1 and verifier_employee_id=$2',[a.organizationId,a.employeeId]);
 if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);
 await held?.continue().catch(()=>{});await save();await browser.close();await pool.end();
}
