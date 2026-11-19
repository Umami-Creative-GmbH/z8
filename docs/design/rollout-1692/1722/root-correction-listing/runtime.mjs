import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('.tmp/1722-root-runtime');await mkdir(out,{recursive:true});
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const container of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const require=createRequire(resolve('apps/webapp/package.json')),{Pool}=require('pg');const pool=new Pool({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
const actor=f.actors['small-employee'];
const continuing=process.argv[3]==='continue';
const result=continuing?JSON.parse(await readFile(join(out,'attempt-status-label.json'),'utf8')):{checks:[],captures:[],pageErrors:[],sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),comparison:'Only the owned server reader is replaced with exact 05c66 source; all other integrated code stays current.'};
if(continuing){delete result.failure;result.continuation='Same actual pending request; browser restarted after a harness incorrectly expected English fallback Pending rather than the actual translated In review label. No product source change.';}
const record=(name,details={})=>{result.checks.push({name,passed:true,...details});console.log('Passed: '+name);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const readerPath='apps/webapp/src/lib/self-service-requests/get-self-service-requests.ts',saved=await readFile(readerPath),baseline=execFileSync('git',['show','05c66b101e16b98d678a66bf2256f0e875eb9b73:'+readerPath]);
result.reader={path:readerPath,beforeCommit:'05c66b101e16b98d678a66bf2256f0e875eb9b73',beforeSha256:hash(baseline),afterSha256:hash(saved)};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-employee'].cookies);
const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});page.on('pageerror',error=>result.pageErrors.push(error.message));
const click=async(name,selector='button')=>{const node=(await page.waitForFunction((name,selector)=>[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length&&n.textContent.trim()===name),{},name,selector)).asElement();await node.click();};
const capture=async name=>{
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(out,name+'.png'),fullPage:true});const png=await readFile(join(out,name+'.png'));
 result.captures.push({name:name+'.png',sha256:hash(png),png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},readerSha256:hash(await readFile(readerPath)),...await page.evaluate(()=>({css:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,font:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,pathname:location.pathname,headings:[...document.querySelectorAll('h1')].map(n=>n.textContent),focusedTag:document.activeElement?.tagName}))});
};
const goto=async period=>{await page.goto(r.origin+'/en/my-requests?request=time_correction:'+period,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('#request-search');};
let overlay=false;
try{
 const user=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId])).rows[0].user_id;
 const existing=await pool.query("select id from change_policy where organization_id=$1 and name='Root correction approval window'",[actor.organizationId]);
 if(!existing.rows.length){const policy=(await pool.query("insert into change_policy(organization_id,name,self_service_days,approval_days,no_approval_required,created_by,updated_at) values($1,'Root correction approval window',0,1000,false,$2,now()) returning id",[actor.organizationId,user])).rows[0].id;await pool.query("insert into change_policy_assignment(policy_id,organization_id,assignment_type,employee_id,priority,created_by,updated_at) values($1,$2,'employee',$3,99,$4,now())",[policy,actor.organizationId,actor.employeeId,user]);}
 const manager=f.actors['small-manager'];assert.equal(manager.organizationId,actor.organizationId);assert.notEqual(manager.employeeId,actor.employeeId);
 const managerUser=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[manager.employeeId,actor.organizationId])).rows[0].user_id;
 if(!(await pool.query('select id from employee_managers where employee_id=$1 and is_primary=true',[actor.employeeId])).rows.length)await pool.query('insert into employee_managers(id,employee_id,manager_id,is_primary,assigned_by,assigned_at,created_at) values(gen_random_uuid(),$1,$2,true,$3,now(),now())',[actor.employeeId,manager.employeeId,managerUser]);
 if(!continuing)record('disposable employee-specific approval policy and primary manager are fixture setup, not product actions');
 const period=(await pool.query("select id,clock_in_id,clock_out_id,start_time::text,end_time::text,duration_minutes,approval_status,canonical_record_id from work_period where employee_id=$1 and organization_id=$2 and start_time>='2025-01-20' and start_time<'2025-01-21' and end_time is not null and deleted_at is null order by start_time limit 1",[actor.employeeId,actor.organizationId])).rows[0];assert.ok(period);
 const reason='Root R030 real correction listing proof';
 if(!continuing){
 await page.goto(r.origin+'/en/calendar/'+actor.employeeId+'?date=2025-01-20',{waitUntil:'networkidle0',timeout:120000});
 const event=await page.waitForSelector('[data-event-id="'+period.id+'"]');await event.focus();await page.keyboard.down('Shift');await page.keyboard.press('F10');await page.keyboard.up('Shift');await click('Edit','[role=menuitem]');await page.waitForSelector('[role=dialog]');
 if(await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] button')].some(n=>n.textContent.trim()==='Edit entry')))await click('Edit entry');
 await page.waitForSelector('[role=dialog] input[name=clockOutTime]');await page.$eval('[role=dialog] input[name=clockOutTime]',input=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'18:15');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});await page.keyboard.press('Tab');assert.equal(await page.$eval('[role=dialog] input[name=clockOutTime]',input=>input.value),'18:15');
 await page.waitForSelector('[role=dialog] textarea[name=reason]');await page.type('[role=dialog] textarea[name=reason]',reason);
 const submitted=page.waitForResponse(res=>res.request().headers()['next-action']&&res.request().postData()?.includes(reason));await click('Submit for approval');assert.ok(/"success":true/.test(await(await submitted).text()));
 }
 const requests=(await pool.query('select id,entity_id,status,metadata from approval_request where organization_id=$1 and requested_by=$2 and entity_id=$3 and reason=$4',[actor.organizationId,actor.employeeId,period.id,reason])).rows;assert.equal(requests.length,1);const request=requests[0];assert.equal(request.status,'pending');
 const entries=(await pool.query("select id,type,is_superseded,superseded_by_id,replaces_entry_id from time_entry where organization_id=$1 and employee_id=$2 and notes=$3",[actor.organizationId,actor.employeeId,reason])).rows;assert.ok(entries.length);assert.ok(entries.every(row=>row.type==='correction'&&row.is_superseded&&row.superseded_by_id===null));
 result.submission={periodId:period.id,requestId:request.id,entries,rollout:(await pool.query("select lifecycle_mode,side_effect_mode from approval_workflow_rollout where organization_id=$1 and workflow_type='time_correction'",[actor.organizationId])).rows,admission:(await pool.query('select mode from time_entry_append_control where organization_id=$1',[actor.organizationId])).rows};
 if(!continuing)record('real calendar form creates a pending owned correction with the production inactive endpoint shape');
 try{if(!continuing){await writeFile(readerPath,baseline);overlay=true;await goto(period.id);await page.waitForFunction(()=>document.body.innerText.includes('Period readiness is being checked again.'));assert.equal(await page.evaluate(()=>document.activeElement?.closest('article')!==null),false);await capture('before-unavailable');record('exact pre-fix reader fails to list this actual pending correction');}}
 finally{if(overlay){assert.equal(hash(await readFile(readerPath)),hash(baseline),'Concurrent reader edit; refusing restore');await writeFile(readerPath,saved);overlay=false;}}
 await goto(period.id);await page.waitForFunction(()=>document.activeElement?.tagName==='ARTICLE');const articleId=await page.evaluate(()=>document.activeElement.id);assert.ok(await page.evaluate(id=>document.getElementById(id).textContent.includes('Cancel'),articleId));await capture('after-pending');record('corrected reader focuses the same pending correction and exposes Cancel');
 const cancelButton=async()=>(await page.waitForFunction(id=>[...document.getElementById(id).querySelectorAll('button')].find(n=>n.textContent.trim()==='Cancel'),{},articleId)).asElement();
 let commands=0;page.on('request',q=>{if(q.headers()['next-action']&&q.postData()?.includes(period.id))commands++;});
 page.once('dialog',dialog=>dialog.dismiss());await(await cancelButton()).click();assert.equal(commands,0);assert.equal((await pool.query('select status from approval_request where id=$1',[request.id])).rows[0].status,'pending');record('declined native confirmation sends no cancellation and preserves pending source');
 const cancellation=page.waitForResponse(res=>res.request().headers()['next-action']&&res.request().postData()?.includes(period.id));page.once('dialog',dialog=>dialog.accept());await(await cancelButton()).click();assert.ok(/"success":true/.test(await(await cancellation).text()));assert.equal(commands,1);record('one confirmed actual pointer action successfully cancels the correction',{commands});
 const after=(await pool.query('select id,clock_in_id,clock_out_id,start_time::text,end_time::text,duration_minutes,approval_status,canonical_record_id from work_period where id=$1 and organization_id=$2',[period.id,actor.organizationId])).rows[0];assert.deepEqual(after,period);const persisted=(await pool.query('select status,metadata from approval_request where id=$1 and organization_id=$2',[request.id,actor.organizationId])).rows[0];assert.equal(persisted.status,'rejected');assert.equal(persisted.metadata.cancellation.kind,'requester');result.cancellation={requestStatus:persisted.status,workPeriodUnchanged:true};record('persisted requester cancellation preserves the original work interval, endpoints and canonical record link');
 await goto(period.id);await page.waitForFunction(()=>document.body.innerText.includes('Period readiness is being checked again.'));
 const retained=(await pool.query("select id from time_entry where organization_id=$1 and employee_id=$2 and notes=$3",[actor.organizationId,actor.employeeId,reason])).rows;
 if(result.submission.admission.some(row=>row.mode==='active')){assert.ok(await page.evaluate(()=>document.body.innerText.includes('Cancelled')));record('fresh page readback shows retained Cancelled history and unavailable pending arrival');}
 else {assert.equal(retained.length,0);result.legacyHistoryQualification='Non-adopted fixture cancellation deletes pending correction entries. The strict relational reader consequently omits its legacy tombstone; this does not certify retained Cancelled history. Adopted history is verified by PostgreSQL cases.';record('fresh page readback safely rejects the no-longer-pending arrival; legacy source entries were deleted');}
 await capture('after-cancelled');
 assert.deepEqual(result.pageErrors,[]);record('accepted browser observations have zero page exceptions');
 const call=async name=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}}),signal:AbortSignal.timeout(120000)});const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?raw.split(/\r?\n/).filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))):JSON.parse(raw);};
 result.next=[];for(const name of ['get_compilation_issues','get_errors'])result.next.push({name,result:await call(name)});
}catch(error){result.failure=error.message;await page.screenshot({path:join(out,'failed.png'),fullPage:true}).catch(()=>{});throw error;}
finally{if(overlay&&hash(await readFile(readerPath))===hash(baseline))await writeFile(readerPath,saved);await writeFile(join(out,'runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
