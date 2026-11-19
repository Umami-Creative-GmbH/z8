// pnpm node docs/design/rollout-1692/1826/verify-scope.mjs <owned-private-fixture>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=resolve(process.argv[2]);const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const {Pool}=createRequire(resolve('apps/webapp/package.json'))('pg');const pool=new Pool({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
const actor=fixture.actors['small-admin'];const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
const other=(await pool.query('SELECT id,name FROM organization WHERE id<>$1 ORDER BY id LIMIT 1',[actor.organizationId])).rows[0];
await pool.query("INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES('r027-other-membership',$1,$2,'member','approved',now()) ON CONFLICT(id) DO NOTHING",[person,other.id]);
await pool.query('INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES($1,true,0,$2) ON CONFLICT(organization_id) DO NOTHING',[other.id,person]);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();page.setDefaultTimeout(20000);
const results=[];const check=(name,value)=>{assert.ok(value,name);results.push({name,passed:true});console.log('Passed: '+name);};
try {
 await page.goto(`${runtime.origin}/en/mfa?organizationId=${actor.organizationId}&callbackUrl=%2Fen%2Fcalendar`,{waitUntil:'networkidle0'});await page.waitForSelector('input[name="code"]');await page.type('input[name="code"]','000000');
 let held,seen;const pending=new Promise(done=>seen=done);await page.setRequestInterception(true);const hold=request=>{if(request.url().includes('/two-factor/verify-totp')){held=request;seen();}else void request.continue();};page.on('request',hold);
 const verify=(await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Verify authenticator'))).asElement();await verify.click();await pending;
 const link=(await page.waitForFunction(name=>[...document.querySelectorAll('a')].find(el=>el.textContent===name),{},other.name)).asElement();await link.focus();await page.keyboard.press('Enter');await page.waitForFunction(id=>new URL(location.href).searchParams.get('organizationId')===id,{},other.id);await page.waitForSelector('input[name="code"]:not(:disabled)');
 check('organization change discards old credential draft and names the new selected scope',await page.$eval('input[name="code"]',el=>el.value==='')&&await page.$eval('[aria-current="true"]',(el,name)=>el.textContent===name,other.name));
 const response=page.waitForResponse(response=>response.url().includes('/two-factor/verify-totp'));await held.continue();await response;page.off('request',hold);await page.setRequestInterception(false);await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
 check('late previous-scope completion cannot redirect or restore its draft',new URL(page.url()).searchParams.get('organizationId')===other.id&&await page.$eval('input[name="code"]',el=>el.value===''));
 check('organization switch retains callback for downstream guarded activation',new URL(page.url()).searchParams.get('callbackUrl')==='/en/calendar');
 // Change actual account cookies, then request a fresh route: no old-account draft survives server identity.
 await page.type('input[name="code"]','111111');const cookies=await context.cookies();await context.deleteCookie(...cookies);await context.setCookie(...auth['small-restricted'].cookies);await page.goto(`${runtime.origin}/en/mfa?organizationId=${actor.organizationId}`,{waitUntil:'networkidle0'});await page.waitForSelector('input[name="code"]');
 check('fresh different-account response discards the previous account draft',await page.$eval('input[name="code"]',el=>el.value===''));
 const denied=await page.evaluate(async id=>(await fetch('/api/auth/organization/get-full-organization?organizationId='+id)).status,other.id);check('changed account cannot read the former account-only organization',denied>=400);
} finally {await writeFile(resolve('docs/design/rollout-1692/1826/scope-runtime.json'),JSON.stringify({classification:'real fixture memberships, actual client navigation, held actual transport and authoritative auth refusal',checks:results},null,2));await browser.close();await pool.query("DELETE FROM member WHERE id='r027-other-membership'");await pool.end();}
