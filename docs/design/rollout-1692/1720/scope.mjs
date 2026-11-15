import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const actor=fixture.actors['small-employee'],large=fixture.actors['large-admin'],evidence={checks:[]};
let lock;
const check=(name,value)=>{assert(value,name);evidence.checks.push({name,value});};
try{
 const {rows:[employee]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[actor.employeeId,actor.organizationId]);
 await pool.query("insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'member','approved',now()) on conflict do nothing",[randomUUID(),large.organizationId,employee.user_id]);
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-employee'].cookies);const page=await context.newPage();await page.setViewport({width:1600,height:1000});await page.goto(runtime.origin+'/en/my-documents',{waitUntil:'networkidle2'});
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table employee_document_request in access exclusive mode');
 const pending=page.evaluate(()=>fetch('/en/my-documents',{headers:{RSC:'1'}}).then(r=>r.status)).catch(()=>null);
 let blocked=false;
 for(let i=0;i<100;i++) {const {rows:[r]}=await pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query ilike '%employee_document_request%') blocked");if(r.blocked){blocked=true;break;}await new Promise(done=>setTimeout(done,50));}
 check('actual request read observed waiting on fixture DB lock',blocked);
 const switched=await page.evaluate(async organizationId=>{const r=await fetch('/api/organizations/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})});return {status:r.status,body:await r.json()};},large.organizationId);
 check('actual organization-switch owner accepts approved membership',switched.status===200);
 const navigation=page.reload({waitUntil:'domcontentloaded'});await lock.query('rollback');lock.release();lock=null;await navigation;await pending;
 await page.waitForNetworkIdle({idleTime:1000});
 check('late old-org read cannot restore shared documents in feature-off org',await page.evaluate(()=>!document.body.innerText.includes('First aid certificate')&&![...document.querySelectorAll('button')].some(b=>b.textContent==='Upload document')));
 const status=await page.evaluate(async id=>(await fetch('/api/personnel-files/documents/'+id)).status,JSON.parse(await readFile(join(dir,'1720-private.json'),'utf8')).shared);
 check('new organization session refuses original organization document',status===404);
 await page.screenshot({path:join(repo,'docs/design/rollout-1692/1720/after-org-switch.png')});
}catch(e){evidence.failure=e.message;throw e;}
finally{if(lock){await lock.query('rollback');lock.release();}await writeFile(join(repo,'docs/design/rollout-1692/1720/scope.json'),JSON.stringify(evidence,null,2)+'\n');await browser.close();await pool.end();}
console.log('Observed in-flight organization boundary: '+evidence.checks.length+' checks passed.');
