import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import puppeteer from 'puppeteer-core';
const directory=process.argv[2],runtime=JSON.parse(await readFile(join(directory,'runtime-private.json'),'utf8')),fixture=JSON.parse(await readFile(join(directory,'fixture-private.json'),'utf8')),auth=JSON.parse(await readFile(join(directory,'dev-auth-private.json'),'utf8'));
assert.equal(fixture.kind,'disposable');assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);const page=await context.newPage();
const result={classification:'fresh Next diagnostics with connected actual MFA page',pageErrors:[],probes:[]};page.on('pageerror',e=>result.pageErrors.push(e.message));
const call=async(method,params)=>{const response=await fetch(new URL('/_next/mcp',runtime.origin),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})}),signal:AbortSignal.timeout(120000)});assert.equal(response.status,200);const raw=await response.text();return response.headers.get('content-type')?.includes('text/event-stream')?raw.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>JSON.parse(x.slice(6))).find(x=>x.id===1):JSON.parse(raw);};
try{await page.goto(runtime.origin+'/en/mfa?organizationId='+fixture.actors['small-admin'].organizationId,{waitUntil:'networkidle0'});await page.waitForSelector('input[name="code"]');
 const tools=await call('tools/list');assert.ok(JSON.stringify(tools).includes('get_compilation_issues'));result.toolsAvailable=true;
 for(const name of ['get_compilation_issues','get_errors','get_routes']){const response=await call('tools/call',{name,arguments:{}});result.probes.push({name,result:response});}
 assert.deepEqual(result.pageErrors,[]);
}finally{await writeFile('.tmp/1826-root-runtime/next.json',JSON.stringify(result,null,2)+'\n');await browser.close();}
console.log('Saved fresh connected Next probes; inspect exact results before claiming a pass.');
