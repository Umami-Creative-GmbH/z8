import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(), dir=resolve(process.argv[2]), out=resolve('docs/design/rollout-1692/1834');
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
const services=JSON.parse(await readFile(join(dir,'services.json'),'utf8'));
assert.equal(f.kind,'disposable'); assert.equal(new URL(r.origin).hostname,'localhost');
assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.containers.length,3);
for(const c of services.containers) assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),'z8-performance-fixture-1450');
const require=createRequire(join(repo,'package.json')), {default:puppeteer}=await import(pathToFileURL(require.resolve('puppeteer-core')).href);
const appRequire=createRequire(join(repo,'apps/webapp/package.json')), {Pool}=appRequire('pg');
const pool=new Pool({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
for(const name of ['small-admin','small-employee']) f.actors[name].userId=(await pool.query('select id from "user" where email=$1',[f.actors[name].email])).rows[0].id;
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--disable-notifications']});
await mkdir(out,{recursive:true});
const save=async(name,data)=>writeFile(join(out,name),JSON.stringify(data,null,2)+'\n');
const paths=['apps/webapp/src/app/[locale]/onboarding/work-schedule/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/work-schedule/work-schedule-fields.tsx'];
const originals=await Promise.all(paths.map(p=>readFile(p)));
const source=async()=>Promise.all(paths.map(async path=>({path,sha256:createHash('sha256').update((await readFile(path,'utf8')).replaceAll('\r\n','\n')).digest('hex')})));
const observations=[];
const auth=async(page,actor)=>{
 await page.goto(r.origin+'/en/sign-in',{waitUntil:'networkidle0',timeout:120000});
 const status=await page.evaluate(async({actor})=>{const s=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:actor.email,password:actor.password})});if(!s.ok)return {signIn:s.status};const a=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:actor.organizationId})});return{signIn:s.status,active:a.status};},{actor});
 assert.deepEqual(status,{signIn:200,active:200});
};
const go=async page=>{await page.goto(r.origin+'/en/onboarding/work-schedule',{waitUntil:'networkidle0',timeout:120000});await page.waitForFunction(()=>{const e=document.querySelector('#work-schedule-hours-per-week');return e&&!e.disabled;},{timeout:60000});};
const capture=async(page,name,width,height,dark,font)=>{
 await page.setViewport({width,height,deviceScaleFactor:1});
 await page.evaluate(({dark,font})=>{localStorage.setItem('theme',dark?'dark':'light');localStorage.setItem('z8-font-size',font===18?'large':'default');},{dark,font});
 await go(page);
 await page.waitForFunction((dark)=>document.documentElement.classList.contains('dark')===dark,{},dark);
 await page.evaluate(()=>document.fonts.ready);
 await page.screenshot({path:join(out,name+'.png'),fullPage:true});
 const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,fields:[...document.querySelectorAll('form input,form [role="combobox"]')].map(e=>({name:e.getAttribute('name')||e.id,disabled:e.disabled})),actions:[...document.querySelectorAll('form button')].map(e=>({text:e.textContent,disabled:e.disabled,rect:{x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width}}))}));
 assert.ok(metrics.scrollWidth<=metrics.width); observations.push({capture:name,...metrics,source:await source()});
};
try{
 const page=await browser.newPage();await auth(page,f.actors['small-admin']);
 if(process.argv.includes('--usability')) {
  await go(page);let commands=0;page.on('request',request=>{if(request.headers()['next-action'])commands++;});
  await page.focus('#work-schedule-hours-per-week');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.sendCharacter('-1');
  const before=commands;await page.locator('button[type="submit"]').click();
  assert.deepEqual(await page.$eval('#work-schedule-hours-per-week',e=>({invalid:e.validity.rangeUnderflow,focused:document.activeElement===e})),{invalid:true,focused:true});assert.equal(commands,before);
  await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.sendCharacter('24');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'work-schedule-classification');
  await page.keyboard.press('Space');await page.waitForSelector('[role="option"]');await page.keyboard.press('Home');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('#work-schedule-classification')?.textContent.includes('Daily'));
  await page.setRequestInterception(true);const fail=request=>{if(request.headers()['next-action'])request.abort('failed');else request.continue();};page.on('request',fail);
  await page.locator('form button[type="button"]:not([role="combobox"])').click();await page.waitForSelector('form [role="alert"]');
  assert.equal(await page.$eval('#work-schedule-hours-per-week',e=>e.value),'24');
  await page.screenshot({path:join(out,'skip-failed-retained.png'),fullPage:true});
  page.off('request',fail);await page.setRequestInterception(false);
  await page.locator('form button[type="button"]:not([role="combobox"])').click();await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/vacation-policy'));
  await go(page);const contrast=[];
  for(const dark of [false,true]) {
   await page.evaluate(dark=>{localStorage.setItem('theme',dark?'dark':'light');localStorage.setItem('z8-font-size',dark?'large':'default');},dark);await go(page);
   contrast.push(await page.evaluate(()=>{const surface=document.querySelector('main form').parentElement.parentElement;const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3);};const lum=values=>values.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);const bg=lum(rgb(getComputedStyle(surface).backgroundColor));const texts=[...surface.querySelectorAll('h1,h2,label,p')].map(e=>{const fg=lum(rgb(getComputedStyle(e).color));return {tag:e.tagName,ratio:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)};});return{dark:document.documentElement.classList.contains('dark'),font:getComputedStyle(document.documentElement).fontSize,texts};}));
  }
  for(const variant of contrast)for(const text of variant.texts)assert.ok(text.ratio>=4.5,`Contrast ${text.tag}: ${text.ratio}`);
  await save('usability.json',{source:await source(),nativeKeyboardInvalidFocus:true,invalidMutationRequests:0,keyboardClassification:'Daily',actualSkipFailureRetention:true,actualSkipRetryDestination:'vacation-policy',contrast,qualification:'Local solid form text contrast only. Shared progress/footer over randomized background, exhaustive axe, true zoom, physical devices and all locales remain unpassed.'});
 } else {
 const initial=(await pool.query('select onboarding_step from user_settings where user_id=$1',[f.actors['small-admin'].userId])).rows;
 const policies=(await pool.query('select count(*)::int as count from work_policy where organization_id=$1',[f.actors['small-admin'].organizationId])).rows[0].count;
 try{
  for(const path of paths)await writeFile(path,execFileSync('git',['show','b4cef3a126fd16563cb0bbddfd5872a2aeb4e530:'+path],{maxBuffer:2000000}));
  await go(page);
  await capture(page,'before-desktop',1600,1000,false,16);await capture(page,'before-phone-dark',390,844,true,18);await capture(page,'before-wide',1920,1080,false,16);
 }finally{for(let i=0;i<paths.length;i++)await writeFile(paths[i],originals[i]);}
 await go(page);
 await capture(page,'after-desktop',1600,1000,false,16);await capture(page,'after-phone-dark',390,844,true,18);await capture(page,'after-wide',1920,1080,false,16);
 await page.setViewport({width:1600,height:1000});
 await page.click('#work-schedule-hours-per-week');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.sendCharacter('32.5');
 await page.waitForFunction(()=>document.querySelector('#work-schedule-hours-per-week')?.value==='32.5');
 await page.focus('#work-schedule-classification');await page.keyboard.press('Space');await page.waitForSelector('[role="option"]');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('#work-schedule-classification')?.textContent.includes('Monthly'));
 const chosen=await page.$eval('#work-schedule-classification',e=>e.textContent);assert.match(chosen,/Monthly/);
 // A transport failure is real failure; no successful action response is fabricated.
 await page.setRequestInterception(true);let failed=false;
 const abort=request=>{if(!failed&&request.headers()['next-action']){failed=true;request.abort('failed');}else request.continue();};page.on('request',abort);
 await page.locator('button[type="submit"]').click();await page.waitForSelector('form [role="alert"]',{timeout:60000});assert.ok(failed);
 assert.equal(await page.$eval('#work-schedule-hours-per-week',e=>e.value),'32.5');
 assert.match(await page.$eval('#work-schedule-classification',e=>e.textContent),/Monthly/);
 observations.push({case:'real transport failure retains hours and classification',passed:true});
 await page.screenshot({path:join(out,'failed-retained.png'),fullPage:true});
 page.off('request',abort);await page.setRequestInterception(false);
 await page.locator('button[type="submit"]').click();await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/vacation-policy'),{timeout:60000});
 const readback=(await pool.query('select onboarding_step from user_settings where user_id=$1',[f.actors['small-admin'].userId])).rows[0]?.onboarding_step;
 assert.equal(readback,'vacation_policy');assert.equal((await pool.query('select count(*)::int as count from work_policy where organization_id=$1',[f.actors['small-admin'].organizationId])).rows[0].count,policies);
 observations.push({case:'actual admin save/retry and server next step',passed:true,readback,policyCountUnchanged:true,scheduleValuesPersisted:false});
 await go(page);await page.locator('form button[type="button"]:not([role="combobox"])').click();await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/vacation-policy'),{timeout:60000});
 observations.push({case:'actual admin skip and returned next step',passed:true});
 const context=await browser.createBrowserContext(), employee=await context.newPage();await auth(employee,f.actors['small-employee']);await employee.goto(r.origin+'/en/onboarding/work-schedule',{waitUntil:'networkidle0',timeout:120000});await employee.waitForFunction(()=>location.pathname.endsWith('/onboarding/wellness'),{timeout:60000});
 assert.equal((await pool.query('select onboarding_step from user_settings where user_id=$1',[f.actors['small-employee'].userId])).rows[0]?.onboarding_step,'wellness');observations.push({case:'actual employee automatic skip and persisted progression',passed:true});
 // An unavailable eligible-admin check must not emit a successful save or skip.
 let aborted=false;await page.setRequestInterception(true);const unavailable=request=>{if(request.headers()['next-action']&&new URL(request.url()).pathname.endsWith('/onboarding/work-schedule')){aborted=true;request.abort('failed');}else request.continue();};page.on('request',unavailable);
 await page.goto(r.origin+'/en/onboarding/work-schedule',{waitUntil:'networkidle0',timeout:120000});await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/wellness'),{timeout:60000});assert.ok(aborted);observations.push({case:'actual unavailable access uses wellness fallback',passed:true});page.off('request',unavailable);await page.setRequestInterception(false);
 await save('runtime.json',{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:await source(),baseline:'b4cef3a126fd16563cb0bbddfd5872a2aeb4e530 (only two route source files substituted, finally restored)',fixture:'owned disposable, small-admin and small-employee; same organization and fixture for matched images',observations,initialProgressRows:initial.length,limits:['No schedule payload is persisted by inherited owner','Scope races are assembled-page checks, not a simulated server authorization fix','No physical device or true zoom or provider acceptance']});
 console.log('Runtime captures and real action/readback observations saved.');
 }
}finally{for(let i=0;i<paths.length;i++)await writeFile(paths[i],originals[i]);await save('runtime-observations.json',{observations,source:await source()});await browser.close();await pool.end();}
