#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import {
	beginCollectorVisit,
	collectorProtocol,
	endCollectorVisit,
	readCollectorCounters,
	reconcileCollectorRun,
} from "./collector-client.mjs";
import {
	clickVisible,
	fixtureBrowserPermissions,
	historicalRangeSteps,
	performSteps,
	prepareFixtureBrowserContext,
	waitVisible,
} from "./journey-steps.mjs";
import {
	createFixtureTraceTransport,
	fixtureTraceTransport,
} from "./trace-transport.mjs";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const fail = (message) => {
	throw new Error(message);
};
const visitModes = [
	"first-document",
	"repeat-link",
	"return-visit",
	"manual-refresh",
	"mutation-refresh",
];
const modesFor = (route) => route.modes ?? visitModes;
const samplesFor = (plan, mode) => plan.samplesByMode?.[mode] ?? plan.samples;
const routeIncludes = (route, condition) =>
	(!route.roles || route.roles.includes(condition.role)) &&
	(!route.conditions || route.conditions.includes(condition.name));
const budgetNames = [
	"usableContentP95Ms",
	"clockReadyP95Ms",
	"javascriptP95Bytes",
	"queryCountP95",
];
const budgetsRecorded = (condition) =>
	budgetNames.every(
		(name) =>
			Number.isFinite(condition.budgets?.[name]) &&
			condition.budgets[name] >= 0,
	);
const backendMetrics = [
	"queryCount",
	"queryDurationMs",
	"rowsRetrieved",
	"poolWaitMs",
	"cacheHits",
	"cacheMisses",
	"eventLoopDelayMs",
];
const coverageNames = [
	"observer",
	"pg",
	"rows",
	"cache",
	"eventLoop",
	"registration",
	"closed",
	"incomplete",
	"unattributedNativeSpans",
	"rejectedBatches",
	"lateSpans",
	"nativeProof",
	"nativeDriverQueries",
];

function validate(plan, verifying = false) {
	if (
		plan.runtime?.browserPermissions !== undefined &&
		plan.runtime.browserPermissions !== fixtureBrowserPermissions
	)
		fail(
			"Fixture browser permission policy differs from the installed runner.",
		);
	if (plan.phase !== undefined && !["baseline", "release"].includes(plan.phase))
		fail("Use the baseline or release phase.");
	if (!Number.isInteger(plan.samples) || plan.samples < 20)
		fail("Use at least twenty samples per condition and visit mode.");
	for (const mode of visitModes)
		if (
			!Number.isInteger(samplesFor(plan, mode)) ||
			samplesFor(plan, mode) <
				(["first-document", "repeat-link"].includes(mode) ? 20 : 1)
		)
			fail(
				"First and repeat visits require at least twenty samples; functional mode counts must be positive.",
			);
	if (
		plan.fixture?.kind !== "disposable" ||
		plan.runtime?.mode !== "production"
	)
		fail("A disposable production-mode fixture is required.");
	if (!/^[a-f0-9]{7,40}$/.test(plan.runtime.build ?? ""))
		fail("Record the measured source build.");
	if (!Number.isInteger(plan.concurrency) || plan.concurrency < 1)
		fail("Record positive concurrency.");
	if (!Array.isArray(plan.conditions) || plan.conditions.length === 0)
		fail("At least one comparison condition is required.");
	if (
		new Set(plan.conditions.map((condition) => condition.name)).size !==
		plan.conditions.length
	)
		fail("Comparison condition labels must be unique.");
	const roles = new Set(plan.conditions.map((c) => c.role));
	if (
		!["employee", "manager", "admin", "restricted"].every((role) =>
			roles.has(role),
		)
	)
		fail("Include employee, manager, admin and restricted conditions.");
	if (new Set(plan.conditions.map((c) => c.organization)).size < 2)
		fail("Include at least two fixture organizations.");
	if (
		!["small", "large"].every((size) =>
			plan.conditions.some((c) => c.size === size),
		)
	)
		fail("Include small and large fixture organizations.");
	if (
		!Array.isArray(plan.routes) ||
		![
			"dashboard",
			"time-tracking",
			"employee-directory",
			"employee-detail",
			"reports",
			"analytics",
		].every((name) => plan.routes.some((route) => route.name === name))
	)
		fail("Include all six required route families.");
	for (const condition of plan.conditions) {
		if (
			!/^[a-z0-9-]+$/.test(condition.name ?? "") ||
			!condition.timezone ||
			!condition.locale ||
			!condition.viewport?.width ||
			!condition.viewport?.height
		)
			fail("Every condition needs a public label, zone, locale and viewport.");
		if (!verifying && plan.phase !== "baseline" && !budgetsRecorded(condition))
			fail("Record numerical budgets before running the release comparison.");
		if (
			plan.phase === "baseline" &&
			budgetNames.some(
				(name) =>
					condition.budgets?.[name] != null &&
					(!Number.isFinite(condition.budgets[name]) ||
						condition.budgets[name] < 0),
			)
		)
			fail("Baseline budgets must be unset or nonnegative numerical values.");
	}
	if (
		!["month", "quarter", "year"].every((range) =>
			plan.ranges?.some((r) => r.name === range),
		)
	)
		fail("Include month, quarter and year ranges.");
	for (const route of plan.routes) {
		if (
			route.conditions &&
			(!Array.isArray(route.conditions) ||
				route.conditions.length === 0 ||
				route.conditions.some(
					(name) =>
						!plan.conditions.some((condition) => condition.name === name),
				))
		)
			fail("Each route condition must name a known comparison label.");
		if (!plan.conditions.some((condition) => routeIncludes(route, condition)))
			fail(
				"Every required route must select at least one comparison condition.",
			);
		if (
			!Array.isArray(modesFor(route)) ||
			!["first-document", "repeat-link"].every((mode) =>
				modesFor(route).includes(mode),
			) ||
			modesFor(route).some((mode) => !visitModes.includes(mode))
		)
			fail(
				"Each compared route requires first-document and repeat-link modes.",
			);
		if (
			modesFor(route).includes("mutation-refresh") &&
			!route.mutation?.reset?.length
		)
			fail("Mutation measurement requires an explicit restoration recipe.");
		if (
			route.ranges &&
			(!Array.isArray(route.ranges) ||
				route.ranges.length === 0 ||
				route.ranges.some(
					(name) => !plan.ranges.some((range) => range.name === name),
				))
		)
			fail(
				"Each per-route range must name a known range from the comparison plan.",
			);
		if (
			!route.path?.startsWith("/") ||
			!route.ready ||
			!route.link ||
			(modesFor(route).includes("manual-refresh") &&
				!route.refresh &&
				!route.refreshSteps?.length) ||
			(modesFor(route).includes("mutation-refresh") &&
				(!route.mutation?.steps?.length || !route.mutation?.ready))
		)
			fail(
				"Each route needs explicit readiness, Link, refresh and fixture mutation observations.",
			);
	}
	if (
		plan.conditions.some(
			(condition) =>
				!plan.routes.some((route) => routeIncludes(route, condition)),
		)
	)
		fail("Every declared comparison condition must be used by a route.");
	if (
		!visitModes.every((mode) =>
			plan.routes.some((route) => modesFor(route).includes(mode)),
		)
	)
		fail(
			"The complete protocol must cover return visits, manual refresh and mutation refresh.",
		);
	const origin = new URL(plan.origin);
	if (
		!["http:", "https:"].includes(origin.protocol) ||
		origin.username ||
		origin.password ||
		origin.pathname !== "/" ||
		origin.search
	)
		fail("Use a fixture origin without credentials or query parameters.");
	plan.origin = origin.origin;
	return plan;
}

