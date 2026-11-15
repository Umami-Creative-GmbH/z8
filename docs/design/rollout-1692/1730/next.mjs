import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {repo,dir,pool,runtime} from './fixture.mjs';
import {prepareFixtureBrowserContext} from '../../../../scripts/performance/journey-steps.mjs';
await pool.end();
const puppeteer=createRequire(join(repo,'package.json'))('puppeteer-core'),auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const result={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pageErrors:[],probes:[]};
const call=async(method,params)=>{const response=await fetch(new URL('/_next/mcp',runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?raw.split(/\r?\n/).filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6))).find(entry=>entry.id===1):JSON.parse(raw);};
try{
 const context=await browser.createBrowserContext();await prepareFixtureBrowserContext(context,runtime.origin);await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();page.on('pageerror',error=>result.pageErrors.push(error.message));
 await page.goto(runtime.origin+'/en/personnel-files/document-requests?status=all',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.body.innerText.includes('R047 record'));
 const tools=await call('tools/list');assert(JSON.stringify(tools).includes('get_compilation_issues'));result.toolsAvailable=true;
 for(const name of ['get_compilation_issues','get_errors'])result.probes.push({name,result:await call('tools/call',{name,arguments:{}})});
 const routes=await call('tools/call',{name:'get_routes',arguments:{}});result.routeListed=JSON.stringify(routes).includes('/personnel-files/document-requests');assert(result.routeListed);assert.deepEqual(result.pageErrors,[]);
}catch(error){result.failure=error.message;throw error;}finally{await writeFile(join(repo,'docs/design/rollout-1692/1730/next-runtime.json'),JSON.stringify(result,null,2)+'\n');await browser.close();}
