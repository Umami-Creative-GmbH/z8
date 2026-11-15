// Diagnose the shared switch at the actual route boundary; no response substitution.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,waitVisible,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const phase=process.argv[3]??'after',out=join(repo,'docs/design/rollout-1692/1719');
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8')),a=fixture.actors['small-admin'],holder=fixture.actors['small-employee'],large=fixture.actors['large-admin'];
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();await page.setViewport({width:1600,height:1000});
const evidence={phase,errors:[]};page.on('pageerror',e=>evidence.errors.push({message:e.message,stack:e.stack}));let lock,extraMember;
const go=()=>page.goto(new URL('/en/equipment/employees/'+holder.employeeId,runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});
const key=async s=>{await(await waitVisible(page,s)).focus();await page.keyboard.press('Enter');};
const observe=()=>page.evaluate(()=>({heading:[...document.querySelectorAll('h1')].map(n=>n.textContent),scope:document.querySelector('button[aria-label^="Switch Organization:"]')?.getAttribute('aria-label'),hasHolding:document.querySelector('main')?.innerText.includes('EQ-HELD'),text:document.querySelector('main')?.innerText}));
try{
 const {rows:[u]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);extraMember=randomUUID();await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,u.user_id]);
 await go();await page.waitForFunction(()=>document.querySelector('main')?.innerText.includes('EQ-HELD'),{timeout:120000});evidence.before=await observe();
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table equipment_assignment in access exclusive mode');await key('button[aria-label="Reload equipment"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Reload equipment"]')?.getAttribute('aria-busy')==='true');
 await key('button[aria-label^="Switch Organization:"]');
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/organizations/switch',{timeout:120000});await clickVisible(page,'[role="menuitem"]::-p-text(Performance large)',30000);await lock.query('rollback');lock.release();lock=null;
 const actual=await response;evidence.response={status:actual.status()};
 await page.waitForNetworkIdle({idleTime:1500,timeout:120000});evidence.afterReload=await observe();
 await go();await page.waitForNetworkIdle({idleTime:1500,timeout:120000});evidence.afterReentry=await observe();
 evidence.databaseActiveTarget=await pool.query('select active_organization_id from session where user_id=$1',[u.user_id]).then(r=>r.rows.some(s=>s.active_organization_id===large.organizationId));
 await page.screenshot({path:join(out,phase+'-switch-settled.png'),fullPage:true});assert.deepEqual(evidence.response,{status:200});
 console.log(JSON.stringify({phase,response:evidence.response,databaseActiveTarget:evidence.databaseActiveTarget,afterReload:{scope:evidence.afterReload.scope,hasHolding:evidence.afterReload.hasHolding},afterReentry:{scope:evidence.afterReentry.scope,hasHolding:evidence.afterReentry.hasHolding},errors:evidence.errors}));
}finally{if(lock){await lock.query('rollback');lock.release();}if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);await writeFile(join(out,phase+'-switch.json'),JSON.stringify(evidence,null,2));await browser.close();await pool.end();}
