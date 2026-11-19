// Owned disposable fixture only. Never publish private manifests, cookies or reset URLs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
const [mode, dir] = process.argv.slice(2), repo = process.cwd();
assert.ok(['before','after','combined'].includes(mode));
const json = async name => JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime = await json('runtime-private.json'), fixture = await json('fixture-private.json'), services = await json('services.json');
assert.equal(fixture.kind,'disposable'); assert.equal(new URL(runtime.origin).hostname,'localhost');
assert.equal(runtime.env.PLATFORM_DOMAIN,'localhost');
assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label,'z8-performance-fixture-1450');
for (const container of services.containers) {
 assert.match(container,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);
 assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container],{encoding:'utf8',windowsHide:true}).trim(),services.label);
}
const git = (...args) => execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const source = {head:git('rev-parse','HEAD'), branch:git('branch','--show-current'), dirty:git('status','--porcelain','--untracked-files=no'), files:{}};
for (const file of ['apps/webapp/src/components/forgot-password-form.tsx','apps/webapp/src/components/auth-form-wrapper.tsx']) source.files[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const out = join(repo,'docs/design/rollout-1692/1821'); await mkdir(out,{recursive:true});
const {Client} = createRequire(join(repo,'apps/webapp/package.json'))('pg');
const db = new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL}); await db.connect();
const orgId = fixture.actors['small-admin'].organizationId;
const {rows:[org]} = await db.query('select slug from organization where id=$1',[orgId]);
await db.query('insert into organization_branding (organization_id,app_name,primary_color,updated_at) values ($1,$2,$3,now()) on conflict (organization_id) do update set app_name=excluded.app_name,primary_color=excluded.primary_color,updated_at=now()',[orgId,'Performance small','#2563eb']);
const brandedOrigin = `http://${org.slug}.localhost:${runtime.port}`;
const browser = await createRequire(join(repo,'package.json'))('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--host-resolver-rules=MAP *.localhost [::1]']});
const result={source,fixture:'owned synthetic performance small, signed out, local dev public dummy CAPTCHA',captures:[],actions:[],errors:[]};
let page;
const snapshot = async label => {
 const state = await page.evaluate(()=>({heading:[...document.querySelectorAll('h1')].map(x=>x.textContent),text:document.querySelector('main')?.innerText,links:[...document.querySelectorAll('main a')].map(x=>({name:x.textContent,href:x.getAttribute('href')})),email:document.querySelector('input[type=email]')?.value,invalid:document.querySelector('input[type=email]')?.getAttribute('aria-invalid'),busy:document.querySelector('form')?.getAttribute('aria-busy'),width:innerWidth,documentWidth:document.documentElement.scrollWidth,fontSize:getComputedStyle(document.documentElement).fontSize,brand:document.querySelector('main [style]')?.style.getPropertyValue('--primary')}));
 assert.equal(state.heading.length,1); assert.equal(state.width,state.documentWidth);
 await page.screenshot({path:join(out,`${mode}-${label}.png`),fullPage:true}); result.captures.push({label,...state}); return state;
};
const open = async (origin=runtime.origin, locale='en') => {
 await page.goto(`${origin}/${locale}/forgot-password`,{waitUntil:'networkidle0',timeout:90000});
 await page.waitForSelector('input[type=email]');
 await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled,{timeout:30000});
};
try {
 for (const [label,width,height,dark,large,branded] of [
  ['desktop-light',1600,1000,false,false,false],['phone-light',390,844,false,false,false],
  ['wide-dark',2400,1200,true,false,false],['phone-dark-large',390,844,true,true,false],
  ['branded-desktop',1600,1000,false,false,true],['branded-phone',390,844,false,false,true]]) {
  const context=await browser.createBrowserContext(); page=await context.newPage();
  page.on('pageerror',e=>result.errors.push(e.message));
  await page.setViewport({width,height}); await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await open(branded?brandedOrigin:runtime.origin);
  if(large) await page.evaluate(()=>document.documentElement.style.fontSize='24px');
  const captured=await snapshot(label);
  if(branded && mode!=='before') { assert.ok(captured.text.includes('Performance small')); assert.equal(captured.brand,'#2563eb'); }
  await context.close();
 }
 if(mode!=='before') {
  const context=await browser.createBrowserContext(); page=await context.newPage(); await page.setViewport({width:390,height:844});
  page.on('pageerror',e=>result.errors.push(e.message)); await open();
  await page.locator('::-p-aria(Font size)').click(); await page.locator('::-p-aria(Large)').click();
  await page.waitForFunction(()=>document.documentElement.dataset.fontSize==='large');
  await page.locator('::-p-aria(Toggle theme)').click(); await page.locator('::-p-aria(Dark)').click();
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
  await page.reload({waitUntil:'networkidle0'});
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.fontSize),'large');
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),true);
  await snapshot('saved-preferences');
  await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  // Focus via Tab, then inspect the actual visible focus treatment.
  await page.focus('input[type=email]'); await page.keyboard.press('Tab');
  const keyboard=await page.evaluate(()=>({name:document.activeElement?.textContent?.trim(),shadow:getComputedStyle(document.activeElement).boxShadow}));
  assert.equal(keyboard.name,'Send reset link'); assert.notEqual(keyboard.shadow,'none');
  await snapshot('keyboard-focus'); result.actions.push({label:'saved-font-theme-keyboard',reloaded:true,fontSize:'large',theme:'dark',keyboard});
  await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  const email=await page.$('input[type=email]'); await email.type('invalid');
  await page.keyboard.press('Enter'); await page.waitForFunction(()=>document.querySelector('input')?.getAttribute('aria-invalid')==='true');
  assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('name')),'email'); await snapshot('validation');
  await email.focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await email.type('unknown-reset@example.test');
  let held, count=0, abortNext=true;
  await page.setRequestInterception(true);
  page.on('request',request=>{if(request.url().endsWith('/api/auth/request-password-reset')){count++; if(abortNext){held=request;}else request.continue();}else request.continue();});
  await page.locator('::-p-aria(Send reset link)').click();
  await page.waitForFunction(()=>document.querySelector('form')?.getAttribute('aria-busy')==='true');
  await snapshot('pending'); await page.$eval('form',form=>{form.requestSubmit();form.requestSubmit();});
  assert.equal(count,1); assert.ok(held); await held.abort('internetdisconnected');
  await page.waitForSelector('main [role=alert]'); assert.equal(await page.$eval('input[type=email]',x=>x.value),'unknown-reset@example.test');
  await snapshot('transport-failure'); abortNext=false;
  await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled,{timeout:30000});
  const responseWait=page.waitForResponse(r=>r.url().endsWith('/api/auth/request-password-reset'));
  await page.locator('::-p-aria(Send reset link)').click(); const response=await responseWait;
  assert.equal(response.status(),200); const neutral=await response.json();
  await page.waitForFunction(()=>document.querySelector('main [role=status]')?.textContent.includes('If an account exists'));
  assert.equal(await page.$('input[type=email]'),null); await snapshot('unknown-neutral');
  result.actions.push({label:'transport-failure-retry-unknown',pendingDuplicates:count===2,retainedEmail:true,requestStatus:response.status(),neutral});
  const link=await page.locator('::-p-aria(Back to login)'); await link.click(); await page.waitForFunction(()=>location.pathname==='/en/sign-in');
  result.actions.push({label:'return-link',destination:'/en/sign-in',actualNavigation:true});
  const tokenCount = async () => (await db.query('select count(*)::int as count from verification where identifier like $1 and value=(select id from "user" where email=$2)',['reset-password:%',fixture.actors['small-employee'].email])).rows[0].count;
  const previousTokenCount = await tokenCount();
  await open(runtime.origin,'de'); await page.type('input[type=email]',fixture.actors['small-employee'].email);
  const requests=[]; const observer=request=>{if(request.url().endsWith('/api/auth/request-password-reset')){const body=JSON.parse(request.postData());requests.push({redirectPath:new URL(body.redirectTo).pathname,sameOrigin:new URL(body.redirectTo).origin===runtime.origin,hasCaptcha:!!request.headers()['x-captcha-response']});}};
  page.on('request',observer);
  const knownWait=page.waitForResponse(r=>r.url().endsWith('/api/auth/request-password-reset'));
  await page.$eval('form',form=>form.requestSubmit()); const known=await knownWait; const knownBody=await known.json();
  await page.waitForFunction(()=>!document.querySelector('input[type=email]'));
  assert.equal(known.status(),200); assert.deepEqual(knownBody,neutral); assert.deepEqual(requests,[{redirectPath:'/de/reset-password',sameOrigin:true,hasCaptcha:true}]);
  // Observe actual reset state without exposing identifier/token values.
  const issuedTokenCount = await tokenCount() - previousTokenCount;
  assert.equal(issuedTokenCount,1);
  result.actions.push({label:'known-neutral-de',status:known.status(),sameNeutralResponse:true,request:requests[0],newVerificationCount:issuedTokenCount,delivery:'Console fallback logs HTML length, without a retrievable reset link. No SMTP/Resend fixture transport configured; provider delivery and token-link journey unavailable.'});
  await snapshot('known-neutral-de'); await context.close();
  const failedContext=await browser.createBrowserContext(); page=await failedContext.newPage(); await page.setViewport({width:390,height:844}); await open();
  await page.type('input[type=email]','unknown-policy@example.test'); let invalidate=true;
  await page.setRequestInterception(true);
  page.on('request',request=>{if(invalidate && request.url().endsWith('/api/auth/request-password-reset')) request.continue({headers:{...request.headers(),'x-captcha-response':'x'.repeat(2049)}}); else request.continue();});
  const refusedWait=page.waitForResponse(r=>r.url().endsWith('/api/auth/request-password-reset'));
  await page.locator('::-p-aria(Send reset link)').click(); const refused=await refusedWait;
  assert.equal(refused.status(),400); const refusal=await refused.json(); assert.equal(refusal.code,'TURNSTILE_FAILED'); await page.waitForSelector('main [role=alert]');
  assert.equal(await page.$eval('input[type=email]',x=>x.value),'unknown-policy@example.test'); await snapshot('server-captcha-failure');
  invalidate=false; await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled);
  const retryWait=page.waitForResponse(r=>r.url().endsWith('/api/auth/request-password-reset'));
  await page.locator('::-p-aria(Send reset link)').click(); const retry=await retryWait; assert.equal(retry.status(),200);
  await page.waitForFunction(()=>!document.querySelector('input[type=email]'));
  result.actions.push({label:'actual-server-captcha-refusal-and-widget-retry',refusalStatus:refused.status(),code:refusal.code,retryStatus:retry.status(),retainedEmail:true,method:'Only the negative request header is made invalid; both responses are from the actual server.'});
  await failedContext.close();
 }
} catch(error) {result.failure={name:error.name,message:error.message}; throw error;}
finally {await writeFile(join(out,`${mode}-runtime.json`),JSON.stringify(result,null,2),'utf8');await browser.close();await db.end();}
assert.deepEqual(result.errors,[]); console.log(`Captured ${result.captures.length} ${mode} states, ${result.actions.length} action checks, zero page errors.`);
