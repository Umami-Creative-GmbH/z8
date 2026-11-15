// Run from repo root with the guarded fixture: pnpm node docs/design/rollout-1692/1714/capture.mjs <private-fixture-directory> <before|after>
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=process.cwd(), dir=resolve(process.argv[2]), phase=process.argv[3]||'before';
const require=createRequire(join(repo,'package.json'));
const puppeteer=require('puppeteer-core');
const {prepareFixtureBrowserContext}=await import(pathToFileURL(join(repo,'scripts/performance/journey-steps.mjs')));
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(fixture.kind!=='disposable'||new URL(runtime.origin).hostname!=='localhost'||runtime.env.POSTGRES_HOST!=='127.0.0.1'||!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(runtime.env.POSTGRES_DB))throw Error('Owned disposable loopback fixture required');
const actors=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const out=join(repo,'docs/design/rollout-1692/1714'); await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.createBrowserContext(); await prepareFixtureBrowserContext(context,runtime.origin); await context.setCookie(...actors['small-admin'].cookies);
 const page=await context.newPage(); await page.setViewport({width:1600,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(new URL('/en/compliance',runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});
 await page.waitForFunction(()=>document.body.innerText.includes('Rest-period violations: 1'),{timeout:120000});
 const result=await page.evaluate(()=>({headings:[...document.querySelectorAll('h1,h2,h3')].map(n=>({level:n.tagName,text:n.textContent})),links:[...document.querySelectorAll('main a')].map(n=>({text:n.textContent,href:n.getAttribute('href')})),text:document.querySelector('main')?.innerText,width:document.documentElement.scrollWidth,viewport:innerWidth}));
 await page.screenshot({path:join(out,`${phase}-desktop.png`),fullPage:true});
 await page.setViewport({width:390,height:844});await new Promise(r=>setTimeout(r,700));await page.screenshot({path:join(out,`${phase}-phone.png`),fullPage:true});
 result.phone=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));result.errors=errors;
 await writeFile(join(out,`${phase}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify({phase,headings:result.headings,phone:result.phone,errors}));
}finally{await browser.close();}
