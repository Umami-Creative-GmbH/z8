// Real public page actions and authoritative disposable PostgreSQL readback.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=resolve(process.argv[2]);
const json=async n=>JSON.parse(await readFile(join(directory,n),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const require=createRequire(resolve('apps/webapp/package.json'));const {Pool}=require('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const output=resolve('docs/design/rollout-1692/1830');
const results={source:{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(await Promise.all(['apps/webapp/src/app/[locale]/onboarding/profile/page-client.tsx','apps/webapp/src/lib/validations/onboarding.ts'].map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])) )},checks:[],errors:[]};
const check=(name,condition)=>{assert.ok(condition,name);results.checks.push(name);console.log('Passed: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 for(const label of ['small-admin','small-restricted']){
  const actor=fixture.actors[label],context=await browser.createBrowserContext();await context.setCookie(...auth[label].cookies);
  const p=await context.newPage();p.setDefaultTimeout(30000);await p.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await p.emulateTimezone('America/Los_Angeles');
  p.on('pageerror',e=>results.errors.push(e.message));
  const uid=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
  const read=async()=>({settings:(await pool.query('SELECT week_start_day,time_format,help_improve_product,onboarding_step FROM user_settings WHERE user_id=$1',[uid])).rows[0],identity:(await pool.query('SELECT first_name,last_name FROM "user" WHERE id=$1',[uid])).rows[0],employee:(await pool.query('SELECT gender,birthday::text FROM employee WHERE user_id=$1 AND organization_id=$2',[uid,actor.organizationId])).rows[0]});
  const goto=async()=>{await p.goto(runtime.origin+'/en/onboarding/profile',{waitUntil:'networkidle0'});await p.waitForFunction(()=>document.querySelector('#profile-first-name')&&!document.querySelector('button[type=submit]')?.disabled);};
  const click=async text=>{const el=await p.$(`::-p-text(${text})`);assert.ok(el,text);await el.click();};
  await goto();
  await p.click('button[type=submit]');await p.waitForFunction(()=>document.activeElement?.id==='profile-first-name');check(label+' invalid-name focus',true);
  await p.type('#profile-first-name','Ada');await p.type('#profile-last-name','Lovelace');
  await p.click('#profile-birthday');await p.waitForSelector('[data-slot="calendar"]');
  const rect=await p.$eval('[data-slot="calendar"]',e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));check(label+' touch calendar fits',rect.left>=0&&rect.right<=390);
  await p.select('select[aria-label*="month" i]','1');await p.select('select[aria-label*="year" i]','2000');
  const day=await p.$('button[data-day="2000-02-29"], button[aria-label*="February 29th, 2000"]');assert.ok(day,'leap day');await day.click();
  await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.id==='profile-birthday');check(label+' calendar Escape returns focus',true);
  const choose=async(id,text)=>{await p.click(id);await p.waitForFunction(text=>Array.from(document.querySelectorAll('[role=option]')).some(e=>e.textContent.includes(text)),{},text);const options=await p.$$('[role=option]');for(const o of options)if((await o.evaluate(e=>e.textContent)).includes(text)){await o.click();break;}await p.waitForFunction(id=>document.querySelector(id)?.getAttribute('aria-expanded')==='false',{},id);};
  await choose('#time-format','12-hour');
  await choose('#week-start-day','Sunday');
  await p.click('[data-slot=checkbox]');
  results.selection=await p.evaluate(()=>({time:document.querySelector('#time-format')?.textContent,week:document.querySelector('#week-start-day')?.textContent,consent:document.querySelector('[data-slot=checkbox]')?.getAttribute('aria-checked')}));
  const before=await read();
  // Refuse through the real authenticated server boundary, then retry with the
  // same generated login. No sessions are minted and no auth guard is disabled.
  await context.deleteCookie(...await context.cookies());
  await p.click('button[type=submit]');await p.waitForSelector('[role=alert]');
  check(label+' real unauthenticated refusal retains name',await p.$eval('#profile-first-name',e=>e.value==='Ada'));
  check(label+' refusal made no profile changes',JSON.stringify(await read())===JSON.stringify(before));
  await p.screenshot({path:join(output,label+'-refusal.png'),fullPage:true});
  await context.setCookie(...auth[label].cookies);
  // Hold the actual HTTP response after server execution. While held, keyboard
  // and direct form activation must not send another POST.
  const cdp=await p.createCDPSession();let held=null,posts=0;
  await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/onboarding/profile',requestStage:'Response'}]});
  cdp.on('Fetch.requestPaused',ev=>{if(ev.request.method==='POST'){posts++;held=ev;}else cdp.send('Fetch.continueRequest',{requestId:ev.requestId}).catch(()=>{});});
  await click('Retry save');await p.waitForFunction(()=>document.querySelector('button[type=submit]')?.disabled);
  for(let n=0;n<300&&!held;n++)await new Promise(r=>setTimeout(r,50));assert.ok(held,'real save response held');
  await p.$eval('form',e=>{e.requestSubmit();e.requestSubmit();});await p.keyboard.press('Enter');check(label+' held save disables controls',await p.$eval('#profile-first-name',e=>e.disabled));check(label+' single pending save POST',posts===1);
  const saved=await read();results.savedSettings=saved.settings;check(label+' saved date remains 2000-02-29 across LA browser / UTC DB',saved.employee.birthday.startsWith('2000-02-29'));check(label+' saved display preferences and explicit opt-out',saved.settings.week_start_day==='sunday'&&saved.settings.time_format==='12h'&&saved.settings.help_improve_product===false);check(label+' saved structured identity',saved.identity.first_name==='Ada'&&saved.identity.last_name==='Lovelace');
  await cdp.send('Fetch.continueResponse',{requestId:held.requestId});await cdp.send('Fetch.disable');
  const expected=label==='small-admin'?'/onboarding/work-schedule':'/onboarding/wellness';await p.waitForFunction(path=>location.pathname.endsWith(path),{},expected);check(label+' authoritative save destination',true);
  await goto();const beforeSkip=await read();await p.type('#profile-first-name','Unsaved');await p.type('#profile-last-name','Draft');await context.deleteCookie(...await context.cookies());await click('Skip for now');await p.waitForSelector('[role=alert]');check(label+' real skip refusal retains input',await p.$eval('#profile-first-name',e=>e.value==='Unsaved'));await context.setCookie(...auth[label].cookies);await click('Retry skip');await p.waitForFunction(path=>location.pathname.endsWith(path),{},expected);const afterSkip=await read();check(label+' real skip preserves stored profile/preferences',JSON.stringify(beforeSkip.identity)===JSON.stringify(afterSkip.identity)&&JSON.stringify(beforeSkip.employee)===JSON.stringify(afterSkip.employee)&&afterSkip.settings.time_format==='12h'&&afterSkip.settings.help_improve_product===false);check(label+' authoritative skip destination',true);
  await goto();await p.goto(runtime.origin+'/en/settings/profile',{waitUntil:'networkidle0'});await p.waitForFunction(()=>document.body.innerText.includes('12-hour'));check(label+' saved preference visible through actual settings reader',true);await p.screenshot({path:join(output,label+'-readback.png'),fullPage:true});
  await context.close();
 }
}finally{await writeFile(join(output,'actions.json'),JSON.stringify(results,null,2));await browser.close();await pool.end();}
