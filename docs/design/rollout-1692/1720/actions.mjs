import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
import {clickVisible,waitVisible,prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core');
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8')),ids=JSON.parse(await readFile(join(dir,'1720-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const out=join(repo,'docs/design/rollout-1692/1720'),evidence={checks:[],errors:[]};
const paths=['apps/webapp/src/app/[locale]/(app)/my-documents/page.tsx','apps/webapp/src/components/personnel-file/requested-documents.tsx','apps/webapp/src/components/personnel-file/document-dialog.tsx','apps/webapp/src/components/personnel-file/submit-document-request-dialog.tsx'];
evidence.source={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes:Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(join(repo,p))).digest('hex')])))};
const save=()=>writeFile(join(out,'actions.json'),JSON.stringify(evidence,null,2)+'\n');
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);evidence.checks.push({name,actual});await save();};
const runId=randomUUID(),target='Runtime renewal '+runId.slice(0,8),fileName=runId+'.pdf';
const requestId=randomUUID(),actor=fixture.actors['small-employee'];
await pool.query("insert into employee_document_request(id,organization_id,employee_id,category,title,deadline,status) values($1,$2,$3,'certificate',$4,'2026-11-01','open')",[requestId,actor.organizationId,actor.employeeId,target]);
let lock;
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-employee'].cookies);
 const page=await context.newPage();await page.setViewport({width:1600,height:1000});page.on('pageerror',error=>evidence.errors.push(error.message));
 const click=s=>clickVisible(page,s,30000);
 const go=()=>page.goto(runtime.origin+'/en/my-documents',{waitUntil:'networkidle2'});
 await go();await page.waitForFunction(()=>document.body.innerText.includes('First aid certificate'));
 await check('one page title',await page.$$eval('main h1',nodes=>nodes.length),1);
 await check('open requests lead in deadline order',await page.$$eval('section[aria-labelledby] > ul > li',(nodes,target)=>{const titles=nodes.map(n=>n.innerText.split('\n')[0]);return titles.indexOf(target)<titles.indexOf('Later certificate');},target),true);
 for(const [label,status] of [['shared',200],['hr',404],['foreign',404]]){
  const result=await page.evaluate(async id=>{const res=await fetch('/api/personnel-files/documents/'+id+'?download=1');return {status:res.status,text:await res.text(),disposition:res.headers.get('content-disposition')};},ids[label]);
  await check(label+' access-checked download status',result.status,status);
  if(label==='shared'){await check('download returns actual stored PDF bytes',result.text,'%PDF-1.4\nSynthetic shared\n%%EOF');await check('download disposition',result.disposition.includes('attachment'));}
 }
 await click('button[aria-label="Upload a document for '+target+'"]');await waitVisible(page,'[role="dialog"] input[type="file"]');
 await check('employee has no visibility editor',await page.$eval('[role="dialog"]',d=>!d.innerText.includes('HR-only')));
 await page.$eval('[role="dialog"] input[type="file"]',input=>{const transfer=new DataTransfer();transfer.items.add(new File(['invalid'],'wrong.txt',{type:'text/plain'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));});
 await page.waitForSelector('[role="dialog"] [role="alert"]');await check('invalid file is refused before uploading',true);
 const file=join(dir,fileName);await writeFile(file,'%PDF-1.4\nSynthetic real request upload\n%%EOF');
 await (await page.$('[role="dialog"] input[type="file"]')).uploadFile(file);
 
 await pool.query('update organization set personnel_files_enabled=false where id=$1',[actor.organizationId]);
 await click('[role="dialog"] button[type="submit"]');await page.waitForSelector('[role="dialog"] [role="alert"]');
 await check('permission loss refuses upload and retains panel/file',await page.$eval('[role="dialog"] input[type="file"]',n=>n.files[0]?.name),fileName);
 await page.screenshot({path:join(out,'after-upload-refused.png')});
 await pool.query('update organization set personnel_files_enabled=true where id=$1',[actor.organizationId]);
 await click('[role="dialog"] button[type="submit"]');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:60000});
 const {rows:[document]}=await pool.query('select id,visibility,storage_key,checksum_sha256,size_bytes from employee_document where organization_id=$1 and employee_id=$2 and file_name=$3',[actor.organizationId,actor.employeeId,fileName]);
 await check('request upload is immediately a shared personnel-file document',document?.visibility,'shared');
 const downloaded=await page.evaluate(async id=>{const r=await fetch('/api/personnel-files/documents/'+id+'?download=1');return {status:r.status,body:await r.text()};},document.id);
 await check('real upload storage and database checksum agree',createHash('sha256').update(downloaded.body).digest('hex'),document.checksum_sha256);
 await check('real upload size agrees with database',Buffer.byteLength(downloaded.body),document.size_bytes);
 await click('button[aria-label="Submit '+target+'"]');await page.waitForSelector('[role="alertdialog"]');
 await click('[role="alertdialog"] button::-p-text(Cancel)');await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'));
 const {rows:[kept]}=await pool.query('select count(*)::int n from employee_document where id=$1 and organization_id=$2',[document.id,actor.organizationId]);await check('cancelling submission retains uploaded personnel document',kept.n,1);
 await click('button[aria-label="Submit '+target+'"]');await page.waitForSelector('[role="alertdialog"] textarea');await page.type('[role="alertdialog"] textarea','Synthetic retained submission note');
 await pool.query('update employee_document_request set version=version+1 where id=$1 and organization_id=$2',[requestId,actor.organizationId]);
 await click('[role="alertdialog"] button[type="submit"]');await page.waitForSelector('[role="alertdialog"] [role="alert"]');
 await check('stale-version conflict retains note',await page.$eval('[role="alertdialog"] textarea',n=>n.value),'Synthetic retained submission note');await page.screenshot({path:join(out,'after-submit-conflict.png')});
 await page.waitForNetworkIdle({idleTime:1000});
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table employee_document_request in access exclusive mode');
 let commands=0;const count=req=>{if(req.method()==='POST'&&req.headers()['next-action'])commands++;};page.on('request',count);
 await click('[role="alertdialog"] button[type="submit"]');await page.waitForFunction(()=>document.querySelector('[role="alertdialog"] button[type="submit"]')?.disabled);
 await page.$eval('[role="alertdialog"] form',f=>{f.requestSubmit();f.requestSubmit();});await page.keyboard.press('Escape');
 await check('pending command prevents duplicate native submissions and Escape',await page.$eval('[role="alertdialog"] button[type="submit"]',n=>n.disabled));
 await lock.query('rollback');lock.release();lock=null;
 await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'),{timeout:60000});page.off('request',count);await check('exactly one server command on pending retry',commands,1);
 const {rows:[submitted]}=await pool.query('select status from employee_document_request where id=$1 and organization_id=$2',[requestId,actor.organizationId]);await check('submission status persists',submitted.status,'submitted');
 const {rows:submissions}=await pool.query('select note from employee_document_request_submission where request_id=$1 and organization_id=$2',[requestId,actor.organizationId]);await check('one persisted submission retains note',submissions.map(s=>s.note),['Synthetic retained submission note']);
 await go();await check('submitted note reads back through actual page',await page.evaluate(()=>document.body.innerText.includes('Synthetic retained submission note')));
 await check('no client runtime exceptions',evidence.errors,[]);await page.screenshot({path:join(out,'after-submitted.png'),fullPage:true});
}catch(error){evidence.failure=error.message;await save();throw error;}
finally{if(lock){await lock.query('rollback');lock.release();}await pool.query('update organization set personnel_files_enabled=true where id=$1',[fixture.actors['small-employee'].organizationId]);await save();await browser.close();await pool.end();}
console.log('Actual employee actions: '+evidence.checks.length+' assertions passed.');
