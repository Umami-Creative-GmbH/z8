import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const repo=process.cwd(),dir=resolve(process.argv[2]),require=createRequire(join(repo,'package.json')),appRequire=createRequire(join(repo,'apps/webapp/package.json'));
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'))),f=JSON.parse(await readFile(join(dir,'fixture-private.json'))),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json')));
assert.equal(f.kind,'disposable');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');
const {Pool}=appRequire('pg'),pool=new Pool({host:r.env.POSTGRES_HOST,port:Number(r.env.POSTGRES_PORT),user:r.env.POSTGRES_USER,password:r.env.POSTGRES_PASSWORD,database:r.env.POSTGRES_DB});
const browser=await require('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={observations:[]};let revoked,activePage;
try{
 for(const variant of ['authority','account']){
 const label=variant==='authority'?'small-manager':'small-employee';const c=await browser.createBrowserContext();await c.overridePermissions(r.origin,[]);await c.setCookie(...auth[label].cookies);const page=await c.newPage();await page.goto(new URL('/en/notifications',r.origin).href,{waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="Select Security update"]');
 activePage=page;const owned=await page.evaluate(async()=>{const v=await(await fetch('/api/notifications')).json();return v.notifications.find(n=>n.title==='Security update');});assert.equal(owned.isRead,false);
 await page.setRequestInterception(true);let captured;const held=new Promise(resolve=>{page.on('request',request=>{if(request.method()==='PATCH'&&new URL(request.url()).pathname==='/api/notifications'){captured=request;resolve();}else request.continue();});});
 const response=page.waitForResponse(v=>new URL(v.url()).pathname==='/api/notifications'&&v.request().method()==='PATCH');
 await page.$eval('[aria-label="Select Security update"]',n=>n.closest('li').querySelector('[aria-label="Mark as read"]').click());await held;
 if(variant==='authority'){
 revoked=f.actors[label];const update=await pool.query('update employee set is_active=false where id=$1 and organization_id=$2 returning id',[revoked.employeeId,revoked.organizationId]);assert.equal(update.rows.length,1);await captured.continue();
 }else{
 // The shared cookie jar changes while the old UI's scoped command is held.
 // Override only its actual Cookie header; expected recipient/org headers remain old.
 await c.setCookie(...auth['small-restricted'].cookies);const cookie=auth['small-restricted'].cookies.map(n=>`${n.name}=${n.value}`).join('; ');await captured.continue({headers:{...captured.headers(),cookie}});
 }
 const status=(await response).status();if(variant==='authority')assert.ok([400,401,403].includes(status));else assert.equal(status,409);report.observations.push({variant,refusal:status});
 if(revoked){await pool.query('update employee set is_active=true where id=$1 and organization_id=$2',[revoked.employeeId,revoked.organizationId]);revoked=undefined;
 // Deactivation legitimately revokes the old session. Recover through real login,
 // not session minting; retain the other synthetic actor cookie files privately.
 execFileSync(process.env.npm_execpath,['node',join(repo,'.tmp/1723-private/runtime-helper.mjs'),'auth',repo,dir,label],{stdio:'pipe'});
 Object.assign(auth,JSON.parse(await readFile(join(dir,'dev-auth-private.json'))));await writeFile(join(dir,'dev-auth-private.json'),JSON.stringify(auth),{mode:0o600});
 }
 page.removeAllListeners('request');await page.setRequestInterception(false);await c.setCookie(...auth[label].cookies);await page.reload({waitUntil:'networkidle0'});const after=await page.evaluate(async id=>(await(await fetch('/api/notifications')).json()).notifications.find(n=>n.id===id),owned.id);assert.equal(after.isRead,false);
 const checkbox=await page.$('[aria-label="Select Security update"]');await checkbox.focus();await page.keyboard.press('Space');assert.equal(await checkbox.evaluate(n=>n.getAttribute('aria-checked')),'true');await page.keyboard.press('Space');
 report.observations.push({variant,status,unchangedReadState:true,roundTripRecovered:true,keyboardSelection:true});await c.close();
 }
}catch(e){report.failure=e.message;report.dom=await activePage?.evaluate(()=>document.body.innerText).catch(()=>null);throw e;}finally{if(revoked)await pool.query('update employee set is_active=true where id=$1 and organization_id=$2',[revoked.employeeId,revoked.organizationId]);await pool.end();await browser.close();await writeFile(join(repo,'docs/design/rollout-1692/1723/authority.json'),JSON.stringify(report,null,2)+'\n');}
console.log('Held authority/account commands refused; original recipient readback unchanged.');
