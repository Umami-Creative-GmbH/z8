import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
// Root copies its ticket-owned, fixture-verified common.mjs beside this draft before use.
const [root,pointer,output,phase,expectedHash,readbackHelper]=process.argv.slice(2);
assert.ok(root&&pointer&&output&&readbackHelper,'root pointer NEW-output before|after expected-source-hash readback.ts');
assert.ok(['before','after'].includes(phase));assert.match(expectedHash,/^[a-f0-9]{64}$/);
const repo=resolve(root),out=resolve(output);process.chdir(repo);await mkdir(out,{recursive:false});
const {fixtureFromPointer,normalSignIn,save,failure,nextMcp}=await import('./common.mjs');
const requireRoot=createRequire(join(repo,'package.json')),sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>x.toString('utf8').replaceAll('\r\n','\n'),beforeRef='3782c6ad';
const route='apps/webapp/src/app/[locale]/onboarding/work-templates/';
const pins=[...['actions.ts','page-client.tsx','page.test.tsx','submission-arrival.test.tsx','atomicity.integration.test.ts'].map(x=>route+x),
 'apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/lib/user-preferences/user-settings-mutation.ts','apps/webapp/src/lib/onboarding/work-template-mutation.ts',
 'apps/webapp/src/db/schema/work-policy.ts','apps/webapp/src/db/schema/user-settings.ts','apps/webapp/src/db/auth-schema.ts',
 'apps/webapp/src/lib/validations/onboarding.ts','apps/webapp/src/lib/organization-action/settings-access.ts','apps/webapp/src/lib/organization-action/settings-access-level.ts',
 'apps/webapp/src/lib/auth/organization-role.ts','apps/webapp/src/lib/employee-lifecycle/current-roster.ts','apps/webapp/src/lib/time-tracking/work-transaction/index.ts'];
async function sourceProof(){
 const source=[];for(const path of pins){const bytes=await readFile(join(repo,path));source.push({path,bytesSha256:sha(bytes),canonicalSha256:sha(canonical(bytes))});}
 const digest=sha(source.map(x=>x.path+'\0'+x.canonicalSha256).join('\n'));assert.equal(digest,expectedHash,'Explicit complete current source-set digest');
 const service=source.find(x=>x.path.endsWith('/onboarding.service.ts'));
 const old=execFileSync('git',['show',beforeRef+':'+service.path],{cwd:repo,windowsHide:true});
 const historicalCanonicalSha256=sha(canonical(old));assert.equal(service.canonicalSha256===historicalCanonicalSha256,phase==='before','Only before uses the exact historical service');
 return{source,digest,historicalCanonicalSha256,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),
  qualification:phase==='before'?'Partial historical overlay: exact old onboarding.service.ts only; every other listed source is current and independently pinned.':'Explicit dirty source bytes are pinned; HEAD alone is not source evidence.'};
}
const result={phase,status:'failed-setup',checks:[],captures:[],browserErrors:[],dialogs:[],cleanup:{},
 qualification:'Actual retained TanStack draft and pointer Save in one own transient Chromium session. No saved/copied/minted state, response stubs, identity/grant changes, default replacement or graph cleanup. Race, Activity and authority evidence belongs to separately assembled public proof.'};
