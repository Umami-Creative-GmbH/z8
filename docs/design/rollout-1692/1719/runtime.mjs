// Real isolated fixture sessions and actions; no response interception or forged success.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const out=join(repo,'docs/design/rollout-1692/1719'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const small=fixture.actors['small-admin'],holder=fixture.actors['small-employee'],manager=fixture.actors['small-manager'],large=fixture.actors['large-admin'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const continuation=process.argv[3]==='variants';
const evidence=continuation?JSON.parse(await readFile(join(out,'runtime.json'),'utf8')):{checks:[],errors:[]};let context,page,commandRenamed=false,readRenamed=false,grant=false,lock,memberId,originalRole,extraMember;
const save=()=>writeFile(join(out,'runtime.json'),JSON.stringify(evidence,null,2));
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);evidence.checks.push({name,actual});await save();};
const actor=async label=>{if(context)await context.close();context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth[label].cookies);page=await context.newPage();page.on('pageerror',e=>evidence.errors.push({message:e.message,stack:e.stack}));await page.setViewport({width:1600,height:1000});};
const path=id=>'/en/equipment/employees/'+id;
const go=async(id=holder.employeeId)=>page.goto(new URL(path(id),runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});
const wait=s=>page.waitForFunction(s=>document.body.innerText.includes(s),{timeout:120000},s);
const click=s=>clickVisible(page,s,30000);
const text=()=>page.$eval('main',n=>n.innerText);
const snap=name=>page.screenshot({path:join(out,name+'.png'),fullPage:true});
const field=async label=>{const id=await page.evaluate(label=>[...document.querySelectorAll('[role="dialog"] label')].find(n=>n.textContent.trim().startsWith(label))?.htmlFor,label);assert.ok(id,'field '+label);return `[id="${id}"]`;};
const fill=async(label,value)=>page.$eval(await field(label),(n,value)=>{Object.getOwnPropertyDescriptor(n instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},value);
const submit=async()=>{await (await waitVisible(page,'[role="dialog"] button[type="submit"]')).focus();await page.keyboard.press('Enter');};
const closed=()=>page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:120000});
const rowAction=async(identifier,action)=>{await click(`button[aria-label="Actions for ${identifier}"]`);await click(`[role="menuitem"]::-p-text(${action})`);};
const reload=async()=>{await click('button[aria-label="Reload equipment"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Reload equipment"]')?.getAttribute('aria-busy')==='false',{timeout:120000});};
try{
 if(!continuation){
 await actor('small-admin');await go();await wait('EQ-HELD');
 await check('one selected employee heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Fixture Person 2']);
 await check('initial partial quantity and organization calendar',await page.evaluate(()=>document.querySelector('main').innerText.includes('1 / 3')&&document.querySelector('main').innerText.includes('Europe/Berlin')));
 await (await waitVisible(page,'button[aria-label="Show overdue returns"]')).focus();await page.keyboard.press('Enter');
 await check('keyboard overdue filter retains one record',await page.$$eval('tbody tr',ns=>ns.length),1);
 await check('summary counts do not follow filter',await page.$eval('button[aria-label="Show outstanding returns"]',n=>n.textContent.trim()),'Outstanding returns2');
 await click('button::-p-text(Clear filters)');await wait('Fixture shirts');
 await (await waitVisible(page,'th button::-p-text(Item)')).focus();await page.keyboard.press('Enter');await check('keyboard sort announces ascending',await page.$eval('th[aria-sort="ascending"]',n=>n.textContent),'Item');
 await page.type('input[type="search"]','no-such-assignment');await wait('No equipment assignments match');await snap('after-no-matches');await click('button::-p-text(Clear filters)');await wait('EQ-HELD');
 await click('a::-p-text(EQ-HELD)');await wait('Handover history');await check('detail retains employee back destination',await page.$eval('a::-p-text(Back to)',n=>n.getAttribute('href')),path(holder.employeeId));await go();await wait('EQ-HELD');
 // Real issue failure and identical retry through the untouched native TanStack panel.
 await click('button::-p-text(Issue equipment)');await wait('Record issuance');
 await check('holder is prefilled and locked',await page.$eval('[role="dialog"] select[name="employeeId"]',n=>({value:n.value,disabled:n.disabled})),{value:holder.employeeId,disabled:true});
 const quantityType=await pool.query("select id from equipment_type where organization_id=$1 and name='Fixture shirts'",[small.organizationId]).then(r=>r.rows[0].id);
 await page.select(await field('Equipment item'),quantityType);await fill('Quantity','3');await fill('Actual handover date','2026-11-14');await fill('Notes (optional)','R021 synthetic issue');await snap('after-issue-panel');
 await pool.query('alter table equipment_command rename to equipment_command_r021_unavailable');commandRenamed=true;
 await submit();await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(n=>/could not/i.test(n.textContent)),{timeout:120000});
 await check('failed action retains entered quantity',await page.$eval(await field('Quantity'),n=>n.value),'3');await snap('after-failed-issue');
 await pool.query('alter table equipment_command_r021_unavailable rename to equipment_command');commandRenamed=false;
 await submit();await closed();await wait('3 of 3 assignments');await page.reload({waitUntil:'networkidle2'});await wait('3 of 3 assignments');await check('real issue persists',await page.$$eval('tbody tr',ns=>ns.length),3);
 // Select by actual quantity so each live follow-up names the intended assignment.
 const rows=await page.$$('tbody tr');let issued;
 for(const row of rows)if(await row.evaluate(n=>n.textContent.includes('3 / 3')&&n.textContent.includes('Fixture shirts')))issued=await row.$('button[aria-label="Actions for Fixture shirts"]');
 assert.ok(issued);await issued.click();await click('[role="menuitem"]::-p-text(Record receipt)');await wait('Confirm physical receipt');await fill('Actual handover date','2026-11-14');await fill('Quantity','1');await submit();await closed();await page.reload({waitUntil:'networkidle2'});await wait('2 / 3');await check('real partial receipt retains two of three',(await text()).includes('2 / 3'));await snap('after-partial-receipt');
 // Live authority loss after a filled panel opens must refuse, retaining the draft.
 const {rows:[u]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[small.employeeId,small.organizationId]);
 const {rows:[m]}=await pool.query('select id,role from member where organization_id=$1 and user_id=$2',[small.organizationId,u.user_id]);memberId=m.id;originalRole=m.role;
 await click('button::-p-text(Issue equipment)');await wait('Record issuance');await page.select(await field('Equipment item'),quantityType);await fill('Actual handover date','2026-11-14');await fill('Notes (optional)','Refused R021 draft');
 await pool.query("update member set role='member' where id=$1",[memberId]);await submit();await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(n=>/access|permission|could not|authorized/i.test(n.textContent)),{timeout:120000});
 await check('access loss refuses without clearing draft',await page.$eval(await field('Notes (optional)'),n=>n.value),'Refused R021 draft');await snap('after-authority-loss');await pool.query('update member set role=$2 where id=$1',[memberId,originalRole]);await go();await wait('3 of 3 assignments');await check('refused issue creates no extra assignment',await page.$$eval('tbody tr',ns=>ns.length),3);
 // Former status is a fixture variant, not a fake lifecycle mutation or rehire claim.
 await pool.query('update employee set is_active=false where id=$1 and organization_id=$2',[holder.employeeId,small.organizationId]);await go();await wait('Former');
 await check('former keeps existing-holding action and no new issuance',!!await page.$('button::-p-text(Record existing holding)')&&!await page.$('button::-p-text(Issue equipment)'));await snap('after-former');
 await rowAction('EQ-HELD','Record receipt');await wait('Confirm physical receipt');await fill('Actual handover date','2026-11-14');await submit();await closed();await go();await wait('Former');
 await check('former return stays former and history remains',(await text()).includes('Former')&&(await text()).includes('EQ-HELD'));
 await check('receipt did not reactivate employee',await pool.query('select is_active from employee where id=$1 and organization_id=$2',[holder.employeeId,small.organizationId]).then(r=>r.rows[0].is_active),false);
 await pool.query('update employee set is_active=true where id=$1 and organization_id=$2',[holder.employeeId,small.organizationId]);
 // A real read outage, without converting failed data to empty totals.
 await pool.query('alter table equipment_assignment rename to equipment_assignment_r021_unavailable');readRenamed=true;
 await go();await wait('Equipment could not be loaded');await check('read failure has retry and one heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Employee equipment']);await snap('after-read-failure');
 await pool.query('alter table equipment_assignment_r021_unavailable rename to equipment_assignment');readRenamed=false;await reload();await wait('EQ-HELD');await check('retry restores actual employee records',await page.$$eval('tbody tr',ns=>ns.length),3);
 }
 // Self-holder access is an independent read authority, without staff operations.
 await actor('small-employee');await go();await wait('EQ-HELD');await check('self holder retains read-only employee history',!await page.$('button::-p-text(Issue equipment)')&&!await page.$('a::-p-text(Back to equipment)'));await rowAction('EQ-HELD','View details');await wait('Handover history');await check('self history links reach guarded detail',new URL(page.url()).pathname.includes('/equipment/assignments/'));
 for(const label of ['small-manager','small-restricted','large-admin']){await actor(label);await go();await check(label+' cannot read holder records',!(await text()).includes('EQ-HELD'));}
 await pool.query("insert into equipment_officer_grant(organization_id,employee_id,scope,employee_ids) values($1,$2,'selected',$3)",[small.organizationId,manager.employeeId,[holder.employeeId]]);grant=true;
 await actor('small-manager');await go();await wait('EQ-HELD');await check('scoped officer independently enters employee route',!!await page.$('button::-p-text(Issue equipment)'));await snap('after-scoped-officer');
 await go(small.employeeId);await check('scoped officer cannot enter uncovered employee',!(await text()).includes('Employee returns'));
 await pool.query('update equipment_officer_grant set revoked_at=now() where organization_id=$1 and employee_id=$2',[small.organizationId,manager.employeeId]);await go();await check('revocation removes direct-route admission',!(await text()).includes('EQ-HELD'));
 // Missing setup leaves the employee identity and existing records reachable.
 await actor('small-admin');await pool.query('delete from equipment_policy where organization_id=$1',[small.organizationId]);await go();await wait('EQ-HELD');await check('missing policy preserves holdings and removes issue',!(await page.$('button::-p-text(Issue equipment)')));await pool.query('insert into equipment_policy(organization_id,retention_months) values($1,24)',[small.organizationId]);await go();await wait('EQ-HELD');
 // Real streamed loading while this fixture's assignment table is locked.
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table equipment_assignment in access exclusive mode');
 const loading=page.goto(new URL(path(holder.employeeId),runtime.origin).href,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForSelector('[role="status"][aria-busy="true"]');await check('streaming keeps one employee task heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Employee equipment']);await snap('after-loading');await lock.query('rollback');lock.release();lock=null;await loading;await wait('EQ-HELD');
 // Organization switch during refresh: old employee id must become unavailable.
 const {rows:[switchUser]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[small.employeeId,small.organizationId]);extraMember=randomUUID();await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,switchUser.user_id]);
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table equipment_assignment in access exclusive mode');await click('button[aria-label="Reload equipment"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Reload equipment"]')?.getAttribute('aria-busy')==='true');await click('button[aria-label^="Switch Organization:"]');await click('[role="menuitem"]::-p-text(Performance large)');await lock.query('rollback');lock.release();lock=null;await page.waitForNetworkIdle({idleTime:1000,timeout:120000});await go();await check('org switch during read removes previous holder',!(await text()).includes('EQ-HELD'));await snap('after-org-switch');
 await check('no browser exceptions',evidence.errors,[]);
}catch(error){if(page){await snap('harness-failure');console.log(await page.evaluate(()=>({path:location.pathname,text:document.querySelector('main')?.innerText,dialogs:[...document.querySelectorAll('[role="dialog"]')].map(n=>n.innerText)})));}throw error;}
finally{if(commandRenamed)await pool.query('alter table equipment_command_r021_unavailable rename to equipment_command');if(readRenamed)await pool.query('alter table equipment_assignment_r021_unavailable rename to equipment_assignment');if(lock){await lock.query('rollback');lock.release();}if(memberId)await pool.query('update member set role=$2 where id=$1',[memberId,originalRole]);if(grant)await pool.query('delete from equipment_officer_grant where organization_id=$1 and employee_id=$2',[small.organizationId,manager.employeeId]);if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);await pool.query('update employee set is_active=true where id=$1 and organization_id=$2',[holder.employeeId,small.organizationId]);await save();await browser.close();await pool.end();}
