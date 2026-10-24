#!/usr/bin/env node
/** Finite single-app operator. Actual requests, cookies and protected results stay in RAM. */
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareFixtureBrowserContext, waitVisible } from "./journey-steps.mjs";
import { openPublicHeaderClock } from "./public-header-clock.mjs";

const timeout = 30000;
const analytics = [
	{ kind: "work", actor: "large-admin", path: "/en/analytics/work-hours" },
	{
		kind: "team",
		actor: "small-admin",
		path: "/en/analytics/team-performance",
	},
	{
		kind: "overtime",
		actor: "small-manager",
		path: "/en/analytics/overtime-burn-down",
	},
];
const clockActor = "large-manager";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const trace = () => randomBytes(16).toString("hex");
const traceparent = (id) => `00-${id}-${randomBytes(8).toString("hex")}-01`;
const json = async (path) => JSON.parse(await readFile(path, "utf8"));

function localOrigin(value) {
	const origin = new URL(value);
	if (
		origin.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
		origin.username ||
		origin.password ||
		origin.search ||
		origin.hash ||
		origin.pathname !== "/"
	)
		throw new Error("A loopback HTTP fixture origin is required.");
	return origin.origin;
}

async function readFixture(directory) {
	const runtime = await json(join(directory, "runtime-private.json"));
	const fixture = await json(join(directory, "fixture-private.json"));
	const origin = localOrigin(runtime.origin);
	const actors = [...analytics.map((reader) => reader.actor), clockActor];
	if (
		fixture.kind !== "disposable" ||
		!/^approval_workflow_repository_test_/.test(runtime.env?.POSTGRES_DB) ||
		Number(runtime.env?.POSTGRES_POOL_MAX) !== 10 ||
		actors.some((actor) => !fixture.actors?.[actor]?.employeeId) ||
		new Set(actors.map((actor) => fixture.actors[actor].employeeId)).size !== 4
	)
		throw new Error(
			"The unchanged disposable four-user fixture and pool 10 are required.",
		);
	return { runtime, fixture, origin };
}

function plan() {
	return {
		version: 1,
		topology: "single app",
		userConcurrency: 4,
		poolMax: 10,
		clockPairs: 20,
		clockActor,
		analyticsCallers: analytics.map(({ kind, actor }) => ({
			kind,
			actor,
			range: "annual 2025",
		})),
		analyticsMaxRequestsPerCallerPerCommand: 100,
		requestTimeoutMs: timeout,
		preparation:
			"actual annual UI requests complete before measured mixed work; caches may be warm",
		requestCapture: "actual UI action identifiers and bodies, RAM only",
		clockTransport: "actual browser header controls and their public requests",
		clockProtocol:
			"existing online legacy fixture; append-adopted fixtures are rejected before writes",
		unknownWrite:
			"stop, resolve authoritative UI state and clean up owned live work through the UI; never replay an unknown write",
	};
}

function publicResult(text) {
	try {
		return JSON.parse(text);
	} catch {}
	for (const line of text.split("\n")) {
		try {
			const value = JSON.parse(line.slice(line.indexOf(":") + 1));
			if (
				value &&
				(typeof value.success === "boolean" ||
					typeof value.isClockedIn === "boolean")
			)
				return value;
		} catch {}
	}
	return null;
}

function numericMetrics(row) {
	const names = [
		"queryCount",
		"queryDurationMs",
		"rowsRetrieved",
		"poolWaitMs",
		"cacheHits",
		"cacheMisses",
		"eventLoopDelayMs",
		"observedQueryErrors",
		"observedPoolAcquisitions",
		"observedPoolAcquisitionErrors",
	];
	return {
		...Object.fromEntries(
			names.map((name) => [
				name,
				Number.isFinite(row?.[name]) ? row[name] : null,
			]),
		),
		coverage: row?.coverage ?? null,
	};
}

