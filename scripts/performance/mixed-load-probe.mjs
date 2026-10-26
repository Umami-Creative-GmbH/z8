#!/usr/bin/env node
/** Finite single-app operator. Actual requests, cookies and protected results stay in RAM. */
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectorProtocol } from "./collector-client.mjs";
import {
	fixtureBrowserPolicy,
	initializeFixtureBrowserContext,
	launchFixtureBrowser,
} from "./fixture-browser.mjs";
import {
	prepareFixtureBrowserContext,
	selectPeriodPreset,
} from "./journey-steps.mjs";
import {
	beginMixedObservation,
	clockObservationIsComplete,
	createMixedTracePlan,
	finishMixedObservation,
	mixedTransportIsComplete,
	runMixedReader,
	settleMixedTransports,
} from "./mixed-load-observation.mjs";
import { openPublicHeaderClock } from "./public-header-clock.mjs";
import {
	createFixtureTraceTransport,
	fixtureTraceTransport,
} from "./trace-transport.mjs";

import { cleanApplicationEvidence, cleanObservationPolicy, observationTimeoutMs, cleanBrowserContextEvidence, cleanEvidencePolicy } from "./clean-evidence.mjs";
import { installBrowserControlCollector, readBrowserControlBinding, verifyBrowserControlBrowser, mixedBrowserWorkScope } from "./browser-control-collector.mjs";

/** Match the recorded source against the public, possibly abbreviated build hash. */
export function mixedSourceMatches(sourceCommit, liveVersion) {
	return (
		typeof sourceCommit === "string" &&
		/^[a-f0-9]{9,40}$/.test(sourceCommit) &&
		typeof liveVersion === "string" &&
		/^[a-f0-9]{7,40}$/.test(liveVersion) &&
		sourceCommit.startsWith(liveVersion)
	);
}
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
		Number(runtime.env?.POSTGRES_POOL_ACQUISITION_TIMEOUT_MS) !== cleanObservationPolicy.sharedPoolAcquisitionTimeoutMs ||
		actors.some((actor) => !fixture.actors?.[actor]?.employeeId) ||
		new Set(actors.map((actor) => fixture.actors[actor].employeeId)).size !== 4
	)
		throw new Error(
			"The unchanged disposable four-user fixture and pool 10 are required.",
		);
	return { runtime, fixture, origin };
}

