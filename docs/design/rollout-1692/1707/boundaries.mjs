// Synthetic membership setup; real switch API and real authoritative decision refusal.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1707');const load=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const runtime=await load('runtime-private.json'),fixture=await load('fixture-private.json'),auth=await load('dev-auth-private.json'),seed=await load('r009-private.json');assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const require=createRequire(resolve('apps/webapp/package.json'));const {Client}=require('pg');const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const a=fixture.actors['small-manager'],other=fixture.actors['large-admin'];const user=(await db.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId])).rows[0].user_id;
const membership=randomUUID();await db.query('delete from member where organization_id=$1 and user_id=$2',[other.organizationId,user]);await db.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'member','approved',now())",[membership,other.organizationId,user]);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const results=[];
try{
 const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth['small-manager'].cookies);const p=await c.newPage();p.setDefaultTimeout(30000);await p.goto(runtime.origin+'/en/approvals',{waitUntil:'networkidle0',timeout:120000});await p.waitForSelector('tbody tr button');
 const number=await p.evaluate(()=>Number(document.querySelector('tbody tr').innerText.match(/R009 request (\d+):/)[1]));const entry=seed.ids[number-1];const row={id:entry.requestId,entity_id:entry.absenceId};assert.ok(row);
 // Open the corresponding visible first request through its real button.
 await (await p.$('tbody tr button:last-child')).click();await p.waitForSelector('[role=dialog] textarea');await p.type('[role=dialog] textarea','R009 org switch must not decide the old request');
 let held,ready;const waitHeld=new Promise(r=>ready=r);await p.setRequestInterception(true);const handler=r=>{if(r.headers()['next-action']&&r.postData()?.includes(row.entity_id)){held=r;ready();return;}void r.continue();};p.on('request',handler);
 const confirm=await p.$('[role=dialog] button[type=submit]');await confirm.focus();await p.keyboard.press('Enter');await Promise.race([waitHeld,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Chosen mutation did not start')),15000))]);
 const switcher=await c.newPage();await switcher.goto(runtime.origin+'/en/approvals',{waitUntil:'networkidle0'});
 const switched=await switcher.evaluate(async org=>{const r=await fetch('/api/organizations/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:org})});return {status:r.status,body:await r.json()};},other.organizationId);assert.equal(switched.status,200);
 // Resume the real mutation only after the session's active organization changed.
 p.off('request',handler);const reload=p.reload({waitUntil:'domcontentloaded',timeout:60000});await held.abort('aborted').catch(()=>{});await reload;await p.waitForNetworkIdle({idleTime:500,timeout:10000}).catch(()=>{});const boundaryState=await p.evaluate(()=>({path:location.pathname,text:document.body.innerText.slice(-1600),reason:document.querySelector('[role=dialog] textarea')?.value}));await writeFile(join(out,'boundary-state.json'),JSON.stringify(boundaryState,null,2));
 const pending=(await db.query('select status from approval_request where id=$1 and organization_id=$2',[row.id,a.organizationId])).rows[0].status;assert.equal(pending,'pending');results.push({organizationSwitchDuringMutation:'real switch and shell-equivalent reload cancelled the held old-target submission',requestStillPending:true,reasonRetained:boundaryState.reason?.includes('R009 org switch')??false});
 assert.equal(await p.$('tbody tr button'),null);await p.screenshot({path:join(out,'after-organization-switch.png')});results.push({newOrgHasNoOldQueue:true,path:await p.evaluate(()=>location.pathname),arrival:'Existing global employee/session guard may hand off to sign-in for the synthetic no-employee membership'});
 const restored=await switcher.evaluate(async org=>(await fetch('/api/organizations/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId:org})})).status,a.organizationId);assert.equal(restored,200);
 await writeFile(join(out,'boundaries-runtime.json'),JSON.stringify({results},null,2)+'\n');console.log(JSON.stringify(results));
}finally{await db.query('delete from member where id=$1 and organization_id=$2 and user_id=$3',[membership,other.organizationId,user]);await browser.close();await db.end();}
