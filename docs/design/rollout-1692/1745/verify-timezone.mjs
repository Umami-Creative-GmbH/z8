// pnpm node docs/design/rollout-1692/1745/verify-timezone.mjs <owned-fixture> <owned-cdp-file> <before|after>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";
const [fixturePath, cdpPath, phase = "after"] = process.argv.slice(2);
const dir = resolve(fixturePath),
	out = resolve("docs/design/rollout-1692/1745");
const json = async (f) => JSON.parse(await readFile(join(dir, f), "utf8"));
const runtime = await json("runtime-private.json"),
	fixture = await json("fixture-private.json"),
	services = await json("services.json");
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
assert.match(
	runtime.env.POSTGRES_DB,
	/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/,
);
assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
for (const name of services.containers)
	assert.equal(
		execFileSync(
			"docker",
			[
				"inspect",
				"--format",
				'{{ index .Config.Labels "z8.agent-owned" }}',
				name,
			],
			{ encoding: "utf8", windowsHide: true },
		).trim(),
		services.label,
	);
const require = createRequire(resolve("apps/webapp/package.json"));
const { Pool } = require("pg");
const pool = new Pool({
	host: runtime.env.POSTGRES_HOST,
	port: Number(runtime.env.POSTGRES_PORT),
	database: runtime.env.POSTGRES_DB,
	user: runtime.env.POSTGRES_USER,
	password: runtime.env.POSTGRES_PASSWORD,
});
const actor = fixture.actors["small-manager"];
const browser = await puppeteer.connect({
	browserWSEndpoint: (await readFile(cdpPath, "utf8")).trim(),
});
const auth = await json("dev-auth-private.json");
const context = await browser.createBrowserContext();
await context.setPermission(runtime.origin, {
	permission: { name: "notifications" },
	state: "denied",
});
await context.setCookie(...auth["small-manager"].cookies);
const page = await context.newPage();
await page.setViewport({ width: 1600, height: 1000 });
await page.goto(runtime.origin + "/en/time-tracking", {
	waitUntil: "networkidle0",
});
page.setDefaultTimeout(15000);
const find = async (selector, text) =>
	(
		await page.waitForFunction(
			(selector, text) =>
				[...document.querySelectorAll(selector)].find(
					(e) =>
						e.getBoundingClientRect().width &&
						(e.textContent.trim() === text ||
							e.getAttribute("aria-label") === text),
				),
			{},
			selector,
			text,
		)
	).asElement();
const click = async (text, scope = "body") => {
	await (await find(scope + " button", text)).click();
};
const waitText = async (text) =>
	page.waitForFunction(
		(text) => document.body.innerText.includes(text),
		{},
		text,
	);
const saved = async () =>
	(
		await pool.query(
			"select s.timezone from user_settings s join employee e on e.user_id=s.user_id where e.id=$1 and e.organization_id=$2",
			[actor.employeeId, actor.organizationId],
		)
	).rows[0]?.timezone;
