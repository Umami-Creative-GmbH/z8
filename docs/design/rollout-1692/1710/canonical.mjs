// Representative canonical records, only in a label-verified disposable database.
// They deliberately lack captured evidence: real readers/writers must hold them.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1710'),json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),s=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of s.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8'}).trim(),s.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg'),db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const manager=f.actors['small-manager'],subject=f.actors['small-restricted'],org=manager.organizationId;
const ids=Object.fromEntries(['category','source','workflow','stage','assignment'].map(k=>[k,randomUUID()]));
const checks=[],check=(name,value)=>{assert.ok(value,name);checks.push({name,passed:true});console.log('Passed: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 assert.equal((await db.query("select count(*) from approval_workflow_rollout where organization_id=$1 and workflow_type='absence'",[org])).rows[0].count,'0');
 await db.query("insert into absence_category(id,organization_id,type,name,requires_approval,updated_at) values($1,$2,'vacation','R012 canonical leave',true,now())",[ids.category,org]);
 await db.query("insert into absence_entry(id,employee_id,organization_id,category_id,start_date,end_date,status,updated_at) values($1,$2,$3,$4,'2026-12-07','2026-12-08','pending',now())",[ids.source,subject.employeeId,org,ids.category]);
 await db.query("insert into approval_workflow_rollout(organization_id,workflow_type,lifecycle_mode,updated_at) values($1,'absence','canonical',now())",[org]);
 await db.query("insert into approval_evidence_control(organization_id,workflow_type,mode) values($1,'absence','capture')",[org]);
 await db.query("insert into approval_workflow(id,organization_id,workflow_type,source_type,source_id,requester_employee_id,current_stage_order,policy_snapshot,context_snapshot,display_snapshot,updated_at) values($1,$2,'absence','absence_entry',$3,$4,1,'{}','{}','{}',now())",[ids.workflow,org,ids.source,subject.employeeId]);
 await db.query("update absence_entry set approval_workflow_id=$1 where id=$2 and organization_id=$3",[ids.workflow,ids.source,org]);
 await db.query("insert into approval_workflow_stage(id,organization_id,workflow_id,stage_order,label,resolver_snapshot,activation_mode,status,updated_at) values($1,$2,$3,1,'Manager review','{}','all','pending',now())",[ids.stage,org,ids.workflow]);
 await db.query("insert into approval_stage_assignment(id,organization_id,workflow_id,stage_id,assignment_sequence,approver_employee_id,updated_at) values($1,$2,$3,$4,1,$5,now())",[ids.assignment,org,ids.workflow,ids.stage,manager.employeeId]);
 await db.query("insert into approval_inbox_projection(organization_id,workflow_id,active_stage_id,source_type,source_id,status,display_payload,search_text,updated_at) values($1,$2,$3,'absence_entry',$4,'pending','{}','R012 canonical leave',now())",[org,ids.workflow,ids.stage,ids.source]);
 const context=await browser.createBrowserContext();await context.setCookie(...auth['small-manager'].cookies);await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});
 const path=`/en/approvals/review/${org}/canonical/${ids.assignment}`;
 await page.goto(r.origin+path,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('[role=dialog]');
 check('canonical assignment arrives in the existing detail panel',await page.$eval('[role=dialog]',n=>n.innerText.includes('R012 canonical leave')));
 const detail=await page.evaluate(async id=>{const res=await fetch('/api/approvals/inbox/'+id);return {status:res.status,body:await res.json()};},ids.assignment);
 check('fresh canonical detail pins the exact assignment',detail.status===200&&detail.body.item.id===ids.assignment);
 check('missing canonical evidence holds both decisions',!detail.body.actions.canApprove&&!detail.body.actions.canReject);
 await page.screenshot({path:join(out,'after-canonical-held.png'),fullPage:true});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));const reopen=await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Show details'));await reopen.asElement().focus();await page.keyboard.press('Enter');await page.waitForSelector('[role=dialog]');check('canonical detail reopens by keyboard',true);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));await page.setViewport({width:390,height:844});await page.locator('[data-sidebar=trigger]').click();await page.waitForSelector('[data-mobile=true]');check('review retains reachable mobile navigation',true);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[data-mobile=true]'));check('mobile navigation dismisses with Escape',true);
 const refusal=await page.evaluate(async id=>{const res=await fetch('/api/approvals/inbox/'+id+'/approve',{method:'POST'});return res.status;},ids.assignment);check('canonical writer refuses held evidence',refusal>=400);
 await page.goto(r.origin+path.replace('/canonical/','/compatibility/'),{waitUntil:'networkidle0'});check('compatibility kind cannot substitute for a canonical assignment',await page.$eval('main',n=>n.innerText.includes('This approval is not available')));
 await db.query("update approval_stage_assignment set status='cancelled' where id=$1 and organization_id=$2",[ids.assignment,org]);await page.goto(r.origin+path,{waitUntil:'networkidle0'});check('retired canonical assignment is safely unavailable',await page.$eval('main',n=>n.innerText.includes('This approval is not available')));
 await writeFile(join(out,'canonical-runtime.json'),JSON.stringify({checks,refusalStatus:refusal,scope:'owned disposable fixture; seeded real canonical absence/workflow/stage/assignment/projection; missing evidence intentional; no manufactured HTTP success'},null,2)+'\n');
}finally{
 await browser.close();await db.query('delete from absence_entry where id=$1 and organization_id=$2',[ids.source,org]);await db.query('delete from approval_workflow where id=$1 and organization_id=$2',[ids.workflow,org]);await db.query('delete from absence_category where id=$1 and organization_id=$2',[ids.category,org]);await db.query("delete from approval_workflow_rollout where organization_id=$1 and workflow_type='absence'",[org]);await db.query("delete from approval_evidence_control where organization_id=$1 and workflow_type='absence'",[org]);await db.end();
}
