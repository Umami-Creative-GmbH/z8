import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const out=join(repo,'docs/design/rollout-1692/1730'),result={checks:[]};
const manager=fixture.actors['small-manager'],owner=fixture.actors['small-admin'],target=fixture.actors['small-restricted'],former=fixture.actors['small-employee'];
const {rows:[ownerProfile]}=await pool.query("select user_id from employee where id=$1 and organization_id=$2",[owner.employeeId,owner.organizationId]);
// Synthetic prerequisites only: never claim these grants/departures were created through product workflows.
const {rows:[grant]}=await pool.query(`insert into personnel_file_officer_grant(organization_id,officer_employee_id,scope,categories,created_by,updated_by) values($1,$2,'specific',array['certificate'],$3,$3) returning id`,[owner.organizationId,manager.employeeId,ownerProfile.user_id]);
for(const employeeId of [target.employeeId,manager.employeeId,former.employeeId])await pool.query('insert into personnel_file_officer_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)',[owner.organizationId,grant.id,employeeId,ownerProfile.user_id]);
await pool.query('update employee set is_active=false where id=$1 and organization_id=$2',[former.employeeId,owner.organizationId]);
for(const [employeeId,title] of [[manager.employeeId,'R047 own file excluded'],[former.employeeId,'R047 former record']])await pool.query(`insert into employee_document_request(id,organization_id,employee_id,category,title,deadline,status,created_by) values($1,$2,$3,'certificate',$4,'2026-11-01','cancelled',$5)`,[randomUUID(),owner.organizationId,employeeId,title,ownerProfile.user_id]);
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-manager'].cookies);const page=await context.newPage();await page.setViewport({width:1600,height:1000});
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=all&pageSize=50',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.innerText.includes('R047 former record'));
 const rows=await page.$$eval('ul.divide-y>li',nodes=>nodes.map(n=>n.innerText));assert(rows.every(row=>row.includes('Certificate')&&!row.includes('Other')));result.checks.push('Actual restricted officer arrival lists only seeded certificate coverage');
 assert(rows.some(row=>row.includes('Former employee')));result.checks.push('Former-file history remains marked and visible to covering officer');
 assert(!rows.some(row=>row.includes('R047 own file excluded')));result.checks.push('Actual officer read excludes own request even when seeded scope names self');
 await page.screenshot({path:join(out,'restricted-officer.png')});
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await page.waitForFunction(()=>localStorage.getItem('sidebar_state')==='false');result.checks.push('Ctrl+B collapses sidebar without changing request route');
 await clickVisible(page,'[data-sidebar="footer"] button[data-slot="dropdown-menu-trigger"]');await clickVisible(page,'[role="menuitem"]::-p-text(Font size)');await clickVisible(page,'[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.innerText.includes('R047 former record'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('z8-font-size')),'large');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'18px');result.checks.push('Actual font menu saves Large and reload applies18px');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);result.checks.push('Saved18px phone fits viewport');
 await page.focus('button[data-sidebar="trigger"]');await page.keyboard.press('Enter');await page.waitForSelector('[role="dialog"] a');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));assert(await page.evaluate(()=>document.activeElement?.matches('button[data-sidebar="trigger"]')));result.checks.push('Phone drawer Escape returns focus to trigger');
 await page.screenshot({path:join(out,'saved18px-phone.png')});
}catch(error){result.failure=error.message;throw error;}finally{await writeFile(join(out,'variants-runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}

