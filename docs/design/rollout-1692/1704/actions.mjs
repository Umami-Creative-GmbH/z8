// Real records, downloads, failed transports/recovery, saved preferences and role checks.
// pnpm node docs/design/rollout-1692/1704/actions.mjs <private-fixture-directory>
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1704');
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const observations=[],errors=[];
const mcp=async(name,args={})=>{const r=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const raw=await r.text();return JSON.parse(raw.split(/\r?\n/).find(x=>x.startsWith('data: '))?.slice(6)??raw);};
try{
 const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth['small-admin'].cookies);
 const page=await c.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:1000});
 const click=async(text,selector='button')=>{await page.waitForFunction((t,s)=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length&&(n.textContent.trim()===t||n.getAttribute('aria-label')===t)),{},text,selector);const h=await page.evaluateHandle((t,s)=>[...document.querySelectorAll(s)].find(n=>n.getClientRects().length&&(n.textContent.trim()===t||n.getAttribute('aria-label')===t)),text,selector);await h.asElement().focus();await page.keyboard.press('Enter');await h.dispose();};
 const wait=t=>page.waitForFunction(t=>document.body.innerText.includes(t),{},t);
 const settled=()=>page.waitForFunction(()=>!document.querySelector('[aria-label="Loading team performance data"]')&&document.body.innerText.includes('Team Performance Details'));
 const capture=n=>page.screenshot({path:join(out,'after-'+n+'.png')});
 const ids=new Set();page.on('request',r=>{if(r.headers()['next-action'])ids.add(r.headers()['next-action']);});
 await page.goto(runtime.origin+'/en/analytics/team-performance',{waitUntil:'networkidle0',timeout:120000});await settled();
 await click('Period');await click('Last Year','[role=option]');await settled();await page.waitForNetworkIdle({idleTime:500});
 let actionId;for(const id of ids)if(JSON.stringify(await mcp('get_server_action_by_id',{actionId:id})).includes('getTeamPerformanceData'))actionId=id;assert.ok(actionId);
 const rows=await page.$$eval('table tbody tr',nodes=>nodes.map(n=>n.innerText));assert.equal(rows.length,2);for(const row of rows){assert.ok(row.includes('8,352.0h'));assert.ok(row.includes('2,088.0h'));assert.ok(row.includes('On Track'));}observations.push({scope:'small-admin / 2025',rows});
 await page.evaluate(()=>{window.__downloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob instanceof Blob)void blob.arrayBuffer().then(bytes=>window.__downloads.push([...new Uint8Array(bytes)]));return original(blob);};});
 for(const format of ['CSV','Excel']){
  await click('Export');const response=page.waitForResponse(r=>r.url().endsWith('/api/analytics/export')&&r.request().method()==='POST');await click('Export as '+format,'[role=menuitem]');const r=await response;assert.equal(r.status(),200);const payload=JSON.parse(r.request().postData());assert.deepEqual(payload.headers.map(x=>x.key),['teamName','totalHours','avgHoursPerEmployee','employeeCount']);assert.equal(payload.data.length,2);assert.equal(payload.filename,'team-performance-2024-12-31');
  await page.waitForFunction(()=>window.__downloads.length);const bytes=Buffer.from(await page.evaluate(()=>window.__downloads.shift()));
  await writeFile(join(out,format==='CSV'?'actual-export.csv':'actual-export.xlsx'),bytes);observations.push({export:format,data:payload.data.map(({employees,...team})=>team),headers:payload.headers,filename:payload.filename,bytes:bytes.length});
 }
 const ExcelJS=createRequire(resolve('apps/webapp/package.json'))('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await readFile(join(out,'actual-export.xlsx')));
 const {Readable}=await import('node:stream');const csvBook=new ExcelJS.Workbook();const csvSheet=await csvBook.csv.read(Readable.from([await readFile(join(out,'actual-export.csv'))]));
 for(const sheet of [book.worksheets[0],csvSheet]){assert.equal(sheet.rowCount,3);assert.deepEqual([sheet.getRow(2).values.slice(1),sheet.getRow(3).values.slice(1)].sort((a,b)=>a[0].localeCompare(b[0])),[['Fixture team 0',8352,2088,4],['Fixture team 1',8352,2088,4]]);}
 let hold=false,fail=false,held,ready;await page.setRequestInterception(true);page.on('request',r=>{if(r.headers()['next-action']===actionId){if(hold){held=r;ready?.();return;}if(fail){void r.abort('failed');return;}}void r.continue();});
 hold=true;const heldReady=new Promise(r=>ready=r);await click('Refresh data');await heldReady;await wait('Refreshing team performance data');assert.ok(await page.$('table'));assert.equal(await page.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Export').disabled),true);await capture('refresh-pending');
 hold=false;fail=true;await held.abort('failed');await wait('Refresh failed. Showing previously loaded data');assert.ok(await page.$('table'));await capture('refresh-failed');
 fail=false;await click('Retry');await page.waitForFunction(()=>!document.body.innerText.includes('Refresh failed. Showing previously loaded data'));await settled();observations.push({refresh:'Held real 2025 read retained rows/range, disabled export; abort exposed stale warning; real Retry recovered'});
 fail=true;await click('Period');await click('Current Month','[role=option]');await wait('Failed to load team performance data');assert.equal(await page.$('table'),null);await capture('period-unavailable');fail=false;await click('Retry');await settled();observations.push({periodFailure:'New failed period removed old comparison and export; retry used new period'});
 // Actual zero-team scope belongs to the existing authorized owner; do not invent an empty response.
 await click('Toggle theme');await click('Dark','[role=menuitem]');await click('Account: Person 0');await click('Font size','[role=menuitem]');await click('Large','[role=menuitemradio]');await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle0'});await settled();assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'18px');assert.ok(await page.evaluate(()=>document.documentElement.classList.contains('dark')));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.setViewport({width:390,height:844});await capture('phone-dark-large');await click('Toggle Sidebar');await page.keyboard.press('Escape');
 await page.setViewport({width:1600,height:1000});await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await capture('collapsed-dark-large');await page.reload({waitUntil:'networkidle0'});await settled();assert.ok(await page.$('[data-state="collapsed"]'));await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');
 await page.setViewport({width:800,height:500});await capture('zoom-equivalent');await page.setViewport({width:390,height:844});
 const region=await page.$('section[aria-label="Team Performance Details"]');assert.ok(region);await region.focus();await page.keyboard.press('End');await page.keyboard.press('ArrowRight');
 const scroll=await region.evaluate(n=>{n.scrollLeft=n.scrollWidth;const identity=n.querySelector('tbody td').getBoundingClientRect();return {width:n.clientWidth,scrollWidth:n.scrollWidth,scrollLeft:n.scrollLeft,identityLeft:identity.left,regionLeft:n.getBoundingClientRect().left};});assert.ok(scroll.scrollLeft>0);assert.ok(Math.abs(scroll.identityLeft-scroll.regionLeft)<3);await capture('phone-comparison-scroll');assert.equal(await page.evaluate(()=>innerWidth),await page.evaluate(()=>document.documentElement.scrollWidth));observations.push({preferences:'Real Dark/Large saved and retained (18px); reduced motion; Ctrl+B persisted collapse; phone drawer Escape; zoom-equivalent viewport',comparisonScroll:scroll});
 for(const actor of ['small-manager','small-employee','small-restricted']){
  const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth[actor].cookies);const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:390,height:844});await p.goto(runtime.origin+'/en/analytics/team-performance',{waitUntil:'networkidle0',timeout:120000});const admitted=actor==='small-manager';await p.waitForFunction(admitted=>admitted?document.body.innerText.includes('Team Performance Details'):document.body.innerText.includes('Access Restricted'),{},admitted);const result=await p.evaluate(()=>({h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),restricted:document.body.innerText.includes('Access Restricted'),width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.deepEqual(result.h1,['Team Performance']);assert.equal(result.restricted,!admitted);assert.equal(result.width,result.documentWidth);observations.push({actor,...result});await p.screenshot({path:join(out,'after-'+actor+'.png')});await context.close();
 }
 const next=[];for(const name of ['get_project_metadata','get_routes','get_page_metadata','get_compilation_issues','get_errors'])next.push({name,result:await mcp(name)});await writeFile(join(out,'next-runtime.json'),JSON.stringify(next,null,2)+'\n');
 assert.deepEqual(errors,[]);await writeFile(join(out,'actions-runtime.json'),JSON.stringify({observations,errors},null,2)+'\n');console.log(JSON.stringify({observations,errors}));
}finally{await browser.close();}

