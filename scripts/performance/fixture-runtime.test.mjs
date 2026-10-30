/** Explicit real-fixture acceptance check; absence of its configured runtime fails, never skips. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import {
	dashboardLayoutMutation,
	headerRefreshSteps,
	historicalRangeSteps,
	performSteps,
	prepareFixtureBrowserContext,
} from "./journey-steps.mjs";

test("fixture projection initialization preserves all 208 existing employee projections", {
	timeout: 30000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	assert.ok(directory, "Real disposable fixture directory required.");
	const fixture = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
	const result = await new Promise((done) =>
		execFile(
			process.execPath,
			[
				fixture,
				"initialize-projections",
				directory,
				"--as-of",
				"2026-10-24T12:00:00Z",
			],
			{ timeout: 25000 },
			(error, stdout) => done({ code: error?.code ?? 0, stdout }),
		),
	);
	assert.equal(
		result.code,
		0,
		"The guarded real projection initialization command must succeed.",
	);
	assert.match(result.stdout, /208 total, 208 preserved, 0 rebuilt/);
});

test("historical analytics can refresh through mobile More actions after calendar selection", {
	timeout: 60000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	const executablePath = process.env.Z8_TEST_CHROME_PATH;
	assert.ok(
		directory && executablePath,
		"Real disposable fixture and Chrome required.",
	);
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const auth = JSON.parse(
		await readFile(join(directory, "auth-private.json"), "utf8"),
	);
	const browser = await puppeteer.launch({ executablePath, headless: true });
	try {
		const context = await browser.createBrowserContext();
		await prepareFixtureBrowserContext(context, runtime.origin);
		await context.setCookie(...auth["small-admin"].cookies);
		const page = await context.newPage();
		await page.setViewport({ width: 390, height: 844 });
		await page.goto(new URL("/en/analytics/work-hours", runtime.origin).href, {
			waitUntil: "domcontentloaded",
		});
		const bindings = {
			origin: runtime.origin,
			path: "/en/analytics/work-hours",
		};
		await performSteps(page, historicalRangeSteps("month"), bindings, 15000);
		const expected = [
			{
				table: {
					title: "Employee Work Hours",
					rows: 8,
					column: 1,
					value: "168.0h",
				},
			},
		];
		await performSteps(page, expected, bindings, 15000);
		assert.equal(await page.evaluate(() => Notification.permission), "denied");
		assert.equal(
			await page.evaluate(
				async () =>
					(await navigator.permissions.query({ name: "geolocation" })).state,
			),
			"prompt",
		);
		assert.equal(
			await page.evaluate(() =>
				[...document.querySelectorAll('[data-slot="action-panel-title"]')].some(
					(node) => node.textContent.trim() === "Stay Updated",
				),
			),
			false,
		);
		await performSteps(page, headerRefreshSteps, bindings, 10000);
		await performSteps(page, expected, bindings, 15000);
	} finally {
		await browser.close();
	}
});

test("synthetic actors authenticate through Better Auth and retain usable production clock controls", {
	timeout: 240000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	const executablePath = process.env.Z8_TEST_CHROME_PATH;
	assert.ok(
		directory && executablePath,
		"Configure the disposable runtime directory and Chrome path; runtime acceptance is unfulfilled without them.",
	);
	const fixture = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
	const configuration = await new Promise((done) =>
		execFile(
			process.execPath,
			[fixture, "check-runtime", directory],
			{ timeout: 30000 },
			(error) => done(error?.code ?? 0),
		),
	);
	assert.equal(
		configuration,
		0,
		"The actual fixture child environment must validate without skipped defaults.",
	);
	const result = await new Promise((done) =>
		execFile(
			process.execPath,
			[fixture, "authenticate", directory],
			{ timeout: 180000 },
			(error, stdout) => done({ code: error?.code ?? 0, stdout }),
		),
	);
	assert.equal(
		result.code,
		0,
		"The real synthetic authentication command must succeed.",
	);
	assert.match(result.stdout, /8 synthetic actors/);
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const auth = JSON.parse(
		await readFile(join(directory, "auth-private.json"), "utf8"),
	);
	assert.equal(Object.keys(auth).length, 8);
	assert.equal(
		Object.values(auth).every((actor) =>
			actor.cookies
				.filter((cookie) => /^__(Secure|Host)-/.test(cookie.name))
				.every((cookie) => cookie.secure),
		),
		true,
		"Secure production cookie attributes must survive the fixture driver.",
	);
	const browser = await puppeteer.launch({ executablePath, headless: true });
	try {
		for (const actor of Object.values(auth)) {
			const context = await browser.createBrowserContext();
			await prepareFixtureBrowserContext(context, runtime.origin);
			try {
				await context.setCookie(...actor.cookies);
				const page = await context.newPage();
				await page.goto(new URL("/en", runtime.origin).href, {
					waitUntil: "domcontentloaded",
					timeout: 45000,
				});
				await page.waitForSelector(
					'button[aria-label="Clock In"]:not(:disabled)',
					{ visible: true, timeout: 45000 },
				);
				assert.equal(
					new URL(page.url()).pathname,
					"/en",
					"Authenticated fixture stays on the Dashboard.",
				);
			} finally {
				await context.close();
			}
		}
	} finally {
		await browser.close();
	}
});

test("Dashboard refresh and persisted layout restoration work at 390px and 1280px", {
	timeout: 120000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	const executablePath = process.env.Z8_TEST_CHROME_PATH;
	assert.ok(
		directory && executablePath,
		"Real disposable runtime and Chrome are required.",
	);
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const auth = JSON.parse(
		await readFile(join(directory, "auth-private.json"), "utf8"),
	);
	const browser = await puppeteer.launch({ executablePath, headless: true });
	try {
		for (const width of [390, 1280]) {
			const context = await browser.createBrowserContext();
			await prepareFixtureBrowserContext(context, runtime.origin);
			await context.setCookie(...auth["small-admin"].cookies);
			const page = await context.newPage();
			await page.setViewport({ width, height: 900 });
			await page.goto(new URL("/en", runtime.origin).href, {
				waitUntil: "domcontentloaded",
			});
			const bindings = { origin: runtime.origin, path: "/en", locale: "en" };
			await performSteps(page, headerRefreshSteps, bindings, 10000);
			try {
				await performSteps(
					page,
					dashboardLayoutMutation.steps,
					bindings,
					10000,
				);
				await page.waitForSelector(dashboardLayoutMutation.ready, {
					visible: true,
				});
			} finally {
				await performSteps(
					page,
					dashboardLayoutMutation.reset,
					bindings,
					10000,
				);
			}
			await page.waitForSelector('[data-widget-id="quick-stats"]', {
				visible: true,
			});
			await context.close();
		}
	} finally {
		await browser.close();
	}
});

test("visible directory and employee links navigate despite hidden duplicate anchors at both viewports", {
	timeout: 60000,
}, async () => {
	const directory = process.env.Z8_PERFORMANCE_RUNTIME_DIRECTORY;
	const executablePath = process.env.Z8_TEST_CHROME_PATH;
	assert.ok(
		directory && executablePath,
		"Real disposable fixture and Chrome required.",
	);
	const runtime = JSON.parse(
		await readFile(join(directory, "runtime-private.json"), "utf8"),
	);
	const auth = JSON.parse(
		await readFile(join(directory, "auth-private.json"), "utf8"),
	);
	const actor = auth["small-admin"];
	const browser = await puppeteer.launch({ executablePath, headless: true });
	try {
		for (const width of [390, 1280]) {
			const context = await browser.createBrowserContext();
			await prepareFixtureBrowserContext(context, runtime.origin);
			await context.setCookie(...actor.cookies);
			const page = await context.newPage();
			await page.setViewport({ width, height: 900 });
			await page.goto(new URL("/en/settings", runtime.origin).href, {
				waitUntil: "domcontentloaded",
			});
			const bindings = {
				origin: runtime.origin,
				path: "/en/settings/employees",
				employee: actor.targetEmployeeId,
				employeeSearch: actor.targetEmployeeSearch,
			};
			await performSteps(
				page,
				[
					{
						reveal: {
							target: 'a[href="/en/settings/employees"]',
							trigger: 'button[data-sidebar="trigger"]',
						},
					},
					{ click: 'a[href="/en/settings/employees"]' },
				],
				bindings,
				10000,
			);
			await page.waitForFunction(
				() => location.pathname === "/en/settings/employees",
				{ timeout: 10000 },
			);
			await performSteps(
				page,
				[
					{
						fill: 'input[aria-label="Search employees"]',
						value: "{employeeSearch}",
					},
					{ wait: 'a[href="/en/settings/employees/{employee}"]' },
					{ click: 'a[href="/en/settings/employees/{employee}"]' },
				],
				bindings,
				10000,
			);
			await page.waitForFunction(
				(target) => location.pathname === `/en/settings/employees/${target}`,
				{ timeout: 10000 },
				actor.targetEmployeeId,
			);
			await context.close();
		}
	} finally {
		await browser.close();
	}
});
