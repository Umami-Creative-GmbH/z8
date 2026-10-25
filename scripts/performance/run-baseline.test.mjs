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
test("only directory's generated prerequisite waits instead of opening the unrelated global drawer", () => {
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
			detail = plan.routes.find((r) => r.name === "employee-detail");
		assert.deepEqual(directory.navigationSteps, [{ wait: directory.link }]);
		assert.deepEqual(detail.navigationSteps, [
			{
				fill: 'input[aria-label="Search employees"]',
				value: "{employeeSearch}",
			},
			{ wait: detail.link },
		]);
		for (const route of plan.routes.filter(
			(r) => !r.name.startsWith("employee-"),
		))
			assert.deepEqual(route.navigationSteps, [
				{
					reveal: {
						target: route.link,
						trigger: 'button[data-sidebar="trigger"]',
					},
				},
			]);
		assert.equal(plan.timeoutMs, 30000);
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

test("primary retains failed native close evidence and still rejects incomplete native coverage", async () => {
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
	assert.equal(sample.failureStage, "native-coverage");
	assert.equal(sample.failureKind, "observation-incomplete");
	assert.equal(sample.usableContentMs, null);
});

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
		plan.runtime.browserPolicy = "isolated-profile-no-prediction-v1";
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

test("a fully observed failed predecessor is recorded while the same failure blocks release", () => {
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
		assert.equal(predecessor.command.status, 0);
		assert.equal(predecessor.artifact.acceptance, "baseline-recorded");
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
		assert.equal(unbudgeted.command.status, 0);
		assert.equal(unbudgeted.artifact.acceptance, "baseline-recorded");
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
		assert.equal(nativeGood.command.status, 0);
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
