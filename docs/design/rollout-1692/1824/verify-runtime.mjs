// Real kiosk transport/actions; never replaces application responses. Secrets remain in owned fixture.
// pnpm node .../verify-runtime.mjs <owned-fixture>
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const repo=process.cwd(),dir=resolve(process.argv[2]),out=join(repo,'docs/design/rollout-1692/1824');
const json=async name=>JSON.parse(await readFile(join(dir,name),'utf8'));
const runtime=await json('runtime-private.json'),seed=await json('kiosk-private.json'),{token}=await json('device-private.json');
if(runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB)||!/^perf-small-[a-f0-9]+$/.test(seed.organizationId))throw Error('Owned synthetic fixture required');
const require=createRequire(join(repo,'apps/webapp/package.json')),{Pool}=require('pg');
const pool=new Pool({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});
assert.equal((await pool.query('select current_database() as name')).rows[0].name,runtime.env.POSTGRES_DB);
let record;
const evidence={checks:[],records:[],errors:[],limits:['Keyboard reader emulation is not NFC/scanner hardware certification.','No real camera image, physical device or browser zoom certification.']};
const ok=(check,detail)=>{evidence.checks.push({check,detail});console.log('PASS '+check);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));page.on('response',async r=>{if(r.url().endsWith('/api/kiosk/clock')){const b=await r.json().catch(()=>({}));console.log(JSON.stringify({clockStatus:r.status(),code:b.code,outcome:b.outcome}));}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const text=()=>page.$eval('main',n=>n.innerText);
const wait=needle=>page.waitForFunction(needle=>document.querySelector('main')?.innerText.includes(needle),{timeout:45000},needle);
const click=async label=>{for(const b of await page.$$('main button'))if((await b.evaluate(n=>n.innerText.trim())).endsWith(label)){await b.click();return;}throw Error('Missing '+label);};
const api=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch('/api/kiosk/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-kiosk-token':localStorage.getItem('z8.kiosk.deviceToken')},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{path,body});
const home=async()=>{await page.goto(runtime.origin+'/en/kiosk',{waitUntil:'networkidle2',timeout:120000});await wait('R025 Clock worker');};
const pin=async(value=seed.pins['small-employee'])=>{for(const digit of value)await click(digit);await click('OK');};
const identify=async()=>{await click('R025 Clock worker');await wait('Enter your kiosk PIN');await pin();};
const finish=async(action,expected)=>{await click(action);await pause(300);if((await text()).includes('Project') && !(await text()).includes(expected))await click(action);await pause(1000);await writeFile(join(dir,'action-state-private.txt'),await text());await wait(expected);};
const shot=name=>page.screenshot({path:join(out,name+'.png'),fullPage:true});
const rows=async()=> (await pool.query("select type,to_char(timestamp,'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') as utc, utc_offset_minutes,timezone,timezone_source,device_info from time_entry where employee_id=$1 and organization_id=$2 and device_info like $3 order by timestamp",[seed.employeeId,seed.organizationId,'kiosk:'+seed.kioskId+'%'])).rows;
try{
 await page.setViewport({width:1600,height:1000});await page.goto(runtime.origin+'/en/kiosk',{waitUntil:'networkidle2',timeout:120000});
 await page.evaluate(token=>localStorage.setItem('z8.kiosk.deviceToken',token),token);await home();
 assert.match(await text(),/Performance small/);ok('real enrolled organization/location/device scope','No Better Auth cookies in device context');
 await page.type('input[type=search]','no-such-employee');await wait('No name matches');await page.$eval('input[type=search]',n=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(n,'');n.dispatchEvent(new Event('input',{bubbles:true}));});await home();ok('search/no match/recovery','Actual assigned-location roster');
 if(!process.argv.includes('--layout-only')) {
 await identify();await wait('Not clocked in');await finish('Clock in','Clocked in');await shot('after-confirmed-clock-in');
 record=await rows();assert.equal(record.length,1);assert.equal(record[0].utc_offset_minutes,60);assert.equal(record[0].timezone,'Europe/Berlin');assert.equal(record[0].device_info,'kiosk:'+seed.kioskId);ok('PIN clock in persists UTC/offset/device evidence',record.map(({device_info,...r})=>({...r,deviceEvidence:'owned kiosk'})));
 await home();await page.keyboard.type(seed.badge,{delay:1});await page.keyboard.press('Enter');await wait('Start break');assert.ok(!(await text()).includes('Enter your kiosk PIN'));await finish('Start break','Break started');ok('online badge proves without PIN and needs explicit action','Real employee-status and clock endpoints; keyboard scanner emulation');
 await home();const serial='A1B2C3D4';const registration=await api('fob/registration',{serial,employeeId:seed.employeeId,pin:seed.pins['small-employee']});assert.equal(registration.status,200);
 await page.keyboard.type(serial,{delay:1});await page.keyboard.press('Enter');await wait('Enter your kiosk PIN');assert.ok(!(await text()).includes('Resume work'));await pin();await wait('Resume work');await finish('Resume work','Back to work');ok('registered fob selects; PIN still proves resume','Real registration owner; keyboard reader emulation only');
 await home();await identify();await wait('Clock out');
 const cdp=await page.createCDPSession();let held;await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/api/kiosk/clock',requestStage:'Response'}]});
 cdp.on('Fetch.requestPaused',event=>{held=event;});
 let blockOutcome=true;await page.setRequestInterception(true);page.on('request',request=>{if(blockOutcome&&request.url().endsWith('/api/kiosk/clock/outcome'))void request.abort();else void request.continue();});
 await click('Clock out');await pause(300);if((await text()).includes('Project'))await click('Clock out');
 for(let i=0;!held&&i<100;i++)await pause(100);assert.ok(held,'Real clock response was received');await shot('after-pending-clock-out');
 await cdp.send('Fetch.failRequest',{requestId:held.requestId,errorReason:'ConnectionClosed'});await cdp.send('Fetch.disable');
 await wait('Checking whether your action was recorded');await shot('after-uncertain');await click('Back');await wait('R025 Clock worker');await click('R025 Clock worker');await wait('Checking whether your action was recorded');assert.ok(!(await text()).includes('Enter your kiosk PIN'));ok('lost clock reply blocks another action before status lookup','Server processed original request; response dropped through CDP, no fabricated response');
 blockOutcome=false;await wait('Clocked out');ok('uncertain outcome resolves actual committed result','Existing /clock/outcome only; no clock replay');
 await home();await page.setOfflineMode(true);await identify();await wait('Not clocked in');const beforeOffline=(await rows()).length;await finish('Clock in','not yet confirmed');await shot('after-offline-unconfirmed');assert.equal((await rows()).length,beforeOffline);ok('offline PIN command is unconfirmed and not yet persisted','Real browser offline mode, existing cached roster and sealing key');
 await click('Done');await wait('R025 Clock worker');await click('R025 Clock worker');await wait('Clockings awaiting confirmation: 1');await shot('after-queue-during-pin');ok('queue remains visible during next identification','Existing IndexedDB command owner');
 await page.setOfflineMode(false);await pause(1500);await home();
 for(let i=0;i<80&&(await rows()).length===beforeOffline;i++)await pause(250);
 record=await rows();assert.equal(record.length,beforeOffline+1);assert.match(record.at(-1).device_info,/:offline:server_anchor$/);ok('reconnect confirms original frozen command once',record.at(-1).timezone_source);
 await identify();await wait('Clock out');await finish('Clock out','Clocked out');await home();
 }
 await page.evaluate(()=>localStorage.setItem('z8-font-size','large'));await page.reload({waitUntil:'networkidle2'});await wait('R025 Clock worker');await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'dark'},{name:'prefers-reduced-motion',value:'reduce'}]);
 await wait('R025 Clock worker');await page.waitForFunction(()=>getComputedStyle(document.documentElement).fontSize==='18px' && document.documentElement.classList.contains('dark'));
 const layout=await page.evaluate(()=>({font:getComputedStyle(document.documentElement).fontSize,width:document.documentElement.scrollWidth,viewport:innerWidth,dark:document.documentElement.classList.contains('dark'),reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,targets:[...document.querySelectorAll('main button')].map(n=>({label:n.innerText,height:n.getBoundingClientRect().height}))}));assert.equal(layout.font,'18px');assert.ok(layout.width<=layout.viewport);assert.ok(layout.dark);await shot('after-phone-large-dark');ok('persisted computed large font / touch phone / dark / reduced motion',layout);
 await page.setViewport({width:1024,height:768});await wait('R025 Clock worker');await click('R025 Clock worker');await wait('Enter your kiosk PIN');await page.keyboard.press('Tab');const focus=await page.evaluate(()=>({tag:document.activeElement.tagName,label:document.activeElement.textContent,outline:getComputedStyle(document.activeElement).outlineStyle,shadow:getComputedStyle(document.activeElement).boxShadow}));assert.equal(focus.tag,'BUTTON');await shot('after-tablet-focus');await page.keyboard.type(seed.pins['small-employee'],{delay:180});for(let i=0;i<16 && (await page.evaluate(()=>document.activeElement.textContent.trim()))!=='OK';i++)await page.keyboard.press('Tab');await page.keyboard.press('Enter');await wait('Clock in');ok('keyboard PIN with reader guard active / focus',focus);await pause(31000);await wait('R025 Clock worker');assert.ok(!(await text()).includes('Enter your kiosk PIN'));ok('idle reset','30 second real timeout clears employee turn');
 record=await rows();evidence.records=record.map(({device_info,...r})=>({...r,deviceEvidence:device_info.replace(seed.kioskId,'<owned-device>')}));assert.ok(record.every(r=>r.utc_offset_minutes===60&&r.timezone==='Europe/Berlin'));
 await writeFile(join(out,'runtime.json'),JSON.stringify(evidence,null,2));
 // Keep this actual connected session available for the sibling MCP command.
 await writeFile(join(dir,'runtime-browser-ready.txt'),'ready');await pause(15000);
}catch(error){await writeFile(join(dir,'runtime-failure-private.txt'),String(error)+'\n'+await text().catch(()=>''));throw error;}finally{await browser.close();await pool.end();}
