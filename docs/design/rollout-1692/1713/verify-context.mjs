// Run from the repository root after preparing/authenticating an owned disposable fixture.
// pnpm node docs/design/rollout-1692/1713/verify-calendar.mjs <fixture-directory>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
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
let restoreZone = async () => {};
const contextLimits = [];
async function seedTargetZone() {
	const services = JSON.parse(
		await readFile(join(directory, "services.json"), "utf8"),
	);
	assert.equal(services.label, "z8-performance-fixture-1450");
	assert.match(
		runtime.env.POSTGRES_DB,
		/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/,
	);
	assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
	for (const container of services.containers)
		assert.equal(
			execFileSync(
				"docker",
				[
					"inspect",
					"--format",
					'{{ index .Config.Labels "z8.agent-owned" }}',
					container,
				],
				{ encoding: "utf8", windowsHide: true },
			).trim(),
			services.label,
		);
	const { Client } = createRequire(resolve("apps/webapp/package.json"))("pg");
	const db = new Client({
		host: runtime.env.POSTGRES_HOST,
		port: Number(runtime.env.POSTGRES_PORT),
		database: runtime.env.POSTGRES_DB,
		user: runtime.env.POSTGRES_USER,
		password: runtime.env.POSTGRES_PASSWORD,
	});
	await db.connect();
	restoreZone = async () => {
		await db.end();
	};
	const target = fixture.actors["small-restricted"];
	const employee = await db.query(
		"select organization_id,user_id from employee where id=$1 and organization_id=$2",
		[target.employeeId, target.organizationId],
	);
	assert.equal(employee.rows[0]?.organization_id, target.organizationId);
	const targetUserId = employee.rows[0].user_id;
	const previous = await db.query(
		"select timezone from user_settings where user_id=$1",
		[targetUserId],
	);
	restoreZone = async () => {
		await db.query("update user_settings set timezone=$1 where user_id=$2", [
			previous.rows[0]?.timezone ?? null,
			targetUserId,
		]);
		await db.end();
	};
	await db.query(
		"insert into user_settings (user_id,timezone,updated_at) values ($1,$2,now()) on conflict (user_id) do update set timezone=excluded.timezone",
		[targetUserId, "America/New_York"],
	);
}
try {
	await seedTargetZone();
	await actor("small-manager");
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=2025-01-06",
	);
	await page.waitForSelector("[data-event-id]");
	check(
		"manager calendar states selected New York zone",
		await page.evaluate(() =>
			document.body.innerText.includes("America/New_York"),
		),
	);
	check(
		"manager global clock retains Berlin zone",
		await page.evaluate(() =>
			[...document.querySelectorAll("button")].some((e) =>
				e
					.getAttribute("aria-label")
					?.startsWith("Current timezone Europe/Berlin"),
			),
		),
	);
	check(
		"captured Berlin endpoint offset remains on New York calendar",
		await page.evaluate(() => document.body.innerText.includes("(UTC+01:00)")),
	);
	const read = await page.evaluate(
		async ({ target, org }) => {
			const response = await fetch(
				"/api/calendar/events?year=2025&month=0&showWorkPeriods=true&organizationId=" +
					org +
					"&employeeId=" +
					target,
			);
			const payload = await response.json();
			return {
				status: response.status,
				zone: payload.json?.calendarTimezone ?? payload.calendarTimezone,
			};
		},
		{
			target: auth["small-restricted"].employeeId,
			org: fixture.actors["small-manager"].organizationId,
		},
	);
	check(
		"authorized real reader uses selected employee zone",
		read.status === 200 && read.zone === "America/New_York",
	);
	await shot("after-manager-new-york");
	check(
		"selected colleague is never labeled My Calendar",
		await page.evaluate(
			() => !document.querySelector("main")?.innerText.includes("My Calendar"),
		),
	);
	// Range-selection callback opens the actual manual entry form in the selected zone.
	const day = (await page.$$(".sx__time-grid-day")).at(-1);
	const box = await day.boundingBox();
	const viewport = await (await page.$(".sx__view-container")).boundingBox();
	const rangeY = viewport.y + viewport.height * 0.8;
	await page.mouse.move(box.x + box.width / 2, rangeY);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, rangeY + 70, { steps: 8 });
	await page.mouse.up();
	await page.waitForSelector("[role=dialog]");
	await page.waitForFunction(() =>
		document
			.querySelector("[role=dialog]")
			?.textContent.includes("America/New_York"),
	);
	check(
		"selected-person drag opens manual entry in selected employee zone",
		true,
	);
	await shot("after-selected-zone-manual-range");
	await page.keyboard.press("Escape");
	await restoreZone();
	restoreZone = async () => {};
	await actor("small-admin");
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=2025-01-06",
	);
	await page.waitForSelector("[role=tab]");
	await click("Account: Person 0");
	const font = await find("[role=menuitem]", "Font size");
	await font.focus();
	await page.keyboard.press("ArrowRight");
	await click("Large", "[role=menuitemradio]");
	await page.waitForFunction(
		() => document.documentElement.dataset.fontSize === "large",
	);
	await page.reload({ waitUntil: "networkidle0" });
	check(
		"large text preference survives calendar reload",
		await page.evaluate(
			() => document.documentElement.dataset.fontSize === "large",
		),
	);
	check("large text desktop fits", await fits());
	await shot("after-large-text-desktop");
	await click("Toggle Sidebar");
	check(
		"sidebar collapse preserves calendar view",
		await page.evaluate(
			() =>
				document.querySelector("[role=tab][aria-selected=true]")
					?.textContent === "Week",
		),
	);
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector(
		"[data-slot=sidebar-trigger][aria-expanded=false]",
	);
	check("sidebar collapse persists", true);
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector("[role=tab]");
	check("large text phone fits", await fits());
	await shot("after-large-text-phone");
	await click("Toggle Sidebar");
	await page.waitForSelector("[role=dialog]");
	check(
		"mobile navigation remains reachable",
		await page.evaluate(() =>
			document.querySelector("[role=dialog]").textContent.includes("Calendar"),
		),
	);
	await page.waitForFunction(() => {
		const dialog = document.querySelector("[role=dialog]");
		return (
			dialog &&
			dialog.getBoundingClientRect().left >= -1 &&
			dialog
				.getAnimations({ subtree: true })
				.every((animation) => animation.playState !== "running")
		);
	});
	await (await find("[role=dialog] a", "Calendar")).focus();
	await page.keyboard.press("Escape");
	const escapeDismissed = await page
		.waitForSelector("[role=dialog]", { hidden: true, timeout: 2000 })
		.then(
			() => true,
			() => false,
		);
	if (!escapeDismissed) {
		contextLimits.push(
			"At large text on a 390x844 calendar, the shared mobile drawer remained open after Escape. This is unresolved shell/harness classification; no Escape pass is claimed.",
		);
		await shot("after-mobile-drawer-escape-limit");
		await page.mouse.click(380, 300);
		await page.waitForSelector("[role=dialog]", { hidden: true });
	}
	await page.waitForFunction(
		() =>
			document.activeElement?.getAttribute("data-slot") === "sidebar-trigger",
	);
	check(
		escapeDismissed
			? "mobile navigation Escape returns focus"
			: "mobile navigation backdrop dismissal returns focus",
		true,
	);
	await page.setViewport({ width: 2400, height: 1200 });
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=2025-01-06",
	);
	await click("Toggle theme");
	await click("Dark", "[role=menuitem]");
	check("selected employee wide dark with saved large text fits", await fits());
	check(
		"selected wide scope retains colleague identity without personal label",
		await page.evaluate(
			() =>
				document.querySelector("main h2")?.textContent === "Fixture Person 3" &&
				!document.querySelector("main")?.innerText.includes("My Calendar"),
		),
	);
	await shot("after-selected-wide-dark-large");
	await page.emulateMediaFeatures([
		{ name: "prefers-reduced-motion", value: "reduce" },
	]);
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle0" });
	await page.waitForSelector("[role=tab]");
	check(
		"selected employee dark large-text reduced-motion phone fits",
		await fits(),
	);
	await shot("after-selected-phone-dark-large-reduced");
	await writeFile(
		join(output, "context-assertions.json"),
		JSON.stringify(
			{
				checks,
				errors,
				limits: [
					...contextLimits,
					"Drag opens the real manual form but does not submit new work.",
					"No physical device, native browser zoom or exhaustive contrast certification.",
				],
			},
			null,
			2,
		),
	);
} catch (error) {
	await shot("failed-context-step").catch(() => {});
	await writeFile(
		join(output, "context-incomplete.json"),
		JSON.stringify({ checks, error: String(error), errors }, null, 2),
	);
	console.error(String(error));
	process.exitCode = 1;
} finally {
	await restoreZone();
	await browser.close();
}