async function collectMetrics(control, records) {
	const collected = new Map();
	const deadline = performance.now() + 10000;
	for (
		let attempt = 0;
		attempt < 20 && performance.now() < deadline;
		attempt++
	) {
		const response = await fetch(new URL("/metrics", control.endpoint), {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) throw new Error("Fixture telemetry unavailable.");
		const rows = new Map(
			(await response.json()).map((row) => [row.traceId, row]),
		);
		for (const { traceId } of records) {
			const row = rows.get(traceId);
			if (
				row?.coverage?.pg &&
				row.coverage.eventLoop &&
				row.coverage.rows &&
				row.poolWaitMs !== null
			)
				collected.set(traceId, numericMetrics(row));
		}
		if (records.every(({ traceId }) => collected.has(traceId))) break;
		await pause(250);
	}
	return collected;
}

function analyticsSummary(kind, payload) {
	if (payload?.success !== true) return { correct: false };
	const data = payload.data;
	if (kind === "work")
		return {
			employees: data.byEmployee.length,
			hours: data.summary.totalHours,
			correct:
				data.byEmployee.length === 200 && data.summary.totalHours === 417600,
		};
	if (kind === "team") {
		const employees = data.teams.reduce(
			(sum, team) => sum + team.employeeCount,
			0,
		);
		return {
			employees,
			hours: data.organizationTotal,
			correct: employees === 8 && data.organizationTotal === 16704,
		};
	}
	const hours = data.weeklySeries.reduce(
		(sum, week) => sum + week.overtimeHours,
		0,
	);
	return {
		weeks: data.weeklySeries.length,
		overtimeHours: hours,
		correct: hours === 0 && data.summary.currentOvertimeHours === 0,
	};
}

async function openPage(browser, auth, origin, actor) {
	const context = await browser.createBrowserContext();
	if (!Array.isArray(auth[actor]?.cookies))
		throw new Error("Fixture authentication is missing.");
	await context.setCookie(...auth[actor].cookies);
	await prepareFixtureBrowserContext(context, origin);
	const page = await context.newPage();
	await page.setViewport({ width: 1280, height: 900 });
	await page.emulateTimezone("Europe/Berlin");
	await page.setRequestInterception(true);
	return { context, page };
}

async function verifyActor(page, expected) {
	const result = await page.evaluate(async () => {
		const response = await fetch("/api/auth/get-session", {
			credentials: "same-origin",
			cache: "no-store",
			signal: AbortSignal.timeout(5000),
		});
		return response.ok ? response.json() : null;
	});
	if (
		!expected?.email ||
		result?.user?.email !== expected.email ||
		result?.session?.activeOrganizationId !== expected.organizationId ||
		result?.mfaRequired ||
		result?.ssoRequired
	)
		throw new Error(
			"Actual fixture identity does not match its assigned workload.",
		);
}

async function captureAnalytics(browser, auth, origin, reader, expectedActor) {
	const opened = await openPage(browser, auth, origin, reader.actor);
	const { page } = opened;
	let captured;
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.origin !== origin) {
			request.abort().catch(() => {});
			return;
		}
		const headers = request.headers(),
			body = request.postData();
		if (
			request.method() === "POST" &&
			headers["next-action"] &&
			body?.includes("2025-01-01") &&
			url.pathname === reader.path
		)
			captured = {
				path: url.pathname,
				body,
				headers: Object.fromEntries(
					["next-action", "next-router-state-tree", "content-type", "accept"]
						.filter((key) => headers[key])
						.map((key) => [key, headers[key]]),
				),
			};
		request.continue().catch(() => {});
	});
	await page.goto(origin + reader.path, {
		waitUntil: "domcontentloaded",
		timeout,
	});
	await verifyActor(page, expectedActor);
	await (
		await waitVisible(page, 'button[aria-label="Period"]', timeout)
	).click();
	await page.waitForSelector('[role="option"]', { timeout });
	const response = page.waitForResponse(
		(value) =>
			value.request().headers()["next-action"] &&
			value.request().postData()?.includes("2025-01-01") &&
			new URL(value.url()).pathname === reader.path,
		{ timeout },
	);
	response.catch(() => {});
	let selected = false;
	for (const option of await page.$$('[role="option"]'))
		if (
			await option.evaluate((node) => node.textContent.trim() === "Last Year")
		) {
			await option.click();
			selected = true;
			break;
		}
	if (!selected)
		throw new Error("Actual public annual period option unavailable.");
	const annual = await response;
	const payload = publicResult(await annual.text());
	if (
		!annual.ok() ||
		!captured ||
		!analyticsSummary(reader.kind, payload).correct
	)
		throw new Error(
			"Actual annual caller did not complete with the literal fixture totals.",
		);
	return { ...opened, captured, reader };
}

