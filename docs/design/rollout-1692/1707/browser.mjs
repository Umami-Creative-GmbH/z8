// Own isolated real fixture Chrome for agent-browser / Next MCP inspection.
// pnpm node docs/design/rollout-1692/1707/browser.mjs <private-fixture-directory>
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const dir=resolve(process.argv[2]);
const runtime=JSON.parse(await readFile(join(dir,'runtime-private.json'),'utf8'));
const auth=JSON.parse(await readFile(join(dir,'dev-auth-private.json'),'utf8'));
assert.equal(new URL(runtime.origin).hostname,'localhost');
const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
process.once('SIGINT',()=>void browser.close());process.once('SIGTERM',()=>void browser.close());
const c=await browser.createBrowserContext();await c.setPermission(runtime.origin,{permission:{name:'notifications'},state:'denied'});await c.setCookie(...auth['small-manager'].cookies);
const page=await c.newPage();await page.goto(runtime.origin+'/en/approvals',{waitUntil:'networkidle0',timeout:120000});
await writeFile(join(dir,'cdp-private.json'),JSON.stringify({endpoint:browser.wsEndpoint()}));
console.log('Owned authenticated Chrome ready for worktree-scoped agent-browser attach.');

