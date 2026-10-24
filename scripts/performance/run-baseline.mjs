#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const fail = (message) => {
	throw new Error(message);
};
const backendMetrics = [
	"queryCount",
	"queryDurationMs",
	"rowsRetrieved",
	"poolWaitMs",
	"cacheHits",
	"cacheMisses",
	"eventLoopDelayMs",
];

function validate(plan) {
	if (!Number.isInteger(plan.samples) || plan.samples < 20)
		fail("Use at least twenty samples per condition and visit mode.");
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
		if (
			!condition.budgets ||
			![
				"usableContentP95Ms",
				"clockReadyP95Ms",
				"javascriptP95Bytes",
				"queryCountP95",
			].every(
				(name) =>
					Number.isFinite(condition.budgets[name]) &&
					condition.budgets[name] >= 0,
			)
		)
			fail("Record numerical budgets before running the comparison.");
	}
	if (
		!["month", "quarter", "year"].every((range) =>
			plan.ranges?.some((r) => r.name === range),
		)
	)
		fail("Include month, quarter and year ranges.");
	for (const route of plan.routes) {
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
			!route.refresh ||
			!route.mutation?.steps?.length ||
			!route.mutation?.ready
		)
			fail(
				"Each route needs explicit readiness, Link, refresh and fixture mutation observations.",
			);
	}
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
	const plan = validate(JSON.parse(planBytes));
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
				(entry) => entry.traceId === sample.traceId,
			);
			sample.backend = Object.fromEntries(
				backendMetrics.map((name) => [
					name,
					Number.isFinite(evidence?.[name]) && evidence[name] >= 0
						? evidence[name]
						: null,
				]),
			);
		}
		result.missingMetrics = backendMetrics.filter((name) =>
			result.samples.some((sample) => sample.backend[name] === null),
		);
		result.gates = [];
		if (!result.runtime?.buildVerified)
			result.gates.push("Fixture application build identity was not verified.");
		if (
			result.samples.length === 0 ||
			result.samples.some((sample) => sample.failed)
		)
			result.gates.push("Missing or failed browser journeys.");
		if (result.missingMetrics.length)
			result.gates.push("Correlated backend metric coverage is incomplete.");
		for (const condition of plan.conditions)
			for (const range of plan.ranges)
				for (const route of plan.routes.filter(
					(r) =>
						(!r.roles || r.roles.includes(condition.role)) &&
						(!r.ranges || r.ranges.includes(range.name)),
				))
					for (const mode of [
						"first-document",
						"repeat-link",
						"return-visit",
						"manual-refresh",
						"mutation-refresh",
					]) {
						const cohort = result.samples.filter(
							(s) =>
								s.condition === condition.name &&
								s.range === range.name &&
								s.route === route.name &&
								s.mode === mode,
						);
						if (
							new Set(cohort.map((s) => s.iteration)).size < plan.samples ||
							cohort.some((s) => !Number.isFinite(s.usableContentMs))
						)
							result.gates.push(
								"A required planned cohort is missing or incomplete.",
							);
					}
		for (const summary of result.summaries) {
			const condition = plan.conditions.find(
				(c) => c.name === summary.condition,
			);
			if (summary.samples < plan.samples || summary.failed)
				result.gates.push("A compared cohort is incomplete.");
			for (const [name, budget] of [
				["usableContentMs", "usableContentP95Ms"],
				["clockReadyMs", "clockReadyP95Ms"],
				["javascriptBytes", "javascriptP95Bytes"],
			]) {
				if (summary[name] && summary[name].p95 > condition.budgets[budget])
					result.gates.push(
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
			if (summary.queryCountP95 > condition.budgets.queryCountP95)
				result.gates.push(
					`Exceeded queryCountP95 for ${summary.condition}/${summary.route}/${summary.mode}/${summary.range}.`,
				);
		}
		// Even complete numerical evidence needs the exact fixture range and selector journeys verified by an operator.
		if (plan.fixture.journeysVerified !== true)
			result.gates.push(
				"Fixture range selection, mutation outcomes and readiness markers have not been verified.",
			);
		result.acceptance = result.gates.length === 0 ? "fulfilled" : "unfulfilled";
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
	const out = option("--out");
	await mkdir(out, { recursive: true });
	const result = {
		schema: 1,
		acceptance: "unfulfilled",
		planSha256: createHash("sha256").update(planBytes).digest("hex"),
		runtime: {
			mode: plan.runtime.mode,
			build: plan.runtime.build,
			sourceBuild: plan.runtime.sourceBuild ?? null,
			buildWorkers: plan.runtime.buildWorkers ?? null,
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
			"Network counts and transfer sizes stop at observed usable content and clock readiness; later work is outside this measurement window.",
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
	const { default: puppeteer } = await import("puppeteer-core");
	const browser = await puppeteer.launch({
		executablePath: option("--chrome"),
		headless: true,
	});
	result.browser = await browser.version();
	try {
		for (const condition of plan.conditions) {
			for (const range of plan.ranges) {
				for (const route of plan.routes.filter(
					(r) =>
						(!r.roles || r.roles.includes(condition.role)) &&
						(!r.ranges || r.ranges.includes(range.name)),
				)) {
					for (const mode of [
						"first-document",
						"repeat-link",
						"return-visit",
						"manual-refresh",
						"mutation-refresh",
					]) {
						let index = 0;
						await Promise.all(
							Array.from({ length: plan.concurrency }, async () => {
								while (index < plan.samples) {
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
									);
									result.samples.push(sample);
									// Checkpoint contains numerical evidence and fixture labels only, never cookies, URLs or response bodies.
									await writeFile(
										join(out, "baseline.json"),
										JSON.stringify(result, null, 2),
									);
								}
							}),
						);
					}
				}
			}
		}
	} finally {
		await browser.close();
		for (const condition of plan.conditions)
			for (const range of plan.ranges)
				for (const route of plan.routes)
					for (const mode of [
						"first-document",
						"repeat-link",
						"return-visit",
						"manual-refresh",
						"mutation-refresh",
					]) {
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
							samples: samples.length,
							failed: samples.filter((s) => s.failed).length,
							usableContentMs: metric("usableContentMs"),
							clockReadyMs: metric("clockReadyMs"),
							requests: metric("requests"),
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
) {
	const context = await browser.createBrowserContext();
	const traceId = randomBytes(16).toString("hex");
	const sample = {
		condition: condition.name,
		role: condition.role,
		organization: condition.organization,
		organizationSize: condition.employees,
		timezone: condition.timezone,
		locale: condition.locale,
		viewport: condition.viewport,
		concurrency: plan.concurrency,
		range: range.name,
		route: route.name,
		mode,
		iteration,
		traceId,
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
	};
	try {
		if (!Array.isArray(auth[condition.name]?.cookies))
			fail("Missing private fixture authentication.");
		await context.setCookie(...auth[condition.name].cookies);
		const page = await context.newPage();
		await page.setViewport(condition.viewport);
		await page.emulateTimezone(condition.timezone);
		await page.setExtraHTTPHeaders({ "Accept-Language": condition.locale });
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
			.replaceAll("{employee}", auth[condition.name].employeeId)
			.replaceAll("{start}", range.start)
			.replaceAll("{end}", range.end);
		const url = new URL(path, plan.origin).href;
		const ready = () =>
			page.waitForSelector(route.ready, {
				visible: true,
				timeout: plan.timeoutMs ?? 30000,
			});
		const link = async (selector) => {
			for (const prerequisite of route.navigationSteps ?? [])
				await page.click(prerequisite);
			await page.click(
				selector
					.replaceAll("{locale}", condition.locale)
					.replaceAll("{employee}", auth[condition.name].employeeId),
			);
			await page.waitForFunction(
				(expected) => location.pathname + location.search === expected,
				{ timeout: plan.timeoutMs ?? 30000 },
				path,
			);
		};
		if (mode !== "first-document") {
			await page.goto(url, { waitUntil: "domcontentloaded" });
			await ready();
		}
		if (mode === "repeat-link" || mode === "return-visit") {
			await page.goto(
				new URL(
					plan.awayPath.replaceAll("{locale}", condition.locale),
					plan.origin,
				).href,
				{ waitUntil: "domcontentloaded" },
			);
			await page.waitForSelector(
				route.link
					.replaceAll("{locale}", condition.locale)
					.replaceAll("{employee}", auth[condition.name].employeeId),
				{ timeout: plan.timeoutMs ?? 30000 },
			);
		}
		const client = await page.createCDPSession();
		await client.send("Network.enable");
		const requests = new Map();
		client.on("Network.requestWillBeSent", (event) => {
			sample.requests++;
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
			sample.totalBytes += event.encodedDataLength;
			if (request) {
				sample.requestDurationMs += (event.timestamp - request.start) * 1000;
				if (request.type === "Script")
					sample.javascriptBytes += event.encodedDataLength;
				if (request.rsc) sample.rscBytes += event.encodedDataLength;
			}
		});
		client.on("Network.loadingFailed", () => sample.failedRequests++);
		await page.setRequestInterception(true);
		page.on("request", (request) =>
			request
				.continue(
					new URL(request.url()).origin === plan.origin
						? {
								headers: {
									...request.headers(),
									traceparent: `00-${traceId}-${randomBytes(8).toString("hex")}-01`,
								},
							}
						: {},
				)
				.catch(() => {}),
		);
		const start = performance.now();
		const clock = route.clockReady
			? page
					.waitForSelector(route.clockReady, {
						visible: true,
						timeout: plan.timeoutMs ?? 30000,
					})
					.then(() => performance.now() - start)
					.catch(() => null)
			: Promise.resolve(null);
		if (mode === "first-document")
			await page.goto(url, { waitUntil: "domcontentloaded" });
		else if (mode === "repeat-link") await link(route.link);
		else if (mode === "return-visit")
			await page.goBack({ waitUntil: "domcontentloaded" });
		else if (mode === "manual-refresh") {
			await page.click(route.refresh);
			await page.waitForSelector(`${route.refresh}[aria-busy="true"]`, {
				timeout: plan.timeoutMs ?? 30000,
			});
			await page.waitForSelector(`${route.refresh}[aria-busy="false"]`, {
				timeout: plan.timeoutMs ?? 30000,
			});
		} else {
			for (const step of route.mutation.steps) {
				if (step.click) await page.click(step.click);
				else if (step.type) await page.type(step.type, step.value);
				else fail("Unsupported fixture mutation step.");
			}
			await page.waitForSelector(route.mutation.ready, {
				visible: true,
				timeout: plan.timeoutMs ?? 30000,
			});
		}
		await ready();
		sample.usableContentMs = performance.now() - start;
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
		await client.detach();
	} catch {
		sample.failed = true;
	} finally {
		await context.close();
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
