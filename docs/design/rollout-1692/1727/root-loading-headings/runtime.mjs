import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const [fixtureInput,phase]=process.argv.slice(2);assert.ok(['before','after'].includes(phase));
const dir=resolve(fixtureInput),out=resolve('.tmp/1727-root-checks/runtime');await mkdir(out,{recursive:true});
const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),s=await read('r043-private.json'),a=await read('dev-auth-private.json'),services=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(services.label,'z8-performance-fixture-1450');
for(const container of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=['apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.tsx','apps/webapp/src/components/payroll/employee-balance-workspace.tsx','apps/webapp/src/components/payroll/employee-balance-loading-heading.tsx'];
const result={phase,source:await Promise.all(files.map(async path=>{const bytes=await readFile(path);return{path,sha256:sha(bytes),canonicalSha256:sha(bytes.toString('utf8').replaceAll('\r\n','\n'))};})),checks:[],captures:[],errors:[],abortedSpeculativePrefetch:0};
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg');const db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.createBrowserContext();await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...a['small-employee'].cookies);
const p=await context.newPage();p.setDefaultTimeout(30000);p.on('pageerror',error=>result.errors.push(error.message));await p.setViewport({width:1600,height:1000});await p.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'}]);
const headings=()=>p.evaluate(()=>[...document.querySelectorAll('main h1')].filter(node=>node.checkVisibility()).map(node=>node.textContent.trim()));
const capture=async name=>{
 await Promise.race([p.evaluate(()=>document.fonts.ready),new Promise(resolve=>setTimeout(resolve,3000))]);
 const observation=await p.evaluate(()=>({path:location.pathname,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,fontStatus:document.fonts.status,h1:[...document.querySelectorAll('main h1')].filter(node=>node.checkVisibility()).map(node=>node.textContent.trim()),status:[...document.querySelectorAll('main [role=status]')].filter(node=>node.checkVisibility()).map(node=>node.getAttribute('aria-label')??node.textContent)}));
 const filename=phase+'-'+name+'.png',bytes=Buffer.from(await p.screenshot({path:join(out,filename)}));result.captures.push({name:filename,...observation,png:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:sha(bytes)},source:result.source});
};
let locked=false;
try{
 await p.setRequestInterception(true);p.on('request',request=>{if(request.method()==='GET'&&(request.headers()['next-router-prefetch']==='1'||request.headers().purpose==='prefetch')){result.abortedSpeculativePrefetch++;return request.abort('failed');}return request.continue();});
 await p.goto(r.origin+'/en/payroll/work-balances',{waitUntil:'networkidle2',timeout:90000});
 const target='/en/payroll/work-balances/'+s.covered[0].id,selector='main a[href="'+target+'"]';await p.waitForSelector(selector);
 result.employeeIdentity=await p.$eval(selector,node=>node.querySelector('.font-medium').textContent.trim());
 await db.query('BEGIN');await db.query("SET LOCAL lock_timeout='10s'");await db.query('LOCK TABLE payroll_access_employee IN ACCESS EXCLUSIVE MODE');locked=true;
 await p.setRequestInterception(false);p.removeAllListeners('request');
 await (await p.$(selector)).click();
 await p.waitForFunction(target=>location.pathname===target&&[...document.querySelectorAll('main [role=status]')].some(node=>node.checkVisibility()&&node.getAttribute('aria-label')==='Loading the work balance'),{timeout:45000},target);
 let held=0;for(let attempt=0;attempt<30&&!held;attempt++){held=Number((await db.query("select count(*)::int as count from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%payroll_access_employee%'" )).rows[0].count);if(!held)await new Promise(resolve=>setTimeout(resolve,100));}assert.ok(held>0,'Actual covered-employee reader is held by the fixture lock');
 const pendingHeadings=await headings();assert.deepEqual(pendingHeadings,phase==='before'?[]:['Work balance']);
 result.checks.push({name:'Actual admitted-route read is pending with the expected safe main heading',heldDatabaseReads:held,headings:pendingHeadings,tableLockOnlyNoBusinessWrite:true});await capture('pending');
 await db.query('COMMIT');locked=false;
 await p.waitForFunction(name=>[...document.querySelectorAll('main h1')].some(node=>node.checkVisibility()&&node.textContent.includes(name)),{},result.employeeIdentity);
 await p.waitForFunction(()=>[...document.querySelectorAll('main button')].some(node=>node.checkVisibility()&&node.textContent.trim()==='Set opening balance'&&!node.disabled));
 const settled=await headings();assert.equal(settled.length,1);assert.ok(settled[0].includes(result.employeeIdentity));result.checks.push({name:'Released actual coverage read reveals one authorized employee heading and existing action',headings:settled});await capture('settled');
 result.next=[];for(const name of ['get_compilation_issues','get_errors']){const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}}),signal:AbortSignal.timeout(45000)});const raw=await response.text();const payload=response.headers.get('content-type')?.includes('event-stream')?JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('data: ')).slice(6)):JSON.parse(raw);result.next.push({name,result:payload});}
 assert.deepEqual(result.errors,[]);
}catch(error){result.failure=error.message;await capture('failed').catch(failure=>{result.captureFailure=failure.message;});throw error;}
finally{if(locked)await db.query('ROLLBACK').catch(()=>{});await db.end();await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2)+'\n');await browser.close();}
console.log(`${phase}: ${result.checks.length} actual heading states, ${result.captures.length} captures.`);
