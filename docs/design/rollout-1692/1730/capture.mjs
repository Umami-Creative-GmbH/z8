import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {repo,dir,pool,runtime} from './fixture.mjs';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
const stage=process.argv[3]??'after',out=join(repo,'docs/design/rollout-1692/1730');
await pool.end();
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core');
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const result={stage,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:[],captures:[],errors:[]};
for(const path of ['apps/webapp/src/app/[locale]/(app)/personnel-files/document-requests/page.tsx','apps/webapp/src/components/personnel-file/document-requests-overview.tsx','apps/webapp/src/components/personnel-file/document-requests-workspace.tsx','apps/webapp/src/components/personnel-file/bulk-document-requests-dialog.tsx']) {
 const bytes=await readFile(join(repo,path));result.source.push({path,rawSha256:createHash('sha256').update(bytes).digest('hex'),canonicalLfSha256:createHash('sha256').update(bytes.toString().replaceAll('\r\n','\n')).digest('hex')});
}
try {
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);
 const page=await context.newPage();page.on('pageerror',e=>result.errors.push(e.message));
 for(const [name,width,height,theme,font] of [['desktop',1600,1000,'light',16],['phone',390,844,'light',16],['wide-dark',2400,1200,'dark',18],['phone-dark',390,844,'dark',18]]) {
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-color-scheme',value:theme}]);
  await page.evaluateOnNewDocument((theme,font)=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size',font===18?'large':'default');},theme,font);
  await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=all&pageSize=10',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.body.innerText.includes('R047 record'));
  // These are the actual persisted preference owners used by the app.


  await page.evaluate(()=>document.fonts.ready);
  const observation=await page.evaluate(()=>({h1:[...document.querySelectorAll('main h1')].map(x=>x.textContent),overflow:document.documentElement.scrollWidth>innerWidth,font:getComputedStyle(document.documentElement).fontSize,savedFont:localStorage.getItem('z8-font-size'),savedTheme:localStorage.getItem('theme'),dark:document.documentElement.classList.contains('dark'),loadedFonts:document.fonts.status,rows:document.querySelectorAll('main ul.divide-y > li').length,scope:document.body.innerText.includes('Pacific/Kiritimati')}));
  const path=join(out,stage+'-'+name+'.png');await page.screenshot({path,fullPage:true});result.captures.push({name,path:stage+'-'+name+'.png',width,height,theme,font,actor:'synthetic small-admin (owner)',scope:'fixture organization / other employee, all statuses, pageSize=10',...observation});
 }
}catch(error){result.failure=error.message;throw error;}finally{await writeFile(join(out,stage+'-runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();}
