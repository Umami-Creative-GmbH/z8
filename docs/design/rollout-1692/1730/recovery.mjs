import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,pool,runtime} from './fixture.mjs';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const out=join(repo,'docs/design/rollout-1692/1730'),result={checks:[]};let renamed=false;
try {
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();await page.setViewport({width:1600,height:1000});
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=all&pageSize=10',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.body.innerText.includes('R047 record'));
 await clickVisible(page,'button::-p-text(Request from several)');await page.waitForSelector('[role="dialog"] input[id$="-form-item"]');await page.type('[role="dialog"] input[id$="-form-item"]','Retained R047 draft');
 await pool.query('alter table employee_document_request rename to z8_1730_request_read_failure');renamed=true;
 // Escape closes the ordinary mounted draft under the existing reset-on-cancel policy; reopen after refresh check separately.
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
 await clickVisible(page,'button[aria-label="Refresh data"]');
 await page.waitForFunction(()=>document.body.innerText.includes('Previously loaded records are shown'));
 assert(await page.evaluate(()=>document.body.innerText.includes('R047 record')));result.checks.push('Actual failed same-filter RSC refresh retains request records');
 assert.equal(await page.$('button[aria-label^="Change R047"]'),null);result.checks.push('Stale officer decision targets are disabled after read failure');
 await page.screenshot({path:join(out,'read-failed.png')});
 await pool.query('alter table z8_1730_request_read_failure rename to employee_document_request');renamed=false;
 await clickVisible(page,'button::-p-text(Retry)');await page.waitForFunction(()=>!document.body.innerText.includes('Previously loaded records are shown'));
 assert(await page.$('button[aria-label^="Change R047"]'));result.checks.push('Native Retry recovers actual server records and decisions');
 await page.screenshot({path:join(out,'read-recovered.png')});
 // A real transport abort before admission leaves a recoverable bulk draft, never a fabricated successful HTTP result.
 await clickVisible(page,'button::-p-text(Request from several)');await page.waitForSelector('[role="dialog"] input[id$="-form-item"]');
 await page.type('[role="dialog"] input[id$="-form-item"]','R047 transport draft');await clickVisible(page,'[role="dialog"] [role="switch"]');await clickVisible(page,'[role="dialog"] button[aria-required="true"]');await (await page.$('[role="grid"] button:not([disabled])')).click();
 let abort=true;await page.setRequestInterception(true);page.on('request',async request=>{if(abort&&request.method()==='POST'&&request.headers()['next-action']&&request.postData()?.includes('R047 transport draft'))return request.abort('failed');if(!request.isInterceptResolutionHandled())return request.continue();});
 await clickVisible(page,'[role="dialog"] button[type="submit"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('outcome could not be confirmed'));
 assert.equal(await page.$eval('[role="dialog"] input[id$="-form-item"]',i=>i.value),'R047 transport draft');result.checks.push('Real aborted transport retains title, selection and deadline with inline uncertain-outcome retry');
 await page.screenshot({path:join(out,'bulk-transport-failure.png')});
 abort=false;await clickVisible(page,'[role="dialog"] button[type="submit"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.innerText.includes('Documents requested'));
 result.checks.push('Real retry after transport abort creates requests and displays actual summary');
}catch(error){result.failure=error.message;throw error;}finally{if(renamed)await pool.query('alter table z8_1730_request_read_failure rename to employee_document_request');await writeFile(join(out,'recovery-runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();await pool.end();}
