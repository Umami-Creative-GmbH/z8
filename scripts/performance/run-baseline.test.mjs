import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as journeySteps from "./journey-steps.mjs";
import { clickVisible } from "./journey-steps.mjs";
import { nextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";
import { primaryProtocolIdentity } from "./protocol-fingerprints.mjs";
import { measure } from "./run-baseline.mjs";
import { runInNewContext } from "node:vm";
import { testBrowserMetadata, testBrowserEvidence } from "./control-cancellation-test-fixtures.mjs";

test("fixture startup checks the actual temporary compiled manifest and never repairs stale identity", async () => {
	const fixture = await import("./fixture.mjs");
	assert.equal(typeof fixture.requireMatchingFixtureDeployment, "function");
	const folder = mkdtempSync(join(tmpdir(), "z8-fixture-startup-"));
	try {
		const path = join(folder, "required-server-files.json");
		const original = "63904fb66849eea186e4e7af359cbbd1bfb8e6f5";
		const optimized = "744012906b6511aa5d73ebadf47fcff3f8eff74f";
		const stale = "bda468856728844f8172f6832c4deb9ad34a3bb0";
		for (const deploymentId of [original, optimized]) {
			writeFileSync(path, JSON.stringify({ config: { deploymentId } }));
			await assert.doesNotReject(fixture.requireMatchingFixtureDeployment({ env: { NEXT_DEPLOYMENT_ID: deploymentId } }, path));
			const runtime = { env: { NEXT_DEPLOYMENT_ID: stale, NEXT_PUBLIC_BUILD_HASH: deploymentId.slice(0, 7) } };
			await assert.rejects(fixture.requireMatchingFixtureDeployment(runtime, path), /Fixture.*deployment/i);
			assert.equal(runtime.env.NEXT_DEPLOYMENT_ID, stale, "Known mismatches must never be silently healed.");
		}
		writeFileSync(path, JSON.stringify({ config: {} }));
		await assert.rejects(fixture.requireMatchingFixtureDeployment({ env: { NEXT_DEPLOYMENT_ID: original } }, path), /Fixture.*deployment/i);
	} finally {
		assert.ok(folder.startsWith(join(tmpdir(), "z8-fixture-startup-")));
		rmSync(folder, { recursive: true, force: true });
	}
});

test("fixture startup rejects missing identity before collector health or process startup", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-fixture-startup-"));
	try {
		const runtimePath = join(folder, "runtime-private.json");
		const bytes = JSON.stringify({ env: { Z8_FIXTURE_OTLP_ENDPOINT: "http://127.0.0.1:9/v1/traces", PRIVATE_CANARY: "never-print-this" } });
		writeFileSync(runtimePath, bytes);
		const fixture = fileURLToPath(new URL("./fixture.mjs", import.meta.url));
		const result = spawnSync(process.execPath, [fixture, "start", folder], { encoding: "utf8", timeout: 2000 });
		assert.equal(result.status, 1, "A missing deployment must fail immediately, before any startup IO.");
		assert.match(result.stderr, /Fixture.*deployment/i);
		assert.doesNotMatch(result.stderr, /never-print-this|127\.0\.0\.1/);
		assert.equal(readFileSync(runtimePath, "utf8"), bytes);
	} finally {
		assert.ok(folder.startsWith(join(tmpdir(), "z8-fixture-startup-")));
		rmSync(folder, { recursive: true, force: true });
	}
});

function sidebarFixture(states) {
	const calls = [];
	const trigger = {
		isVisible: async () => true,
		isIntersectingViewport: async () => true,
		evaluate: async () => true,
		clickablePoint: async () => ({ x: 1, y: 2 }),
		hover: async () => {},
		asLocator: () => ({
			setTimeout() {
				return this;
			},
			click: async () => calls.push("click"),
		}),
	};
	return {
		calls,
		page: {
			$$: async (selector) =>
				selector === 'button[data-sidebar="trigger"]' ? [trigger] : [],
			waitForFunction: async (_predicate, options, input) => {
				assert.ok(options.timeout > 0 && options.timeout <= 30000);
				assert.equal(input.target, 'a[href="/en"]');
				calls.push(input.requireOpen ? "wait-open" : "wait-ready");
				const state = states.shift();
				if (state instanceof Error) throw state;
				return { jsonValue: async () => state, dispose: async () => {} };
			},
		},
	};
}
const sidebarReveal = [
	{
		reveal: {
			target: 'a[href="/{locale}"]',
			trigger: 'button[data-sidebar="trigger"]',
		},
	},
];

test("Sidebar reveal waits for a delayed target in an already-open responsive sidebar without toggling", async () => {
	const fixture = sidebarFixture([{ state: "open" }]);
	await journeySteps.performSteps(
		fixture.page,
		sidebarReveal,
		{ locale: "en" },
		100,
	);
	assert.deepEqual(fixture.calls, ["wait-ready"]);
});

test("Sidebar reveal opens a known closed responsive sidebar once and requires its open target", async () => {
	const fixture = sidebarFixture([{ state: "closed" }, { state: "open" }]);
	await journeySteps.performSteps(fixture.page, sidebarReveal, {
		locale: "en",
	});
	assert.deepEqual(fixture.calls, ["wait-ready", "click", "wait-open"]);
});

test("Sidebar reveal rejects unknown state and never repeats input after final readiness fails", async () => {
	const unknown = sidebarFixture([null]);
	await assert.rejects(
		journeySteps.performSteps(unknown.page, sidebarReveal, { locale: "en" }),
		/Unknown Sidebar/,
	);
	assert.deepEqual(unknown.calls, ["wait-ready"]);
	for (const name of ["TimeoutError", "ProtocolError"]) {
		const failure = Object.assign(Error("Original readiness failure"), {
			name,
		});
		const fixture = sidebarFixture([{ state: "closed" }, failure]);
		await assert.rejects(
			journeySteps.performSteps(fixture.page, sidebarReveal, { locale: "en" }),
			(error) => error === failure,
		);
		assert.deepEqual(fixture.calls, ["wait-ready", "click", "wait-open"]);
	}
});

