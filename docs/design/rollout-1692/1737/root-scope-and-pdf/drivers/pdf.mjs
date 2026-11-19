import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {outputDir,sourceProof,fixtureFromPointer,normalSignIn,requireRoot,requireApp,save,failure,sha,nextMcp,capture,noDialog} from './common.mjs';
// node <pdf.mjs> <own-private-pointer> <unique-output-dir> [expected-after-ref]
const [pointer,output,expectedRef]=process.argv.slice(2),out=await outputDir(output);
const result={status:'failed-setup',checks:[],captures:[],browserErrors:[],downloadEvents:[],cleanup:{},qualification:'Own ephemeral Chromium and normal sign-in; public Generate and Export PDF; native Browser downloadProgress must complete before parsing the actual bytes. Canonical serializers/builders untouched. No cookie/state/session save, restore, transfer or mint. This closes only the PDF dependency gap; inherited CSV/XLSX evidence remains separate.'};
let browser,failed=false;
try{
 result.source=await sourceProof('after',expectedRef);const {runtime,fixture}=await fixtureFromPointer(pointer),actor=fixture.actors['small-admin'];assert.ok(actor);
 const puppeteer=requireRoot('puppeteer-core');browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});result.browserPermissions='notifications-denied-for-fixture-origin; canonical repository fixture policy';
 const page=await context.newPage();page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});page.on('pageerror',e=>result.browserErrors.push({name:e.name,message:e.message}));
 result.auth=await normalSignIn(page,runtime,actor);await page.goto(runtime.origin+'/en/reports/vehicles',{waitUntil:'domcontentloaded',timeout:90000});
 const visibleButton=async label=>{await page.waitForFunction(label=>[...document.querySelectorAll('main button')].some(e=>e.checkVisibility()&&!e.disabled&&e.textContent.trim()===label),{},label);for(const b of await page.$$('main button'))if(await b.evaluate((e,label)=>e.checkVisibility()&&!e.disabled&&e.textContent.trim()===label,label))return b;throw Error('Public control unavailable');};
 await visibleButton('Generate report');await noDialog(page);assert.equal(await page.evaluate(()=>document.querySelector('main')?.innerText.includes('No report generated yet')),true);result.captures.push(await capture(page,out,'pdf-ungenerated-desktop.png',result.source));
 await(await visibleButton('Generate report')).click();await page.waitForFunction(()=>document.querySelector('main')?.innerText.includes('147 km')&&document.querySelector('main')?.innerText.includes('Archived fixture van')&&[...document.querySelectorAll('main button')].some(e=>e.checkVisibility()&&!e.disabled&&e.textContent.trim()==='Export PDF'));
 const ui=await page.evaluate(()=>({text:document.querySelector('main')?.innerText??'',rows:[...document.querySelectorAll('main table tr')].map(e=>e.innerText)}));
 assert.ok(ui.text.includes('FIX-1737'));assert.ok(ui.text.includes('Person 0'));assert.ok(ui.text.includes('Own vehicle'));const total=ui.rows.find(x=>x.startsWith('Total\t'));assert.ok(total);assert.deepEqual([...total.matchAll(/(\d+) km/g)].map(x=>Number(x[1])),[101,46,...Array(10).fill(0),147]);result.generatedUI=ui;result.checks.push('Actual Generate returned January 101, February 46, remaining months zero and total 147');
 for(const [width,height,name]of [[1600,1000,'desktop'],[390,844,'phone']]){await page.setViewport({width,height});result.captures.push(await capture(page,out,'pdf-generated-'+name+'.png',result.source));}await page.setViewport({width:1600,height:1000});await noDialog(page);
 const downloadDirectory=join(out,'owned-downloads');await mkdir(downloadDirectory,{recursive:true});const cdp=await browser.target().createCDPSession();
 cdp.on('Browser.downloadWillBegin',e=>result.downloadEvents.push({kind:'begin',guid:e.guid,filename:e.suggestedFilename,at:new Date().toISOString()}));
 cdp.on('Browser.downloadProgress',e=>result.downloadEvents.push({kind:'progress',guid:e.guid,state:e.state,receivedBytes:e.receivedBytes,totalBytes:e.totalBytes,at:new Date().toISOString()}));
 await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',browserContextId:context.id,downloadPath:downloadDirectory,eventsEnabled:true});
 await(await visibleButton('Export PDF')).click();const deadline=Date.now()+90000;let begin,complete;
 while(Date.now()<deadline){begin=result.downloadEvents.find(e=>e.kind==='begin');if(begin)complete=result.downloadEvents.find(e=>e.kind==='progress'&&e.guid===begin.guid&&['completed','canceled'].includes(e.state));if(complete)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(begin,'Actual browser download began');assert.equal(complete?.state,'completed','Actual browser download completed');assert.ok(begin.filename.endsWith('.pdf'));assert.equal(begin.filename,begin.filename.replaceAll(/[\\/]/g,''));
 const bytes=await readFile(join(downloadDirectory,begin.filename));assert.equal(bytes.subarray(0,5).toString(),'%PDF-');await writeFile(join(out,'actual.pdf'),bytes);result.download={state:complete.state,filename:begin.filename,artifact:'actual.pdf',sha256:sha(bytes),bytes:bytes.length,at:new Date().toISOString()};
 const {getDocument}=await import(pathToFileURL(requireApp.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);const task=getDocument({data:new Uint8Array(bytes),useSystemFonts:true});const pdf=await task.promise,pages=[];
 for(let index=1;index<=pdf.numPages;index++){const content=await(await pdf.getPage(index)).getTextContent();pages.push(content.items.map(item=>'str'in item?item.str:'').join(' ').replace(/\s+/g,' ').trim());}await task.destroy();const text=pages.join(' ');
 assert.ok(text.includes('Distance per Vehicle'));assert.ok(text.includes('Period'));assert.ok(text.includes('Generated on'));assert.ok(text.includes('FIX-1737'));assert.ok(text.includes('Person 0'));assert.ok(text.includes('Own vehicle'));assert.ok(text.includes('(archived)'));assert.ok(text.includes('2026'));assert.ok(text.includes('Whole kilometres of completed work'));
 const vanStart=text.indexOf('Archived fixture van'),ownStart=text.indexOf('Own vehicle',vanStart),totalStart=text.indexOf('Total',ownStart);assert.ok(vanStart>=0&&ownStart>vanStart&&totalStart>ownStart);
 const numbers=s=>[...s.replaceAll('FIX-1737','').replaceAll('Person 0','').matchAll(/\b\d+\b/g)].map(x=>Number(x[0]));
 const van=numbers(text.slice(vanStart,ownStart)),own=numbers(text.slice(ownStart,totalStart));assert.deepEqual(van,[101,17,...Array(10).fill(0),118]);assert.deepEqual(own,[0,29,...Array(10).fill(0),29]);
 const totalText=text.slice(totalStart,text.indexOf('Whole kilometres',totalStart)),totalNumbers=numbers(totalText);assert.deepEqual(totalNumbers,[101,46,...Array(10).fill(0),147]);
 const period=text.slice(text.indexOf('Period'),text.indexOf('Generated on')).replace(/\s+/g,' ').trim();assert.match(period,/Jan(?:uary)?\s+1(?:,?\s+2026)?\s*[–-]\s*Dec(?:ember)?\s+31,?\s+2026/,"Exact current-year 2026 endpoints Jan 1 through Dec 31");
 result.pdf={pages:pages.length,text:pages,parsed:{period,vanMonthlyAndTotal:van,ownMonthlyAndTotal:own,monthlyAndTotal:totalNumbers,identities:['Archived fixture van (archived)','FIX-1737','Person 0','Own vehicle']}};result.checks.push('Completed actual PDF parsed with identity, period, generation metadata, monthly values and exact 147 total');
 assert.equal(result.browserErrors.length,0,'No browser exceptions');result.next=await nextMcp(runtime.origin);result.sourceAtEnd=await sourceProof('after',expectedRef);assert.deepEqual(result.source.source,result.sourceAtEnd.source,'Source stable during this run');result.status='accepted-completed-pdf';await context.close();result.cleanup.context='Own ephemeral context closed';
}catch(error){failed=true;result.failure=failure(error);result.status='failed-run';}
finally{if(browser)try{await browser.close();result.cleanup.browser='Own launched Chromium closed';}catch(error){failed=true;result.status='failed-cleanup';result.cleanup.failure=failure(error);}await save(out,'vehicle-pdf.json',result);}
console.log(JSON.stringify({status:result.status,checks:result.checks.length,download:result.download?{state:result.download.state,bytes:result.download.bytes,sha256:result.download.sha256}:null,cleanup:result.cleanup}));if(failed)process.exitCode=1;

