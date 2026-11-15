// pnpm node docs/design/rollout-1692/1826/verify-actions.mjs <owned-private-fixture>
// Real local application/auth endpoints. No external identity provider, mail, SMS or minted session.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=resolve(process.argv[2]), output=resolve('docs/design/rollout-1692/1826');
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const container of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const require=createRequire(resolve('apps/webapp/package.json')), {Pool}=require('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const actor=fixture.actors['small-admin'], memberActor=fixture.actors['small-employee'];
let currentLabel='small-admin';
const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
const memberPerson=(await pool.query('SELECT id FROM "user" WHERE email=$1',[memberActor.email])).rows[0].id;
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);
await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
const page=await context.newPage();page.setDefaultTimeout(30000);
const results={classification:'actual local auth requests and authoritative HTTP read-back; held/aborted transport explicitly classified',checks:[],captures:[],pageErrors:[]};
page.on('pageerror',e=>results.pageErrors.push(e.message));
const check=(name,value)=>{assert.ok(value,name);results.checks.push({name,passed:true});console.log('Passed: '+name);};
const post=async(path,body)=>page.evaluate(async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},path,body);
const access=async()=>page.evaluate(async org=>(await fetch('/api/auth/organization/get-full-organization?organizationId='+org)).status,actor.organizationId);
const goto=async()=>{await page.goto(`${runtime.origin}/en/mfa?organizationId=${actor.organizationId}&callbackUrl=%2Fen%2Fsettings%2Fsecurity`,{waitUntil:'networkidle0'});await page.waitForSelector('input[name="code"]');};
const find=async(selector,name)=>(await page.waitForFunction((selector,name)=>[...document.querySelectorAll(selector)].find(el=>el.textContent.trim()===name&&el.getBoundingClientRect().width>0),{},selector,name)).asElement();
const click=async(name,selector='button')=>{
 const el=await find(selector,name);await el.scrollIntoView();
 await page.waitForFunction(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);const surface=el.closest('[role="dialog"],[role="alertdialog"]');const moving=surface?.getAnimations({subtree:true}).some(animation=>animation.playState==='running');return !moving&&!el.disabled&&hit&&(hit===el||el.contains(hit));},{},el);
 await el.click();
};
const capture=async(name)=>{
 const current=await json('dev-auth-private.json');current[currentLabel].cookies=await context.cookies();await writeFile(join(directory,'dev-auth-private.json'),JSON.stringify(current),{mode:0o600});
 await page.evaluate(()=>document.fonts.ready); const filename=`state-${name}.png`;await page.screenshot({path:join(output,filename),fullPage:true});const png=await readFile(join(output,filename));
 const files=['apps/webapp/src/app/[locale]/mfa/page.tsx','apps/webapp/src/components/organization-mfa/requirements.tsx','apps/webapp/src/components/organization-mfa/verification.tsx','apps/webapp/src/components/organization-mfa/sign-out.tsx'];
 results.captures.push({filename,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirtyDiffSha256:createHash('sha256').update(execFileSync('git',['diff','--binary','HEAD'],{maxBuffer:40*1024*1024,stdio:['ignore','pipe','ignore']})).digest('hex'),files:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),pngDimensions:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},...await page.evaluate(()=>({cssViewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,inputFont:getComputedStyle(document.querySelector('input')).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,fontsStatus:document.fonts.status}))});
};
const otp=uri=>{const secret=new URL(uri).searchParams.get('secret');let bits='';for(const c of secret.toUpperCase().replace(/=+$/,''))bits+='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5,'0');const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',Buffer.from(bytes)).update(counter).digest();return ((h.readUInt32BE(h[19]&15)&0x7fffffff)%1000000).toString().padStart(6,'0');};
try {
 await pool.query('UPDATE organization_mfa_window SET deadline=starts_at,grace_period_days=0 WHERE organization_id=$1 AND user_id=$2',[actor.organizationId,person]);
 await page.setViewport({width:1600,height:1000});await goto();
 // A prior interrupted run can leave this synthetic account enrolled; use the real allowed revoke endpoint.
 await post('/api/auth/two-factor/disable',{password:actor.password});await goto();
 check('enforced owner password-only session is denied, without admin bypass',await access()===403);
 await click('Verify authenticator');await page.waitForSelector('input[name="code"][aria-invalid="true"]');
 check('native invalid submit focuses authenticator and associates error',await page.$eval('input[name="code"]',el=>document.activeElement===el&&el.getAttribute('aria-describedby').includes('message')));
 await page.type('input[name="code"]','000000');await page.keyboard.press('Enter');await page.waitForSelector('[role="alert"]');
 check('actual invalid authenticator refuses without erasing input',await page.$eval('input[name="code"]',el=>el.value==='000000'));
 await capture('verification-refused');
 let held, release; const seen=new Promise(done=>release=done);let requests=0;
 await page.setRequestInterception(true);const hold=request=>{if(request.url().includes('/two-factor/verify-totp')){requests++;held=request;release();}else void request.continue();};page.on('request',hold);
 await click('Verify authenticator');await seen;
 check('held actual verification disables duplicate and continuation',await page.$eval('input[name="code"]',el=>el.disabled)&&await page.$$eval('button',els=>els.find(el=>el.textContent.trim()==='Continue after verification').disabled));
 await page.$eval('input[name="code"]',el=>el.closest('form').requestSubmit());check('native re-entry sends one transport request',requests===1);await capture('verification-pending');
 await held.abort('failed');page.off('request',hold);await page.setRequestInterception(false);await page.waitForSelector('[role="alert"]');
 check('aborted real transport is retryable with retained code',await page.$eval('input[name="code"]',el=>!el.disabled&&el.value==='000000'));
 await click('Verify an existing sign-in','summary');await page.type('input[name="password"]',actor.password);await page.focus('input[name="password"]');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(el=>el.textContent.includes('Password verified.')));
 check('real password verification clears password but grants no organization access',await page.$eval('input[name="password"]',el=>el.value==='')&&await access()===403);
 let enrollment;const receive=async response=>{if(response.url().endsWith('/two-factor/enable')&&response.ok())enrollment=await response.json();};page.on('response',receive);
 await click('Enable Two-Factor Authentication');await page.waitForSelector('#enable-2fa-password');await page.type('#enable-2fa-password',actor.password);await click('Continue');
 await page.waitForFunction(()=>!!document.querySelector('[data-input-otp]'));assert.ok(enrollment?.totpURI);assert.ok(enrollment.backupCodes?.length);page.off('response',receive);
 check('real enrollment alone does not establish session proof',await access()===403);
 await page.type('[data-input-otp]',otp(enrollment.totpURI));await click('Verify and Enable');const saved=await find('button',"I've Saved These Codes");await saved.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>![...document.querySelectorAll('[role="dialog"]')].some(el=>el.checkVisibility()&&!el.hasAttribute('inert'))).catch(async error=>{console.log(await page.$$eval('[role="dialog"]',els=>els.map(el=>({title:document.getElementById(el.getAttribute('aria-labelledby'))?.textContent,state:el.getAttribute('data-open'),closed:el.getAttribute('data-closed'),display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility,inert:el.inert,y:el.getBoundingClientRect().y}))));throw error;});
 check('verified enrollment read-back admits selected organization',await access()===200);
 await page.reload({waitUntil:'networkidle0'});check('reload reads saved enabled factor and management controls',await page.evaluate(()=>document.body.innerText.includes('Regenerate Backup Codes')&&document.body.innerText.includes('Disable')));
 await capture('enrolled-readback');
 await click('Verify an existing sign-in','summary');await page.type('input[name="password"]',actor.password);await page.focus('input[name="password"]');await page.keyboard.press('Enter');await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(el=>el.textContent.includes('Password verified.')));
 await click('Recover with a backup code','summary');await page.type('input[name="backupCode"]',enrollment.backupCodes[0]);await page.focus('input[name="backupCode"]');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.body.innerText.includes('Recovery permits replacement enrollment only.'));
 check('real backup recovery clears field, stays on MFA, and revokes organization proof',await page.$eval('input[name="backupCode"]',el=>el.value==='')&&new URL(page.url()).pathname==='/en/mfa'&&await access()===403);await capture('recovery-only');
 await page.type('input[name="code"]',otp(enrollment.totpURI));await page.focus('input[name="code"]');await page.keyboard.press('Enter');await page.waitForSelector('[role="alert"]');check('recovery still requires renewed primary verification before authenticator proof',await access()===403);
 await page.type('input[name="password"]',actor.password);await page.focus('input[name="password"]');await page.keyboard.press('Enter');await page.waitForFunction(()=>[...document.querySelectorAll('[role="status"]')].some(el=>el.textContent.includes('Password verified.')));
 await page.focus('input[name="code"]');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');
 await page.type('input[name="code"]',otp(enrollment.totpURI));await page.focus('input[name="code"]');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>location.pathname==='/en/settings/security', {timeout:60000});
 check('actual authenticator verifies and sanitized callback reaches selected organization',await access()===200);
 await goto();await click('Disable');await page.waitForSelector('#disable-2fa-password');await page.type('#disable-2fa-password',actor.password);await click('Disable 2FA');await page.waitForFunction(()=>![...document.querySelectorAll('[role="alertdialog"]')].some(el=>el.checkVisibility()));
 check('actual last-factor revocation immediately denies protected owner access',await access()===403);await capture('last-factor-revoked');
 // Durable fixture window changes are explicitly seeded test states, never application policy changes.
 await pool.query('UPDATE organization_mfa_window SET deadline=now()+interval \'1 day\',grace_period_days=7 WHERE organization_id=$1 AND user_id=$2',[actor.organizationId,person]);await goto();
 check('same authoritative requirement renders grace and permits its enrollment window',await page.evaluate(()=>document.body.innerText.includes('Enrollment window in progress.'))&&await access()===200);await capture('grace-window');
 await pool.query('UPDATE organization_mfa_window SET deadline=now()-interval \'1 day\',grace_period_days=0 WHERE organization_id=$1 AND user_id=$2',[actor.organizationId,person]);
 await goto();const orgLink=await find('a','Select another organization');const orgHref=await orgLink.evaluate(el=>el.getAttribute('href'));let arrived;const requestedInit=new Promise(done=>arrived=done);const destinations=[];const noteNavigation=request=>{const path=new URL(request.url()).pathname;destinations.push(path);if(path.endsWith('/init'))arrived();};page.on('request',noteNavigation);await orgLink.focus();await page.keyboard.press('Enter');await Promise.race([requestedInit,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No init request observed')),15000))]);page.off('request',noteNavigation);check('organization selection escape requests its real init destination',orgHref==='/init'&&destinations.some(path=>path.endsWith('/init')));
 // Real member actor; revoke membership after mounting to exercise the existing admission owner.
 const cookies=await context.cookies();auth['small-admin'].cookies=cookies;await writeFile(join(directory,'dev-auth-private.json'),JSON.stringify(auth),{mode:0o600});await context.deleteCookie(...cookies);await context.setCookie(...auth['small-employee'].cookies);currentLabel='small-employee';await goto();check('employee receives the same scoped MFA task without admin controls',await page.evaluate(()=>document.querySelectorAll('h1').length===1&&document.body.innerText.includes('Performance small')));
 await pool.query('UPDATE member SET status=\'pending\' WHERE organization_id=$1 AND user_id=$2',[memberActor.organizationId,memberPerson]);
 const denied=await page.evaluate(async org=>(await fetch('/api/auth/organization/get-full-organization?organizationId='+org)).status,memberActor.organizationId);check('late membership loss refuses protected organization read',denied>=400);
 await pool.query('UPDATE member SET status=\'approved\' WHERE organization_id=$1 AND user_id=$2',[memberActor.organizationId,memberPerson]);
 await click('Sign out');await page.waitForFunction(()=>location.pathname.endsWith('/sign-in'));check('real sign-out clears session and reaches sign-in',await page.evaluate(async()=>{const r=await fetch('/api/auth/get-session');return (await r.json())===null;}));
} finally {
 const cookies=await context.cookies();const current=await json('dev-auth-private.json');current[currentLabel].cookies=cookies;await writeFile(join(directory,'dev-auth-private.json'),JSON.stringify(current),{mode:0o600});
 await pool.query('UPDATE member SET status=\'approved\' WHERE organization_id=$1 AND user_id=$2',[memberActor.organizationId,memberPerson]);
 await writeFile(join(output,'actions-runtime.json'),JSON.stringify(results,null,2));await browser.close();await pool.end();
}