async function saveZone(zone) {
	await page.click('button[aria-label^="Current timezone"]');
	await page.click('[role="combobox"]');
	const option = (
		await page.waitForFunction(
			(zone) =>
				[...document.querySelectorAll('[role="option"]')].find(
					(e) => e.getAttribute("data-value") === zone,
				),
			{},
			zone,
		)
	).asElement();
	await option.click();
	await click("Save timezone");
	await page.waitForFunction(
		(zone) =>
			document
				.querySelector('button[aria-label^="Current timezone"]')
				?.getAttribute("aria-label")
				.includes(zone),
		{},
		zone,
	);
	assert.equal(await saved(), zone);
}
const requests = [];
const record = (r) => {
	if (new URL(r.url()).pathname === "/api/time-clock" && r.method() === "POST")
		requests.push(JSON.parse(r.postData()));
};
page.on("request", record);
const result = {
	phase,
	actor: "small-manager",
	browserTimezone: await page.evaluate(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
	),
};
try {
	await page.reload({ waitUntil: "networkidle0" });
	if (await page.$('header button[aria-label="Clock Out"]')) {
		await page.emulateTimezone(await saved());
		await click("Clock Out", "[data-slot=card]");
		await click("Skip", "[data-slot=card]");
	}
	await page.emulateTimezone("America/New_York");
	result.browserTimezone = await page.evaluate(
		() => Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	// Force an actual personal preference write; visible effective-zone fallback alone is insufficient.
	if (phase === "before") {
		if ((await saved()) !== "America/New_York")
			await saveZone("America/New_York");
		await saveZone("Europe/Berlin");
		await page.reload({ waitUntil: "networkidle0" });
	}
	if ((await saved()) !== "Europe/Berlin") await saveZone("Europe/Berlin");
	await page.reload({ waitUntil: "networkidle0" });
	await page.emulateTimezone("America/New_York");
	assert.equal(
		await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
		"America/New_York",
	);
	assert.equal(await saved(), "Europe/Berlin");
	result.personalSavedTimezone = await saved();
	const setupCount = requests.length;
	// Same actor and inactive state: full widget must prompt and Cancel must not send.
	await click("Clock In", "[data-slot=card]");
	await waitText("Confirm Timezone for This Entry");
	result.fullWidgetPrompt = true;
	await click("Cancel", '[role="dialog"]');
	assert.equal(requests.length, setupCount);
	// Start in Berlin through the unchanged full widget, then travel to New York.
	await page.emulateTimezone("Europe/Berlin");
	await click("Clock In", "[data-slot=card]");
	await waitText("Clock Out");
	await page.emulateTimezone("America/New_York");
	const activeCount = requests.length;
	await click("Clock Out", "[data-slot=card]");
	await waitText("Confirm Timezone for This Entry");
	await click("Cancel", '[role="dialog"]');
	assert.equal(requests.length, activeCount);
	result.sameActiveWorkFullWidgetPrompt = true;
	const startCount = requests.length;
	await page.waitForSelector('header button[aria-label="Clock Out"]');
	await page.click('header button[aria-label="Clock Out"]');
	await click("Clock Out", '[role="dialog"]');
	if (phase === "before") {
		await waitText("You've clocked out!");
		result.headerPrompt = false;
		assert.equal(requests.length, startCount + 1);
		result.headerSentWithoutConfirmation = true;
		await page.screenshot({ path: join(out, "before-header.png") });
	} else {
		await waitText("Confirm Timezone for This Entry");
		assert.equal(requests.length, startCount);
		await page.screenshot({ path: join(out, "after-header.png") });
		await click("Cancel", '[role="dialog"]');
		assert.equal(requests.length, startCount);
		assert.equal(await saved(), "Europe/Berlin");
		result.cancel = true;
		await page.keyboard.press("Escape");
		await page.waitForFunction(
			() => !document.querySelector('[role="dialog"]'),
		);
		await page.click('header button[aria-label="Clock Out"]');
		await click("Clock Out", '[role="dialog"]');
		await waitText("Confirm Timezone for This Entry");
		await page.setRequestInterception(true);
		let release;
		const held = new Promise((resolve) => {
			release = resolve;
		});
		const intercept = (request) => {
			if (
				new URL(request.url()).pathname === "/api/time-clock" &&
				request.method() === "POST"
			)
				release(request);
			else void request.continue();
		};
		page.on("request", intercept);
		await click("Continue once", '[role="dialog"]');
		const pendingRequest = await held;
		assert.equal(
			await page.evaluate(() =>
				[...document.querySelectorAll('[role="dialog"] button')]
					.filter((e) =>
						[
							"Cancel",
							"Continue once",
							"Update timezone and continue",
						].includes(e.textContent.trim()),
					)
					.every((e) => e.disabled),
			),
			true,
		);
		assert.equal(requests.length, startCount + 1);
		result.pendingDuplicateGuard = true;
		await page.screenshot({ path: join(out, "timezone-pending.png") });
		await pendingRequest.continue();
		page.off("request", intercept);
		await page.setRequestInterception(false);
		await waitText("You've clocked out!");
		assert.equal(await saved(), "Europe/Berlin");
		result.continueOnce = true;
		await click("Skip", '[role="dialog"]');
		await page.waitForSelector('header button[aria-label="Clock In"]');
		await page.click('header button[aria-label="Clock In"]');
		await click("Clock In", '[role="dialog"]');
		await waitText("Confirm Timezone for This Entry");
		await click("Update timezone and continue", '[role="dialog"]');
		await page.waitForFunction(() =>
			document
				.querySelector('button[aria-label^="Current timezone"]')
				?.getAttribute("aria-label")
				.includes("America/New_York"),
		);
		await page.waitForSelector('header button[aria-label="Clock Out"]');
		assert.equal(await saved(), "America/New_York");
		result.updateThenClockIn = true;
		await page.waitForSelector('header button[aria-label="Clock Out"]');
		await page.click('header button[aria-label="Clock Out"]');
		await click("Clock Out", '[role="dialog"]');
		await waitText("You've clocked out!");
		await click("Skip", '[role="dialog"]');
		await saveZone("Europe/Berlin");
	}
	const entries = (
		await pool.query(
			"select type,timestamp,timezone,utc_offset_minutes,\"timezone_source\" from time_entry where employee_id=$1 and organization_id=$2 and timestamp > now() - interval '1 hour' order by timestamp",
			[actor.employeeId, actor.organizationId],
		)
	).rows;
	result.requests = requests;
	result.persistedEntries = entries;
	result.persistedPeriods = (
		await pool.query(
			"select w.start_time,w.end_time,w.duration_minutes,ci.timezone as start_zone,ci.utc_offset_minutes as start_offset,co.timezone as end_zone,co.utc_offset_minutes as end_offset,extract(epoch from (w.end_time-w.start_time)) as elapsed_seconds from work_period w join time_entry ci on ci.id=w.clock_in_id join time_entry co on co.id=w.clock_out_id where w.employee_id=$1 and w.organization_id=$2 and w.start_time>now()-interval '1 hour' order by w.start_time",
			[actor.employeeId, actor.organizationId],
		)
	).rows;
	assert.ok(
		entries.some(
			(e) => e.timezone === "Europe/Berlin" && e.utc_offset_minutes === 60,
		),
	);
	assert.ok(
		entries.some(
			(e) => e.timezone === "America/New_York" && e.utc_offset_minutes === -300,
		),
	);
	await writeFile(
		join(out, phase + "-timezone.json"),
		JSON.stringify(result, null, 2),
	);
	console.log("Passed controlled timezone comparison: " + phase);
} finally {
	page.off("request", record);
	await pool.end();
	await browser.disconnect();
}
