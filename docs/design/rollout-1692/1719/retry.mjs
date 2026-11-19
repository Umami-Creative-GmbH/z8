// Run only after the root's panel-feedback correction has been merged locally.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible,waitVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
const out=join(repo,'docs/design/rollout-1692/1719'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();await page.setViewport({width:1600,height:1000});
const evidence={checks:[],errors:[]};page.on('pageerror',e=>evidence.errors.push({message:e.message,stack:e.stack}));let renamed=false;
const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);evidence.checks.push({name,actual});};
const click=s=>clickVisible(page,s,30000);
const go=()=>page.goto(new URL('/en/equipment/employees/'+fixture.actors['small-employee'].employeeId,runtime.origin).href,{waitUntil:'networkidle2',timeout:120000});
try{
 await go();await page.waitForFunction(()=>document.querySelector('tbody')?.textContent.includes('1 / 3'),{timeout:120000});
 const rows=await page.$$('tbody tr');let menu,assignmentId;for(const row of rows)if(await row.evaluate(n=>n.textContent.includes('1 / 3')&&n.textContent.includes('Fixture shirts'))){menu=await row.$('button[aria-label="Actions for Fixture shirts"]');assignmentId=await row.$eval('a',n=>new URL(n.href).pathname.split('/').at(-1));}assert.ok(menu);assert.ok(assignmentId);
 await menu.click();await click('[role="menuitem"]::-p-text(Record receipt)');await page.waitForSelector('[role="dialog"]');
 const fill=async(label,value)=>{const selector=await page.evaluate(label=>{const id=[...document.querySelectorAll('[role="dialog"] label')].find(n=>n.textContent.trim().startsWith(label))?.htmlFor;return `[id="${id}"]`;},label);await page.$eval(selector,(n,value)=>{Object.getOwnPropertyDescriptor(n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}));},value);return selector;};
 await fill('Actual handover date','2026-11-14');const notes=await fill('Notes (optional)','R021 merged pointer receipt');const mounted=await page.$(notes);
 await pool.query('alter table equipment_command rename to equipment_command_r021_retry_unavailable');renamed=true;
 await(await waitVisible(page,'[role="dialog"] button[type="submit"]')).focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('could not'),{timeout:120000});
 check('inline failure retains the same mounted notes input',await page.$eval(notes,(n,prior)=>n===prior,mounted));check('inline failure retains draft',await page.$eval(notes,n=>n.value),'R021 merged pointer receipt');check('panel failure does not create error toast',await page.$$eval('[data-sonner-toast][data-type="error"]',ns=>ns.length),0);await page.screenshot({path:join(out,'after-merged-inline-failure.png'),fullPage:false});
 await pool.query('alter table equipment_command_r021_retry_unavailable rename to equipment_command');renamed=false;
 const submit=await waitVisible(page,'[role="dialog"] button[type="submit"]');
 await submit.scrollIntoView();const point=await submit.evaluate(n=>{const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.move(point.x,point.y);
 // Next's independent development Rendering layer may reappear on hover.
 await page.waitForFunction(({x,y})=>{const b=document.querySelector('[role="dialog"] button[type="submit"]'),hit=document.elementFromPoint(x,y);return b&&(b===hit||b.contains(hit));},{timeout:30000},point);
 evidence.pointerTarget=await submit.evaluate(n=>{const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{receivesPointer:hit===n||n.contains(hit),hitTag:hit?.tagName};});
 let requests=0;page.on('request',r=>{if(r.method()==='POST'&&r.headers()['next-action']&&r.postData()?.includes(assignmentId))requests++;});
 await page.evaluate(()=>{window.__r021Pointer=[];document.addEventListener('pointerdown',e=>window.__r021Pointer.push({trusted:e.isTrusted,button:e.target.closest('button')?.textContent.trim()}),{once:true,capture:true});});
 await page.mouse.down();await page.mouse.up();await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'),{timeout:120000});evidence.pointerEvents=await page.evaluate(()=>window.__r021Pointer);evidence.pointerCommandRequests=requests;check('one native pointer retry command',requests,1);check('actual pointer retry closes accepted panel',true);
 await go();await page.waitForFunction(()=>document.querySelector('tbody')?.textContent.includes('0 / 3'),{timeout:120000});check('receipt persists in unchanged three-record history',await page.$$eval('tbody tr',ns=>ns.length),3);check('only the new two-of-three holding remains outstanding',await page.$eval('button[aria-label="Show outstanding returns"]',n=>n.textContent.trim()),'Outstanding returns1');await page.screenshot({path:join(out,'after-merged-pointer-readback.png'),fullPage:false});
 check('no fresh browser exceptions',evidence.errors,[]);
}catch(error){await page.screenshot({path:join(out,'merged-retry-harness-failure.png'),fullPage:false});throw error;}
finally{if(renamed)await pool.query('alter table equipment_command_r021_retry_unavailable rename to equipment_command');await writeFile(join(out,'retry.json'),JSON.stringify(evidence,null,2));await browser.close();await pool.end();}
