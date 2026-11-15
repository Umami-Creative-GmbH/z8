// Real handlers and guarded local data only. Transport failures are aborted, never mocked as success.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1715');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(new URL(runtime.origin).hostname,'localhost');
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
let page,context,extraMember,grantRevoked=false,featureOff=false;const results=[],errors=[];
const a=fixture.actors['small-admin'],e=fixture.actors['small-employee'],large=fixture.actors['large-admin'];
const contextOnly=process.argv[3]==='--context-only';
const save=()=>writeFile(join(out,contextOnly?'runtime-context.json':'runtime.json'),JSON.stringify({results,errors},null,2));
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);results.push({name,actual});await save();};
const text=()=>page.evaluate(()=>document.querySelector('main')?.innerText||document.body.innerText);
const waitText=s=>page.waitForFunction(s=>document.body.innerText.includes(s),{timeout:90000},s);
const snap=name=>page.screenshot({path:join(out,name+'.png'),fullPage:true});
const click=selector=>clickVisible(page,selector);
const go=async(path='/en/driving-licence')=>{await page.goto(new URL(path,runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});};
const actor=async name=>{context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth[name].cookies);page=await context.newPage();page.setDefaultTimeout(30000);await page.setViewport({width:1600,height:1000});page.on('pageerror',error=>errors.push(error.message));};
const width=()=>page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
const refresh=async()=>{await click('button[aria-label="Refresh data"]');await page.waitForFunction(()=>document.querySelector('button[aria-label="Refresh data"]')?.getAttribute('aria-busy')==='false',{timeout:90000});};
try{
if(!contextOnly){
await actor('small-admin');await go('?tab=checks'.startsWith('?')?'/en/driving-licence?tab=checks':'');await waitText('Intended drivers to check');
await check('exactly one main title',await page.$$eval('h1',nodes=>nodes.map(n=>n.textContent)),['Driving licence']);
await check('explicitly granted admin has all three role tabs',await page.$$eval('[role="tab"]',nodes=>nodes.map(n=>n.textContent)),['My licence','Checks','Planning']);
await check('verifier excludes self from worklist',await page.$$eval('table a',nodes=>nodes.map(n=>n.getAttribute('href')).every(h=>!h.includes('placeholder')))&&!(await page.$$eval('table a',nodes=>nodes.map(n=>n.getAttribute('href')))).some(h=>h.includes(a.employeeId)));
await page.type('input[type="search"][name="driving-check-search"]','no-such-driver');await waitText('No intended drivers match');await snap('no-matches');
await page.$eval('input[name="driving-check-search"]',n=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(n,'');n.dispatchEvent(new Event('input',{bubbles:true}));});
await page.reload({waitUntil:'networkidle0'});await waitText('Check Person 2');
await click(`a[href$="/checks/${e.employeeId}"]`);await waitText("Inspect Person 2");await check('worklist opens actual authorized check',new URL(page.url()).pathname.endsWith('/checks/'+e.employeeId));await snap('open-check');
await go('/en/driving-licence/checks/'+a.employeeId);await check('self-check is unavailable',!(await text()).includes('Classes actually inspected'));await snap('self-check-refused');
await actor('small-manager');await go();await waitText('Find employee');await check('planner-only role has no tab bar',await page.$('[role="tablist"]')===null);
await click('button::-p-text(Person 2)');await waitText('Driving authorization active');await check('operational view has restrictions and no inspection', (await text()).includes('Corrective lenses')&&!(await text()).includes('Original check evidence')&&!(await text()).includes('Download evidence PDF'));await snap('planner-only');
let abortRoster=false;
await page.setRequestInterception(true);page.on('request',r=>{if(abortRoster&&r.url().includes('/api/driving-licence/operational-employees'))void r.abort('failed');else void r.continue();});
abortRoster=true;await click('button::-p-text(Refresh planning employees)');await waitText('Planning employees are unavailable');await check('failed operational read withdraws roster',!(await text()).includes('Corrective lenses'));await snap('planning-failed');
abortRoster=false;await click('button::-p-text(Retry)');await waitText('Person 2');await check('planning Retry recovers actual GET',await page.$('input[name="driving-employee-search"]')!==null);await snap('planning-recovered');
await actor('small-restricted');await go();await check('ungranted role sees no licence controls',!(await text()).includes('Find employee')&&!(await text()).includes('Original check evidence'));await snap('ungranted');
await actor('small-employee');await go();await waitText('Original check evidence');await check('driver-only view omits Checks and Planning',await page.$('[role="tablist"]')===null&&!(await text()).includes('Intended drivers to check'));
await check('uncertain reminder remains uncertain',(await text()).includes('uncertain delivery outcome (1)')&&(await text()).includes('will not be sent again automatically'));await snap('uncertain-reminder');
const pdf=await page.$eval('a[href^="/api/driving-licence/evidence"]',n=>n.href);const exportResult=await page.evaluate(async url=>{const r=await fetch(url);const b=new Uint8Array(await r.arrayBuffer());return{status:r.status,type:r.headers.get('content-type'),prefix:String.fromCharCode(...b.slice(0,5))};},pdf);await check('actual own evidence PDF',exportResult,{status:200,type:'application/pdf',prefix:'%PDF-'});
// Abort before dispatch: no fabricated response and no mutation accepted on the first attempt.
let abortReport=true;await page.setRequestInterception(true);page.on('request',r=>{if(abortReport&&r.method()==='POST'&&r.headers()['next-action'])void r.abort('failed');else void r.continue();});
await click('button::-p-text(Report that I cannot drive)');await waitText('The report could not be saved');await check('failed report keeps retry available',await page.$('button::-p-text(Report that I cannot drive)')!==null);await snap('report-failed');
abortReport=false;await click('button::-p-text(Report that I cannot drive)');await waitText('All your class authorizations are suspended');await check('real report returns suspension guidance',(await text()).includes('explicit reinstatement'));await page.reload({waitUntil:'networkidle0'});await waitText('Driving authorization suspended');await check('suspension persists through authorized record reload',(await text()).includes('new check alone does not lift it'));await snap('report-persisted');
const {rows:[reports]}=await pool.query('select count(*)::int n from driving_impediment_report where organization_id=$1 and employee_id=$2',[a.organizationId,e.employeeId]);await check('retry created exactly one report',reports.n,1);
await actor('small-admin');await go('/en/driving-licence?tab=checks');await waitText('Check Person 2');await check('verifier worklist reflects suspension',(await text()).includes('Suspended'));await snap('worklist-suspended');
await click(`a[href$="/checks/${e.employeeId}"]`);await waitText('Classes actually inspected');
await pool.query('update driving_licence_verifier_grant set revoked_at=now(),revoked_by=granted_by where organization_id=$1 and verifier_employee_id=$2 and revoked_at is null',[a.organizationId,a.employeeId]);grantRevoked=true;
await refresh();await check('permission loss withdraws inspection form',!(await text()).includes('Classes actually inspected'));await snap('verifier-revoked');
await pool.query('update driving_licence_verifier_grant set revoked_at=null,revoked_by=null where organization_id=$1 and verifier_employee_id=$2',[a.organizationId,a.employeeId]);grantRevoked=false;
await go();await waitText('Driving authorization active');
await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await page.waitForFunction(()=>localStorage.getItem('sidebar_state')==='false');await page.reload({waitUntil:'networkidle0'});await check('collapse preference persisted',await page.$eval('button[data-sidebar="trigger"]',n=>n.getAttribute('aria-expanded')),'false');await snap('collapsed');
await click('::-p-aria(Toggle theme)');await click('[role="menuitem"]::-p-text(Dark)');await page.setViewport({width:2400,height:1200});await page.reload({waitUntil:'networkidle0'});await check('dark theme persisted',await page.evaluate(()=>document.documentElement.classList.contains('dark')));await check('wide dark fits',await width(),{document:2400,viewport:2400});await snap('wide-dark');
await click('button[data-sidebar="trigger"]');await click('button[aria-label^="Account:"]');await click('[role="menuitem"]::-p-text(Font size)');await click('[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle0'});await check('font preference persisted',await page.evaluate(()=>({saved:localStorage.getItem('z8-font-size'),size:getComputedStyle(document.documentElement).fontSize})),{saved:'large',size:'18px'});await check('phone large dark fits',await width(),{document:390,viewport:390});await snap('phone-large-dark');
await click('button[data-sidebar="trigger"]');await page.waitForSelector('[role="dialog"]');await snap('phone-drawer');await page.keyboard.press('Escape');await new Promise(r=>setTimeout(r,500));results.push({name:'drawer Escape actual observation',actual:await page.$('[role="dialog"]')===null});await save();
if(await page.$('[role="dialog"]'))await page.keyboard.press('Escape');
await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.addStyleTag({content:'html {font-size:22.5px !important}'});await check('enlarged reduced-motion phone fits',await width(),{document:390,viewport:390});await snap('phone-enlarged-reduced');
await page.setViewport({width:800,height:500,deviceScaleFactor:2});await check('zoom equivalent fits',await width(),{document:800,viewport:800});await snap('zoom-equivalent');
}
// Real organization switch while an operational GET is held in flight.
await actor('small-admin');await go('/en/driving-licence?tab=planning');await waitText('Find employee');
const {rows:[employee]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[a.employeeId,a.organizationId]);
extraMember=randomUUID();await pool.query("insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'admin','approved',now())",[extraMember,large.organizationId,employee.user_id]);
await page.reload({waitUntil:'networkidle0'});await waitText('Find employee');
let held;await page.setRequestInterception(true);page.on('request',r=>{if(!held&&r.url().includes('/api/driving-licence/operational-employees'))held=r;else void r.continue();});
await click('button::-p-text(Refresh planning employees)');await page.waitForFunction(()=>document.querySelector('button')!==null);for(let n=0;n<30&&!held;n++)await new Promise(r=>setTimeout(r,100));assert.ok(held);
await click('button[aria-label^="Switch Organization:"]');const switched=page.waitForNavigation({waitUntil:'networkidle0',timeout:90000});await click('[role="menuitem"]::-p-text(Performance large)');await held.continue().catch(()=>{});await switched;await waitText('Page not found');await check('organization switch removes old operational targets',await page.$$eval('input[name="driving-employee-search"]',nodes=>nodes.every(n=>!n.checkVisibility())));await snap('organization-switched');
await click('button[aria-label^="Switch Organization:"]');await Promise.all([page.waitForNavigation({waitUntil:'networkidle0',timeout:90000}),click('[role="menuitem"]::-p-text(Performance small)')]);await waitText('Find employee');
await actor('small-admin');await go();await waitText('Driving authorization active');await pool.query('update driving_licence_policy set enabled=false where organization_id=$1',[a.organizationId]);featureOff=true;await page.reload({waitUntil:'networkidle0'});await check('feature off retains not-found boundary',!(await text()).includes('Original check evidence')&&!(await text()).includes('Report that I cannot drive'));await snap('feature-off');await pool.query('update driving_licence_policy set enabled=true where organization_id=$1',[a.organizationId]);featureOff=false;
await page.reload({waitUntil:'networkidle0'});await waitText('Driving authorization active');await check('browser uncaught errors',errors,[]);
await writeFile(join(dir,'browser-ready-private.json'),JSON.stringify({ws:browser.wsEndpoint()}),{mode:0o600});console.log(`Saved ${results.length} runtime observations; browser remains connected for Next MCP.`);await new Promise(done=>browser.once('disconnected',done));
}catch(error){console.error(error.message);await snap('harness-failure').catch(()=>{});throw error;}finally{
if(grantRevoked)await pool.query('update driving_licence_verifier_grant set revoked_at=null,revoked_by=null where organization_id=$1 and verifier_employee_id=$2',[a.organizationId,a.employeeId]);
if(featureOff)await pool.query('update driving_licence_policy set enabled=true where organization_id=$1',[a.organizationId]);
if(extraMember)await pool.query('delete from member where id=$1',[extraMember]);
await save();await browser.close();await pool.end();
}
