import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const [sourceArg,fixtureArg,outArg]=process.argv.slice(2),source=resolve(sourceArg),fixture=resolve(fixtureArg),out=resolve(outArg);
const load=async file=>JSON.parse(await readFile(join(fixture,file),'utf8'));
const runtime=await load('runtime-private.json'),auth=await load('dev-auth-private.json');
assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal((await load('fixture-private.json')).kind,'disposable');
const browser=await createRequire(join(source,'package.json'))('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();await page.setViewport({width:1600,height:1000});page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(runtime.origin+'/en/calendar',{waitUntil:'networkidle0',timeout:120000});
 const trigger=await page.$('[data-slot=sidebar-trigger]');
 if(await trigger.evaluate(e=>e.getAttribute('aria-expanded')==='true')){await trigger.focus();await page.keyboard.press('Enter');}
 const calendar=(await page.waitForFunction(()=>[...document.querySelectorAll('[data-slot=sidebar-menu-button]')].find(e=>e.textContent.trim()==='Calendar'))).asElement();
 await calendar.focus();await page.waitForFunction(()=>[...document.querySelectorAll('[data-slot=tooltip-content]')].some(e=>e.textContent.trim()==='Calendar'&&!e.hidden&&getComputedStyle(e).display!=='none'));
 await page.screenshot({path:join(out,'after-desktop-icon-tooltip.png')});
 await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');
 await page.waitForFunction(()=>![...document.querySelectorAll('[data-slot=tooltip-content]')].some(e=>e.textContent.trim()==='Calendar'));
 assert.equal(await calendar.evaluate(e=>document.activeElement===e),true);assert.equal(await trigger.evaluate(e=>e.getAttribute('aria-expanded')),'true');
 const call=async(method,params)=>{const response=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(60000)});assert.equal(response.ok,true);const raw=await response.text();return raw.startsWith('event:')?JSON.parse(raw.split(/\r?\n/).find(l=>l.startsWith('data: ')).slice(6)):JSON.parse(raw);};
 const listed=await call('tools/list');assert.ok(listed.result.tools.some(t=>t.name==='get_compilation_issues'));
 const diagnostics=[];for(const name of ['get_compilation_issues','get_errors'])diagnostics.push({name,result:await call('tools/call',{name,arguments:{}})});
 await writeFile(join(fixture,'drawer-mcp-private.json'),JSON.stringify({listed,diagnostics},null,2));
 const summary={historicalConsumer:'Calendar at 78d8c4af9764d159ca8dc12e772af3c835b77b3c, shared Sidebar correction only',collapsedTooltipVisible:true,expandingRemovesTooltip:true,focusedCalendarLinkRetained:true,triggerExpanded:true,pageErrors:errors,nativeReactIntrospection:'Not rerun; unavailable in earlier root sessions. This DOM/keyboard check is not native React inspection.'};
 assert.deepEqual(errors,[]);await writeFile(join(out,'desktop.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));console.log(JSON.stringify(diagnostics));
}finally{await browser.close();}
