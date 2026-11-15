// Real filters, grouping, exports, refresh failures/retry, preferences and roles.
// pnpm node docs/design/rollout-1692/1703/actions.mjs <private-fixture-directory>
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1703');
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
 const settled=()=>page.waitForFunction(()=>!document.querySelector('[aria-label="Loading overtime data"]')&&document.querySelector('dl'));
 const capture=n=>page.screenshot({path:join(out,'after-'+n+'.png')});
 const ids=new Set();page.on('request',r=>{if(r.headers()['next-action'])ids.add(r.headers()['next-action']);});
 await page.goto(runtime.origin+'/en/analytics/overtime-burn-down',{waitUntil:'networkidle0',timeout:120000});await settled();
 await click('Period');await click('Last Year','[role=option]');await settled();await page.waitForNetworkIdle({idleTime:500});
 let actionId;for(const id of ids)if(JSON.stringify(await mcp('get_server_action_by_id',{actionId:id})).includes('getOvertimeBurnDownData'))actionId=id;assert.ok(actionId);
 const select=async(label,option)=>{await click(label);await click(option,'[role=option]');await settled();};
 // All original grouping dimensions, with real values and no extra read for local grouping.
 for(const [option,heading] of [['By Team','Team'],['By Cost Center','Cost Center'],['By Manager','Manager']]){
  let count=0;const countAction=r=>{if(r.headers()['next-action']===actionId)count++;};page.on('request',countAction);
  await select('Breakdown dimension',option);assert.equal(count,0);page.off('request',countAction);
  const columns=await page.$$eval('table thead th',nodes=>nodes.map(n=>n.textContent));assert.equal(columns[0],heading);assert.equal(columns.length,5);
  observations.push({grouping:option,columns,rows:await page.$$eval('table tbody tr',nodes=>nodes.map(n=>n.innerText))});
 }
 await select('Breakdown dimension','By Team');
 // Exact team scope from genuine returned choices; execution remains immediate.
 await select('Team filter','Fixture team 0');
 assert.equal(await page.$$eval('table tbody tr',n=>n.length),1);
 await page.evaluate(()=>{window.__downloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob instanceof Blob)void blob.arrayBuffer().then(bytes=>window.__downloads.push([...new Uint8Array(bytes)]));return original(blob);};});
 for(const format of ['CSV','Excel']){
  await click('Export');const response=page.waitForResponse(r=>r.url().endsWith('/api/analytics/export')&&r.request().method()==='POST');await click('Export as '+format,'[role=menuitem]');const r=await response;assert.equal(r.status(),200);const payload=JSON.parse(r.request().postData());assert.deepEqual(payload.headers.map(x=>x.key),['dimension','currentOvertime','previousOvertime','weekOverWeek','trendDirection']);assert.equal(payload.data.length,1);assert.equal(payload.data[0].dimension,'Fixture team 0');assert.equal(payload.filename,'overtime-burndown-team-2025-01-01');
  await page.waitForFunction(()=>window.__downloads.length);const bytes=Buffer.from(await page.evaluate(()=>window.__downloads.shift()));assert.ok(bytes.length>0);if(format==='Excel')assert.equal(bytes.subarray(0,2).toString(),'PK');else assert.ok(bytes.toString().includes('Fixture team 0'));
  await writeFile(join(out,format==='CSV'?'actual-filtered-export.csv':'actual-filtered-export.xlsx'),bytes);observations.push({export:format,data:payload.data,headers:payload.headers,filename:payload.filename,bytes:bytes.length});
 }
 // Hold and abort only the actual overtime transport. No successful response is replaced.
 let hold=false,fail=false,held,ready;await page.setRequestInterception(true);page.on('request',r=>{if(r.headers()['next-action']===actionId){if(hold){held=r;ready?.();return;}if(fail){void r.abort('failed');return;}}void r.continue();});
 hold=true;const heldReady=new Promise(r=>ready=r);await click('Refresh data');await heldReady;await wait('Refreshing overtime data');assert.ok(await page.$('dl'));assert.ok(await page.evaluate(()=>document.body.innerText.includes('2025')&&document.querySelector('[aria-label="Team filter"]').textContent.includes('Fixture team 0')));await capture('refresh-pending');
 hold=false;fail=true;await held.abort('failed');await wait('Overtime data could not be loaded.');assert.ok(await page.$('dl'));await capture('refresh-failed');
 fail=false;await click('Retry');await page.waitForFunction(()=>!document.body.innerText.includes('Overtime data could not be loaded.'));await settled();observations.push({refresh:'Held genuine filtered 2025 read retained records, range and team; aborted read showed retry; real retry recovered'});
 // A new failed period cannot display or export old comparisons. Filter label stays.
 fail=true;await click('Period');await click('Current Month','[role=option]');await wait('Overtime data could not be loaded.');assert.equal(await page.$('dl'),null);assert.equal(await page.$eval('button',()=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='Export').disabled),true);assert.ok(await page.$eval('[aria-label="Team filter"]',n=>n.textContent.includes('Fixture team 0')));await capture('period-unavailable');fail=false;await click('Retry');await settled();
 // Exercise each actual filter using the returned authorized option, then restore ALL defaults.
 await select('Team filter','All teams');
 for(const label of ['Cost center filter','Manager filter']){
  await click(label);const choice=await page.evaluate(label=>[...document.querySelectorAll('[role=option]')].filter(x=>x.getClientRects().length).map(x=>x.textContent.trim()).find(x=>!x.startsWith('All ')&&(label==='Cost center filter'||x!=='Unassigned')),label);assert.ok(choice);console.log(JSON.stringify({filter:label,choice}));await click(choice,'[role=option]');await settled();observations.push({filter:label,choice,records:await page.$$eval('table tbody tr',n=>n.map(x=>x.innerText))});await click(label);await click(label==='Cost center filter'?'All cost centers':'All managers','[role=option]');await settled();
 }
 // Genuine saved settings, retained through reload. Existing theme/size owners unchanged.
 await click('Toggle theme');await click('Dark','[role=menuitem]');await click('Account: Person 0');await click('Font size','[role=menuitem]');await click('Large','[role=menuitemradio]');await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.reload({waitUntil:'networkidle0'});await settled();assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'18px');assert.ok(await page.evaluate(()=>document.documentElement.classList.contains('dark')));
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.setViewport({width:390,height:844});await capture('phone-dark-large');
 await click('Toggle Sidebar');await page.keyboard.press('Escape');await page.setViewport({width:1600,height:1000});await click('Toggle Sidebar');await capture('collapsed-dark-large');await click('Toggle Sidebar');await page.setViewport({width:800,height:500});await capture('zoom-equivalent');
 await page.setViewport({width:390,height:844});await page.$eval('table',n=>n.scrollIntoView());const scroll=await page.$eval('[data-slot=table-container]',n=>{n.scrollLeft=n.scrollWidth;return {width:n.clientWidth,scrollWidth:n.scrollWidth,scrollLeft:n.scrollLeft};});assert.ok(scroll.scrollLeft>0);await capture('phone-comparison-scroll');
 assert.equal(await page.evaluate(()=>innerWidth),await page.evaluate(()=>document.documentElement.scrollWidth));observations.push({preferences:'Real saved Dark/Large survived reload (18px), reduced motion, drawer Escape, collapsed shell and zoom-equivalent layout',comparisonScroll:scroll});
 await page.setViewport({width:1600,height:1000});await page.focus('summary');await page.keyboard.press('Enter');assert.ok(await page.$eval('details',n=>n.open));await capture('keyboard-values');observations.push({keyboard:'Native focus and Enter opened weekly values'});
 for(const actor of ['small-manager','small-employee','small-restricted']){
  const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth[actor].cookies);const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.setViewport({width:390,height:844});await p.goto(runtime.origin+'/en/analytics/overtime-burn-down',{waitUntil:'networkidle0',timeout:120000});const admitted=actor==='small-manager';await p.waitForFunction(admitted=>admitted?document.querySelector('dl'):document.body.innerText.includes('Access Restricted'),{},admitted);const result=await p.evaluate(()=>({h1:[...document.querySelectorAll('h1')].map(n=>n.textContent),restricted:document.body.innerText.includes('Access Restricted'),width:innerWidth,documentWidth:document.documentElement.scrollWidth}));assert.deepEqual(result.h1,['Overtime Burn-Down']);assert.equal(result.restricted,!admitted);assert.equal(result.width,result.documentWidth);observations.push({actor,...result});await p.screenshot({path:join(out,'after-'+actor+'.png')});await context.close();
 }
 const next=[];for(const name of ['get_project_metadata','get_routes','get_page_metadata','get_compilation_issues','get_errors'])next.push({name,result:await mcp(name)});await writeFile(join(out,'next-runtime.json'),JSON.stringify(next,null,2)+'\n');
 assert.deepEqual(errors,[]);await writeFile(join(out,'actions-runtime.json'),JSON.stringify({observations,errors},null,2)+'\n');console.log(JSON.stringify({observations,errors}));
}finally{await browser.close();}



