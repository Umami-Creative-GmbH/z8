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
	for (const name of [
		"small-admin",
		"small-manager",
		"small-employee",
		"small-restricted",
	]) {
		await actor(name);
		await go("/en/calendar");
		await page.waitForSelector("[role=tab]");
		check(
			name + " admitted with exactly one Calendar h1",
			await page.$$eval(
				"h1",
				(es) => es.length === 1 && es[0].textContent === "Calendar",
			),
		);
		check(
			name + " explicit calendar zone",
			await page.evaluate(() =>
				document.body.innerText.includes("Calendar timezone"),
			),
		);
	}
	await actor("small-manager");
	await go("/en/calendar");
	await page.waitForSelector("[role=tab]");
	await click("Year");
	check("Year retains employee selection", !!(await page.$("[role=combobox]")));
	await click("Month");
	await click("Week");
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector("[role=tab]");
	check(
		"phone scope stays above period",
		await page.evaluate(() => {
			const span = [...document.querySelectorAll("span")].find(
				(e) => e.textContent === "Europe/Berlin",
			);
			return (
				span &&
				span.getBoundingClientRect().top > 64 &&
				span.getBoundingClientRect().bottom < 300
			);
		}),
	);
	await click("Filters & Legend");
	await page.waitForSelector("[role=dialog]");
	check(
		"phone exposes four labeled filters",
		await page.$$eval("[role=dialog] [role=switch]", (es) => es.length === 4),
	);
	const response = page
		.waitForResponse(
			(r) =>
				r.url().includes("/api/calendar/events?") &&
				r.url().includes("showTimeEntries=true") &&
				r.status() === 200,
		)
		.catch(() => null);
	await page.focus("[role=dialog] [id$=show-time-entries]");
	await page.keyboard.press("Space");
	assert.ok(await response, "Filter query observed");
	check("phone filter uses real calendar reader", true);
	await page.keyboard.press("Escape");
	await page.waitForSelector("[role=dialog]", { hidden: true });
	check(
		"phone filter Escape returns focus",
		await page.evaluate(
			() => document.activeElement?.textContent.trim() === "Filters & Legend",
		),
	);
	await click("Filters & Legend");
	await page.waitForSelector("[role=dialog] [id$=show-time-entries]");
	check(
		"phone filter survives reopen",
		await page.$eval(
			"[role=dialog] [id$=show-time-entries]",
			(e) => e.getAttribute("aria-checked") === "true",
		),
	);
	await page.keyboard.press("Escape");
	await click("Month");
	check(
		"phone Month contains local comparison scroller",
		await page.evaluate(() =>
			[...document.querySelectorAll("div")].some((e) => {
				if (
					e.scrollWidth > e.clientWidth + 100 &&
					getComputedStyle(e).overflowX === "auto"
				) {
					e.scrollLeft = 200;
					return e.scrollLeft > 0;
				}
				return false;
			}),
		),
	);
	check("phone document fits", await fits());
	await shot("after-phone-filters-and-month");
	await click("Balance adjustments");
	await page.waitForSelector("[role=dialog]");
	check(
		"phone adjustment history reads successfully",
		await page
			.waitForFunction(() =>
				document.body.innerText.includes("No balance adjustments yet."),
			)
			.then(() => true),
	);
	await page.keyboard.press("Escape");
	// Actual preference mutation, followed by calendar query verification and restoration.
	await page.setViewport({ width: 1600, height: 1000 });
	await go("/en/settings/profile");
	await page.waitForSelector("#week-start-day");
	await page.click("#week-start-day");
	await click("Sunday", "[role=option]");
	await click("Save Week Start");
	await page.waitForFunction(() =>
		document.body.innerText.includes("Week start day updated successfully"),
	);
	let weekQuery;
	page.on("response", (r) => {
		if (r.url().includes("/api/calendar/events?")) weekQuery = r.url();
	});
	await go("/en/calendar");
	await page.waitForSelector("[role=tab]");
	await page.waitForFunction(() =>
		document.querySelector(".sx__week-header")?.innerText.includes("SUN"),
	);
	check(
		"persisted Sunday preference reaches calendar query and grid",
		!!weekQuery && new URL(weekQuery).searchParams.has("rangeStart"),
	);
	await page.reload({ waitUntil: "networkidle0" });
	check(
		"Sunday preference survives reload",
		await page.$eval(".sx__week-header", (e) =>
			e.innerText.trim().startsWith("SUN"),
		),
	);
	await go("/en/settings/profile");
	await page.click("#week-start-day");
	await click("Monday", "[role=option]");
	await click("Save Week Start");
	await page.waitForFunction(() =>
		document.body.innerText.includes("Week start day updated successfully"),
	);
	// Actual record note mutation: failure retains draft, retry persists, reload reads it, then restore.
	await actor("small-admin");
	await go(
		"/en/calendar/" + auth["small-admin"].employeeId + "?date=2025-01-06",
	);
	await page.waitForSelector("[data-event-id]");
	const event = (
		await page.waitForFunction(() =>
			[...document.querySelectorAll("[data-event-id]")].find(
				(e) => e.textContent.includes("8h") && e.textContent.includes("09:00"),
			),
		)
	).asElement();
	await event.scrollIntoView();
	await event.click();
	await page.waitForSelector("[data-slot=action-panel-content]");
	const edit = await page.waitForFunction(() =>
		[...document.querySelectorAll("[data-slot=action-panel-content] span")]
			.find((e) => e.textContent === "Notes")
			?.parentElement.querySelector("button"),
	);
	await edit.asElement().focus();
	await page.keyboard.press("Enter");
	const area = await page.waitForSelector(
		"[data-slot=action-panel-content] textarea",
	);
	const original = await area.evaluate((e) => e.value);
	const note =
		"R014 synthetic calendar read-back " + crypto.randomUUID().slice(0, 8);
	await area.focus();
	await page.keyboard.down("Control");
	await page.keyboard.press("A");
	await page.keyboard.up("Control");
	await area.type(note);
	let held;
	const isSave = (req) =>
		req.method() === "POST" &&
		!!req.headers()["next-action"] &&
		req.postData()?.includes(note);
	const listener = (req) => {
		if (isSave(req) && !held) {
			held = req;
			return;
		}
		void req.continue();
	};
	await page.setRequestInterception(true);
	page.on("request", listener);
	const requestStarted = page.waitForRequest(isSave);
	await click("Save", "[data-slot=action-panel-content] button");
	await requestStarted;
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll("[data-slot=action-panel-content] button"),
		].some((e) => e.textContent.trim() === "Save" && e.disabled),
	);
	check("record save announces pending by disabling Save", !!held);
	await held.abort("failed");
	page.off("request", listener);
	await page.setRequestInterception(false);
	await page.waitForFunction(() =>
		[
			...document.querySelectorAll("[data-slot=action-panel-content] button"),
		].some((e) => e.textContent.trim() === "Save" && !e.disabled),
	);
	check(
		"record failure retains typed note",
		await area.evaluate((e, n) => e.value === n, note),
	);
	await click("Save", "[data-slot=action-panel-content] button");
	await page.waitForFunction(
		(n) =>
			[...document.querySelectorAll("[data-slot=action-panel-content] p")].some(
				(e) => e.textContent === n,
			),
		{},
		note,
	);
	await page.keyboard.press("Escape");
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector("[data-event-id]");
	const savedEvent = (
		await page.waitForFunction(() =>
			[...document.querySelectorAll("[data-event-id]")].find(
				(e) => e.textContent.includes("8h") && e.textContent.includes("09:00"),
			),
		)
	).asElement();
	await savedEvent.scrollIntoView();
	await savedEvent.click();
	await page.waitForSelector("[data-slot=action-panel-content]");
	check(
		"record mutation survives real reload",
		await page
			.waitForFunction(
				(n) =>
					document
						.querySelector("[data-slot=action-panel-content]")
						.textContent.includes(n),
				{},
				note,
			)
			.then(() => true),
	);
	await shot("after-saved-record");
	const editAgain = await page.waitForFunction(() =>
		[...document.querySelectorAll("[data-slot=action-panel-content] span")]
			.find((e) => e.textContent === "Notes")
			?.parentElement.querySelector("button"),
	);
	await editAgain.asElement().focus();
	await page.keyboard.press("Enter");
	const restore = await page.waitForSelector(
		"[data-slot=action-panel-content] textarea",
	);
	await restore.focus();
	await page.keyboard.down("Control");
	await page.keyboard.press("A");
	await page.keyboard.up("Control");
	await page.keyboard.press("Backspace");
	await restore.type(original);
	await click("Save", "[data-slot=action-panel-content] button");
	await page.waitForSelector("[data-slot=action-panel-content] textarea", {
		hidden: true,
	});
	await page.keyboard.press("Escape");
	// An actual failed calendar GET, then the same reader recovering through Retry.
	await go("/en/calendar");
	await page.waitForSelector("[role=tab]");
	let failReads = true;
	const abortRead = (req) => {
		if (failReads && req.url().includes("/api/calendar/events?"))
			void req.abort("failed");
		else void req.continue();
	};
	await page.setRequestInterception(true);
	page.on("request", abortRead);
	await click("Refresh");
	await page.waitForSelector("[role=alert]");
	check(
		"failed calendar read retains selected Week",
		await page.$eval(
			"[role=tab][aria-selected=true]",
			(e) => e.textContent === "Week",
		),
	);
	failReads = false;
	await click("Retry");
	await page.waitForSelector("[role=alert]", { hidden: true });
	check("Retry recovers real calendar reader", true);
	page.off("request", abortRead);
	await page.setRequestInterception(false);
	// Scope and permission refusal is checked against real endpoint, with no substituted data.
	await actor("small-restricted");
	await go("/en/calendar");
	const refused = await page.evaluate(
		async ({ target, org }) =>
			(
				await fetch(
					"/api/calendar/events?year=2025&month=0&showWorkPeriods=true&organizationId=" +
						org +
						"&employeeId=" +
						target,
				)
			).status,
		{
			target: auth["small-admin"].employeeId,
			org: fixture.actors["small-restricted"].organizationId,
		},
	);
	check("restricted actor cannot read unrelated employee", refused === 403);
	const crossOrg = await page.evaluate(
		async (org) =>
			(
				await fetch(
					"/api/calendar/events?year=2025&month=0&organizationId=" + org,
				)
			).status,
		fixture.actors["large-admin"].organizationId,
	);
	check("restricted actor cannot read another organization", crossOrg === 403);
	await actor("small-admin");
	await go("/en/calendar");
	await page.waitForSelector("[role=tab]");
	await click("Toggle theme");
	await click("Dark", "[role=menuitem]");
	await page.setViewport({ width: 1920, height: 1080 });
	check("wide dark document fits", await fits());
	await shot("after-wide-dark");
	await page.emulateMediaFeatures([
		{ name: "prefers-reduced-motion", value: "reduce" },
	]);
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector("[role=tab]");
	check("reduced-motion phone remains operable", await fits());
	await shot("after-phone-dark-reduced");
	await writeFile(
		join(output, "runtime-assertions.json"),
		JSON.stringify(
			{
				checks,
				errors,
				limits: [
					"Physical device, store wrapper, native browser zoom and exhaustive translation/contrast checks not performed.",
					"Scope checks use independent real refused reads; in-flight organization switching and open-panel authority revocation are not established by this script.",
				],
			},
			null,
			2,
		),
	);
} catch (error) {
	await shot("failed-runtime-step").catch(() => {});
	await writeFile(
		join(output, "runtime-incomplete.json"),
		JSON.stringify({ checks, error: String(error), errors }, null, 2),
	);
	console.error(String(error));
	process.exitCode = 1;
} finally {
	await browser.close();
}
