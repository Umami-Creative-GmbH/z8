// pnpm node docs/design/rollout-1692/1745/verify-route.mjs <owned-fixture> <owned-cdp-file>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const [dirInput, cdpInput] = process.argv.slice(2),
	dir = resolve(dirInput),
	out = resolve("docs/design/rollout-1692/1745");
const runtime = JSON.parse(await readFile(join(dir, "runtime-private.json"))),
	fixture = JSON.parse(await readFile(join(dir, "fixture-private.json"))),
	auth = JSON.parse(await readFile(join(dir, "dev-auth-private.json")));
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
const browser = await puppeteer.connect({
	browserWSEndpoint: (await readFile(cdpInput, "utf8")).trim(),
});
const results = { roles: [], checks: [], pageErrors: [] };
let page;
const check = (name, value) => {
	assert.ok(value, name);
	results.checks.push({ name, passed: true });
	console.log("Passed: " + name);
};
const find = async (selector, text) =>
	(
		await page.waitForFunction(
			(s, t) =>
				[...document.querySelectorAll(s)].find(
					(e) =>
						e.getBoundingClientRect().width &&
						(e.textContent.trim() === t || e.getAttribute("aria-label") === t),
				),
			{},
			selector,
			text,
		)
	).asElement();
const click = async (text, scope = "body") => {
	const b = await find(scope + " button", text);
	await b.focus();
	await page.keyboard.press("Enter");
};
const fill = async (name, value) => {
	const el = (
		await page.waitForFunction(
			(name) =>
				[
					...document.querySelectorAll(
						'[role="dialog"] input,[role="dialog"] textarea',
					),
				].find((e) => e.name === name && e.getBoundingClientRect().width),
			{},
			name,
		)
	).asElement();
	await el.click({ clickCount: 3 });
	await page.keyboard.down("Control");
	await page.keyboard.press("A");
	await page.keyboard.up("Control");
	await page.keyboard.type(value);
	await page.keyboard.press("Tab");
};
const text = () => page.evaluate(() => document.body.innerText);
const values = () =>
	page.evaluate(() =>
		Object.fromEntries(
			[
				...document.querySelectorAll(
					'[role="dialog"] input,[role="dialog"] textarea',
				),
			]
				.filter((e) => e.name && e.getBoundingClientRect().width)
				.map((e) => [e.name, e.value]),
		),
	);
