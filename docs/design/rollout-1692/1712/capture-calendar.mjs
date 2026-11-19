import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const repo = process.cwd();
const require = createRequire(join(repo, "package.json"));
const puppeteer = require("puppeteer-core");
const fixtureDir = resolve(process.argv[3] || ".worktrees/1712-runtime");
const runtime = JSON.parse(
	await readFile(join(fixtureDir, "runtime-private.json"), "utf8"),
);
const auth = JSON.parse(
	await readFile(join(fixtureDir, "dev-auth-private.json"), "utf8"),
);
const fixture = JSON.parse(
	await readFile(join(fixtureDir, "fixture-private.json"), "utf8"),
);
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const stage = process.argv[2] || "before";
const output = resolve("docs/design/rollout-1692/1712");
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
const context = await browser.createBrowserContext();
await context.setPermission(runtime.origin, {
	permission: { name: "notifications" },
	state: "denied",
});
await context.setCookie(...auth["small-admin"].cookies);
const page = await context.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const go = async (path) => {
	await page.goto(runtime.origin + path, {
		waitUntil: "networkidle0",
		timeout: 120000,
	});
	await page.waitForSelector("[role=tab]");
};
const click = async (text) => {
	const element = await page.waitForFunction(
		(text) =>
			[...document.querySelectorAll("button")].find(
				(e) =>
					e.textContent.trim() === text && e.getBoundingClientRect().width > 0,
			),
		{},
		text,
	);
	await element.asElement().click();
};
const metrics = async () =>
	page.evaluate(() => ({
		width: innerWidth,
		documentWidth: document.documentElement.scrollWidth,
		headings: [...document.querySelectorAll("h1")].map((e) => e.textContent),
		visibleControls: [...document.querySelectorAll("button,[role=combobox]")]
			.filter((e) => e.getBoundingClientRect().width > 0)
			.map((e) => e.getAttribute("aria-label") || e.textContent.trim()),
		localScrollers: [...document.querySelectorAll("main *")]
			.filter(
				(e) =>
					e.scrollWidth > e.clientWidth + 1 &&
					/auto|scroll/.test(getComputedStyle(e).overflowX),
			)
			.map((e) => ({ width: e.clientWidth, scrollWidth: e.scrollWidth })),
	}));
const result = {
	stage,
	scope:
		"small-admin / small synthetic organization; unchanged fixture for before/after",
	checks: [],
};
try {
	await page.setViewport({ width: 1600, height: 1000 });
	await go("/en/calendar");
	await page.screenshot({ path: join(output, stage + "-desktop-light.png") });
	result.checks.push({ name: "desktop", ...(await metrics()) });
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector("[role=tab]");
	await page.screenshot({ path: join(output, stage + "-phone-light.png") });
	result.checks.push({ name: "phone", ...(await metrics()) });
	await click("Month");
	await page.screenshot({ path: join(output, stage + "-phone-month.png") });
	result.checks.push({ name: "month-phone", ...(await metrics()) });
	await page.setViewport({ width: 1600, height: 1000 });
	await go(
		"/en/calendar/" + auth["small-admin"].employeeId + "?date=2025-01-06",
	);
	await page.waitForSelector("[data-event-id]");
	await page.screenshot({ path: join(output, stage + "-records.png") });
	result.checks.push({
		name: "seeded-records",
		events: await page.$$eval("[data-event-id]", (es) => es.length),
		...(await metrics()),
	});
	result.errors = errors;
	await writeFile(
		join(output, stage + "-layout.json"),
		JSON.stringify(result, null, 2),
	);
	console.log("Captured " + stage + " runtime evidence.");
} finally {
	await browser.close();
}
