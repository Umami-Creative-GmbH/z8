import assert from 'node:assert/strict';import puppeteer from 'puppeteer-core';import {readFile,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
const dir=resolve('.tmp/1738-independent-checks'),meta=JSON.parse(await readFile(join(dir,'browser-controller-01.private.json'),'utf8'));
const browser=await puppeteer.connect({browserWSEndpoint:meta.websocket});const context=browser.browserContexts().find(c=>c.id===meta.contextId);if(!context)throw Error('Own current context only');const pages=await context.pages();const page=pages.find(p=>p.url().includes('/en/scheduling'));if(!page)throw Error('Admitted scheduling page required');
const session=await page.createCDPSession();const receipt={normalDevelopment:true,actualUI:true,transientSameContext:true};
try{
 const defaults=await page.evaluate(()=>({start:document.querySelector('#shift-dialog-start')?.value,end:document.querySelector('#shift-dialog-end')?.value,subarea:document.querySelector('#shift-dialog-subarea')?.textContent,template:document.querySelector('#shift-dialog-template')?.textContent}));assert.equal(defaults.start,'09:00');assert.equal(defaults.end,'17:00');assert.ok(defaults.subarea.includes('Independent reception'));receipt.defaults=defaults;
 await page.locator('#shift-dialog-notes').fill('Independent browser-created draft');
 const manifest=JSON.parse(await readFile(resolve('apps/webapp/.next/dev/server/server-reference-manifest.json'),'utf8'));const id=Object.entries(manifest.node).find(([,v])=>v.exportedName==='upsertShift')?.[0];if(!id)throw Error('Exact current write action not found');let calls=0;const listener=r=>{if(r.headers()['next-action']===id)calls++};page.on('request',listener);
 await session.send('Network.enable');await session.send('Network.emulateNetworkConditions',{offline:false,latency:2200,downloadThroughput:-1,uploadThroughput:-1});
 const submit=await page.$('[role=dialog] button[type=submit]');if(!submit)throw Error('Real visible form submit absent');await submit.click();
 await page.waitForFunction(()=>[...document.querySelectorAll('[role=dialog] button')].some(b=>b.disabled&&b.textContent.includes('Saving')));
 await page.keyboard.press('Escape');await submit.click().catch(()=>{});
 assert.ok(await page.$('[role=dialog]'));receipt.pending={savingDisabled:true,escapeRetained:true,duplicatePointerClickAttempted:true,latencyMs:2200};
 await page.waitForFunction(()=>!document.querySelector('[role=dialog]'),{timeout:30000});
 await session.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 page.off('request',listener);receipt.upsertRequests=calls;assert.equal(calls,1);await page.waitForFunction(()=>document.body.innerText.includes('Publish (2)'));
 receipt.closedAfterActualSave=true;receipt.draftCount=2;
 await writeFile(join(dir,'pending-create-result-01.json'),JSON.stringify(receipt,null,2),{flag:'wx'});console.log('Real template defaults, one latency-held create, disabled duplicate and pending Escape passed.');
} finally {await session.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}).catch(()=>{});await session.detach();await browser.disconnect();}
