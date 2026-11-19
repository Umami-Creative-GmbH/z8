import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),phase=process.argv[3],out=resolve('.tmp/1724-root-runtime');await mkdir(out,{recursive:true});
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const container of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(resolve('apps/webapp/package.json'))('pg'),pool=new Pool({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
const org=fixture.actors['large-admin'].organizationId;assert.match(org,/^perf-large-[a-f0-9]{12}$/);
const roster=(await pool.query('select e.id,u.name from employee e join "user" u on u.id=e.user_id where e.organization_id=$1',[org])).rows;
const person=n=>{const row=roster.find(row=>row.name===`Person ${n}`);assert.ok(row);return row;};
// Fixture prerequisites only: retain 200 current employees, create a deeper branch.
for(const[child,manager]of [[197,3],[199,197]])await pool.query('update employee_managers set manager_id=$1 where employee_id=$2',[person(manager).id,person(child).id]);
const result={phase,classification:'Actual scoped read actions; one held request and one browser transport failure, no fabricated action result. Two manager-link edits are disposable fixture setup.',checks:[],captures:[],pageErrors:[],requests:[]};
const record=(name,details={})=>{result.checks.push({name,passed:true,...details});console.log('Passed: '+name);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=['apps/webapp/src/app/[locale]/(app)/organization/org-explorer-client.tsx','apps/webapp/src/app/[locale]/(app)/organization/use-org-explorer-people.ts'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['large-admin'].cookies);
const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});page.on('pageerror',error=>result.pageErrors.push(error.message));
const rpc=async(name,args={})=>{const response=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(120000)});const raw=await response.text();const entries=response.headers.get('content-type')?.includes('event-stream')?raw.split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))):[JSON.parse(raw)];return entries.find(entry=>entry.id===1);};
const owner=async actionId=>{const response=await rpc('get_server_action_by_id',{actionId});return JSON.parse(response.result.content[0].text);};
const capture=async name=>{await page.evaluate(()=>document.fonts.ready);const file=phase+'-'+name+'.png';await page.screenshot({path:join(out,file)});const png=await readFile(join(out,file));result.captures.push({name:file,sha256:hash(png),png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:Object.fromEntries(await Promise.all(sources.map(async path=>[path,hash(await readFile(path))]))),...await page.evaluate(()=>({css:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,font:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,pathname:location.pathname,query:location.search}))});};
const click=async selector=>page.locator(selector).filter(element=>element.checkVisibility()).click();
const settle=async()=>{await page.waitForFunction(()=>[...document.querySelectorAll('search input')].some(input=>input.checkVisibility()&&Object.keys(input).some(key=>key.startsWith('__reactProps')&&typeof input[key].onChange==='function')));await page.evaluate(()=>document.fonts.ready);};
const orgPath=runtime.origin+'/en/organization';let mode='hold',held,releaseHeld,failed=false;
const gate=new Promise(done=>releaseHeld=done);
await page.setRequestInterception(true);
page.on('request',async request=>{
 if(request.isInterceptResolutionHandled())return;
 if(request.method()==='POST'&&new URL(request.url()).pathname==='/en/organization'&&request.headers()['next-action']&&request.postData()?.includes(person(199).id)){
  const action=await owner(request.headers()['next-action']).catch(error=>({lookupError:error.message}));
  result.requests.push({functionName:action.functionName,filename:action.filename,lookupError:action.lookupError,phase:mode});
  if(mode==='hold'){assert.equal(action.functionName,'getOrgExplorerPeople');held=request;mode='normal';releaseHeld();return;}
  if(mode==='fail'&&!failed){assert.equal(action.functionName,'getOrgExplorerPeople');failed=true;mode='normal';await request.abort('failed');return;}
 }
 if(!request.isInterceptResolutionHandled())await request.continue().catch(()=>{});
});
try{
 await page.goto(orgPath+'?employee='+person(199).id,{waitUntil:'domcontentloaded',timeout:120000});await settle();
 await Promise.race([gate,new Promise((_,reject)=>setTimeout(()=>reject(Error('No held actual person read')),45000))]);
 record('held the manifest-identified getOrgExplorerPeople action for current-roster Person 199');
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!new URL(location.href).searchParams.has('employee'));await click('button[aria-label="Refresh data"]');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='true');
 await page.evaluate(()=>history.back());await page.waitForFunction(id=>new URL(location.href).searchParams.get('employee')===id,{},person(199).id);
 const original=held;const oldResponse=page.waitForResponse(response=>response.request()===original);await held.continue();held=null;
 const body=await(await oldResponse).text();assert.ok(body.includes(person(199).id)&&body.includes('"success":true'));record('released an actual successful old read after real Refresh and Back',{currentRosterCount:roster.length});
 await page.waitForFunction(()=>document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='false');
 if(phase==='before'){
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] h2')].some(node=>node.checkVisibility()&&node.textContent.includes('Loading person')));
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('[role=dialog] h2')].some(node=>node.checkVisibility()&&node.textContent==='Person 199')),false);record('baseline strands the selected person after Refresh despite successful read');
 }else{
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] h2')].some(node=>node.checkVisibility()&&node.textContent==='Person 199'));record('corrected Refresh resolves the same selected person and preserves the URL');
 }
 await capture('selected-after-refresh');await page.keyboard.press('Escape');
 // A separate fresh visit exercises the retained failed-branch retry lifetime.
 await page.setViewport({width:390,height:844});await page.goto(orgPath,{waitUntil:'domcontentloaded'});await settle();await page.evaluate(()=>{localStorage.setItem('z8-font-size','large');localStorage.setItem('theme','dark');});await page.reload({waitUntil:'domcontentloaded'});await settle();
 await page.waitForSelector('li[aria-label="Person 197"]');assert.equal(await page.$('li[aria-label="Person 199"]'),null);mode='fail';
 await click('li[aria-label="Person 197"] button[aria-expanded]');await page.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(node=>node.checkVisibility()&&node.textContent.includes('Retry')));assert.equal(failed,true);record('real failed branch read retains the roster and exposes Retry');
 const retry=await page.locator('[role=alert] button').filter(node=>node.checkVisibility()).waitHandle();await retry.evaluate(node=>node.scrollIntoView({block:'center'}));await capture('branch-error');
 await page.evaluate(()=>{window.__orgBranchNode=document.querySelector('li[aria-label="Person 197"]');});
 await click('button[data-sidebar="trigger"]');await click('a[href="/en/absences"]');await page.waitForFunction(()=>location.pathname==='/en/absences'&&![...document.querySelectorAll('search input')].some(node=>node.checkVisibility()));
 await page.evaluate(()=>history.back());await page.waitForFunction(()=>location.pathname==='/en/organization'&&[...document.querySelectorAll('search input')].some(node=>node.checkVisibility()));
 result.cachedBranchRestored=await page.evaluate(()=>window.__orgBranchNode===document.querySelector('li[aria-label="Person 197"]'));
 if(!result.cachedBranchRestored){result.cachedQualification='The actual navigation remounted the branch; cached Activity reproduction remains assembled-only.';record('actual return remounted; no cached-lifetime browser claim');}
 else{
  await page.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(node=>node.checkVisibility()&&node.textContent.includes('Retry')));const response=page.waitForResponse(r=>r.request().headers()['next-action']&&r.request().postData()?.includes(person(199).id));await click('[role=alert] button');const retryBody=await(await response).text();assert.ok(retryBody.includes(person(199).id)&&retryBody.includes('"success":true'));
  await page.waitForFunction(()=>![...document.querySelectorAll('[role=alert]')].some(node=>node.checkVisibility()&&node.textContent.includes('Retry')));
  if(phase==='before'){assert.equal(await page.$('li[aria-label="Person 199"]'),null);record('baseline cached Retry discards real success and removes recovery');}
  else{await page.waitForSelector('li[aria-label="Person 199"]',{visible:true});record('corrected cached Retry accepts real success and restores the expanded branch');}
  await capture('branch-after-retry');
 }
 result.next=[];for(const name of ['get_compilation_issues','get_errors'])result.next.push({name,result:await rpc(name)});
}catch(error){result.failure=error.message;await page.screenshot({path:join(out,phase+'-failed.png')}).catch(()=>{});throw error;}
finally{if(held&&!held.isInterceptResolutionHandled())await held.abort().catch(()=>{});await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
