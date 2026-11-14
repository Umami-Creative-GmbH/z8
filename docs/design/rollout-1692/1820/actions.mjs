// Run from repo root with this ticket's private disposable fixture directory.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const repo=process.cwd(), dir=process.argv[2], out=join(repo,'docs/design/rollout-1692/1820');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'), fixture=await json('fixture-private.json'), actors=await json('dev-auth-private.json'), ids=await json('invitation-private.json');
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=process.argv[3]==='resume'?JSON.parse(await readFile(join(out,'actions-runtime.json'),'utf8')).results:{}, errors=[];
const pageFor=async actor=>{
 const context=await browser.createBrowserContext();await context.overridePermissions(runtime.origin,[]);
 if(actor) await context.setCookie(...actors[actor].cookies);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:390,height:844});return {context,page};
};
const route=id=>`${runtime.origin}/en/accept-invitation/${id}`;
const loaded=async(page,id)=>{await page.goto(route(id),{waitUntil:'networkidle0',timeout:90000});await page.waitForFunction(()=>!document.body.innerText.includes('Checking your invitation details'));};
const text=page=>page.evaluate(()=>document.querySelector('main')?.innerText??'');
const click=async(page,label)=>{await page.waitForFunction(label=>[...document.querySelectorAll('button,a,[role=menuitem],[role=menuitemradio]')].some(x=>x.textContent.trim()===label),{},label);const handle=await page.evaluateHandle(label=>[...document.querySelectorAll('button,a,[role=menuitem],[role=menuitemradio]')].find(x=>x.textContent.trim()===label),label);assert.ok(handle.asElement(),label);await handle.asElement().click();};
const api=async(context,path,body)=>{const cookies=await context.cookies();const response=await fetch(new URL(`/api/auth/organization/${path}`,runtime.origin),{method:'POST',headers:{Origin:runtime.origin,'Content-Type':'application/json',Cookie:cookies.map(c=>`${c.name}=${c.value}`).join('; ')},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
try {
 // Locale and callback contract from actual signed-out links.
 if (!results.localeCallbacks) {const {context,page}=await pageFor(null);await page.goto(`${runtime.origin}/de/accept-invitation/${ids.valid}`,{waitUntil:'networkidle0'});
 const links=await page.$$eval('main a',nodes=>nodes.map(x=>x.href));assert.equal(links.length,2);
 for(const href of links){const url=new URL(href);assert.match(url.pathname,/^\/de\/sign-(in|up)$/);assert.equal(url.searchParams.get('callbackUrl'),`/accept-invitation/${ids.valid}`);}
 results.localeCallbacks={locale:'de',destinations:links.map(h=>new URL(h).pathname),returnToSameInvitation:true};await context.close();}
 // Real mismatch refusal; sign-out transport failure and real retry. No fabricated responses.
 if (!results.signOutRecovery) {const {context,page}=await pageFor('small-restricted');await loaded(page,ids.valid);
 assert.match(await text(page),/Wrong account/);assert.equal(await page.$$eval('main button',ns=>ns.some(x=>x.textContent==='Accept invitation')),false);
 const denied=await api(context,'accept-invitation',{invitationId:ids.valid});assert.ok(denied.status>=400);results.mismatchRefusal={status:denied.status};
 await page.setRequestInterception(true);let fail=true;
 page.on('request',req=>{if(fail&&req.url().includes('/api/auth/sign-out')){fail=false;req.abort('internetdisconnected');}else req.continue();});
 await click(page,'Sign out and switch account');await page.waitForFunction(()=>[...document.querySelectorAll('[role=alert]')].some(x=>/fetch|network|sign out/i.test(x.textContent)));
 assert.match(await text(page),/Wrong account/);await page.screenshot({path:join(out,'after-signout-failure.png'),fullPage:true});
 await click(page,'Sign out and switch account');await page.waitForFunction(()=>location.pathname.endsWith('/sign-in'),{timeout:30000});
 const url=new URL(page.url());assert.equal(url.searchParams.get('callbackUrl'),`/accept-invitation/${ids.valid}`);
 results.signOutRecovery={failedTransportRetainsSwitch:true,realRetrySignedOut:true,callbackPreserved:true};await context.close();}
 // Revocation while a recipient has the page open must be refused by the real action.
 if (!results.lateRevocation) {const {context,page}=await pageFor('large-employee');await loaded(page,ids.stale);
 const admin=await browser.createBrowserContext();await admin.setCookie(...actors['small-admin'].cookies);
 const cancel=await api(admin,'cancel-invitation',{invitationId:ids.stale});assert.equal(cancel.status,200);
 await click(page,'Accept invitation');await page.waitForFunction(()=>document.querySelector('[role=alert]'));
 results.lateRevocation={alert:await page.$eval('[role=alert]',x=>x.innerText),reviewRetained:(await text(page)).includes('Performance small')};
 assert.ok(results.lateRevocation.reviewRetained);await page.screenshot({path:join(out,'after-revoked-in-flight.png'),fullPage:true});await admin.close();await context.close();}
 // Saved theme/font controls, phone reflow, reduced motion and keyboard reachability.
 {const {context,page}=await pageFor('large-employee');await loaded(page,ids.valid);
 await click(page,'Toggle theme');await click(page,'Dark');
 await click(page,'Font size');await click(page,'Large');await page.reload({waitUntil:'networkidle0'});
 results.preferences=await page.evaluate(()=>({theme:localStorage.getItem('theme'),font:localStorage.getItem('z8-font-size'),size:getComputedStyle(document.documentElement).fontSize,width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
 assert.equal(results.preferences.font,'large');assert.equal(results.preferences.theme,'dark');assert.equal(results.preferences.width,results.preferences.documentWidth);
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
 await page.screenshot({path:join(out,'after-phone-dark-large.png'),fullPage:true});
 await page.setViewport({width:800,height:500,deviceScaleFactor:2});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),800);
 await page.screenshot({path:join(out,'after-zoom-equivalent.png'),fullPage:true});
 const visited=[];for(let n=0;n<20;n++){await page.keyboard.press('Tab');visited.push(await page.evaluate(()=>({name:['BUTTON','A'].includes(document.activeElement?.tagName)?document.activeElement.textContent.trim().slice(0,100):document.activeElement?.tagName,outline:getComputedStyle(document.activeElement).outlineStyle,shadow:getComputedStyle(document.activeElement).boxShadow})));}
 assert.ok(visited.some(x=>x.name==='Accept invitation'));results.keyboard={acceptReachable:true,focusSamples:visited};await context.close();}
 // Hold one real acceptance request, inspect pending, then fail its transport and retry for real.
 {const {context,page}=await pageFor('large-employee');await loaded(page,ids.valid);
 await page.setRequestInterception(true);let held, count=0, hold=true;
 page.on('request',req=>{if(req.url().includes('/api/auth/organization/accept-invitation')){count++;if(hold){held=req;return;}}req.continue();});
 await click(page,'Accept invitation');await page.waitForFunction(()=>document.querySelector('main button')?.disabled);
 for(let n=0;n<30&&!held;n++)await new Promise(r=>setTimeout(r,100));assert.ok(held);
 assert.match(await page.$eval('[role=status]',x=>x.innerText),/Accepting invitation/);
 await page.screenshot({path:join(out,'after-accepting.png'),fullPage:true});
 await page.$eval('main button',x=>x.click());assert.equal(count,1);
 await held.abort('internetdisconnected');await page.waitForFunction(()=>document.querySelector('[role=alert]'));
 assert.equal(await page.$eval('main button',x=>x.disabled),false);assert.match(await text(page),/Performance small/);
 await page.screenshot({path:join(out,'after-acceptance-failure.png'),fullPage:true});hold=false;
 await click(page,'Accept invitation');await page.waitForFunction(()=>document.body.innerText.includes('Invitation accepted'),{timeout:30000});
 await page.screenshot({path:join(out,'after-accepted.png'),fullPage:true});
 await page.waitForFunction(()=>!location.pathname.includes('/accept-invitation/'),{timeout:30000});
 const organizations=await page.evaluate(async()=>{const r=await fetch('/api/auth/organization/list');return {status:r.status,data:await r.json()};});
 assert.equal(organizations.status,200);assert.ok(organizations.data.some(o=>o.name==='Performance small'));
 results.acceptance={requestCount:count,pendingDuplicatePrevented:true,failedTransportRetainsRetry:true,accepted:true,handoffPath:new URL(page.url()).pathname,membershipVisibleThroughRealRead:true};
 await page.screenshot({path:join(out,'after-init-handoff.png'),fullPage:true});await context.close();}
} finally {await writeFile(join(out,'actions-runtime.json'),JSON.stringify({results,errors},null,2));await browser.close();}
assert.deepEqual(errors,[]);console.log(`Verified ${Object.keys(results).length} action/interaction groups with real auth boundaries; zero page errors.`);
