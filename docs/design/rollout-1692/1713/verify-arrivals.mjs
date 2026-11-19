// Run from the repository root after preparing/authenticating an owned disposable fixture.
// pnpm node docs/design/rollout-1692/1713/verify-calendar.mjs <fixture-directory>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
const directory = resolve(process.argv[2]);
const runtime = JSON.parse(
	await readFile(join(directory, "runtime-private.json"), "utf8"),
);
const auth = JSON.parse(
	await readFile(join(directory, "dev-auth-private.json"), "utf8"),
);
const fixture = JSON.parse(
	await readFile(join(directory, "fixture-private.json"), "utf8"),
);
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const output = resolve("docs/design/rollout-1692/1713");
const checks = [];
const errors = [];
const check = (name, value) => {
	assert.ok(value, name);
	checks.push({ name, passed: true });
	console.log("Passed: " + name);
};
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
let page, context;
const actor = async (name) => {
	if (context) await context.close();
	context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
	await context.setCookie(...auth[name].cookies);
	page = await context.newPage();
	page.setDefaultTimeout(30000);
	page.on("pageerror", (e) => errors.push(e.message));
	await page.setViewport({ width: 1600, height: 1000 });
};
const go = async (path) => {
	await page.goto(runtime.origin + path, {
		waitUntil: "networkidle0",
		timeout: 120000,
	});
};
const find = async (selector, name) =>
	(
		await page.waitForFunction(
			(selector, name) =>
				[...document.querySelectorAll(selector)].find(
					(e) =>
						(e.textContent.trim() === name ||
							e.getAttribute("aria-label") === name) &&
						e.getBoundingClientRect().width > 0,
				),
			{},
			selector,
			name,
		)
	).asElement();
const click = async (name, selector = "button") => {
	const el = await find(selector, name);
	await el.focus();
	await page.keyboard.press("Enter");
};
const shot = async (name) =>
	page.screenshot({ path: join(output, name + ".png") });
const fits = async () =>
	page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
	for (const variant of ["denied", "missing"]) {
		await actor(variant === "denied" ? "small-restricted" : "small-admin");
		const target =
			variant === "denied"
				? auth["small-admin"].employeeId
				: "00000000-0000-4000-8000-000000001713";
		await go("/en/calendar/" + target + "?date=2025-01-06");
		await page.waitForFunction(() =>
			document.body.innerText
				.toLowerCase()
				.includes("employee profile required"),
		);
		check(
			variant + " arrival retains exactly one Calendar heading",
			await page.$$eval(
				"h1",
				(es) => es.length === 1 && es[0].textContent === "Calendar",
			),
		);
		check(
			variant + " arrival exposes no calendar records or mutation form",
			await page.evaluate(
				() =>
					!document.querySelector("[data-event-id]") &&
					!document.querySelector(".sx__calendar") &&
					!document.querySelector("[role=dialog]"),
			),
		);
		await shot("after-" + variant + "-arrival");
	}
	await writeFile(
		join(output, "arrival-assertions.json"),
		JSON.stringify({ checks, errors }, null, 2),
	);
} finally {
	await browser.close();
}
