// pnpm node docs/design/rollout-1692/1722/runtime.mjs <owned fixture> <attempt>
// Actual consumer-source comparison, with byte-for-byte restoration in finally.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]),out=resolve('docs/design/rollout-1692/1722',process.argv[3]??'attempt-1');await mkdir(out,{recursive:true});
const read=async n=>JSON.parse(await readFile(join(dir,n),'utf8'));
const r=await read('runtime-private.json'),auth=await read('dev-auth-private.json'),fixture=await read('fixture-private.json');assert.equal(fixture.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');
const files=['apps/webapp/src/app/[locale]/(app)/my-requests/my-requests-client.tsx','apps/webapp/src/app/[locale]/(app)/my-requests/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const names=['client','page','route-metadata'],saved=await Promise.all(files.map(f=>readFile(f)));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],captures=[];
const context=await browser.createBrowserContext();await context.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'});await context.setCookie(...auth['small-employee'].cookies);
const p=await context.newPage();p.setDefaultTimeout(30000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
const click=async(text,selector='button,[role=menuitem],[role=menuitemradio]')=>{const h=await p.waitForFunction((text,selector)=>[...document.querySelectorAll(selector)].find(e=>e.getClientRects().length&&(e.getAttribute('aria-label')===text||e.textContent.trim()===text)),{},text,selector);await h.asElement().click();await new Promise(r=>setTimeout(r,350));};
const goto=async(path='/en/my-requests')=>{await p.goto(r.origin+path,{waitUntil:'networkidle0',timeout:120000});await p.waitForSelector('#request-search');await p.evaluate(()=>document.fonts.ready);};
const meta=async()=>({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().split('\n'),sources:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])))});
const capture=async(name)=>{
 await p.evaluate(()=>document.fonts.ready);
 const measured=await p.evaluate(()=>({path:location.pathname,cssViewport:{width:innerWidth,height:innerHeight},dpr:devicePixelRatio,width:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.body).fontFamily,fontStatus:document.fonts.status,savedFont:localStorage.getItem('z8-font-size'),savedTheme:localStorage.getItem('theme'),theme:document.documentElement.className,h1:[...document.querySelectorAll('h1')].map(e=>e.textContent),headings:[...document.querySelectorAll('h2')].map(e=>e.textContent),rows:document.querySelectorAll('article').length,summary:[...document.querySelectorAll('section')].find(s=>s.getAttribute('aria-label')==='Request summary')?.innerText,filters:[...document.querySelectorAll('#request-search,select')].map(e=>e.value)}));
 const png=Buffer.from(await p.screenshot({path:join(out,name+'.png')}));
 captures.push({name,...measured,png:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},...await meta()});
 await writeFile(join(out,'captures.json'),JSON.stringify(captures,null,2)+'\n');
 assert.equal(measured.width,measured.cssViewport.width,'No page overflow');assert.equal(measured.fontStatus,'loaded');
};
const preferences=async(font,theme)=>{
 await p.evaluate((font,theme)=>{localStorage.setItem('z8-font-size',font==='Large'?'large':'default');localStorage.setItem('theme',theme.toLowerCase());},font,theme);
 await p.reload({waitUntil:'networkidle0'});await p.waitForSelector('#request-search');
};try{
 for(const mode of ['before','after']){
  for(let i=0;i<files.length;i++)await writeFile(files[i],mode==='before'?await readFile('.tmp/1722/before-'+names[i]+(i===2?'.ts':'.tsx')):saved[i]);
  await p.setViewport({width:1600,height:1000});await goto();
  await preferences('Default','Light');
  // Each comparison starts with an expanded desktop sidebar.
  if(await p.$eval('button[data-sidebar="trigger"]',e=>e.getAttribute('aria-expanded')==='false')){await p.keyboard.down('Control');await p.keyboard.press('b');await p.keyboard.up('Control');}
  await capture(mode+'-desktop-light');
  await preferences('Large','Dark');
  await p.setViewport({width:2200,height:1100});await p.keyboard.down('Control');await p.keyboard.press('b');await p.keyboard.up('Control');await p.reload({waitUntil:'networkidle0'});await p.waitForSelector('#request-search');
  await capture(mode+'-wide-dark-saved18');
  await p.setViewport({width:390,height:844});await p.reload({waitUntil:'networkidle0'});await p.waitForSelector('#request-search');
  await capture(mode+'-phone-dark-saved18');
  await p.evaluate(()=>document.querySelector('h2')?.scrollIntoView({block:'start'}));await capture(mode+'-phone-filters');
 }
 checks.push({comparison:'same employee/organization and seeded records, exact three consumer files, no mutations between captures',pairs:4});
 await p.setViewport({width:1600,height:1000});await goto();
 // Text/status/type are real immediate controls and the complete record remains reachable.
 await p.type('#request-search','R030');
 await p.select('select','rejected');
 assert.ok(await p.evaluate(()=>document.querySelectorAll('article').length>0));
 await p.select('select:nth-of-type(1)','rejected');
 await capture('after-filtered-rejected');
 await p.focus('#request-search');await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement?.tagName),'SELECT');await p.keyboard.press('ArrowUp');checks.push({keyboardSearchToStatus:true,nativeStatusKeys:true});
 await goto('/en/my-requests?request=absence:unavailable-owned');
 assert.ok(await p.evaluate(()=>document.body.innerText.includes('Period readiness is being checked again.')));
 await capture('after-unavailable-arrival');
 // First Escape must close the current-route phone drawer and return focus.
 await p.setViewport({width:390,height:844});await goto();await click('Toggle Sidebar');
 await p.waitForSelector('[role=dialog]');
 const current=await p.$('[role=dialog] a[href="/en/my-requests"]');await current.focus();await p.keyboard.press('Escape');
 await p.waitForFunction(()=>!document.querySelector('[role=dialog]'));
 assert.equal(await p.evaluate(()=>document.activeElement?.textContent.trim()),'Toggle Sidebar');checks.push({phoneCurrentRouteFirstEscape:true,focusReturn:true});
 await capture('after-phone-drawer-closed');
 // Separate Next MCP checks while the browser is connected.
 const mcp=async(method,params)=>{const res=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(120000)});const raw=await res.text();return res.headers.get('content-type')?.includes('event-stream')?JSON.parse(raw.split(/\r?\n/).find(s=>s.startsWith('data: ')).slice(6)):JSON.parse(raw);};
 const tools=await mcp('tools/list');assert.ok(JSON.stringify(tools).includes('get_compilation_issues'));
 const diagnostics=[];for(const name of ['get_compilation_issues','get_errors'])diagnostics.push({name,result:await mcp('tools/call',{name,arguments:{}})});
 await writeFile(join(out,'next.json'),JSON.stringify(diagnostics,null,2)+'\n');
 await writeFile(join(out,'checks.json'),JSON.stringify({checks,errors},null,2)+'\n');console.log('Captured matched request comparisons and verified filters, unavailable arrival, phone Escape, and connected Next diagnostics.');
}catch(e){await writeFile(join(out,'failed.json'),JSON.stringify({message:e.message,checks,captures:captures.map(x=>x.name),errors},null,2));await p.screenshot({path:join(out,'failed.png')}).catch(()=>{});throw e;}
finally{for(let i=0;i<files.length;i++)await writeFile(files[i],saved[i]);await browser.close();}
