import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
const dir=resolve('.tmp/1728/fixture'),out=resolve('docs/design/rollout-1692/1728');
const read=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),auth=await read('dev-auth-private.json'),services=await read('services.json');
assert.equal(f.kind,'disposable');assert.equal(r.env.POSTGRES_HOST,'127.0.0.1');assert.match(r.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const req=createRequire(resolve('apps/webapp/package.json')), {Client}=req('pg'),puppeteer=createRequire(resolve('package.json'))('puppeteer-core');
const db=new Client({connectionString:r.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const c=await b.createBrowserContext();await c.setCookie(...auth['small-admin'].cookies);await c.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});
const p=await c.newPage();p.setDefaultTimeout(45000);const result={checks:[],captures:[],errors:[],head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};p.on('pageerror',e=>result.errors.push(e.message));
const click=async text=>{const element=await p.waitForFunction(text=>[...document.querySelectorAll('button')].find(e=>e.checkVisibility()&&e.textContent.trim()===text),{},text);await element.click();};
try{
await p.goto(r.origin+'/en/settings/organization',{waitUntil:'networkidle2',timeout:120000});
await p.waitForSelector('#personnel-files-toggle');if(await p.$eval('#personnel-files-toggle',e=>e.getAttribute('aria-checked'))==='false')await p.click('#personnel-files-toggle');
await p.waitForFunction(()=>document.querySelector('#personnel-files-toggle')?.getAttribute('aria-checked')==='true');
await p.waitForFunction(()=>!document.querySelector('#personnel-files-toggle')?.disabled);
await p.waitForNetworkIdle({idleTime:1000});
const actor=f.actors['small-admin'];assert.equal((await db.query('select personnel_files_enabled from organization where id=$1',[actor.organizationId])).rows[0].personnel_files_enabled,true);result.checks.push('Feature enabled through existing organization settings UI, real scoped database readback.');
// Synthetic document records, not production upload operations. No auth or membership rows changed.
const rows=(await db.query('select id from employee where organization_id=$1 and id<>$2 order by id limit 3',[actor.organizationId,actor.employeeId])).rows;
const documentIds=[];
for(const [index,row] of rows.entries())for(const category of ['certificate','other']){const id=randomUUID();documentIds.push(id);await db.query(`insert into employee_document(id,organization_id,employee_id,category,title,document_date,visibility,expiry_date,storage_provider,storage_key,file_name,mime_type,size_bytes,checksum_sha256) values($1,$2,$3,$4,$5,'2026-01-15','hr_only','2026-11-15','s3-private',$6,'fixture.pdf','application/pdf',10,'fixture')`,[id,actor.organizationId,row.id,category,'R045 '+category+' '+(index+1),'personnel-files/'+actor.organizationId+'/'+row.id+'/'+id+'.pdf']);}
await writeFile(join(dir,'r045-private.json'),JSON.stringify({documentIds,employees:rows}));
await p.goto(r.origin+'/en/personnel-files',{waitUntil:'networkidle2',timeout:120000});await p.waitForFunction(()=>document.querySelector('main')?.textContent.includes('R045 certificate'));
for(const [name,width,height,dark]of[['desktop-light',1600,1000,false],['wide-dark',2400,1200,true],['phone-light',390,844,false],['phone-dark-large',390,844,true]]){
await p.setViewport({width,height});await p.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);await p.evaluate(dark=>{document.documentElement.classList.toggle('dark',dark);},dark);
if(name.includes('large'))await p.evaluate(()=>document.documentElement.style.fontSize='18px');
await p.evaluate(()=>document.fonts.ready);const path=join(out,'before-'+name+'.png');await p.screenshot({path,fullPage:true});result.captures.push({path,...await p.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,fontStatus:document.fonts.status,headings:[...document.querySelectorAll('main h1')].map(e=>e.textContent.trim()),links:[...document.querySelectorAll('main a')].map(e=>({text:e.textContent.trim(),href:e.getAttribute('href')}))}))});
}
result.source=[];for(const path of ['apps/webapp/src/app/[locale]/(app)/personnel-files/page.tsx','apps/webapp/src/components/employees/employee-directory-card.tsx','apps/webapp/src/components/personnel-file/expiring-documents.tsx','apps/webapp/src/lib/navigation/route-metadata.ts']){const bytes=await readFile(path);result.source.push({path,sha256:createHash('sha256').update(bytes).digest('hex'),canonicalSha256:createHash('sha256').update(bytes.toString().replaceAll('\r\n','\n')).digest('hex')});}
await p.goto(r.origin+'/en/settings/personnel-files',{waitUntil:'networkidle2'});await writeFile(join(dir,'settings-dom-private.txt'),await p.evaluate(()=>document.querySelector('main').innerText));
}catch(e){result.failure=e.message;await p.screenshot({path:join(out,'before-failed.png'),fullPage:true}).catch(()=>{});throw e;}
finally{await writeFile(join(out,'before.json'),JSON.stringify(result,null,2));await b.close();await db.end();}
console.log('Before: actual feature toggle, scoped readback and four source-pinned captures.');
