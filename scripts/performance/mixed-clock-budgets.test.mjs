import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import * as budgets from "./mixed-clock-budgets.mjs";
import { nextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";
import { cleanObservationPolicy, cleanEvidencePolicy } from "./clean-evidence.mjs";
import { testBrowserEvidence, testBrowserMetadata, testBrowserBinding } from "./control-cancellation-test-fixtures.mjs";
import { mixedBrowserWorkScope } from "./browser-control-collector.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";

const BEFORE = "456d28b2da4437662ae8f625a1df6756bff031fe";
const HEAD = "de0b1a128b384196c7c93ac69cd5324e8d0cbbd8";
const hash = "a".repeat(64);
const id = (n) => n.toString(16).padStart(32, "0");
const actors = ["large-admin", "small-admin", "small-manager", "large-manager"];
const metadataFor = (build) => ({ ...testBrowserMetadata(), compiledManifestSha256: (build === HEAD ? "e" : "d").repeat(64) });
const metadataFileHash = (build) => (build === HEAD ? "f" : "c").repeat(64);
function transport(actor) {
	const counts = () => ({
		requests: 0,
		rewrittenRequests: 0,
		refusedRequests: 0,
		upstreamFailures: 0,
		responseBodyBytes: 0,
		refusalReasons: {
			unexpectedLoopback: 0,
			nonLoopbackHttp: 0,
			loopbackConnect: 0,
			nonLoopbackConnect: 0,
			malformed: 0,
		},
	});
	return {
		actor,
		contextId: id(actors.indexOf(actor) + 1),
		rawBrowserFailedRequests: 0,
		browserControlEvidence: testBrowserEvidence(id(actors.indexOf(actor) + 1)),
		browserFailureScope: mixedBrowserWorkScope,
		traceTransport: {
			...counts(),
			applicationEvidence: createActionResultObserver().snapshot(),
			browserInitialization: {
				...counts(),
				policy: "isolated-profile-no-prediction-v1",
				complete: true,
				capped: false,
				emptyContext: true,
				quietMs: 2000,
				capMs: 10000,
				quietObservedMs: 2000,
				elapsedMs: 2100,
				pending: 0,
				launch: {
					policy: "isolated-profile-no-prediction-v1",
					headless: true,
					browserVersion: "Chrome/test",
					preferences: {
						net: { network_prediction_options: 2 },
						search: { suggest_enabled: false },
						default_search_provider: { enabled: false },
					},
					arguments: ["--disable-features=AutofillServerCommunication"],
				},
			},
			afterInitialization: counts(),
		},
		wire: {
			complete: true,
			capped: false,
			censored: false,
			mandatoryErrors: 0,
			mandatoryPending: 0,
			observationOverflows: 0,
			unknownInheritedRedirects: 0,
		},
	};
}
function fixture(build = BEFORE) {
	const incoming = {
		knownHeaderKnownSpan: 0,
		knownHeaderOtherSpan: 0,
		otherHeaderKnownSpan: 0,
		otherHeaderOtherSpan: 0,
		matchingParent: 0,
		mismatchingParent: 0,
	};
	const counter = (n) => ({
		driverCounter: true,
		driverQueries: n,
		activeTraces: 0,
		unknown: 0,
		started: { queries: n, acquisitions: n, cache: n },
		ended: { queries: n, acquisitions: n, cache: n },
		incoming,
	});
	const backendGroups = Array.from({ length: 56 }, (_, n) => ({
		traceId: id(n + 1),
		queryCount: 1,
		observedQueryCount: 1,
		queryDurationMs: 1,
		rowsRetrieved: 1,
		poolWaitMs: 0,
		eventLoopDelayMs: 0,
		cacheHits: 1,
		cacheMisses: 0,
		observedPoolAcquisitions: 1,
		observedQueryErrors: 0,
		observedPoolAcquisitionErrors: 0,
		coverage: {
			observer: true,
			pg: true,
			rows: true,
			cache: true,
			eventLoop: true,
			registration: true,
			closed: true,
			nativeProof: true,
			incomplete: false,
			nativeDriverQueries: 1,
			rejectedBatches: 0,
			unattributedNativeSpans: 0,
			lateSpans: 0,
		},
	}));
	const windows = Array.from({ length: 4 }, (_, n) => ({
		firstPair: n * 5 + 1,
		lastPair: n * 5 + 5,
		traceIds: [id(45 + n * 3), id(46 + n * 3), id(47 + n * 3)],
	}));
	const records = [];
	for (let pair = 1; pair <= 20; pair++)
		for (const [index, action] of ["in", "out"].entries()) {
			records.push({
				family: "clock",
				action,
				pair,
				traceId: id(5 + (pair - 1) * 2 + index),
				success: true,
				censored: false,
				unknownCommandOutcome: false,
				httpStatus: 200,
				commandResponseMs: 5,
				headerPrepareMs: 1,
				workloadWindowMs: 1000,
				clockReadyMs: pair * (index + 1) * 10,
				analyticsInflightAtCommandStart: 3,
			});
			for (const [reader, kind] of ["work", "team", "overtime"].entries())
				records.push({
					family: "analytics",
					kind,
					actor: actors[reader],
					action,
					pair,
					traceId: windows[Math.floor((pair - 1) / 5)].traceIds[reader],
					success: true,
					censored: false,
					httpStatus: 200,
					elapsedMs: 10,
					bytes: 20,
					summary:
						kind === "work"
							? { correct: true, employees: 200, hours: 417600 }
							: kind === "team"
								? { correct: true, employees: 8, hours: 16704 }
								: { correct: true, weeks: 53, overtimeHours: 0 },
				});
		}
	return {
		version: 2,
		phase: build === BEFORE ? "baseline" : "release",
		topology: "single app",
		collectorProtocol: "z8-fixture-otlp-collector-v2",
		traceTransport: "context-loopback-proxy-v1",
		browserPolicy: "isolated-profile-no-prediction-v1",
		semanticTraceIdentities: 56,
		activeRegistrationLimit: 64,
		retainedIdentityLimit: 10000,
		userConcurrency: 4,
		poolMax: 10,
		poolAcquisitionTimeoutMs: 60000,
		clockPairs: 20,
		clockActor: actors[3],
		analyticsCallers: ["work", "team", "overtime"].map((kind, n) => ({
			kind,
			actor: actors[n],
			range: "annual 2025",
		})),
		analyticsMaxRequestsPerCallerPerCommand: 100,
		requestTimeoutMs: build === BEFORE ? 90000 : 30000,
		sourceCommit: build,
		cleanEvidencePolicy,
		browserFailureScope: mixedBrowserWorkScope,
		browserControl: { ...testBrowserBinding(build), ...metadataFor(build) },
		browserControlMetadataFileSha256: metadataFileHash(build),
		liveVersion: build.slice(0, 7),
		success: true,
		pairsCompleted: 20,
		stopped: false,
		failureStage: null,
		cleanupRequired: false,
		unknownOutstanding: false,
		completeCoverage: true,
		browserClosed: true,
		pageErrors: 0,
		userMaxInflight: 4,
		transports: actors.map(transport),
		backendGroups,
		analyticsWindows: windows,
		records,
		nativeRunCoverage: {
			complete: true,
			standard: {
				complete: true,
				driverQueryCount: 56,
				nativeQueryStartedCount: 56,
				nativeQueryEndedCount: 56,
				observedQueryCount: 56,
				pendingNativeQueries: 0,
				activeTraces: 0,
				allReceivedTracesReconciled: true,
			},
			registration: {
				began: true,
				closed: true,
				traceCount: 56,
				protocol: "z8-fixture-otlp-collector-v2",
			},
			before: counter(0),
			after: counter(56),
		},
		nativeCloseProof: backendGroups.map((row) => ({
			traceId: row.traceId,
			complete: true,
			driverComplete: true,
			drained: true,
			driverQueries: 1,
			queries: 1,
			acquisitions: 1,
			cache: 1,
			started: { queries: 1, acquisitions: 1, cache: 1 },
			ended: { queries: 1, acquisitions: 1, cache: 1 },
			unattributedNativeSpans: 0,
			serverBalance: 0,
			serverStarted: 1,
			serverEnded: 1,
			serverScopes: {
				http: { started: 1, ended: 1 },
				next: { started: 0, ended: 0 },
				other: { started: 0, ended: 0 },
			},
			lastActivityAgeMs: 1000,
			drainElapsedMs: 1,
		})),
	};
}
function inputs() {
	const conditions = {
		browserControl: metadataFor(BEFORE),
		browserControlMetadataFileSha256: metadataFileHash(BEFORE),
		nextStreamCompletionPatch: structuredClone(nextStreamCompletionPatch),
		topology: "single app",
		actors,
		poolMax: 10,
		poolAcquisitionTimeoutMs: 60000,
		observation: cleanObservationPolicy,
		clockPairs: 20,
		annualYear: 2025,
		analyticsMaxRequestsPerCallerPerCommand: 100,
		telemetryDrain: "once-after-condition",
		viewport: { width: 1280, height: 900 },
		timezone: "Europe/Berlin",
		locale: "en",
		origin: "http://localhost:58792",
		fixture: {
			version: "synthetic-test",
			populations: [8, 200],
			rangeStart: "2025-01-01",
			rangeEnd: "2025-12-31",
		},
		browser: "Chrome/test",
		node: "v22.test",
		hardware: {
			platform: "win32",
			arch: "x64",
			cpuModel: "test",
			logicalCpus: 4,
			memoryBytes: 1000,
		},
		cacheWarming: "annual-public-preparation-complete",
	};
	return {
		before: fixture(),
		beforeSha256: hash,
		beforeContextSha256: hash,
		protocolSha256: hash,
		protocol: {
			schema: 1,
			files: Object.fromEntries(
				budgets.mixedProtocolFiles.map((name) => [name, hash]),
			),
		},
		operatorSha256: hash,
		expectedBeforeBuild: BEFORE,
		expectedHeadBuild: HEAD,
		expectedHeadBrowserControl: metadataFor(HEAD),
		expectedHeadBrowserControlFileSha256: metadataFileHash(HEAD),
		registeredAt: "2026-10-25T01:00:00.000Z",
		beforeContext: {
			schema: 1,
			mixedArtifactSha256: hash,
			fullBuild: BEFORE,
			phase: "baseline",
			observationTimeoutMs: 90000,
			protocolSha256: hash,
			startedAt: "2026-10-25T00:00:00.000Z",
			finishedAt: "2026-10-25T00:30:00.000Z",
			conditions,
		},
	};
}
test("complete mixed cohorts derive policy9 nearest-rank limits and compare only clock-ready p95", () => {
	const input = inputs(),
		original = structuredClone(input);
	const budget = budgets.deriveMixedClockBudgets(input);
	assert.equal(budget.policy.version, 9);
	assert.equal(budgets.getMixedClockBudgetPolicyVersion(), budget.policy.version);
	assert.match(budget.conditionValidatorSha256, /^[a-f0-9]{64}$/);
	assert.deepEqual(input, original);
	assert.deepEqual(budget.clock.in, {
		samples: 20,
		beforeP50Ms: 100,
		beforeP95Ms: 190,
		ceilingMs: 500,
	});
	assert.equal(budget.clock.out.beforeP95Ms, 380);
	assert.equal(budget.clock.out.ceilingMs, 630);
	const options = {
		budgets: budget,
		budgetSha256: hash,
		expectedBudgetSha256: hash,
		before: input.before,
		beforeSha256: hash,
		head: fixture(HEAD),
		headSha256: hash,
		protocol: input.protocol,
		protocolSha256: hash,
		operatorSha256: hash,
		headContextSha256: hash,
		observedAt: "2026-10-25T04:00:00.000Z",
		headContext: {
			...input.beforeContext,
			fullBuild: HEAD,
			conditions: { ...input.beforeContext.conditions, browserControl: input.expectedHeadBrowserControl,
				browserControlMetadataFileSha256: input.expectedHeadBrowserControlFileSha256 },
			phase: "release",
			observationTimeoutMs: 30000,
			firstControlledHeadStartedAt: "2026-10-25T02:00:00.000Z",
			startedAt: "2026-10-25T02:00:00.000Z",
			finishedAt: "2026-10-25T03:00:00.000Z",
		},
	};
	assert.equal(budgets.compareMixedClockBudgets(options).passed, true);
	options.head.records.find(
		(row) => row.family === "clock" && row.action === "out" && row.pair === 19,
	).clockReadyMs = 2000;
	options.head.records.find(
		(row) => row.family === "clock" && row.action === "out" && row.pair === 20,
	).clockReadyMs = 3000;
	assert.equal(budgets.compareMixedClockBudgets(options).passed, false);
});

test("mixed Native authority preserves independently registered original origin and distinct phase public bindings",()=>{
	const input=inputs();
	const publicSources=build=>({protocol:"qualified-serving-worker-sources-v1",compiledBuild:build,compiledManifestSha256:metadataFor(build).compiledManifestSha256,
		files:["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"].map(file=>({file,bytes:12,sha256:hash,gitBlob:"b".repeat(40)}))});
	input.beforeContext.conditions.browserControl.nativePublicSources=publicSources(BEFORE);
	input.before.browserControl.nativePublicSources=publicSources(BEFORE);
	input.expectedHeadBrowserControl.nativePublicSources=publicSources(HEAD);
	const budget=budgets.deriveMixedClockBudgets(input);
	assert.equal(budget.expectedOrigin,input.beforeContext.conditions.origin);
	const head=fixture(HEAD);head.browserControl.nativePublicSources=publicSources(HEAD);
	const options={budgets:budget,budgetSha256:hash,expectedBudgetSha256:hash,before:input.before,beforeSha256:hash,head,headSha256:hash,protocol:input.protocol,protocolSha256:hash,operatorSha256:hash,
		headContextSha256:hash,observedAt:"2026-10-25T04:00:00.000Z",headContext:{...input.beforeContext,fullBuild:HEAD,conditions:{...input.beforeContext.conditions,browserControl:input.expectedHeadBrowserControl,browserControlMetadataFileSha256:input.expectedHeadBrowserControlFileSha256},
			phase:"release",observationTimeoutMs:30000,firstControlledHeadStartedAt:"2026-10-25T02:00:00.000Z",startedAt:"2026-10-25T02:00:00.000Z",finishedAt:"2026-10-25T03:00:00.000Z"}};
	assert.equal(budgets.compareMixedClockBudgets(options).passed,true);
	const foreign=structuredClone(options);foreign.headContext.conditions.origin="http://localhost:9999";
	assert.throws(()=>budgets.compareMixedClockBudgets(foreign));
	const wrongOriginal=structuredClone(options);wrongOriginal.budgets.expectedOrigin="http://localhost:9999";
	assert.throws(()=>budgets.compareMixedClockBudgets(wrongOriginal));
	const unregistered=structuredClone(input);unregistered.beforeContext.conditions.origin="http://localhost:9999";
	assert.throws(()=>budgets.deriveMixedClockBudgets(unregistered));
});
test("mixed before conditions require the exact common patch, never equal unknowns or an alias", () => {
	for (const mutate of [
		(c) => delete c.nextStreamCompletionPatch,
		(c) => (c.nextStreamCompletionPatch = null),
		(c) => (c.nextStreamCompletionPatch.patchSha256 = hash),
		(c) => (c.nextStreamCompletionPatch.esmSha256 = hash),
		(c) => (c.nextStreamCompletionPatch.extra = true),
		(c) => {
			c.nextStreamLifecycle = c.nextStreamCompletionPatch;
			delete c.nextStreamCompletionPatch;
		},
	]) {
		const input = inputs();
		mutate(input.beforeContext.conditions);
		assert.throws(
			() => budgets.deriveMixedClockBudgets(input),
			/common Next patch/,
		);
	}
});

test("mixed independent derivation requires actual per-context browser proof even when raw is zero", () => {
	for (const mutate of [
		(run) => delete run.transports[0].browserControlEvidence,
		(run) => run.transports[0].contextId = "wrong-context",
		(run) => run.transports[0].rawBrowserFailedRequests = null,
		(run) => run.browserControl.browserVerified = false,
	]) {
		const input = inputs(); mutate(input.before);
		assert.throws(() => budgets.deriveMixedClockBudgets(input));
	}
});

test("longer clean original clock observations cannot raise optimized clock ceilings above thirty seconds", () => {
	const input = inputs();
	for (const row of input.before.records.filter((row) => row.family === "clock")) row.clockReadyMs = 40000;
	const budget = budgets.deriveMixedClockBudgets(input);
	assert.equal(budget.clock.in.beforeP95Ms, 40000);
	assert.equal(budget.clock.in.ceilingMs, 30000);
	assert.equal(budget.clock.out.ceilingMs, 30000);
});
test("incomplete, duplicate, censored or replaced commands never produce a finite budget", () => {
	for (const mutate of [
		(r) => {
			r.records.splice(
				r.records.findIndex(
					(row) =>
						row.family === "clock" && row.pair === 20 && row.action === "out",
				),
				1,
			);
			r.cohorts = {
				in: { samples: 20, p95Ms: 0 },
				out: { samples: 20, p95Ms: 0 },
			};
		},
		(r) => r.records.push(r.records[0]),
		(r) => (r.records.find((x) => x.family === "clock").success = false),
		(r) => (r.records.find((x) => x.family === "clock").censored = true),
		(r) =>
			(r.records.find((x) => x.family === "clock").unknownCommandOutcome =
				true),
		(r) => delete r.records.find((x) => x.family === "clock").clockReadyMs,
		(r) => (r.success = false),
		(r) => (r.pairsCompleted = 19),
	]) {
		const input = inputs();
		mutate(input.before);
		assert.throws(() => budgets.deriveMixedClockBudgets(input));
	}
});
test("native, server, metric, transport, overlap and analytics failures remain strict", () => {
	const mutations = [
		(r) => (r.nativeRunCoverage.standard.complete = false),
		(r) => r.nativeCloseProof.pop(),
		(r) => (r.nativeCloseProof[0].serverBalance = 1),
		(r) => delete r.nativeCloseProof[0].serverStarted,
		(r) => r.backendGroups.push(r.backendGroups[0]),
		(r) => r.nativeRunCoverage.after.unknown++,
		(r) => r.transports.pop(),
		(r) => { r.transports[0].contextId = id(9999); r.transports[0].browserControlEvidence = testBrowserEvidence(id(9999)); },
		(r) => r.transports[0].wire.mandatoryErrors++,
		(r) => r.transports[0].traceTransport.browserInitialization.requests++,
		(r) => (r.records[0].analyticsInflightAtCommandStart = 2),
		(r) => (r.userMaxInflight = 5),
		(r) => (r.cleanupRequired = true),
		(r) => r.records.find((x) => x.kind === "work").summary.hours--,
	];
	for (const key of [
		"observer",
		"pg",
		"rows",
		"cache",
		"eventLoop",
		"registration",
		"closed",
		"nativeProof",
	])
		mutations.push((r) => (r.backendGroups[0].coverage[key] = null));
	for (const key of [
		"queryDurationMs",
		"rowsRetrieved",
		"poolWaitMs",
		"cacheHits",
		"eventLoopDelayMs",
	])
		mutations.push((r) => delete r.backendGroups[0][key]);
	for (const mutate of mutations) {
		const input = inputs();
		mutate(input.before);
		assert.throws(() => budgets.deriveMixedClockBudgets(input));
	}
});
test("context, source and prospective registration are mandatory rather than inferred", () => {
	for (const mutate of [
		(i) => (i.before.liveVersion = HEAD.slice(0, 7)),
		(i) => (i.expectedBeforeBuild = BEFORE.slice(0, 7)),
		(i) => (i.expectedHeadBuild = BEFORE),
		(i) => (i.beforeContext.fullBuild = HEAD),
		(i) => (i.beforeContext.mixedArtifactSha256 = "b".repeat(64)),
		(i) => delete i.beforeContext.conditions.hardware,
		(i) => (i.registeredAt = "2026-10-24T00:00:00.000Z"),
		(i) => (i.protocol.files.extra = hash),
		(i) => delete i.protocol.files["action-result-observer.mjs"],
		(i) => delete i.protocol.files["clean-evidence.mjs"],
		(i) => (i.before.requestTimeoutMs = 30000),
		(i) => (i.before.phase = "release"),
		(i) => (i.before.poolAcquisitionTimeoutMs = 10000),
		(i) => (i.beforeContext.conditions.poolAcquisitionTimeoutMs = 10000),
	]) {
		const input = inputs();
		mutate(input);
		assert.throws(() => budgets.deriveMixedClockBudgets(input));
	}
});
test("CLI refuses unknown, duplicated, retrospective and preexisting-output arguments", async () => {
	for (const args of [
		["derive", "--head", "x"],
		["derive", "--before", "x", "--before", "y"],
		["compare", "--policy", "relaxed"],
	])
		assert.throws(() => budgets.parseMixedBudgetArguments(args));
	const folder = await mkdtemp(join(tmpdir(), "mixed-budget-file-only-"));
	try {
		const path = join(folder, "existing.json");
		await writeFile(path, "original");
		await assert.rejects(
			budgets.writeMixedBudgetOutput(path, { replaced: true }),
		);
		assert.equal(await readFile(path, "utf8"), "original");
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
});

test("changed registration, sources, protocol or independent head context cannot be compared", () => {
	const input = inputs();
	const sample = {
		budgets: budgets.deriveMixedClockBudgets(input),
		budgetSha256: hash,
		expectedBudgetSha256: hash,
		before: input.before,
		beforeSha256: hash,
		head: fixture(HEAD),
		headSha256: hash,
		protocol: input.protocol,
		protocolSha256: hash,
		operatorSha256: hash,
		headContextSha256: hash,
		observedAt: "2026-10-25T04:00:00.000Z",
		headContext: {
			...input.beforeContext,
			fullBuild: HEAD,
			conditions: { ...input.beforeContext.conditions, browserControl: input.expectedHeadBrowserControl,
				browserControlMetadataFileSha256: input.expectedHeadBrowserControlFileSha256 },
			phase: "release",
			observationTimeoutMs: 30000,
			firstControlledHeadStartedAt: "2026-10-25T02:00:00.000Z",
			startedAt: "2026-10-25T02:00:00.000Z",
			finishedAt: "2026-10-25T03:00:00.000Z",
		},
	};
	for (const mutate of [
		(x) => delete x.headContext.conditions.nextStreamCompletionPatch,
		(x) =>
			(x.headContext.conditions.nextStreamCompletionPatch.cjsSha256 = hash),
		(x) => (x.budgets.conditionValidatorSha256 = hash),
		(x) => (x.expectedBudgetSha256 = "b".repeat(64)),
		(x) => (x.beforeSha256 = "b".repeat(64)),
		(x) => (x.protocolSha256 = "b".repeat(64)),
		(x) => (x.operatorSha256 = "b".repeat(64)),
		(x) => x.budgets.clock.in.ceilingMs++,
		(x) => x.budgets.policy.version++,
		(x) => (x.headContext.fullBuild = BEFORE),
		(x) => x.headContext.conditions.hardware.logicalCpus++,
		(x) =>
			(x.headContext.firstControlledHeadStartedAt = "2026-10-25T00:59:00.000Z"),
		(x) => (x.head.sourceCommit = BEFORE),
		(x) => (x.head.liveVersion = BEFORE.slice(0, 7)),
		(x) =>
			(x.head.transports[0].traceTransport.browserInitialization.launch.browserVersion =
				"Chrome/changed"),
	]) {
		const bad = structuredClone(sample);
		mutate(bad);
		assert.throws(() => budgets.compareMixedClockBudgets(bad));
	}
	for (const file of budgets.mixedProtocolFiles) {
		const bad = structuredClone(sample);
		bad.protocol.files[file] = "b".repeat(64);
		assert.throws(() => budgets.compareMixedClockBudgets(bad));
	}
	const unknown = structuredClone(sample);
	unknown.headContext.conditions.nextStreamCompletionPatch = { unknown: true };
	unknown.budgets.conditionsSha256 = createHash("sha256")
		.update("unknown")
		.digest("hex");
	assert.throws(
		() => budgets.compareMixedClockBudgets(unknown),
		/common Next patch/,
	);
});

test("more completed analytics responses alone adds descriptive volume without a regression threshold", () => {
	const input = inputs(),
		registration = budgets.deriveMixedClockBudgets(input),
		head = fixture(HEAD);
	head.records.push(
		structuredClone(head.records.find((row) => row.family === "analytics")),
	);
	const result = budgets.compareMixedClockBudgets({
		budgets: registration,
		budgetSha256: hash,
		expectedBudgetSha256: hash,
		before: input.before,
		beforeSha256: hash,
		head,
		headSha256: hash,
		protocol: input.protocol,
		protocolSha256: hash,
		operatorSha256: hash,
		headContextSha256: hash,
		observedAt: "2026-10-25T04:00:00.000Z",
		headContext: {
			...input.beforeContext,
			fullBuild: HEAD,
			conditions: { ...input.beforeContext.conditions, browserControl: input.expectedHeadBrowserControl,
				browserControlMetadataFileSha256: input.expectedHeadBrowserControlFileSha256 },
			phase: "release",
			observationTimeoutMs: 30000,
			firstControlledHeadStartedAt: "2026-10-25T02:00:00.000Z",
			startedAt: "2026-10-25T02:00:00.000Z",
			finishedAt: "2026-10-25T03:00:00.000Z",
		},
	});
	assert.equal(result.passed, true);
	assert.equal(result.descriptiveHead.analyticsResponses, 121);
	assert.equal(result.otherMetricsBudgeted, false);
});

test("actual file commands bind protocol bytes, registration SHA and independent contexts without rewriting before evidence", async () => {
	const folder = await mkdtemp(join(tmpdir(), "mixed-clock-command-test-"));
	const encode = (value) => `${JSON.stringify(value, null, 2)}\n`,
		sha = (value) => createHash("sha256").update(value).digest("hex");
	try {
		const input = inputs();
		const headManifest = encode({ config: { deploymentId: HEAD, experimental: { cachedNavigations: true } } });
		input.expectedHeadBrowserControl = { ...metadataFor(HEAD), compiledManifestSha256: sha(headManifest) };
		const headMetadata = encode(input.expectedHeadBrowserControl);
		input.expectedHeadBrowserControlFileSha256 = sha(headMetadata);
		const headValue = fixture(HEAD);
		headValue.browserControl = { ...testBrowserBinding(HEAD), ...input.expectedHeadBrowserControl };
		headValue.browserControlMetadataFileSha256 = input.expectedHeadBrowserControlFileSha256;
		const before = encode(input.before), head = encode(headValue);
		const protocol = encode({
			schema: 1,
			files: Object.fromEntries(
				await Promise.all(
					budgets.mixedProtocolFiles.map(async (name) => [
						name,
						sha(await readFile(new URL(name, import.meta.url))),
					]),
				),
			),
		});
		const now = Date.now();
		const beforeContext = encode({
			...input.beforeContext,
			mixedArtifactSha256: sha(before),
			protocolSha256: sha(protocol),
			startedAt: new Date(now - 2000).toISOString(),
			finishedAt: new Date(now - 1000).toISOString(),
		});
		for (const [name, value] of Object.entries({
			"before.json": before,
			"head.json": head,
			"protocol.json": protocol,
			"before-context.json": beforeContext,
			"head-manifest.json": headManifest,
			"head-browser-control.json": headMetadata,
		}))
			await writeFile(join(folder, name), value);
		await budgets.runMixedBudgetCommand([
			"derive",
			"--before",
			join(folder, "before.json"),
			"--protocol",
			join(folder, "protocol.json"),
			"--before-context",
			join(folder, "before-context.json"),
			"--expected-before-build",
			BEFORE,
			"--expected-head-build",
			HEAD,
			"--head-app-manifest",
			join(folder, "head-manifest.json"),
			"--head-browser-control",
			join(folder, "head-browser-control.json"),
			"--out",
			join(folder, "budgets.json"),
		]);
		const registrationBytes = await readFile(join(folder, "budgets.json")),
			registration = JSON.parse(registrationBytes),
			start = Date.parse(registration.registeredAt) + 1;
		await writeFile(
			join(folder, "head-context.json"),
			encode({
				...input.beforeContext,
				fullBuild: HEAD,
				conditions: { ...input.beforeContext.conditions, browserControl: input.expectedHeadBrowserControl,
					browserControlMetadataFileSha256: input.expectedHeadBrowserControlFileSha256 },
			phase: "release",
			observationTimeoutMs: 30000,
				mixedArtifactSha256: sha(head),
				protocolSha256: sha(protocol),
				firstControlledHeadStartedAt: new Date(start).toISOString(),
				startedAt: new Date(start).toISOString(),
				finishedAt: new Date(start + 1).toISOString(),
			}),
		);
		await new Promise((done) => setTimeout(done, 3));
		const args = [
			"compare",
			"--budgets",
			join(folder, "budgets.json"),
			"--budget-sha256",
			sha(registrationBytes),
			"--before",
			join(folder, "before.json"),
			"--head",
			join(folder, "head.json"),
			"--protocol",
			join(folder, "protocol.json"),
			"--head-context",
			join(folder, "head-context.json"),
			"--out",
			join(folder, "comparison.json"),
		];
		await budgets.runMixedBudgetCommand(args);
		assert.equal(
			JSON.parse(await readFile(join(folder, "comparison.json"))).passed,
			true,
		);
		registration.clock.in.ceilingMs++;
		await writeFile(join(folder, "budgets.json"), encode(registration));
		await assert.rejects(
			budgets.runMixedBudgetCommand(args),
			/externally registered budget/,
		);
		assert.equal(await readFile(join(folder, "before.json"), "utf8"), before);
		assert.equal(
			await readFile(join(folder, "before-context.json"), "utf8"),
			beforeContext,
		);
	} finally {
		assert.equal(dirname(folder), resolve(tmpdir()));
		await rm(folder, { recursive: true, force: true });
	}
});
