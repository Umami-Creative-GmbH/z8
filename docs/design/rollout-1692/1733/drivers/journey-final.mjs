import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const repo=process.cwd(), req=createRequire(join(repo,'package.json'));
const dir=(await readFile('.tmp/1733/fixture-path.txt','utf8')).trim();
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(f.kind!=='disposable'||new URL(r.origin).hostname!=='localhost')throw Error('Own loopback fixture only');
const browser=await req('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();
await context.overridePermissions(r.origin,[]);
const page=await context.newPage();
await page.setViewport({width:1600,height:1000});
page.on('pageerror',e=>writeFile('.tmp/1733/page-errors.txt',e.message+'\n',{flag:'a'}));
try{
await page.goto(r.origin+'/en/sign-in',{waitUntil:'networkidle2',timeout:120000});
console.log((await page.locator('body').wait(),await page.evaluate(()=>[...document.querySelectorAll('input')].map(e=>({id:e.id,type:e.type,name:e.name})))));
const actor=f.actors['small-admin'];
await page.type('input[type=email]',actor.email);
await page.type('input[type=password]',actor.password);
await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled,{timeout:60000});
await page.click('button[type=submit]');
await page.waitForFunction(()=>!location.pathname.includes('sign-in'),{timeout:60000});
await page.waitForNetworkIdle({idleTime:1500,timeout:30000}).catch(()=>{});
console.log('Normal UI login completed');
const mode=process.argv[2]??'intake';
const fs=await import('node:fs/promises');
const batchPath='.tmp/1733/batch-id2.txt';
let batchId=await fs.readFile(batchPath,'utf8').then(s=>s.trim()).catch(()=>null);
const clickText=async(text)=>{const el=await page.waitForSelector('::-p-text('+text+')',{timeout:30000});await el.click();};
if(!batchId){
 await page.goto(r.origin+'/en/personnel-files/payslip-batches',{waitUntil:'networkidle2',timeout:120000});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Start batch')&&!e.disabled));
 await clickText('Start batch');
 await page.waitForFunction(()=>/payslip-batches\/[a-f0-9-]{36}$/.test(location.pathname),{timeout:60000});
 batchId=new URL(page.url()).pathname.split('/').at(-1);await fs.writeFile(batchPath,batchId);
}
await page.goto(r.origin+'/en/personnel-files/payslip-batches/'+batchId,{waitUntil:'networkidle2',timeout:120000});
await page.waitForSelector('#payslip-batch-files');
if(mode==='actions'){
 const assert=(await import('node:assert/strict')).default;
 const appRequire=createRequire(join(repo,'apps/webapp/package.json'));
 const e=r.env;const pool=new(appRequire('pg').Pool)({host:e.POSTGRES_HOST,port:Number(e.POSTGRES_PORT),user:e.POSTGRES_USER,password:e.POSTGRES_PASSWORD,database:e.POSTGRES_DB});
 const org=f.actors['small-admin'].organizationId;
 const readback=async()=>({files:(await pool.query('select file_name,included,assigned_employee_id,document_id,failure from payslip_batch_file where organization_id=$1 and batch_id=$2 order by file_name',[org,batchId])).rows,notifications:Number((await pool.query('select count(*) from notification where organization_id=$1 and entity_id=$2',[org,batchId])).rows[0].count)});
 try{
  const before=await readback();assert.equal(before.files.filter(x=>x.document_id).length,0);
  for(const file of ['1733-first.pdf','1733-second.pdf']){
   const row=await page.$('li:has([aria-label="Include '+file+'"])');
   await (await row.$('[role=combobox]')).click();
   await page.waitForSelector('[role=option]');
   await (await page.$('[role=option]')).click();
   await page.waitForFunction(file=>[...document.querySelectorAll('li')].some(e=>e.textContent.includes(file)&&e.textContent.includes('Assigned by hand')),{},file);
   await page.waitForFunction(()=>![...document.querySelectorAll('[role=checkbox]')].some(e=>e.getAttribute('aria-disabled')==='true'));
  }
  if(await page.$eval('[aria-label="Include 1733-drop.pdf"]',e=>e.getAttribute('aria-checked')==='true')) await page.click('[aria-label="Include 1733-drop.pdf"]');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Include 1733-drop.pdf"]')?.getAttribute('aria-checked')==='false');
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(e=>e.textContent.includes('Save 2 payslips')&&!e.disabled));
  const unconfirmed=await readback();assert.equal(unconfirmed.files.filter(x=>x.document_id).length,0);assert.equal(unconfirmed.notifications,0);
  await clickText('Save 2 payslips');await page.waitForSelector('[role=alertdialog]');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=alertdialog]'));
  await clickText('Save 2 payslips');await page.waitForSelector('[role=alertdialog]');await clickText('Cancel');
  assert.equal((await readback()).files.filter(x=>x.document_id).length,0);
  await clickText('Save 2 payslips');await page.waitForSelector('[role=alertdialog]');
  let held,posts=0;
  await page.setRequestInterception(true);
  const listener=request=>{if(request.method()==='POST'&&request.headers()['next-action']&&!held){held=request;posts++;}else void request.continue();};
  page.on('request',listener);
  const dialogButtons=await page.$$('[role=alertdialog] button');await dialogButtons.at(-1).click();
  await new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(held){clearInterval(timer);resolve();}else if(++n>100){clearInterval(timer);reject(Error('No confirmation command'));}},100);});
  const pending=await page.evaluate(()=>({dialog:!!document.querySelector('[role=alertdialog]'),disabled:[...document.querySelectorAll('[role=checkbox]')].every(e=>e.getAttribute('aria-disabled')==='true')}));assert.equal(pending.disabled,true);
  await held.continue();page.off('request',listener);await page.setRequestInterception(false);
  await page.waitForFunction(()=>document.body.innerText.includes('2 payslips saved, 0 failed'),{timeout:60000});
  const saved=await readback();assert.equal(saved.files.filter(x=>x.document_id).length,2);assert.equal(saved.notifications,1);
  await page.screenshot({path:'docs/design/rollout-1692/1733/results.png',fullPage:true});
  await fs.writeFile('docs/design/rollout-1692/1733/actions-readback.json',JSON.stringify({before,unconfirmed,pending,posts,saved,checks:['manual same-employee matches','drop persisted','no documents or notifications before confirmation','Escape and Cancel save nothing','pending controls disabled','two documents / one batch notification']},null,2));
 }finally{await pool.end();}
}
if(mode==='intake'){
 const files=['1733-first.pdf','1733-second.pdf','1733-drop.pdf'];
 for(const name of files)await fs.writeFile('.tmp/1733/'+name,'%PDF-1.4\n% synthetic R050 payslip\n%%EOF');
 const appReq=createRequire(join(repo,'apps/webapp/package.json'));const zip=new(appReq('jszip'))();for(const name of files)zip.file('payroll/'+name,await fs.readFile('.tmp/1733/'+name));zip.file('notes.txt','ignored');zip.file('__MACOSX/ignored.pdf','ignored');await fs.writeFile('.tmp/1733/1733-intake.zip',await zip.generateAsync({type:'nodebuffer'}));const input=await page.$('#payslip-batch-files');await input.uploadFile(resolve('.tmp/1733/1733-intake.zip'));
 await page.waitForFunction(()=>document.querySelectorAll('li [role=checkbox]').length===3,{timeout:60000});
}
const pins=async()=>{const{createHash}=await import('node:crypto');const paths=['apps/webapp/src/components/personnel-file/payslip-batch-workspace.tsx','apps/webapp/src/components/personnel-file/use-payslip-batch-upload.ts','apps/webapp/src/app/[locale]/(app)/personnel-files/payslip-batches/[batchId]/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];return Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update((await fs.readFile(p,'utf8')).replaceAll('\r\n','\n')).digest('hex')])));};
const evidence={mode,batchId,scope:'own small-admin / Performance small / same three staged PDFs',sourceHashes:await pins(),layouts:[]};
for(const [name,width,height,theme,text] of [['desktop',1600,1000,'light',16],['phone',390,844,'light',16],['wide-dark',2200,1100,'dark',16],['large-text',1600,1000,'light',20]]){
 await page.setViewport({width,height});
 await page.evaluate((theme,text)=>{document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.fontSize=text+'px';},theme,text);
 await page.screenshot({path:'docs/design/rollout-1692/1733/'+mode+'-'+name+'.png',fullPage:true});
 evidence.layouts.push({name,width,height,theme,text,...await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('h1')].map(e=>e.textContent),files:document.querySelectorAll('li [role=checkbox]').length}))});
}
await fs.writeFile('docs/design/rollout-1692/1733/'+mode+'.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence));
if(mode==='after'){
 console.log((await page.evaluate(()=>document.body.innerText)).slice(-4000));
}
}finally{await browser.close();}