test("Sidebar reveal retains its absolute deadline before reading or dispatching input", async () => {
	const fixture = sidebarFixture([{ state: "closed" }]);
	await assert.rejects(
		journeySteps.performSteps(fixture.page, sidebarReveal, { locale: "en" }, 0),
		{ name: "TimeoutError" },
	);
	assert.deepEqual(fixture.calls, []);
});

function periodFixture({
	open = "false",
	labels = ["Last Month", "Current Month", "Last Year"],
	failWait = 0,
} = {}) {
	const keys = [];
	let reads = 0,
		waits = 0;
	const failure = Error("Observable focus or selection did not match.");
	const trigger = {
		isVisible: async () => true,
		evaluate: async () =>
			++reads === 1
				? true
				: reads === 2
					? { role: "combobox", popup: "listbox", open }
					: true,
		focus: async () => keys.push("focus"),
	};
	return {
		keys,
		failure,
		trigger,
		page: {
			$$: async () => [trigger],
			evaluate: async () => labels,
			keyboard: { press: async (key) => keys.push(key) },
			waitForFunction: async (_fn, options) => {
				assert.ok(options.timeout > 0 && options.timeout <= 30000);
				if (++waits === failWait) throw failure;
			},
		},
	};
}

test("Period keyboard operation uses actual option order for closed and already-open controls", async () => {
	for (const open of ["false", "true"]) {
		const fixture = periodFixture({ open });
		await journeySteps.selectPeriodPreset(fixture.page, "Last Year");
		assert.deepEqual(fixture.keys, [
			"focus",
			"ArrowDown",
			"Home",
			"ArrowDown",
			"ArrowDown",
			"Enter",
		]);
	}
	const fixture = periodFixture({
		labels: ["Last Month", "Custom Range", "Last Year"],
	});
	await journeySteps.selectPeriodPreset(fixture.page, "Custom Range");
	assert.deepEqual(fixture.keys, [
		"focus",
		"ArrowDown",
		"Home",
		"ArrowDown",
		"Enter",
	]);
});

test("Period unknown state, duplicate options and wrong observed highlight reject before committing", async () => {
	for (const options of [
		{ open: null },
		{ labels: ["Current Month"] },
		{ labels: ["Last Year", "Last Year"] },
		{ failWait: 2 },
	]) {
		const fixture = periodFixture(options);
		await assert.rejects(
			journeySteps.selectPeriodPreset(fixture.page, "Last Year"),
		);
		assert.equal(fixture.keys.includes("Enter"), false);
	}
});

test("Period operation never repeats Enter when accepted selection cannot be verified", async () => {
	const fixture = periodFixture({ failWait: 5 });
	await assert.rejects(
		journeySteps.selectPeriodPreset(fixture.page, "Last Year"),
		(error) => error === fixture.failure,
	);
	assert.equal(fixture.keys.filter((key) => key === "Enter").length, 1);
});

test("Period operation retains the original absolute deadline before focusing or sending input", async () => {
	const fixture = periodFixture();
	fixture.trigger.isVisible = async () => {
		await new Promise((done) => setTimeout(done, 15));
		return true;
	};
	await assert.rejects(
		journeySteps.selectPeriodPreset(fixture.page, "Last Year", 5),
		{ name: "TimeoutError" },
	);
	assert.deepEqual(fixture.keys, []);
});

test("historical presets use keyboard selection while quarter calendar dates and order remain unchanged", () => {
	assert.deepEqual(journeySteps.historicalRangeSteps("year"), [
		{ periodPreset: "Last Year" },
		{ absent: '[data-slot="select-content"]' },
	]);
	const steps = journeySteps.historicalRangeSteps("quarter");
	assert.deepEqual(steps.slice(0, 4), [
		{ periodPreset: "Last Year" },
		{ absent: '[data-slot="select-content"]' },
		{ periodPreset: "Custom Range" },
		{ absent: '[data-slot="select-content"]' },
	]);
	assert.deepEqual(steps.slice(4), [
		{ wait: '[data-slot="calendar"]' },
		{ click: '[data-slot="calendar"] button[aria-label*="Next"]' },
		{ wait: 'button[data-day="2025-03-31"]' },
		{ click: 'button[data-day="2025-03-31"]' },
		{ key: "Escape" },
		{ absent: '[data-slot="calendar"]' },
		{ text: { selector: "button", value: "Jan 1, 2025 - Mar 31, 2025" } },
	]);
});

test("normal step execution dispatches the Period operation and retains the existing popup-close check", async () => {
	const fixture = periodFixture(),
		closed = [];
	fixture.page.waitForSelector = async (css, options) =>
		closed.push({ css, options });
	await journeySteps.performSteps(
		fixture.page,
		journeySteps.historicalRangeSteps("year"),
		{},
		30000,
	);
	assert.equal(fixture.keys.filter((key) => key === "Enter").length, 1);
	assert.deepEqual(closed, [
		{
			css: '[data-slot="select-content"]',
			options: { hidden: true, timeout: 30000 },
		},
	]);
});

test("trusted click scrolls an offscreen target before testing the actual pointer", async () => {
	const calls = [];
	let scrolled = false;
	const element = {
		isVisible: async () => true,
		isIntersectingViewport: async () => scrolled,
		scrollIntoView: async () => {
			scrolled = true;
			calls.push("scroll");
		},
		evaluate: async (_fn, point) => (point ? scrolled : true),
		clickablePoint: async () => ({ x: 1, y: 2 }),
		hover: async () => calls.push("hover"),
		asLocator: () => ({
			setTimeout() {
				return this;
			},
			async click() {
				calls.push("click");
			},
		}),
	};
	await clickVisible({ $$: async () => [element] }, "a", 40);
	assert.deepEqual(calls, ["scroll", "hover", "click"]);
});

