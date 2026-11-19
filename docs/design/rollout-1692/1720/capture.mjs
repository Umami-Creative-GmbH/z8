import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,pool,runtime} from './fixture.mjs';
await pool.end();
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core');
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const phase=process.argv[3]??'before';
const out=join(repo,'docs/design/rollout-1692/1720');
const paths=['apps/webapp/src/app/[locale]/(app)/my-documents/page.tsx','apps/webapp/src/components/personnel-file/requested-documents.tsx','apps/webapp/src/components/personnel-file/my-documents-list.tsx','apps/webapp/src/components/personnel-file/document-dialog.tsx','apps/webapp/src/components/personnel-file/submit-document-request-dialog.tsx'];
const source={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),hashes:Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(join(repo,p))).digest('hex')])))};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try{
 const context=await browser.createBrowserContext();await context.overridePermissions(runtime.origin,[]);await context.setCookie(...auth['small-employee'].cookies);
 const page=await context.newPage();
 for(const [name,width,height,dark] of [['desktop',1600,1000,false],['wide-dark',2200,1100,true],['phone-dark',390,844,true]]){
  await page.setViewport({width,height});await page.goto(runtime.origin+'/en/my-documents',{waitUntil:'networkidle0'});await page.waitForFunction(()=>document.body.innerText.includes('First aid certificate'));
  await page.evaluate(dark=>{localStorage.setItem('theme',dark?'dark':'light');},dark);await page.reload({waitUntil:'networkidle0'});await page.evaluate(()=>document.fonts.ready);
  const metrics=await page.evaluate(()=>({css:[innerWidth,innerHeight],dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,theme:document.documentElement.className,headings:[...document.querySelectorAll('main h1,main h2')].map(e=>e.textContent),privateAbsent:!document.body.innerText.includes('HR confidential only')&&!document.body.innerText.includes('Foreign employee record')}));
  const file=`${phase}-${name}.png`;await page.screenshot({path:join(out,file),fullPage:true});const sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');const png=await sharp(join(out,file)).metadata();results.push({file,...metrics,png:[png.width,png.height]});
 }
 await writeFile(join(out,`${phase}-captures.json`),JSON.stringify({source,results},null,2)+'\n');console.log(phase+': '+results.length+' captures saved with current source hashes and separate CSS/PNG dimensions.');
}finally{await browser.close();}
