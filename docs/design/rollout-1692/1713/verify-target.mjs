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
let fixtureDb;
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
	fixtureDb = db;
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

let restoreAuthority = async () => {};
let restoreOrganization = async () => {};
const readTarget = async (month = 0) =>
	page.evaluate(
		async ({ target, org, month }) => {
			const r = await fetch(
				"/api/calendar/events?year=2025&month=" +
					month +
					"&showWorkPeriods=true&showTimeEntries=true&showAbsences=false&showHolidays=false&organizationId=" +
					org +
					"&employeeId=" +
					target,
			);
			const payload = await r.json();
			return { status: r.status, data: payload.json ?? payload };
		},
		{
			target: auth["small-restricted"].employeeId,
			org: fixture.actors["small-manager"].organizationId,
			month,
		},
	);
async function openManual(date = "2025-01-06", dayIndex = -1) {
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=" + date,
	);
	await page.waitForSelector(".sx__time-grid-day");
	const day = (await page.$$(".sx__time-grid-day")).at(dayIndex),
		box = await day.boundingBox(),
		viewport = await (await page.$(".sx__view-container")).boundingBox();
	const y = viewport.y + viewport.height * 0.8;
	await page.mouse.move(box.x + box.width / 2, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, y + 70, { steps: 8 });
	await page.mouse.up();
	await page.waitForSelector("[role=dialog] input[name=clockInTime]");
	await page.waitForFunction(() =>
		document
			.querySelector("[role=dialog]")
			?.textContent.includes("America/New_York"),
	);
}
async function fill(selector, value) {
	const e = await page.$(selector);
	await e.focus();
	await page.keyboard.down("Control");
	await page.keyboard.press("a");
	await page.keyboard.up("Control");
	await page.keyboard.sendCharacter(value);
	assert.equal(await e.evaluate((e) => e.value), value);
	await page.keyboard.press("Tab");
}
async function submitHeld(reason, beforeRelease) {
	let release;
	const held = new Promise((done) => (release = done));
	const listener = async (request) => {
		if (
			request.method() === "POST" &&
			request.headers()["next-action"] &&
			request.postData()?.includes(reason)
		) {
			release(request);
		} else await request.continue();
	};
	await page.setRequestInterception(true);
	page.on("request", listener);
	try {
		await click("Create Entry");
		const request = await Promise.race([
			held,
			new Promise((_, reject) =>
				setTimeout(() => reject(Error("No matching manual action")), 30000),
			),
		]);
		check(
			"manual submit exposes real pending duplicate protection",
			await page.$eval("[role=dialog] button[type=submit]", (e) => e.disabled),
		);
		await beforeRelease();
		const response = page.waitForResponse((r) => r.request() === request, {
			timeout: 60000,
		});
		await request.continue();
		const actual = await response;
		const body = await actual.text();
		await page.setRequestInterception(false);
		page.off("request", listener);
		return { http: actual.status(), body };
	} finally {
		page.off("request", listener);
		await page.setRequestInterception(false);
	}
}
try {
	await seedTargetZone();
	await actor("small-manager");
	await page.emulateTimezone("Europe/Berlin");
	await openManual();
	check(
		"direct selected arrival identifies target in page and real manual title",
		await page.evaluate(
			() =>
				document.querySelector("main h2")?.textContent === "Fixture Person 3" &&
				document
					.querySelector("[role=dialog]")
					?.textContent.includes("Person 3"),
		),
	);
	const existing = (await readTarget()).data.events.find(
		(e) =>
			e.type === "work_period" &&
			e.metadata?.notes === "R015 genuine New York verified inputs",
	);
	let submitted = { http: null };
	if (!existing) {
		await fill("input[name=clockInTime]", "18:00");
		await fill("input[name=clockOutTime]", "19:00");
		await fill(
			"textarea[name=reason]",
			"R015 genuine New York verified inputs",
		);
		await shot("after-target-manual-ready");
		submitted = await submitHeld(
			"R015 genuine New York verified inputs",
			async () => {},
		);
		await page.waitForSelector("[role=dialog]", {
			hidden: true,
			timeout: 30000,
		});
	} else {
		await page.keyboard.press("Escape");
	}
	const read = await readTarget();
	check(
		"genuine on-behalf submission returns in authorized calendar reader",
		read.status === 200 &&
			read.data.events.some(
				(e) => e.metadata?.notes === "R015 genuine New York verified inputs",
			),
	);
	const work = read.data.events.find(
		(e) =>
			e.type === "work_period" &&
			e.metadata?.notes === "R015 genuine New York verified inputs",
	);
	assert.ok(work);
	console.log(
		JSON.stringify({
			date: work.date,
			endDate: work.endDate,
			minutes: work.metadata.durationMinutes,
		}),
	);
	check(
		"manual New York wall times preserve UTC instants and duration",
		work.date === "2025-01-12T23:00:00.000Z" &&
			work.endDate === "2025-01-13T00:00:00.000Z" &&
			work.metadata.durationMinutes === 60,
	);
	check(
		"manual endpoints use target zone and captured offsets",
		work.metadata.clockInTimezone === "America/New_York" &&
			work.metadata.clockOutTimezone === "America/New_York" &&
			work.metadata.clockInUtcOffsetMinutes === -300 &&
			work.metadata.clockOutUtcOffsetMinutes === -300,
	);
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=2025-01-12",
	);
	await page.waitForSelector("[data-event-id]");
	check(
		"genuine entry survives route reload",
		(await readTarget()).data.events.some((e) => e.id === work.id),
	);
	await shot("after-target-manual-readback");
	await openManual();
	await fill("input[name=clockInTime]", "21:00");
	await fill("input[name=clockOutTime]", "22:00");
	await fill("textarea[name=reason]", "R015 refused after authority loss");
	const manager = fixture.actors["small-manager"];
	const previous = (
		await fixtureDb.query(
			"select role from employee where id=$1 and organization_id=$2",
			[manager.employeeId, manager.organizationId],
		)
	).rows[0];
	assert.ok(previous);
	restoreAuthority = async () => {
		await fixtureDb.query(
			"update employee set role=$1 where id=$2 and organization_id=$3",
			[previous.role, manager.employeeId, manager.organizationId],
		);
	};
	const refused = await submitHeld(
		"R015 refused after authority loss",
		async () => {
			await fixtureDb.query(
				"update employee set role=$1 where id=$2 and organization_id=$3",
				["employee", manager.employeeId, manager.organizationId],
			);
		},
	);
	check(
		"server action refuses authority lost after panel preparation",
		refused.body.includes("false") &&
			/AuthorizationError|not authorized|do not have permission|permission|access|CONTEXT_MISMATCH/i.test(
				refused.body,
			),
	);
	check(
		"refused manual entry retains reason in real form",
		await page.$eval(
			"textarea[name=reason]",
			(e) => e.value === "R015 refused after authority loss",
		),
	);
	await shot("after-target-access-refusal");
	await restoreAuthority();
	restoreAuthority = async () => {};
	check(
		"refused attempt created no calendar record",
		!(await readTarget()).data.events.some(
			(e) => e.metadata?.notes === "R015 refused after authority loss",
		),
	);
	await openManual("2025-01-31", 4);
	await fill("input[name=clockInTime]", "23:30");
	await fill("input[name=clockOutTime]", "23:45");
	await fill("textarea[name=reason]", "R015 January verified boundary");
	await shot("after-boundary-ready");
	const boundaryBefore = (await readTarget()).data.events.find(
		(e) =>
			e.type === "work_period" &&
			e.metadata?.notes === "R015 January verified boundary",
	);
	let boundarySubmission = null;
	if (!boundaryBefore) {
		boundarySubmission = await submitHeld(
			"R015 January verified boundary",
			async () => {},
		);
		await page.waitForSelector("[role=dialog]", { hidden: true });
	} else await page.keyboard.press("Escape");
	const january = await readTarget(0),
		february = await readTarget(1);
	const boundary = january.data.events.find(
		(e) =>
			e.type === "work_period" &&
			e.metadata?.notes === "R015 January verified boundary",
	);
	check(
		"target-local January includes real February UTC boundary entry",
		boundary?.date === "2025-02-01T04:30:00.000Z" &&
			boundary?.endDate === "2025-02-01T04:45:00.000Z" &&
			boundary?.metadata.durationMinutes === 15,
	);
	check(
		"target-local February excludes January wall-date entry",
		!february.data.events.some((e) => e.id === boundary.id),
	);
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=2025-01-31",
	);
	await page.waitForSelector("[data-event-id]");
	await shot("after-boundary-readback");
	await openManual();
	await fill("input[name=clockInTime]", "22:15");
	await fill("input[name=clockOutTime]", "22:30");
	await fill("textarea[name=reason]", "R015 refused after organization switch");
	const otherOrg = fixture.actors["large-admin"].organizationId;
	assert.notEqual(otherOrg, manager.organizationId);
	const userRow = (
		await fixtureDb.query(
			"select user_id from employee where id=$1 and organization_id=$2",
			[manager.employeeId, manager.organizationId],
		)
	).rows[0];
	assert.ok(userRow);
	const memberId = crypto.randomUUID();
	await fixtureDb.query(
		"insert into member (id,user_id,organization_id,role,created_at) values ($1,$2,$3,$4,now())",
		[memberId, userRow.user_id, otherOrg, "member"],
	);
	const activate = async (organizationId) =>
		page.evaluate(async (organizationId) => {
			const response = await fetch("/api/auth/organization/set-active", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId }),
			});
			return response.status;
		}, organizationId);
	restoreOrganization = async () => {
		await activate(manager.organizationId);
		await fixtureDb.query(
			"delete from member where id=$1 and organization_id=$2",
			[memberId, otherOrg],
		);
	};
	const refusedOrg = await submitHeld(
		"R015 refused after organization switch",
		async () => {
			assert.equal(await activate(otherOrg), 200);
		},
	);
	check(
		"prepared manual action refuses changed active organization",
		refusedOrg.body.includes("false") &&
			/context|organization|employee|access|AuthenticationError|AuthorizationError/i.test(
				refusedOrg.body,
			),
	);
	check(
		"changed-organization refusal retains the prepared reason",
		await page.$eval(
			"textarea[name=reason]",
			(e) => e.value === "R015 refused after organization switch",
		),
	);
	await shot("after-target-org-refusal");
	await restoreOrganization();
	restoreOrganization = async () => {};
	await actor("small-admin");
	await go(
		"/en/calendar/" + auth["small-restricted"].employeeId + "?date=2025-01-06",
	);
	const afterScope = await readTarget();
	assert.equal(afterScope.status, 200);
	check(
		"changed-organization attempt created no target record",
		!afterScope.data.events.some(
			(e) => e.metadata?.notes === "R015 refused after organization switch",
		),
	);
	await writeFile(
		join(output, "target-assertions.json"),
		JSON.stringify(
			{
				checks,
				errors,
				submittedHttp: submitted.http,
				boundarySubmittedHttp: boundarySubmission?.http ?? null,
				expected: {
					date: "2025-01-12",
					start: "2025-01-12T23:00:00.000Z",
					end: "2025-01-13T00:00:00.000Z",
					minutes: 60,
					offset: -300,
				},
				limits: contextLimits,
			},
			null,
			2,
		),
	);
} catch (error) {
	await shot("failed-target-step").catch(() => {});
	await writeFile(
		join(output, "target-incomplete.json"),
		JSON.stringify({ checks, error: String(error), errors }, null, 2),
	);
	throw error;
} finally {
	try {
		await restoreOrganization();
	} finally {
		try {
			await restoreAuthority();
		} finally {
			try {
				await restoreZone();
			} finally {
				await browser.close();
			}
		}
	}
}
