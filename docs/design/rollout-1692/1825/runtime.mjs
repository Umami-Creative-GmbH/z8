// pnpm node docs/design/rollout-1692/1825/runtime.mjs <owned-private-fixture> <before|final|combined>
// Before requires untouched consumer bytes. Each capture pins actual HEAD, dirty source and hashes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const [fixtureInput, mode] = process.argv.slice(2);
assert.ok(['before', 'final', 'combined'].includes(mode));
const repo = process.cwd(), fixtureDir = resolve(fixtureInput);
const json = async name => JSON.parse(await readFile(join(fixtureDir, name), 'utf8'));
const runtime = await json('runtime-private.json'), fixture = await json('fixture-private.json'), services = await json('services.json');
assert.equal(fixture.kind, 'disposable');
assert.equal(new URL(runtime.origin).hostname, 'localhost');
assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label, 'z8-performance-fixture-1450');
for (const container of services.containers) {
 assert.match(container, /^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);
 assert.equal(execFileSync('docker', ['inspect', '--format', '{{ index .Config.Labels "z8.agent-owned" }}', container], {encoding:'utf8', windowsHide:true}).trim(), services.label);
}
const git = (...args) => execFileSync('git', args, {encoding:'utf8', stdio:['ignore','pipe','pipe']}).trim();
const files = ['apps/webapp/src/app/[locale]/(auth)/licenses/page.tsx', 'apps/webapp/src/components/licenses/license-table.tsx'];
const source = async () => ({head:git('rev-parse','HEAD'), branch:git('branch','--show-current'), dirty:git('status','--porcelain','--untracked-files=no'), hashes:Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))});
if (mode === 'before') for (const file of files) assert.equal(git('diff','1ab2a066a','--',file), '');
const reportBytes = await readFile('apps/webapp/src/data/licenses.json');
const report = JSON.parse(reportBytes);
const out = join(repo, 'docs/design/rollout-1692/1825');
const browser = await createRequire(join(repo, 'package.json'))('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
const result = {mode, fixture:'own disposable local synthetic services; anonymous actual generated production dependency report', report:{sha256:createHash('sha256').update(reportBytes).digest('hex'), packages:report.length, licenses:[...new Set(report.map(x=>x.license || 'Unknown'))], emptyLicenseRecords:report.filter(x=>!x.license).length}, captures:[], actions:[], pageErrors:[]};
let page;
const open = async (locale='en') => {
 await page.goto(`${runtime.origin}/${locale}/licenses`, {waitUntil:'networkidle0',timeout:90000});
 await page.waitForSelector('table tbody tr');
 assert.equal(new URL(page.url()).pathname, `/${locale}/licenses`);
};
const rows = () => page.$$eval('tbody tr', rows=>rows.map(r=>[...r.querySelectorAll('td')].map(x=>x.innerText)));
const capture = async label => {
 const state = await page.evaluate(()=>{
  const table=document.querySelector('table');
  let scroll=table.parentElement; while(scroll && !(getComputedStyle(scroll).overflowY==='auto' && scroll.scrollHeight>scroll.clientHeight+1)) scroll=scroll.parentElement;
  const cell=table.querySelector('tbody td'), rect=cell.getBoundingClientRect();
  return {heading:[...document.querySelectorAll('h1')].map(x=>x.textContent), width:innerWidth, height:innerHeight, documentWidth:document.documentElement.scrollWidth, fontPx:getComputedStyle(document.documentElement).fontSize, storedFont:localStorage.getItem('z8-font-size'), fontPreference:document.documentElement.dataset.fontSize, dark:document.documentElement.classList.contains('dark'), firstRecord:cell.innerText, recordBox:{left:rect.left,right:rect.right,width:rect.width,scrollWidth:cell.scrollWidth}, rows:table.querySelectorAll('tbody tr').length, localScroll:scroll?{height:scroll.clientHeight,scrollHeight:scroll.scrollHeight}:null, back:document.querySelector('main a')?.getAttribute('href'), infoLinks:[...document.querySelectorAll('section > div a')].map(a=>({name:a.textContent,href:a.getAttribute('href')})).filter(a=>a.href), external:[...table.querySelectorAll('a')].map(a=>({name:a.textContent,href:a.getAttribute('href'),target:a.target,rel:a.rel})), sort:[...table.querySelectorAll('th')].map(x=>({name:x.textContent,sort:x.getAttribute('aria-sort')}))};
 });
 assert.equal(state.heading.length,1); assert.equal(state.documentWidth,state.width);
 assert.ok(state.recordBox.scrollWidth <= state.recordBox.width+1, 'package identity must wrap');
 for(const link of state.external) {assert.equal(link.target,'_blank');assert.ok(link.rel.includes('noopener')&&link.rel.includes('noreferrer'));}
 await page.screenshot({path:join(out,`${mode}-${label}.png`),fullPage:true});
 result.captures.push({label,source:await source(),...state}); return state;
};
const search = async query => {await page.focus('main input'); await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type('main input',query);};
try {
 for(const [label,width,height,dark,large] of [['desktop-light',1600,1000,false,false],['phone-light',390,844,false,false],['wide-dark',2400,1200,true,false],['phone-dark-large',390,844,true,true]]) {
  const context=await browser.createBrowserContext(); page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));
  await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:dark?'dark':'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
  await open();
  if(large) {await page.locator('::-p-aria(Font size)').click();await page.locator('::-p-aria(Large)').click();await page.waitForFunction(()=>document.documentElement.dataset.fontSize==='large');await page.locator('::-p-aria(Toggle theme)').click();await page.locator('::-p-aria(Dark)').click();await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));await page.reload({waitUntil:'networkidle0'});}
  const state=await capture(label); assert.equal(state.rows,report.length);if(large) assert.equal(state.fontPx,'18px');
  if(label==='phone-light') {
   await search('@aws-sdk/client-s3');assert.equal((await rows()).length,1);assert.equal((await rows())[0][0],'@aws-sdk/client-s3');await capture('package-search');
   await search('Apache'); const found=await rows();assert.equal(found.length,report.filter(x=>x.license.toLowerCase().includes('apache')||x.name.toLowerCase().includes('apache')).length);await capture('license-search');
   await search('no-such-r026-package');assert.match((await rows())[0][0],/No packages found/);await capture('empty-search');
   if(mode==='before') await search('');else await page.locator('::-p-aria(Clear search)').click();assert.equal((await rows()).length,report.length);
   const clickSort=async name=>{await page.locator(`::-p-aria(${name}[role="button"])`).click();};
   await clickSort('Package');assert.equal((await rows())[0][0],'zustand');await clickSort('Package');assert.equal((await rows())[0][0],'@aws-sdk/client-s3');
   await clickSort('License');const asc=await rows();await clickSort('License');const desc=await rows();assert.ok(asc[0][1]!==desc[0][1]);await capture('license-descending');
   await clickSort('Package');
   await page.focus('main input');await page.keyboard.press('Tab');
   // Read after the existing focus-color transition has settled, not at its transparent first frame.
   await new Promise(resolve=>setTimeout(resolve,250));
   const focus=await page.evaluate(()=>({name:document.activeElement.textContent,focusVisible:document.activeElement.matches(':focus-visible'),shadow:getComputedStyle(document.activeElement).boxShadow,outline:getComputedStyle(document.activeElement).outlineStyle}));assert.match(focus.name,/Package/);assert.equal(focus.focusVisible,true);assert.ok(!focus.shadow.includes('oklab(0 0 0 / 0)'));result.actions.push({task:'search-package/license/no-match/reset/sort-both-directions/keyboard-focus',matched:true,focus,ascLicense:asc[0][1],descLicense:desc[0][1]});await capture('keyboard');
   await page.keyboard.press('Tab');await page.keyboard.press('Tab');
   const linkFocus=await page.evaluate(()=>({tag:document.activeElement.tagName,name:document.activeElement.textContent,href:document.activeElement.getAttribute('href'),focusVisible:document.activeElement.matches(':focus-visible'),outline:getComputedStyle(document.activeElement).outlineStyle}));assert.equal(linkFocus.tag,'A');assert.equal(linkFocus.focusVisible,true);if(mode!=='before')assert.notEqual(linkFocus.outline,'none');result.actions.push({task:'keyboard reaches source link',...linkFocus});await capture('link-focus');
   const last=await page.evaluate(()=>{let el=document.querySelector('table').parentElement;while(el&&!(getComputedStyle(el).overflowY==='auto'&&el.scrollHeight>el.clientHeight+1))el=el.parentElement;if(!el)throw Error('No bounded record scroll');el.scrollTop=el.scrollHeight;const last=document.querySelector('tbody tr:last-child'),box=last.getBoundingClientRect(),viewport=el.getBoundingClientRect();return {name:last.querySelector('td').textContent,scrollTop:el.scrollTop,visible:box.bottom>viewport.top&&box.top<viewport.bottom};});
   assert.equal(last.name,'zustand');assert.ok(last.visible);assert.ok(last.scrollTop>0);result.actions.push({task:'last full-report record reachable in bounded local scroll',...last});
   await capture('last-record');
   await open('de');const german=await capture('locale-de');assert.equal(german.back,'/de/sign-in');
  }
  await context.close();
 }
 if(mode!=='before') {
  const auth=await json('dev-auth-private.json');const context=await browser.createBrowserContext();await context.setCookie(...auth['small-admin'].cookies);page=await context.newPage();page.on('pageerror',e=>result.pageErrors.push(e.message));await open();assert.equal((await rows()).length,report.length);await capture('signed-in-public');result.actions.push({task:'real signed-in synthetic admin public arrival',matched:true});await context.close();
 }
 assert.deepEqual(result.pageErrors,[]);
} finally {await writeFile(join(out,`${mode}-runtime.json`),JSON.stringify(result,null,2));await browser.close();}