const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);};
let browser,failed=false;
try{
 result.harnessPins={};for(const [label,path] of [['runtime',fileURLToPath(import.meta.url)],['common',fileURLToPath(new URL('./common.mjs',import.meta.url))],['fixture-guard',fileURLToPath(new URL('./owned-fixture-path.mjs',import.meta.url))],['readback',resolve(readbackHelper)]]){const bytes=await readFile(path);result.harnessPins[label]=sha(bytes);await writeFile(join(out,label+'-source.txt'),bytes);}
 result.source=await sourceProof();const {runtime,fixture}=await fixtureFromPointer(resolve(pointer));
 const actor=fixture.actors['small-admin'];assert.ok(actor?.email&&actor?.password&&actor?.organizationId);result.actor='small-admin';
 const name='R1835 '+phase+' '+randomUUID().slice(0,12);result.name=name;
 // The root-owned helper must call verifySuiteDatabase before SELECT-only snapshots.
 const snapshot=stage=>{
  const allowed=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME)$/i.test(key)));
  const appRequire=createRequire(join(repo,'apps/webapp/package.json'));
  const raw=execFileSync(process.execPath,[appRequire.resolve('tsx/cli'),resolve(readbackHelper),resolve(pointer),stage,name],
   {cwd:join(repo,'apps/webapp'),env:{...allowed,...runtime.env,Z8_1835_REPO:repo,TSX_TSCONFIG_PATH:join(repo,'apps/webapp/tsconfig.json'),pnpm_config_verify_deps_before_run:'false'},encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],maxBuffer:2e6});
  const value=JSON.parse(raw);assert.equal(value.stage,stage);assert.equal(value.name,name);return value;
 };
 const puppeteer=requireRoot('puppeteer-core');browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
 const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});
 let transportStage='setup';result.actionRequests=[];result.actionResponses=[];const responseBodies=[];
 const relevant=request=>request.method()==='POST'&&request.headers()['next-action']&&new URL(request.url()).pathname==='/en/onboarding/work-templates';
 page.on('request',request=>{if(relevant(request))result.actionRequests.push({stage:transportStage,method:'POST',actionHash:sha(request.headers()['next-action'])});});
 page.on('response',response=>{if(relevant(response.request())){const record={stage:transportStage,status:response.status(),actionHash:sha(response.request().headers()['next-action'])};result.actionResponses.push(record);responseBodies.push(response.buffer().then(body=>{record.bodyBytes=body.length;}).catch(()=>{record.bodyUnavailable=true;}));}});
 page.on('pageerror',e=>result.browserErrors.push({name:e.name,message:e.message}));page.on('dialog',d=>{result.dialogs.push(d.type());void d.dismiss();});
 result.auth=await normalSignIn(page,runtime,actor);await page.goto(runtime.origin+'/en/onboarding/work-templates',{waitUntil:'domcontentloaded',timeout:90000});
 await page.waitForFunction(()=>document.querySelector('input[name=name]')&&!document.querySelector('input[name=name]').disabled);
 async function type(selector,value){const input=await page.$(selector);assert.ok(input);await input.focus();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await input.type(value);}
 await type('input[name=name]',name);await type('input[name=hoursPerWeek]','37.5');
 const draft=()=>page.evaluate(()=>({name:document.querySelector('input[name=name]').value,hours:document.querySelector('input[name=hoursPerWeek]').value,
  days:[...document.querySelectorAll('input[type=checkbox][id^=work-template-day-]')].map(e=>({id:e.id,checked:String(e.checked)})),default:document.querySelector('#work-template-default').getAttribute('aria-checked')}));
 const retained=await draft();assert.equal(retained.name,name);assert.equal(retained.hours,'37.5');assert.equal(retained.default,'true');assert.equal(retained.days.length,7);
 assert.deepEqual(retained.days.filter(x=>x.checked==='true').map(x=>x.id.replace('work-template-day-','')),['monday','tuesday','wednesday','thursday','friday']);
 const initial=snapshot('initial');result.initial=initial;assert.equal(initial.named.policyIds.length,0,'Fresh unique phase name');
 async function capture(state,expectedPath){
  for(const [width,height,size] of [[1600,1000,'desktop'],[390,844,'phone']]){
   await page.setViewport({width,height});await page.evaluate(()=>document.fonts.ready);
   await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].every(e=>!e.checkVisibility())&&[...document.querySelectorAll('nextjs-portal')].every(portal=>[...(portal.shadowRoot?.querySelectorAll('*')??[])].every(e=>!e.checkVisibility()||!/compiling|rendering/i.test(e.innerText??''))),{polling:100,timeout:30000});
   assert.equal(await page.$$eval('[role=dialog],[role=alertdialog]',es=>es.filter(e=>e.checkVisibility()).length),0);
   await page.waitForFunction(()=>{const key=JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('h1')].filter(e=>e.checkVisibility()).map(e=>{const r=e.getBoundingClientRect();return[e.textContent,r.x,r.y,r.width,r.height];})}),now=performance.now(),old=window.__r1835Geometry;if(!old||old.key!==key){window.__r1835Geometry={key,at:now};return false;}return now-old.at>=300;},{polling:100,timeout:10000});
   const measure=await page.evaluate(()=>({path:location.pathname,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,
    headings:[...document.querySelectorAll('h1')].filter(e=>e.checkVisibility()).map(e=>({text:e.textContent.trim(),rect:e.getBoundingClientRect().toJSON()})),
    alerts:[...document.querySelectorAll('form [role=alert]')].filter(e=>e.checkVisibility()).map(e=>e.textContent.trim()),visibleToasts:[...document.querySelectorAll('[data-sonner-toast]')].filter(e=>e.checkVisibility()).length,rootFont:getComputedStyle(document.documentElement).fontSize,theme:document.documentElement.className,documentHeight:document.documentElement.scrollHeight,text:(document.querySelector('main')??document.body).innerText}));
   assert.equal(measure.visibleToasts,0);
   assert.equal(measure.path,expectedPath);assert.equal(measure.headings.length,1);assert.ok(measure.documentWidth<=width);
   const filename=phase+'-'+state+'-'+size+'.png',bytes=await page.screenshot({path:join(out,filename),fullPage:true});result.captures.push({filename,state,sha256:sha(bytes),measurement:measure,sourceDigest:result.source.digest});
  }
 }
 const saveButton=()=>page.waitForSelector('form button[type=submit][aria-label="Save and continue"]');
 transportStage='default';await(await saveButton()).click();
 await page.waitForFunction(()=>{const e=document.querySelector('form [role=alert]'),b=document.querySelector('form button[type=submit]');return e?.checkVisibility()&&b&&!b.disabled;});
 check('Default Save refused and all draft fields retained',JSON.stringify(await draft())===JSON.stringify(retained));
 await capture('default-refused','/en/onboarding/work-templates');const refused=snapshot('default-refused');result.refused=refused;
 for(const key of ['defaultGraphHash','recordedTimeHash','preferencesWithoutProgressHash','userSettingsHash'])assert.equal(refused[key],initial[key],key+' unchanged on refusal');
 assert.equal(refused.onboardingStep,initial.onboardingStep);assert.equal(refused.graph.counts.assignment,initial.graph.counts.assignment);
 const expectedDelta=phase==='before'?{policy:1,schedule:1,day:7,assignment:0}:{policy:0,schedule:0,day:0,assignment:0};
 for(const [key,delta] of Object.entries(expectedDelta))assert.equal(refused.graph.counts[key]-initial.graph.counts[key],delta,'Refusal graph delta '+key);
 assert.equal(refused.named.policyIds.length,phase==='before'?1:0);
 if(phase==='before'){
  check('Exact historical service left one orphan policy, one schedule and seven days after refused Save',true);
  result.status='observed-historical-partial-graph';
 }else{
  assert.equal(refused.graph.rowHash,initial.graph.rowHash,'Zero graph writes on corrected refusal');
  const alert=await page.$eval('form [role=alert]',e=>e.textContent.trim());assert.match(alert,/organization default already exists/i);
  await page.setViewport({width:1600,height:1000});await page.click('#work-template-default');assert.equal((await draft()).default,'false');
  transportStage='retry';const submit=await saveButton();await submit.click();await page.waitForFunction(()=>location.pathname==='/en/onboarding/notifications');
  await capture('accepted-recovery','/en/onboarding/notifications');const accepted=snapshot('accepted-recovery');result.accepted=accepted;
  for(const key of ['defaultGraphHash','recordedTimeHash','preferencesWithoutProgressHash'])assert.equal(accepted[key],initial[key],key+' retained after non-default recovery');
  for(const [key,delta] of Object.entries({policy:1,schedule:1,day:7,assignment:0}))assert.equal(accepted.graph.counts[key]-initial.graph.counts[key],delta,'Accepted graph delta '+key);
  assert.equal(accepted.onboardingStep,'wellness');assert.equal(accepted.named.policyIds.length,1);assert.equal(accepted.named.scheduleIds.length,1);assert.equal(accepted.named.dayIds.length,7);
  assert.equal(accepted.named.isDefault,false);assert.equal(accepted.named.hoursPerCycle,'37.5');
  assert.deepEqual(accepted.named.days,[...['monday','tuesday','wednesday','thursday','friday'].map(day=>({day,isWorkDay:true,hoursPerDay:'7.5'})),...['saturday','sunday'].map(day=>({day,isWorkDay:false,hoursPerDay:'0.0'}))]);
  check('Pointer retry committed exactly one non-default graph, wellness progress and notifications navigation',true);result.status='accepted-recovery';
 }
 await Promise.all(responseBodies);for(const stage of phase==='before'?['default']:['default','retry']){assert.equal(result.actionRequests.filter(r=>r.stage===stage).length,1,'One actual command in '+stage);const response=result.actionResponses.filter(r=>r.stage===stage);assert.equal(response.length,1);assert.equal(response[0].status,200);assert.ok(response[0].bodyBytes>0);}
 assert.equal(result.browserErrors.length,0);assert.equal(result.dialogs.length,0);result.next=await nextMcp(runtime.origin);result.sourceAtEnd=await sourceProof();assert.deepEqual(result.source.source,result.sourceAtEnd.source,'Source bytes stable');
 await context.close();result.cleanup.context='Own ephemeral context closed';
}catch(error){failed=true;await writeFile(join(out,'failure-private.json'),JSON.stringify({name:error?.name,message:error?.message,stack:error?.stack,stderr:error?.stderr?.toString?.()},null,2));result.failure=failure(error);result.status='failed-run';}
finally{if(browser)try{await browser.close();result.cleanup.browser='Own Chromium closed';}catch(error){failed=true;result.status='failed-cleanup';result.cleanup.failure=failure(error);}await save(out,'work-template-runtime-'+phase+'.json',result);}
console.log(JSON.stringify({phase,status:result.status,name:result.name,captures:result.captures.length,checks:result.checks,cleanup:result.cleanup}));if(failed)process.exitCode=1;
