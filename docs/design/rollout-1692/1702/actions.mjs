// Actual browser reads, exports, held/aborted transports and persisted preferences.
// pnpm node docs/design/rollout-1692/1702/actions.mjs <private-fixture-directory>
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]), out=resolve('docs/design/rollout-1692/1702');
const json=async f=>JSON.parse(await readFile(join(dir,f),'utf8'));
const runtime=await json('runtime-private.json'),fixture=await json('fixture-private.json'),auth=await json('dev-auth-private.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const observations=[],errors=[];
const mcp=async(name,args={})=>{const r=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});const raw=await r.text();return JSON.parse(raw.split(/\r?\n/).find(x=>x.startsWith('data: '))?.slice(6)??raw);};
try{
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1600,height:1000});
 const click=async(text,selector='button')=>{const h=await page.evaluateHandle((text,selector)=>[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length&&(n.textContent.trim()===text||n.getAttribute('aria-label')===text)),text,selector);assert.ok(h.asElement(),text);await h.asElement().focus();await page.keyboard.press('Enter');await h.dispose();};
 const waitText=text=>page.waitForFunction(text=>document.body.innerText.includes(text),{},text);
 const capture=async name=>page.screenshot({path:join(out,'after-'+name+'.png')});
 const go=()=>page.goto(runtime.origin+'/en/analytics',{waitUntil:'networkidle0',timeout:120000});
 const ids=new Set();page.on('request',r=>{if(r.headers()['next-action'])ids.add(r.headers()['next-action']);});
 await go();await waitText('Total Employees');
 await click('Period');await page.waitForSelector('[role=option]');await click('Last Year','[role=option]');await waitText('2088.0h');
 let managerId;
 for(const id of ids){const result=await mcp('get_server_action_by_id',{actionId:id});if(JSON.stringify(result).includes('getManagerEffectivenessData'))managerId=id;}
 assert.ok(managerId,'Actual manager server action identified through Next MCP');
 await page.evaluate(()=>{window.__analyticsDownloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob instanceof Blob)void blob.arrayBuffer().then(bytes=>window.__analyticsDownloads.push([...new Uint8Array(bytes)]));return original(blob);};});
 // Exact existing team dataset, three existing columns, both actual binary transports.
 for(const format of ['CSV','Excel']){
  await click('Export');await page.waitForSelector('[role=menuitem]');
  const received=page.waitForResponse(r=>r.url().endsWith('/api/analytics/export')&&r.request().method()==='POST');
  await click('Export as '+format,'[role=menuitem]');const r=await received;assert.equal(r.status(),200);
  const payload=JSON.parse(r.request().postData());assert.deepEqual(payload.headers.map(x=>x.key),['teamName','totalHours','employeeCount']);assert.equal(payload.data.length,2);assert.equal(payload.data.reduce((sum,x)=>sum+x.totalHours,0),16704);assert.equal(payload.data.reduce((sum,x)=>sum+x.employeeCount,0),8);
  await page.waitForFunction(()=>window.__analyticsDownloads.length>0);const bytes=Buffer.from(await page.evaluate(()=>window.__analyticsDownloads.shift()));if(format==='CSV'){const csv=bytes.toString('utf8');assert.ok(csv.includes('Fixture team 0'));assert.ok(!csv.includes('Fixture home office'));}else assert.equal(bytes.subarray(0,2).toString(),'PK');
  await writeFile(join(out,format==='CSV'?'actual-team-export.csv':'actual-team-export.xlsx'),bytes);
  observations.push({export:format,status:r.status(),teams:payload.data.map(({teamName,totalHours,employeeCount})=>({teamName,totalHours,employeeCount})),bytes:bytes.length});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(n=>n.textContent.trim()==='Export'&&!n.disabled));
 }
 // Hold only the real manager analytics transport. Other results remain genuine.
 let held,hold=false,fail=false,ready;
 await page.setRequestInterception(true);page.on('request',r=>{if(r.headers()['next-action']===managerId){if(hold){held=r;ready?.();return;}if(fail){void r.abort('failed');return;}}void r.continue();});
 hold=true;const heldReady=new Promise(r=>ready=r);await click('Refresh data');await heldReady;
 await waitText('Refreshing analytics');assert.ok(await page.$('dl'));assert.ok(await page.evaluate(()=>document.body.innerText.includes('2088.0h')&&document.body.innerText.includes('2025')));await capture('refresh-pending');
 hold=false;fail=true;await held.abort('failed');await waitText('Some analytics could not be loaded');assert.ok(await page.evaluate(()=>document.body.innerText.includes('2088.0h')));await capture('refresh-failed');
 fail=false;await click('Retry');await page.waitForFunction(()=>!document.body.innerText.includes('Some analytics could not be loaded'));observations.push({refresh:'Held real manager read retained 2025 records; aborted transport exposed retry; retry read recovered'});
 // New-period unavailable source cannot be mistaken for zero/all-clear.
 fail=true;await click('Period');await page.waitForSelector('[role=option]');await click('Current Month','[role=option]');await waitText('Approval analytics could not be loaded');
 assert.ok(await page.evaluate(()=>document.body.innerText.includes('Unavailable')&&!document.body.innerText.includes('No approval bottlenecks found')));await capture('approval-unavailable');
 fail=false;await click('Retry');await page.waitForFunction(()=>!document.body.innerText.includes('Some analytics could not be loaded'));await waitText('No approval bottlenecks found');observations.push({unavailable:'Aborted new-period approval read showed Unavailable; actual retry restored successful zero/all-clear'});
 // Actual saved preferences, then reload and verify persistence.
 await click('Toggle theme');await page.waitForSelector('[role=menuitem]');await click('Dark','[role=menuitem]');
 await click('Account: Person 0');await page.waitForSelector('[role=menuitem]');await click('Font size','[role=menuitem]');await page.waitForSelector('[role=menuitemradio]');await click('Large','[role=menuitemradio]');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
 await page.waitForFunction(()=>getComputedStyle(document.documentElement).fontSize==='18px');await page.reload({waitUntil:'networkidle0'});await waitText('Total Employees');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'18px');assert.ok(await page.evaluate(()=>document.documentElement.classList.contains('dark')));
 await page.setViewport({width:390,height:844});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await capture('phone-dark-large');
 const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize}));assert.equal(layout.width,layout.documentWidth);observations.push({savedDarkLarge:layout});
 // Phone drawer, escape and focus return. Expanded/collapsed desktop shares range state.
 await click('Toggle Sidebar');await page.keyboard.press('Escape');
 await page.setViewport({width:1600,height:1000});await click('Toggle Sidebar');await capture('collapsed-dark-large');await click('Toggle Sidebar');
 await page.setViewport({width:800,height:500});await capture('zoom-equivalent');
 // Keyboard reaches real period and data disclosure, with visible native focus.
 await page.setViewport({width:1600,height:1000});await page.focus('[aria-label="Period"]');await page.keyboard.press('Tab');await capture('keyboard-focus');
 const names=[];
 for(const actor of ['small-manager','small-employee','small-restricted']){
  const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth[actor].cookies);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:390,height:844});await p.goto(runtime.origin+'/en/analytics',{waitUntil:'networkidle0',timeout:120000});
  const admitted=actor==='small-manager';await p.waitForFunction(admitted=>document.body.innerText.includes(admitted?'Total Employees':'Access Restricted'),{},admitted);const result=await p.evaluate(()=>({h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),restricted:document.body.innerText.includes('Access Restricted'),width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.deepEqual(result.h1,['Analytics']);assert.equal(result.restricted,!admitted);assert.equal(result.width,result.documentWidth);names.push({actor,...result});await p.screenshot({path:join(out,'after-'+actor+'.png')});await c.close();
 }
 observations.push({roles:names});
 const next=[];for(const name of ['get_project_metadata','get_routes','get_page_metadata','get_compilation_issues','get_errors'])next.push({name,result:await mcp(name)});
 await writeFile(join(out,'next-runtime.json'),JSON.stringify(next,null,2)+'\n');
 assert.deepEqual(errors,[]);await writeFile(join(out,'actions-runtime.json'),JSON.stringify({observations,errors},null,2)+'\n');console.log(JSON.stringify({observations,errors}));
}finally{await browser.close();}
