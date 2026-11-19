import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const out=join(repo,'docs/design/rollout-1692/1717'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const a=fixture.actors['small-admin'],large=fixture.actors['large-admin'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);
const page=await context.newPage();await page.setViewport({width:1600,height:1000});
const checks=[],errors=[];page.on('pageerror',e=>errors.push(e.message));let lock,memberId,originalRole,userId;
const save=()=>writeFile(join(out,'variants.json'),JSON.stringify({checks,errors},null,2));
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks.push({name,actual});await save();};
const click=s=>clickVisible(page,s,30000),wait=s=>page.waitForFunction(s=>document.body.innerText.includes(s),{timeout:120000},s);
const go=()=>page.goto(new URL('/en/equipment',runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});
const snap=name=>page.screenshot({path:join(out,name+'.png'),fullPage:true});
try{
 await go();await wait('EQ-HELD');
 // Keyboard summary activation and real URL/state changes.
 await (await waitVisible(page,'button[aria-label="Show overdue returns"]')).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>location.search.includes('overdue=true'));await check('keyboard summary updates URL and view',await page.$$eval('tbody tr',ns=>ns.length),1);await snap('after-keyboard-summary');
 await click('button[aria-label="Show outstanding returns"]');
 await (await waitVisible(page,'th button::-p-text(Item)')).focus();await page.keyboard.press('Enter');await check('keyboard sort announces ascending',await page.$eval('th[aria-sort="ascending"]',n=>n.textContent),'Item');
 await page.type('input[type="search"]','no-such-equipment');await wait('No equipment assignments match');await check('no-match retains clear filters',!!await page.$('button::-p-text(Clear filters)'));await snap('after-no-matches');await click('button::-p-text(Clear filters)');await wait('EQ-HELD');
 // Authority is rechecked on submission, not granted by an open panel.
 const {rows:[u]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);userId=u.user_id;
 const {rows:[m]}=await pool.query('select id,role from member where user_id=$1 and organization_id=$2',[userId,a.organizationId]);memberId=m.id;originalRole=m.role;
 await click('button::-p-text(Issue equipment)');await wait('Record issuance');
 await pool.query("update member set role='member' where id=$1",[memberId]);
 const item=await page.$('[role="dialog"] select[name="itemId"]');await item.select(await pool.query("select id from equipment_type where organization_id=$1 and name='Fixture shirts'",[a.organizationId]).then(r=>r.rows[0].id));
 await page.select('[role="dialog"] select[name="employeeId"]',fixture.actors['small-employee'].employeeId);
 await page.$eval('[role="dialog"] input[type="date"]',n=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'2026-11-14');n.dispatchEvent(new Event('input',{bubbles:true}));});
 await (await waitVisible(page,'[role="dialog"] button[type="submit"]')).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(n=>/access|permission|could not|authorized/i.test(n.textContent)),{timeout:120000});await check('authority-loss submission keeps refused panel',!!await page.$('[role="dialog"]'));await snap('after-authority-loss-submit');
 await pool.query('update member set role=$2 where id=$1',[memberId,originalRole]);await go();await wait('EQ-HELD');await check('refused action creates no extra holding',await page.$$eval('tbody tr',ns=>ns.length),2);
 // Set up a second synthetic organization membership, but no equipment setup.
 await pool.query('update organization set equipment_enabled=true where id=$1',[large.organizationId]);
 await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now()) on conflict do nothing",[randomUUID(),large.organizationId,userId]);
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table equipment_assignment in access exclusive mode');
 const load=page.goto(new URL('/en/equipment',runtime.origin).href,{waitUntil:'domcontentloaded',timeout:120000}).catch(error=>({navigationError:error.message}));
 await page.waitForSelector('[role="status"][aria-busy="true"]');await check('streamed loading keeps one task heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Equipment']);await snap('after-loading');
 await lock.query('rollback');lock.release();lock=null;await load;await wait('EQ-HELD');
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table equipment_assignment in access exclusive mode');
 await click('button[aria-label="Reload equipment"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Reload equipment"]')?.getAttribute('aria-busy')==='true');await snap('after-refresh-pending');
 await click('button[aria-label^="Switch Organization:"]');await click('[role="menuitem"]::-p-text(Performance large)');
 await lock.query('rollback');lock.release();lock=null;
 await page.waitForNetworkIdle({idleTime:1000,timeout:120000});await go();await wait('Set up equipment first');
 await check('switch during in-flight read removes old-scope records',await page.evaluate(()=>!document.querySelector('main')?.textContent.includes('EQ-HELD')));await check('second organization has real setup action',!!await page.$('a[href="/en/settings/equipment"]'));await snap('after-switch-during-load');
 await page.setViewport({width:390,height:844});await go();await wait('Set up equipment first');await check('phone setup fits',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));
 // Current-route check after inheriting root's owner correction.
 await click('button[data-sidebar="trigger"]');await waitVisible(page,'[role="dialog"] a');await (await waitVisible(page,'[role="dialog"] a')).focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:30000});await check('current equipment phone drawer closes on first Escape',await page.evaluate(()=>document.activeElement?.matches('button[data-sidebar="trigger"]')));await snap('after-current-drawer-escape');
 await check('no browser exceptions',errors,[]);
}catch(error){await snap('variant-harness-failure');console.log(await page.evaluate(()=>({path:location.pathname,text:document.querySelector('main')?.innerText,dialogs:[...document.querySelectorAll('[role=dialog]')].map(n=>n.innerText)})));throw error;}
finally{if(lock){await lock.query('rollback');lock.release();}if(memberId)await pool.query('update member set role=$2 where id=$1',[memberId,originalRole]);if(userId)await pool.query('delete from member where organization_id=$1 and user_id=$2',[large.organizationId,userId]);await pool.query('update organization set equipment_enabled=false where id=$1',[large.organizationId]);await save();await browser.close();await pool.end();}
