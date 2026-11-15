import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
import {repo,dir,runtime,fixture,pool} from './fixture.mjs';
await pool.end();
const phase=process.argv[3],label=process.argv[4]??phase,out=join(repo,'docs/design/rollout-1692/1727');
assert.ok(['before','after'].includes(phase));
const scope=JSON.parse(await readFile(join(dir,'r044-scope.json'),'utf8'));
const sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');
const files=['apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/page.tsx','apps/webapp/src/components/payroll/employee-balance-workspace.tsx','apps/webapp/src/components/settings/work-balance/employee-work-balance-section.tsx','apps/webapp/src/components/settings/work-balance/use-employee-work-balance.ts','apps/webapp/src/components/settings/work-balance/set-opening-balance-dialog.tsx','apps/webapp/src/components/settings/work-balance/record-overtime-payout-dialog.tsx','apps/webapp/src/components/settings/work-balance/cancel-balance-adjustment-dialog.tsx','apps/webapp/src/lib/navigation/route-metadata.ts'];
files.push('apps/webapp/src/app/[locale]/(app)/payroll/work-balances/[employeeId]/actions.ts','apps/webapp/src/components/payroll/employee-balance-projection.tsx','apps/webapp/src/components/settings/work-balance/balance-form-surface.ts','apps/webapp/src/components/settings/work-balance/balance-form-panel.tsx','apps/webapp/src/components/settings/work-balance/use-balance-form-request.ts');
const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=async()=>({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),source:await Promise.all(files.map(async file=>({file,...await readFile(file).then(b=>({raw:hash(b),normalized:hash(b.toString('utf8').replaceAll('\r\n','\n'))})).catch(()=>({absent:true}))}))) });
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const evidence={phase,fixture:'disposable performance fixture; current member specific payroll grant; former target; no personnel/expense grant',scope:{organizationId:scope.holder.organizationId,userId:scope.userId,employeeId:scope.target.employeeId},snapshots:[],errors:[],failures:[]};
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
 await page.goto(runtime.origin+'/en/sign-in',{waitUntil:'networkidle2',timeout:120000});
 const statuses=await page.evaluate(async a=>{const post=(p,b)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json','x-captcha-response':'XXXX.DUMMY.TOKEN.XXXX'},body:JSON.stringify(b)});return [(await post('/api/auth/sign-in/email',{email:a.email,password:a.password})).status,(await post('/api/auth/organization/set-active',{organizationId:a.organizationId})).status];},fixture.actors['small-employee']);assert.deepEqual(statuses,[200,200]);
 await writeFile(join(dir,'r044-auth-private.json'),JSON.stringify(await context.cookies()));
 await page.goto(runtime.origin+'/en/payroll/work-balances/'+scope.target.employeeId,{waitUntil:'networkidle2',timeout:120000});
 await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Balance adjustments'),{timeout:120000});
 for(const [name,width,height,dark,large] of [['desktop-light',1600,1000,false,false],['phone-light',390,844,false,false],['wide-dark',1920,1080,true,false],['phone-dark-large',390,844,true,true]]){
  await page.setViewport({width,height});await page.evaluate((dark)=>{localStorage.setItem('theme',dark?'dark':'light');},dark);await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'}]);
  if(large){await page.setViewport({width:1600,height:1000});await clickVisible(page,'[data-sidebar="footer"] button[data-slot="dropdown-menu-trigger"]');await clickVisible(page,'[role="menuitem"]::-p-text(Font size)');await clickVisible(page,'[role="menuitemradio"]::-p-text(Large)');await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.setViewport({width,height});}
  await page.reload({waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Balance adjustments'));await page.evaluate(()=>document.fonts.ready);
  const observation=await page.evaluate(()=>({text:document.querySelector('main')?.innerText,headings:[...document.querySelectorAll('h1,h2')].map(n=>n.textContent),cssViewport:{width:innerWidth,height:innerHeight},scrollWidth:document.documentElement.scrollWidth,dark:document.documentElement.classList.contains('dark'),savedFont:localStorage.getItem('z8-font-size'),font:getComputedStyle(document.documentElement).fontSize,fontFamily:getComputedStyle(document.querySelector('h1')??document.body).fontFamily,fontsStatus:document.fonts.status,loadedFonts:[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family),devicePixelRatio,visualScale:visualViewport.scale}));
  const path=join(out,`${label}-${name}.png`);await page.screenshot({path,fullPage:false});const decoded=await sharp(path).raw().toBuffer({resolveWithObject:true});evidence.snapshots.push({name,identity:await identity(),observation,png:{width:decoded.info.width,height:decoded.info.height,channels:decoded.info.channels,decodedBytes:decoded.data.length}});
  if(phase==='after')assert.equal(observation.scrollWidth,width);if(large)assert.equal(observation.font,'18px');
 }
}catch(e){evidence.failures.push(e.message);throw e;}finally{await writeFile(join(out,label+'.json'),JSON.stringify(evidence,null,2)+'\n');await browser.close();}
console.log(`${phase}: ${evidence.snapshots.length} actual route captures`);