function plan(phase) {
	return {
		version: 2,
		cleanEvidencePolicy,
		browserFailureScope: mixedBrowserWorkScope,
		phase,
		topology: "single app",
		collectorProtocol,
		traceTransport: fixtureTraceTransport,
		browserPolicy: fixtureBrowserPolicy,
		semanticTraceIdentities: 56,
		activeRegistrationLimit: 64,
		retainedIdentityLimit: 10000,
		analyticsGrouping:
			"three reader groups per five clock pairs; numerical backend groups counted once",
		telemetryDrain:
			"once after all commands, browser shutdown and finite wire drain; never between reads",
		userConcurrency: 4,
		poolMax: 10,
		poolAcquisitionTimeoutMs: cleanObservationPolicy.sharedPoolAcquisitionTimeoutMs,
		clockPairs: 20,
		clockActor,
		analyticsCallers: analytics.map(({ kind, actor }) => ({
			kind,
			actor,
			range: "annual 2025",
		})),
		analyticsMaxRequestsPerCallerPerCommand: 100,
		requestTimeoutMs: observationTimeoutMs(phase),
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
		"observedQueryCount",
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

async function openPage(browser, auth, origin, actor, traceSource, created, browserControlBinding) {
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: ({ headers }) => {
			const requested = headers.traceparent?.split("-")[1];
			if (requested && !traceSource.ids.includes(requested))
				throw Error("Unregistered mixed request identity");
			return requested ?? traceSource.current();
		},
	});
	let context;
	try {
		context = await browser.createBrowserContext(
			transport.browserContextOptions,
		);
		const { page, browserInitialization } =
			await initializeFixtureBrowserContext({ context, transport });
		const contextId = traceSource.current();
		const opened = { context, page, transport, browserInitialization, actor, contextId };
		created(opened);
		if (!Array.isArray(auth[actor]?.cookies))
			throw Error("Fixture authentication is missing");
		await context.setCookie(...auth[actor].cookies);
		await prepareFixtureBrowserContext(context, origin);
		await page.setViewport({ width: 1280, height: 900 });
		await page.emulateTimezone("Europe/Berlin");
		opened.browserObservation = await installBrowserControlCollector({ page, context, transport, origin, headers: {}, contextId,
			browserRevision: browserControlBinding.browserRevision, compiledCachedNavigations: browserControlBinding.compiledCachedNavigations,
			captureContextFailures: true });
		opened.browserObservation.beginMeasurement();
		return opened;
	} catch (error) {
		await context?.close().catch(() => {});
		await transport.close();
		throw error;
	}
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

/** Register the annual caller before its keyboard UI commit, outside the mixed clock workload. */
export async function selectAnnualAnalyticsPeriod(page, path, timeout = 30000) {
	const response = page.waitForResponse(
		(value) =>
			value.request().headers()["next-action"] &&
			value.request().postData()?.includes("2025-01-01") &&
			new URL(value.url()).pathname === path,
		{ timeout },
	);
	response.catch(() => {});
	await selectPeriodPreset(page, "Last Year", timeout);
	return response;
}

async function captureAnalytics(
	browser,
	auth,
	origin,
	reader,
	expectedActor,
	traceSource,
	created,
	timeout,
	browserControlBinding,
) {
	const opened = await openPage(
		browser,
		auth,
		origin,
		reader.actor,
		traceSource,
		created,
		browserControlBinding,
	);
	const { page } = opened;
	let captured;
	page.on("request", (request) => {
		const url = new URL(request.url());
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
	});
	await page.goto(origin + reader.path, {
		waitUntil: "domcontentloaded",
		timeout,
	});
	await verifyActor(page, expectedActor);
	const annual = await selectAnnualAnalyticsPeriod(page, reader.path, timeout);
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

async function run(directory, artifactApp, sourceCommit, collectorPath, runId, phase, manifestPath, browserControlPath) {
	const timeout = observationTimeoutMs(phase);
	if (!browserControlPath) throw Error("Explicit browser control metadata file is required.");
	const metadataBytes = await readFile(browserControlPath);
	let browserControlBinding = await readBrowserControlBinding({ plan: { runtime: { build: sourceCommit,
		browserControl: JSON.parse(metadataBytes.toString("utf8")) } }, manifestPath });
	const { origin, fixture } = await readFixture(directory),
		auth = await json(join(directory, "auth-private.json"));
	const control =
		collectorPath || join(directory, "observer-v2/collector-control.json");
	const configuration = await json(control);
	const collector = new URL(configuration.endpoint);
	localOrigin(collector.origin);
	if (
		configuration.kind !== collectorProtocol ||
		collector.pathname !== "/v1/traces" ||
		collector.search ||
		collector.hash ||
		collector.username ||
		collector.password
	)
		throw Error("Registered loopback v2 collector required");
	const buildId = (
		await readFile(join(artifactApp, ".next/BUILD_ID"), "utf8")
	).trim();
	if (!/^[a-f0-9]{9,40}$/.test(sourceCommit) || !buildId)
		throw Error("Actual source and compiled identity required");
	const traces = createMixedTracePlan(),
		records = [],
		opened = [],
		activeRequests = new Set();
	let pageErrors = 0;
	let browser,
		observation,
		controls,
		clock,
		liveVersion = null,
		ownedLive = false,
		unknownOutstanding = false,
		cleanupRequired = false,
		browserClosed = false;
	let uiTrace = traces.preparation[3],
		pairsCompleted = 0,
		stopped = false,
		failureStage = null,
		stage = "registration",
		analyticsActive = 0,
		commandActive = 0,
		userMaxInflight = 0;
	let nativeRunCoverage = { complete: false },
		nativeCloseProof = null,
		nativeCloseElapsedMs = null,
		backendGroups = [],
		transports = [];
	const tally = () => {
		analyticsActive = activeRequests.size;
		userMaxInflight = Math.max(
			userMaxInflight,
			analyticsActive + commandActive,
		);
	};
	const created = (item) => {
		opened.push(item);
		item.page.on("pageerror", () => pageErrors++);
	};
	const requireCleanWork = () => {
		for (const item of opened) {
			const evidence = item.browserObservation?.snapshot();
			const application = item.transport.snapshot().applicationEvidence;
			if (!evidence || evidence.measured.unknownFailures || evidence.allPhase.realFailures ||
				["missing", "errors", "overflow"].some((key) => evidence.measured.coverage[key] !== 0) ||
				["failures", "serverErrors", "unknown", "httpErrors", "overflows", "decodeFailures", "registryConflicts"].some((key) => application?.[key] !== 0))
				throw Error("Required mixed browser or application observation is not clean.");
		}
	};
	try {
		// One bounded registration precedes version checks, all four browser contexts and cleanup IO.
		observation = await beginMixedObservation(control, traces.ids);
		stage = "source-pin";
		const version = await fetch(new URL("/api/app-version", origin), {
			headers: { traceparent: traceparent(traces.preparation[0]) },
			signal: AbortSignal.timeout(5000),
		});
		liveVersion = version.ok ? (await version.json()).buildHash : null;
		if (!mixedSourceMatches(sourceCommit, liveVersion))
			throw Error("Live app source differs from the pin");
		const require = createRequire(join(artifactApp, "package.json"));
		browser = await launchFixtureBrowser(
			require("puppeteer-core"),
			process.env.Z8_FIXTURE_CHROME ||
				"C:/Program Files/Google/Chrome/Application/chrome.exe",
		);
		browserControlBinding = await verifyBrowserControlBrowser(browser, browserControlBinding);
		stage = "capture";
		const readers = [];
		for (const [index, reader] of analytics.entries()) {
			const item = await captureAnalytics(
				browser,
				auth,
				origin,
				reader,
				fixture.actors[reader.actor],
				{ ids: traces.ids, current: () => traces.preparation[index] },
				created,
				timeout,
				browserControlBinding,
			);
			requireCleanWork();
			item.page.on("request", (request) => {
				const value = request.headers().traceparent?.split("-")[1];
				if (traces.groups.some((group) => group.traceIds.includes(value))) {
					activeRequests.add(request);
					tally();
				}
			});
			const finish = (request) => {
				activeRequests.delete(request);
				tally();
			};
			item.page.on("requestfinished", finish);
			item.page.on("requestfailed", finish);
			readers.push(item);
		}
		clock = await openPage(
			browser,
			auth,
			origin,
			clockActor,
			{ ids: traces.ids, current: () => uiTrace },
			created,
			browserControlBinding,
		);
		controls = await openPublicHeaderClock(clock.page, {
			origin,
			expectedActor: fixture.actors[clockActor],
			timeoutMs: timeout,
			phase,
		});
		stage = "commands";
		async function command(action, pair, cleanup = false) {
			if (!cleanup) requireCleanWork();
			const id = cleanup ? traces.preparation[3] : traces.clock(pair, action);
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
				uiTrace = traces.preparation[3];
				throw Error("Header preparation failed");
			}
			const headerPrepareMs = performance.now() - preparationStart;
			let done = false,
				overlap = null;
			const workers = cleanup
				? []
				: readers.map(({ page, captured, reader }, index) =>
						runMixedReader({
							limit: 100,
						stopped: () => {
							if (done) return true;
							try { requireCleanWork(); return false; }
							catch { stopped = true; done = true; failureStage ||= "required-observation"; return true; }
						},
							read: async () => {
								const requestId = traces.analytics(pair, index),
									started = performance.now();
								let result;
								try {
									const value = await page.evaluate(
										async (input) => {
											const response = await fetch(input.path, {
												method: "POST",
												headers: input.headers,
												body: input.body,
												credentials: "same-origin",
												signal: AbortSignal.timeout(input.timeoutMs),
											});
											return {
												status: response.status,
												text: await response.text(),
											};
										},
										{
											...captured,
											timeoutMs: timeout,
											headers: {
												...captured.headers,
												traceparent: traceparent(requestId),
											},
										},
									);
									const summary = analyticsSummary(
										reader.kind,
										publicResult(value.text),
									);
									result = {
										success: value.status === 200 && summary.correct,
										httpStatus: value.status,
										bytes: Buffer.byteLength(value.text),
										summary,
										censored: false,
									};
								} catch {
									result = {
										success: false,
										httpStatus: null,
										bytes: null,
										censored: true,
									};
								}
								return {
									family: "analytics",
									kind: reader.kind,
									actor: reader.actor,
									pair,
									action,
									traceId: requestId,
									elapsedMs: performance.now() - started,
									...result,
								};
							},
							observe: (value) => {
								records.push(value);
								if (!value.success) {
									stopped = true;
									done = true;
									failureStage ||= "analytics";
								}
							},
						}),
					);
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
				// Await real dispatch, not synthetic latency. This does not pause any reader's hot loop.
				const deadline = performance.now() + timeout;
				while (
					!cleanup &&
					analyticsActive < 3 &&
					!done &&
					performance.now() < deadline
				)
					await pause(1);
				if (!cleanup && (analyticsActive < 3 || done))
					throw Error("Independent readers never dispatched concurrently");
				if (!cleanup) requireCleanWork();
				result = await prepared.submit();
				if (result.success && !clockObservationIsComplete(result))
					result = { ...result, success: false, censored: true };
				if (result.unknownCommandOutcome) unknownOutstanding = true;
				if (!result.success) {
					stopped = true;
					failureStage ||= cleanup ? "cleanup" : "commands";
				} else if (action === "out") {
					ownedLive = false;
					unknownOutstanding = false;
				}
			} catch {
				result = {
					success: false,
					censored: true,
					unknownCommandOutcome: ownedLive,
					clockReadyMs: null,
					elapsedUntilFailureMs: performance.now() - started,
				};
				unknownOutstanding ||= ownedLive;
				stopped = true;
				failureStage ||= "command-transport";
			} finally {
				done = true;
				commandActive = 0;
				clock.page.off("request", observe);
				const joined = await Promise.allSettled(workers);
				if (
					joined.some(
						(value) =>
							value.status !== "fulfilled" ||
							value.value.failed ||
							value.value.boundReached,
					)
				) {
					stopped = true;
					failureStage ||= "analytics-request-bound";
				}
				uiTrace = traces.preparation[3];
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
			if (!cleanup && overlap !== 3) {
				stopped = true;
				failureStage ||= "mixed-load-overlap";
			}
			return result.success;
		}
		try {
			for (let pair = 1; pair <= 20 && !stopped; pair++) {
				if (!(await command("in", pair)) || stopped) break;
				if (!(await command("out", pair)) || stopped) break;
				pairsCompleted++;
			}
		} finally {
			if (ownedLive) {
				stage = "resolve-and-cleanup";
				uiTrace = traces.preparation[3];
				try {
					const state = await controls.resolveState();
					cleanupRequired =
						state === "in"
							? !(await command("out", Math.min(20, pairsCompleted + 1), true))
							: state !== "out" || unknownOutstanding;
				} catch {
					cleanupRequired = true;
				}
			}
		}
	} catch {
		stopped = true;
		failureStage ||= stage;
		cleanupRequired ||= ownedLive;
	} finally {
		controls?.dispose();
		try {
			await settleMixedTransports(opened);
		} catch {
			stopped = true;
			failureStage ||= "wire-settlement";
		}
		for (const item of opened) {
			try { item.browserObservation?.endMeasurement(); await item.browserObservation?.close(); }
			catch { stopped = true; failureStage ||= "browser-control-close"; }
		}
		try {
			await browser?.close();
			browserClosed = !!browser;
		} catch {
			stopped = true;
			failureStage ||= "browser-close";
		}
		for (const item of opened) {
			try {
				await item.transport.close();
				transports.push({
					actor: item.actor,
					contextId: item.contextId,
					browserFailureScope: mixedBrowserWorkScope,
					browserControlEvidence: item.browserObservation?.snapshot() ?? null,
					rawBrowserFailedRequests: item.browserObservation?.snapshot().rawMeasuredFailedRequests ?? null,
					traceTransport: {
						kind: fixtureTraceTransport,
						...item.transport.snapshot(),
					},
					wire: item.transport.wire.state(performance.now()),
				});
			} catch {
				stopped = true;
				failureStage ||= "transport-close";
			}
		}
		if (observation) {
			try {
				({
					nativeRunCoverage,
					nativeCloseProof,
					nativeCloseElapsedMs,
					rows: backendGroups,
				} = await finishMixedObservation(observation));
			} catch {
				stopped = true;
				failureStage ||= "native-close-proof";
			}
		}
	}
	const completeTransport =
		transports.length === 4 && transports.every((row) => mixedTransportIsComplete(row) && cleanApplicationEvidence(row.traceTransport.applicationEvidence) &&
			cleanBrowserContextEvidence(row.contextId, row.browserControlEvidence, row.rawBrowserFailedRequests));
	const completeCoverage =
		nativeRunCoverage.complete === true &&
		completeTransport &&
		browserClosed &&
		pageErrors === 0;
	if (userMaxInflight !== 4) {
		stopped = true;
		failureStage ||= "mixed-load-concurrency";
	}
	const report = {
		...plan(phase),
		browserControl: browserControlBinding,
		browserControlMetadataFileSha256: createHash("sha256").update(metadataBytes).digest("hex"),
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
		browserClosed,
		pageErrors,
		nativeRunCoverage,
		nativeCloseProof,
		nativeCloseElapsedMs,
		transports,
		backendGroups: backendGroups.map((row) => ({
			traceId: row.traceId,
			...numericMetrics(row),
		})),
		analyticsWindows: traces.groups.map(
			({ firstPair, lastPair, traceIds }) => ({
				firstPair,
				lastPair,
				traceIds,
			}),
		),
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
	const argv = process.argv.slice(2), phaseIndex = argv.indexOf("--phase"), phase = argv[phaseIndex + 1];
	if (phaseIndex < 0 || argv.filter((value) => value === "--phase").length !== 1 || observationTimeoutMs(phase) === undefined)
		throw Error("An explicit baseline or release observation phase is required.");
	await readFixture(directory);
	if (command === "plan") {
		console.log(JSON.stringify(plan(phase)));
		return;
	}
	if (!artifactApp || !flags.includes("--allow-fixture-writes"))
		throw new Error(
			"Explicit disposable fixture writes and the compiled artifact are required.",
		);
	const collectorIndex = flags.indexOf("--collector");
	if (collectorIndex >= 0 && !flags[collectorIndex + 1])
		throw new Error("Collector control path missing.");
	for (const name of ["--app-manifest", "--browser-control"])
		if (flags.filter((flag) => flag === name).length !== 1 || !flags[flags.indexOf(name) + 1] || flags[flags.indexOf(name) + 1].startsWith("--"))
			throw Error("Exactly one app manifest and browser control metadata file are required.");
	const runId = trace();
	try {
		await run(
			directory,
			resolve(artifactApp),
			sourceCommit,
			collectorIndex >= 0 ? resolve(flags[collectorIndex + 1]) : undefined,
			runId,
			phase,
			flags.includes("--app-manifest") ? resolve(flags[flags.indexOf("--app-manifest") + 1]) : undefined,
			flags.includes("--browser-control") ? resolve(flags[flags.indexOf("--browser-control") + 1]) : undefined,
		);
	} catch {
		await writeFile(
			join(directory, `mixed-load-${runId}.json`),
			JSON.stringify(
				{
					...plan(phase),
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
