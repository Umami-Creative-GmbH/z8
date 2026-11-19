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
const actor=f.actors[process.argv[2]];
await page.type('input[type=email]',actor.email);
await page.type('input[type=password]',actor.password);
await page.waitForFunction(()=>!document.querySelector('button[type=submit]')?.disabled,{timeout:60000});
await page.click('button[type=submit]');
await page.waitForFunction(()=>!location.pathname.includes('sign-in'),{timeout:60000});
await page.waitForNetworkIdle({idleTime:1500,timeout:30000}).catch(()=>{});
console.log('Normal UI login completed');

const batch=(await readFile('.tmp/1733/batch-id.txt','utf8')).trim();
await page.goto(r.origin+'/en/personnel-files/payslip-batches/'+batch,{waitUntil:'networkidle2',timeout:120000});
await page.waitForFunction(()=>document.body.innerText.includes('Page not found'),{timeout:30000});
const result=await page.evaluate(()=>({notFound:document.body.innerText.includes('Page not found'),intake:!!document.querySelector('input[type=file]'),record:document.body.innerText.includes('1733-first.pdf')}));
if(!result.notFound||result.intake||result.record)throw Error('Restricted scope leaked');
await writeFile('docs/design/rollout-1692/1733/'+process.argv[2]+'.json',JSON.stringify(result,null,2));
console.log(process.argv[2]+' restricted at actual route');
}finally{await browser.close();}