async function main() {
	if (!args.includes("--plan") || !option("--plan"))
		fail("A fixture plan is required (--plan path).");
	const planBytes = await readFile(option("--plan"));
	const plan = validate(
		JSON.parse(planBytes),
		args.includes("--verify-journeys"),
	);
	if (
		(args.includes("--condition") || args.includes("--route")) &&
		!args.includes("--verify-journeys")
	)
		fail(
			"Cohort filters are permitted only for journey verification, never controlled measurement.",
		);
	if (args.includes("--validate-plan")) {
		console.log(
			"Fixture comparison plan is valid; runtime acceptance remains unfulfilled.",
		);
		return;
	}
	if (args.includes("--finalize")) {
		const artifactPath = option("--finalize");
		const result = JSON.parse(await readFile(artifactPath, "utf8"));
		if (
			result.planSha256 !== createHash("sha256").update(planBytes).digest("hex")
		)
			fail(
				"The plan changed after measurement; do not set budgets retrospectively.",
			);
		const backend = args.includes("--backend")
			? JSON.parse(await readFile(option("--backend"), "utf8"))
			: [];
		for (const sample of result.samples) {
			const evidence = backend.find(
				(entry) => entry.traceId === (sample.backendTraceId ?? sample.traceId),
			);
			const nativeComplete =
				plan.runtime.collectorProtocol !== collectorProtocol ||
				(result.runtime.collectorProtocol === collectorProtocol &&
					result.nativeRunCoverage?.complete === true &&
					["observer", "pg", "rows", "cache", "eventLoop"].every(
						(name) => evidence?.coverage?.[name] === true,
					) &&
					evidence?.coverage?.registration === true &&
					evidence.coverage.closed === true &&
					evidence.coverage.incomplete === false &&
					evidence.coverage.unattributedNativeSpans === 0 &&
					evidence.coverage.rejectedBatches === 0 &&
					evidence.coverage.lateSpans === 0 &&
					evidence.coverage.nativeProof === true);
			sample.backendCoverage = evidence?.coverage
				? Object.fromEntries(
						coverageNames.map((name) => {
							const value = evidence.coverage[name];
							return [
								name,
								typeof value === "boolean" ||
								(typeof value === "number" &&
									Number.isFinite(value) &&
									value >= 0)
									? value
									: null,
							];
						}),
					)
				: null;
			sample.backend = Object.fromEntries(
				backendMetrics.map((name) => [
					name,
					nativeComplete &&
					Number.isFinite(evidence?.[name]) &&
					evidence[name] >= 0
						? evidence[name]
						: null,
				]),
			);
		}
		result.missingMetrics = backendMetrics.filter((name) =>
			result.samples.some((sample) => sample.backend[name] === null),
		);
		result.gates = [];
		if (result.kind !== "benchmark")
			result.gates.push("Journey verification is not a controlled benchmark.");
		const releaseGates = [];
		if (plan.conditions.some((condition) => !budgetsRecorded(condition)))
			releaseGates.push("Release budgets have not been recorded.");
		if (!result.runtime?.buildVerified)
			result.gates.push("Fixture application build identity was not verified.");
		if (result.samples.length === 0)
			result.gates.push("Browser samples are missing.");
		if (result.samples.some((sample) => sample.failed))
			releaseGates.push("Observed failed browser journeys.");
		if (result.samples.some((sample) => sample.pendingScriptRequests > 0))
			releaseGates.push(
				"Script transfer was incomplete at usable-content readiness.",
			);
		if (
			result.samples.some(
				(sample) =>
					sample.mode === "mutation-refresh" && sample.restored !== true,
			)
		)
			result.gates.push("Mutation initial-state restoration is incomplete.");
		if (result.missingMetrics.length)
			result.gates.push("Correlated backend metric coverage is incomplete.");
		for (const condition of plan.conditions)
			for (const range of plan.ranges)
				for (const route of plan.routes.filter(
					(r) =>
						routeIncludes(r, condition) &&
						(!r.ranges || r.ranges.includes(range.name)),
				))
					for (const mode of modesFor(route)) {
						const cohort = result.samples.filter(
							(s) =>
								s.condition === condition.name &&
								s.range === range.name &&
								s.route === route.name &&
								s.mode === mode,
						);
						if (
							!result.summaries.some(
								(summary) =>
									summary.condition === condition.name &&
									summary.range === range.name &&
									summary.route === route.name &&
									summary.mode === mode,
							)
						)
							result.gates.push("A required cohort summary is missing.");
						if (
							new Set(cohort.map((s) => s.iteration)).size <
								samplesFor(plan, mode) ||
							cohort.some(
								(s) => !s.failed && !Number.isFinite(s.usableContentMs),
							)
						)
							result.gates.push(
								"A required planned cohort is missing or incomplete.",
							);
					}
		for (const summary of result.summaries) {
			const condition = plan.conditions.find(
				(c) => c.name === summary.condition,
			);
			if (summary.samples < samplesFor(plan, summary.mode))
				result.gates.push("A compared cohort is incomplete.");
			for (const [name, budget] of [
				["usableContentMs", "usableContentP95Ms"],
				["clockReadyMs", "clockReadyP95Ms"],
				["javascriptBytes", "javascriptP95Bytes"],
			]) {
				if (
					summary[name] &&
					Number.isFinite(condition.budgets?.[budget]) &&
					summary[name].p95 > condition.budgets[budget]
				)
					releaseGates.push(
						`Exceeded ${budget} for ${summary.condition}/${summary.route}/${summary.mode}/${summary.range}.`,
					);
			}
			const values = result.samples
				.filter(
					(s) =>
						s.condition === summary.condition &&
						s.range === summary.range &&
						s.route === summary.route &&
						s.mode === summary.mode,
				)
				.map((s) => s.backend.queryCount)
				.filter(Number.isFinite)
				.sort((a, b) => a - b);
			summary.queryCountP95 = values.length
				? values[Math.ceil(values.length * 0.95) - 1]
				: null;
			if (
				Number.isFinite(condition.budgets?.queryCountP95) &&
				summary.queryCountP95 > condition.budgets.queryCountP95
			)
				releaseGates.push(
					`Exceeded queryCountP95 for ${summary.condition}/${summary.route}/${summary.mode}/${summary.range}.`,
				);
		}
		// Even complete numerical evidence needs the exact fixture range and selector journeys verified by an operator.
		if (plan.fixture.journeysVerified !== true)
			result.gates.push(
				"Fixture range selection, mutation outcomes and readiness markers have not been verified.",
			);
		result.evidenceGates = [...new Set(result.gates)];
		result.evidenceComplete = result.evidenceGates.length === 0;
		result.releaseGates = [...new Set(releaseGates)];
		result.releaseAcceptance =
			result.evidenceComplete && releaseGates.length === 0
				? "passed"
				: "failed";
		if (plan.phase !== "baseline") result.gates.push(...releaseGates);
		result.acceptance =
			result.gates.length === 0
				? plan.phase === "baseline"
					? "baseline-recorded"
					: "fulfilled"
				: "unfulfilled";
		await writeFile(artifactPath, JSON.stringify(result, null, 2));
		console.log(`Baseline acceptance: ${result.acceptance}.`);
		process.exitCode = result.gates.length ? 1 : 0;
		return;
	}
	if (
		!args.includes("--auth") ||
		!args.includes("--out") ||
		!args.includes("--chrome")
	)
		fail(
			"Provide --auth, --out and --chrome. Auth belongs in a private fixture file.",
		);
	const auth = JSON.parse(await readFile(option("--auth"), "utf8"));
	if (
		plan.runtime.collectorProtocol === collectorProtocol &&
		!args.includes("--collector")
	)
		fail(
			"The v2 fixture protocol requires --collector with private control metadata.",
		);
	const out = option("--out");
	await mkdir(out, { recursive: true });
	const result = {
		schema: 1,
		acceptance: "unfulfilled",
		phase: plan.phase ?? "release",
		kind: args.includes("--verify-journeys")
			? "journey-verification"
			: "benchmark",
		planSha256: createHash("sha256").update(planBytes).digest("hex"),
		runtime: {
			mode: plan.runtime.mode,
			collectorProtocol: plan.runtime.collectorProtocol ?? null,
			traceTransport: plan.runtime.traceTransport ?? "page-interception-v1",
			browserPermissions: fixtureBrowserPermissions,
			build: plan.runtime.build,
			sourceBuild: plan.runtime.sourceBuild ?? null,
			buildWorkers: plan.runtime.buildWorkers ?? null,
			observer: plan.runtime.observer ?? null,
			redisCommandTimeoutMs: plan.runtime.redisCommandTimeoutMs ?? null,
			toolingBuild: plan.runtime.toolingBuild ?? null,
			poolMax: plan.runtime.poolMax ?? null,
			images: plan.runtime.images ?? [],
			node: process.version,
		},
		hardware: {
			platform: platform(),
			release: release(),
			cpu: cpus()[0]?.model,
			cores: cpus().length,
			memoryBytes: totalmem(),
		},
		browser: null,
		samples: [],
		summaries: [],
		missingMetrics: backendMetrics,
		limitations: [
			"Browser usable-content observations measure DOM readiness; they are not paint timings.",
			"Fresh-context first documents have cold browser storage, not necessarily cold server/runtime caches.",
			"LCP is browser-native for first documents. Largest observed event duration is reported separately; full page-lifetime INP is unavailable.",
			"Backend metrics require correlated request/transaction telemetry; browser observations do not substitute for them.",
			"Network counts and completed transfer sizes stop at usable-content and clock readiness; pending resource kinds are explicit, and priming/restoration requests are excluded.",
		],
	};
	try {
		const response = await fetch(new URL("/api/app-version", plan.origin), {
			signal: AbortSignal.timeout(10000),
		});
		const observed = (await response.json()).buildHash;
		result.runtime.observedBuild = /^[a-f0-9]{7,40}$/.test(observed ?? "")
			? observed
			: null;
		result.runtime.buildVerified =
			response.ok &&
			!!result.runtime.observedBuild &&
			plan.runtime.build.startsWith(result.runtime.observedBuild);
	} catch {
		result.runtime.observedBuild = null;
		result.runtime.buildVerified = false;
	}
	if (!result.runtime.buildVerified) {
		result.gates = [
			"Fixture application build identity is unavailable or mismatches the recorded source build.",
		];
		await writeFile(
			join(out, "baseline.json"),
			JSON.stringify(result, null, 2),
		);
		console.log(
			"Baseline acceptance: unfulfilled (application build identity).",
		);
		process.exitCode = 1;
		return;
	}
	const nativeBefore =
		plan.runtime.collectorProtocol === collectorProtocol
			? await readCollectorCounters(option("--collector"))
			: null;
	if (
		nativeBefore &&
		(nativeBefore.activeTraces !== 0 ||
			nativeBefore.started.queries !== nativeBefore.ended.queries)
	)
		fail(
			"Native work is already pending before capture; use a settled isolated fixture.",
		);
	const { default: puppeteer } = await import("puppeteer-core");
	const browser = await puppeteer.launch({
		executablePath: option("--chrome"),
		headless: true,
	});
	result.browser = await browser.version();
	let checkpoint = Promise.resolve();
	try {
		for (const condition of plan.conditions) {
			if (
				args.includes("--condition") &&
				condition.name !== option("--condition")
			)
				continue;
			for (const range of plan.ranges) {
				for (const route of plan.routes.filter(
					(r) =>
						routeIncludes(r, condition) &&
						(!r.ranges || r.ranges.includes(range.name)),
				)) {
					if (args.includes("--route") && route.name !== option("--route"))
						continue;
					for (const mode of modesFor(route)) {
						let index = 0;
						const concurrency =
							mode === "mutation-refresh"
								? (route.mutation.concurrency ?? plan.concurrency)
								: plan.concurrency;
						await Promise.all(
							Array.from({ length: concurrency }, async () => {
								while (
									index <
									(args.includes("--verify-journeys")
										? 1
										: samplesFor(plan, mode))
								) {
									const iteration = index++;
									const sample = await measure(
										browser,
										auth,
										plan,
										condition,
										range,
										route,
										mode,
										iteration,
										concurrency,
									);
									result.samples.push(sample);
									// Checkpoint contains numerical evidence and fixture labels only, never cookies, URLs or response bodies.
									checkpoint = checkpoint.then(() =>
										writeFile(
											join(out, "baseline.json"),
											JSON.stringify(result, null, 2),
										),
									);
									await checkpoint;
								}
							}),
						);
					}
				}
			}
		}
	} finally {
		await browser.close();
		if (nativeBefore) {
			try {
				result.nativeRunCoverage = await reconcileCollectorRun({
					control: option("--collector"),
					before: nativeBefore,
					traceIds: result.samples.flatMap((sample) => [
						sample.traceId,
						sample.prerequisiteTraceId,
						sample.backgroundTraceId,
					]),
				});
			} catch {
				result.nativeRunCoverage = { complete: false };
			}
		}
		for (const condition of plan.conditions)
			for (const range of plan.ranges)
				for (const route of plan.routes)
					for (const mode of modesFor(route)) {
						const samples = result.samples.filter(
							(s) =>
								s.condition === condition.name &&
								s.range === range.name &&
								s.route === route.name &&
								s.mode === mode,
						);
						if (!samples.length) continue;
						const metric = (name) => {
							const values = samples
								.map((s) => s[name])
								.filter(Number.isFinite)
								.sort((a, b) => a - b);
							return values.length
								? {
										count: values.length,
										p50:
											(values[Math.floor((values.length - 1) / 2)] +
												values[Math.ceil((values.length - 1) / 2)]) /
											2,
										p95: values[Math.ceil(values.length * 0.95) - 1],
										min: values[0],
										max: values.at(-1),
									}
								: null;
						};
						result.summaries.push({
							condition: condition.name,
							range: range.name,
							route: route.name,
							mode,
							concurrency: [
								...new Set(samples.map((sample) => sample.concurrency)),
							],
							samples: samples.length,
							failed: samples.filter((s) => s.failed).length,
							failureRate:
								samples.filter((s) => s.failed).length / samples.length,
							usableContentMs: samples.some((s) => s.failed)
								? null
								: metric("usableContentMs"),
							successfulUsableContentMs: metric("usableContentMs"),
							elapsedUntilFailureMs: metric("elapsedUntilFailureMs"),
							returnedFormReadyMs: metric("returnedFormReadyMs"),
							rangePreparationMs: metric("rangePreparationMs"),
							clockReadyMs: metric("clockReadyMs"),
							requests: metric("requests"),
							failedRequests: metric("failedRequests"),
							pendingScriptRequests: metric("pendingScriptRequests"),
							pendingRscRequests: metric("pendingRscRequests"),
							javascriptBytes: metric("javascriptBytes"),
							inlineRscDecodedBytes: metric("inlineRscDecodedBytes"),
							rscBytes: metric("rscBytes"),
							lcpMs: metric("lcpMs"),
							inpMs: null,
							interactionMaxMs: metric("interactionMaxMs"),
						});
					}
		await writeFile(
			join(out, "baseline.json"),
			JSON.stringify(result, null, 2),
		);
	}
	console.log(
		"Browser samples saved. Acceptance remains unfulfilled until backend telemetry, budgets and fixture journeys are verified.",
	);
	process.exitCode = 1;
}

