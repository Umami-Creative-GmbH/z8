// Generated synthetic fixture only. Real Better Auth, reads, actions and database readback.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {repo,dir,runtime,fixture,pool} from '../1719/fixture.mjs';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const out=join(repo,'docs/design/rollout-1692/1831'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const result={scope:'new owned disposable fixture; small-admin / Performance small and small-employee',checks:[],errors:[],captures:[],source:{}};
for(const f of ['apps/webapp/src/app/[locale]/onboarding/vacation-policy/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/vacation-policy/use-policy-arrival.ts','apps/webapp/src/app/[locale]/onboarding/vacation-policy/actions.ts','apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/next.config.ts'])result.source[f]=createHash('sha256').update(await readFile(join(repo,f))).digest('hex');
const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);result.checks.push({name,actual});console.log('Verified: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});let context,p,lock,policyFault=false,skipFault=false;
let a=fixture.actors['small-admin'];const path='/en/onboarding/vacation-policy';
const actor=async label=>{if(context)await context.close();context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth[label].cookies);p=await context.newPage();p.on('pageerror',error=>result.errors.push(error.message));await p.setViewport({width:1600,height:1000});};
const go=async()=>{await p.goto(runtime.origin+path,{waitUntil:'networkidle2',timeout:120000});await p.waitForSelector('#vacation-policy-name',{timeout:120000});};
const capture=async name=>{await p.screenshot({path:join(out,name+'.png'),fullPage:true});result.captures.push({name,viewport:p.viewport(),h1:await p.$$eval('h1',els=>els.map(e=>e.textContent)),overflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});};
const fill=async(s,v)=>{await p.focus(s);await p.keyboard.down('Control');await p.keyboard.press('A');await p.keyboard.up('Control');await p.keyboard.type(v);await p.keyboard.press('Tab');};
const clickText=async text=>{await p.waitForFunction(text=>[...document.querySelectorAll('button,[role=option],[role=menuitem],[role=menuitemradio]')].some(e=>e.textContent?.trim()===text),{timeout:10000},text);const button=await p.$$('button,[role=option],[role=menuitem],[role=menuitemradio]');for(const b of button)if((await b.evaluate(e=>e.textContent?.trim()))===text){await b.click();return;}throw Error('Missing control '+text);};
const continueToNext=async()=>{await clickText('Save and continue');await p.waitForFunction(()=>location.pathname.endsWith('/onboarding/work-templates'),{timeout:30000});};
const rows=async()=> (await pool.query('select name,default_annual_days,accrual_type,allow_carryover,max_carryover_days,carryover_expiry_months,is_company_default,organization_id from vacation_allowance where organization_id=$1 order by created_at',[a.organizationId])).rows;
try{
const actorRow=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId])).rows[0];assert.ok(actorRow?.user_id);a.userId=actorRow.user_id;
for(const entry of Object.values(fixture.actors))await pool.query("update user_settings set onboarding_complete=false,onboarding_step='vacation_policy' where user_id=(select user_id from employee where id=$1 and organization_id=$2)",[entry.employeeId,entry.organizationId]);
await actor('small-admin');await go();
check('one persistent page title',await p.$$eval('h1',els=>els.length),1);
await capture('after-desktop');await p.setViewport({width:390,height:844});await capture('after-phone');
// Native shared preference controls, persisted by their real owners.
await clickVisible(p,'button:has-text("Font size")').catch(async()=>{await p.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Font size'))?.click());});
await clickText('Large');await p.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Toggle theme'))?.click());await clickText('Dark');
await p.reload({waitUntil:'networkidle2'});await p.waitForSelector('#vacation-policy-name');
check('font preference persists after reload',await p.evaluate(()=>document.documentElement.dataset.fontSize),'large');
check('dark preference persists after reload',await p.evaluate(()=>document.documentElement.classList.contains('dark')));
await p.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await capture('after-phone-large-dark');
check('phone has no document overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
await p.focus('#vacation-policy-name');await p.keyboard.press('Tab');check('keyboard reaches annual allowance',await p.evaluate(()=>document.activeElement?.id),'vacation-policy-annual-days');
await p.focus('#vacation-policy-accrual-type');await p.keyboard.press('ArrowDown');await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.id==='vacation-policy-accrual-type');check('accrual Escape returns focus',await p.evaluate(()=>document.activeElement?.id),'vacation-policy-accrual-type');
await p.setViewport({width:2200,height:1100});await capture('after-wide-large-dark');
// Default annual policy through the actual UI; the fixture never writes a policy.
await p.evaluate(()=>{localStorage.setItem('z8-font-size','default');localStorage.setItem('theme','light');});await p.reload({waitUntil:'networkidle2'});await p.waitForSelector('#vacation-policy-name');
let saved=await rows();let initial=saved.length;const standard=saved.find(row=>row.name==='Standard');assert.ok(standard,'The first browser attempt actually saved Standard before its numeric-text assertion failed.');
result.defaultSaveOrigin='First real UI attempt inserted Standard; subsequent attempts read it without deleting or rewriting retained vacation history.';
check('persisted real UI-created default policy values',Object.fromEntries(Object.entries(standard).filter(([k])=>k!=='organization_id')),{name:'Standard',default_annual_days:'25',accrual_type:'annual',allow_carryover:true,max_carryover_days:'5',carryover_expiry_months:3,is_company_default:true});
// A company can have only one active default. Use the second generated organization.
a=fixture.actors['large-admin'];a.userId=(await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId])).rows[0].user_id;await actor('large-admin');initial=(await rows()).filter(row=>row.name!=='R036 monthly retry').length;saved=await rows();
if (!saved.some(row=>row.name==='R036 monthly retry')) {
// Real database refusal, retry input and pending lock. Not an authorization refusal.
await go();await fill('#vacation-policy-name','R036 monthly retry');await fill('#vacation-policy-annual-days','30');await p.click('#vacation-policy-accrual-type');await clickText('Monthly accrual');await fill('#vacation-policy-max-carryover','7');
await pool.query("create function r036_refuse_policy() returns trigger language plpgsql as $$ begin raise exception 'Synthetic policy write refused'; end $$");await pool.query('create trigger r036_refuse_policy before insert on vacation_allowance for each row execute function r036_refuse_policy()');policyFault=true;
await clickText('Save and continue');await p.waitForFunction(()=>document.querySelector('[data-sonner-toast][data-type=error]'),{timeout:30000});
check('real refusal retains name',await p.$eval('#vacation-policy-name',e=>e.value),'R036 monthly retry');check('real refusal remains on policy route',new URL(p.url()).pathname,path);check('real refusal writes no row',(await rows()).length,saved.length);await capture('after-save-refusal');
await pool.query('drop trigger r036_refuse_policy on vacation_allowance');await pool.query('drop function r036_refuse_policy()');policyFault=false;
lock=await pool.connect();await lock.query('begin');await lock.query('lock table vacation_allowance in access exclusive mode');
let actionPosts=0;const observe=req=>{if(req.method()==='POST'&&req.headers()['next-action'])actionPosts++;};p.on('request',observe);
await clickText('Save and continue');await p.waitForFunction(()=>document.querySelector('form[aria-busy=true]'));
await p.evaluate(()=>{document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit();[...document.querySelectorAll('button')].find(e=>e.textContent==='Skip for now')?.click();});
await capture('after-pending');check('pending disables every policy input',await p.$$eval('form input',els=>els.every(e=>e.disabled)));await lock.query('commit');lock.release();lock=null;
await p.waitForFunction(()=>location.pathname.endsWith('/onboarding/work-templates'),{timeout:120000});p.off('request',observe);check('save plus destination admission transports',actionPosts,2);
}
saved=await rows();check('retry creates one monthly policy',saved.length,initial+1);check('monthly and carryover seven persisted',[saved.at(-1).accrual_type,saved.at(-1).max_carryover_days],['monthly','7']);
await go();await p.click('#vacation-policy-accrual-type');await clickText('Biweekly accrual');await p.click('#vacation-policy-allow-carryover');check('biweekly choice remains available and disabled carryover hides only its limit',await p.$('#vacation-policy-max-carryover'),null);
// Skip keeps its genuine failure contract; only a disposable settings writer is faulted.
await go();await fill('#vacation-policy-name','Keep on skip refusal');
await pool.query(`create function r036_refuse_skip() returns trigger language plpgsql as $$ begin if new.user_id = '${a.userId.replaceAll("'","''")}' then raise exception 'Synthetic onboarding write refused'; end if; return new; end $$`);await pool.query('create trigger r036_refuse_skip before insert or update on user_settings for each row execute function r036_refuse_skip()');skipFault=true;
await clickText('Skip for now');await p.waitForFunction(()=>document.querySelector('[data-sonner-toast][data-type=error]'),{timeout:30000});check('real skip refusal stays on policy page',new URL(p.url()).pathname,path);check('skip refusal retains draft',await p.$eval('#vacation-policy-name',e=>e.value),'Keep on skip refusal');await capture('after-skip-refusal');
await pool.query('drop trigger r036_refuse_skip on user_settings');await pool.query('drop function r036_refuse_skip()');skipFault=false;
const count=(await rows()).length;await clickText('Skip for now');await p.waitForFunction(()=>location.pathname.endsWith('/onboarding/work-templates'),{timeout:120000});check('real successful skip inserts no policy',(await rows()).length,count);
check('real save and skip step persisted',(await pool.query('select onboarding_step from user_settings where user_id=$1',[a.userId])).rows[0].onboarding_step,'work_templates');
await actor('small-employee');await p.goto(runtime.origin+path,{waitUntil:'networkidle2',timeout:120000});await p.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications'),{timeout:120000});check('non-admin real admission redirects to notifications',await p.$('#vacation-policy-name'),null);await capture('after-non-admin');
result.limitations=['Held account/org A→B→A and Activity races are assembled-only, not live account switching.','Save/skip real refusal is disposable database failure, not proof of administrator mutation authorization. Existing save/skip server owner has no admin check and was intentionally unchanged.','Default-config borrowed-tree compiler runtime fails; all captures use the same pinned roots + compiler-disabled overlay.','No production generation, provider/device/true browser zoom/global transition certification.'];
}finally{
if(lock){await lock.query('rollback');lock.release();}if(policyFault){await pool.query('drop trigger if exists r036_refuse_policy on vacation_allowance');await pool.query('drop function if exists r036_refuse_policy()');}if(skipFault){await pool.query('drop trigger if exists r036_refuse_skip on user_settings');await pool.query('drop function if exists r036_refuse_skip()');}
await writeFile(join(out,'runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();
}
