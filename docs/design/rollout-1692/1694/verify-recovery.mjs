// Real request delay/transport refusal at the holiday server-action boundary; no fake results.
// pnpm node docs/design/rollout-1692/1694/verify-recovery.mjs <private-fixture-directory>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const dir = resolve(process.argv[2]);
const json = async name => JSON.parse(await readFile(join(dir, name), "utf8"));
const runtime = await json("runtime-private.json"), fixture = await json("fixture-private.json"), auth = await json("dev-auth-private.json");
assert.equal(fixture.kind, "disposable"); assert.equal(new URL(runtime.origin).hostname, "localhost");
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
	const context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
	await context.setCookie(...auth["small-admin"].cookies);
	const page = await context.newPage(); await page.setViewport({ width: 1600, height: 1000 });
	let readAction, held, fail = false, delay = false, signalHeld;
	const heldReady = new Promise(resolve => { signalHeld = resolve; });
	await page.setRequestInterception(true);
	page.on("request", request => {
		if (request.method() === "POST" && request.postData()?.includes('"limit":20')) readAction = request.headers()["next-action"];
		if (readAction && request.headers()["next-action"] === readAction) {
			if (delay) { held = request; signalHeld(); return; }
			if (fail) { void request.abort("failed"); return; }
		}
		void request.continue();
	});
	const press = async name => {
		const node = await page.evaluateHandle(name => [...document.querySelectorAll("button")].find(n => n.getClientRects().length && (n.textContent.trim() === name || n.getAttribute("aria-label") === name)), name);
		assert.ok(node.asElement(), name); await node.asElement().focus(); await page.keyboard.press("Enter");
	};
	await page.goto(runtime.origin + "/en/settings/vacation?tab=holidays", { waitUntil: "networkidle0" }); await press("Custom Holidays");
	await page.waitForSelector("tbody button[aria-label^='Edit:']"); assert.ok(readAction);
	await page.waitForFunction(() => document.querySelector("table")?.getAttribute("aria-busy") !== "true");
	await page.evaluate(() => { window.__f2Search = document.querySelector("input[name=search]"); });
	delay = true; await press("Refresh data");
	await heldReady;
	await page.waitForFunction(() => document.querySelector("table")?.getAttribute("aria-busy") === "true");
	assert.ok(await page.$("tbody button[aria-label^='Edit:']"));
	await page.screenshot({ path: "docs/design/rollout-1692/1694/after-holidays-stale-pending.png" });
	assert.ok(held); delay = false; fail = true; await held.abort("failed");
	await page.waitForFunction(() => document.body.innerText.includes("Failed to load holidays"), { timeout: 30000 });
	assert.ok(await page.$("tbody button[aria-label^='Edit:']"));
	assert.ok(await page.evaluate(() => window.__f2Search === document.querySelector("input[name=search]")));
	await page.screenshot({ path: "docs/design/rollout-1692/1694/after-holidays-failed-refresh.png" });
	fail = false; await press("Retry");
	await page.waitForFunction(() => !document.body.innerText.includes("Failed to load holidays"));
	const result = { pending: "Actual delayed server read retains rows with aria-busy=true", failure: "Transport failure retains records and original search DOM; visible Retry recovers through actual read", rowsAfterRecovery: await page.$$eval("tbody tr", ns => ns.length) };
	await writeFile("docs/design/rollout-1692/1694/recovery-assertions.json", JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result));
} finally { await browser.close(); }
