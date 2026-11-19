import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir=resolve('.tmp/1728/fixture'),out=resolve('docs/design/rollout-1692/1728');
const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),a=await read('dev-auth-private.json'),services=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg'),puppeteer=createRequire(resolve('package.json'))('puppeteer-core');const db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const c=await b.createBrowserContext();await c.setCookie(...a['small-admin'].cookies);await c.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});const p=await c.newPage();p.setDefaultTimeout(30000);
const result={stage:'start',checks:[],captures:[],errors:[],source:[],head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};p.on('pageerror',e=>result.errors.push(e.message));
const go=async path=>p.goto(r.origin+'/en'+path,{waitUntil:'networkidle2',timeout:90000});
const click=async(text,selector='button')=>{const element=await p.waitForFunction((text,selector)=>[...document.querySelectorAll(selector)].find(e=>e.checkVisibility()&&(e.textContent.trim()===text||e.getAttribute('aria-label')===text)),{},text,selector);await element.click();};
const capture=async name=>{await p.evaluate(()=>document.fonts.ready);const path=join(out,'after-'+name+'.png');await p.screenshot({path,fullPage:true});result.captures.push({path,...await p.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,fontStatus:document.fonts.status,h1:[...document.querySelectorAll('main h1')].map(e=>e.textContent.trim())}))});};
let locked=false;
try{
result.stage='held-read';await p.setViewport({width:390,height:844});await db.query('BEGIN');await db.query('LOCK TABLE employee_document IN ACCESS EXCLUSIVE MODE');locked=true;
const navigation=go('/personnel-files');await p.waitForFunction(()=>[...document.querySelectorAll('main [role=status]')].some(e=>e.getAttribute('aria-label')==='Loading personnel files'));
assert.deepEqual(await p.$$eval('main h1',es=>es.map(e=>e.textContent.trim())),['Personnel Files']);await capture('actual-pending-read');
let held=[];for(let i=0;i<40&&!held.length;i++){held=(await db.query("select pid from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%employee_document%' and state='active'")).rows;if(!held.length)await new Promise(r=>setTimeout(r,100));}assert.ok(held.length>0);for(const row of held)await db.query('select pg_cancel_backend($1)',[row.pid]);await db.query('COMMIT');locked=false;await navigation;
await p.waitForSelector('main [role=alert]');assert.ok(await p.$('main section ul'));assert.ok(!await p.$('main a[href*="?category="]'));assert.ok((await p.$eval('main [role=alert]',e=>e.innerText)).includes('Expiring documents could not be loaded'));await capture('actual-expiry-read-failure');result.checks.push({name:'Held actual PostgreSQL expiry read canceled only in owned fixture: safe pending heading then unknown expiry with independent employee records',heldReads:held.length});
await click('Retry');await p.waitForSelector('main a[href*="?category="]');await p.waitForFunction(()=>!document.querySelector('main [role=alert]'));await capture('actual-read-recovered');result.checks.push('Real route Retry recovered actual expiry records with independent employee directory intact.');
result.next=[];for(const [method,params]of[['tools/list',undefined],...['get_compilation_issues','get_errors','get_project_metadata','get_routes','get_page_metadata'].map(name=>['tools/call',{name,arguments:{}}])]){const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(120000)});const raw=await response.text();result.next.push({name:params?.name??method,result:response.headers.get('content-type')?.includes('event-stream')?JSON.parse(raw.split(/\r?\n/).find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(raw)});}
}catch(e){result.failure=e.message;await capture('failed-'+result.stage).catch(()=>{});throw e;}
finally{if(locked)await db.query('ROLLBACK');await writeFile(join(out,'recovery.json'),JSON.stringify(result,null,2));await db.end();await b.close();}
console.log('Actual held/failure/retry read and connected Next diagnostics completed.');
