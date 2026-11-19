// Owned disposable fixture only. Matched page-consumer comparison, not a historical whole app.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1835');
const json=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),services=await json('services.json'),auth=await json('dev-auth-private.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(runtime.env.POSTGRES_HOST,'127.0.0.1');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const require=createRequire(join(repo,'apps/webapp/package.json')),puppeteer=require('puppeteer-core'),{Pool}=require('pg');
const pool=new Pool({host:runtime.env.POSTGRES_HOST,port:Number(runtime.env.POSTGRES_PORT),database:runtime.env.POSTGRES_DB,user:runtime.env.POSTGRES_USER,password:runtime.env.POSTGRES_PASSWORD});
const target='apps/webapp/src/app/[locale]/onboarding/work-templates/page-client.tsx';
const pins=async()=>({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:await Promise.all([target,'apps/webapp/src/app/[locale]/onboarding/work-templates/actions.ts','apps/webapp/src/lib/effect/services/onboarding.service.ts','apps/webapp/src/app/[locale]/onboarding/layout.tsx','apps/webapp/next.config.ts'].map(async path=>{const bytes=await readFile(path),lf=bytes.toString().replaceAll('\r\n','\n');return {path,rawSha256:createHash('sha256').update(bytes).digest('hex'),lfSha256:createHash('sha256').update(lf).digest('hex'),crlfSha256:createHash('sha256').update(lf.replaceAll('\n','\r\n')).digest('hex'),gitBlob:execFileSync('git',['hash-object','--path',path,path],{encoding:'utf8'}).trim()};}))});
const result={classification:'actual work-template page and actions; matched exact baseline consumer overlay on current infrastructure',source:await pins(),checks:[],captures:[],pageErrors:[],limitations:['Not full historical app execution','No real device or true browser zoom','Scope switch runtime and late authority scenarios qualified separately']};
const runTag=randomUUID().slice(0,8);
const nonDefaultName='R040 browser four-day '+runTag;
const save=()=>writeFile(join(out,'runtime.json'),JSON.stringify(result,null,2)+'\n');
const check=(name,ok)=>{assert.ok(ok,name);result.checks.push({name,passed:true});console.log('Passed: '+name);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);
const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>result.pageErrors.push(e.message));
const goto=async()=>{await page.goto(runtime.origin+'/en/onboarding/work-templates',{waitUntil:'networkidle0'});await page.waitForSelector('input[placeholder="e.g., Full-Time, Part-Time"]');};
const button=async name=>(await page.waitForFunction(name=>[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===name),{},name)).asElement();
const click=async name=>{const b=await button(name);await b.scrollIntoView();await b.click();};
const fill=async(selector,value)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');if(value)await page.keyboard.type(value);await page.keyboard.press('Tab');};
const capture=async(phase)=>{
 for(const[name,width,height,theme,font] of [['desktop-light',1600,1000,'light','default'],['phone-light',390,844,'light','default'],['wide-dark-large',2400,1200,'dark','large'],['phone-dark-large',390,844,'dark','large']]){
  await page.setViewport({width,height});await page.evaluate((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font);},theme,font);await goto();await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,bodyFont:getComputedStyle(document.body).fontFamily,fonts:document.fonts.status,theme:document.documentElement.className,fontPreference:localStorage.getItem('z8-font-size'),visualScale:visualViewport.scale,h1:document.querySelectorAll('h1').length,checkboxes:document.querySelectorAll('[role=checkbox]').length}));
  const filename=`${phase}-${name}.png`;await page.screenshot({path:join(out,filename),fullPage:true});const png=await readFile(join(out,filename));result.captures.push({filename,phase,source:await pins(),actor:'small-admin',organizationId:fixture.actors['small-admin'].organizationId,...metrics,png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)}});
  if(phase==='after')check(name+' fits viewport with loaded font, one heading and seven day controls',metrics.documentWidth===width&&metrics.fonts==='loaded'&&metrics.theme.includes(theme)&&metrics.h1===1&&metrics.checkboxes===7&&(font!=='large'||metrics.rootFont==='18px'));
  if(phase==='after') {
   const contrast=await page.evaluate(()=>{
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});canvas.width=1;canvas.height=1;
    const rgba=css=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=css;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
    const over=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3]));
    const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('main h1,main h2,main p,main label')].filter(el=>el.checkVisibility()).map(el=>{const ancestors=[];for(let n=el;n;n=n.parentElement)ancestors.unshift(n);let bg=[255,255,255],opaque=false;for(const n of ancestors){const c=rgba(getComputedStyle(n).backgroundColor);if(c[3]===1)opaque=true;bg=over(c,bg);}const style=getComputedStyle(el),fg=over(rgba(style.color),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),minimum=parseFloat(style.fontSize)>=24||parseFloat(style.fontSize)>=18.666&&parseInt(style.fontWeight)>=700?3:4.5;return {tag:el.tagName,id:el.id,ratio,minimum,opaqueBackground:opaque,passed:opaque&&ratio>=minimum};});
   });result.captures.at(-1).contrast=contrast;check(name+' readable page text on opaque surfaces',contrast.length>=10&&contrast.every(x=>x.passed));
  }
 }
};
const current=await readFile(target);let overlaid=false;
try{
 if(process.argv[3]!=='actions') {
 const baseline=execFileSync('git',['show','3c7bc534edeb355d862c3f38759444658863af20:'+target],{maxBuffer:1024*1024});
 await writeFile(join(out,'before-consumer.tsx.txt'),baseline);await writeFile(target,baseline);overlaid=true;
 await goto();await capture('before');await writeFile(target,current);overlaid=false;await capture('after');
 }
 check('exact refreshed source restored after baseline overlay',(await readFile(target)).equals(current));
 await page.setViewport({width:1600,height:1000});await goto();
 const actor=fixture.actors['small-admin'],user=(await pool.query('SELECT id FROM "user" WHERE email=$1',[actor.email])).rows[0].id;
 const policies=async()=>(await pool.query('SELECT id,name,is_default FROM work_policy WHERE organization_id=$1 ORDER BY name',[actor.organizationId])).rows;
 const before=await policies();
 await fill('input[name=name]','');await click('Save and continue');await page.waitForSelector('[aria-invalid=true]');check('invalid name is focused',await page.evaluate(()=>document.activeElement.getAttribute('aria-invalid')==='true'));
 await fill('input[name=name]',nonDefaultName);await fill('input[name=hoursPerWeek]','169');await click('Save and continue');check('weekly hour upper bound refused without a policy',(await policies()).length===before.length&&await page.evaluate(()=>document.body.innerText.includes('A week has at most 168 hours')));
 await fill('input[name=hoursPerWeek]','32.5');await page.click('#work-template-day-friday-label');await page.click('#work-template-default');
 check('derived context follows actual fractional hours and selected days',await page.evaluate(()=>document.body.innerText.includes('4 working days, 8.1 hours per day')));
 await page.focus('[role=checkbox][aria-labelledby=work-template-day-saturday-label]');await page.keyboard.press('Space');check('keyboard toggles a selected working day',await page.$eval('[role=checkbox][aria-labelledby=work-template-day-saturday-label]',el=>el.getAttribute('aria-checked')==='true'));await page.keyboard.press('Space');
 await page.setRequestInterception(true);let held,arrived;let count=0;const pending=new Promise(done=>arrived=done);const intercept=req=>{if(req.method()==='POST'&&req.headers()['next-action']){held=req;count++;arrived();}else void req.continue();};page.on('request',intercept);
 await click('Save and continue');await pending;await page.evaluate(()=>{document.querySelector('form').requestSubmit();document.querySelector('form').requestSubmit();});
 check('one pending save disables fields and skip',count===1&&await page.$eval('input[name=name]',el=>el.disabled)&&await (await button('Skip for now')).evaluate(el=>el.disabled));
 await held.abort('failed');page.off('request',intercept);await page.setRequestInterception(false);await page.waitForFunction(()=>document.querySelector('input[name=name]')?.disabled===false);
 check('failed real transport retains draft and inline retry context',await page.$eval('input[name=name]',(el,name)=>el.value===name,nonDefaultName)&&await page.evaluate(()=>!!document.querySelector('form [role=alert]')));
 await click('Save and continue');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications'));
 const added=(await policies()).filter(x=>!before.some(y=>y.id===x.id));check('real save navigates to notifications and creates one non-default policy',added.length===1&&added[0].name===nonDefaultName&&!added[0].is_default);
 const schedule=(await pool.query('SELECT id,hours_per_cycle FROM work_policy_schedule WHERE policy_id=$1',[added[0].id])).rows[0];const days=(await pool.query('SELECT day_of_week,hours_per_day,is_work_day FROM work_policy_schedule_day WHERE schedule_id=$1 ORDER BY day_of_week::text',[schedule.id])).rows;
 check('database stores selected weekly hours and all seven day rows',schedule.hours_per_cycle==='32.50'&&days.length===7&&days.filter(x=>x.is_work_day).length===4&&days.filter(x=>x.is_work_day).every(x=>x.hours_per_day==='8.10')&&days.find(x=>x.day_of_week==='friday').is_work_day===false);
 check('non-default creates no organization assignment',(await pool.query('SELECT count(*)::int n FROM work_policy_assignment WHERE policy_id=$1',[added[0].id])).rows[0].n===0);
 check('existing writer persists wellness step',(await pool.query('SELECT onboarding_step FROM user_settings WHERE user_id=$1',[user])).rows[0].onboarding_step==='wellness');
 await goto();await fill('input[name=name]',nonDefaultName);await click('Save and continue');await page.waitForFunction(()=>!!document.querySelector('form [role=alert]')&&!document.querySelector('input[name=name]').disabled);check('existing name is refused without an extra policy',(await policies()).length===before.length+1);
 await goto();const defaultName='R040 browser default '+runTag;await fill('input[name=name]',defaultName);await click('Save and continue');await page.waitForFunction(()=>!!document.querySelector('form [role=alert]')&&!document.querySelector('input[name=name]').disabled);
 const defaultPolicy=(await policies()).find(x=>x.name===defaultName);check('existing default conflict returns inline failure and retains input',await page.$eval('input[name=name]',(el,name)=>el.value===name,defaultName)&&new URL(page.url()).pathname.endsWith('/work-templates'));
 result.inheritedDefaultGap={constraint:'workPolicyAssignment_org_default_idx',postgresCode:'23505',newPartialPolicyId:defaultPolicy?.id,assignmentCount:(await pool.query('SELECT count(*)::int n FROM work_policy_assignment WHERE policy_id=$1 AND organization_id=$2',[defaultPolicy.id,actor.organizationId])).rows[0].n};
 check('inherited nontransactional default conflict is identified, not represented as saved',defaultPolicy.is_default&&result.inheritedDefaultGap.assignmentCount===0);
 await page.screenshot({path:join(out,'state-existing-default-refusal.png'),fullPage:true});
 result.defaultRefusalCapture={filename:'state-existing-default-refusal.png',source:await pins(),actor:'small-admin',organizationId:actor.organizationId,dimensions:await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,rootFont:getComputedStyle(document.documentElement).fontSize,theme:document.documentElement.className}))};
 const preSkip=(await policies()).length;await goto();await click('Skip for now');await page.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications'));check('skip reaches existing destination without a policy',(await policies()).length===preSkip);
 const restricted=await browser.createBrowserContext();await restricted.setCookie(...auth['small-restricted'].cookies);const rp=await restricted.newPage();await rp.goto(runtime.origin+'/en/onboarding/work-templates',{waitUntil:'networkidle0'});await rp.waitForFunction(()=>location.pathname.endsWith('/onboarding/notifications'));check('actual non-admin is routed to notifications without template controls',!(await rp.$('input[name=name]')));await restricted.close();
 await goto();await fill('input[name=name]','R040 late actor draft');await context.setCookie(...auth['small-restricted'].cookies);await click('Save and continue');await page.waitForFunction(()=>!!document.querySelector('form [role=alert]')&&!document.querySelector('input[name=name]').disabled);
 check('real restricted session at late submit is refused with recoverable input',await page.$eval('input[name=name]',el=>el.value==='R040 late actor draft')&&await page.evaluate(()=>document.querySelector('form [role=alert]').textContent.includes('Only organization owners and admins')));
 result.lateAuthorityQualification='Real restricted-actor cookie switch after admin form admission; not a membership deletion/revocation or actual client scope switch. No SQL membership removal.';await context.setCookie(...auth['small-admin'].cookies);await goto();
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);check('reduced motion remains usable',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 // Keep an actual connected page while querying the framework's own diagnostics.
 const call=async(method,params)=>{const res=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(120000)});const raw=await res.text();return raw.includes('data: ')?JSON.parse(raw.split(/\r?\n/).find(x=>x.startsWith('data: ')).slice(6)):JSON.parse(raw);};
 result.mcpTools=await call('tools/list');result.mcp=[];for(const name of ['get_project_metadata','get_routes','get_compilation_issues','get_errors','get_page_metadata'])result.mcp.push({name,result:await call('tools/call',{name,arguments:{}})});
 check('no uncaught browser exceptions',result.pageErrors.length===0);
}catch(error){result.failure=error.message;result.failureState=await page.evaluate(()=>({hours:document.querySelector('input[name=hoursPerWeek]')?.value,days:[...document.querySelectorAll('[role=checkbox]')].map(el=>({id:el.id,tag:el.tagName,checked:el.getAttribute('aria-checked')})),preview:document.querySelector('#schedule-preview-heading')?.parentElement.innerText}));throw error;}finally{if(overlaid)await writeFile(target,current);await save();await browser.close();await pool.end();}