test("trusted click selects a pointer-receiving duplicate and revalidates after hover", async () => {
	const calls = [];
	const element = (name, hit) => ({
		isVisible: async () => true,
		isIntersectingViewport: async () => true,
		evaluate: async (_fn, point) => (point ? hit() : true),
		clickablePoint: async () => ({ x: 1, y: 2 }),
		hover: async () => calls.push(`${name}-hover`),
		asLocator: () => ({
			setTimeout(ms) {
				assert.ok(ms > 0 && ms <= 1000);
				return this;
			},
			async click() {
				calls.push(`${name}-click`);
			},
		}),
	});
	await clickVisible(
		{
			$$: async () => [
				element("clipped", () => false),
				element("intended", () => true),
			],
		},
		"a",
		1000,
	);
	assert.deepEqual(calls, ["intended-hover", "intended-click"]);
});
test("hover occlusion cannot cause a wrong click or renew the original deadline", async () => {
	let hovered = false,
		clicks = 0;
	const element = {
		isVisible: async () => true,
		isIntersectingViewport: async () => true,
		evaluate: async (_fn, point) => (point ? !hovered : true),
		clickablePoint: async () => ({ x: 1, y: 2 }),
		hover: async () => {
			hovered = true;
		},
		asLocator: () => ({
			setTimeout() {
				return this;
			},
			async click() {
				clicks++;
			},
		}),
	};
	await assert.rejects(clickVisible({ $$: async () => [element] }, "a", 40), {
		name: "TimeoutError",
	});
	assert.equal(clicks, 0);
});
test("arbitrary pointer protocol failures and the first actual click failure propagate without another click", async () => {
	for (const at of ["point", "click"]) {
		const error = Error("protocol failure"),
			calls = [];
		const element = {
			isVisible: async () => true,
			isIntersectingViewport: async () => true,
			evaluate: async () => true,
			clickablePoint: async () => {
				if (at === "point") throw error;
				return { x: 1, y: 2 };
			},
			hover: async () => {},
			asLocator: () => ({
				setTimeout() {
					return this;
				},
				async click() {
					calls.push("click");
					throw error;
				},
			}),
		};
		await assert.rejects(
			clickVisible({ $$: async () => [element] }, "a", 1000),
			(value) => value === error,
		);
		assert.equal(calls.length, at === "click" ? 1 : 0);
	}
});
test("recognized detachment is retried only before the first actual click", async () => {
	const calls = [],
		error = Error("Node is detached from document");
	const element = () => ({
		isVisible: async () => true,
		isIntersectingViewport: async () => true,
		evaluate: async () => true,
		clickablePoint: async () => ({ x: 1, y: 2 }),
		hover: async () => {},
		asLocator: () => ({
			setTimeout() {
				return this;
			},
			async click() {
				calls.push("click");
			},
		}),
	});
	const stale = element();
	stale.hover = async () => {
		throw error;
	};
	await clickVisible({ $$: async () => [stale, element()] }, "a", 1000);
	assert.deepEqual(calls, ["click"]);
	const target = element();
	target.asLocator = () => ({
		setTimeout() {
			return this;
		},
		async click() {
			calls.push("failed-click");
			throw error;
		},
	});
	await assert.rejects(
		clickVisible({ $$: async () => [target, element()] }, "a", 1000),
		(value) => value === error,
	);
	assert.deepEqual(calls, ["click", "failed-click"]);
});
test("all six generated prerequisites preserve own-page links and genuine global navigation", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-directory-recipe-")),
		out = join(folder, "draft.json");
	try {
		writeFileSync(
			join(folder, "runtime-private.json"),
			JSON.stringify({
				origin: "http://localhost:34123",
				env: { POSTGRES_POOL_MAX: 10 },
				images: [],
			}),
		);
		writeFileSync(
			join(folder, "fixture-private.json"),
			JSON.stringify({
				kind: "disposable",
				actors: { "small-admin": {} },
				organizations: [{ label: "small", employees: 8 }],
				ranges: [],
			}),
		);
		const result = spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL("./fixture.mjs", import.meta.url)),
				"plan",
				folder,
				out,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0);
		const plan = JSON.parse(readFileSync(out));
		const directory = plan.routes.find((r) => r.name === "employee-directory"),
			detail = plan.routes.find((r) => r.name === "employee-detail"),
			analytics = plan.routes.find((r) => r.name === "analytics");
		assert.deepEqual(directory.navigationSteps, [{ wait: directory.link }]);
		assert.deepEqual(analytics.navigationSteps, [{ wait: analytics.link }]);
		assert.equal(analytics.link, 'a[href="/{locale}/analytics/work-hours"]');
		assert.deepEqual(detail.navigationSteps, [
			{
				fill: 'input[aria-label="Search employees"]',
				value: "{employeeSearch}",
			},
			{ wait: detail.link },
		]);
		for (const route of plan.routes.filter((r) =>
			["dashboard", "time-tracking", "reports"].includes(r.name),
		))
			assert.deepEqual(route.navigationSteps, [
				{
					reveal: {
						target: route.link,
						trigger: 'button[data-sidebar="trigger"]',
					},
				},
			]);
		assert.deepEqual(
			Object.fromEntries(
				plan.routes.map((route) => [route.name, route.awayPath]),
			),
			{
				dashboard: "/{locale}/settings",
				"time-tracking": "/{locale}/settings",
				"employee-directory": "/{locale}/settings",
				"employee-detail": "/{locale}/settings/employees",
				reports: "/{locale}/settings",
				analytics: "/{locale}/analytics",
			},
		);
		assert.equal(plan.timeoutMs, 90000);
		assert.equal(plan.samples, 20);
		assert.equal(plan.routes.length, 6);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
const primaryProtocol = await primaryProtocolIdentity();

