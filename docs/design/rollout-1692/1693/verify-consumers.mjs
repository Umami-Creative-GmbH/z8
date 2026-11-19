// Usage: pnpm node docs/design/rollout-1692/1693/verify-consumers.mjs <private-fixture-directory>
// Authenticate small-manager with the inspected dev helper first. Never publish its private manifests.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";

const directory = resolve(process.argv[2]);
const runtime = JSON.parse(await readFile(join(directory, "runtime-private.json"), "utf8"));
const fixture = JSON.parse(await readFile(join(directory, "fixture-private.json"), "utf8"));
const auth = JSON.parse(await readFile(join(directory, "dev-auth-private.json"), "utf8"));
assert.equal(fixture.kind, "disposable");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(runtime.origin).hostname));
const browser = await puppeteer.launch({
	executablePath: process.env.Z8_TEST_CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
try {
	const context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, { permission: { name: "notifications" }, state: "denied" });
	await context.setCookie(...auth["small-manager"].cookies);
	const page = await context.newPage();
	await page.setViewport({ width: 1600, height: 1000 });
	await page.goto(runtime.origin + "/en/reports/projects", { waitUntil: "networkidle0" });
	await page.waitForSelector("button[aria-label='Period']");
	const headings = await page.$$eval("h1", nodes => nodes.map(node => node.textContent.trim()));
	assert.deepEqual(headings, ["Project Reports"], "The unconverted consumer keeps exactly one shell h1");
	console.log("Project report: one shell heading and real period control.");
	const trigger = await page.$("button[data-sidebar='trigger']");
	await trigger.click();
	await page.waitForFunction(() => localStorage.getItem("sidebar_state") === "false");
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForFunction(() => document.querySelector("[data-slot='sidebar'][data-state]")?.getAttribute("data-state") === "collapsed");
	assert.equal(await page.$eval("button[data-sidebar='trigger']", node => node.getAttribute("aria-expanded")), "false");
	console.log("Streamed reload: saved collapsed rail and accessible state agree.");
} finally {
	await browser.close();
}
