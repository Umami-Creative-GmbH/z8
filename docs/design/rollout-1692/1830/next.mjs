// Fresh connected Chromium + Next's own development MCP view.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
const d=resolve(process.argv[2]),read=async n=>JSON.parse(await readFile(join(d,n),'utf8'));
const r=await read('runtime-private.json'),f=await read('fixture-private.json'),a=await read('dev-auth-private.json');assert.equal(f.kind,'disposable');assert.equal(new URL(r.origin).hostname,'localhost');
const call=async(method,params)=>{const response=await fetch(r.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,...(params?{params}:{})})});assert.ok(response.ok);const text=await response.text();return text.split(/\r?\n/).filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6))).find(x=>x.id===1)??JSON.parse(text);};
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
const context=await browser.createBrowserContext();await context.setCookie(...a['small-admin'].cookies);const p=await context.newPage();const pageErrors=[];p.on('pageerror',e=>pageErrors.push(e.message));await p.goto(r.origin+'/en/onboarding/profile',{waitUntil:'networkidle0'});await p.waitForSelector('#profile-first-name');
const listed=await call('tools/list');const names=listed.result.tools.map(x=>x.name);assert.ok(names.includes('get_compilation_issues'));
const results={tools:names,pageErrors,results:[]};
for(const name of ['get_project_metadata','get_routes','get_page_metadata','get_compilation_issues','get_errors']){const value=await call('tools/call',{name,arguments:{}});await writeFile(join(d,`1830-${name}-private.json`),JSON.stringify(value,null,2),{mode:0o600});
 if(name==='get_project_metadata'||name==='get_compilation_issues'||name==='get_errors')results.results.push({name,result:value});else results.results.push({name,completed:!value.error&&!value.result?.isError});}
await writeFile('docs/design/rollout-1692/1830/next.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
