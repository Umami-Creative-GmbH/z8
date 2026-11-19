import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const repo=process.cwd(), dir=join(repo,'.tmp/1734/fixture'), out=join(repo,'docs/design/rollout-1692/1734');
const req=createRequire(join(repo,'apps/webapp/package.json')), rootReq=createRequire(join(repo,'package.json'));
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'))), fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'))), services=JSON.parse(await readFile(join(dir,'services.json')));
if(fixture.kind!=='disposable'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||services.label!=='z8-performance-fixture-1450')throw Error('not own disposable');
for(const c of services.containers)if(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8'}).trim()!==services.label)throw Error('label mismatch');
const pool=new (req('pg').Pool)({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
const actor=fixture.actors[process.argv[3]||'small-admin'], target=fixture.actors['small-employee'];
const {randomUUID}=await import('node:crypto');
if(process.argv[2]==='seed'){
 await pool.query('update organization set personnel_files_enabled=true where id=$1',[actor.organizationId]);
 const {rows:[category]}=await pool.query("insert into absence_category (organization_id,type,name,requires_approval,counts_against_vacation,updated_at) values ($1,'sick','R051 synthetic sick leave',false,false,now()) returning id",[actor.organizationId]);
 const {rows:people}=await pool.query('select id,user_id from employee where organization_id=$1 and id<>$2 order by id',[actor.organizationId,actor.employeeId]);
 for(let i=0;i<12;i++)await pool.query("insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,status,sick_detail,updated_at) values ($1,$2,$3,$4,$4,$5,$6,now())",[people[i%people.length].id,actor.organizationId,category.id,`2026-11-${String(i+1).padStart(2,'0')}`,i%2?'approved':'pending',['with_certificate','without_certificate','child_sick','other'][i%4]]);
 const former=people.find(p=>p.id!==target.employeeId&&p.id!==fixture.actors['small-manager'].employeeId&&p.id!==fixture.actors['small-restricted'].employeeId);
 await pool.query('update employee set is_active=false where id=$1 and organization_id=$2',[former.id,actor.organizationId]);
 await writeFile(join(dir,'r051-private.json'),JSON.stringify({category:category.id,former:former.id}));
 console.log('Seeded own synthetic sick-leave records and former employee; no auth/membership/grant writes.');await pool.end();process.exit();
}
await pool.end();await mkdir(out,{recursive:true});
const browser=await rootReq('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.createBrowserContext();await context.overridePermissions(runtime.origin,[]);
 const page=await context.newPage();await page.setViewport({width:1600,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'networkidle2',timeout:120000});
 await page.waitForSelector('input[type=email]',{timeout:120000});
 await page.type('input[type=email]',actor.email);await page.type('input[type=password]',actor.password);
 await page.waitForFunction(()=>Boolean(document.querySelector('input[name="cf-turnstile-response"]')?.value),{timeout:60000});
 await page.locator('button[type=submit]').click();
 await page.waitForFunction(()=>!location.pathname.includes('sign-in'),{timeout:90000});
 // Activate through the real BetterAuth endpoint using only this context's normal sign-in session.
 const active=await page.evaluate(async organizationId=>(await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({organizationId})})).status,actor.organizationId);
 if(active!==200)throw Error('normal organization activation failed '+active);
 await page.waitForFunction(()=>!location.pathname.includes('/init'),{timeout:120000});
 await page.goto(runtime.origin+'/en/personnel-files/sick-leave?from=2026-11-01&to=2026-11-15&pageSize=10',{waitUntil:'networkidle2',timeout:120000});
 if(process.argv[2]==='restricted'){
  await page.waitForFunction(()=>document.body.textContent.includes('404')||document.body.textContent.toLowerCase().includes('not found'));
  if(await page.$('table')||await page.$('button[aria-label^="Attach or link sick notes for"]'))throw Error('restricted actor exposed records');
  await writeFile(join(out,`restricted-${process.argv[3]}.json`),JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),actor:process.argv[3],recordVisible:false,actionVisible:false,errors},null,2));
  console.log('Restricted synthetic role refused without records/actions: '+process.argv[3]);process.exitCode=0;await browser.close();process.exit();
 }
 await page.waitForSelector('table tbody tr',{timeout:120000});
 if(process.argv[2]==='native'){
  const cli='C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser.js';
  try{const snapshot=execFileSync(process.execPath,[cli,'--session','z8-1734-own-native','--cdp',browser.wsEndpoint(),'snapshot','-i'],{encoding:'utf8',timeout:20000,windowsHide:true,stdio:['ignore','pipe','pipe']});await writeFile(join(out,'native-snapshot.txt'),snapshot);console.log('Own native target inspection saved without cookie copying or restore state.');}catch{console.log('Native inspection unavailable; own in-memory CDP attach failed.');}
  try{execFileSync(process.execPath,[cli,'--session','z8-1734-own-native','close'],{timeout:10000,windowsHide:true,stdio:'ignore'});}catch{}
  await browser.close();process.exit();
 }
 const phase=process.argv[2]||'before';
 const probes=[];
 if(phase==='exercise'){
  const buttons=()=>page.$$eval('button',els=>els.filter(e=>e.checkVisibility()).map(e=>({text:e.textContent.trim(),label:e.getAttribute('aria-label')})));
  const clickText=async text=>{const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&e.textContent.trim()===text),text);if(!h.asElement())throw Error('missing button '+text);await h.asElement().focus();await page.keyboard.press('Enter');};
  for(const [name,width,height,dark,large] of [['desktop',1600,1000,false,false],['wide-dark',2400,1100,true,false],['phone',390,844,false,false],['phone-large',390,844,true,true]]){
   await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
   await page.evaluate(({dark,large})=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.dataset.fontSize=large?'large':'default';},{dark,large});
   const geometry=await page.evaluate(()=>{const r=document.querySelector('section[tabindex="0"]');return {viewport:innerWidth,document:document.documentElement.scrollWidth,recordClient:r.clientWidth,recordScroll:r.scrollWidth};});
   if(geometry.document>width)throw Error(name+' page overflow '+JSON.stringify(geometry));
   await page.focus('section[tabindex="0"]');await page.keyboard.press('ArrowRight');
   await page.$eval('h1',e=>e.scrollIntoView());
   await page.screenshot({path:join(out,`exercise-${name}.png`),fullPage:true});probes.push({name,geometry});
  }
  await page.setViewport({width:1600,height:1000});
  await page.locator('button[aria-label^="Attach or link sick notes for"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="dialog"]')].some(d=>d.textContent.includes('No sick notes you can open.')||d.querySelector('button[aria-label^="Unlink"]')));
  const existingNote=await page.$('button[aria-label^="Unlink"]');
  if(!existingNote){
  probes.push({emptyPanel:true});
  await clickText('Attach sick note');
  await page.waitForSelector('input[data-testid="sick-note-file-input"]',{timeout:15000});
  const png=join(dir,'synthetic-note.png');await writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9f8AAAAASUVORK5CYII=','base64'));
  await (await page.$('input[data-testid="sick-note-file-input"]')).uploadFile(png);
  await page.waitForSelector('input[id$="-title"]');
  await page.$eval('input[id$="-title"]',e=>{e.focus();e.select();});await page.keyboard.type('R051 synthetic note');
  console.log('attach-controls',JSON.stringify(await buttons()));
  await page.screenshot({path:join(out,'exercise-attach-draft.png'),fullPage:true});
  const attach=await page.$('[role="dialog"]:last-of-type button[type="submit"]');
  if(!attach)throw Error('attach submit missing');await attach.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.body.textContent.includes('R051 synthetic note')&&!document.querySelector('input[id$="-title"]'),{timeout:60000});
  probes.push({attachedReadback:true});await page.screenshot({path:join(out,'exercise-note-readback.png'),fullPage:true});
  }
  const open=await page.$('a[href^="/api/personnel-files/documents/"]');if(!open)throw Error('document open unavailable');
  const download=await page.evaluate(async href=>{const r=await fetch(href);return {status:r.status,type:r.headers.get('content-type'),size:(await r.arrayBuffer()).byteLength};},await open.evaluate(e=>e.getAttribute('href')));
  if(download.status!==200||download.size===0)throw Error('actual document read failed');probes.push({download});
  const countBefore=await page.$$eval('button[aria-label^="Unlink"]',els=>els.length);
  const unlink=await page.$('button[aria-label^="Unlink"]');await unlink.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(count=>document.querySelectorAll('button[aria-label^="Unlink"]').length<count,{timeout:30000},countBefore);
  await clickText('Link sick note');await page.waitForSelector('[role="radio"]',{timeout:30000});
  await page.locator('[role="radio"]').click();
  const linkSubmit=await page.$('[role="dialog"]:last-of-type button[type="submit"]');await linkSubmit.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(count=>document.querySelectorAll('button[aria-label^="Unlink"]').length===count,{timeout:30000},countBefore);probes.push({unlinkedThenRelinkedReadback:true});
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
  const mcp=async(method,params)=>{const r=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...params?{params}:{}})});const raw=await r.text();return raw.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6)));};
  const diagnostics={tools:await mcp('tools/list'),issues:await mcp('tools/call',{name:'get_compilation_issues',arguments:{}}),errors:await mcp('tools/call',{name:'get_errors',arguments:{}})};
  await writeFile(join(out,'exercise-next.json'),JSON.stringify(diagnostics,null,2));
 }
 await page.screenshot({path:join(out,phase+'-desktop.png'),fullPage:true});
 const result={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n'),phase,role:'small-admin',scope:'own synthetic small organization, 2026-11-01..15, pageSize=10',headings:await page.$$eval('h1',els=>els.map(e=>e.textContent)),rows:await page.$$eval('tbody tr',els=>els.length),errors,probes};
 console.log(JSON.stringify(result));await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2));
}finally{await browser.close();}
