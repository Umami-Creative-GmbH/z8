// Run from repo root: pnpm node docs/design/rollout-1692/1714/verify-runtime.mjs <owned-private-fixture-directory>
// Requires the handoff dev helper and authenticated small-admin/manager/employee/restricted + large-admin.
// Uses only generated disposable data. Temporarily unavailability-tests three source tables and restores them in finally.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1714');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(services.label,'z8-performance-fixture-1450');
for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const runLock=await open(join(dir,'r016-running-private.lock'),'wx');
const browser=await puppeteer.launch({executablePath:process.env.Z8_TEST_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[],errors=[];let page;const renamed=[];let extraMember,lock;let originalRole;
const save=async()=>writeFile(join(out,'runtime.json'),JSON.stringify({results,errors},null,2));
const check=async(name,value,expected=true)=>{assert.deepEqual(value,expected,name);results.push({name,value});await save();};
const snap=async name=>{await page.screenshot({path:join(out,name+'.png'),fullPage:true});};
const text=()=>page.evaluate(()=>document.querySelector('main')?.innerText||'');
const waitText=s=>page.waitForFunction(s=>document.body.innerText.includes(s),{timeout:120000},s);
const goto=async(path='/en/compliance')=>{await page.goto(new URL(path,runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});};
const newActor=async actor=>{const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);if(actor)await context.setCookie(...auth[actor].cookies);page=await context.newPage();page.setDefaultTimeout(30000);await page.setViewport({width:1600,height:1000});page.on('pageerror',e=>errors.push(e.message));return context;};
const width=()=>page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
const click=selector=>clickVisible(page,selector);
const refresh=async()=>{await click('button[aria-label="Refresh data"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='false',{timeout:120000});};
const tableNames=['audit_pack_request','work_policy_violation','audit_log'];
const rename=async table=>{assert.ok(tableNames.includes(table));await pool.query(`alter table "${table}" rename to "${table}_r016_unavailable"`);renamed.push(table);};
const restore=async()=>{while(renamed.length){const table=renamed.at(-1);await pool.query(`alter table "${table}_r016_unavailable" rename to "${table}"`);renamed.pop();}};
try{
 await mkdir(out,{recursive:true});
 await newActor('small-admin');await goto();await waitText('Rest-period violations: 1');
 await check('one task heading',await page.$$eval('h1',ns=>ns.map(n=>n.textContent)),['Compliance']);
 await check('critical sources precede unconfigured evidence',await page.$$eval('h3',ns=>ns.map(n=>n.textContent)),['Workforce compliance','Access controls','Audit evidence']);
 await check('real source counts', (await text()).includes('Recent sensitive events: 1'));
 for(const [label,path,needle] of [['Open Compliance Settings','/en/settings/compliance','Compliance'],['Open Audit Log','/en/settings/audit-export?tab=activity','Activity'],['Open Audit Export','/en/settings/audit-export','Audit']]){
  await click(`a::-p-text(${label})`);await page.waitForFunction(path=>location.pathname+location.search===path,{timeout:120000},path);await waitText(needle);await check(label+' destination',new URL(page.url()).pathname+new URL(page.url()).search,path);await snap('action-'+label.toLowerCase().replaceAll(' ','-'));await goto();await waitText('Rest-period violations: 1');
 }
 await page.evaluate(()=>{window.__r016Heading=document.querySelector('h1');});
 await refresh();await check('refresh keeps heading DOM and real findings',await page.evaluate(()=>window.__r016Heading===document.querySelector('h1')&&document.body.innerText.includes('Rest-period violations: 1')));
 await rename('audit_pack_request');
 await refresh();await waitText('Audit evidence data could not be loaded.');
 await check('partial source feedback and retained findings',(await text()).includes('Recent events are limited to available sources.')&&(await text()).includes('Rest-period violations: 1'));
 await check('unavailable context follows events',await page.evaluate(()=>!!(document.querySelector('#compliance-events').compareDocumentPosition(document.querySelector('#compliance-coverage'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 await snap('partial');
 await rename('work_policy_violation');await rename('audit_log');await refresh();await waitText('Recent events could not be confirmed');
 await check('all unavailable never says no critical events',!(await text()).includes('No recent critical events were detected.'));
 await check('three unavailable destinations retained',await page.$$eval('section[aria-labelledby="compliance-coverage"] article a',ns=>ns.length),3);await snap('unavailable');
 await restore();await refresh();await waitText('Rest-period violations: 1');await check('recovery restores all real sources',!(await text()).includes('could not be loaded'));await snap('recovered');
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await page.waitForFunction(()=>localStorage.getItem('sidebar_state')==='false');await page.reload({waitUntil:'networkidle0'});await waitText('Rest-period violations: 1');await page.waitForFunction(()=>document.querySelector('[data-slot="sidebar"][data-state]')?.getAttribute('data-state')==='collapsed');await check('saved collapsed sidebar',await page.$eval('button[data-sidebar="trigger"]',n=>n.getAttribute('aria-expanded')),'false');await snap('collapsed');
 await page.keyboard.down('Control');await page.keyboard.press('k');await page.keyboard.up('Control');await page.waitForSelector('[role="dialog"]');await check('search shortcut opens dialog',!!await page.$('[role="dialog"]'));await page.keyboard.press('Escape');
 await click('::-p-aria(Toggle theme)');await click('[role="menuitem"]::-p-text(Dark)');await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await page.setViewport({width:2400,height:1200});await page.reload({waitUntil:'networkidle0'});await waitText('Rest-period violations: 1');await check('dark persists',await page.evaluate(()=>document.documentElement.classList.contains('dark')));await check('wide fits',await width(),{document:2400,viewport:2400});await snap('wide-dark');
 await click('button[data-sidebar="trigger"]');await waitVisible(page,'button[aria-label^="Account:"]');await click('button[aria-label^="Account:"]');
 await click('[role="menuitem"]::-p-text(Font size)');await click('[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForFunction(()=>localStorage.getItem('z8-font-size')==='large');
 await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle0'});await waitText('Rest-period violations: 1');await check('large font persists',await page.evaluate(()=>({saved:localStorage.getItem('z8-font-size'),size:getComputedStyle(document.documentElement).fontSize})),{saved:'large',size:'18px'});await check('phone large fits',await width(),{document:390,viewport:390});await snap('phone-large-dark');
 await click('button[data-sidebar="trigger"]');await page.waitForSelector('[role="dialog"]');await snap('phone-drawer');const drawerLink=await waitVisible(page,'[role="dialog"] a');await drawerLink.focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));await check('drawer escape returns focus',await page.evaluate(()=>document.activeElement?.matches('button[data-sidebar="trigger"]')));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.addStyleTag({content:'html { font-size: 22.5px !important; }'});await check('enlarged reduced-motion phone fits',await width(),{document:390,viewport:390});await snap('phone-enlarged-reduced-motion');await page.setViewport({width:800,height:500,deviceScaleFactor:2});await check('zoom-equivalent fits',await width(),{document:800,viewport:800});await snap('zoom-equivalent');
 await newActor('small-admin');lock=await pool.connect();await lock.query('begin');await lock.query('lock table work_policy_violation in access exclusive mode');const arriving=page.goto(new URL('/en/compliance',runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('[role="status"][aria-label="Loading compliance signals"]');await check('streamed first load never invents findings',!(await text()).includes('Rest-period violations:'));await snap('loading');await lock.query('rollback');lock.release();lock=null;await arriving;await waitText('Rest-period violations: 1');
 for(const actor of ['small-manager','small-employee','small-restricted']){await newActor(actor);await goto();await page.waitForFunction(()=>location.pathname==='/en/settings',{timeout:120000});await check(actor+' refused',new URL(page.url()).pathname,'/en/settings');await check(actor+' no compliance findings',!(await text()).includes('Rest-period violations: 1'));await snap(actor+'-refused');}
 await newActor();await goto();await check('signed-out returns to sign-in',new URL(page.url()).pathname,'/en/sign-in');
 await newActor('large-admin');await goto();await waitText('Rest-period violations: 0');await check('independent large-organization counts',(await text()).includes('Rest-period violations: 0')&&!(await text()).includes('permission.revoked'));await snap('large-organization');
 // Add only a synthetic membership, exercising the existing admin-without-employee capability.
 const small=fixture.actors['small-admin'],large=fixture.actors['large-admin'];const {rows:[employee]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[small.employeeId,small.organizationId]);
 extraMember=randomUUID();await pool.query("insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,employee.user_id]);
 await newActor('small-admin');await goto();await waitText('Rest-period violations: 1');
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table work_policy_violation in access exclusive mode');await click('button[aria-label="Refresh data"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='true');
 await click('button[aria-label^="Switch Organization:"]');const switched=page.waitForNavigation({waitUntil:'networkidle0',timeout:120000});await click('[role="menuitem"]::-p-text(Performance large)');await lock.query('rollback');lock.release();lock=null;await switched;await goto();await waitText('Rest-period violations: 0');await check('organization switch during pending read never retains old findings',(await text()).includes('Rest-period violations: 0')&&!(await text()).includes('permission.revoked'));await snap('scope-switch');
 // Return through the real switcher before testing live permission loss on refresh.
 await click('button[aria-label^="Switch Organization:"]');await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:120000}),click('[role="menuitem"]::-p-text(Performance small)')]);await goto();await waitText('Rest-period violations: 1');
 const {rows:[membership]}=await pool.query('select role from member where user_id=$1 and organization_id=$2',[employee.user_id,small.organizationId]);originalRole=membership.role;
 await pool.query("update member set role='member' where user_id=$1 and organization_id=$2",[employee.user_id,small.organizationId]);await refresh();await page.waitForFunction(()=>location.pathname!=='/en/compliance'&&!document.body.innerText.includes('Critical compliance risks need attention'),{timeout:30000});const refusalPath=new URL(page.url()).pathname;assert.ok(['/en','/en/','/en/settings'].includes(refusalPath));await check('permission loss removes protected findings',!(await text()).includes('Rest-period violations: 1'));results.push({name:'permission loss observed refusal destination',value:refusalPath});await save();await snap('permission-loss');
 await pool.query('update member set role=$1 where user_id=$2 and organization_id=$3',[originalRole,employee.user_id,small.organizationId]);originalRole=null;
 await newActor('small-admin');await goto();await waitText('Rest-period violations: 1');
 const {rows:[count]}=await pool.query('select count(*)::int as total from work_policy_violation where organization_id=$1',[small.organizationId]);await check('read refresh does not reevaluate policy findings',count.total,1);
 await check('browser uncaught errors',errors,[]);
 await writeFile(join(dir,'browser-ready-private.json'),JSON.stringify({ws:browser.wsEndpoint()}),{mode:0o600});console.log('Runtime assertions saved. Browser remains connected for MCP; close the privately recorded browser endpoint afterward.');
 await new Promise(done=>browser.once('disconnected',done));
}catch(error){await snap('harness-failure');console.error(JSON.stringify({path:new URL(page.url()).pathname,error:error.message}));throw error;}finally{
 if(lock){await lock.query('rollback');lock.release();}
 await restore();
 const a=fixture.actors['small-admin'];if(originalRole){const {rows:[e]}=await pool.query('select user_id from employee where id=$1',[a.employeeId]);await pool.query('update member set role=$1 where user_id=$2 and organization_id=$3',[originalRole,e.user_id,a.organizationId]);}
 if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);
 await save();await browser.close();await pool.end();await runLock.close();await unlink(join(dir,'r016-running-private.lock'));
}
