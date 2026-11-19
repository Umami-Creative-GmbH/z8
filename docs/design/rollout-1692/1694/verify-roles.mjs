// pnpm node docs/design/rollout-1692/1694/verify-roles.mjs <private-fixture-directory>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const dir = resolve(process.argv[2]);
const json = async f => JSON.parse(await readFile(join(dir, f), "utf8"));
const runtime = await json("runtime-private.json"), fixture = await json("fixture-private.json"), auth = await json("dev-auth-private.json");
assert.equal(fixture.kind, "disposable"); assert.equal(new URL(runtime.origin).hostname, "localhost");
const browser = await puppeteer.launch({executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true});
const observations = [];
try {
	for (const actor of ["small-admin", "small-manager", "small-employee", "small-restricted"]) {
		const context = await browser.createBrowserContext();
		await context.setPermission(runtime.origin, {permission: {name: "notifications"}, state: "denied"});
		await context.setCookie(...auth[actor].cookies);
		const page = await context.newPage(); await page.setViewport({width: 1600, height: 1000});
		await page.goto(runtime.origin + "/en/reports/projects", {waitUntil: "networkidle0"});
		const admitted = await page.$$eval("button", ns => ns.some(n => n.textContent.includes("Generate Report")));
		assert.equal(admitted, ["small-admin", "small-manager"].includes(actor));
		assert.deepEqual(await page.$$eval("h1", ns => ns.map(n => n.textContent)), ["Project Reports"]);
		observations.push({actor, projectReportAdmitted: admitted, headingCount: 1});
		if (actor === "small-manager") {
			await page.goto(runtime.origin + "/en/settings/vacation?tab=holidays", {waitUntil: "networkidle0"});
			const custom = await page.evaluateHandle(() => [...document.querySelectorAll("[role=tab]")].find(n => n.textContent === "Custom Holidays"));
			await custom.asElement().focus(); await page.keyboard.press("Enter");
			await page.waitForSelector("table");
			assert.equal(await page.$("tbody button[aria-label^='Delete:']"), null);
			observations.push({actor, scopedHolidayReadOnly: true, rowMutationControls: 0});
		}
		await context.close();
	}
	await writeFile("docs/design/rollout-1692/1694/role-assertions.json", JSON.stringify(observations,null,2)+"\n"); console.log(JSON.stringify(observations));
} finally {await browser.close();}
