// Post-comparison, label-guarded synthetic empty-scope check; assignments restored in finally.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1706');
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg');const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();assert.equal((await db.query('select current_database() name')).rows[0].name,runtime.env.POSTGRES_DB);
const manager=fixture.actors['small-manager'],admin=fixture.actors['small-admin'];
assert.equal((await db.query('select u.email from employee e join "user" u on u.id=e.user_id where e.id=$1 and e.organization_id=$2',[manager.employeeId,manager.organizationId])).rows[0].email,manager.email);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});let assignments=[];
try{
 const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth['small-manager'].cookies);const p=await c.newPage();
 const go=()=>p.goto(runtime.origin+'/en/analytics/work-hours',{waitUntil:'networkidle0',timeout:120000});
 await go();await p.waitForSelector('section table tbody tr');const zero=await p.$$eval('section table tbody tr',rows=>rows.map(n=>n.innerText));assert.ok(zero.every(row=>row.includes('0.0h')));
 assignments=(await db.query('delete from employee_managers where manager_id=$1 and employee_id in (select id from employee where organization_id=$2) returning *',[manager.employeeId,manager.organizationId])).rows;assert.ok(assignments.length>0);
 await go();await p.waitForFunction(()=>document.body.innerText.includes('No data available for the selected period'));assert.equal(await p.$('table'),null);assert.ok(await p.evaluate(()=>document.body.innerText.includes('No trend data available')));await p.screenshot({path:join(out,'after-empty-scope.png')});
 await writeFile(join(out,'states-runtime.json'),JSON.stringify({zeroWorkPeriod:{actor:'small-manager',rows:zero,meaning:'Existing active roster remains present with real zero hours in current month'},emptyScope:{actor:'small-manager',removedAssignmentCount:assignments.length,emptyPeriod:true,emptyVariance:true,tableAbsent:true,transport:'real authorized reads; no response substitution'}},null,2)+'\n');
 // The boundary journey created this one extra synthetic profile through real invite/accept.
 // Exclude only that new profile so final matched before/after captures again have the original 8 active employees.
 const extra=(await db.query('select e.id from employee e join "user" u on u.id=e.user_id where e.organization_id=$1 and u.email=$2',[admin.organizationId,fixture.actors['large-admin'].email])).rows;
 assert.equal(extra.length,1);assert.ok(!Object.values(fixture.actors).some(a=>a.employeeId===extra[0].id));
 assert.equal((await db.query('update employee set is_active=false where id=$1 and organization_id=$2 and is_active=true',[extra[0].id,admin.organizationId])).rowCount,1);
 assert.equal(Number((await db.query('select count(*) n from employee where organization_id=$1 and is_active=true',[admin.organizationId])).rows[0].n),8);
 console.log('Verified real zero-work and empty-manager-scope states; restored original active roster for matched final captures.');
}finally{
 for(const r of assignments)await db.query('insert into employee_managers (id,employee_id,manager_id,is_primary,assigned_by,assigned_at,created_at) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing',[r.id,r.employee_id,r.manager_id,r.is_primary,r.assigned_by,r.assigned_at,r.created_at]);
 await browser.close();await db.end();
}
