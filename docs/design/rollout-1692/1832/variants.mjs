// Explicit checkout + newly owned fixture only. Real browser auth, no credential output.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const [repoArg, fixtureArg, phase, runName] = process.argv.slice(2), repo=resolve(repoArg), directory=resolve(fixtureArg);
assert.ok(['variants'].includes(phase));
const json=async n=>JSON.parse(await readFile(join(directory,n),'utf8'));
const runtime=await json('runtime-private.json'), fixture=await json('fixture-private.json'), services=await json('services.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label,'z8-performance-fixture-1450');for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const require=createRequire(join(repo,'package.json')), puppeteer=require('puppeteer-core');
const {Pool}=createRequire(join(repo,'apps/webapp/package.json'))('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
assert.ok(!runName || /^[a-z0-9-]+$/.test(runName));const output=join(repo,'docs/design/rollout-1692/1832',runName||'');await mkdir(output,{recursive:true});
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
const paths=['apps/webapp/src/app/[locale]/onboarding/welcome/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/welcome/actions.ts','apps/webapp/src/app/[locale]/onboarding/welcome/page.tsx','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/components/onboarding/progress-indicator.tsx','apps/webapp/next.config.ts'];
const pin=async()=>({head:git('rev-parse','HEAD'),localAI:git('rev-parse','ai/1692-app-wide-ui-refresh'),files:Object.fromEntries(await Promise.all(paths.map(async p=>[p,{blob:git('hash-object','--path',p,p),sha256:createHash('sha256').update(await readFile(join(repo,p))).digest('hex')}])))});
const result={phase,source:await pin(),checks:[],captures:[],errors:[],failed:[],qualification:'Default committed Next config, workspace-local offline copy dependencies; consumer-only historical comparison'};
const check=(name,value)=>{assert.ok(value,name);result.checks.push(name);console.log('Passed: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>result.errors.push(e.message));
const capture=async name=>{await page.evaluate(()=>document.fonts.ready);const file=`${phase}-${name}.png`;await page.screenshot({path:join(output,file),fullPage:true});const png=await readFile(join(output,file));result.captures.push({file,source:await pin(),png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},...await page.evaluate(()=>({url:location.pathname,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,headingFont:getComputedStyle(document.querySelector('h1')).fontFamily,theme:localStorage.getItem('theme'),fontPreference:localStorage.getItem('z8-font-size'),scale:visualViewport.scale,dpr:devicePixelRatio}))});};
const click=async text=>{const h=await page.waitForFunction(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text&&!b.disabled),{},text);await h.asElement().click();};
const welcome=async()=>{await page.goto(runtime.origin+'/en/onboarding/welcome',{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.innerText.includes('Welcome to Z8!'));await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>['Continue Setup','Get Started'].includes(b.textContent.trim())&&!b.disabled));};
const signIn=async actor=>{await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'networkidle0'});const status=await page.evaluate(async ({email,password,organizationId})=>{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email,password})});if(!r.ok)return {signIn:r.status};const a=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId})});return {signIn:r.status,active:a.status};},actor);check('real Better Auth sign-in and organization activation',status.signIn===200&&status.active===200);};
const status=()=>page.evaluate(async()=>{const r=await fetch('/api/user/onboarding-status');return {status:r.status,data:await r.json()};});
try {
 await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'networkidle0'});
 const previous=await json('welcome-new-account-private.json').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 const actor=previous||{email:`r037-${randomBytes(9).toString('hex')}@example.test`,password:randomBytes(24).toString('base64url')+'aA9!'};
 if(!previous){
 const signup=await page.evaluate(async actor=>{const r=await fetch('/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({...actor,name:'R037 Synthetic',firstName:'R037',lastName:'Synthetic'})});return r.status;},actor);
 check('new distinct synthetic account through real Better Auth signup',signup===200);
 const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
 // Only fixture admission prerequisites. These writes are not business UI success or email delivery.
 await pool.query('UPDATE "user" SET email_verified=true WHERE id=$1',[person]);
 await pool.query("INSERT INTO user_settings(id,user_id,onboarding_complete,onboarding_step,updated_at) VALUES($1,$2,false,'welcome',now()) ON CONFLICT(user_id) DO UPDATE SET onboarding_complete=false,onboarding_step='welcome'",[randomUUID(),person]);
 await writeFile(join(directory,'welcome-new-account-private.json'),JSON.stringify({...actor,userId:person}),{mode:0o600});
 }
 const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
 result.reusedSyntheticAccount=!!previous;
 const login=async()=>{const code=await page.evaluate(async actor=>{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify(actor)});return r.status;},actor);check('real new-account sign-in',code===200);};
 await login();await welcome();
 check('no membership was invented',(await pool.query('SELECT count(*)::int AS count FROM member WHERE user_id=$1',[person])).rows[0].count===0);
 check('actual no-org summary offers Get Started',await page.evaluate(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Get Started'&&!b.disabled)&&!document.body.innerText.includes("You've joined")));
 await page.setViewport({width:390,height:844});await capture('no-organization');
 await click('Font size');await page.waitForSelector('[role="menuitemradio"]');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.waitForFunction(()=>localStorage.getItem('z8-font-size')==='large'&&getComputedStyle(document.documentElement).fontSize==='18px');await page.keyboard.press('Escape');
 check('keyboard font preference saves actual Large',await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize==='18px'));
 await welcome();check('font preference survives reload',await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize==='18px'));await capture('no-org-large');
 await click('Toggle theme');await page.waitForSelector('[role="menuitem"]');await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await page.waitForFunction(()=>localStorage.getItem('theme')==='dark'&&document.documentElement.classList.contains('dark'));await page.keyboard.press('Escape');
 await welcome();check('real theme selection persists with Large text',await page.evaluate(()=>localStorage.getItem('theme')==='dark'&&document.documentElement.classList.contains('dark')&&getComputedStyle(document.documentElement).fontSize==='18px'));await capture('no-org-dark-large');
 await page.click('[role="combobox"]');const german=await page.waitForFunction(()=>[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()==='Deutsch'));await german.asElement().click();await page.waitForFunction(()=>location.pathname.startsWith('/de/')&&document.querySelector('h1')?.textContent.includes('Willkommen')&&!!document.querySelector('main section button:not([disabled])'));
 check('real German language selection keeps phone layout and preferences',await page.evaluate(()=>document.documentElement.scrollWidth===390&&getComputedStyle(document.documentElement).fontSize==='18px'&&localStorage.getItem('theme')==='dark'));await capture('german-phone-large');
 await welcome();
 let held,arrived;await page.setRequestInterception(true);const intercept=request=>{if(request.headers()['next-action']){held=request;arrived?.();}else void request.continue();};page.on('request',intercept);
 const pending=new Promise(done=>arrived=done);await click('Get Started');await pending;
 const authPage=await context.newPage();await authPage.goto(runtime.origin+'/en/sign-in',{waitUntil:'domcontentloaded'});
 const signedOut=await authPage.evaluate(async()=>{const r=await fetch('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});return r.status;});check('real sign-out revokes the pending actor session',signedOut===200);await authPage.close();
 page.off('request',intercept);await held.continue();await page.setRequestInterception(false);
 await page.waitForFunction(()=>!!document.querySelector('[role="alert"]'));
 check('actual unauthenticated step update is refused',(await status()).status===401);
 check('refusal never reaches workspace',new URL(page.url()).pathname.endsWith('/onboarding/welcome'));await capture('session-refusal');
 await login();await welcome();await click('Get Started');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/organization'));
 check('real no-org continuation preserves organization routing',(await status()).data.onboardingStep==='organization');
 check('PG confirms durable organization step',(await pool.query('SELECT onboarding_step FROM user_settings WHERE user_id=$1',[person])).rows[0].onboarding_step==='organization');
}catch(error){result.failed.push(error.message);throw error;}
finally{await writeFile(join(output,'variants-runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
