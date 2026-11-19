import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createRequire } from 'node:module';
const repo=resolve('.'), dir=resolve(process.argv[2]), output=join(repo,'docs/design/rollout-1692/1701');
const require=createRequire(join(repo,'package.json')), puppeteer=require('puppeteer-core');
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')), f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8')), auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
if(f.kind!=='disposable'||new URL(r.origin).hostname!=='localhost')throw Error('Unsafe fixture');
await mkdir(output,{recursive:true});
const mode=process.argv[3]||'before';
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
const c=await browser.createBrowserContext(); await c.setPermission(r.origin,{permission:{name:'notifications'},state:'denied'}); await c.setCookie(...auth['small-employee'].cookies);
const page=await c.newPage(); page.setDefaultTimeout(60000); const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.setViewport({width:1600,height:1000});await page.goto(r.origin+'/en/absences',{waitUntil:'networkidle0',timeout:120000});
await page.screenshot({path:join(output,mode+'-desktop.png')});
await page.waitForSelector('[role=tab]');
const tableTab=(await page.waitForFunction(()=>[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Table'))).asElement(); await tableTab.click();
await new Promise(d=>setTimeout(d,1500));
const evidence={scope:'synthetic small-employee, own absence records, organization Europe/Berlin, 2026',h1:await page.$$eval('h1',es=>es.map(e=>e.textContent)),rows:await page.$$eval('tbody tr',es=>es.map(e=>e.textContent)),buttons:await page.$$eval('button',es=>es.filter(e=>e.getBoundingClientRect().width).map(e=>e.textContent||e.getAttribute('aria-label'))),errors};
await page.screenshot({path:join(output,mode+'-table-desktop.png')});
await page.setViewport({width:390,height:844});await page.screenshot({path:join(output,mode+'-table-phone.png')});evidence.phone=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
await writeFile(join(output,mode+'-assertions.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({h1:evidence.h1,rows:evidence.rows.length,phone:evidence.phone,errors}));
}finally{await browser.close();}
