import assert from 'node:assert/strict';
import {join} from 'node:path';
import {repo,route,selector,heading,sha,requireRoot,requireWeb,sourceProof,fixtureFromPointer,actionsForRoute,outputDir,save,failure,normalSignIn} from './common.mjs';
// Run from repo: node <runtime.mjs> <pointer-path> <before|after> <unique-output-dir>
// The caller owns stopped-Next historical overlays. This driver never modifies app source.
const[pointer,phase,output]=process.argv.slice(2),out=await outputDir(output);
const result={phase,status:'failed-setup',setupComplete:false,checks:[],captures:[],errors:[],transportErrors:[],session:{observed:false,held:0,responses:[]},admission:{held:0,responses:[]},commands:{save:[],skip:[]},qualification:'Consumer-only historical client comparison: exact bd160d9 client before, exact 1230f617 client after; server actions, fields and onboarding service stay at 1230f617. Normal ephemeral sign-in; no cookie/state save or transfer. Actual requests are held and continued unchanged. Work-schedule Save intentionally saves progress only, not hours/classification policies.'};
let browser,pool,setup=false,failed=false,gate='none',held=[];
const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
try{
 result.source=await sourceProof(phase);
 const{runtime:r,fixture:f}=await fixtureFromPointer(pointer),actor=f.actors['large-admin'];assert.ok(actor,'large-admin fixture missing');
 const{Pool}=requireWeb('pg');pool=new Pool({host:r.env.POSTGRES_HOST,port:Number(r.env.POSTGRES_PORT),database:r.env.POSTGRES_DB,user:r.env.POSTGRES_USER,password:r.env.POSTGRES_PASSWORD});
 const snapshot=async a=>{
  const membership=(await pool.query('select m.role from member m join "user" u on u.id=m.user_id where u.email=$1 and m.organization_id=$2',[a.email,a.organizationId])).rows;
  assert.equal(membership.length,1,'Own fixture organization membership');
  const settings=(await pool.query('select us.onboarding_step from user_settings us join "user" u on u.id=us.user_id join member m on m.user_id=u.id and m.organization_id=$2 where u.email=$1',[a.email,a.organizationId])).rows;
  const counts=(await pool.query('select (select count(*)::int from work_policy where organization_id=$1) as policies,(select count(*)::int from work_policy_schedule s join work_policy p on p.id=s.policy_id where p.organization_id=$1) as schedules,(select count(*)::int from work_policy_schedule_day d join work_policy_schedule s on s.id=d.schedule_id join work_policy p on p.id=s.policy_id where p.organization_id=$1) as schedule_days,(select count(*)::int from work_policy_assignment where organization_id=$1) as assignments',[a.organizationId])).rows[0];
  assert.equal(settings.length,1,'Own fixture settings exist');return{membership:membership[0].role,settings:settings[0],counts};
 };
 const puppeteer=requireRoot('puppeteer-core');browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});page.on('pageerror',e=>result.errors.push(e.message));
 result.auth=await normalSignIn(page,r,actor);
 const go=async()=>{await page.goto(r.origin+route,{waitUntil:'domcontentloaded',timeout:90000});await page.waitForSelector(selector);};await go();
 result.actions=await actionsForRoute();const actions=result.actions;
 const release=async()=>{gate='none';const requests=held;held=[];for(const request of requests)await request.continue();};
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const id=request.headers()['next-action'],session=new URL(request.url()).pathname==='/api/auth/get-session',admission=request.method()==='POST'&&id===actions.checkIsAdmin;
  if((gate==='session'&&session)||(gate==='admission'&&admission)){held.push(request);if(session){result.session.observed=true;result.session.held++;}else result.admission.held++;return;}
  void request.continue().catch(error=>result.transportErrors.push(error.message));
 });
 page.on('response',response=>{
  const request=response.request(),id=request.headers()['next-action'];
  if(new URL(response.url()).pathname==='/api/auth/get-session')result.session.responses.push(response.status());
  if(id===actions.checkIsAdmin)result.admission.responses.push(response.status());
  if(id===actions.setWorkScheduleOnboarding)result.commands.save.push(response.status());
  if(id===actions.skipWorkScheduleSetup)result.commands.skip.push(response.status());
 });
 setup=true;result.setupComplete=true;result.status='running';
 const capture=async(owner,width,height,pending)=>{
  await page.setViewport({width,height});await page.evaluate(()=>document.fonts.ready);
  const observed=await page.evaluate(()=>({path:location.pathname,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('main h1')].filter(element=>element.checkVisibility()).map(element=>element.textContent.trim()),statuses:[...document.querySelectorAll('main [role=status]')].filter(element=>element.checkVisibility()).map(element=>element.getAttribute('aria-label')),workControls:document.querySelectorAll('#work-schedule-hours-per-week,#work-schedule-classification').length,editableInputs:[...document.querySelectorAll('main input:not([type=hidden]),main textarea,main [contenteditable=true]')].filter(element=>element.checkVisibility()&&!element.disabled&&!element.readOnly).length}));
  assert.equal(observed.path,route);assert.deepEqual(observed.headings,pending&&phase==='before'?[]:[heading]);assert.ok(observed.documentWidth<=width,'No horizontal overflow');
  if(pending){assert.equal(observed.workControls,0);assert.equal(observed.editableInputs,0);assert.ok(observed.statuses.includes('Checking work schedule access'));}
  const name=phase+'-'+owner+'-'+(width===1600?'desktop':'phone')+'.png';const image=Buffer.from(await page.screenshot({path:join(out,name)}));result.captures.push({name,owner,pending,...observed,sha256:sha(image),source:result.source});
 };
 const pendingCapture=async owner=>{await page.waitForFunction(()=>document.querySelector('main [role=status][aria-label="Checking work schedule access"]')&&!document.querySelector('#work-schedule-hours-per-week'));for(const[width,height]of[[1600,1000],[390,844]])await capture(owner,width,height,true);};
 // get-session is conditional: record it as unverified if this app arrival issues no real request.
 gate='session';const sessionStarted=page.waitForRequest(request=>new URL(request.url()).pathname==='/api/auth/get-session',{timeout:8000}).then(()=>true,()=>false);
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});
 if(await sessionStarted){await pendingCapture('session-pending');check('Real get-session pending owner captured without editable work inputs',result.session.held>=1);}else result.session.unverified='No actual browser /api/auth/get-session request observed on this reload; no session-loading proof claimed.';
 await release();await page.waitForSelector(selector);
 gate='admission';const admissionStarted=page.waitForRequest(request=>request.method()==='POST'&&request.headers()['next-action']===actions.checkIsAdmin,{timeout:45000});
 await page.reload({waitUntil:'domcontentloaded',timeout:90000});await admissionStarted;await pendingCapture('admission-pending');check('Real checkIsAdmin pending owner captured without editable work inputs',result.admission.held>=1);
 await release();await page.waitForSelector(selector);check('Original admission completes HTTP200',result.admission.responses.includes(200));
 for(const[width,height]of[[1600,1000],[390,844]])await capture('ready',width,height,false);
 check('Ready form retains exactly one task heading',await page.$$eval('main h1',elements=>elements.filter(element=>element.checkVisibility()).length)===1);
 if(phase==='after'){
  await page.setViewport({width:1600,height:1000});result.beforeSave=await snapshot(actor);check('Generated admin actor owns current organization',['owner','admin'].includes(result.beforeSave.membership));
  await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.sendCharacter('37.5');
  await page.waitForFunction(()=>document.querySelector('#work-schedule-hours-per-week')?.value==='37.5');
  await page.click('#work-schedule-classification');await (await page.waitForSelector('::-p-aria(Monthly)')).click();
  result.draft=await page.$eval(selector,element=>({value:element.value,disabled:element.disabled}));check('Actual schedule draft controls are editable',result.draft.value==='37.5'&&!result.draft.disabled);
  const click=async label=>{const element=await page.waitForSelector('::-p-aria('+label+')');await element.click();};
  await click('Continue');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/vacation-policy'));
  result.afterSave=await snapshot(actor);check('Actual admin Continue advances stored progress to vacation_policy',result.afterSave.settings.onboarding_step==='vacation_policy'&&result.commands.save.length===1&&result.commands.save[0]===200);check('Progress-only Continue preserves own work policy counts',JSON.stringify(result.afterSave.counts)===JSON.stringify(result.beforeSave.counts));
  await go();await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type('20');
  await click('Skip for now');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/vacation-policy'));
  result.afterSkip=await snapshot(actor);check('Actual admin Skip retains vacation_policy progression',result.afterSkip.settings.onboarding_step==='vacation_policy'&&result.commands.skip.length===1&&result.commands.skip[0]===200);check('Actual Skip preserves own work policy counts',JSON.stringify(result.afterSkip.counts)===JSON.stringify(result.beforeSave.counts));
  const member=f.actors['small-restricted'];
  if(member){
   const memberContext=await browser.createBrowserContext(),memberPage=await memberContext.newPage();memberPage.setDefaultTimeout(45000);memberPage.on('pageerror',e=>result.errors.push(e.message));await normalSignIn(memberPage,r,member);result.memberBefore=await snapshot(member);
   await memberPage.goto(r.origin+route,{waitUntil:'domcontentloaded',timeout:90000});await memberPage.waitForFunction(()=>location.pathname.endsWith('/onboarding/wellness'));
   result.memberAfter=await snapshot(member);check('Existing member fixture automatically skips to wellness',result.memberAfter.settings.onboarding_step==='wellness'&&await memberPage.$(selector)===null);check('Member auto-skip preserves own work policy counts',JSON.stringify(result.memberAfter.counts)===JSON.stringify(result.memberBefore.counts));await memberContext.close();
  }else result.memberUnverified='No existing small-restricted actor fixture; member auto-skip omitted.';
 }
 const call=async name=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}}),signal:AbortSignal.timeout(30000)});assert.ok(response.ok);const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?raw.split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).find(entry=>entry.id===1):JSON.parse(raw);};
 result.next=[];for(const name of['get_compilation_issues','get_errors'])result.next.push({name,result:await call(name)});
 check('No browser exceptions',result.errors.length===0);check('No request interception errors',result.transportErrors.length===0);result.sourceAtEnd=await sourceProof(phase);assert.deepEqual(result.sourceAtEnd.source,result.source.source);await context.close();result.status='accepted';
}catch(error){failed=true;result.status=setup?'failed-run':'failed-setup';result.failure=failure(error);}
finally{
 gate='none';for(const request of held)await request.continue().catch(()=>{});
 if(browser)await browser.close().catch(error=>{failed=true;result.status='failed-cleanup';result.cleanupFailure=failure(error);});
 if(pool)await pool.end().catch(error=>{failed=true;result.status='failed-cleanup';result.cleanupFailure=failure(error);});
 await save(out,'runtime-'+(phase??'unknown')+'.json',result);
}
console.log(JSON.stringify({phase,status:result.status,checks:result.checks.length,captures:result.captures.length,sessionObserved:result.session.observed}));if(failed)process.exitCode=1;
