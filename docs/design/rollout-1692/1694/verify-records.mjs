// pnpm node docs/design/rollout-1692/1694/verify-records.mjs <private-fixture-directory> [before|after]
// Uses real application reads/actions. Before temporarily installs exact base consumer sources,
// then restores every byte in finally. Never run while editing the listed files.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";

const directory = resolve(process.argv[2]);
const mode = process.argv[3] ?? "after";
assert.ok(["before", "after"].includes(mode));
const json = async file => JSON.parse(await readFile(join(directory, file), "utf8"));
const runtime = await json("runtime-private.json");
const fixture = await json("fixture-private.json");
const auth = await json("dev-auth-private.json");
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const artifacts = resolve("docs/design/rollout-1692/1694");
await mkdir(artifacts, { recursive: true });
const sourceFiles = [
	"src/components/data-table-server/data-table.tsx",
	"src/components/data-table-server/data-table-toolbar.tsx",
	"src/components/data-table-server/data-table-pagination.tsx",
	"src/components/settings/holiday/holiday-list.tsx",
	"src/components/reports/projects/project-portfolio-table.tsx",
	"src/app/[locale]/(app)/reports/projects/page.tsx",
	"src/lib/navigation/route-metadata.ts",
].map(path => "apps/webapp/" + path);
const saved = new Map();
const observations = { mode, scope: "small-admin, same disposable organization; 23 holidays, 12 projects; current-month report", checks: [] };
const browser = await puppeteer.launch({ executablePath: process.env.Z8_TEST_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
	if (mode === "before") for (const file of sourceFiles) {
		saved.set(file, await readFile(file));
		await writeFile(file, execFileSync("git", ["show", "a8ec7c290:" + file], { windowsHide: true }));
	}
	const context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
	await context.setCookie(...auth["small-admin"].cookies);
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = []; page.on("pageerror", error => errors.push(error.message));
	await page.setViewport({ width: 1600, height: 1000 });
	const go = async path => page.goto(runtime.origin + path, { waitUntil: "networkidle0", timeout: 120000 });
	const click = async (text, selector = "button") => {
		const handle = await page.evaluateHandle((text, selector) => [...document.querySelectorAll(selector)].find(n => n.getClientRects().length && (n.textContent.trim() === text || n.getAttribute("aria-label") === text)), text, selector);
		assert.ok(handle.asElement(), "Missing visible control: " + text);
		await handle.asElement().click(); await handle.dispose();
	};
	const waitText = text => page.waitForFunction(text => document.body.innerText.includes(text), {}, text);
	const capture = async name => page.screenshot({ path: join(artifacts, `${mode}-${name}.png`), fullPage: false });
	await go("/en/settings/vacation?tab=holidays"); await click("Custom Holidays");
	await waitText("F2 Holiday 01");
	await capture("holidays-desktop-light");
	observations.checks.push({ holidayRows: await page.$$eval("tbody tr", nodes => nodes.length) });
	await page.setViewport({ width: 390, height: 844 }); await capture("holidays-phone-light");
	observations.checks.push({ holidayPhone: await page.evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth, layout: document.querySelector("table")?.dataset.mobileLayout, rowControls: document.querySelectorAll("tbody button[aria-label^='Edit:']").length })) });
	await page.setViewport({ width: 1600, height: 1000 });
	await go("/en/reports/projects"); await click("Generate Report"); await waitText("F2 Project 01");
	await capture("portfolio-desktop-light");
	observations.checks.push({ portfolio: await page.evaluate(() => ({ headings: [...document.querySelectorAll("h1")].map(n => n.textContent), rows: document.querySelectorAll("tbody tr").length, hasNextPage: [...document.querySelectorAll("button")].some(n => n.textContent.includes("Go to next page")) })) });
	await page.setViewport({ width: 390, height: 844 });
	await page.locator("table").scroll();
	await capture("portfolio-phone-light");
	if (mode === "after") {
		const firstPage = await page.$$eval("tbody tr", ns => ns.map(n => n.textContent));
		const next = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find(n => n.textContent.includes("Go to next page")));
		await next.asElement().focus(); await page.keyboard.press("Enter");
		await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);
		assert.equal(await page.$$eval("tbody tr", ns => ns.length), 2);
		const secondPage = await page.$$eval("tbody tr", ns => ns.map(n => n.textContent));
		assert.equal(new Set([...firstPage, ...secondPage]).size, 12);
		observations.checks.push({ localPagination: "12 distinct real projects reachable across two pages" });
	}
	observations.errors = errors;
	await writeFile(join(artifacts, `${mode}-assertions.json`), JSON.stringify(observations, null, 2) + "\n");
	console.log(JSON.stringify(observations));
} finally {
	await browser.close();
	for (const [file, contents] of saved) await writeFile(file, contents);
}
