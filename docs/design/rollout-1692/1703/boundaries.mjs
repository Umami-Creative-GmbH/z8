// Post-comparison synthetic setup, real authorized reads, and real organization switch.
// pnpm node docs/design/rollout-1692/1703/boundaries.mjs <private-fixture-directory>
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { resolve,join } from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1703');
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg');const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();assert.equal((await db.query('select current_database() name')).rows[0].name,runtime.env.POSTGRES_DB);
const a=fixture.actors['small-admin'],restricted=fixture.actors['small-restricted'];
for(const actor of [a,restricted,fixture.actors['large-restricted']]){const r=await db.query('select e.user_id,u.email from employee e join "user" u on u.id=e.user_id where e.id=$1 and e.organization_id=$2',[actor.employeeId,actor.organizationId]);assert.equal(r.rows[0]?.email,actor.email);actor.userId=r.rows[0].user_id;}
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results={},errors=[];let restoreRole=false,restoreUser=false;
try{
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:1000});
 const press=async(text,selector='button')=>{await page.waitForFunction((text,selector)=>[...document.querySelectorAll(selector)].some(n=>n.getClientRects().length&&(n.textContent.trim()===text||n.getAttribute('aria-label')===text||(selector==='[role=menuitem]'&&n.textContent.trim().startsWith(text)))),{},text,selector);const h=await page.evaluateHandle((text,selector)=>[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length&&(n.textContent.trim()===text||n.getAttribute('aria-label')===text||(selector==='[role=menuitem]'&&n.textContent.trim().startsWith(text)))),text,selector);await h.asElement().click();await h.dispose();};
 const wait=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{},text);
 const go=()=>page.goto(runtime.origin+'/en/analytics/overtime-burn-down',{waitUntil:'networkidle0',timeout:120000});
 await go();await wait('Current Overtime');await press('Period');await page.waitForSelector('[role=option]');await press('Last Year','[role=option]');await page.waitForFunction(()=>document.body.innerText.includes('2025')&&document.querySelector('dl'));
 // A source admission change is applied only to the owned synthetic actor, then restored.
 restoreRole=true;assert.equal((await db.query("update employee set role='employee' where id=$1 and organization_id=$2 and user_id=$3 and role='admin'",[a.employeeId,a.organizationId,a.userId])).rowCount,1);
 await press('Refresh data');await wait('Access Restricted');assert.ok(await page.evaluate(()=>!document.querySelector('dl')&&!document.querySelector('button[aria-label="Period"]')));await page.screenshot({path:join(out,'after-authority-loss.png')});results.authorityLoss='Real employee-role revocation followed by shared refresh refused access and removed cached analytics';
 await db.query("update employee set role='admin' where id=$1 and organization_id=$2 and user_id=$3",[a.employeeId,a.organizationId,a.userId]);restoreRole=false;
 // Missing-profile arrival: temporary fixture-only reassociation, restored in finally.
 restoreUser=true;assert.equal((await db.query('update employee set user_id=$1 where id=$2 and organization_id=$3 and user_id=$4',[fixture.actors['large-restricted'].userId,restricted.employeeId,restricted.organizationId,restricted.userId])).rowCount,1);
 const missingContext=await browser.createBrowserContext();await missingContext.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await missingContext.setCookie(...auth['small-restricted'].cookies);const missing=await missingContext.newPage();await missing.goto(runtime.origin+'/en/analytics/overtime-burn-down',{waitUntil:'networkidle0',timeout:120000});const missingResult=await missing.evaluate(()=>({path:location.pathname,headings:[...document.querySelectorAll('h1')].map(n=>n.textContent),profileRequired:document.body.innerText.includes('Employee Profile Required')}));assert.ok(missingResult.path.endsWith('/sign-in')||missingResult.profileRequired);if(missingResult.profileRequired)assert.deepEqual(missingResult.headings,['Overtime Burn-Down']);await missing.screenshot({path:join(out,'after-no-employee.png')});results.noEmployee={...missingResult,limit:'Fixture employee reassociation invokes global session guard before analytics arrival; layout-specific no-employee panel is source-reviewed, not live-certified'};await missingContext.close();
 await db.query('update employee set user_id=$1 where id=$2 and organization_id=$3',[restricted.userId,restricted.employeeId,restricted.organizationId]);restoreUser=false;
 // Join another generated organization through real invitation handlers, then switch in flight.

 const existing=(await db.query('select m.id from member m join "user" u on u.id=m.user_id where m.organization_id=$1 and u.email=$2',[a.organizationId,fixture.actors['large-admin'].email])).rows.length>0;
 if(!existing){
  const invitation=await fetch(runtime.origin+'/api/auth/organization/invite-member',{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:auth['small-admin'].cookies.map(c=>`${c.name}=${c.value}`).join('; ')},body:JSON.stringify({organizationId:a.organizationId,email:fixture.actors['large-admin'].email,role:'member',resend:true})});assert.equal(invitation.status,200);const {id}=await invitation.json();
  await context.setCookie(...auth['large-admin'].cookies);await go();
  const accepted=await page.evaluate(async id=>(await fetch('/api/auth/organization/accept-invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invitationId:id})})).status,id);assert.equal(accepted,200);
 }else await context.setCookie(...auth['large-admin'].cookies);
 const active=await page.evaluate(async organizationId=>(await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})})).status,fixture.actors['large-admin'].organizationId);assert.equal(active,200);

 await go();await wait('Current Overtime');await press('Period');await page.waitForSelector('[role=option]');await press('Last Year','[role=option]');await page.waitForFunction(()=>document.body.innerText.includes('2025')&&document.querySelector('dl'));
 let hold=true,held,ready;const heldReady=new Promise(r=>ready=r);await page.setRequestInterception(true);page.on('request',r=>{if(hold&&r.headers()['next-action']&&r.postData()?.includes('2025')){held=r;ready();return;}void r.continue();});
 await press('Refresh data');await heldReady;
 await press('Switch Organization: Performance large');await page.waitForSelector('[role=menuitem]');await press('Performance small','[role=menuitem]');
 await page.waitForFunction(()=>!document.querySelector('dl'));await page.screenshot({path:join(out,'after-organization-switch-pending.png')});hold=false;await held.continue().catch(()=>{});
 await page.waitForNetworkIdle({idleTime:1000,timeout:20000}).catch(()=>{});const destination=await page.evaluate(()=>({path:location.pathname,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.textContent),main:document.querySelector('main')?.innerText.slice(0,3000),stale:Boolean(document.querySelector('dl'))}));assert.equal(destination.stale,false);await page.screenshot({path:join(out,'after-organization-switched.png')});results.organizationSwitch={destination,observation:'Real invite/accept added second membership; switch from large to small removed old 2025 data before its held result; full reload uses existing arrival guard'};
 results.errors=errors;await writeFile(join(out,'boundaries-runtime.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{
 if(restoreRole)await db.query("update employee set role='admin' where id=$1 and organization_id=$2 and user_id=$3",[a.employeeId,a.organizationId,a.userId]);
 if(restoreUser)await db.query('update employee set user_id=$1 where id=$2 and organization_id=$3',[restricted.userId,restricted.employeeId,restricted.organizationId]);
 await browser.close();await db.end();
}
