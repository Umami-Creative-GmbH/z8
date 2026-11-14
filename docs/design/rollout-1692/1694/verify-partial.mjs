// Real stale-selection/partial bulk result and page-size acceptance. Synthetic fixture only.
// pnpm node docs/design/rollout-1692/1694/verify-partial.mjs <private-fixture-directory>
import assert from "node:assert/strict";
import {readFile, writeFile} from "node:fs/promises";
import {resolve, join} from "node:path";
import puppeteer from "puppeteer-core";
const dir=resolve(process.argv[2]), json=async name=>JSON.parse(await readFile(join(dir,name),"utf8"));
const runtime=await json("runtime-private.json"),fixture=await json("fixture-private.json"),auth=await json("dev-auth-private.json");
assert.equal(fixture.kind,"disposable");assert.equal(new URL(runtime.origin).hostname,"localhost");
const browser=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
try {
	const context=await browser.createBrowserContext();await context.setPermission(runtime.origin,{permission:{name:"notifications"},state:"denied"});await context.setCookie(...auth["small-admin"].cookies);
	const page=await context.newPage();await page.setViewport({width:390,height:844});
	const press=async(name,selector="button")=>{const element=await page.evaluateHandle((name,selector)=>[...document.querySelectorAll(selector)].find(n=>n.getClientRects().length&&(n.textContent.trim()===name||n.getAttribute("aria-label")===name)),name,selector);assert.ok(element.asElement(),name);await element.asElement().focus();await page.keyboard.press("Enter");};
	await page.goto(runtime.origin+"/en/settings/vacation?tab=holidays",{waitUntil:"networkidle0"});await press("Custom Holidays");await page.waitForSelector("tbody [role=checkbox]");
	const initialCount=await page.evaluate(async()=>(await(await fetch("/api/org-admin/holidays")).json()).holidays.length);
	await press("Rows per page");await press("10","[role=option]");await page.waitForFunction(()=>document.querySelectorAll("tbody tr").length===10);
	await press("Go to next page");await page.waitForFunction(count=>document.querySelectorAll("tbody tr").length===count,{},initialCount-10);
	await press("Go to first page");await page.waitForFunction(()=>document.querySelectorAll("tbody tr").length===10);
	const api=await page.evaluate(async()=> (await(await fetch("/api/org-admin/holidays")).json()).holidays);assert.equal(api.length,initialCount);
	const names=await page.$$eval("tbody tr",ns=>ns.slice(0,2).map(n=>n.querySelector("button[aria-label^='Edit:']").getAttribute("aria-label").slice(6)));
	const ids=names.map(name=>api.find(h=>h.name===name).id);
	for(const checkbox of (await page.$$("tbody [role=checkbox]")).slice(0,2)){await checkbox.focus();await page.keyboard.press("Space");}
	await page.waitForFunction(()=>document.body.innerText.includes("Delete (2)"));
	// A second page uses the existing single-delete server action (the public API soft archives).
	const concurrent=await context.newPage();await concurrent.setViewport({width:1600,height:1000});
	const concurrentPress=async name=>{const element=await concurrent.evaluateHandle(name=>[...document.querySelectorAll("button")].find(n=>n.getClientRects().length&&(n.textContent.trim()===name||n.getAttribute("aria-label")===name)),name);assert.ok(element.asElement(),name);await element.asElement().focus();await concurrent.keyboard.press("Enter");};
	await concurrent.goto(runtime.origin+"/en/settings/vacation?tab=holidays",{waitUntil:"networkidle0"});await concurrentPress("Custom Holidays");await concurrent.waitForSelector("input[name=search]");await concurrent.locator("input[name=search]").fill(names[0]);
	await concurrent.waitForSelector("tbody button[aria-label='Delete: "+names[0]+"']");await concurrentPress("Delete: "+names[0]);await concurrentPress("Delete");await concurrent.waitForFunction(()=>document.body.innerText.includes("Holiday deleted successfully"));await concurrent.close();
	let held, releaseSignal;const heldReady=new Promise(resolve=>{releaseSignal=resolve;});
	await page.setRequestInterception(true);page.on("request",request=>{if(request.method()==="POST"&&ids.every(id=>request.postData()?.includes(id))){held=request;releaseSignal();return;}void request.continue();});
	await press("Delete (2)");await press("Delete 2 Holidays");await heldReady;
	await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(n=>n.textContent.includes("Delete (2)")&&n.disabled));
	await page.screenshot({path:"docs/design/rollout-1692/1694/after-holidays-bulk-pending.png"});await held.continue();
	await page.waitForFunction(()=>/1 holidays? deleted/.test(document.body.innerText));
	const remaining=await page.evaluate(async()=>(await(await fetch("/api/org-admin/holidays")).json()).holidays.length);assert.equal(remaining,initialCount-2);
	const result={pageSize:`Phone changed size from 20 to 10, read ${initialCount-10} remaining rows on page 2, returned to page 1`,pending:"Real held bulk submission disabled the toolbar action",partial:"One of two selected records was concurrently deleted; real bulk result truthfully reported one deletion",initialCount,remaining};
	await writeFile("docs/design/rollout-1692/1694/partial-assertions.json",JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result));
} finally {await browser.close();}
