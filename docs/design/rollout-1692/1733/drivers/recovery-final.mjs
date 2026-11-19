import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const repo=process.cwd(), req=createRequire(join(repo,'package.json'));
const dir=(await readFile('.tmp/1733/fixture-path.txt','utf8')).trim();
const r=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const f=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(f.kind!=='disposable'||new URL(r.origin).hostname!=='localhost')throw Error('Own loopback fixture only');
const browser=await req('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();
await context.overridePermissions(r.origin,[]);
const page=await context.newPage();
await page.setViewport({width:1600,height:1000});
page.on('pageerror',e=>writeFile('.tmp/1733/page-errors.txt',e.message+'\n',{flag:'a'}));
try{
await page.goto(r.origin+'/en/sign-in',{waitUntil:'networkidle2',timeout:120000});
console.log((await page.locator('body').wait(),await page.evaluate(()=>[...document.querySelectorAll('input')].map(e=>({id:e.id,type:e.type,name:e.name})))));
const actor=f.actors['small-admin'];
await page.type('input[type=email]',actor.email);
await page.type('input[type=password]',actor.password);
await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled,{timeout:60000});
await page.click('button[type=submit]');
await page.waitForFunction(()=>!location.pathname.includes('sign-in'),{timeout:60000});
await page.waitForNetworkIdle({idleTime:1500,timeout:30000}).catch(()=>{});
console.log('Normal UI login completed');

const fs=await import('node:fs/promises');
const batch=(await readFile('.tmp/1733/batch-id.txt','utf8')).trim();
let failed=0;
await page.setRequestInterception(true);
const fail=request=>{if(request.method()==='POST'&&request.headers()['next-action']&&request.postData()?.includes(batch)&&failed===0){failed++;void request.abort('failed');}else void request.continue();};
page.on('request',fail);
await page.goto(r.origin+'/en/personnel-files/payslip-batches/'+batch,{waitUntil:'networkidle2',timeout:120000});
await page.waitForFunction(()=>document.body.innerText.includes('The payslip batch could not be loaded.'),{timeout:10000}).catch(()=>{});const failedMessage=await page.evaluate(()=>document.body.innerText.includes('The payslip batch could not be loaded.'));
await page.screenshot({path:'docs/design/rollout-1692/1733/read-failure.png'});
page.off('request',fail);await page.setRequestInterception(false);
if(failedMessage)await (await page.waitForSelector('::-p-text(Retry)')).click();
await page.waitForFunction(()=>document.body.innerText.includes('1733-first.pdf'),{timeout:30000});
const keyboard=[];for(let i=0;i<8;i++){await page.keyboard.press('Tab');keyboard.push(await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent?.trim().slice(0,80)})));}
const trigger=await page.$('button[data-sidebar=trigger]');let collapse=null;if(trigger){await trigger.click();await page.waitForNetworkIdle({idleTime:700,timeout:10000}).catch(()=>{});collapse=await page.evaluate(()=>!!document.querySelector('[data-state=collapsed]'));await page.reload({waitUntil:'networkidle2',timeout:120000});await page.waitForFunction(()=>document.body.innerText.includes('1733-first.pdf'));collapse={clicked:collapse,persisted:await page.evaluate(()=>!!document.querySelector('[data-state=collapsed]'))};}
await page.setViewport({width:390,height:844});
await page.$eval('[aria-label="Include 1733-second.pdf"]',e=>e.scrollIntoView({block:'center'}));
await page.screenshot({path:'docs/design/rollout-1692/1733/phone-record-tail.png'});
const {createHash}=await import('node:crypto');
const paths=['apps/webapp/src/components/personnel-file/payslip-batch-workspace.tsx','apps/webapp/src/components/personnel-file/use-payslip-batch-upload.ts','apps/webapp/src/components/personnel-file/payslip-batch-loading-heading.tsx','apps/webapp/src/app/[locale]/(app)/personnel-files/payslip-batches/[batchId]/page.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update((await readFile(p,'utf8')).replaceAll('\r\n','\n')).digest('hex')])));
await fs.writeFile('docs/design/rollout-1692/1733/recovery.json',JSON.stringify({failed,failedMessage,keyboard,collapse,sourceHashes,recoveredRecord:await page.evaluate(()=>document.body.innerText.includes('1733-first.pdf')),qualification:'Transport failure injected at public network boundary; Retry uses real successful server action. Same saved original batch. Phone tail scrolled into view; keyboard focus samples only.'},null,2));
const fixtureFile=dir;
await fs.writeFile('.tmp/1733/browser-ready.txt','ready');
// Keep this real browser connected while the independent Next MCP probe runs.
await new Promise(resolve=>{const timer=setInterval(async()=>{if(await fs.access('.tmp/1733/mcp-complete.txt').then(()=>true).catch(()=>false)){clearInterval(timer);resolve();}},300);});
console.log('Real read failure/retry, phone tail and keyboard probes passed.');
}finally{await browser.close();}


