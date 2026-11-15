import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
import {clickVisible,waitVisible,prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core');
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8')),ids=JSON.parse(await readFile(join(dir,'1720-private.json'),'utf8'));
const out=join(repo,'docs/design/rollout-1692/1720'),evidence={checks:[],errors:[],captures:[]};
const paths=['apps/webapp/src/app/[locale]/(app)/my-documents/page.tsx','apps/webapp/src/components/personnel-file/requested-documents.tsx','apps/webapp/src/components/personnel-file/my-documents-list.tsx','apps/webapp/src/components/personnel-file/my-documents-scope.tsx','apps/webapp/src/components/personnel-file/document-dialog.tsx','apps/webapp/src/components/personnel-file/submit-document-request-dialog.tsx'];
evidence.source={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes:Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(join(repo,p))).digest('hex')])))};
const save=()=>writeFile(join(out,'variants.json'),JSON.stringify(evidence,null,2)+'\n');
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);evidence.checks.push({name,actual});await save();};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
let lock,grant;
const actor=fixture.actors['small-employee'],manager=fixture.actors['small-manager'];
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-employee'].cookies);
 const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
 const click=s=>clickVisible(page,s,30000),go=()=>page.goto(runtime.origin+'/en/my-documents',{waitUntil:'networkidle2'});
 const snap=async name=>{await page.evaluate(()=>document.fonts.ready);const metrics=await page.evaluate(()=>({css:[innerWidth,innerHeight],dpr:devicePixelRatio,font:getComputedStyle(document.documentElement).fontSize,theme:document.documentElement.className,width:document.documentElement.scrollWidth}));const file=name+'.png';await page.screenshot({path:join(out,file),fullPage:true});const sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');const png=await sharp(join(out,file)).metadata();evidence.captures.push({file,...metrics,png:[png.width,png.height]});await save();};
 await page.setViewport({width:1600,height:1000});await go();await page.waitForFunction(()=>document.body.innerText.includes('First aid certificate'));
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await page.waitForFunction(()=>localStorage.getItem('sidebar_state')==='false');await check('collapse shortcut preserves current route',new URL(page.url()).pathname,'/en/my-documents');
 await click('::-p-aria(Toggle theme)');await click('[role="menuitem"]::-p-text(Dark)');
 await click('[data-sidebar="footer"] button[data-slot="dropdown-menu-trigger"]');await click('[role="menuitem"]::-p-text(Font size)');await click('[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.innerText.includes('First aid certificate'));
 await check('actual saved 18px dark preference survives phone reload',await page.evaluate(()=>({font:localStorage.getItem('z8-font-size'),computed:getComputedStyle(document.documentElement).fontSize,dark:document.documentElement.classList.contains('dark')})),{font:'large',computed:'18px',dark:true});
 await check('saved-large phone has no document overflow',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-saved-18px-phone-dark');
 await (await waitVisible(page,'button[data-sidebar="trigger"]')).focus();await page.keyboard.press('Enter');await (await waitVisible(page,'[role="dialog"] a')).focus();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 await check('current-route first Escape closes phone navigation and returns focus',await page.evaluate(()=>document.activeElement?.matches('button[data-sidebar="trigger"]')));
 await click('button::-p-text(Upload document)');await page.waitForSelector('[role="dialog"] input[type="file"]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 await check('upload panel first Escape returns focus',await page.evaluate(()=>document.activeElement?.textContent.includes('Upload document')));await snap('after-current-route-focus');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await check('reduced-motion media is active',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches));
 await page.setViewport({width:2200,height:1100});await check('wide saved-large dark layout fits',await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth));await snap('after-saved-18px-wide-dark');
 // The feature is unavailable without altering any stored personnel records.
 await pool.query('update organization set personnel_files_enabled=false where id=$1',[actor.organizationId]);await go();await check('feature-off arrival hides shared records and upload',await page.evaluate(()=>!document.body.innerText.includes('First aid certificate')&&![...document.querySelectorAll('button')].some(b=>b.textContent==='Upload document')));await snap('after-feature-off');await pool.query('update organization set personnel_files_enabled=true where id=$1',[actor.organizationId]);
 // A manager is still an employee in their own file and has no default officer access.
 const managerContext=await browser.createBrowserContext();await prepareFixtureBrowserContext(managerContext,runtime.origin);await managerContext.setCookie(...auth['small-manager'].cookies);const other=await managerContext.newPage();await other.goto(runtime.origin+'/en/my-documents',{waitUntil:'networkidle2'});
 await check('manager own empty state keeps permitted upload',await other.evaluate(()=>document.body.innerText.includes('No documents have been shared with you yet.')&&[...document.querySelectorAll('button')].some(b=>b.textContent==='Upload document')));
 const access=id=>other.evaluate(async id=>(await fetch('/api/personnel-files/documents/'+id)).status,id);
 await check('manager cannot read another employee certificate',await access(ids.shared),404);
 const {rows:[admin]}=await pool.query('select user_id from employee where id=$1 and organization_id=$2',[fixture.actors['small-admin'].employeeId,actor.organizationId]);
 grant=randomUUID();await pool.query("insert into personnel_file_officer_grant(id,organization_id,officer_employee_id,scope,categories,created_by) values($1,$2,$3,'specific',ARRAY['certificate'],$4)",[grant,actor.organizationId,manager.employeeId,admin.user_id]);
 await pool.query('insert into personnel_file_officer_employee(organization_id,grant_id,employee_id,created_by) values($1,$2,$3,$4)',[actor.organizationId,grant,actor.employeeId,admin.user_id]);
 await check('scoped officer may read covered HR certificate',await access(ids.hr),200);
 await check('scoped officer cannot read uncovered payslip category',await access(ids.payslip),404);
 await check('scoped officer cannot read uncovered employee',await access(ids.foreign),404);
 await other.reload({waitUntil:'networkidle2'});await check('officer personal route still shows only own empty file',await other.evaluate(()=>document.body.innerText.includes('No documents have been shared with you yet.')&&!document.body.innerText.includes('HR confidential only')));
 await pool.query('update personnel_file_officer_grant set is_active=false where id=$1 and organization_id=$2',[grant,actor.organizationId]);await check('revoked scoped officer loses document access',await access(ids.hr),404);
 // Actual account replacement while a server read is held. This uses real fixture cookies;
 // no synthetic React state injection and no client-provided authorization payload.
 await go();await click('button::-p-text(Upload document)');await page.waitForSelector('[role="dialog"] input[type="file"]');
 lock=await pool.connect();await lock.query('begin');await lock.query('lock table employee_document_request in access exclusive mode');
 const pendingRead=page.evaluate(()=>fetch('/en/my-documents',{headers:{RSC:'1'}}).then(r=>r.status)).catch(()=>null);
 await context.setCookie(...auth['small-manager'].cookies);const navigation=page.reload({waitUntil:'domcontentloaded'});await lock.query('rollback');lock.release();lock=null;await navigation;await pendingRead;await page.waitForFunction(()=>document.body.innerText.includes('No documents have been shared with you yet.'));
 await check('held read and account change cannot restore former employee records or panel',await page.evaluate(()=>!document.body.innerText.includes('First aid certificate')&&!document.querySelector('[role="dialog"]')));await snap('after-account-switch');
 await check('no client exceptions in variant journey',evidence.errors,[]);
}catch(error){evidence.failure=error.message;await save();throw error;}
finally{if(lock){await lock.query('rollback');lock.release();}if(grant)await pool.query('update personnel_file_officer_grant set is_active=false where id=$1 and organization_id=$2',[grant,actor.organizationId]);await pool.query('update organization set personnel_files_enabled=true where id=$1',[actor.organizationId]);await save();await browser.close();await pool.end();}
console.log('Preferences, keyboard, role and scope journey: '+evidence.checks.length+' assertions passed.');
