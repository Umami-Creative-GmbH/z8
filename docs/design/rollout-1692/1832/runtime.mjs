// Explicit checkout + newly owned fixture only. Real browser auth, no credential output.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
const [repoArg, fixtureArg, phase, runName] = process.argv.slice(2), repo=resolve(repoArg), directory=resolve(fixtureArg);
assert.ok(['before','after'].includes(phase));
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
 await signIn(fixture.actors['small-admin']);
 await welcome();
 for(const[name,width,height,theme,font]of[['desktop-light',1600,1000,'light','default'],['phone-light',390,844,'light','default'],['wide-dark-large',2400,1200,'dark','large'],['phone-dark-large',390,844,'dark','large']]){
  await page.setViewport({width,height});await page.evaluate((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font);},theme,font);await welcome();await capture(name);
  check(name+' fits viewport and saved font',await page.evaluate(width=>document.documentElement.scrollWidth===width&&getComputedStyle(document.documentElement).fontSize===(localStorage.getItem('z8-font-size')==='large'?'18px':'16px'),width));
 }
 if(phase==='after'){
  check('one heading and stored organization context',await page.evaluate(()=>document.querySelectorAll('h1').length===1&&document.body.innerText.includes('Performance small')));
  check('three original capability descriptions',await page.evaluate(()=>['Clock in and out, track work hours, and manage time corrections','Request time off, manage vacation days, and track holidays','Work with your team, approve requests, and manage employees'].every(s=>document.body.innerText.includes(s))));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const action=await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Continue Setup'));const unfocusedShadow=await action.asElement().evaluate(el=>getComputedStyle(el).boxShadow);await action.asElement().focus();await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');
  await page.waitForFunction(shadow=>document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).boxShadow!==shadow,{},unfocusedShadow);
  result.focus=await page.evaluate(()=>({text:document.activeElement.textContent.trim(),visible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle,shadow:getComputedStyle(document.activeElement).boxShadow}));
  check('native keyboard focus returns to continuation',result.focus.text==='Continue Setup'&&result.focus.visible&&(result.focus.outline!=='none'||result.focus.shadow!=='none'));await capture('keyboard-focus');
  const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[fixture.actors['small-admin'].email])).rows[0].id;
  await pool.query('UPDATE user_settings SET onboarding_complete=false,onboarding_step=\'welcome\' WHERE user_id=$1',[person]);
  let count=0,mode='start',held,arrived;
  await page.setRequestInterception(true);
  const intercept=request=>{if(!request.headers()['next-action'])return void request.continue();count++;if((mode==='start'&&count===1)||(mode==='summary'&&count===2)||(mode==='step'&&count===3)){held=request;arrived?.();}else void request.continue();};page.on('request',intercept);
  const pending=new Promise(done=>arrived=done);await page.reload({waitUntil:'domcontentloaded'});await pending;
  check('held initialization disables continuation',await page.evaluate(()=>![...document.querySelectorAll('button')].some(b=>['Continue Setup','Get Started'].includes(b.textContent.trim())&&!b.disabled)));await capture('preparing');await held.abort('failed');await page.waitForSelector('[role="alert"]');await capture('initialization-failed');
  check('failed transport leaves seeded step intact',(await status()).data.onboardingStep==='welcome');
  mode='none';await click('Retry setup');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue Setup'&&!b.disabled));check('retry runs permitted initialization and reads summary',count===3);
  mode='summary';count=0;const summaryPending=new Promise(done=>arrived=done);await page.reload({waitUntil:'domcontentloaded'});await summaryPending;await held.abort('failed');await page.waitForSelector('[role="alert"]');await capture('summary-failed');mode='none';await click('Retry setup');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue Setup'&&!b.disabled));check('summary retry does not repeat initialization',count===3);
  mode='step';count=2;const stepPending=new Promise(done=>arrived=done);await click('Continue Setup');await stepPending;await capture('continuation-pending');await held.abort('failed');await page.waitForSelector('[role="alert"]');check('failed continuation stays on welcome and is retryable',new URL(page.url()).pathname.endsWith('/onboarding/welcome'));await capture('continuation-failed');mode='none';await click('Continue Setup');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/profile'));
  check('actual permitted continuation reaches original profile route',(await status()).data.onboardingStep==='profile');
  check('PostgreSQL reads durable step and initialization timestamp',(await pool.query('SELECT onboarding_step,onboarding_started_at FROM user_settings WHERE user_id=$1',[person])).rows.some(r=>r.onboarding_step==='profile'&&r.onboarding_started_at!==null));
  page.off('request',intercept);await page.setRequestInterception(false);
  await context.deleteCookie(...await context.cookies());await signIn(fixture.actors['small-employee']);await welcome();check('member keeps actual org/profile continuation',await page.evaluate(()=>document.body.innerText.includes('Performance small')&&[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Continue Setup')));await capture('member');
  const mcp=async(method,params)=>{const r=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(60000)});const raw=await r.text();return raw.startsWith('event:')?JSON.parse(raw.split(/\r?\n/).find(s=>s.startsWith('data: ')).slice(6)):JSON.parse(raw);};
  const checks=[{name:'tools/list',result:await mcp('tools/list')}];for(const name of ['get_project_metadata','get_routes','get_compilation_issues','get_errors'])checks.push({name,result:await mcp('tools/call',{name,arguments:{}})});await writeFile(join(output,'next-runtime.json'),JSON.stringify(checks,null,2)+'\n');
 }
}catch(error){result.failed.push(error.message);throw error;}
finally{await writeFile(join(output,`${phase}-runtime.json`),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