function clockCohorts(records) {
	return Object.fromEntries(
		["in", "out"].map((action) => {
			const cohort = records.filter(
				(record) => record.family === "clock" && record.action === action,
			);
			const times = cohort
				.filter((record) => record.success)
				.map((record) => record.clockReadyMs)
				.sort((a, b) => a - b);
			const percentile = (fraction) =>
				times.length ? times[Math.ceil(times.length * fraction) - 1] : null;
			return [
				action,
				{
					attempted: cohort.length,
					completed: times.length,
					failed: cohort.filter((record) => !record.success).length,
					censored: cohort.filter((record) => record.censored).length,
					completedP50Ms: percentile(0.5),
					completedP95Ms: percentile(0.95),
					completeCohortP95Ms:
						cohort.length === 20 && cohort.every((record) => record.success)
							? percentile(0.95)
							: null,
				},
			];
		}),
	);
}

async function run(directory, artifactApp, sourceCommit, collectorPath, runId) {
	const { origin, fixture } = await readFixture(directory);
	const auth = await json(join(directory, "auth-private.json"));
	const control = await json(
		collectorPath || join(directory, "observer-v2/collector-control.json"),
	);
	const collector = new URL(control.endpoint);
	localOrigin(collector.origin);
	if (
		collector.pathname !== "/v1/traces" ||
		collector.search ||
		collector.hash ||
		collector.username ||
		collector.password
	)
		throw new Error("Actual loopback fixture collector required.");
	const buildId = (
		await readFile(join(artifactApp, ".next/BUILD_ID"), "utf8")
	).trim();
	if (!/^[a-f0-9]{9,40}$/.test(sourceCommit) || !buildId)
		throw new Error(
			"Actual source commit and compiled build identity are required.",
		);
	const versionResponse = await fetch(new URL("/api/app-version", origin), {
		signal: AbortSignal.timeout(5000),
	});
	const liveVersion = versionResponse.ok
		? (await versionResponse.json()).buildHash
		: null;
	if (
		typeof liveVersion !== "string" ||
		!/^[a-f0-9]{9,40}$/.test(liveVersion) ||
		!(
			sourceCommit.startsWith(liveVersion) ||
			liveVersion.startsWith(sourceCommit)
		)
	)
		throw new Error(
			"The live app source identity does not match the operator pin.",
		);
	const require = createRequire(join(artifactApp, "package.json"));
	const browser = await require("puppeteer-core").launch({
		executablePath:
			process.env.Z8_FIXTURE_CHROME ||
			"C:/Program Files/Google/Chrome/Application/chrome.exe",
		headless: true,
	});
	const records = [];
	const measuredBackend = new Map();
	const activeTraces = new Set(),
		activeRequests = new Set();
	let ownedLive = false,
		clock,
		controls,
		uiTrace = trace(),
		analyticsActive = 0,
		userMaxInflight = 0,
		commandActive = 0;
	let unknownOutstanding = false;
	let stopped = false,
		cleanupRequired = false,
		stage = "capture",
		failureStage = null,
		pairsCompleted = 0,
		cleanupOwned;
	const tally = () => {
		userMaxInflight = Math.max(
			userMaxInflight,
			analyticsActive + commandActive,
		);
	};
	try {
		const readers = [];
		for (const reader of analytics) {
			const opened = await captureAnalytics(
				browser,
				auth,
				origin,
				reader,
				fixture.actors[reader.actor],
			);
			opened.page.on("request", (request) => {
				const requestTrace = request.headers().traceparent?.split("-")[1];
				if (activeTraces.has(requestTrace)) {
					activeRequests.add(request);
					analyticsActive = activeRequests.size;
					tally();
				}
			});
			const finish = (request) => {
				activeRequests.delete(request);
				analyticsActive = activeRequests.size;
			};
			opened.page.on("requestfinished", finish);
			opened.page.on("requestfailed", finish);
			readers.push(opened);
		}
		clock = await openPage(browser, auth, origin, clockActor);
		clock.page.on("request", (request) => {
			if (new URL(request.url()).origin !== origin) {
				request.abort().catch(() => {});
				return;
			}
			request
				.continue({
					headers: { ...request.headers(), traceparent: traceparent(uiTrace) },
				})
				.catch(() => {});
		});
		controls = await openPublicHeaderClock(clock.page, {
			origin,
			expectedActor: fixture.actors[clockActor],
		});
		stage = "commands";

		async function command(action, pair, cleanup = false) {
			const recordStart = records.length;
			const id = trace();
			uiTrace = id;
			const preparationStart = performance.now();
			let prepared;
			try {
				prepared = await controls.prepare(action);
			} catch {
				records.push({
					family: cleanup ? "cleanup" : "clock",
					action,
					pair,
					traceId: id,
					success: false,
					censored: true,
					unknownCommandOutcome: false,
					failureStage: "prepare",
					elapsedUntilFailureMs: performance.now() - preparationStart,
					clockReadyMs: null,
				});
				throw new Error("A header preparation prerequisite failed.");
			}
			const headerPrepareMs = performance.now() - preparationStart;
			let done = false,
				overlap = null;
			const workers = cleanup
				? []
				: readers.map(async ({ page, captured, reader }) => {
						for (let index = 0; index < 100 && !done; index++) {
							const requestId = trace(),
								started = performance.now();
							activeTraces.add(requestId);
							let observation;
							try {
								const result = await page.evaluate(
									async (input) => {
										const response = await fetch(input.path, {
											method: "POST",
											headers: input.headers,
											body: input.body,
											credentials: "same-origin",
											signal: AbortSignal.timeout(30000),
										});
										return {
											status: response.status,
											text: await response.text(),
										};
									},
									{
										...captured,
										headers: {
											...captured.headers,
											traceparent: traceparent(requestId),
										},
									},
								);
								const payload = publicResult(result.text);
								const summary = analyticsSummary(reader.kind, payload);
								observation = {
									success: result.status === 200 && summary.correct,
									httpStatus: result.status,
									bytes: Buffer.byteLength(result.text),
									summary,
									censored: false,
								};
							} catch {
								observation = {
									success: false,
									httpStatus: null,
									bytes: null,
									censored: true,
								};
							} finally {
								activeTraces.delete(requestId);
							}
							records.push({
								family: "analytics",
								kind: reader.kind,
								actor: reader.actor,
								pair,
								action,
								traceId: requestId,
								elapsedMs: performance.now() - started,
								...observation,
							});
							if (!observation.success) {
								stopped = true;
								done = true;
								failureStage ||= "analytics";
							}
						}
						return !done;
					});
			const started = performance.now();
			let result;
			const observe = (request) => {
				if (
					["/api/time-clock", "/api/time-entries/commands"].includes(
						new URL(request.url()).pathname,
					) &&
					request.method() === "POST"
				) {
					overlap = analyticsActive;
					commandActive++;
					tally();
					if (action === "in") ownedLive = true;
				}
			};
			clock.page.on("request", observe);
			try {
				result = await prepared.submit();
				if (result.unknownCommandOutcome) unknownOutstanding = true;
				if (!result.success) {
					stopped = true;
					failureStage ||= cleanup ? "cleanup" : "commands";
				} else if (action === "out") {
					ownedLive = false;
					unknownOutstanding = false;
				}
			} finally {
				done = true;
				commandActive = 0;
				clock.page.off("request", observe);
				const completedWorkers = await Promise.allSettled(workers);
				if (
					completedWorkers.some(
						(worker) => worker.status === "fulfilled" && worker.value,
					)
				) {
					stopped = true;
					failureStage ||= "analytics-request-bound";
				}
			}
			records.push({
				family: cleanup ? "cleanup" : "clock",
				action,
				pair,
				traceId: id,
				headerPrepareMs,
				workloadWindowMs: performance.now() - started,
				analyticsInflightAtCommandStart: overlap,
				...result,
			});
			if (!cleanup && overlap === 0) {
				stopped = true;
				failureStage ||= "mixed-load-overlap";
			}
			// Flush per-command evidence before the collector's finite trace-retention window.
			const stepMetrics = await collectMetrics(
				control,
				records.slice(recordStart),
			).catch(() => new Map());
			for (const [traceId, metric] of stepMetrics)
				measuredBackend.set(traceId, metric);
			return result.success;
		}

		cleanupOwned = async () => {
			stage = "resolve-and-cleanup";
			const state = await controls.resolveState();
			if (state === "in")
				cleanupRequired = !(await command("out", pairsCompleted + 1, true));
			else cleanupRequired = state !== "out" || unknownOutstanding;
		};
		for (let pair = 1; pair <= 20 && !stopped; pair++) {
			if (!(await command("in", pair)) || stopped) break;
			if (!(await command("out", pair)) || stopped) break;
			pairsCompleted++;
		}
	} catch {
		stopped = true;
		failureStage ||= stage;
		cleanupRequired ||= ownedLive;
	} finally {
		if (ownedLive && cleanupOwned)
			await cleanupOwned().catch(() => {
				cleanupRequired = true;
			});
		controls?.dispose();
		await browser.close();
	}
	const metrics = await collectMetrics(
		control,
		records.filter((record) => !measuredBackend.has(record.traceId)),
	).catch(() => new Map());
	for (const [traceId, metric] of metrics) measuredBackend.set(traceId, metric);
	for (const record of records)
		record.backend =
			measuredBackend.get(record.traceId) ?? numericMetrics(null);
	if (userMaxInflight !== 4) {
		stopped = true;
		failureStage ||= "mixed-load-concurrency";
	}
	const completeCoverage =
		records.length > 0 &&
		records.every(
			(record) =>
				record.backend.coverage?.pg &&
				record.backend.coverage?.rows &&
				record.backend.coverage?.cache &&
				record.backend.coverage?.eventLoop &&
				record.backend.poolWaitMs !== null,
		);
	const report = {
		...plan(),
		runId,
		sourceCommit,
		liveVersion,
		buildId,
		pairsCompleted,
		userMaxInflight,
		success:
			!stopped && !cleanupRequired && pairsCompleted === 20 && completeCoverage,
		stopped,
		failureStage,
		cleanupRequired,
		unknownOutstanding,
		completeCoverage,
		cohorts: clockCohorts(records),
		performanceBudgetsEvaluated: false,
		cpuRss: {
			available: false,
			reason: "No single-app process sampler configured; no zero substituted.",
		},
		records,
	};
	await writeFile(
		join(directory, `mixed-load-${runId}.json`),
		JSON.stringify(report, null, 2),
		{ flag: "wx", mode: 0o600 },
	);
	console.log(
		JSON.stringify({
			runId,
			success: report.success,
			pairsCompleted,
			observations: records.length,
			cleanupRequired,
			completeCoverage,
		}),
	);
	if (!report.success) process.exitCode = 1;
}

