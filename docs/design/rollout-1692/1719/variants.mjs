import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const out=join(repo,'docs/design/rollout-1692/1719'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const a=fixture.actors['small-admin'],holder=fixture.actors['small-employee'],large=fixture.actors['large-admin'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();await page.setViewport({width:1600,height:1000});
const evidence={checks:[],errors:[],limits:process.argv[3]==='preferences'?['Standalone preferences-only verification; organization-menu keyboard activation remains unclassified in separate attempts.']:['Core pointer organization-switch attempt timed out; retained harness-failure.png. Keyboard switch attempts do not certify activation.']};page.on('pageerror',e=>evidence.errors.push({message:e.message,stack:e.stack}));let lock,extraMember;
const save=()=>writeFile(join(out,process.argv[3]==='preferences'?'preferences.json':'variants.json'),JSON.stringify(evidence,null,2));
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);evidence.checks.push({name,actual});await save();};
const go=id=>page.goto(new URL('/en/equipment/employees/'+(id??holder.employeeId),runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});
// Stacked rows below the phone fold use content-visibility; wait on the real row DOM.
const wait=s=>page.waitForFunction(s=>document.querySelector('tbody')?.textContent.includes(s),{timeout:120000},s);
const click=s=>clickVisible(page,s,30000),key=async s=>{await(await waitVisible(page,s)).focus();await page.keyboard.press('Enter');};
const snap=async name=>{await new Promise(resolve=>setTimeout(resolve,1200));return page.screenshot({path:join(out,name+'.png'),fullPage:false});};
try{
 if(process.argv[3]!=='switch'){
 await go();await wait('EQ-HELD');await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await page.waitForFunction(()=>localStorage.getItem('sidebar_state')==='false');await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');await check('Ctrl+B collapse persists',await page.$eval('button[data-sidebar="trigger"]',n=>n.getAttribute('aria-expanded')),'false');
 await click('::-p-aria(Toggle theme)');await click('[role="menuitem"]::-p-text(Dark)');await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await click('[data-sidebar="footer"] button[data-slot="dropdown-menu-trigger"]');await click('[role="menuitem"]::-p-text(Font size)');await click('[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');await check('saved dark and large font survive phone reload',await page.evaluate(()=>({font:localStorage.getItem('z8-font-size'),size:getComputedStyle(document.documentElement).fontSize,dark:document.documentElement.classList.contains('dark')})),{font:'large',size:'18px',dark:true});await check('phone has no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-phone-large-dark');
 await key('button[data-sidebar="trigger"]');await(await waitVisible(page,'[role="dialog"] a')).focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:30000});await check('current-route phone drawer closes first Escape and returns focus',await page.evaluate(()=>document.activeElement?.matches('button[data-sidebar="trigger"]')));await snap('after-current-drawer-escape');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.addStyleTag({content:'html{font-size:22.5px!important}'});await check('enlarged reduced-motion phone fits',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-phone-enlarged');
 await page.setViewport({width:800,height:500,deviceScaleFactor:2});await check('zoom equivalent fits',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-zoom-equivalent');
 }
 if(process.argv[3]!=='preferences'){
 await page.setViewport({width:1600,height:1000});await go();await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');
 const {rows:[u]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);extraMember=randomUUID();await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,u.user_id]);await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table equipment_assignment in access exclusive mode');await key('button[aria-label="Reload equipment"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Reload equipment"]')?.getAttribute('aria-busy')==='true');
 await key('button[aria-label^="Switch Organization:"]');await key('[role="menuitem"]::-p-text(Performance large)');await lock.query('rollback');lock.release();lock=null;await page.waitForNetworkIdle({idleTime:1000,timeout:120000});await page.waitForFunction(()=>!document.querySelector('main')?.innerText.includes('EQ-HELD'),{timeout:120000});await go();await check('keyboard organization switch during read drops prior holder',await page.evaluate(()=>!document.querySelector('main')?.innerText.includes('EQ-HELD')));await snap('after-org-switch');
 }
 assert.deepEqual(evidence.errors,[]);
}catch(error){await snap('variant-harness-failure');throw error;}
finally{if(lock){await lock.query('rollback');lock.release();}if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);await save();await browser.close();await pool.end();}
