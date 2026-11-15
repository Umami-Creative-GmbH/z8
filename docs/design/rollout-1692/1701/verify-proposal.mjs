// pnpm node docs/design/rollout-1692/1701/verify-proposal.mjs <owned-private-fixture>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const dir = resolve(process.argv[2]),
	out = resolve("docs/design/rollout-1692/1701"),
	load = async (n) => JSON.parse(await readFile(join(dir, n), "utf8"));
const r = await load("runtime-private.json"),
	f = await load("fixture-private.json"),
	auth = await load("dev-auth-private.json");
assert.equal(f.kind, "disposable");
assert.equal(new URL(r.origin).hostname, "localhost");
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
try {
	const c = await browser.createBrowserContext();
	await c.setPermission(r.origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
	await c.setCookie(...auth["small-employee"].cookies);
	const page = await c.newPage();
	page.setDefaultTimeout(30000);
	await page.setViewport({ width: 1600, height: 1000 });
	await page.goto(r.origin + "/en/absences", { waitUntil: "networkidle0" });
	const click = async (name, selector = "button") => {
		const el = (
			await page.waitForFunction(
				(name, selector) =>
					[...document.querySelectorAll(selector)].find(
						(e) =>
							(e.textContent.trim() === name ||
								e.getAttribute("aria-label") === name) &&
							e.getBoundingClientRect().width &&
							!e.disabled,
					),
				{},
				name,
				selector,
			)
		).asElement();
		await el.focus();
		await page.keyboard.press("Enter");
	};
	await click("Table");
	await page.waitForSelector("input[name=search]");
	await page.type("input[name=search]", "R002 sick record");
	await click("Request cancellation", "tbody button");
	await page.waitForSelector("[role=dialog] textarea");
	await page.type(
		"[role=dialog] textarea",
		"R002 synthetic cancellation proposal for review",
	);
	await click("Submit request", "[role=dialog] button");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	await page.waitForFunction(() =>
		document.querySelector("details")?.innerText.includes("Pending approval"),
	);
	assert.ok(
		await page.$eval(
			"tbody",
			(e) =>
				e.innerText.includes("R002 sick record") &&
				e.innerText.includes("Approved"),
		),
	);
	await page.screenshot({
		path: join(out, "proposal-pending-original-effective.png"),
	});
	await click("Withdraw request", "details button");
	await page.waitForFunction(() =>
		document.querySelector("details")?.innerText.includes("Withdrawn"),
	);
	assert.ok(
		await page.$eval(
			"tbody",
			(e) =>
				e.innerText.includes("R002 sick record") &&
				e.innerText.includes("Approved"),
		),
	);
	await writeFile(
		join(out, "proposal-assertions.json"),
		JSON.stringify(
			{
				scope:
					"employee own approved October 2026 sick absence; actual cancellation proposal and withdrawal, no approver decision",
				results: [
					{
						name: "pending cancellation proposal keeps original approved absence effective",
						passed: true,
					},
					{
						name: "withdrawal retains proposal history and original absence",
						passed: true,
					},
				],
			},
			null,
			2,
		),
	);
	console.log(
		"Passed: real approved-absence cancellation proposal and withdrawal preserve original record.",
	);
} finally {
	await browser.close();
}