async function main() {
	const [command, inputDirectory, artifactApp, sourceCommit, ...flags] =
		process.argv.slice(2);
	if (!inputDirectory || !["plan", "run"].includes(command))
		throw new Error(
			"Use mixed-load-probe plan <private-directory> or run <private-directory> <artifact-app> <source-commit> --allow-fixture-writes.",
		);
	const directory = resolve(inputDirectory);
	await readFixture(directory);
	if (command === "plan") {
		console.log(JSON.stringify(plan()));
		return;
	}
	if (!artifactApp || !flags.includes("--allow-fixture-writes"))
		throw new Error(
			"Explicit disposable fixture writes and the compiled artifact are required.",
		);
	const collectorIndex = flags.indexOf("--collector");
	if (collectorIndex >= 0 && !flags[collectorIndex + 1])
		throw new Error("Collector control path missing.");
	const runId = trace();
	try {
		await run(
			directory,
			resolve(artifactApp),
			sourceCommit,
			collectorIndex >= 0 ? resolve(flags[collectorIndex + 1]) : undefined,
			runId,
		);
	} catch {
		await writeFile(
			join(directory, `mixed-load-${runId}.json`),
			JSON.stringify(
				{
					...plan(),
					runId,
					sourceCommit: /^[a-f0-9]{9,40}$/.test(sourceCommit ?? "")
						? sourceCommit
						: null,
					success: false,
					failureStage: "preflight",
					pairsCompleted: 0,
					censored: true,
					completeCoverage: false,
					performanceBudgetsEvaluated: false,
					records: [],
				},
				null,
				2,
			),
			{ flag: "wx", mode: 0o600 },
		);
		throw new Error(
			"The mixed workload prerequisite failed; numerical failure retained.",
		);
	}
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main().catch(() => {
		console.error(
			"Mixed-load operator failed; protected requests and fixture data were not exported.",
		);
		process.exitCode = 1;
	});