async function measure(
	browser,
	auth,
	plan,
	condition,
	range,
	route,
	mode,
	iteration,
	concurrency,
) {
	const traceId = randomBytes(16).toString("hex");
	const prerequisiteTraceId = randomBytes(16).toString("hex");
	const backgroundTraceId = randomBytes(16).toString("hex");
	const observerVisit =
		plan.runtime.collectorProtocol === collectorProtocol
			? await beginCollectorVisit({
					control: option("--collector"),
					traceIds: [traceId, prerequisiteTraceId, backgroundTraceId],
				})
			: null;
	let context;
	let transport;
	const attemptStart = performance.now();
	const sample = {
		condition: condition.name,
		role: condition.role,
		organization: condition.organization,
		organizationSize: condition.employees,
		timezone: condition.timezone,
		locale: condition.locale,
		viewport: condition.viewport,
		concurrency,
		range: range.name,
		route: route.name,
		mode,
		iteration,
		traceId,
		prerequisiteTraceId,
		backgroundTraceId,
		backendTraceId: traceId,
		resourceScope: "measured-visit",
		censored: false,
		notApplicableBrowserMetrics: [],
		usableContentMs: null,
		clockReadyMs: null,
		lcpMs: null,
		inpMs: null,
		interactionMaxMs: null,
		requests: 0,
		failedRequests: 0,
		requestDurationMs: 0,
		javascriptBytes: 0,
		inlineRscDecodedBytes: null,
		rscBytes: 0,
		totalBytes: 0,
		browserCacheHits: 0,
		failed: false,
		failureStage: null,
		failureKind: null,
		elapsedUntilFailureMs: null,
		returnedFormReadyMs: null,
		returnPreparationUsed: false,
		resourceWindowComplete: null,
		resourceObservedUntilMs: null,
		rangePreparationMs: null,
		restored: mode === "mutation-refresh" ? false : null,
	};
	let page;
	let client;
	const pendingRequests = new Set();
	const requests = new Map();
	let requestTraceId = prerequisiteTraceId;
	let bindings;
	let measurementStart;
	let stage = "authentication-context";
	let mutationStarted = false;
	try {
		if (plan.runtime.traceTransport === fixtureTraceTransport)
			transport = await createFixtureTraceTransport({
				origin: plan.origin,
				getTraceId: () => requestTraceId,
			});
		context = await browser.createBrowserContext(
			transport?.browserContextOptions,
		);
		await prepareFixtureBrowserContext(context, plan.origin);
		if (!Array.isArray(auth[condition.name]?.cookies))
			fail("Missing private fixture authentication.");
		await context.setCookie(...auth[condition.name].cookies);
		page = await context.newPage();
		await page.setViewport(condition.viewport);
		await page.emulateTimezone(condition.timezone);
		await page.setExtraHTTPHeaders({ "Accept-Language": condition.locale });
		if (!transport) {
			await page.setRequestInterception(true);
			page.on("request", (request) =>
				request
					.continue(
						new URL(request.url()).origin === plan.origin
							? {
									headers: {
										...request.headers(),
										traceparent: `00-${requestTraceId}-${randomBytes(8).toString("hex")}-01`,
									},
								}
							: {},
					)
					.catch(() => {}),
			);
		}
		await page.evaluateOnNewDocument(() => {
			window.__z8Baseline = { lcp: null, inp: null };
			for (const type of ["largest-contentful-paint", "event"]) {
				try {
					new PerformanceObserver((list) => {
						for (const entry of list.getEntries()) {
							if (type === "event" && entry.interactionId)
								window.__z8Baseline.inp = Math.max(
									window.__z8Baseline.inp ?? 0,
									entry.duration,
								);
							else if (type === "largest-contentful-paint")
								window.__z8Baseline.lcp = entry.startTime;
						}
					}).observe(
						type === "event"
							? { type, buffered: true, durationThreshold: 16 }
							: { type, buffered: true },
					);
				} catch {
					/* unsupported entries stay null */
				}
			}
		});
		const path = route.path
			.replaceAll("{locale}", condition.locale)
			.replaceAll(
				"{employee}",
				route.target === "directory-target"
					? auth[condition.name].targetEmployeeId
					: auth[condition.name].employeeId,
			)
			.replaceAll("{start}", range.start)
			.replaceAll("{end}", range.end);
		const url = new URL(path, plan.origin).href;
		bindings = {
			origin: plan.origin,
			path,
			locale: condition.locale,
			employee:
				route.target === "directory-target"
					? auth[condition.name].targetEmployeeId
					: auth[condition.name].employeeId,
			employeeSearch: auth[condition.name].targetEmployeeSearch,
			start: range.start,
			end: range.end,
		};
		const verify = async () => {
			stage = "verify-expected-content";
			const hours = { month: 168, quarter: 512, year: 2088 }[range.name];
			if (route.result === "employee-report")
				await performSteps(
					page,
					[
						{ card: { title: "Total Work Hours", contains: `${hours}h` } },
						{
							card: {
								title: "Home Office Days",
								contains: `${{ month: 32, quarter: 96, year: 416 }[range.name]}h worked from home`,
							},
						},
					],
					bindings,
					plan.timeoutMs ?? 30000,
				);
			else if (route.result === "work-hours")
				await performSteps(
					page,
					[
						{
							table: {
								title: "Employee Work Hours",
								rows:
									route.expectedRowsByCondition?.[condition.name] ??
									condition.employees,
								column: 1,
								value: `${hours.toFixed(1)}h`,
							},
						},
					],
					bindings,
					plan.timeoutMs ?? 30000,
				);
			await performSteps(page, route.verify, bindings, plan.timeoutMs ?? 30000);
		};
		const prepare = async (verifyExpected = true) => {
			stage = "prepare-range";
			const started = performance.now();
			await performSteps(
				page,
				route.prepare,
				bindings,
				plan.timeoutMs ?? 30000,
			);
			if (route.rangeRecipe === "fixture-2025")
				await performSteps(
					page,
					historicalRangeSteps(range.name),
					bindings,
					plan.timeoutMs ?? 30000,
				);
			if (measurementStart !== undefined)
				sample.rangePreparationMs = performance.now() - started;
			if (route.result === "employee-report")
				await performSteps(
					page,
					[
						{
							clickText: { selector: "button", text: "Generate Report" },
							response: { path: "{path}", method: "POST" },
						},
					],
					bindings,
					plan.timeoutMs ?? 30000,
				);
			if (verifyExpected) await verify();
		};
		const ready = () =>
			page.waitForSelector(route.ready, {
				visible: true,
				timeout: plan.timeoutMs ?? 30000,
			});
		const link = async (selector) => {
			await clickVisible(
				page,
				selector
					.replaceAll("{locale}", condition.locale)
					.replaceAll("{employee}", bindings.employee),
				plan.timeoutMs ?? 30000,
			);
			await page.waitForFunction(
				(expected) => location.pathname + location.search === expected,
				{ timeout: plan.timeoutMs ?? 30000 },
				path,
			);
			await performSteps(
				page,
				route.navigationAfter,
				bindings,
				plan.timeoutMs ?? 30000,
			);
		};
		if (mode !== "first-document") {
			stage = "prime-route";
			await page.goto(url, { waitUntil: "domcontentloaded" });
			await prepare(false);
			await ready();
		}
		if (mode === "repeat-link" || mode === "return-visit") {
			stage = "prepare-away-navigation";
			await page.goto(
				new URL(
					(route.awayPath ?? plan.awayPath).replaceAll(
						"{locale}",
						condition.locale,
					),
					plan.origin,
				).href,
				{ waitUntil: "domcontentloaded" },
			);
			await performSteps(
				page,
				route.navigationSteps,
				bindings,
				plan.timeoutMs ?? 30000,
			);
			await waitVisible(
				page,
				route.link
					.replaceAll("{locale}", condition.locale)
					.replaceAll("{employee}", bindings.employee),
				plan.timeoutMs ?? 30000,
			);
		}
		client = await page.createCDPSession();
		await client.send("Network.enable");
		client.on("Network.requestWillBeSent", (event) => {
			if (measurementStart === undefined) return;
			sample.requests++;
			pendingRequests.add(event.requestId);
			requests.set(event.requestId, {
				start: event.timestamp,
				type: event.type,
			});
		});
		client.on("Network.responseReceived", (event) => {
			const request = requests.get(event.requestId);
			if (request) {
				request.type = event.type;
				request.rsc = event.response.mimeType?.includes("text/x-component");
			}
			if (event.response.fromDiskCache || event.response.fromServiceWorker)
				sample.browserCacheHits++;
		});
		client.on("Network.loadingFinished", (event) => {
			const request = requests.get(event.requestId);
			if (request) {
				pendingRequests.delete(event.requestId);
				sample.totalBytes += event.encodedDataLength;
				sample.requestDurationMs += (event.timestamp - request.start) * 1000;
				if (request.type === "Script")
					sample.javascriptBytes += event.encodedDataLength;
				if (request.rsc) sample.rscBytes += event.encodedDataLength;
			}
		});
		client.on("Network.loadingFailed", (event) => {
			if (requests.has(event.requestId)) {
				pendingRequests.delete(event.requestId);
				sample.failedRequests++;
			}
		});
		requestTraceId = traceId;
		const start = performance.now();
		measurementStart = start;
		stage = "navigate";
		const clock = route.clockReady
			? page
					.waitForSelector(route.clockReady, {
						visible: true,
						timeout: plan.timeoutMs ?? 30000,
					})
					.then(() => {
						sample.clockReadyMs = performance.now() - start;
						return sample.clockReadyMs;
					})
					.catch(() => null)
			: Promise.resolve(null);
		if (mode === "first-document") {
			await page.goto(url, { waitUntil: "domcontentloaded" });
			await prepare();
		} else if (mode === "repeat-link") {
			await link(route.link);
			await prepare();
		} else if (mode === "return-visit") {
			await page.goBack({ waitUntil: "domcontentloaded" });
			if (route.returnedFormReady) {
				await page.waitForSelector(route.returnedFormReady, {
					visible: true,
					timeout: plan.timeoutMs ?? 30000,
				});
				sample.returnedFormReadyMs = performance.now() - start;
			}
			if (route.returnPreparation) {
				sample.returnPreparationUsed = true;
				await prepare();
			}
		} else if (mode === "manual-refresh") {
			stage = "manual-refresh";
			if (route.refreshSteps)
				await performSteps(
					page,
					route.refreshSteps,
					bindings,
					plan.timeoutMs ?? 30000,
				);
			else {
				await performSteps(
					page,
					[
						{
							click: route.refresh,
							response: route.refreshResponse ?? {
								path: "{path}",
								method: "ANY",
							},
						},
					],
					bindings,
					plan.timeoutMs ?? 30000,
				);
				await page.waitForFunction(
					(css) => {
						const button = document.querySelector(css);
						return (
							button &&
							!button.disabled &&
							button.getAttribute("aria-busy") !== "true"
						);
					},
					{ timeout: plan.timeoutMs ?? 30000 },
					route.refresh,
				);
			}
		} else {
			stage = "mutation";
			mutationStarted = true;
			await performSteps(
				page,
				route.mutation.steps,
				bindings,
				plan.timeoutMs ?? 30000,
			);
			await page.waitForSelector(route.mutation.ready, {
				visible: true,
				timeout: plan.timeoutMs ?? 30000,
			});
		}
		if (mode !== "mutation-refresh") {
			await verify();
			await ready();
		}
		sample.usableContentMs = performance.now() - start;
		sample.notificationPermission = await page.evaluate(
			() => Notification.permission,
		);
		if (sample.notificationPermission !== "denied")
			fail("Fixture notification permission was not denied.");
		sample.clockReadyMs = await clock;
		const native = await page.evaluate(() => window.__z8Baseline);
		if (mode === "first-document")
			sample.inlineRscDecodedBytes = await page.evaluate(() =>
				[...document.scripts]
					.filter((script) => script.textContent.includes("__next_f"))
					.reduce(
						(bytes, script) =>
							bytes + new TextEncoder().encode(script.textContent).length,
						0,
					),
			);
		// Document LCP is not a soft-navigation metric. Event timing is an approximation (largest observed interaction), not a complete page-lifetime INP.
		if (mode === "first-document") sample.lcpMs = native?.lcp ?? null;
		sample.interactionMaxMs = native?.inp ?? null;
	} catch (error) {
		sample.failed = true;
		sample.notificationPermission =
			page && !page.isClosed()
				? await page.evaluate(() => Notification.permission).catch(() => null)
				: null;
		sample.failureStage = stage;
		sample.failureAction = error.fixtureAction ?? null;
		sample.failureReadiness = error.fixtureReadiness ?? null;
		sample.failureHeaderState = error.fixtureHeaderState ?? null;
		sample.failureStep = error.fixtureStep ?? null;
		sample.failureKind =
			error?.name === "TimeoutError" ? "timeout" : "journey-error";
		sample.elapsedUntilFailureMs =
			measurementStart === undefined
				? performance.now() - attemptStart
				: performance.now() - measurementStart;
		if (measurementStart === undefined) {
			sample.censored = true;
			sample.resourceScope = "prerequisite-failure";
			sample.backendTraceId = prerequisiteTraceId;
			sample.notApplicableBrowserMetrics = [
				"usableContentMs",
				"clockReadyMs",
				"lcpMs",
				"interactionMaxMs",
				"requests",
				"failedRequests",
				"requestDurationMs",
				"javascriptBytes",
				"inlineRscDecodedBytes",
				"rscBytes",
				"totalBytes",
				"browserCacheHits",
			];
			for (const name of [
				"requests",
				"failedRequests",
				"requestDurationMs",
				"javascriptBytes",
				"inlineRscDecodedBytes",
				"rscBytes",
				"totalBytes",
				"browserCacheHits",
			])
				sample[name] = null;
		}
	} finally {
		if (client && page && !page.isClosed() && measurementStart !== undefined) {
			sample.resourceWindowComplete = pendingRequests.size === 0;
			sample.resourcePendingRequests = pendingRequests.size;
			sample.pendingRequestsByType = {};
			sample.pendingScriptRequests = 0;
			sample.pendingRscRequests = 0;
			for (const requestId of pendingRequests) {
				const request = requests.get(requestId);
				const type = [
					"Document",
					"Script",
					"Stylesheet",
					"XHR",
					"Fetch",
					"EventSource",
					"WebSocket",
					"Image",
					"Font",
				].includes(request?.type)
					? request.type
					: "Other";
				sample.pendingRequestsByType[type] =
					(sample.pendingRequestsByType[type] ?? 0) + 1;
				if (type === "Script") sample.pendingScriptRequests++;
				if (request?.rsc) sample.pendingRscRequests++;
			}
			sample.resourceObservedUntilMs =
				measurementStart === undefined
					? null
					: performance.now() - measurementStart;
		}
		await client?.detach().catch(() => {});
		requestTraceId = backgroundTraceId;
		if (mutationStarted) {
			try {
				await performSteps(
					page,
					route.mutation.reset,
					bindings,
					plan.timeoutMs ?? 30000,
				);
				sample.restored = true;
			} catch {
				sample.failed = true;
				sample.failureStage = "restore-original-state";
				sample.failureKind = "restoration-error";
				sample.elapsedUntilFailureMs =
					measurementStart === undefined
						? null
						: performance.now() - measurementStart;
			}
		}
		await context?.close();
		if (observerVisit) {
			try {
				const observation = await endCollectorVisit(observerVisit);
				const evidence = observation.traces.find(
					(entry) => entry.traceId === sample.backendTraceId,
				);
				sample.collector = {
					protocol: observation.protocol,
					registered: true,
					closed: true,
					coverage: evidence?.coverage ?? null,
				};
				if (evidence?.coverage.incomplete !== false) {
					sample.failed = true;
					sample.failureStage = "native-coverage";
					sample.failureKind = "observation-incomplete";
				}
			} catch {
				sample.failed = true;
				sample.failureStage = "native-coverage";
				sample.failureKind = "observation-incomplete";
			}
		}
		if (transport) {
			sample.traceTransport = {
				kind: fixtureTraceTransport,
				...transport.snapshot(),
			};
			await transport.close();
		}
	}
	return sample;
}

main().catch((error) => {
	console.error(
		error instanceof SyntaxError
			? "Invalid fixture JSON."
			: error.code
				? "Fixture input/runtime unavailable."
				: error.message,
	);
	process.exitCode = 2;
});
