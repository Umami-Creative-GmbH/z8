import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const repo=process.cwd(), dir=resolve(process.argv[2]), phase=process.argv[3]||'before';
const require=createRequire(join(repo,'package.json')), puppeteer=require('puppeteer-core');
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8')), fixture=JSON.parse(await readFile(join(dir,'fixture-private.json'),'utf8'));
if(fixture.kind!=='disposable'||new URL(runtime.origin).hostname!=='localhost')throw Error('Disposable loopback only');
const actors=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const out=join(repo,'docs/design/rollout-1692/1715');await mkdir(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const originals=[];
try{
if(phase==='before')for(const file of ['apps/webapp/src/app/[locale]/(app)/driving-licence/page.tsx','apps/webapp/src/components/driving-licence/role-tabs.tsx','apps/webapp/src/components/driving-licence/my-licence.tsx','apps/webapp/src/components/driving-licence/history-panel.tsx','apps/webapp/src/components/driving-licence/check-worklist.tsx','apps/webapp/src/components/driving-licence/operational-status.tsx','apps/webapp/src/lib/navigation/route-metadata.ts']){
 originals.push([file,await readFile(join(repo,file))]);await writeFile(join(repo,file),execFileSync('git',['show',`cca1977df:${file}`],{cwd:repo}));
}
const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...actors['small-admin'].cookies);
const page=await context.newPage();await page.setViewport({width:1600,height:1000});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const captures=[];
for(const tab of ['my-licence','checks','planning']){
await page.goto(new URL('/en/driving-licence?tab='+tab,runtime.origin).href,{waitUntil:'networkidle0',timeout:120000});
await page.waitForFunction(()=>document.body.innerText.includes('Original check evidence')||document.body.innerText.includes('Intended drivers to check')||document.body.innerText.includes('Find employee'),{timeout:120000});
for(const [label,width,height] of [['desktop',1600,1000],['phone',390,844]]){
await page.setViewport({width,height});await new Promise(r=>setTimeout(r,300));
await page.screenshot({path:join(out,`${phase}-${tab}-${label}.png`),fullPage:true});
captures.push(await page.evaluate((label)=>({label,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.textContent),text:document.querySelector('main')?.innerText,width:document.documentElement.scrollWidth,viewport:innerWidth}),tab+'-'+label));
}}
await page.setViewport({width:2400,height:1200});await clickVisible(page,'::-p-aria(Toggle theme)');await clickVisible(page,'[role="menuitem"]::-p-text(Dark)');await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.screenshot({path:join(out,`${phase}-wide-dark.png`),fullPage:true});captures.push(await page.evaluate(()=>({label:'planning-wide-dark',width:document.documentElement.scrollWidth,viewport:innerWidth})));
await writeFile(join(out,phase+'.json'),JSON.stringify({captures,errors},null,2));console.log(JSON.stringify({phase,captures:captures.map(({label,width,viewport,headings})=>({label,width,viewport,headings})),errors}));
}finally{await browser.close();for(const [file,source] of originals)await writeFile(join(repo,file),source);}
