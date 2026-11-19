import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const repo=process.cwd(), fixture=resolve(process.argv[2]), out=join(repo,'docs/design/rollout-1692/1723');
const require=createRequire(join(repo,'package.json')), puppeteer=require('puppeteer-core');
const runtime=JSON.parse(await readFile(join(fixture,'runtime-private.json'))), auth=JSON.parse(await readFile(join(fixture,'dev-auth-private.json')));
assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources:{},observations:[],errors:[],captures:[]};
for(const file of ['apps/webapp/src/components/notifications/notifications-inbox.tsx','apps/webapp/src/components/notifications/notification-item.tsx','apps/webapp/src/hooks/use-notifications.ts','apps/webapp/src/lib/navigation/route-metadata.ts']) report.sources[file]=createHash('sha256').update(await readFile(join(repo,file))).digest('hex');
const record=(name,value)=>report.observations.push({name,value});
try {
 const context=await browser.createBrowserContext(); await context.overridePermissions(runtime.origin,[]); await context.setCookie(...auth['small-admin'].cookies); const page=await context.newPage(); page.on('pageerror',e=>report.errors.push(e.message)); await page.setViewport({width:1600,height:1000});
 const go=async()=>{await page.goto(new URL('/en/notifications',runtime.origin).href,{waitUntil:'networkidle0'}); await page.waitForSelector('[aria-label="Select Security update"]');await page.evaluate(()=>document.fonts.ready);};
 const click=async text=>{const handles=await page.$$('button');for(const h of handles){if(await h.evaluate((n,text)=>n.textContent.trim()===text,text)){await h.click();return;}}throw Error(`Missing button ${text}`);};
 const search=async text=>{await page.$eval('input[aria-label="Search notifications"]',(n,text)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(n,text); n.dispatchEvent(new Event('input',{bubbles:true}));},text);};
 const waitText=async text=>{try {await page.waitForFunction(text=>document.body.innerText.includes(text),{},text);} catch(e){report.failedExpectation=text;report.failedDom=await page.evaluate(()=>document.querySelector('main')?.innerText);await shot('failure-attempt');throw e;}};
 const read=async(p=page)=>p.evaluate(async()=>{const r=await fetch('/api/notifications?limit=100');return {status:r.status,...await r.json()};});
 const check=async(label,expected)=>{const r=await read();assert.equal(r.status,200);assert.equal(r.total,expected);record(label,{total:r.total,unread:r.unreadCount});return r;};
 const shot=async label=>{await page.evaluate(()=>document.fonts.ready);const path=join(out,`task-${label}.png`);await page.screenshot({path,fullPage:true});const bytes=await readFile(path);report.captures.push({label,png:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)},sha256:createHash('sha256').update(bytes).digest('hex'),dom:await page.evaluate(()=>({text:document.querySelector('main')?.innerText,css:{width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth},font:getComputedStyle(document.body).fontFamily,fontSize:getComputedStyle(document.documentElement).fontSize,theme:document.documentElement.className}))});};
 await go(); await check('actual initial read',4);
 await click('Unread'); await page.waitForFunction(()=>document.querySelectorAll('li [aria-label^="Select "]').length===3);record('Unread filter',3);
 await click('Read');await page.waitForFunction(()=>document.querySelectorAll('li [aria-label^="Select "]').length===1);record('Read filter',1);await click('All');
 await search('no such notification');await waitText('No matching notifications');await shot('no-match');await search('');
 await page.waitForSelector('[aria-label="Select all visible notifications"]');await page.click('[aria-label="Select all visible notifications"]');await search('Security update');await page.waitForFunction(()=>document.querySelectorAll('li [aria-label^="Select "]').length===1);await click('Mark read');await waitText('Marked 1 notifications as read');assert.equal((await check('visible-only mark read',4)).unreadCount,2);await search('');
 await page.waitForSelector('[aria-label="Select Earlier update"]');
 await page.$eval('[aria-label="Select Earlier update"]',n=>n.closest('li').querySelector('button[aria-label="Delete"]').click());
 await waitText('Deleted 1 notifications');await check('per-item delete readback',3);
 // Hold one genuine mutation transport failure; the other real mutation commits.
 await page.click('[aria-label="Select Security update"]');await page.click('[aria-label="Select Schedule published"]');
 const current=await read();const failId=current.notifications.find(n=>n.title==='Schedule published').id;
 let refused=false;await page.setRequestInterception(true);
 const intercept=request=>{if(request.method()==='DELETE'){record('mutation transport',{path:new URL(request.url()).pathname,hasBody:Boolean(request.postData())});if(new URL(request.url()).pathname.replace(/\/$/,'')==='/api/notifications'&&request.postData()&&JSON.parse(request.postData()).id===failId){refused=true;return request.abort('failed');}}return request.continue();};page.on('request',intercept);
 await click('Delete');await waitText('1 deleted; 1 failed. Retry the remaining selection.');assert.equal((await read()).total,2);await shot('partial-delete');record('bulk partial actual readback',{total:2,failedSelected:await page.$eval('[aria-label="Select Schedule published"]',n=>n.getAttribute('aria-checked'))});
 assert.equal(refused,true);page.off('request',intercept);await page.setRequestInterception(false);await click('Delete');await waitText('Deleted 1 notifications');await check('retry remaining deletion',1);
 // Existing stored destination, keyboard activation, then actual return read.
 const open=await page.$('li button:not([aria-label])');await open.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>location.pathname.endsWith('/settings/security'));record('stored destination',new URL(page.url()).pathname);
 await page.goto(new URL('/en/notifications',runtime.origin).href,{waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="Select Absence approved"]');await check('round-trip notification read',1);
 // Abort reads only: cached records remain during failure; Retry reaches the real reader.
 let failReads=true;await page.setRequestInterception(true);const failRequest=req=>req.url().includes('/api/notifications?')&&failReads?req.abort('failed'):req.continue();page.on('request',failRequest);
 await click('Refresh');await waitText('Could not load notifications');assert.ok(await page.$('[aria-label="Select Absence approved"]'));await shot('failed-refresh');failReads=false;await click('Retry');await page.waitForFunction(()=>!document.body.innerText.includes('Could not load notifications'));record('refresh/retry',{retained:true,recovered:true});page.off('request',failRequest);await page.setRequestInterception(false);
 await page.setViewport({width:390,height:844});await page.evaluate(()=>{localStorage.setItem('theme','dark');localStorage.setItem('z8-font-size','large');});await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('[aria-label="Select Absence approved"]');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'18px');
 const trigger=await page.$('button[data-sidebar="trigger"]');assert.ok(trigger);await trigger.click();await page.waitForSelector('[role="dialog"]');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));record('current-route first Escape',{closed:true,focusReturned:await trigger.evaluate(n=>document.activeElement===n)});
 await page.$eval('[aria-label="Select Absence approved"]',n=>n.scrollIntoView({block:'center'}));await shot('last-record-phone-dark');
 // Separate actors exercise the same authorized page and reject another recipient's IDs.
 const foreignId=(await read()).notifications[0].id;
 for(const role of ['small-manager','small-employee','small-restricted']){
 const c=await browser.createBrowserContext();await c.overridePermissions(runtime.origin,[]);await c.setCookie(...auth[role].cookies);const p=await c.newPage();await p.goto(new URL('/en/notifications',runtime.origin).href,{waitUntil:'networkidle0'});await p.waitForSelector('[aria-label="Select Security update"]');const r=await read(p);assert.equal(r.total,4);
 const denied=await p.evaluate(async id=>{const results=[];for(const method of ['PATCH','DELETE']){const r=await fetch('/api/notifications',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});results.push(r.status);}const stale=await fetch('/api/notifications',{headers:{'x-z8-notification-organization':'another-organization'}});return {foreign:results,scope:stale.status};},foreignId);assert.deepEqual(denied,{foreign:[404,404],scope:409});record(role,{admitted:true,own:4,...denied});await c.close();
 }
 // Connected Next diagnostics are separate from DOM and native React evidence.
 const mcp=async(method,params)=>{const r=await fetch(new URL('/_next/mcp',runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});const raw=await r.text();return r.headers.get('content-type')?.includes('text/event-stream')?JSON.parse(raw.split(/\r?\n/).find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(raw);};
 report.next=[];for(const name of ['get_project_metadata','get_routes','get_page_metadata','get_compilation_issues','get_errors']) report.next.push({name,result:await mcp('tools/call',{name,arguments:{}})});
}catch(e){report.failure=e.message;throw e;}finally{await browser.close();await writeFile(join(out,'tasks.json'),JSON.stringify(report,null,2)+'\n');}
console.log(`Recorded ${report.observations.length} real task observations and ${report.captures.length} captures.`);
