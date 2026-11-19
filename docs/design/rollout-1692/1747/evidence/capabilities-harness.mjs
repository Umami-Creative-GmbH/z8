import puppeteer from 'puppeteer-core';
import {readFile,writeFile} from 'node:fs/promises';
const dir='.tmp/1747/fixture',out='docs/design/rollout-1692/1747/evidence/capabilities.json';
const runtime=JSON.parse(await readFile(dir+'/runtime-private.json','utf8')),fixture=JSON.parse(await readFile(dir+'/fixture-private.json','utf8'));
if(fixture.kind!=='disposable'||!runtime.origin.startsWith('http://localhost:'))throw Error('Guard');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const result={source:'abd6e73c93d822cd53dec8b7875ec476b0570a9b',actors:[]};
async function open(name,path){const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});const page=await context.newPage();page.setDefaultTimeout(60000);await page.setViewport({width:1600,height:1000});await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'domcontentloaded'});const auth=await page.evaluate(async a=>{const r=await fetch('/api/auth/sign-in/email',{method:'POST',headers:{'content-type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify({email:a.email,password:a.password})});if(!r.ok)return r.status;const o=await fetch('/api/auth/organization/set-active',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organizationId:a.organizationId})});return o.status;},fixture.actors[name]);if(auth!==200)throw Error('Auth status '+auth);await page.goto(runtime.origin+'/en/'+path,{waitUntil:'domcontentloaded'});return {context,page};}
async function click(page,label){for(const e of await page.$$('button'))if(await e.isVisible()&&await e.evaluate((n,label)=>n.textContent.trim()===label,label)){await e.asLocator().click();return;}throw Error('Missing button '+label);}
try{
const {page,context}=await open('small-admin','settings/travel-expenses?tab=access');
await page.waitForFunction(()=>document.body.innerText.includes('Add expense officer'));
await click(page,'Add expense officer');
result.settings=await page.evaluate(()=>({text:document.querySelector('main')?.innerText,comboboxes:[...document.querySelectorAll('[role=combobox]')].map(n=>({text:n.textContent,aria:n.getAttribute('aria-label')}))}));
if(process.argv.includes('--grant')){
await page.click('[role=combobox]');await page.waitForSelector('[role=option]',{visible:true});
const target=fixture.actors['small-employee'];let picked=false;
for(const option of await page.$$('[role=option]'))if(await option.evaluate((n,email)=>n.textContent.includes(email),target.email)){await option.asLocator().click();picked=true;break;}
if(!picked)throw Error('Fixture employee absent from public picker');
for(const option of await page.$$('[role=radio]'))if(await option.evaluate(n=>n.textContent.trim()==='All employees')){await option.asLocator().click();break;}
await click(page,'Save expense officer');await page.waitForFunction(()=>document.body.innerText.includes('Read only'));
result.grant='Created read-only, all-scope grant through existing settings form';
}
for(const actor of ['small-manager','small-employee','large-admin']){
const {page,context}=await open(actor,'travel-expenses');await page.waitForFunction(()=>document.body.innerText.includes('No travel expenses yet')||document.body.innerText.includes('most recently changed first'));
result.actors.push({actor,...await page.evaluate(()=>({inbox:[...document.querySelectorAll('main a')].some(n=>n.textContent.trim()==='Open inbox'),finance:[...document.querySelectorAll('main a')].some(n=>n.textContent.trim()==='Open finance queue'),reports:[...document.querySelectorAll('main a[href*="travel-expenses/reports/"]')].map(n=>n.getAttribute('href')),text:document.querySelector('main')?.innerText}))});await context.close();
}
if(process.argv.includes('--grant')){
await click(page,'Revoke');await page.waitForSelector('[role=alertdialog]',{visible:true});await click(page,'Revoke access');await page.waitForFunction(()=>document.body.innerText.includes('No expense officers yet'));
result.revoked='Revoked through existing settings confirmation';
const current=await open('small-employee','travel-expenses');await current.page.waitForFunction(()=>document.body.innerText.includes('No travel expenses yet'));
result.afterRevoke=await current.page.evaluate(()=>({finance:[...document.querySelectorAll('main a')].some(n=>n.textContent.trim()==='Open finance queue'),inbox:[...document.querySelectorAll('main a')].some(n=>n.textContent.trim()==='Open inbox')}));await current.context.close();
}
await context.close();
}catch(e){result.failure=e.message;throw e;}finally{await writeFile(out,JSON.stringify(result,null,2));await browser.close();}