const runner = fileURLToPath(new URL("./run-baseline.mjs", import.meta.url));
const fixturePlan = () => ({
	samples: 20,
	concurrency: 1,
	fixture: { kind: "disposable", journeysVerified: true },
	runtime: {
		mode: "production",
		build: "39a08d0bb",
		nextStreamCompletionPatch: structuredClone(nextStreamCompletionPatch),
	},
	origin: "http://localhost:34123",
	ranges: ["month", "quarter", "year"].map((name) => ({ name })),
	conditions: ["employee", "manager", "admin", "restricted"].map((role, i) => ({
		name: role,
		role,
		organization: i % 2 ? "large" : "small",
		size: i % 2 ? "large" : "small",
		timezone: "Europe/Berlin",
		locale: "en",
		viewport: { width: 1280, height: 900 },
		budgets: {
			usableContentP95Ms: 5000,
			clockReadyP95Ms: 3000,
			javascriptP95Bytes: 1000000,
			queryCountP95: 100,
		},
	})),
	routes: [
		"dashboard",
		"time-tracking",
		"employee-directory",
		"employee-detail",
		"reports",
		"analytics",
	].map((name) => ({
		name,
		path: "/en",
		ready: "main",
		clockReady: "button:not(:disabled)",
		link: "a",
		refresh: "button",
		mutation: {
			steps: [{ click: "button" }],
			ready: "main",
			reset: [{ click: "button" }],
		},
	})),
});

test("primary plan rejects absent, unknown or changed common Next stream patch", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-common-next-"));
	const path = join(folder, "plan.json");
	for (const change of [
		(p) => delete p.runtime.nextStreamCompletionPatch,
		(p) => (p.runtime.nextStreamCompletionPatch = null),
		(p) => (p.runtime.nextStreamCompletionPatch.cjsSha256 = "0".repeat(64)),
		(p) => (p.runtime.nextStreamCompletionPatch.extra = true),
		(p) => {
			p.runtime.nextStreamLifecycle = p.runtime.nextStreamCompletionPatch;
			delete p.runtime.nextStreamCompletionPatch;
		},
	]) {
		const plan = fixturePlan();
		change(plan);
		writeFileSync(path, JSON.stringify(plan));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /Next.*patch|common.*runtime/i);
	}
});

test("controlled primary admission rejects missing browser pins before any collector or context IO", async () => {
	let calls = 0;
	await assert.rejects(measure({ createBrowserContext: async () => { calls++; } }, {},
		{ runtime: { traceTransport: "context-loopback-proxy-v1" } }, {}, {}, {}, "first-document", 0, 1,
		{ beginCollectorVisit: async () => { calls++; } }), /browser.*control|control.*browser/i);
	assert.equal(calls, 0);
});

test("primary retains the original sanitized failure when native close is incomplete", async () => {
	let registeredIds;
	const proof = [
		{
			traceId: "opaque",
			complete: false,
			driverComplete: true,
			started: { queries: 6 },
			ended: { queries: 6 },
			active: 1,
		},
	];
	const sample = await measure(
		{
			async createBrowserContext() {
				throw Object.assign(Error("PRIVATE_CANARY_DO_NOT_PERSIST"), { name: "TimeoutError" });
			},
		},
		{},
		{ runtime: { collectorProtocol: "z8-fixture-otlp-collector-v2" } },
		{ name: "fixture" },
		{ name: "year" },
		{ name: "analytics" },
		"first-document",
		0,
		1,
		{
			async beginCollectorVisit({ traceIds }) {
				registeredIds = traceIds;
				return { protocol: "z8-fixture-otlp-collector-v2", traceIds };
			},
			async endCollectorVisit() {
				return {
					protocol: "z8-fixture-otlp-collector-v2",
					traces: registeredIds.map((traceId) => ({
						traceId,
						coverage: { incomplete: true, nativeProof: false },
					})),
					nativeCloseProof: proof,
					nativeCloseElapsedMs: 10016.5,
				};
			},
		},
	);
	assert.deepEqual(sample.collector.nativeCloseProof, proof);
	assert.equal(sample.collector.nativeCloseElapsedMs, 10016.5);
	assert.equal(sample.collector.coverage.nativeProof, false);
	assert.equal(sample.failed, true);
	assert.equal(sample.failureStage, "authentication-context");
	assert.equal(sample.failureKind, "timeout");
	assert.deepEqual(sample.secondaryFailures, [{ failureStage: "native-coverage", failureKind: "observation-incomplete" }]);
	assert.ok(Number.isFinite(sample.elapsedUntilFailureMs));
	assert.doesNotMatch(JSON.stringify(sample), /PRIVATE_CANARY_DO_NOT_PERSIST|TimeoutError|stack/);
	assert.equal(sample.usableContentMs, null);
});

