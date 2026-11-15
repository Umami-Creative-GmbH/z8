import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import puppeteer from 'puppeteer-core';
const [fixtureInput, phase] = process.argv.slice(2);
assert.ok(['before', 'after'].includes(phase));
const dir = resolve(fixtureInput), out = resolve('.tmp/1726-root-checks/runtime');
await mkdir(out, {recursive:true});
const read = async name => JSON.parse(await readFile(join(dir, name), 'utf8'));
const runtime = await read('runtime-private.json'), fixture = await read('fixture-private.json');
const services = await read('services.json'), auth = await read('dev-auth-private.json');
const scope = await read('r043-private.json');
assert.equal(fixture.kind, 'disposable');
assert.equal(new URL(runtime.origin).hostname, 'localhost');
assert.equal(runtime.env.POSTGRES_HOST, '127.0.0.1');
assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label, 'z8-performance-fixture-1450');
for (const container of services.containers) assert.equal(execFileSync('docker', ['inspect','--format','{{ index .Config.Labels "z8.agent-owned" }}',container], {encoding:'utf8',windowsHide:true}).trim(), services.label);
const source = 'apps/webapp/src/components/settings/work-balance/opening-balance-upload-dialog.tsx';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = {phase, source:{path:source, sha256:sha(await readFile(source)), canonicalSha256:sha((await readFile(source,'utf8')).replace(/\r\n/g,'\n'))}, checks:[], captures:[], errors:[], requests:[]};
const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
const context = await browser.createBrowserContext();
await context.setPermission(runtime.origin, {permission:{name:'notifications'}, state:'denied'});
await context.setCookie(...auth['small-employee'].cookies);
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', error => result.errors.push(error.message));
page.on('response', response => {
  const url=new URL(response.url());
  if (url.origin===runtime.origin && url.pathname.startsWith('/en/') && (result.responses?.length??0)<40) (result.responses??=[]).push({path:url.pathname,status:response.status(),method:response.request().method()});
});
const reason = 'R043 root lifecycle carry forward';
page.on('request', request => {
  if (request.method() === 'POST' && request.headers()['next-action'] && request.postData()?.includes(reason)) result.requests.push({path:new URL(request.url()).pathname, action:request.headers()['next-action']});
});
const record = (name, extra={}) => result.checks.push({name, ...extra});
const click = async name => {
  const handle = await page.waitForFunction(name => [...document.querySelectorAll('button')].find(node => node.checkVisibility() && (node.getAttribute('aria-label') === name || node.textContent.trim() === name)), {}, name);
  await handle.asElement().click();
};
const capture = async name => {
  await page.evaluate(() => document.fonts.ready);
  const observation = await page.evaluate(() => ({path:location.pathname, viewport:{width:innerWidth,height:innerHeight}, documentWidth:document.documentElement.scrollWidth, font:getComputedStyle(document.documentElement).fontSize, headings:[...document.querySelectorAll('h1')].filter(node=>node.checkVisibility()).map(node=>node.textContent), dialog:document.querySelector('[role=dialog]')?.innerText, fileDisabled:document.querySelector('input[type=file]')?.disabled, main:[...document.querySelectorAll('main')].map(node=>{const r=node.getBoundingClientRect();return {x:r.x,width:r.width};})}));
  const nameWithPhase = `${phase}-${name}.png`;
  const bytes = Buffer.from(await page.screenshot({path:join(out, nameWithPhase)}));
  result.captures.push({name:nameWithPhase, ...observation, png:{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),sha256:sha(bytes)}, source:result.source});
};
const upload = async () => {
  const file = join(dir, 'root-opening.csv');
  await writeFile(file, `employee_number,day,balance,reason\nR043-1,2026-03-31,2:30,${reason}\n`, 'utf8');
  await (await page.waitForSelector('input[type=file]')).uploadFile(file);
};
let client, held;
try {
  await page.setViewport({width:1600,height:1000});
  await page.goto(runtime.origin+'/en/payroll/work-balances', {waitUntil:'domcontentloaded', timeout:60000});
  await page.waitForFunction(() => location.pathname === '/en/payroll/work-balances' && document.querySelectorAll('main a[href*="/payroll/work-balances/"]').length === 3);
  await capture('directory');
  await click('Upload opening balances');
  await page.evaluate(() => {window.__r043RootFile = document.querySelector('input[type=file]');});
  client = await page.createCDPSession();
  let finishHold;
  const paused = new Promise(resolve => {finishHold=resolve;});
  client.on('Fetch.requestPaused', async event => {
    const isAction = event.request.method === 'POST' && Object.keys(event.request.headers).some(key => key.toLowerCase() === 'next-action');
    if (!held && isAction) {held=event;finishHold(event);return;}
    await client.send('Fetch.continueResponse', {requestId:event.requestId}).catch(()=>{});
  });
  await client.send('Fetch.enable', {patterns:[{urlPattern:runtime.origin+'/en/payroll/work-balances*', requestStage:'Response'}]});
  const responseReady = page.waitForResponse(response => response.request().method()==='POST' && Boolean(response.request().headers()['next-action']) && new URL(response.url()).pathname==='/en/payroll/work-balances', {timeout:60000});
  await upload();
  await Promise.race([paused, new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Actual preview response did not pause')),45000);timer.unref();})]);
  assert.equal(held.responseStatusCode,200);
  assert.equal(await page.$eval('input[type=file]', node=>node.disabled),true);
  record('held the actual successful server preview response with the original payload', {status:held.responseStatusCode});
  await page.evaluate(() => window.next.router.push('/en/my-equipment'));
  await page.waitForFunction(() => location.pathname === '/en/my-equipment');
  record('actual Next router leaves the pending upload route; this bypasses normal pending dialog dismissal');
  await client.send('Fetch.continueResponse', {requestId:held.requestId});
  const response = await responseReady;
  const responseBytes = await response.buffer();
  record('released the produced preview without replacing its response', {status:response.status(), bytes:responseBytes.length, sha256:sha(responseBytes)});
  held = null;
  await client.send('Fetch.disable');
  await page.goBack({waitUntil:'domcontentloaded', timeout:30000});
  await page.waitForFunction(() => location.pathname === '/en/payroll/work-balances' && document.querySelectorAll('main a[href*="/payroll/work-balances/"]').length===3);
  result.sameInputRetained = await page.evaluate(() => window.__r043RootFile === document.querySelector('input[type=file]'));
  if (result.sameInputRetained) {
    if (phase==='after') await page.waitForFunction(() => document.querySelector('input[type=file]')?.disabled===false);
    else {
      try {await page.waitForFunction(() => document.querySelector('input[type=file]')?.disabled===false, {timeout:3000});} catch {result.baselinePendingLock=true;}
    }
    record('actual Back reuses the same file control', {pendingLock:await page.$eval('input[type=file]',node=>node.disabled)});
  } else {
    result.qualification='The framework remounted the upload in this browser journey; cached Activity regression remains assembled-only.';
    record('actual Back remounts safely; no cached-Activity browser reproduction claimed');
    await click('Upload opening balances');
  }
  await capture('returned-dialog');
  if (phase==='after') {
    assert.equal(await page.$eval('input[type=file]',node=>node.disabled),false);
    assert.equal(await page.$eval('[role=dialog]',node=>node.querySelectorAll('tbody tr').length),0);
    let aborted=0;
    const abort = request => {
      if (!aborted && request.method()==='POST' && request.headers()['next-action']) {aborted++;return request.abort('failed');}
      return request.continue();
    };
    await page.setRequestInterception(true);page.on('request',abort);
    await upload();
    await page.waitForSelector('[role=alert]');
    assert.equal(aborted,1);
    page.off('request',abort);await page.setRequestInterception(false);
    await capture('retained-file-error');
    const requestsBefore=result.requests.length;
    await click('Retry');
    await page.waitForFunction(()=>document.querySelector('[role=dialog] tbody tr') && document.querySelector('form[aria-busy]')?.getAttribute('aria-busy')==='false');
    assert.equal(result.requests.length,requestsBefore+1);
    record('trusted pointer Retry reuses the retained file and sends exactly one real preview');
    await capture('retry-ready');
    const commitBefore=result.requests.length;
    const submit=await page.waitForSelector('[role=dialog] button[type=submit]');await submit.click();
    await page.waitForFunction(()=>!document.querySelector('[role=dialog]'));
    assert.equal(result.requests.length,commitBefore+1);
    const {Client}=createRequire(resolve('apps/webapp/package.json'))('pg');
    const db=new Client({connectionString:runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL});await db.connect();
    try {
      const rows=(await db.query("select employee_id,to_char(day,'YYYY-MM-DD') as day,minutes,reason,cancelled_at is not null as cancelled from balance_adjustment where organization_id=$1 and employee_id=$2 and reason=$3", [scope.org,scope.covered[0].id,reason])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].minutes,150);assert.equal(rows[0].day,'2026-03-31');assert.equal(rows[0].cancelled,false);
      result.readback=rows;
    } finally {await db.end();}
    record('trusted pointer commit sends one command and stores the expected 150-minute opening balance');
    await capture('committed');
  }
  result.next=[];
  for (const name of ['get_compilation_issues','get_errors']) {
    const response=await fetch(runtime.origin+'/_next/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}}),signal:AbortSignal.timeout(45000)});
    const raw=await response.text();const payload=response.headers.get('content-type')?.includes('event-stream')?JSON.parse(raw.split(/\r?\n/).find(line=>line.startsWith('data: ')).slice(6)):JSON.parse(raw);
    result.next.push({name,result:payload});
  }
  assert.equal(result.errors.length,0);
} catch (error) {
  result.failure=error.message;
  result.failurePage=await page.evaluate(()=>({path:location.pathname,title:document.title,visibleText:document.body.innerText.slice(0,2200)})).catch(()=>null);
  await capture('failed').catch(error=>{result.captureFailure=error.message;});
  throw error;
} finally {
  if (held) await client?.send('Fetch.continueResponse',{requestId:held.requestId}).catch(()=>{});
  await writeFile(join(out,phase+'.json'),JSON.stringify(result,null,2)+'\n');
  await browser.close();
}
console.log(`${phase}: ${result.checks.length} runtime checks, ${result.captures.length} captures.`);
