import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
const [sourceInput, fixtureInput, outInput] = process.argv.slice(2);
const source=resolve(sourceInput), fixture=resolve(fixtureInput), out=resolve(outInput);
const load=async name=>JSON.parse(await readFile(join(fixture,name),'utf8'));
const runtime=await load('runtime-private.json'), auth=await load('dev-auth-private.json');
assert.equal(new URL(runtime.origin).hostname,'localhost');
assert.equal((await load('fixture-private.json')).kind,'disposable');
await mkdir(out,{recursive:true});
const puppeteer=createRequire(join(source,'package.json'))('puppeteer-core');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[],errors=[];
try {
 for (const variant of [
  {name:'large-collapsed',font:'Large',collapsed:true,reduce:false},
  {name:'large-collapsed-reduced',font:'Large',collapsed:true,reduce:true},
  {name:'default-expanded',font:'Default',collapsed:false,reduce:false},
 ]) {
  const context=await browser.createBrowserContext();
  await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
  await context.setCookie(...auth['small-admin'].cookies);
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',e=>errors.push({variant:variant.name,message:e.message}));
  await page.setViewport({width:1600,height:1000});
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:variant.reduce?'reduce':'no-preference'}]);
  await page.goto(runtime.origin+'/en/driving-licence/checks/'+(await load('fixture-private.json')).actors['small-employee'].employeeId,{waitUntil:'networkidle0',timeout:120000});
  const find=async(name,selector='button')=>(await page.waitForFunction((name,selector)=>[...document.querySelectorAll(selector)].find(e=>e.getClientRects().length&&(e.textContent.trim()===name||e.getAttribute('aria-label')===name)),{},name,selector)).asElement();
  const click=async(name,selector)=>{const el=await find(name,selector);await el.focus();await page.keyboard.press('Enter');await el.dispose();};
  await click('Account: Person 0');
  const font=await find('Font size','[role=menuitem]');await font.focus();await page.keyboard.press('ArrowRight');await font.dispose();
  if(variant.font==='Default') {
   const options=await page.$$eval('[role=menuitemradio]',es=>es.map(e=>e.textContent.trim()));
   variant.font=options.find(x=>/default|normal|medium/i.test(x))||options[1];
  }
  await click(variant.font,'[role=menuitemradio]');
  await page.reload({waitUntil:'networkidle0',timeout:120000});
  const expanded=await page.$eval('[data-slot=sidebar-trigger]',e=>e.getAttribute('aria-expanded')==='true');
  if(expanded===variant.collapsed)await click('Toggle Sidebar');
  await page.reload({waitUntil:'networkidle0'});
  await page.setViewport({width:390,height:844});await page.reload({waitUntil:'networkidle0'});
  await click('Toggle Sidebar');
  await page.waitForSelector('[role=dialog][data-sheet-open][data-sheet-open=true]');
  const link=await find('Driving licence','[role=dialog] a');await link.focus();await link.dispose();
  await page.waitForFunction(()=>{const d=document.querySelector('[role=dialog][data-sheet-open]');return d&&d.getBoundingClientRect().left>=-1&&d.getAnimations({subtree:true}).every(a=>a.playState!=='running');});
  const state=()=>page.evaluate(()=>{
   const d=document.querySelector('[role=dialog][data-sheet-open]');
   const describe=e=>e?{tag:e.tagName,slot:e.getAttribute('data-slot'),role:e.getAttribute('role'),text:e.textContent.trim().slice(0,60),hidden:e.hidden,ariaHidden:e.getAttribute('aria-hidden'),display:getComputedStyle(e).display}:null;
   return {expanded:document.querySelector('[data-slot=sidebar-trigger]')?.getAttribute('aria-expanded'),sheet:d?{visualOpen:d.getAttribute('data-sheet-open'),left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right,transform:getComputedStyle(d).transform}:null,focus:describe(document.activeElement),tooltips:[...document.querySelectorAll('[data-slot=tooltip-content]')].map(describe),dialogs:[...document.querySelectorAll('[role=dialog]')].map(describe),font:getComputedStyle(document.documentElement).fontSize,notification:Notification.permission};
  });
  const before=await state();await page.screenshot({path:join(out,variant.name+'-before.png')});
  await page.evaluate(()=>{window.escapeEvents=[];for(const capture of [true,false])document.addEventListener('keydown',e=>{if(e.key==='Escape')window.escapeEvents.push({capture,defaultPrevented:e.defaultPrevented,target:e.target?.getAttribute('data-slot'),trusted:e.isTrusted});},{capture});});
  await page.keyboard.press('Escape');
  const immediate=await state();
  const closed=await page.waitForFunction(()=>!document.querySelector('[role=dialog][data-sheet-open]'),{timeout:2500}).then(()=>true,()=>false);
  const after=await state();await page.screenshot({path:join(out,variant.name+'-after-first.png')});
  let second=null;
  if(!closed){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role=dialog][data-sheet-open]'),{timeout:2500}).catch(()=>{});second=await state();}
  results.push({variant,before,immediate,closedAfterFirst:closed,after,second,events:await page.evaluate(()=>window.escapeEvents)});
  console.log(JSON.stringify({name:variant.name,closedAfterFirst:closed,beforeTooltip:before.tooltips,immediate,after,second}));
  await writeFile(join(out,'probe.json'),JSON.stringify({sourceCommit:'6bce36400e094702e650d6c24c38fc79a49623b6',boundary:'Current employee-check consumer, including root Tooltip correction. Native trusted keyboard, real saved font menu, no fabricated state.',results,errors},null,2)+'\n');
  await context.close();
 }
} finally {await browser.close();}
