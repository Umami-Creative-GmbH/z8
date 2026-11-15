import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
import {clickVisible,prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),out=join(repo,'docs/design/rollout-1692/1730');
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const result={checks:[],errors:[]},save=()=>writeFile(join(out,'actions-runtime.json'),JSON.stringify(result,null,2)+'\n');
const check=async(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);result.checks.push({name,actual});await save();};
const owner=fixture.actors['small-admin'];
try {
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();await page.setViewport({width:1600,height:1000});page.on('pageerror',error=>result.errors.push(error.message));
 const click=async selector=>{await page.waitForSelector(selector);await page.$eval(selector,e=>e.scrollIntoView({block:"center"}));return clickVisible(page,selector,30000);};
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=all&pageSize=10',{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.body.innerText.includes('R047 record'));
 await check('one semantic route heading',await page.$$eval('main h1',nodes=>nodes.length),1);
 await check('organization calendar explicitly shown',await page.evaluate(()=>document.body.innerText.includes('Pacific/Kiritimati')));
 const initial=await page.$$eval('ul.divide-y>li',nodes=>nodes.map(n=>n.innerText));await check('first server page has ten request records',initial.length,10);
 await page.focus('button[aria-label="Next page"]');await page.keyboard.press('Enter');await page.waitForFunction(()=>new URL(location.href).searchParams.get('page')==='2');
 await page.waitForFunction(first=>document.querySelector('ul.divide-y>li')?.innerText!==first,initial[0]);
 await check('next page retains filters',new URL(page.url()).searchParams.get('status'),'all');
 await click('button::-p-text(Only overdue)');await page.waitForFunction(()=>new URL(location.href).searchParams.get('overdue')==='1');
 await check('overdue filter resets page',new URL(page.url()).searchParams.get('page'),null);
 await page.waitForFunction(()=>[...document.querySelectorAll('ul.divide-y>li')].every(n=>n.innerText.includes('Overdue')&&n.innerText.includes('Open')));
 await check('overdue rows keep open distinction',true);
 await click('button::-p-text(Request from several)');await page.waitForSelector('[role="dialog"] input');
 await writeFile(join(out,'bulk-controls.json'),JSON.stringify(await page.$eval('[role="dialog"]',d=>({buttons:[...d.querySelectorAll('button')].map(b=>({text:b.textContent,aria:b.getAttribute('aria-label'),role:b.getAttribute('role')})),inputs:[...d.querySelectorAll('input,textarea')].map(i=>({id:i.id,type:i.type,name:i.name}))})),null,2));
 await page.screenshot({path:join(out,'bulk-panel.png')});
 const title='R047 public bulk '+randomUUID().slice(0,8);
 await page.type('[role="dialog"] input[id$="-form-item"]',title);
 await page.type('[role="dialog"] textarea','Please supply the new certificate.');
 // Choose an offered team through its existing switch; recipients are recomputed by the real server action.
 await click('[role="dialog"] [role="switch"]');
 await click('[role="dialog"] button[aria-required="true"]');
 await writeFile(join(out,'calendar-controls.json'),JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('[role="grid"] button')].map(b=>({text:b.textContent,aria:b.getAttribute('aria-label'),disabled:b.disabled}))),null,2));
 const day=await page.$('[role="grid"] button:not([disabled])');assert.ok(day);await day.click();
 let release;const held=new Promise(done=>release=done);let hold=true,requests=0;
 await page.setRequestInterception(true);
 page.on('request',async request=>{if(hold&&request.method()==='POST'&&request.headers()['next-action']&&request.postData()?.includes(title)){requests++;await held;}if(!request.isInterceptResolutionHandled())await request.continue();});
 await click('[role="dialog"] button[type="submit"]');
 await page.waitForFunction(()=>document.querySelector('[role="dialog"] button[type="submit"]')?.disabled);
 await page.keyboard.press('Escape');await check('pending bulk cannot escape-dismiss',!!await page.$('[role="dialog"]'));
 await page.$eval('[role="dialog"] button[type="submit"]',b=>b.click());await check('one pending request admitted',requests,1);
 hold=false;release();
 await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.innerText.includes('Documents requested'));
 await check('bulk result gives actual counts',await page.$eval('[role="dialog"]',d=>/document requests? created/.test(d.innerText)));
 const {rows}=await pool.query('select id,status from employee_document_request where organization_id=$1 and title=$2',[owner.organizationId,title]);
 await check('public bulk action persisted real requests',rows.length>0);
 result.publicBulk={created:rows.length,statuses:[...new Set(rows.map(r=>r.status))],qualification:'Readback after actual browser action; initial R047 records and enabled feature are SQL seeds.'};
 await page.screenshot({path:join(out,'bulk-created.png')});
 await click('[role="dialog"] button::-p-text(Close)');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 // Decisions remain the shared real action owners.
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=submitted&pageSize=10',{waitUntil:'networkidle2'});
 const target=await page.$eval('ul.divide-y>li',li=>li.innerText.match(/R047 record \d+/)[0]);
 await click('button[aria-label="Return '+target+'"]');await page.waitForSelector('[role="alertdialog"] textarea');
 await click('[role="alertdialog"] button[type="submit"]');await page.waitForFunction(()=>document.querySelector('[role="alertdialog"]')?.innerText.includes('Enter a reason.'));
 await check('real return requires reason',true);await page.type('[role="alertdialog"] textarea','R047 public return: please include the current date.');
 await click('[role="alertdialog"] button[type="submit"]');await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'));
 const {rows:[returned]}=await pool.query('select id,status,version from employee_document_request where organization_id=$1 and title=$2',[owner.organizationId,target]);await check('return reopens actual request',returned.status,'open');
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=open&pageSize=10',{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.body.innerText.includes('Returned for resubmission'));await check('returned event distinct from current open state',true);
 await click('button[aria-label="Cancel '+target+'"]');await page.waitForSelector('[role="alertdialog"]');
 await writeFile(join(out,'cancel-controls.json'),JSON.stringify(await page.$eval('[role="alertdialog"]',d=>({text:d.innerText,inputs:[...d.querySelectorAll('textarea,input')].map(i=>i.outerHTML),buttons:[...d.querySelectorAll('button')].map(b=>({text:b.textContent,type:b.type}))})),null,2));
 await page.type('[role="alertdialog"] textarea','R047 public cancellation.');await click('[role="alertdialog"] button[type="submit"]');await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'));
 const {rows:[cancelled]}=await pool.query('select status from employee_document_request where id=$1',[returned.id]);await check('cancel persists cancelled distinction',cancelled.status,'cancelled');
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=submitted',{waitUntil:'networkidle2'});
 const acceptTitle=await page.$eval('ul.divide-y>li',li=>li.innerText.match(/R047 record \d+/)[0]);await click('button[aria-label="Accept '+acceptTitle+'"]');await page.waitForSelector('[role="alertdialog"]');await click('[role="alertdialog"] button::-p-text(Accept)');await page.waitForFunction(()=>!document.querySelector('[role="alertdialog"]'));
 const {rows:[accepted]}=await pool.query('select status from employee_document_request where organization_id=$1 and title=$2',[owner.organizationId,acceptTitle]);await check('accept persists accepted distinction',accepted.status,'accepted');
 const restricted=await browser.createBrowserContext();await prepareFixtureBrowserContext(restricted,runtime.origin);await restricted.setCookie(...auth['small-restricted'].cookies);const denied=await restricted.newPage();await denied.goto(runtime.origin+'/en/personnel-files/document-requests',{waitUntil:'networkidle2'});
 await check('employee with no officer coverage cannot read the officer queue',await denied.evaluate(()=>!document.body.innerText.includes('R047 record')&&!document.body.innerText.includes('Request from several')));
}catch(error){result.failure=error.message;throw error;}finally{await save();await browser.close();await pool.end();}



