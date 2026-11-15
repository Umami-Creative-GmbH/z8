// pnpm node docs/design/rollout-1692/1701/verify-absences.mjs <owned-private-fixture>
// Requires the standard disposable fixture, the R002 supplemental seed and real dev auth.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
const directory = resolve(process.argv[2]),
	output = resolve("docs/design/rollout-1692/1701");
const load = async (name) =>
	JSON.parse(await readFile(join(directory, name), "utf8"));
const runtime = await load("runtime-private.json"),
	fixture = await load("fixture-private.json"),
	auth = await load("dev-auth-private.json");
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
const results = [];
const check = (name, value) => {
	assert.ok(value, name);
	results.push({ name, passed: true });
	console.log("Passed: " + name);
};
try {
	const context = await browser.createBrowserContext();
	await context.setPermission(runtime.origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
	await context.setCookie(...auth["small-employee"].cookies);
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	const goto = async () =>
		page.goto(runtime.origin + "/en/absences", {
			waitUntil: "networkidle0",
			timeout: 90000,
		});
	const find = async (selector, name) =>
		(
			await page.waitForFunction(
				(selector, name) =>
					[...document.querySelectorAll(selector)].find(
						(e) =>
							(e.textContent.trim() === name ||
								e.getAttribute("aria-label") === name) &&
							e.getBoundingClientRect().width,
					),
				{},
				selector,
				name,
			)
		).asElement();
	const click = async (name, scope = "body") => {
		const e = await find(scope + " button", name);
		await e.focus();
		await page.keyboard.press("Enter");
	};
	const text = () => page.$eval("main", (e) => e.innerText);
	const shot = async (name) =>
		page.screenshot({ path: join(output, name + ".png") });
	const fits = () =>
		page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
	await page.setViewport({ width: 1600, height: 1000 });
	await goto();
	check(
		"one main Absences heading",
		await page.$$eval(
			"h1",
			(e) => e.length === 1 && e[0].textContent === "Absences",
		),
	);
	check(
		"organization calendar year and timezone explicit",
		(await text()).includes("2026 · Europe/Berlin"),
	);
	await click("Table");
	await page.waitForSelector("tbody tr");
	await click("Go to next page");
	check(
		"full fetched history reachable on second page",
		(await text()).includes("R002 history 1"),
	);
	await click("Go to previous page");
	const search = await page.$("input[name=search]");
	await search.type("R002 history 7");
	check(
		"immediate search keeps matching real record",
		await page.$eval("tbody", (e) => e.innerText.includes("R002 history 7")),
	);
	await search.type(" no match");
	check(
		"no match is distinct from no requests",
		(await text()).includes("No absences match your search."),
	);
	await search.click({ clickCount: 3 });
	await page.keyboard.press("Backspace");
	await page.setViewport({ width: 390, height: 844 });
	check("phone record layout has no page overflow", await fits());
	await shot("after-history-phone");
	await click("Calendar");
	check(
		"all twelve month headings remain accessible",
		await page.$$eval("h3", (es) => es.length === 12),
	);
	await shot("after-calendar-phone");
	await click("Next year");
	await page.waitForFunction(() =>
		[...document.querySelectorAll("h2")].some((e) => e.textContent === "2027"),
	);
	await click("Table");
	check(
		"table identifies selected year",
		(await text()).includes("Your Absence Requests · 2027"),
	);
	check(
		"empty year says no requests",
		(await text()).includes("No absence requests found."),
	);
	await click("Calendar");
	await click("Today");
	await page.waitForFunction(() =>
		[...document.querySelectorAll("h2")].some((e) => e.textContent === "2026"),
	);
	await page.setViewport({ width: 2200, height: 1100 });
	// Save actual existing preferences through their storage representation, then reload.
	await page.evaluate(() => {
		localStorage.setItem("theme", "dark");
		localStorage.setItem("z8-font-size", "large");
	});
	await goto();
	check(
		"saved large text is applied at 18px",
		await page.evaluate(
			() => getComputedStyle(document.documentElement).fontSize === "18px",
		),
	);
	check(
		"saved dark theme is applied",
		await page.evaluate(() =>
			document.documentElement.classList.contains("dark"),
		),
	);
	check("wide dark layout has no page overflow", await fits());
	await shot("after-wide-dark");
	await page.setViewport({ width: 390, height: 844 });
	await page.emulateMediaFeatures([
		{ name: "prefers-reduced-motion", value: "reduce" },
	]);
	await goto();
	check("saved large text phone fits", await fits());
	await shot("after-large-dark-phone");
	await click("Table");
	check("large text phone history fits without page overflow", await fits());
	await page.$eval("table", (e) => e.scrollIntoView());
	await shot("after-large-history-phone");
	await page.setViewport({ width: 1600, height: 1000 });
	await click("Add absence");
	await page.waitForSelector("[role=dialog]");
	await shot("request-panel");
	await writeFile(
		join(directory, "panel-private.json"),
		JSON.stringify(
			await page.$eval("[role=dialog]", (e) => ({
				text: e.innerText,
				controls: [...e.querySelectorAll("input,textarea,button")].map((e) => ({
					tag: e.tagName,
					type: e.type,
					label: e.getAttribute("aria-label"),
					text: e.textContent,
					id: e.id,
				})),
			})),
			null,
			2,
		),
	);
	await click("Cancel", "[role=dialog]");
	await page.waitForFunction(() => !document.querySelector("[role=dialog]"));
	check("request cancel returns to records", await page.$("[role=tab]"));
	await page.keyboard.down("Control");
	await page.keyboard.press("b");
	await page.keyboard.up("Control");
	check(
		"sidebar collapse persists through its existing localStorage owner",
		await page.evaluate(() => localStorage.getItem("sidebar_state") === "false"),
	);
	check("collapsed sidebar retains page controls", await page.$("[role=tab]"));
	await shot("after-collapsed-desktop");
	check("no uncaught browser exceptions", errors.length === 0);
	await writeFile(
		join(output, "runtime-assertions.json"),
		JSON.stringify(
			{
				scope: "small-employee own organization, real 2026 records; 2027 empty",
				results,
				errors,
			},
			null,
			2,
		),
	);
} finally {
	await browser.close();
}
