// Actual local consumer, visible actions and readback. Own fixture only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const out=join(repo,'docs/design/rollout-1692/1717');await mkdir(out,{recursive:true});
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=process.argv[3]?JSON.parse(await readFile(join(out,'runtime.json'),'utf8')).checks:[],errors=[];let page,context,renamed=false,grant,extraMember,lock;
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual});await save();};
const save=()=>writeFile(join(out,'runtime.json'),JSON.stringify({checks,errors},null,2));
const text=()=>page.evaluate(()=>document.querySelector('main')?.textContent||'');
const wait=s=>page.waitForFunction(s=>document.body.innerText.includes(s)||[...document.querySelectorAll('main a')].some(n=>n.textContent.includes(s)),{timeout:120000},s);
const click=s=>clickVisible(page,s,30000);
const snap=name=>page.screenshot({path:join(out,name+'.png'),fullPage:true});
const goto=async(path='/en/equipment')=>{await page.goto(new URL(path,runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});};
const actor=async name=>{if(context)await context.close();context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth[name].cookies);page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:1000});};
const field=async label=>{const id=await page.evaluate(label=>[...document.querySelectorAll('[role="dialog"] label')].find(n=>n.textContent.trim().startsWith(label))?.htmlFor,label);assert.ok(id,'field '+label);return `[id="${id}"]`;};
const fill=async(label,value)=>{const selector=await field(label);await page.$eval(selector,(n,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},value);};
const rowAction=async(identifier,action)=>{await click(`button[aria-label="Actions for ${identifier}"]`);await click(`[role="menuitem"]::-p-text(${action})`);};
const reload=async()=>{await click('button[aria-label="Reload equipment"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Reload equipment"]')?.getAttribute('aria-busy')==='false',{timeout:120000});};
const small=fixture.actors['small-admin'],holder=fixture.actors['small-employee'],manager=fixture.actors['small-manager'],large=fixture.actors['large-admin'];
try{
 await actor('small-admin');await goto();await wait('EQ-HELD');
 if(!process.argv[3]){
 await check('single task heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Equipment']);
 await click('button[aria-label="Show overdue returns"]');await page.waitForFunction(()=>location.search.includes('overdue=true'));await check('overdue excludes outstanding undated partial',!(await text()).includes('Quantity · Fixture shirts'));
 await click('button[aria-label="Show outstanding returns"]');await wait('Quantity · Fixture shirts');await check('partial quantity stays visible',(await text()).includes('1 / 3'));
 const detail=await page.$('a::-p-text(EQ-HELD)');const href=await detail.evaluate(n=>n.getAttribute('href'));await detail.click();await page.waitForFunction(()=>location.pathname.includes('/equipment/assignments/'),{timeout:120000});await wait('Handover history');await check('actual assignment destination',new URL(page.url()).pathname.includes('/equipment/assignments/'));await goto();await wait('EQ-HELD');
 await click('button[aria-label="Show items ready to issue"]');await wait('EQ-READY');await check('ready excludes damaged item',!(await text()).includes('EQ-DAMAGED'));await snap('after-ready-items');
 await click('[role="tab"]::-p-text(Assignments)');await wait('EQ-HELD');
 await click('button::-p-text(Issue equipment)');await wait('Record issuance');
 await page.select(await field('Equipment item'),await pool.query("select id from equipment_type where organization_id=$1 and name='Fixture shirts'",[small.organizationId]).then(r=>r.rows[0].id));
 await page.select(await field('Current employee'),manager.employeeId);await fill('Quantity','3');await fill('Actual handover date','2026-11-14');
 await snap('after-issue-panel');
 // Real database failure, not a fabricated response; request and entered values survive retry.
 await pool.query('alter table equipment_command rename to equipment_command_r019_unavailable');renamed=true;
 await (await waitVisible(page,'[role="dialog"] button[type="submit"]')).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(n=>n.textContent.includes('could not')),{timeout:120000});
 await check('failed command retains quantity',await page.$eval(await field('Quantity'),n=>n.value),'3');
 await pool.query('alter table equipment_command_r019_unavailable rename to equipment_command');renamed=false;
 await (await waitVisible(page,'[role="dialog"] button[type="submit"]')).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:120000});await wait('3 of 3 assignments');
 await page.reload({waitUntil:'networkidle2'});await wait('3 of 3 assignments');await check('real issuance survives reload',(await text()).includes('Fixture Person 1'));
 }
 if(!process.argv[3]||process.argv[3]==='continue'){
 // Receive the original partial balance (one of three), independently of issuance.
 const rows=await page.$$('tbody tr');let originalMenu;for(const row of rows){if(await row.evaluate(n=>n.textContent.includes('Fixture Person 2')&&n.textContent.includes('Fixture shirts')))originalMenu=await row.$('button[aria-label="Actions for Fixture shirts"]');}assert.ok(originalMenu);await originalMenu.click();await click('[role="menuitem"]::-p-text(Record receipt)');await wait('Confirm physical receipt');await fill('Actual handover date','2026-11-14');await fill('Quantity','1');await click('[role="dialog"] button::-p-text(Record receipt)');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:120000});await page.reload({waitUntil:'networkidle2'});await wait('2 of 3 assignments');await check('partial receipt removes settled obligation from outstanding view',(await text()).includes('2 of 3 assignments'));
 await click('[role="tab"]::-p-text(Items)');await wait('EQ-DAMAGED');
 await rowAction('EQ-DAMAGED','Clear for issue');await wait('Confirm clearance');
 await snap('after-clearance-confirmation');
 await click('[role="alertdialog"] button::-p-text(Confirm)');await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'),{timeout:120000});await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');await click('button[aria-label="Show items ready to issue"]');await wait('EQ-DAMAGED');await check('damaged item is ready only after actual clearance',(await text()).includes('EQ-DAMAGED'));await snap('after-clearance-readback');
 // Real read outage/retry, with no false empty state.
 await pool.query('alter table equipment_command rename to equipment_command_r019_unavailable');renamed=true;
 // Overview does not read command ledger: fail the actual assignment source instead.
 await pool.query('alter table equipment_command_r019_unavailable rename to equipment_command');renamed=false;
 await pool.query('alter table equipment_assignment rename to equipment_assignment_r019_unavailable');
 try{await page.reload({waitUntil:'networkidle2'});await wait('Equipment could not be loaded');await check('failed read offers named retry',await page.$$eval('button[aria-label="Reload equipment"]',ns=>ns.length),1);await snap('after-error');}
 finally{await pool.query('alter table equipment_assignment_r019_unavailable rename to equipment_assignment');}
 await reload();await wait('EQ-HELD');await check('retry restores real authorized holdings',(await text()).includes('1 / 1'));await snap('after-recovery');
 }
 // Saved preferences use actual shell controls.
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await page.waitForFunction(()=>localStorage.getItem('sidebar_state')==='false');await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');await check('sidebar collapse persists',await page.$eval('button[data-sidebar="trigger"]',n=>n.getAttribute('aria-expanded')),'false');
 await click('::-p-aria(Toggle theme)');await click('[role="menuitem"]::-p-text(Dark)');await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await click('[data-sidebar="footer"] button[data-slot="dropdown-menu-trigger"]');await click('[role="menuitem"]::-p-text(Font size)');await click('[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle2'});await wait('EQ-HELD');await check('large saved font and dark theme',await page.evaluate(()=>({font:localStorage.getItem('z8-font-size'),size:getComputedStyle(document.documentElement).fontSize,dark:document.documentElement.classList.contains('dark')})),{font:'large',size:'18px',dark:true});
 await check('phone fits saved font',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-phone-large-dark');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.addStyleTag({content:'html{font-size:22.5px!important}'});await check('enlarged reduced-motion phone fits',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-phone-enlarged');
 await page.setViewport({width:800,height:500,deviceScaleFactor:2});await check('zoom equivalent fits',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-zoom-equivalent');
 await actor('small-manager');await goto();await wait('not');await check('ordinary manager gains no equipment staff scope',!(await text()).includes('EQ-HELD'));await snap('after-manager-refused');
 for(const role of ['small-employee','small-restricted','large-admin']){await actor(role);await goto();await check(role+' has no staff holdings',!(await text()).includes('EQ-HELD'));await snap('after-'+role+'-refused');}
 // Scoped officer role and live revocation; grants seeded only in owned fixture.
 grant=manager.employeeId;await pool.query("insert into equipment_officer_grant(organization_id,employee_id,scope,employee_ids) values($1,$2,'selected',$3)",[small.organizationId,manager.employeeId,[holder.employeeId]]);
 await actor('small-manager');await goto();await wait('EQ-HELD');await check('scoped officer sees covered holder and not other holder',!(await text()).includes('Fixture Person 1'));await check('officer has issue but no setup administration',(await page.$$('a[href="/en/settings/equipment"]')).length===0&&(await page.$$('button::-p-text(Issue equipment)')).length>0);await snap('after-scoped-officer');
 await click('button::-p-text(Issue equipment)');await wait('Record issuance');await pool.query('update equipment_officer_grant set revoked_at=now() where employee_id=$1',[grant]);
 await page.keyboard.press('Escape');await goto();await check('revoked officer loses direct-route access',!(await text()).includes('EQ-HELD'));await snap('after-authority-loss');
 // Same actor gains synthetic membership in the feature-off second org, then real shell switch.
 const {rows:[user]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[small.employeeId,small.organizationId]);extraMember=randomUUID();await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,user.user_id]);
 await actor('small-admin');await goto();await wait('EQ-HELD');await click('button[aria-label^="Switch Organization:"]');await click('[role="menuitem"]::-p-text(Performance large)');await page.waitForNetworkIdle({idleTime:1000,timeout:120000});await goto();await check('real organization switch drops old equipment records',!(await text()).includes('EQ-HELD'));await snap('after-organization-switch');
 await check('no browser exceptions',errors,[]);
}catch(error){await snap('harness-failure');console.log(await page.evaluate(()=>({path:location.pathname,dialog:[...document.querySelectorAll('[role=dialog]')].map(n=>n.innerText),buttons:[...document.querySelectorAll('[role=dialog] button')].map(n=>({text:n.textContent,disabled:n.disabled,box:JSON.stringify(n.getBoundingClientRect())}))})));throw error;}finally{
 if(renamed)await pool.query('alter table equipment_command_r019_unavailable rename to equipment_command');
 if(lock){await lock.query('rollback');lock.release();}
 if(grant)await pool.query('delete from equipment_officer_grant where employee_id=$1',[grant]);
 if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);
 await save();await browser.close();await pool.end();
}
