import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {repo,dir,pool,runtime,fixture} from './fixture.mjs';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),evidence={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),captures:[]};
const paths=['apps/webapp/src/app/[locale]/(app)/my-documents/page.tsx','apps/webapp/src/components/personnel-file/requested-documents.tsx','apps/webapp/src/components/personnel-file/document-list.tsx'];
evidence.source={head:evidence.head,hashes:Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(join(repo,p))).digest('hex')])))};
try{
 const actor=fixture.actors['small-employee'];
 await pool.query("insert into employee_document_request(id,organization_id,employee_id,category,title,note,deadline) values($1,$2,$3,'other',$4,$5,'2026-10-31')",[randomUUID(),actor.organizationId,actor.employeeId,'Fortbildungsbescheinigung für die betriebliche Ersthelferausbildung und die regelmäßige Sicherheitsunterweisung '.repeat(2).slice(0,195),'Bitte reichen Sie das vollständige Dokument einschließlich aller ergänzenden Seiten ein. '.repeat(15)]);
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-employee'].cookies);const page=await context.newPage();await page.setViewport({width:390,height:844});
 for(const theme of ['light','dark']){
  await page.goto(runtime.origin+'/de/my-documents',{waitUntil:'domcontentloaded'});await page.evaluate(theme=>{localStorage.setItem('theme',theme);localStorage.setItem('z8-font-size','large');},theme);await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.innerText.includes('Fortbildungsbescheinigung'));await page.evaluate(()=>document.fonts.ready);
  const actual=await page.evaluate(()=>({css:[innerWidth,innerHeight],width:document.documentElement.scrollWidth,font:getComputedStyle(document.documentElement).fontSize,lang:document.documentElement.lang,theme:document.documentElement.className}));assert.equal(actual.width,390);assert.equal(actual.font,'18px');const file='after-de-long-'+theme+'.png';await page.screenshot({path:join(repo,'docs/design/rollout-1692/1720',file),fullPage:true});const sharp=createRequire(join(repo,'apps/webapp/package.json'))('sharp');const png=await sharp(join(repo,'docs/design/rollout-1692/1720',file)).metadata();evidence.captures.push({file,...actual,png:[png.width,png.height]});
 }
}finally{await writeFile(join(repo,'docs/design/rollout-1692/1720/locale.json'),JSON.stringify(evidence,null,2)+'\n');await browser.close();await pool.end();}
console.log('Actual German route with long synthetic content: light/dark 18px phone fits.');
