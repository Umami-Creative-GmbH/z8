// pnpm node runtime.mjs <explicit checkout> <owned private fixture> <setup|before|after|actions|mcp>
// Private manifests/cookies stay local. No external provider/customer/delivery calls.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,realpath,mkdir,access} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const [checkout,input,mode]=process.argv.slice(2),repo=resolve(checkout),directory=resolve(input);
assert.ok(['setup','before','after','actions','mcp','policy','disabled','denial','states'].includes(mode));
const json=async name=>JSON.parse(await readFile(join(directory,name),'utf8'));
const r=await json('runtime-private.json'),f=await json('fixture-private.json'),services=await json('services.json');
assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label,'z8-performance-fixture-1450');assert.equal(services.containers.length,3);
for(const c of services.containers){assert.match(c,/^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);}
const depApp=resolve(await realpath(join(repo,'apps/webapp/node_modules')),'..');
const appRequire=createRequire(join(depApp,'package.json')),rootRequire=createRequire(resolve(depApp,'../../package.json'));
const {Pool}=appRequire('pg'),pool=new Pool({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
assert.equal((await pool.query('select current_database() as name')).rows[0].name,r.env.POSTGRES_DB);
const out=join(repo,'docs/design/rollout-1692/1829');await mkdir(out,{recursive:true});
const save=async(name,value)=>writeFile(join(out,name),JSON.stringify(value,null,2)+'\n');
const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
assert.equal(resolve(git('rev-parse','--show-toplevel')),repo);
const file='apps/webapp/src/app/[locale]/onboarding/organization/organization-page-client.tsx';
const files=[file,'apps/webapp/src/app/[locale]/onboarding/organization/page.tsx','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/src/components/organization/organization-tracking-setup-fields.tsx','apps/webapp/next.config.ts'];
const source=async()=>({head:git('rev-parse','HEAD'),dirty:git('status','--porcelain','--untracked-files=no'),lockSha256:createHash('sha256').update(await readFile(join(repo,'pnpm-lock.yaml'))).digest('hex'),dependencyVersions:Object.fromEntries(['next','react','vitest','typescript'].map(name=>[name,appRequire(name+'/package.json').version])),hashes:Object.fromEntries(await Promise.all(files.map(async p=>[p,createHash('sha256').update(await readFile(join(repo,p))).digest('hex')])))});
let browser,original;
const result={mode,fixture:'new owned disposable services; synthetic account with no initial membership',checks:[],captures:[],pageErrors:[],limits:['Default committed Next config and fully workspace-local frozen/offline copy install','before replaces only organization consumer with actual HEAD bytes; shared historical shell/branding remains current','saved18px is not true zoom or physical-device certification']};
const check=(name,value,details)=>{assert.ok(value,name);result.checks.push({name,passed:true,...(details?{details}:{})});console.log('Passed: '+name);};
try {
 if(mode==='setup'){
  const token=randomBytes(9).toString('hex'),email=`r034-${token}@example.test`,password=randomBytes(24).toString('base64url')+'aA9!';
  const request=await fetch(r.origin+'/api/auth/sign-up/email',{method:'POST',headers:{'content-type':'application/json',Origin:r.origin,'x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({name:'R034 Synthetic',firstName:'R034',lastName:'Synthetic',email,password})});
  assert.equal(request.status,200,'fresh synthetic signup through real Better Auth');await request.body?.cancel();
  const user=(await pool.query('select id,email_verified from "user" where email=$1',[email])).rows[0];assert.ok(user);
  // Fixture admission prerequisite only; never counted as real email-delivery verification.
  await pool.query('update "user" set email_verified=true where id=$1',[user.id]);
  await pool.query("insert into user_settings(id,user_id,onboarding_complete,onboarding_step,updated_at) values($1,$2,false,'organization',now()) on conflict(user_id) do update set onboarding_complete=false,onboarding_step='organization'",[randomUUID(),user.id]);
  const signed=await fetch(r.origin+'/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json',Origin:r.origin,'x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email,password})});assert.equal(signed.status,200);await signed.body?.cancel();
  const cookies=signed.headers.getSetCookie().map(line=>{const [pair,...attrs]=line.split(';'),i=pair.indexOf('='),a=new Map(attrs.map(x=>{const[k,...v]=x.trim().split('=');return[k.toLowerCase(),v.join('=')]}));return{name:pair.slice(0,i),value:pair.slice(i+1),domain:'localhost',path:a.get('path')||'/',httpOnly:a.has('httponly'),secure:a.has('secure'),sameSite:'Lax'};}).filter(c=>c.value);
  assert.ok(cookies.length);await writeFile(join(directory,'organization-private.json'),JSON.stringify({userId:user.id,email,password,cookies}),{mode:0o600});
  check('fresh account has no employee or membership',(await pool.query('select (select count(*) from member where user_id=$1)::int as memberships,(select count(*) from employee where user_id=$1)::int as employees',[user.id])).rows.every(x=>x.memberships===0&&x.employees===0));
 }else{
  const actor=await json('organization-private.json');
  if(mode==='before'){original=await readFile(join(repo,file));await writeFile(join(repo,file),execFileSync('git',['show',`HEAD:${file}`],{cwd:repo}));}
  browser=await rootRequire('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.createBrowserContext();await context.setCookie(...actor.cookies);const page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>result.pageErrors.push(e.message));
  const open=async()=>{await page.goto(r.origin+'/en/onboarding/organization',{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('#organization-name');};
  const capture=async label=>{await page.evaluate(()=>document.fonts.ready);const name=`${mode}-${label}.png`;await page.screenshot({path:join(out,name),fullPage:true});const bytes=await readFile(join(out,name));const state=await page.evaluate(()=>({pathname:location.pathname,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,font:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,dark:document.documentElement.classList.contains('dark'),storedFont:localStorage.getItem('z8-font-size'),heading:[...document.querySelectorAll('h1')].map(x=>x.textContent),fields:[...document.querySelectorAll('main input,main [role="combobox"]')].map(x=>({name:x.name,id:x.id,value:x.value||x.textContent})),branding:[...document.querySelectorAll('img')].map(x=>({alt:x.alt,src:x.getAttribute('src')}))}));assert.equal(state.documentWidth,state.width);assert.equal(state.heading.length,1);result.captures.push({name,source:await source(),role:'fresh account; no membership',scope:'onboarding account',png:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},...state});};
  if(mode==='before'||mode==='after'){
   const cases=[];for(const[size,width,height]of[['desktop',1600,1000],['wide',2400,1200],['phone',390,844]])for(const dark of [false,true])for(const large of [false,true])cases.push([`${size}-${dark?'dark':'light'}-${large?'large':'default'}`,width,height,dark,large]);
   for(const[label,width,height,dark,large]of cases){
    await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);await open();
    await page.locator('::-p-aria(Font size)').click();await page.locator(`::-p-aria(${large?'Large':'Default'})`).click();
    await page.locator('::-p-aria(Toggle theme)').click();await page.locator(`::-p-aria(${dark?'Dark':'Light'})`).click();await new Promise(done=>setTimeout(done,300));
    await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#organization-name');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),large?'18px':'16px');
    await capture(label);
   }
   await page.setViewport({width:1600,height:1000});await page.focus('#organization-name');await page.keyboard.press('Tab');check('keyboard moves name to slug',await page.evaluate(()=>document.activeElement.id==='organization-slug'));await capture('keyboard');
  }else if(mode==='actions'){
   await page.setViewport({width:1600,height:1000});await page.emulateTimezone('America/Los_Angeles');await open();
   const set=async(selector,value)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(selector,value);};
   await set('#organization-name','R034 Disposable Organization');await page.waitForFunction(()=>document.querySelector('#organization-slug').value==='r034-disposable-organization');
   await page.waitForFunction(()=>document.querySelector('#organization-slug-status')?.textContent.includes('available'));
   check('slug availability reaches actual server response',true);await capture('slug-available');
   await page.locator('::-p-aria(Organization timezone)').click();await page.type('[cmdk-input]','Pacific/Auckland');await page.locator('[cmdk-item]').click();
   const date=await page.$eval('input[type="date"]',x=>x.value);check('organization date ignores browser timezone',date===new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
   await page.$eval('input[type="date"]',x=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(x,'2026-11-14');x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));});
   await capture('tracking-boundary');
   let release;const hold=new Promise(done=>release=done);let creations=0;
   await page.setRequestInterception(true);page.on('request',async request=>{if(request.method()==='POST'&&request.url().includes('/onboarding/organization')&&request.postData()?.includes('R034 Disposable Organization')){creations++;await hold;}await request.continue();});
   await page.locator('::-p-aria(Create Organization[role="button"])').click();await page.waitForFunction(()=>document.querySelector('button[type="submit"]').disabled);await page.evaluate(()=>document.querySelector('button[type="submit"]').click());check('duplicate click produces one pending create',creations===1);await capture('creation-pending');release();
   await page.waitForFunction(()=>location.pathname==='/en/onboarding/profile',{timeout:120000});
   const persisted=(await pool.query('select o.id,o.name,o.slug,m.role,e.role as employee_role,e.is_active from organization o join member m on m.organization_id=o.id join employee e on e.organization_id=o.id and e.user_id=m.user_id where m.user_id=$1',[actor.userId])).rows;
   check('real creation committed exactly one organization owner and joined employee',persisted.length===1&&persisted[0].role==='owner'&&persisted[0].employee_role==='admin'&&persisted[0].is_active);
   await writeFile(join(directory,'created-private.json'),JSON.stringify(persisted[0]),{mode:0o600});
   const tracking=(await pool.query("select o.timezone,to_char(t.tracking_start_date,'YYYY-MM-DD') as tracking_start_date from organization o join organization_tracking_settings t on t.organization_id=o.id where o.id=$1",[persisted[0].id])).rows[0];result.trackingReadback=tracking;
   check('organization timezone and chosen tracking date persist',tracking.timezone==='Pacific/Auckland'&&tracking.tracking_start_date==='2026-11-14');
   const step=(await pool.query('select onboarding_step from user_settings where user_id=$1',[actor.userId])).rows[0];check('profile destination and persisted onboarding step agree',step.onboarding_step==='profile');
   // Re-enter through production page: membership detection must use existing skip.
   await pool.query("update user_settings set onboarding_step='organization' where user_id=$1",[actor.userId]);await page.goto(r.origin+'/en/onboarding/organization',{waitUntil:'networkidle0'});await page.waitForFunction(()=>location.pathname==='/en/onboarding/profile');check('existing membership automatically continues via skip',true);
  }else if(mode==='states'){
   await page.setViewport({width:390,height:844});await page.emulateTimezone('UTC');await open();
   check('same-zone UTC suggestion uses the current UTC calendar date',(await page.$eval('input[type="date"]',x=>x.value))===new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
   const set=async(selector,value)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(selector,value);};
   await set('#organization-name','A');await page.waitForSelector('#organization-name-error');check('name validation is associated with the affected input',await page.$eval('#organization-name',x=>x.getAttribute('aria-invalid')==='true'&&x.getAttribute('aria-describedby')==='organization-name-error'));await capture('field-validation');
   await set('#organization-name','R034 Recovery');
   const taken='r034-disposable-organization',other='r034-bravo-'+randomBytes(4).toString('hex');let oldA,oldB,heldA=false,heldB=false;
   await page.setRequestInterception(true);page.on('request',async request=>{const body=request.postData()||'';if(request.method()==='POST'&&body.includes(taken)&&!heldA){heldA=true;oldA=request;return;}if(request.method()==='POST'&&body.includes(other)&&!heldB){heldB=true;oldB=request;return;}await request.continue();});
   const until=async(predicate)=>{const deadline=Date.now()+15000;while(!predicate()){assert.ok(Date.now()<deadline,'held request must dispatch within 15s');await new Promise(done=>setTimeout(done,50));}};
   await set('#organization-slug',taken);await until(()=>oldA);
   await set('#organization-slug',other);await new Promise(done=>setTimeout(done,650));
   await set('#organization-slug',taken);await new Promise(done=>setTimeout(done,650));
   // Next serializes client server actions: let old A finish before queued B can dispatch.
   await oldA.continue();await until(()=>oldB);
   check('old A cannot settle the pending current A check',await page.$('#organization-slug-error')===null&&await page.$eval('button[type="submit"]',x=>x.disabled));
   await oldB.continue();await page.waitForSelector('#organization-slug-error');await new Promise(done=>setTimeout(done,500));
   check('held real slug A to B to A keeps the current taken result after late available B',await page.$eval('#organization-slug-error',x=>x.textContent.includes('already taken')));await capture('held-slug-aba');
   await set('#organization-slug','r034-retry-'+randomBytes(4).toString('hex'));await page.waitForFunction(()=>document.querySelector('#organization-slug-status')?.textContent.includes('available'));
   check('editing a taken slug recovers through a fresh production availability check',await page.$('#organization-slug-error')===null);await capture('slug-retry');
   await page.focus('#organization-name');await page.keyboard.press('Tab');await new Promise(done=>setTimeout(done,250));
   const focus=await page.evaluate(()=>({id:document.activeElement.id,visible:document.activeElement.matches(':focus-visible'),shadow:getComputedStyle(document.activeElement).boxShadow,outline:getComputedStyle(document.activeElement).outlineStyle}));
   check('keyboard focus is visibly styled on the slug field',focus.id==='organization-slug'&&focus.visible&&(focus.shadow!=='none'||focus.outline!=='none'),focus);
   result.contrast=[];for(const dark of [false,true]){
    await page.locator('::-p-aria(Toggle theme)').click();await page.locator(`::-p-aria(${dark?'Dark':'Light'})`).click();
    const samples=await page.evaluate(()=>{const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');const rgb=css=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255);};const luminance=c=>c.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);return['h1','#organization-create-title','#organization-slug-description','button[type="submit"]'].map(selector=>{const el=document.querySelector(selector),bg=selector==='button[type="submit"]'?el:selector==='h1'?el.parentElement:el.closest('section')||el.parentElement,foreground=getComputedStyle(el).color,background=getComputedStyle(bg).backgroundColor,a=luminance(rgb(foreground)),b=luminance(rgb(background));return{selector,foreground,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});});
    check(`${dark?'dark':'light'} owned surfaces meet 4.5:1 text contrast`,samples.every(x=>x.ratio>=4.5),samples);result.contrast.push({dark,samples});
   }
  }else if(mode==='denial'){
   await page.goto(r.origin+'/en/onboarding/organization',{waitUntil:'networkidle0'});
   const manifest=JSON.parse(await readFile(join(repo,'apps/webapp/.next/dev/server/server-reference-manifest.json'),'utf8'));
   const entries=Object.entries(manifest.node).filter(([,value])=>value.exportedName==='createOrganizationOnboarding');assert.equal(entries.length,1);
   const response=await page.evaluate(async id=>{const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8','next-action':id},body:JSON.stringify([{name:'R034 Policy Refusal',slug:'r034-policy-refusal',timezone:'UTC',trackingStartDate:''}])});return{status:r.status,text:await r.text()};},entries[0][0]);
   check('actual Next production action transport refuses disabled creation',response.status===200&&response.text.includes('Organization creation is disabled for this deployment.'));
   check('server policy refusal creates no organization membership or employee',(await pool.query('select (select count(*) from member where user_id=$1)::int as m,(select count(*) from employee where user_id=$1)::int as e',[actor.userId])).rows.every(x=>x.m===0&&x.e===0));
   result.transport='authenticated same-origin browser POST using actual generated Next action manifest, not a rendered Create click';await capture('policy-refusal-readback');
  }else if(mode==='disabled'){
   await page.goto(r.origin+'/en/onboarding/organization',{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Organization creation is disabled for this deployment.'));
   check('disabled policy hides creation fields',await page.$('#organization-name')===null);await capture('creation-disabled');
   await page.locator('::-p-aria(Skip for now[role="button"])').click();await page.waitForFunction(()=>location.pathname==='/en/onboarding/profile');
   check('expected invitation continues via real skip with no membership',(await pool.query("select onboarding_step from user_settings where user_id=$1",[actor.userId])).rows[0].onboarding_step==='profile'&&(await pool.query('select count(*)::int as n from member where user_id=$1',[actor.userId])).rows[0].n===0);
  }else if(mode==='policy'){
   await open();await page.type('#organization-name','R034 Policy Refusal');
   await page.waitForFunction(()=>document.querySelector('#organization-slug-status')?.textContent.includes('available'));
   let release;const held=new Promise(done=>release=done);let heldOnce=false;
   await page.setRequestInterception(true);page.on('request',async request=>{if(!heldOnce&&request.method()==='POST'&&request.url().includes('/onboarding/organization')&&request.postData()?.includes('R034 Policy Refusal')){heldOnce=true;await writeFile(join(directory,'policy-waiting-private.json'),JSON.stringify({held:true}),{mode:0o600});
    const deadline=Date.now()+180000;while(Date.now()<deadline){try{await access(join(directory,'policy-release-private'));release();break;}catch{await new Promise(done=>setTimeout(done,250));}}
    await held;
   }await request.continue();});
   await page.locator('::-p-aria(Create Organization[role="button"])').click();
   await page.waitForFunction(()=>[...document.querySelectorAll('[role="alert"]')].some(x=>x.textContent.includes('Organization creation is disabled')),{timeout:240000});
   check('actual held production creation action is refused after deployment policy changes',true);await capture('server-policy-refusal');
   check('refused action writes no membership or employee',(await pool.query('select (select count(*) from member where user_id=$1)::int as m,(select count(*) from employee where user_id=$1)::int as e',[actor.userId])).rows.every(x=>x.m===0&&x.e===0));
   await page.reload({waitUntil:'networkidle0'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Organization creation is disabled for this deployment.'));
   check('disabled policy hides all creation fields',await page.$('#organization-name')===null);await capture('creation-disabled');
   await page.locator('::-p-aria(Skip for now[role="button"])').click();await page.waitForFunction(()=>location.pathname==='/en/onboarding/profile');
   check('expected invitation continues via real skip with no membership',(await pool.query("select onboarding_step from user_settings where user_id=$1",[actor.userId])).rows[0].onboarding_step==='profile');
  }else{
   await open();const call=async(method,params)=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})})});const raw=await response.text();return raw.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).find(x=>x.id===1)??JSON.parse(raw);};
   result.tools=await call('tools/list');result.probes=[];for(const name of ['get_compilation_issues','get_errors','get_routes'])result.probes.push({name,result:await call('tools/call',{name,arguments:{}})});
  }
  check('no browser page errors',result.pageErrors.length===0);
 }
}catch(error){result.failure={name:error.name,message:error.message};throw error;}
finally{if(original)await writeFile(join(repo,file),original);if(browser)await browser.close();await pool.end();await save(`${mode}-runtime.json`,result);}
