// Read-only layout/contrast inspection in the same guarded fixture; no domain mutations.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
const [repoInput,fixtureInput]=process.argv.slice(2),repo=resolve(repoInput),fixture=resolve(fixtureInput);
const json=async name=>JSON.parse(await readFile(join(fixture,name),'utf8'));
const runtime=await json('runtime-private.json'),auth=await json('dev-auth-private.json'),services=await json('services.json');
assert.equal(new URL(runtime.origin).hostname,'localhost');assert.equal(services.label,'z8-performance-fixture-1450');assert.match(runtime.env.POSTGRES_DB,/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
for(const c of services.containers)assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',c],{encoding:'utf8',windowsHide:true}).trim(),services.label);
const require=createRequire(join(repo,'package.json')),puppeteer=require('puppeteer-core');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();const results=[];
try {
 await page.goto(runtime.origin+'/en/onboarding/complete',{waitUntil:'networkidle0'});
 for(const theme of ['light','dark']) {
  await page.setViewport({width:390,height:500});await page.evaluate(theme=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size','large');},theme);await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('a[href$="/init"]');
  const data=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
   const lum=color=>color.slice(0,3).map(c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
   return {rootFont:getComputedStyle(document.documentElement).fontSize,width:innerWidth,documentWidth:document.documentElement.scrollWidth,colors:['h1','p.text-muted-foreground','a[href$="/init"]','a[href$="/settings/holidays"]'].map(selector=>{const el=document.querySelector(selector);const fg=rgba(getComputedStyle(el).color);let parent=el,bg;while(parent){bg=rgba(getComputedStyle(parent).backgroundColor);if(bg[3]===255)break;parent=parent.parentElement;}const a=lum(fg),b=lum(bg);return {selector,foreground:fg,background:bg,ratio:(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)};})};
  });assert.equal(data.documentWidth,390);assert.equal(data.rootFont,'18px');assert.ok(data.colors.every(row=>row.ratio>=4.5));
  await page.focus('a[href$="/init"]');await page.$eval('a[href$="/init"]',el=>el.scrollIntoView({block:'center'}));data.continuationReachable=await page.$eval('a[href$="/init"]',el=>document.activeElement===el&&el.getBoundingClientRect().bottom<=innerHeight);assert.ok(data.continuationReachable);results.push({theme,...data});
 }
}finally {await writeFile(join(repo,'docs/design/rollout-1692/1827/contrast.json'),JSON.stringify(results,null,2));await browser.close();}
