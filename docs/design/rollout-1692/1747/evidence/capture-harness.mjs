import puppeteer from 'puppeteer-core';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=process.cwd(), dir=root+'/.tmp/1747/fixture';
const runtime=JSON.parse(await readFile(dir+'/runtime-private.json','utf8'));
const fixture=JSON.parse(await readFile(dir+'/fixture-private.json','utf8'));
if(fixture.kind!=='disposable'||!/^http:\/\/localhost:\d+$/.test(runtime.origin))throw Error('Fixture guard');
const phase=process.argv[2]??'before';
const out=root+'/docs/design/rollout-1692/1747/evidence'; await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:[]});
const result={phase,notifications:'denied by isolated context permission',captures:[],errors:[]};
const source=JSON.parse(await readFile(root+'/.tmp/1747/source-backup/manifest.json','utf8').catch(()=>'{"implementation":"4f593a9245bd3a33b9f29cf49b945a0cc7322e59"}'));
result.source=phase==='before'?source.base:source.implementation;
result.harnessSha256=createHash('sha256').update(await readFile(root+'/.tmp/1747/browser.mjs')).digest('hex');
try{
const context=await browser.createBrowserContext();
await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});
const page=await context.newPage();page.setDefaultTimeout(90000);
page.on('pageerror',e=>result.errors.push(e.message));
await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'domcontentloaded'});
const actor=fixture.actors['small-admin'];
const login=await page.evaluate(async ({email,password,organizationId})=>{
const response=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email,password})});
if(!response.ok)return {login:response.status};
const active=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId})});return {login:response.status,active:active.status};
},actor);
result.auth=login;if(login.login!==200||login.active!==200)throw Error('Normal development auth refused: '+JSON.stringify(login));
await page.goto(runtime.origin+'/en/travel-expenses',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.body.innerText.includes('No travel expenses yet')||document.body.innerText.includes('most recently changed first'));
const click=async(label)=>{for(const el of await page.$$('button'))if(await el.evaluate((n,label)=>n.textContent.trim()===label,label)){await el.asLocator().click();return;}throw Error('Button missing: '+label);};
if(phase==='journeys'){
result.created=[];
for(const label of ['New receipt','New mileage','New trip']){
await click(label);await page.waitForFunction(()=>location.pathname.includes('/travel-expenses/reports/'));
await page.waitForFunction(()=>document.body.innerText.includes('Still needed')||document.body.innerText.includes('Submit for approval'));
const editor=await page.evaluate(()=>({path:location.pathname,text:document.querySelector('main')?.innerText??document.body.innerText}));
await page.goto(runtime.origin+'/en/travel-expenses',{waitUntil:'domcontentloaded'});
await page.waitForFunction(path=>[...document.querySelectorAll('a')].some(n=>n.getAttribute('href')===path||n.getAttribute('href')===path.replace('/en/','/')),{},editor.path);
const readback=await page.evaluate(path=>{const n=[...document.querySelectorAll('a')].find(n=>n.getAttribute('href')===path||n.getAttribute('href')===path.replace('/en/','/'));return n?.closest('li')?.innerText;},editor.path);
result.created.push({label,...editor,readback});
}
await writeFile(out+'/'+phase+'.json',JSON.stringify(result,null,2));
}else{
for(const font of ['default','large'])for(const [name,width,height] of [['desktop',1600,1000],['phone',390,844],['wide',2200,1200]])for(const theme of ['light','dark']){
await page.setViewport({width,height});
await page.evaluate((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font);},theme,font);
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>document.body.innerText.includes('most recently changed first')&&!document.body.innerText.includes('Loading clock status'));
await page.evaluate(()=>document.fonts.ready);
let geometry;for(let step=0;step<12;step++){const next=await page.evaluate(()=>JSON.stringify([...document.querySelectorAll('[data-sidebar=sidebar],h1')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})));if(next===geometry)break;geometry=next;await new Promise(r=>setTimeout(r,200));}
const state=await page.evaluate(()=>({h1:[...document.querySelectorAll('h1')].map(n=>n.innerText),fontPx:getComputedStyle(document.documentElement).fontSize,overflow:document.documentElement.scrollWidth>innerWidth,permission:Notification.permission,dialogs:[...document.querySelectorAll('[role=dialog]')].filter(n=>n.getClientRects().length).length,text:document.querySelector('main')?.innerText??document.body.innerText}));
if(state.permission!=='denied'||state.dialogs||state.overflow||state.fontPx!==(font==='large'?'18px':'16px'))throw Error('Capture policy/geometry failure');
const file=`${phase}-${name}-${theme}-${font}.png`;await page.screenshot({path:out+'/'+file,fullPage:true});result.captures.push({file,width,height,theme,font,...state});
}
await page.setViewport({width:1600,height:1000});
await page.evaluate(()=>[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='New receipt')?.focus());
result.keyboard=[];
for(let i=0;i<3;i++){result.keyboard.push(await page.evaluate(()=>document.activeElement?.textContent.trim()));await page.keyboard.press('Tab');}
await page.keyboard.down('Control');await page.keyboard.press('b');await page.keyboard.up('Control');await new Promise(r=>setTimeout(r,350));
result.collapsed=await page.evaluate(()=>!!document.querySelector('[data-state=collapsed][data-collapsible=icon]'));
await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.innerText.includes('most recently changed first'));
result.collapsePersisted=await page.evaluate(()=>!!document.querySelector('[data-state=collapsed][data-collapsible=icon]'));
await page.setViewport({width:390,height:844});await page.click('button[data-sidebar=trigger]');await page.waitForSelector('[role=dialog]',{visible:true});
for(const el of await page.$$('[role=dialog] a'))if(await el.evaluate(n=>n.textContent.trim()==='Travel Expenses')){await el.focus();break;}
await page.keyboard.press('Escape');await new Promise(r=>setTimeout(r,500));
result.escape=await page.evaluate(()=>({dialogs:[...document.querySelectorAll('[role=dialog]')].filter(n=>n.getClientRects().length).length,focus:document.activeElement?.getAttribute('data-sidebar')}));
await writeFile(out+'/'+phase+'.json',JSON.stringify(result,null,2));
}
}catch(e){result.failure=e.message;await writeFile(out+'/'+phase+'.json',JSON.stringify(result,null,2));throw e;}finally{await browser.close();}
