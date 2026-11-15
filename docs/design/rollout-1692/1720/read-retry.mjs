import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,dir,pool,runtime} from './fixture.mjs';
import {prepareFixtureBrowserContext,clickVisible} from '../../../../scripts/performance/journey-steps.mjs';
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),evidence={checks:[]};let renamed=false;
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-manager'].cookies);const page=await context.newPage();
 // Manager's session stays in enabled small org after the other actor's actual switch.
 await pool.query('alter table employee_document rename to z8_1720_document_read_failure');renamed=true;
 await page.goto(runtime.origin+'/en/my-documents',{waitUntil:'networkidle2'});await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Retry'));
 await page.screenshot({path:join(repo,'docs/design/rollout-1692/1720/after-read-failure.png')});
 await pool.query('alter table z8_1720_document_read_failure rename to employee_document');renamed=false;
 await clickVisible(page,'button::-p-text(Retry)');await page.waitForFunction(()=>document.body.innerText.includes('No documents have been shared with you yet.'));
 assert(!await page.evaluate(()=>document.body.innerText.includes('could not be loaded')));evidence.checks.push('Actual read failure shows Retry; restored DB table plus native Retry refetches the real empty record.');
 await page.screenshot({path:join(repo,'docs/design/rollout-1692/1720/after-read-retry.png')});
}finally{if(renamed)await pool.query('alter table z8_1720_document_read_failure rename to employee_document');await writeFile(join(repo,'docs/design/rollout-1692/1720/read-retry.json'),JSON.stringify(evidence,null,2)+'\n');await browser.close();await pool.end();}
console.log('Actual reader failure/retry passed.');
