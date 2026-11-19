import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1824');
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')),{token}=JSON.parse(await readFile(join(dir,'device-private.json'),'utf8'));
assert.match(runtime.origin,/^http:\/\/localhost:\d+$/);
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage(),evidence={checks:[],next:[]};
const wait=needle=>page.waitForFunction(needle=>document.querySelector('main')?.innerText.includes(needle),{timeout:45000},needle);
const click=async label=>{for(const b of await page.$$('main button'))if((await b.evaluate(n=>n.innerText.trim())).endsWith(label)){await b.click();return;}throw Error('Missing '+label);};
try{
 await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.goto(runtime.origin+'/en/kiosk',{waitUntil:'networkidle2'});await page.evaluate(token=>{localStorage.setItem('z8.kiosk.deviceToken',token);localStorage.setItem('z8-font-size','large');},token);await page.reload({waitUntil:'networkidle2'});await wait('R025 Clock worker');await page.waitForFunction(()=>getComputedStyle(document.documentElement).fontSize==='18px');
 const targets=await page.evaluate(()=>({font:getComputedStyle(document.documentElement).fontSize,viewport:innerWidth,width:document.documentElement.scrollWidth,targets:[...document.querySelectorAll('main button')].map(n=>({name:n.innerText,height:n.getBoundingClientRect().height,width:n.getBoundingClientRect().width}))}));assert.ok(targets.width<=targets.viewport);assert.ok(targets.targets.every(t=>t.height>=44&&t.width>=44));evidence.checks.push({check:'final large-font touch targets including language',...targets});await page.screenshot({path:join(out,'after-final-phone-large-dark.png'),fullPage:true});
 await click('R025 Clock worker');await wait('Enter your kiosk PIN');await page.keyboard.press('Tab');await new Promise(r=>setTimeout(r,300));
 const focus=await page.evaluate(()=>({label:document.activeElement.textContent,visible:document.activeElement.matches(':focus-visible'),shadow:getComputedStyle(document.activeElement).boxShadow}));assert.ok(focus.visible);assert.ok(!focus.shadow.endsWith('oklab(0 0 0 / 0) 0px 0px 0px 0px'));evidence.checks.push({check:'real keyboard focus ring after transition',...focus});await page.screenshot({path:join(out,'after-final-phone-focus.png'),fullPage:true});await page.keyboard.press('Escape');await wait('R025 Clock worker');
 const language=await page.$('[role=combobox]');await language.click();await page.waitForSelector('[role=option]');for(const option of await page.$$('[role=option]'))if((await option.evaluate(n=>n.textContent)).includes('Deutsch')){await option.click();break;}
 await page.waitForFunction(()=>location.pathname.startsWith('/de/'));await wait('R025 Clock worker');await click('R025 Clock worker');await page.waitForFunction(()=>!!document.querySelector('main output'));await page.keyboard.press('Escape');await page.waitForFunction(()=>location.pathname.startsWith('/en/'));await wait('R025 Clock worker');evidence.checks.push({check:'actual language route change and reset after employee turn',selected:'/de/kiosk',reset:'/en/kiosk'});
 const call=async(method,params)=>{const r=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(120000)});const text=await r.text();return JSON.parse(text.split(/\r?\n/).find(l=>l.startsWith('data: '))?.slice(6)??text);};
 const listed=await call('tools/list');evidence.next.push({tools:listed.result.tools.map(t=>t.name)});
 for(const name of ['get_project_metadata','get_routes','get_page_metadata','get_compilation_issues','get_errors']){const result=await call('tools/call',{name,arguments:{}});evidence.next.push({name,result});}
 await writeFile(join(out,'accessibility-next.json'),JSON.stringify(evidence,null,2));console.log('PASS large-font touch targets, visible keyboard focus, real language/reset, live Next tools');
}finally{await browser.close();}