try {
	for (const label of [
		"small-admin",
		"small-employee",
		"small-restricted",
		"small-manager",
	]) {
		const context = await browser.createBrowserContext();
		await context.setPermission(runtime.origin, {
			permission: { name: "notifications" },
			state: "denied",
		});
		await context.setCookie(...auth[label].cookies);
		page = await context.newPage();
		page.setDefaultTimeout(15000);
		page.on("pageerror", (e) =>
			results.pageErrors.push({ label, message: e.message }),
		);
		await page.setViewport({ width: 1600, height: 1000 });
		await page.emulateTimezone("Europe/Berlin");
		await page.goto(runtime.origin + "/en/time-tracking?date=2025-03-03", {
			waitUntil: "networkidle0",
		});
		if ((await text()).includes("Not Now")) await click("Not Now");
		await page.waitForSelector('header button[aria-label="Clock In"]');
		const info = await page.evaluate(() => ({
			h1: [...document.querySelectorAll("h1")].map((e) => e.textContent),
			width: document.documentElement.scrollWidth,
			viewport: innerWidth,
			calendar: [...document.querySelectorAll("a")]
				.filter((e) => e.textContent.includes("View Calendar"))
				.map((e) => e.getAttribute("href")),
			edit: document.querySelectorAll('button[aria-label="Edit time entry"]')
				.length,
			offsets: document.body.innerText.includes("UTC+01:00"),
		}));
		check(
			label + " admitted with one task heading",
			info.h1.length === 1 && info.h1[0] === "Time Tracking",
		);
		check(label + " calendar remains reachable", info.calendar.length > 0);
		check(label + " desktop fits", info.width === info.viewport);
		results.roles.push({ actor: label, ...info });
		await page.screenshot({ path: join(out, label + "-desktop.png") });
		if (label !== "small-manager") {
			await context.close();
			continue;
		}
		// The real current form and current authority are used; no mocked action results.
		await click("Add Manual Time Entry");
		await page.waitForSelector('[name="reason"]');
		await fill("clockInTime", "09:00");
		await fill("clockOutTime", "08:00");
		await fill("reason", "R163 invalid manual entry retention");
		await page.waitForFunction(
			() =>
				document.querySelector('[role="dialog"] button[type="submit"]')
					?.disabled === false,
		);
		const submit = await page.waitForSelector(
			'[role="dialog"] button[type="submit"]',
		);
		await submit.click();
		await page.waitForFunction(() =>
			document.body.innerText.includes(
				"Clock out time must be after clock in time",
			),
		);
		const retained = await values();
		check(
			"manual rejection keeps both times and reason",
			retained.clockInTime === "09:00" &&
				retained.clockOutTime === "08:00" &&
				retained.reason === "R163 invalid manual entry retention",
		);
		results.manual = retained;
		await page.screenshot({ path: join(out, "manual-failure.png") });
		const field = await page.$('[name="reason"]');
		await page.click('button[aria-label="Refresh data"]');
		await page.waitForNetworkIdle();
		check(
			"global refresh retains manual draft element",
			await field.evaluate(
				(e) =>
					e.isConnected && e.value === "R163 invalid manual entry retention",
			),
		);
		await click("Cancel", '[role="dialog"]');
		// Back to current records created by actual clock actions in the timezone comparison.
		await page.goto(runtime.origin + "/en/time-tracking", {
			waitUntil: "networkidle0",
		});
		await click("Edit time entry");
		await page.waitForSelector('[name="clockInTime"]');
		await fill("clockInTime", "23:00");
		await fill("clockOutTime", "01:00");
		const reason = await page.$('[name="reason"]');
		if (reason) await fill("reason", "R163 correction failure retention");
		const correctionSubmit = (
			await page.waitForFunction(() =>
				[
					...document.querySelectorAll('[role="dialog"] button[type="submit"]'),
				].find((e) => e.getBoundingClientRect().width && !e.disabled),
			)
		).asElement();
		await correctionSubmit.click();
		await page.waitForFunction(
			() =>
				document.querySelector('[role="dialog"] [aria-invalid="true"]') ||
				document.body.innerText.includes("after"),
		);
		results.correction = await values();
		check(
			"correction rejection retains changed time",
			results.correction.clockInTime === "23:00",
		);
		await page.screenshot({ path: join(out, "correction-failure.png") });
		await click("Cancel", '[role="dialog"]');
		// Choose the real saved text and theme preferences.
		await page.click('button[aria-label^="Account:"]');
		await (await find('[role="menuitem"]', "Font size")).click();
		await (await find('[role="menuitemradio"]', "Large")).click();
		await click("Toggle theme");
		await (await find('[role="menuitem"]', "Dark")).click();
		await page.reload({ waitUntil: "networkidle0" });
		check(
			"saved Large and Dark survive reload",
			await page.evaluate(
				() =>
					document.documentElement.dataset.fontSize === "large" &&
					document.documentElement.classList.contains("dark"),
			),
		);
		results.layouts = [];
		for (const width of [1600, 390, 2560]) {
			await page.setViewport({ width, height: width === 390 ? 844 : 1000 });
			await page.waitForNetworkIdle();
			const layout = await page.evaluate(() => ({
				width: innerWidth,
				document: document.documentElement.scrollWidth,
				font: getComputedStyle(document.documentElement).fontSize,
			}));
			check("large dark " + width + " fits", layout.width === layout.document);
			results.layouts.push(layout);
			await page.screenshot({
				path: join(out, "large-dark-" + width + ".png"),
				fullPage: true,
			});
		}
		await page.setViewport({ width: 1600, height: 1000 });
		await page.setOfflineMode(true);
		await page.waitForFunction(() =>
			document.body.innerText.toLowerCase().includes("offline"),
		);
		await page.screenshot({ path: join(out, "offline.png") });
		results.offline = await text();
		await page.setOfflineMode(false);
		await page.reload({ waitUntil: "networkidle0" });
		check(
			"reconnect restores admitted page",
			!(await text()).includes("Login to your account"),
		);
		await context.close();
	}
	await writeFile(
		join(out, "route-runtime.json"),
		JSON.stringify(results, null, 2),
	);
} catch (error) {
	await writeFile(
		join(out, "route-partial.json"),
		JSON.stringify(
			{
				...results,
				error: error.message,
				visibleText: page ? await text() : null,
			},
			null,
			2,
		),
	);
	throw error;
} finally {
	await browser.disconnect();
}
