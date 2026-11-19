// pnpm node <script> <checkout> <owned-private-fixture> <before|after>
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const [checkoutInput,fixtureInput,phase]=process.argv.slice(2), checkout=resolve(checkoutInput), directory=resolve(fixtureInput);
assert.ok(['before','after'].includes(phase));
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const runtime=await json('runtime-private.json'), fixture=await json('fixture-private.json'), services=await json('services.json'), auth=await json('dev-auth-private.json');
assert.equal(services.label,'z8-performance-fixture-1450'); assert.equal(fixture.kind,'disposable'); assert.equal(new URL(runtime.origin).hostname,'localhost'); assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');
assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers) {assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const require=createRequire(join(checkout,'package.json')), puppeteer=require('puppeteer-core');
const appRequire=createRequire(join(checkout,'apps/webapp/package.json')), {Pool}=appRequire('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const output=join(checkout,'docs/design/rollout-1692/1827'); await mkdir(output,{recursive:true});
const paths=['apps/webapp/src/app/[locale]/onboarding/complete/page-client.tsx','apps/webapp/src/app/[locale]/onboarding/complete/page.tsx','apps/webapp/src/app/[locale]/onboarding/complete/actions.ts','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/components/onboarding/progress-indicator.tsx','apps/webapp/src/app/globals.css'];
const git=(...args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();
const pin=async()=>({head:git('rev-parse','HEAD'),localAI:git('rev-parse','ai/1692-app-wide-ui-refresh'),files:Object.fromEntries(await Promise.all(paths.map(async p=>[p,{blob:git('hash-object','--path',p,p),sha256:createHash('sha256').update(await readFile(join(checkout,p))).digest('hex')}])))});
const results={phase,scope:'label-owned synthetic Performance small; consumer-only source comparison, current shared shell',source:await pin(),checks:[],captures:[],pageErrors:[],failed:[]};
const check=(name,value)=>{assert.ok(value,name);results.checks.push(name);console.log('Passed: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);
const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>results.pageErrors.push(e.message));
const waitReady=()=>page.waitForFunction(phase=>document.body.innerText.includes(phase==='before'?"You're all set!":'Personal setup complete'),{},phase);
const capture=async(name)=>{await page.evaluate(()=>document.fonts.ready);const filename=`${phase}-${name}.png`;await page.screenshot({path:join(output,filename),fullPage:true});const png=await readFile(join(output,filename));results.captures.push({filename,source:await pin(),...await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,headingFont:getComputedStyle(document.querySelector('h1')).fontSize,fontsStatus:document.fonts.status,savedFont:localStorage.getItem('z8-font-size'),savedTheme:localStorage.getItem('theme'),theme:document.documentElement.className,visualScale:visualViewport.scale,devicePixelRatio,colors:Object.fromEntries(['h1','.text-muted-foreground','a[href$="/init"]'].map(selector=>{const el=document.querySelector(selector);return [selector,el?{color:getComputedStyle(el).color,background:getComputedStyle(el.closest('section')).backgroundColor}:null]})),focus:document.activeElement?.textContent?.trim().slice(0,100)})),pngDimensions:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)}});};
const click=async(name)=>{const handle=await page.waitForFunction(name=>[...document.querySelectorAll('button,a,[role=menuitemradio]')].find(el=>el.textContent.trim()===name&&el.getBoundingClientRect().width),{},name);const el=handle.asElement();await el.scrollIntoView();await page.waitForFunction(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),surface=el.closest('[data-slot=dropdown-menu-content]');return hit&&(hit===el||el.contains(hit))&&!surface?.getAnimations({subtree:true}).some(animation=>animation.playState==='running');},{},el);await el.click();};
let nextActionCount=0;page.on('request',request=>{if(request.headers()['next-action'])nextActionCount++;});
const status=()=>page.evaluate(async()=>{const response=await fetch('/api/user/onboarding-status');return {status:response.status,data:await response.json()};});
try {
 await page.setViewport({width:1600,height:1000});
 await page.goto(runtime.origin+'/en/onboarding/complete',{waitUntil:'networkidle0'});await waitReady();
 for(const [name,width,height,theme,font] of [['desktop-light',1600,1000,'light','default'],['phone-light',390,844,'light','default'],['wide-dark-large',2400,1200,'dark','large'],['phone-dark-large',390,844,'dark','large']]) {
  await page.setViewport({width,height});await page.evaluate((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font);},theme,font);
  await page.reload({waitUntil:'networkidle0'});await waitReady();if(phase==='after')await page.waitForSelector('a[href$="/init"]');await capture(name);
  if(phase==='after')check(name+' fits width and saved font',await page.evaluate(width=>document.documentElement.scrollWidth===width&&getComputedStyle(document.documentElement).fontSize===(localStorage.getItem('z8-font-size')==='large'?'18px':'16px'),width));
 }
 if(phase==='before') { const button=await page.waitForFunction(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Go to Dashboard'));await button.asElement().focus();await capture('keyboard-focus'); }
 if(phase==='after') {
  check('single semantic task heading',await page.$$eval('h1',els=>els.length===1));
  check('real summary names current organization',await page.evaluate(()=>document.body.innerText.includes('Performance small')));
  await click('Font size');await page.waitForSelector('[role="menuitemradio"]');await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.waitForFunction(()=>localStorage.getItem('z8-font-size')==='default',{timeout:5000});await page.keyboard.press('Escape');await page.waitForFunction(()=>![...document.querySelectorAll('[role=menuitemradio]')].some(el=>el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})));
  await click('Font size');await page.waitForSelector('[role="menuitemradio"]');await page.keyboard.press('End');await page.keyboard.press('Enter');await page.waitForFunction(()=>localStorage.getItem('z8-font-size')==='large'&&getComputedStyle(document.documentElement).fontSize==='18px',{timeout:5000});
  check('real font preference action saves Large',await page.evaluate(()=>localStorage.getItem('z8-font-size')==='large'&&getComputedStyle(document.documentElement).fontSize==='18px'));
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  await page.focus('a[href$="/init"]');await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');await capture('keyboard-focus');
  check('keyboard returns to initialization link with visible focus',await page.$eval('a[href$="/init"]',el=>document.activeElement===el&&getComputedStyle(el).outlineStyle!=='none'));
  // Seed only the disposable personal flag; this is test setup, not a UI mutation.
  const actor=fixture.actors['small-admin'];const person=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
  await pool.query('UPDATE user_settings SET onboarding_complete=false,onboarding_step=\'complete\',onboarding_completed_at=NULL WHERE user_id=$1',[person]);
  const before=await status();check('authoritative API reads seeded incomplete flag',before.status===200&&before.data.onboardingComplete===false);
  let action=0,mode='completion',held,arrived;
  await page.setRequestInterception(true);
  const interceptor=request=>{if(!request.headers()['next-action'])return void request.continue();action++;if((mode==='completion'&&action===1)||(mode==='summary'&&action===2)){held=request;arrived?.();}else void request.continue();};
  page.on('request',interceptor);
  const pending=new Promise(done=>arrived=done);await page.reload({waitUntil:'domcontentloaded'});await pending;
  check('real pending finalization has no continuation or success',await page.evaluate(()=>!document.querySelector('a[href$="/init"]')&&!document.body.innerText.includes('Personal setup complete')));await capture('completion-pending');
  await held.abort('failed');await page.waitForSelector('[role="alert"]');await capture('completion-failed');
  check('transport failure does not mutate flag',(await status()).data.onboardingComplete===false);
  mode='none';await click('Retry completion');await page.waitForSelector('a[href$="/init"]');
  check('real completion persists flag through public API', (await status()).data.onboardingComplete===true);
  const record=(await pool.query('SELECT onboarding_step,onboarding_completed_at FROM user_settings WHERE user_id=$1',[person])).rows[0];
  check('PG reads cleared step and durable completion timestamp',record.onboarding_step===null&&record.onboarding_completed_at!==null);
  mode='summary';action=0;const summaryPending=new Promise(done=>arrived=done);await page.reload({waitUntil:'domcontentloaded'});await summaryPending;await held.abort('failed');await page.waitForSelector('[role="alert"]');await capture('summary-failed');
  check('summary failure retains confirmed personal outcome and continuation',await page.evaluate(()=>document.body.innerText.includes('Personal setup complete')&&!!document.querySelector('a[href$="/init"]')));
  mode='none';const completedAt=(await pool.query('SELECT onboarding_completed_at FROM user_settings WHERE user_id=$1',[person])).rows[0].onboarding_completed_at;
  await click('Retry summary');await page.waitForFunction(()=>document.body.innerText.includes('Performance small')&&!document.querySelector('[role="alert"]'));
  const afterRetry=(await pool.query('SELECT onboarding_completed_at FROM user_settings WHERE user_id=$1',[person])).rows[0].onboarding_completed_at;
  check('summary retry makes one read without another finalization',action===3&&completedAt.getTime()===afterRetry.getTime());
  page.off('request',interceptor);await page.setRequestInterception(false);
  check('admin holiday link remains in existing context',await page.$eval('a[href$="/settings/holidays"]',el=>el.textContent.includes('Set up public holidays')));
  let initRequested=false;const track=request=>{if(new URL(request.url()).pathname.endsWith('/init'))initRequested=true;};page.on('request',track);await page.focus('a[href$="/init"]');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!location.pathname.endsWith('/onboarding/complete'),{timeout:60000});page.off('request',track);check('native continuation reaches existing init owner',initRequested);
  await context.deleteCookie(...await context.cookies());await context.setCookie(...auth['small-employee'].cookies);await page.goto(runtime.origin+'/en/onboarding/complete',{waitUntil:'networkidle0'});await waitReady();
  check('employee summary omits administrator holiday link',await page.evaluate(()=>document.body.innerText.includes('Performance small')&&!document.querySelector('a[href$="/settings/holidays"]')));await capture('employee');
  const call=async(method,params)=>{const r=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});const raw=await r.text();return raw.startsWith('event:')?JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('data: ')).slice(6)):JSON.parse(raw);};
  const mcp=[{name:'tools/list',result:await call('tools/list')}];for(const name of ['get_project_metadata','get_routes','get_compilation_issues','get_errors'])mcp.push({name,result:await call('tools/call',{name,arguments:{}})});await writeFile(join(output,'next-runtime.json'),JSON.stringify(mcp,null,2));

 }
} catch(error) { results.failed.push({message:error.message});throw error; }
finally {results.nextActionRequests=nextActionCount;await writeFile(join(output,`${phase}-runtime.json`),JSON.stringify(results,null,2));await browser.close();await pool.end();}


