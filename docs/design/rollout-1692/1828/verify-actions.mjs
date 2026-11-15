// Real browser/server-action transport and PostgreSQL read-back; no outbound notification delivery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]),dir=resolve(process.argv[3]),out=join(root,'docs/design/rollout-1692/1828');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),s=await json('services.json'),auth=await json('dev-auth-private.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of s.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),s.label);
const require=createRequire(join(root,'apps/webapp/package.json')),{Pool}=require('pg'),puppeteer=require('puppeteer-core');
const pool=new Pool({host:r.env.POSTGRES_HOST,port:Number(r.env.POSTGRES_PORT),database:r.env.POSTGRES_DB,user:r.env.POSTGRES_USER,password:r.env.POSTGRES_PASSWORD});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results={classification:'real application actions and read-back; aborted transport and SQL prerequisite/revocation explicitly identified',checks:[],captures:[],roles:[],pageErrors:[]};
const check=(name,value)=>{assert.ok(value,name);results.checks.push({name,passed:true});console.log('Passed: '+name);};
const source=async()=>({head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),pageSha256:createHash('sha256').update(await readFile(join(root,'apps/webapp/src/app/[locale]/onboarding/notifications/page-client.tsx'))).digest('hex')});
const capture=async(page,name)=>{await page.evaluate(()=>document.fonts.ready);const filename=`state-${name}.png`;await page.screenshot({path:join(out,filename),fullPage:true});const png=await readFile(join(out,filename));results.captures.push({filename,source:await source(),dimensions:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},...await page.evaluate(()=>({cssWidth:innerWidth,cssHeight:innerHeight,documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,theme:document.documentElement.className}))});};
const button=async(page,text)=>{const h=await page.waitForFunction(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text),{},text);return h.asElement();};
const click=async(page,text)=>{const b=await button(page,text);await b.scrollIntoView();await b.click();};
try{
 for(const role of ['small-admin','small-employee']){
  const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[f.actors[role].email])).rows[0].id;
  const rows=async()=>(await pool.query('SELECT notification_type::text,channel::text,enabled FROM notification_preference WHERE user_id=$1 ORDER BY notification_type::text,channel::text',[person])).rows;
  // Fixture prerequisite only, not an application onboarding operation.
  await pool.query('UPDATE user_settings SET onboarding_step=\'notifications\',onboarding_complete=false WHERE user_id=$1',[person]);
  const context=await browser.createBrowserContext();await context.setCookie(...auth[role].cookies);await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});
  const page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>results.pageErrors.push(e.message));await page.setViewport({width:1600,height:1000});
  const goto=async()=>{await page.goto(r.origin+'/en/onboarding/notifications',{waitUntil:'networkidle0'});await page.waitForSelector('#notification-enable-email');};
  await goto();check(role+' sees account preferences with denied browser context',await page.evaluate(()=>document.body.innerText.includes('Permission blocked')));
  for(const id of ['notification-enable-email','notification-approvals','notification-team-changes'])await page.click('#'+id);
  if(role==='small-admin'){
   await page.setRequestInterception(true);let held,seen;const arrived=new Promise(done=>seen=done);let actions=0;
   const intercept=req=>{if(req.method()==='POST'&&req.headers()['next-action']){held=req;actions++;seen();}else void req.continue();};page.on('request',intercept);
   await click(page,'Save preferences and continue');await arrived;
   await page.evaluate(()=>{for(let i=0;i<3;i++)for(const b of document.querySelectorAll('button'))if(/Save preferences|Skip for now|Request permission/.test(b.textContent))b.click();});
   check('held real action suppresses repeat save/skip/push and preserves draft',actions===1&&await page.$eval('#notification-enable-email',el=>el.disabled&&el.getAttribute('aria-checked')==='false'));await capture(page,'save-pending');
   await held.abort('failed');page.off('request',intercept);await page.setRequestInterception(false);await page.waitForSelector('[role="alert"]');
   check('aborted real transport gives inline retry without resetting preferences',await page.$eval('#notification-approvals',el=>el.getAttribute('aria-checked')==='false'));await capture(page,'save-transport-refused');
  }
  await click(page,'Save preferences and continue');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/complete'));
  const saved=await rows();check(role+' saves all fifteen actual preference rows',saved.length===15&&saved.filter(row=>row.enabled).length===2&&saved.filter(row=>row.enabled).every(row=>row.channel==='in_app'&&['approval_request_approved','approval_request_rejected'].includes(row.notification_type)));
  check(role+' save does not change browser permission',await page.evaluate(()=>Notification.permission)==='denied');
  const devices=await pool.query('SELECT count(*)::int AS n FROM push_subscription WHERE user_id=$1',[person]);check(role+' save does not enroll a push device',devices.rows[0].n===0);
  await goto();await click(page,'Skip for now');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/complete'));check(role+' skip reaches same destination and retains stored preferences',JSON.stringify(await rows())===JSON.stringify(saved));
  results.roles.push({role,storedPreferences:saved});
  if(role==='small-admin'){
   await context.setPermission(r.origin,{permission:{name:'notifications'},state:'prompt'});await goto();check('actual default browser permission is shown without claiming delivery',await page.evaluate(()=>Notification.permission==='default'&&document.body.innerText.includes('Permission not granted')));await capture(page,'default-browser-permission');
   await click(page,'Request permission');
   // A real headless Chromium prompt may refuse or remain unresolved; never synthesize granted.
   try{await page.waitForFunction(()=>![...document.querySelectorAll('p')].some(p=>p.textContent==='Waiting for browser permission…'),{timeout:5000});}catch{}
   const actual=await page.evaluate(()=>({permission:Notification.permission,feedback:[...document.querySelectorAll('[role="status"],[role="alert"]')].map(el=>el.textContent),pushPreference:document.querySelector('#notification-enable-push').getAttribute('aria-checked')}));results.actualPermissionRequest=actual;
   check('actual permission request never fabricates a grant or push enrollment',actual.permission!=='granted'&&actual.pushPreference==='false');await capture(page,'actual-browser-permission-result');
   // Explicit fixture revocation, then actual production server action rejects the stale session.
   await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});await goto();await page.click('#notification-team-changes');
   await pool.query('DELETE FROM session WHERE user_id=$1',[person]);await click(page,'Save preferences and continue');await page.waitForSelector('[role="alert"]');
   check('actual server refusal after fixture session revocation retains input and stored preferences',await page.$eval('#notification-team-changes',el=>el.getAttribute('aria-checked')==='false')&&JSON.stringify(await rows())===JSON.stringify(saved));await capture(page,'session-refused');
  }
  await context.close();
 }
}catch(error){results.failure=error.message;throw error;}finally{await writeFile(join(out,'actions-runtime.json'),JSON.stringify(results,null,2)+'\n');await browser.close();await pool.end();}
