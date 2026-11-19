// Real fixture acceptance after verify-records.mjs. Bulk deletion changes only synthetic holidays.
// pnpm node docs/design/rollout-1692/1694/exercise-records.mjs <private-fixture-directory>
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const directory = resolve(process.argv[2]);
const json = async name => JSON.parse(await readFile(join(directory, name), "utf8"));
const runtime = await json("runtime-private.json"), fixture = await json("fixture-private.json"), auth = await json("dev-auth-private.json");
assert.equal(fixture.kind, "disposable"); assert.equal(new URL(runtime.origin).hostname, "localhost");
const artifacts = resolve("docs/design/rollout-1692/1694"), results = [];
const browser = await puppeteer.launch({ executablePath: process.env.Z8_TEST_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
	const context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
	await context.setCookie(...auth["small-admin"].cookies);
	const page = await context.newPage(); page.setDefaultTimeout(30000);
	const client = await page.createCDPSession();
	const viewport = async (width, height = 1000) => {
		await page.setViewport({ width, height });
		await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
	};
	const go = path => page.goto(runtime.origin + path, { waitUntil: "networkidle0", timeout: 120000 });
	const waitText = text => page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
	const press = async (name, selector = "button") => {
		const handle = await page.evaluateHandle((name, selector) => [...document.querySelectorAll(selector)].find(n => n.getClientRects().length && (n.textContent.trim() === name || n.getAttribute("aria-label") === name)), name, selector);
		assert.ok(handle.asElement(), "Missing control: " + name); await handle.asElement().focus(); await page.keyboard.press("Enter"); await handle.dispose();
	};
	const capture = name => page.screenshot({ path: join(artifacts, name + ".png") });
	const layout = () => page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, fontSize: getComputedStyle(document.documentElement).fontSize, dark: document.documentElement.classList.contains("dark") }));
	await viewport(1600); await go("/en/reports/projects");
	// Generate stays explicit even after changing the real status filter.
	await press("All Statuses"); await press("Active Only", "[role=option]");
	assert.equal(await page.$("table"), null);
	await press("Generate Report"); await waitText("F2 Project 01");
	const search = "input[name=search]";
	await page.locator(search).fill("F2 Project 12"); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
	assert.ok(await page.$eval("tbody", n => n.textContent.includes("F2 Project 12")));
	await press("View project details"); await page.waitForFunction(() => [...document.querySelectorAll("[role=tab][aria-selected=true]")].some(n => n.textContent === "F2 Project 12"));
	results.push({ localSearchAndDrilldown: "Immediate search opens the matching real project; Generate remained explicit" });
	// The existing export belongs to this detailed report, not the portfolio's visible table rows.
	const downloadDir = join(directory, "downloads"); await mkdir(downloadDir, { recursive: true });
	await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir, browserContextId: context.id, eventsEnabled: true });
	const csvDownload = new Promise(resolve => client.on("Browser.downloadProgress", event => { if (event.state === "completed") resolve(); }));
	await press("Export CSV"); await csvDownload;
	const csvName = (await readdir(downloadDir)).find(name => name.endsWith(".csv")); assert.ok(csvName);
	const csv = await readFile(join(downloadDir, csvName), "utf8");
	assert.ok(csv.includes("F2 Project 12") && !csv.includes("F2 Project 01"));
	results.push({ csvExport: "Downloaded real domain report contains only the selected Project 12 scope; portfolio has no generic CSV export" });
	await press("Portfolio Overview", "[role=tab]"); await page.waitForSelector("input[name=search]");
	await page.locator(search).fill("");
	await viewport(390, 844); await page.locator("table").scroll();
	const comparison = await page.$eval("[data-slot=table-container]", n => ({ width: n.clientWidth, scrollWidth: n.scrollWidth }));
	assert.ok(comparison.scrollWidth > comparison.width);
	assert.equal((await layout()).documentWidth, 390);
	await capture("after-portfolio-phone-comparison");
	results.push({ comparisonLocalScroll: comparison });
	await viewport(2400, 1200); await press("Toggle theme"); await press("Dark", "[role=menuitem]");
	await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
	await capture("after-portfolio-wide-dark");
	await go("/en/settings/vacation?tab=holidays"); await press("Custom Holidays"); await waitText("F2 Holiday 01");
	await press("Name"); await press("Descending", "[role=menuitem]");
	await page.waitForFunction(() => document.querySelector("tbody tr")?.textContent.includes("F2 Holiday 23"));
	assert.equal(await page.$eval("th[aria-sort]", n => n.getAttribute("aria-sort")), "descending");
	await press("Go to next page"); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
	const all = await page.$("thead [role=checkbox]"); await all.focus(); await page.keyboard.press("Space"); await waitText("Delete (3)");
	await press("Go to previous page"); await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 20);
	const first = await page.$("tbody [role=checkbox]"); await first.focus(); await page.keyboard.press("Space"); await waitText("Delete (4)");
	results.push({ serverPagingSortSelection: "Descending sort; page select-all selected three on page 2; adding page-1 row retained four stable IDs" });
	await page.locator(search).fill("unmatched-record"); await waitText("No results."); await waitText("Page 1 of 1");
	await press("Clear filters"); await waitText("F2 Holiday 23"); await waitText("Page 1 of 2");
	// One real control survives responsive changes, including all labeled details.
	await page.evaluate(() => { window.__f2Edit = document.querySelector("tbody button[aria-label^='Edit:']"); });
	await viewport(390, 844);
	assert.ok(await page.evaluate(() => window.__f2Edit === document.querySelector("tbody button[aria-label^='Edit:']")));
	const labels = await page.$$eval("tbody tr:first-child td", ns => ns.map(n => n.dataset.label));
	for (const label of ["Name", "Category", "Date", "Recurrence", "Actions"]) assert.ok(labels.includes(label), label);
	assert.equal((await layout()).documentWidth, 390);
	await page.locator("table").scroll(); await capture("after-holidays-phone-dark");
	results.push({ phoneSingleMountedControls: true, detailLabels: labels.filter(Boolean), phoneLayout: await layout() });
	await viewport(1600); await page.evaluate(() => window.scrollTo(0, 0));
	await press("Account: Person 0"); await press("Font size", "[role=menuitem]"); await press("Large", "[role=menuitemradio]");
	await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
	await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === "18px");
	await viewport(390, 844); await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
	await capture("after-holidays-phone-large-dark");
	assert.equal((await layout()).documentWidth, 390); results.push({ savedLargeTextDark: await layout() });
	// Retain selection; cancel does not mutate, then confirm the actual domain bulk action.
	await press("Delete (4)"); await waitText("Delete Multiple Holidays");
	await press("Cancel"); await waitText("Delete (4)");
	await press("Delete (4)"); await press("Delete 4 Holidays");
	await waitText("4 holidays deleted");
	const remaining = await page.evaluate(async () => (await (await fetch("/api/org-admin/holidays")).json()).holidays.length);
	assert.equal(remaining, 19); results.push({ bulkDelete: "Cancel retained selection; real confirmed action removed precisely four synthetic records, 19 remain" });
	await capture("after-holidays-bulk-outcome");
	await writeFile(join(artifacts, "task-assertions.json"), JSON.stringify(results, null, 2) + "\n");
	console.log(JSON.stringify(results));
} finally { await browser.close(); }
