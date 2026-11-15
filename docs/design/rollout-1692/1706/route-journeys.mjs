// Real navigation/custom-period/keyboard reads. No successful payload substitution.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1706');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),auth=await json('dev-auth-private.json');
assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});await page.emulateTimezone('America/Los_Angeles');
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const requests=[];page.on('request',r=>{if(r.headers()['next-action']) requests.push(r.postData());});
 const click=async(text,selector='button')=>{await page.waitForFunction((t,s)=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length&&(n.textContent.trim()===t||n.getAttribute('aria-label')===t)),{},text,selector);const h=await page.evaluateHandle((t,s)=>[...document.querySelectorAll(s)].find(n=>n.getClientRects().length&&(n.textContent.trim()===t||n.getAttribute('aria-label')===t)),text,selector);await h.asElement().focus();await page.keyboard.press('Enter');await h.dispose();};
 const settle=()=>page.waitForFunction(()=>document.querySelector('section[aria-label="Employee Work Hours"]')&&!document.querySelector('[aria-label="Loading work hours analytics data"]'));
 await page.goto(runtime.origin+'/en/analytics/work-hours',{waitUntil:'networkidle0',timeout:120000});await settle();
 await click('Period');await click('Last Year','[role=option]');await settle();await page.waitForNetworkIdle({idleTime:500});
 // The browser's timezone differs from the business zone. Berlin January 1 is still December 31 UTC.
 assert.ok(requests.some(r=>r.includes('2024-12-31T23:00:00.000Z')&&r.includes('2025-12-31T22:59:59.999Z')));
 const daily=await page.$('summary');await daily.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('details').open);const dailyRows=await page.$$eval('table[aria-label="Daily Work Hours"] tbody tr',rows=>rows.map(r=>r.innerText));assert.equal(dailyRows.length,261);assert.ok(dailyRows[0].includes('64h'));
 await page.screenshot({path:join(out,'after-keyboard-values.png')});
 await click('Period');await click('Custom Range','[role=option]');
 // A real supported selection; calendar boundary remains organization-local even in a Los Angeles browser.
 const days=await page.$$eval('button[aria-label]',nodes=>nodes.filter(n=>n.getClientRects().length&&n.getAttribute('aria-label').includes('January')).map(n=>n.getAttribute('aria-label')));
 const date=days.find(s=>s.includes('January 2nd, 2025'));assert.ok(date);await click(date);await page.keyboard.press('Escape');await settle();await page.waitForNetworkIdle({idleTime:500});
 const range=await page.$eval('main',n=>n.innerText);assert.ok(range.includes('Custom Range'));assert.ok(range.includes('Jan 1, 2025 - Jan 2, 2025'));
 assert.ok(requests.some(r=>r.includes('2024-12-31T23:00:00.000Z')&&r.includes('2025-01-02T22:59:59.999Z')));
 const customRows=await page.$$eval('section table tbody tr',rows=>rows.map(n=>n.innerText));assert.equal(customRows.length,8);await page.screenshot({path:join(out,'after-custom-range.png')});
 await page.evaluate(()=>{window.__downloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob instanceof Blob)void blob.arrayBuffer().then(bytes=>window.__downloads.push([...new Uint8Array(bytes)]));return original(blob);};});
 let failExport=true;await page.setRequestInterception(true);page.on('request',r=>{if(failExport&&r.url().endsWith('/api/analytics/export')){void r.abort('failed');return;}void r.continue();});
 await click('Export');await click('Export as CSV','[role=menuitem]');await page.waitForFunction(()=>document.body.innerText.includes('Failed to export as CSV'));assert.equal(await page.evaluate(()=>window.__downloads.length),0);assert.ok((await page.$eval('main',n=>n.innerText)).includes('Custom Range'));
 failExport=false;await click('Export');const exported=page.waitForResponse(r=>r.url().endsWith('/api/analytics/export'));await click('Export as CSV','[role=menuitem]');const response=await exported;assert.equal(response.status(),200);const payload=JSON.parse(response.request().postData());assert.equal(payload.data.length,8);assert.ok(payload.data.every(e=>e.totalHours===16&&e.overtimeHours===0&&e.undertimeHours===0&&e.avgHoursPerWeek===40));await page.waitForFunction(()=>window.__downloads.length===1);const bytes=Buffer.from(await page.evaluate(()=>window.__downloads.shift()));await writeFile(join(out,'actual-custom-export.csv'),bytes);await writeFile(join(out,'export-recovery-runtime.json'),JSON.stringify({range:'2025-01-01 / 2025-01-02 Europe/Berlin',failedTransport:{downloads:0,rangeRetained:true},retry:{status:200,downloads:1,rows:8,hoursPerEmployee:16,filename:payload.filename,bytes:bytes.length},headers:payload.headers},null,2)+'\n');
 await click('Overview','[role=tab]');await page.waitForFunction(()=>location.pathname.endsWith('/analytics')&&document.querySelector('h1')?.textContent==='Analytics');
 await click('Work Hours','[role=tab]');await page.waitForFunction(()=>location.pathname.endsWith('/analytics/work-hours')&&document.querySelector('h1')?.textContent==='Work Hours');await settle();assert.equal(await page.$eval('h1',n=>n.textContent),'Work Hours');assert.equal(await page.$eval('[role=tab][aria-selected=true]',n=>n.textContent),'Work Hours');
 const navigation={path:new URL(page.url()).pathname,title:await page.$eval('h1',n=>n.textContent),selectedTab:await page.$eval('[role=tab][aria-selected=true]',n=>n.textContent)};
 assert.deepEqual(errors,[]);await writeFile(join(out,'route-journeys-runtime.json'),JSON.stringify({businessZone:'Europe/Berlin',browserZone:'America/Los_Angeles',presetBoundary:'2024-12-31T23:00:00.000Z / 2025-12-31T22:59:59.999Z',dailyRows:dailyRows.length,firstDailyRow:dailyRows[0],customRange:'2025-01-01 / 2025-01-02',customBoundary:'2024-12-31T23:00:00.000Z / 2025-01-02T22:59:59.999Z',customRows,navigation,errors},null,2)+'\n');console.log('Verified real custom range, explicit business zone in another browser zone, daily keyboard disclosure and soft Overview/Work Hours navigation.');
} finally {await browser.close();}
