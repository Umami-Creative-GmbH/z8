import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
import {repo,dir,runtime,fixture,pool} from '../docs/design/rollout-1692/1719/fixture.mjs';
const phase=process.argv[3],out=resolve('.tmp/1725-root-runtime');await mkdir(out,{recursive:true});
const a=fixture.actors['small-admin'],oldB=fixture.actors['large-restricted'];
const b={organizationId:'perf-payroll-b-'+a.organizationId.split('-').at(-1)};assert.notEqual(a.organizationId,b.organizationId);
const {rows:[person]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);assert.ok(person);
// Explicit disposable identity/authorization setup only. No payroll work, job,
// payout, comparison or delivery result is written by this setup.
// Restore the earlier large-target setup: that destination's legacy bulk absence
// backfill overflowed its stack. Retain its failed evidence; never call it passed.
await pool.query('update employee set user_id=(select id from "user" where email=$1) where id=$2 and organization_id=$3',[oldB.email,oldB.employeeId,oldB.organizationId]);
await pool.query('insert into organization select (jsonb_populate_record(null::organization,to_jsonb(source)||$2::jsonb)).* from organization source where source.id=$1 on conflict(id) do nothing',[a.organizationId,JSON.stringify({id:b.organizationId,name:'Payroll scope B',slug:b.organizationId})]);
await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) select $1,$2,$3,'admin','approved',now() where not exists(select 1 from member where organization_id=$2 and user_id=$3)",[randomUUID(),b.organizationId,person.user_id]);
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-admin'].cookies);
const page=await context.newPage();await page.setViewport({width:1600,height:1000});page.setDefaultTimeout(45000);
const result={phase,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Real same-user authorized organization change through Better Auth endpoint, followed by actual Next router.refresh without a full navigation. Router call is synthetic; server props and data are genuine.',checks:[],captures:[],pageErrors:[],rsc:[]};
page.on('pageerror',error=>result.pageErrors.push(error.message));
const record=(name,details={})=>{result.checks.push({name,passed:true,...details});console.log('Passed: '+name);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourcePaths=['apps/webapp/src/components/payroll/payroll-workspace.tsx','apps/webapp/src/lib/payroll-workspace/types.ts','apps/webapp/src/lib/payroll-workspace/summary.ts'];
const capture=async name=>{await page.evaluate(()=>document.fonts.ready);const file=phase+'-'+name+'.png';await page.screenshot({path:join(out,file)});const bytes=await readFile(join(out,file));result.captures.push({name:file,sha256:hash(bytes),sources:Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,hash(await readFile(path))]))),png:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},...await page.evaluate(()=>({css:{width:innerWidth,height:innerHeight},rootFont:getComputedStyle(document.documentElement).fontSize,font:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,path:location.pathname,headings:[...document.querySelectorAll('main h1')].filter(e=>e.checkVisibility()).map(e=>e.textContent)}))});};
const count=()=>page.$$eval('[role=region][aria-label="Employee totals"] table tbody tr',rows=>rows.length);
const click=async name=>{const handle=await page.waitForFunction(name=>[...document.querySelectorAll('button')].find(node=>node.checkVisibility()&&!node.disabled&&(node.textContent.trim()===name||node.getAttribute('aria-label')===name)),{},name);await handle.asElement().click();};
const switchTo=async organizationId=>{const status=await page.evaluate(async organizationId=>(await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})})).status,organizationId);assert.equal(status,200);};
let currentRsc,finishRsc;
page.on('response',async response=>{if(response.request().method()!=='GET'||new URL(response.url()).pathname!=='/en/payroll'||response.request().headers().rsc!=='1')return;try{const body=await response.text();const scope=currentRsc;if(scope&&body.includes(scope)){result.rsc.push({status:response.status(),containsExpectedOrganization:true});finishRsc();}}catch{}});
const refreshServer=async organizationId=>{currentRsc=organizationId;const ready=new Promise(done=>finishRsc=done);await page.evaluate(()=>{if(typeof window.next?.router?.refresh!=='function')throw Error('Actual Next router refresh unavailable');window.next.router.refresh();});const timer=new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('No authorized RSC scope arrival')),45000);t.unref();});await Promise.race([ready,timer]);};
try{
 await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'networkidle2',timeout:120000});
 const joinStatus=await page.evaluate(async organizationId=>(await fetch('/api/organizations/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})})).status,b.organizationId);assert.equal(joinStatus,200);
 const {rows:[joined]}=await pool.query('select id from employee where organization_id=$1 and user_id=$2',[b.organizationId,person.user_id]);assert.ok(joined);b.employeeId=joined.id;
 if(!(await pool.query('select id from payroll_access_grant where organization_id=$1 and payroll_employee_id=$2 and is_active',[b.organizationId,b.employeeId])).rows.length)await pool.query("insert into payroll_access_grant(organization_id,payroll_employee_id,scope,created_by,updated_at) values($1,$2,'all',$3,now())",[b.organizationId,b.employeeId,person.user_id]);
 await pool.query('insert into payroll_export_config(organization_id,format_id,config,created_by,updated_at) select $1,format_id,config,$2,now() from payroll_export_config source where source.organization_id=$3 and source.format_id=$4 and not exists(select 1 from payroll_export_config target where target.organization_id=$1 and target.format_id=source.format_id)',[b.organizationId,person.user_id,a.organizationId,'datev_lohn']);
 result.fixtureSetup='Additional empty local organization, approved fixture membership, actual organization-switch joining owner and independent payroll grant/file configuration. No fabricated payroll records or action outcomes.';
 await switchTo(a.organizationId);
 await page.goto(runtime.origin+'/en/payroll',{waitUntil:'networkidle2',timeout:120000});await page.waitForSelector('#payroll-export-target');assert.equal(await count(),8);record('actual A payroll admission shows eight granted employees');
 await page.evaluate(()=>{window.__payrollArrivalControl=document.querySelector('#payroll-start-date');});
 await switchTo(b.organizationId);record('real Better Auth organization switch accepts the same user in B');await refreshServer(b.organizationId);
 if(phase==='after')await page.waitForFunction(()=>document.querySelectorAll('[role=region][aria-label="Employee totals"] table tbody tr').length===1);
 await click('Specific employees');await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] [role=checkbox]')].filter(node=>node.checkVisibility()).length===1);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 record('committed B server props expose exactly one employee in the real scope picker');
 if(phase==='before'){
  result.sameControlRetained=await page.evaluate(()=>window.__payrollArrivalControl===document.querySelector('#payroll-start-date'));
  if(result.sameControlRetained){assert.equal(await count(),8);record('baseline keeps eight A records after genuine authorized B server props arrive');}
  else{assert.equal(await count(),1);result.qualification='The real framework arrival remounted the baseline as well. Same-instance source gaps remain assembled-only, not a browser reproduction.';record('actual baseline arrival remounts safely; same-instance gap not reproduced in this browser journey');}
 }else{
  await page.waitForFunction(()=>document.querySelectorAll('[role=region][aria-label="Employee totals"] table tbody tr').length===1);assert.equal(await page.evaluate(()=>window.__payrollArrivalControl===document.querySelector('#payroll-start-date')),false);
  record('corrected arrival replaces A records with the one independently granted B employee');
 }
 await capture('authorized-b-arrival');await page.$eval('[role=region][aria-label="Employee totals"]',node=>node.scrollIntoView({block:'center'}));await capture('authorized-b-records');
 await switchTo(a.organizationId);await refreshServer(a.organizationId);await page.waitForFunction(()=>document.querySelectorAll('[role=region][aria-label="Employee totals"] table tbody tr').length===8);record('real A return settles with eight authorized employee rows');
 if(phase==='after'){
  await click('Custom');await page.$eval('#payroll-start-date',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'2025-03-07');node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.evaluate(()=>{window.__payrollRefreshPending=false;window.__payrollRefreshObserver?.disconnect();window.__payrollRefreshObserver=new MutationObserver(()=>{if(document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='true')window.__payrollRefreshPending=true;});window.__payrollRefreshObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['aria-busy']});});
  await click('Refresh data');await page.waitForFunction(()=>window.__payrollRefreshPending&&document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='false');await page.evaluate(()=>window.__payrollRefreshObserver.disconnect());assert.equal(await page.$eval('#payroll-start-date',node=>node.value),'2025-03-07');record('same-scope actual header Refresh preserves the unsaved custom draft through its completed pending cycle');
  const downloads=join(dir,'root-payroll-downloads');await mkdir(downloads,{recursive:true});const client=await page.createCDPSession();await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,browserContextId:context.id});
  const jobsBefore=Number((await pool.query('select count(*)::int as n from payroll_export_job where organization_id=$1',[a.organizationId])).rows[0].n);await click('Download PDF');
  let file;for(let attempt=0;attempt<100;attempt++){file=(await readdir(downloads)).find(name=>name.endsWith('.pdf'));if(file)break;await new Promise(done=>setTimeout(done,100));}assert.ok(file,'Actual PDF download');const pdf=await readFile(join(downloads,file));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.equal(Number((await pool.query('select count(*)::int as n from payroll_export_job where organization_id=$1',[a.organizationId])).rows[0].n),jobsBefore);record('fresh PDF downloads real PDF bytes without creating an export job',{bytes:pdf.length});await capture('returned-a-draft');
 }
 result.next=[];for(const name of ['get_compilation_issues','get_errors']){const response=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}}),signal:AbortSignal.timeout(45000)});const raw=await response.text();const item=response.headers.get('content-type')?.includes('event-stream')?JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('data: ')).slice(6)):JSON.parse(raw);result.next.push({name,result:item});}
}catch(error){result.failure=error.message;await page.screenshot({path:join(out,phase+'-failed.png')}).catch(()=>{});throw error;}
finally{await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