for (const mutationFails of [true, false]) {
	test(`primary retains ${mutationFails ? "the mutation timeout" : "the first restoration failure"} through native close errors`, async (t) => {
		let now = 0, reloads = 0, closed = 0, detached = 0;
		const clockMessage="Waiting for selector button failed: PRIVATE_CLOCK_CANARY timeout exceeded",clockError=Object.assign(Error(clockMessage),{name:"TimeoutError",code:mutationFails?"ABORT_ERR":"PRIVATE_CODE"});let clockGetterReads=0;
		if(!mutationFails)Object.defineProperty(clockError,"message",{get(){clockGetterReads++;throw Error("PRIVATE_GETTER");}});
		const callbacks = {}, observedIds = [], observationOrder = [];
		t.mock.method(performance, "now", () => now);
		const page = {
			setViewport: async () => {},
			emulateTimezone: async () => {},
			setExtraHTTPHeaders: async () => {},
			setRequestInterception: async () => {},
			on() {},
			evaluateOnNewDocument: async () => {},
			goto: async () => {},
			waitForSelector: async selector => {if(selector==='button[data-clock]')throw clockError;},
			isClosed: () => false,
			evaluate: async () => "denied",
			createCDPSession: async () => ({
				send: async () => {},
				on(name, callback) {
					callbacks[name] = callback;
					if (name === "Network.requestWillBeSent") callback({ requestId: "inherited", timestamp: 0 });
				},
				detach: async () => { detached++; },
			}),
			reload: async () => {
				now = ++reloads === 1 ? 10 : 100;
				if (reloads === 1) {
					callbacks["Network.requestWillBeSent"]({ requestId: "measured", timestamp: 1 });
					callbacks["Network.loadingFailed"]({ requestId: "inherited" });
					callbacks["Network.loadingFailed"]({ requestId: "measured" });
				}
				if (reloads === 1 && !mutationFails) return;
				throw Object.assign(Error("PRIVATE_CANARY_DO_NOT_PERSIST"), {
					name: reloads === 1 ? "TimeoutError" : "Error",
				});
			},
		};
		const sample = await measure(
			{
				createBrowserContext: async () => ({
					id: "isolated",
					setPermission: async () => {},
					setCookie: async () => {},
					newPage: async () => page,
					close: async () => { closed++; },
				}),
			},
			{ fixture: { cookies: [] } },
			{
				origin: "http://localhost",
				runtime: { collectorProtocol: "z8-fixture-otlp-collector-v2" },
			},
			{ name: "fixture", locale: "en" },
			{ name: "default" },
			{
				name: "dashboard",
				path: "/en",
				clockReady: 'button[data-clock]',
				mutation: {
					steps: [{ reload: true }],
					reset: [{ reload: true }],
				},
			},
			"mutation-refresh", 0, 1,
			{
				observeBrowser: async ({ page: actual, headers }) => {
					assert.equal(actual, page);
					assert.deepEqual(headers, { "Accept-Language": "en" });
					return {
						beginMeasurement: () => observationOrder.push("begin"),
						endMeasurement: () => observationOrder.push("end"),
						recordMeasuredFailure: (id) => observedIds.push(id),
						close: async () => observationOrder.push("close"),
						snapshot: () => ({ observed: observedIds.length }),
					};
				},
				beginCollectorVisit: async () => ({}),
				endCollectorVisit: async () => { throw Error("PRIVATE_NATIVE_CANARY"); },
			},
		);
		assert.equal(sample.failed, true);
		assert.equal(sample.restored, false);
		assert.equal(sample.failureStage, mutationFails ? "mutation" : "restore-original-state");
		assert.equal(sample.failureKind, mutationFails ? "timeout" : "restoration-error");
		assert.equal(sample.failureAction, mutationFails ? "reload" : undefined);
		assert.equal(sample.failureStep, mutationFails ? 0 : undefined);
		assert.equal(sample.elapsedUntilFailureMs, mutationFails ? 10 : 100);
		assert.deepEqual(sample.secondaryFailures, [
			...(mutationFails ? [{
				failureStage: "restore-original-state",
				failureKind: "restoration-error",
			}] : []),
			{ failureStage: "native-coverage", failureKind: "observation-incomplete" },
		]);
		assert.equal(closed, 1);
		assert.equal(detached, 1);
		assert.equal(sample.failedRequests, 1);
		assert.deepEqual(observedIds, ["measured"]);
		assert.deepEqual(observationOrder, ["begin", "end", "close"]);
		assert.deepEqual(sample.browserControlEvidence, { observed: 1 });
		assert.deepEqual(sample.clockWaitFailure,{name:"TimeoutError",code:mutationFails?"ABORT_ERR":null,technicalReason:mutationFails?"selector-timeout":"unknown",messageSha256:mutationFails?createHash("sha256").update(clockMessage).digest("hex"):null});
		assert.equal(clockGetterReads,0);assert.equal(sample.clockReadyMs,null);
		assert.doesNotMatch(JSON.stringify(sample), /PRIVATE_.*CANARY|PRIVATE_CODE|PRIVATE_GETTER|stack/);
	});
}

test("primary preserves positive close proof and leaves absent proof and elapsed time unknown", async () => {
	for (const present of [true, false]) {
		let registeredIds;
		const proof = [
			{
				traceId: "opaque",
				complete: true,
				driverComplete: true,
				started: { queries: 6 },
				ended: { queries: 6 },
				active: 0,
			},
		];
		const sample = await measure(
			{
				async createBrowserContext() {
					throw Error("Unavailable fixture browser");
				},
			},
			{},
			{ runtime: { collectorProtocol: "z8-fixture-otlp-collector-v2" } },
			{ name: "fixture" },
			{ name: "year" },
			{ name: "analytics" },
			"first-document",
			0,
			1,
			{
				async beginCollectorVisit({ traceIds }) {
					registeredIds = traceIds;
					return { protocol: "z8-fixture-otlp-collector-v2", traceIds };
				},
				async endCollectorVisit() {
					return {
						protocol: "z8-fixture-otlp-collector-v2",
						traces: registeredIds.map((traceId) => ({
							traceId,
							coverage: { incomplete: false, nativeProof: true },
						})),
						...(present
							? { nativeCloseProof: proof, nativeCloseElapsedMs: 703.25 }
							: {}),
					};
				},
			},
		);
		assert.deepEqual(sample.collector.nativeCloseProof, present ? proof : null);
		assert.equal(
			sample.collector.nativeCloseElapsedMs,
			present ? 703.25 : null,
		);
		assert.equal(sample.collector.coverage.nativeProof, true);
		assert.equal(
			sample.failed,
			true,
			"Positive closure does not erase a prerequisite failure.",
		);
		assert.equal(sample.failureStage, "authentication-context");
		assert.equal(sample.usableContentMs, null);
	}
});

test("a diagnostic mode filter cannot reduce controlled measurement cohorts", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-mode-"));
	try {
		const path = join(folder, "plan.json");
		writeFileSync(path, JSON.stringify(fixturePlan()));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan", "--mode", "first-document"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /only for journey verification/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("context-proxy plans require the prospective post-snapshot native cleanup policy", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-cleanup-plan-"));
	try {
		const path = join(folder, "plan.json"),
			plan = fixturePlan();
		plan.runtime.traceTransport = "context-loopback-proxy-v1";
		plan.phase = "baseline";
		plan.timeoutMs = 90000;
		plan.runtime.poolMax = 10;
		plan.runtime.poolAcquisitionTimeoutMs = 60000;
		plan.runtime.browserPolicy = "isolated-profile-no-prediction-v1";
		plan.runtime.browserControl = testBrowserMetadata();
		plan.runtime.prerequisiteQuiescencePolicy =
			"settled-prerequisite-transfers-v1";
		const validate = () => {
			writeFileSync(path, JSON.stringify(plan));
			return spawnSync(
				process.execPath,
				[runner, "--plan", path, "--validate-plan"],
				{ encoding: "utf8" },
			);
		};
		assert.equal(validate().status, 2);
		plan.runtime.nativeCleanupPolicy = "post-snapshot-finite-prefetch-quiet-v1";
		plan.runtime.operatorReloadQuiescencePolicy =
			"operator-reload-transfer-quiescence-v1";
		assert.equal(validate().status, 0);
		delete plan.runtime.operatorReloadQuiescencePolicy;
		assert.equal(validate().status, 2);
		plan.runtime.operatorReloadQuiescencePolicy =
			"operator-reload-transfer-quiescence-v1";
		delete plan.runtime.prerequisiteQuiescencePolicy;
		assert.equal(validate().status, 2);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("baseline collection accepts unset release budgets while release and unknown phases cannot bypass them", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-budget-"));
	try {
		const path = join(folder, "plan.json");
		const plan = { ...fixturePlan(), phase: "baseline" };
		for (const condition of plan.conditions) delete condition.budgets;
		const validate = () => {
			writeFileSync(path, JSON.stringify(plan));
			return spawnSync(
				process.execPath,
				[runner, "--plan", path, "--validate-plan"],
				{ encoding: "utf8" },
			);
		};
		assert.equal(
			validate().status,
			0,
			"The predecessor must be measurable before head budgets are frozen.",
		);
		plan.phase = "release";
		assert.equal(
			validate().status,
			2,
			"A release still requires numerical budgets.",
		);
		plan.phase = "anything-else";
		assert.equal(
			validate().status,
			2,
			"An unknown phase must not bypass release validation.",
		);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("the baseline command refuses an absent fixture plan before opening a browser", () => {
	const result = spawnSync(process.execPath, [runner, "--validate-plan"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 2);
	assert.match(result.stderr, /A fixture plan is required/);
});

test("the baseline command rejects a cohort below twenty without printing private plan values", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-cli-"));
	try {
		const path = join(folder, "plan.json");
		writeFileSync(
			path,
			JSON.stringify({ samples: 3, password: "private-canary-value" }),
		);
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /at least twenty/);
		assert.doesNotMatch(result.stderr + result.stdout, /private-canary-value/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("finalizing browser observations without backend evidence keeps the acceptance gate unfulfilled", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-gate-"));
	try {
		const planPath = join(folder, "plan.json");
		const artifactPath = join(folder, "baseline.json");
		const planBytes = JSON.stringify(fixturePlan());
		writeFileSync(planPath, planBytes);
		writeFileSync(
			artifactPath,
			JSON.stringify({
				planSha256: createHash("sha256").update(planBytes).digest("hex"),
				samples: [{ traceId: "a".repeat(32), failed: false }],
				summaries: [],
			}),
		);
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", planPath, "--finalize", artifactPath],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /Baseline acceptance: unfulfilled/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("finalization retains raw browser failures and rejects them in both phases", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-browser-error-gate-"));
	try {
		const planPath = join(folder, "plan.json"), artifactPath = join(folder, "baseline.json");
		for (const phase of ["baseline", "release"])
			for (const failedRequests of [1, undefined, null, "0", 0.5, 0]) {
				const bytes = JSON.stringify({ ...fixturePlan(), phase });
				writeFileSync(planPath, bytes);
				writeFileSync(artifactPath, JSON.stringify({
					planSha256: createHash("sha256").update(bytes).digest("hex"),
					samples: [{ traceId: "a".repeat(32), failed: false, censored: false, failedRequests, browserControlEvidence: testBrowserEvidence("a".repeat(32)) }],
					summaries: [],
				}));
				const command = spawnSync(process.execPath, [runner, "--plan", planPath, "--finalize", artifactPath], { encoding: "utf8" });
				assert.equal(command.status, 1, "Incomplete cohorts remain rejected independently.");
				const artifact = JSON.parse(readFileSync(artifactPath));
				assert.equal(artifact.evidenceComplete, false);
				assert.equal(artifact.samples[0].failedRequests, failedRequests);
				assert.equal(artifact.evidenceGates.some((gate) => /complete browser request proofs/i.test(gate)), failedRequests !== 0);
			}
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("one successful sample cannot stand in for all planned first and warm cohorts", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-cohort-"));
	try {
		const planPath = join(folder, "plan.json");
		const artifactPath = join(folder, "baseline.json");
		const backendPath = join(folder, "backend.json");
		const planBytes = JSON.stringify(fixturePlan());
		writeFileSync(planPath, planBytes);
		const traceId = "a".repeat(32);
		writeFileSync(
			artifactPath,
			JSON.stringify({
				planSha256: createHash("sha256").update(planBytes).digest("hex"),
				samples: [{ traceId, failed: false }],
				summaries: [],
			}),
		);
		writeFileSync(
			backendPath,
			JSON.stringify([
				{
					traceId,
					queryCount: 1,
					queryDurationMs: 2,
					rowsRetrieved: 3,
					poolWaitMs: 0,
					cacheHits: 0,
					cacheMisses: 1,
					eventLoopDelayMs: 0,
				},
			]),
		);
		const result = spawnSync(
			process.execPath,
			[
				runner,
				"--plan",
				planPath,
				"--finalize",
				artifactPath,
				"--backend",
				backendPath,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(result.stdout, /Baseline acceptance: unfulfilled/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("unknown per-route ranges cannot silently remove required cohorts", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-range-"));
	try {
		const planPath = join(folder, "plan.json");
		const plan = fixturePlan();
		plan.routes[0].ranges = ["unknown-range"];
		writeFileSync(planPath, JSON.stringify(plan));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", planPath, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /known range/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("per-mode counts cannot reduce mandatory warm samples below twenty", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-count-"));
	try {
		const path = join(folder, "plan.json");
		writeFileSync(
			path,
			JSON.stringify({ ...fixturePlan(), samplesByMode: { "repeat-link": 5 } }),
		);
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /twenty/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("mutation measurement requires an explicit restoration recipe", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-reset-"));
	try {
		const path = join(folder, "plan.json");
		const plan = fixturePlan();
		delete plan.routes[0].mutation.reset;
		writeFileSync(path, JSON.stringify(plan));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /restoration/);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("a declared browser permission policy cannot differ from the actual fixture protocol", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-permissions-"));
	try {
		const path = join(folder, "plan.json");
		const plan = fixturePlan();
		plan.runtime.browserPermissions = "all-denied";
		writeFileSync(path, JSON.stringify(plan));
		const result = spawnSync(
			process.execPath,
			[runner, "--plan", path, "--validate-plan"],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 2);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("route condition labels must be known and cannot silently leave a declared condition unused", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-matrix-"));
	try {
		const path = join(folder, "plan.json");
		const plan = fixturePlan();
		const validate = () => {
			writeFileSync(path, JSON.stringify(plan));
			return spawnSync(
				process.execPath,
				[runner, "--plan", path, "--validate-plan"],
				{ encoding: "utf8" },
			);
		};
		plan.routes[0].conditions = ["unknown-label"];
		assert.equal(validate().status, 2);
		for (const route of plan.routes) route.conditions = ["employee"];
		assert.equal(validate().status, 2);
		for (const route of plan.routes) delete route.conditions;
		assert.equal(
			validate().status,
			0,
			"The default comparison cross product remains supported.",
		);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});

test("fully observed failed journeys cannot finalize either baseline or release evidence", () => {
	const folder = mkdtempSync(join(tmpdir(), "z8-baseline-predecessor-"));
	try {
		const plan = {
			...fixturePlan(),
			phase: "baseline",
			samplesByMode: {
				"return-visit": 1,
				"manual-refresh": 1,
				"mutation-refresh": 1,
			},
		};
		const samples = [];
		const summaries = [];
		plan.routes.forEach((route, index) => {
			route.conditions = [
				["employee"],
				["employee"],
				["manager"],
				["manager"],
				["restricted"],
				["admin"],
			][index];
		});
		for (const condition of plan.conditions)
			for (const range of plan.ranges)
				for (const route of plan.routes.filter((route) =>
					route.conditions.includes(condition.name),
				))
					for (const mode of [
						"first-document",
						"repeat-link",
						"return-visit",
						"manual-refresh",
						"mutation-refresh",
					]) {
						const failed =
							condition.name === "admin" &&
							route.name === "analytics" &&
							range.name === "year";
						const count = ["first-document", "repeat-link"].includes(mode)
							? 20
							: 1;
						for (let iteration = 0; iteration < count; iteration++)
							samples.push({
								condition: condition.name,
								range: range.name,
								route: route.name,
								mode,
								iteration,
								traceId: samples.length.toString(16).padStart(32, "0"),
								...(failed
									? {
											backendTraceId: (samples.length + 100000)
												.toString(16)
												.padStart(32, "0"),
											prerequisiteTraceId: (samples.length + 100000)
												.toString(16)
												.padStart(32, "0"),
											resourceScope: "prerequisite-failure",
											censored: true,
											requests: null,
											javascriptBytes: null,
										}
									: {}),
								failed,
								usableContentMs: failed ? null : 10,
								failureStage: failed ? "verify-results" : null,
								elapsedUntilFailureMs: failed ? 30000 : null,
								restored: true,
								resourceWindowComplete: true,
							});
						summaries.push({
							condition: condition.name,
							range: range.name,
							route: route.name,
							mode,
							samples: count,
							failed: failed ? count : 0,
							usableContentMs: failed ? null : { p95: 10 },
						});
					}
		const planPath = join(folder, "plan.json");
		const artifactPath = join(folder, "baseline.json");
		const backendPath = join(folder, "backend.json");
		writeFileSync(
			backendPath,
			JSON.stringify(
				samples.map((sample) => ({
					traceId: sample.backendTraceId ?? sample.traceId,
					queryCount: 1,
					queryDurationMs: 2,
					rowsRetrieved: 3,
					poolWaitMs: 4,
					cacheHits: 1,
					cacheMisses: 1,
					eventLoopDelayMs: 2,
				})),
			),
		);
		const finalize = (
			phase,
			protocol = plan.runtime.collectorProtocol,
			nativeComplete = true,
			sourceProtocol = primaryProtocol,
			runtimePatch = nextStreamCompletionPatch,
		) => {
			plan.phase = phase;
			const bytes = JSON.stringify(plan);
			writeFileSync(planPath, bytes);
			writeFileSync(
				artifactPath,
				JSON.stringify({
					kind: "benchmark",
					protocol: sourceProtocol,
					nativeRunCoverage: { complete: nativeComplete },
					runtime: {
						buildVerified: true,
						collectorProtocol: protocol,
						nextStreamCompletionPatch: structuredClone(runtimePatch),
					},
					planSha256: createHash("sha256").update(bytes).digest("hex"),
					samples,
					summaries,
				}),
			);
			const command = spawnSync(
				process.execPath,
				[
					runner,
					"--plan",
					planPath,
					"--finalize",
					artifactPath,
					"--backend",
					backendPath,
				],
				{ encoding: "utf8" },
			);
			return {
				command,
				artifact: JSON.parse(readFileSync(artifactPath, "utf8")),
			};
		};
		const predecessor = finalize("baseline");
		assert.equal(predecessor.command.status, 1);
		assert.equal(predecessor.artifact.acceptance, "unfulfilled");
		assert.equal(predecessor.artifact.evidenceComplete, false);
		assert.equal(predecessor.artifact.releaseAcceptance, "failed");
		const missingCommonRuntime = finalize(
			"baseline",
			undefined,
			true,
			primaryProtocol,
			null,
		);
		assert.equal(missingCommonRuntime.command.status, 1);
		assert.equal(missingCommonRuntime.artifact.evidenceComplete, false);
		assert.match(
			missingCommonRuntime.artifact.evidenceGates.join(" "),
			/Next.*patch/,
		);
		assert.equal(
			predecessor.artifact.samples.find((sample) => sample.censored).requests,
			null,
		);
		const backendBytes = readFileSync(backendPath);
		writeFileSync(backendPath, "[]");
		const missingPrerequisites = finalize("baseline");
		assert.equal(
			missingPrerequisites.command.status,
			1,
			"Censored readiness does not excuse missing actual prerequisite backend evidence.",
		);
		assert.match(
			missingPrerequisites.artifact.evidenceGates.join(" "),
			/Correlated backend/,
		);
		writeFileSync(backendPath, backendBytes);
		assert.equal(
			predecessor.artifact.summaries.find((summary) => summary.failed > 0)
				.usableContentMs,
			null,
		);
		const recordedBudgets = plan.conditions.map(
			(condition) => condition.budgets,
		);
		for (const condition of plan.conditions) delete condition.budgets;
		const unbudgeted = finalize("baseline");
		assert.equal(unbudgeted.command.status, 1);
		assert.equal(unbudgeted.artifact.acceptance, "unfulfilled");
		assert.match(
			unbudgeted.artifact.releaseGates.join(" "),
			/budgets have not been recorded/,
		);
		plan.conditions.forEach((condition, index) => {
			condition.budgets = recordedBudgets[index];
		});
		writeFileSync(planPath, JSON.stringify(plan));
		const changedArchive = spawnSync(
			process.execPath,
			[
				runner,
				"--plan",
				planPath,
				"--finalize",
				artifactPath,
				"--backend",
				backendPath,
			],
			{ encoding: "utf8" },
		);
		assert.equal(changedArchive.status, 2);
		assert.match(changedArchive.stderr, /plan changed after measurement/);
		const release = finalize("release");
		assert.equal(release.command.status, 1);
		assert.equal(release.artifact.acceptance, "unfulfilled");
		assert.match(release.artifact.releaseGates.join(" "), /failed browser/);
		plan.runtime.collectorProtocol = "z8-fixture-otlp-collector-v2";
		const nativeBackend = JSON.parse(backendBytes).map((entry) => ({
			...entry,
			coverage: {
				observer: true,
				pg: true,
				rows: true,
				cache: true,
				eventLoop: true,
				registration: true,
				closed: true,
				incomplete: false,
				unattributedNativeSpans: 0,
				rejectedBatches: 0,
				lateSpans: 0,
				nativeProof: true,
				nativeDriverQueries: 1,
				privateCanary: "PRIVATE_COVERAGE_CANARY",
			},
		}));
		writeFileSync(backendPath, JSON.stringify(nativeBackend));
		const nativeGood = finalize("baseline");
		assert.equal(
			finalize("baseline", plan.runtime.collectorProtocol, true, {
				...primaryProtocol,
				"browser-performance.mjs": "0".repeat(64),
			}).command.status,
			2,
		);
		assert.equal(nativeGood.command.status, 1, "Complete native coverage does not make failed original journeys eligible.");
		assert.equal(
			finalize("baseline", plan.runtime.collectorProtocol, false).command
				.status,
			1,
			"A lost late export blocks the complete run even when earlier trace records are individually reconciled",
		);
		assert.doesNotMatch(
			readFileSync(artifactPath, "utf8"),
			/PRIVATE_COVERAGE_CANARY/,
		);
		assert.equal(
			finalize("baseline", "z8-fixture-otlp-collector-v1").command.status,
			1,
			"A legacy artifact cannot inherit v2 proof from a changed plan",
		);
		for (const entry of nativeBackend) entry.coverage.nativeProof = false;
		writeFileSync(backendPath, JSON.stringify(nativeBackend));
		assert.equal(
			finalize("baseline").command.status,
			1,
			"Numerical metrics cannot replace independent native proof",
		);
	} finally {
		rmSync(folder, { recursive: true, force: true });
	}
});
/** Public measure/Page seam: a selector result loses its context during return navigation. */
async function returningClockFixture(t, { timeoutMs = 90000, waitFailure = null } = {}) {
 let now=0, resolveClock, disposed=0, wait=null;
 const order=[], clockSelector='button[aria-label="Clock In"]:not(:disabled)';
 const transferError=Object.assign(Error("Protocol error (DOM.describeNode): Cannot find context with specified id"),{name:"ProtocolError"});
 const selectorError=Error("Waiting for selector clock failed",{cause:transferError});
 t.mock.method(performance,"now",()=>now);
 const page={
  setViewport:async()=>{},emulateTimezone:async()=>{},setExtraHTTPHeaders:async()=>{},setRequestInterception:async()=>{},on(){},evaluateOnNewDocument:async()=>{},
  goto:async()=>{now+=10;},isClosed:()=>false,evaluate:async()=>"denied",
  waitForSelector:async selector=>{if(selector===clockSelector)throw selectorError;},
  waitForFunction:(predicate,options,selector)=>{
   order.push("clock-start");wait={predicate,options,selector,startedAt:now};
   if(waitFailure)return Promise.reject(waitFailure);
   return new Promise(resolve=>{resolveClock=()=>resolve({dispose:async()=>{disposed++;}});});
  },
  goBack:async()=>{order.push("goBack");now=35;resolveClock?.();},
  createCDPSession:async()=>({send:async()=>{},on(){},detach:async()=>{}}),
 };
 const sample=await measure({createBrowserContext:async()=>({id:"clock-unit",setPermission:async()=>{},setCookie:async()=>{},newPage:async()=>page,close:async()=>{}})},
  {fixture:{cookies:[]}},{origin:"http://localhost",timeoutMs,runtime:{}},{name:"fixture",locale:"en"},{name:"month"},
  {name:"analytics",path:"/analytics",awayPath:"/away",link:'a[href="/analytics"]',ready:"#content",clockReady:clockSelector},"return-visit",0,1);
 return {sample,wait,order,disposed,clockSelector};
}
test("primary clock readiness survives a return navigation without transferring an element between realms",async t=>{
 const result=await returningClockFixture(t);
 assert.equal(result.sample.clockReadyMs,15);
 assert.equal(result.sample.clockWaitFailure,undefined);
 assert.deepEqual(result.order,["clock-start","goBack"]);
 assert.equal(result.wait.selector,result.clockSelector);
 assert.deepEqual(result.wait.options,{polling:"raf",timeout:90000});
 assert.equal(result.wait.startedAt,20);
 assert.equal(result.disposed,1);
});
