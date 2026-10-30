import {testEmptyTemporaryValues,testTeamAnnualGolden,testTeamAnnualSource} from "./control-cancellation-test-fixtures.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import * as budgets from "./mixed-clock-budgets.mjs";
import { nextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";
import { cleanObservationPolicy, cleanEvidencePolicy } from "./clean-evidence.mjs";
import { testBrowserEvidence, testBrowserMetadata, testBrowserBinding } from "./control-cancellation-test-fixtures.mjs";
import { mixedBrowserWorkScope } from "./browser-control-collector.mjs";
import { mixedFailureOccurrenceCensus, mixedNativeProgressPolicy, mixedNativeAuthorityDigest, mixedNativeProgressVector,teamAnnualModule,teamAnnualWorkers } from "./control-cancellation-evidence.mjs";
import { createPrincipalEpochObserver } from "./browser-control-collector.mjs";
import { createProxyHeaderCensus,createProxyHeaderLifecycle,proxyHeaderPrefix } from "./proxy-header-census.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";

const BEFORE = "456d28b2da4437662ae8f625a1df6756bff031fe";
const HEAD = "de0b1a128b384196c7c93ac69cd5324e8d0cbbd8";
const hash = "a".repeat(64);
const id = (n) => n.toString(16).padStart(32, "0");
const actors = ["large-admin", "small-admin", "small-manager", "large-manager"];
const metadataFor = (build) => ({ ...testBrowserMetadata(), compiledManifestSha256: (build === HEAD ? "e" : "d").repeat(64) });
const metadataFileHash = (build) => (build === HEAD ? "f" : "c").repeat(64);
function transport(actor,build) {
	const counts = () => ({
		upstreamSocketPolicy: { protocol: "no-idle-upstream-sockets-v1", keepAlive: false, maxSockets: 64, retries: 0 },
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
		browserControlEvidence: fastMixedEvidence(id(actors.indexOf(actor) + 1),build),
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
// Entirely synthetic zero-failure fast-guard cuts, independent of any actual capture.
function fastMixedEvidence(contextId,build,files=Object.fromEntries(budgets.mixedProtocolFiles.map(name=>[name,hash])),metadata=metadataFor(build)){
 const origin="http://localhost:58792",sha=value=>createHash("sha256").update(value).digest("hex"),evidence=testBrowserEvidence(contextId),principal=createPrincipalEpochObserver(contextId,{origin});
 principal.start([{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}]);
 const census=createProxyHeaderCensus({contextId}),life=createProxyHeaderLifecycle({proxyInstanceId:"f".repeat(32),originSha256:sha(origin),allowedOriginSha256:[sha(origin)]});
 const context={protocol:"qualified-known-extra-native-context-v1",contextId,originSha256:sha(origin),workerScriptSha256:sha(origin+"/sw.js"),rootScopeSha256:sha(origin+"/"),operatorFile:"mixed-load-probe.mjs",binding:testBrowserBinding(build,metadata),protocolSources:files,principalEpoch:principal.snapshot(),headerCensus:census.snapshot(),headerPrefix:proxyHeaderPrefix(census.snapshot(),life.snapshot()),environment:{temporaryValues:testEmptyTemporaryValues(contextId),workerTargets:{events:[]}}};
 const vector=mixedNativeProgressVector({nativeContext:context,browserEventOrdinal:0,failures:[]});
 const checks=[{ordinal:1,begin:vector,returned:structuredClone(vector),checkpointOrdinal:null,prefixSha256:null}];
 evidence.mixedProgress={protocol:"mixed-native-progress-observations-v1",candidateRepresentationProtocol:mixedNativeProgressPolicy.candidateRepresentationProtocol,contextId,authoritySha256:mixedNativeAuthorityDigest(context),guardChecks:1,attempted:0,failed:0,overflow:0,retainedBytes:Buffer.byteLength(JSON.stringify(checks)),checks,prefixes:[]};
 life.close();census.close();principal.end([{name:"session",value:"synthetic",domain:"localhost",path:"/",httpOnly:true}]);context.principalEpoch=principal.snapshot();context.environment.workerTargets.scopeClosed=true;context.headerCensus=census.snapshot();delete context.headerPrefix;evidence.measured.nativeContext=context;evidence.allPhase.nativeContext=structuredClone(context);evidence.browserEventOrdinal=0;evidence.proxyHeaderLifecycle=life.snapshot();evidence.browserFailureOccurrences=mixedFailureOccurrenceCensus({contextId,scopeClosed:true,browserEventOrdinal:0,records:[]});evidence.mixedDocumentJournal={protocol:"actual-cdp-document-journal-v1",contextId,installed:true,currentGeneration:1,executionEventOrdinal:1,documentEventOrdinal:1,errors:0,overflow:0,closed:true,executionEvents:[{ordinal:1,event:"created",executionContextId:1,uniqueId:"unique",frameId:"frame",isDefault:true}],documents:[{ordinal:1,requestId:"doc",frameId:"frame",loaderId:"loader",originSha256:sha(origin),documentGeneration:contextId+":1"}]};return evidence;
}
function attachAnnual(run,actionId){for(const row of run.transports){const receipt=row.actor==="small-admin"?testTeamAnnualGolden(row.browserControlEvidence.allPhase.nativeContext,"http://localhost:58792",run.requestTimeoutMs,actionId):null;row.browserControlEvidence.annualTeam={protocol:"annual-team-selection-observation-v1",contextId:row.contextId,closed:true,armed:receipt!==null,consumed:receipt!==null,errors:0,overflow:0,pending:0,retainedBytes:receipt?1048576:0,receipt};if(receipt)run.annualTeamGolden=receipt;}return run;}
function refreshProgress(run,files=Object.fromEntries(budgets.mixedProtocolFiles.map(name=>[name,hash])),actionId){for(const row of run.transports)row.browserControlEvidence=fastMixedEvidence(row.contextId,run.sourceCommit,files,run.browserControl);attachAnnual(run,actionId);}
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
	return attachAnnual({
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
		nativeProgressPolicy:mixedNativeProgressPolicy,
		browserFailureScope: mixedBrowserWorkScope,
		browserControl: testBrowserBinding(build,metadataFor(build)),
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
		transports: actors.map(actor=>transport(actor,build)),
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
	});
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
	refreshProgress(input.before);
	const budget=budgets.deriveMixedClockBudgets(input);
	assert.equal(budget.expectedOrigin,input.beforeContext.conditions.origin);
	const head=fixture(HEAD);head.browserControl.nativePublicSources=publicSources(HEAD);refreshProgress(head);
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
		(r) => delete r.transports[0].traceTransport.upstreamSocketPolicy,
		(r) => { r.transports[0].traceTransport.upstreamSocketPolicy.keepAlive = true; },
		(r) => { r.transports[0].traceTransport.browserInitialization.upstreamSocketPolicy.maxSockets = 65; },
		(r) => { r.transports[0].traceTransport.upstreamSocketPolicy.retries = 1; },
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
		headValue.browserControl = testBrowserBinding(HEAD,input.expectedHeadBrowserControl);
		headValue.browserControlMetadataFileSha256 = input.expectedHeadBrowserControlFileSha256;

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
		refreshProgress(input.before,JSON.parse(protocol).files);refreshProgress(headValue,JSON.parse(protocol).files);
		const before = encode(input.before), head = encode(headValue);
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
		await mkdir(join(folder,"server"));
		await writeFile(join(folder,"server/server-reference-manifest.json"),JSON.stringify({node:{["40"+"a".repeat(40)]:{filename:teamAnnualModule,exportedName:"getTeamPerformanceData",workers:Object.fromEntries(teamAnnualWorkers.map(key=>[key,{moduleId:1,async:true}]))}},edge:{}}));
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


test("mixed derivation requires bound fast-guard ledgers in all four contexts",()=>{
 for(const mutate of [r=>delete r.transports[0].browserControlEvidence.browserFailureOccurrences,r=>r.transports[0].browserControlEvidence.browserFailureOccurrences.contextId="another",r=>r.transports[0].browserControlEvidence.browserFailureOccurrences.censusSha256="0".repeat(64),r=>delete r.nativeProgressPolicy,r=>r.nativeProgressPolicy={...r.nativeProgressPolicy,observerCeilingMs:11000},r=>delete r.transports[0].browserControlEvidence.mixedDocumentJournal,r=>r.transports[0].browserControlEvidence.mixedDocumentJournal.closed=false,r=>delete r.transports[0].browserControlEvidence.mixedProgress,r=>r.transports[0].browserControlEvidence.mixedProgress=null,r=>r.transports[0].browserControlEvidence.mixedProgress.guardChecks=0,r=>r.transports[0].browserControlEvidence.mixedProgress.checks.pop(),r=>r.transports[0].browserControlEvidence.mixedProgress=r.transports[1].browserControlEvidence.mixedProgress,r=>r.transports[0].browserControlEvidence.mixedProgress.authoritySha256="0".repeat(64),r=>r.transports[0].browserControlEvidence.measured.nativeContext.protocolSources={},r=>r.transports[0].browserControlEvidence.mixedProgress.checks[0].returned.failureIds.push("new-unknown")]){
  const input=inputs();mutate(input.before);assert.throws(()=>budgets.deriveMixedClockBudgets(input),/four closed strict transports|qualified browser control run metadata/);
 }
});

test('both mixed phases require the selected TEAM CORE even when all browser raw counts are zero',()=>{
	for(const build of [BEFORE,HEAD]){
		const run=fixture(build),phase=build===BEFORE?'baseline':'release',authority={runtime:{build,browserControl:run.browserControl},protocolSources:run.transports[0].browserControlEvidence.measured.nativeContext.protocolSources,origin:'http://localhost:58792'};
		assert.doesNotThrow(()=>budgets.validateMixedClockRun(run,build,phase,authority));
		const contradicted=structuredClone(run);contradicted.transports[1].browserControlEvidence.allPhase.nativeContext.principalEpoch.after.sha256='0'.repeat(64);assert.equal(contradicted.transports[1].browserControlEvidence.allPhase.nativeContext.principalEpoch.matchesAtBoundaries,true);assert.throws(()=>budgets.validateMixedClockRun(contradicted,build,phase,authority),/mandatory selected annual TEAM/);
		for(const mutate of [r=>delete r.annualTeamGolden,r=>r.annualTeamGolden=null,r=>r.annualTeamGolden.selection.deadlineMs+=1,r=>delete r.transports[1].browserControlEvidence.annualTeam,r=>r.transports[1].browserControlEvidence.annualTeam.receipt=null,r=>r.transports[1].browserControlEvidence.annualTeam.consumed=false,r=>r.transports[1].browserControlEvidence.annualTeam.closed=false,r=>r.transports[1].browserControlEvidence.annualTeam.pending=1,r=>r.transports[1].browserControlEvidence.annualTeam=r.transports[0].browserControlEvidence.annualTeam,r=>r.annualTeamGolden.projection.employees=7,r=>r.annualTeamGolden.packet.teamAnnualProjection=null,r=>r.annualTeamGolden.packet.requestBodyFacts.actualEOF=false]){
			const changed=structuredClone(run);mutate(changed);assert.throws(()=>budgets.validateMixedClockRun(changed,build,phase,authority),/mandatory selected annual TEAM/);
		}
	}
});

function phaseCertificateInput(){
	const input=inputs(),build="4b911c1788b1f8b41d893c38fb6d0c644c41ec1c",manifest="510d800e5d84a9a7859b5e59cb5187c25ac45891a910a63411f64a2bd6154e0d",buildHash="d4f596b441757de46ffda618d524ba50196772b10183877c8fbba0a2481736f0";
	const clock=(compiledBuild,compiledManifestSha256,phase)=>({protocol:"source-qualified-legacy-header-readiness-v1",compiledBuild,compiledManifestSha256,originSha256:createHash('sha256').update(input.beforeContext.conditions.origin).digest('hex'),phase,review:{path:`C:/synthetic/${phase}-review.json`,sha256:phase==='baseline'?'1'.repeat(64):'2'.repeat(64)},buildRecord:{path:`C:/synthetic/${phase}-build.json`,sha256:phase==='baseline'?buildHash:'3'.repeat(64)}});
	const before={...metadataFor(BEFORE),compiledManifestSha256:manifest,originalTeamSource:{protocol:"original-team-source-configuration-v1",profileId:"original-team-admin-guard-4b-v1",phase:"baseline",compiledBuild:build,compiledManifestSha256:manifest,buildRecordPath:"C:/synthetic/baseline-build.json",buildRecordSha256:buildHash},legacyClockReadiness:clock(build,manifest,'baseline'),requestShapeDiagnostic:{protocol:"request-shape-diagnostic-v1",compiledBuild:build,compiledManifestSha256:manifest,actionRegistrySha256:'4'.repeat(64),actionHeaderSha256:'5'.repeat(64),actionName:'getTeamPerformanceData'}};
	const after={...metadataFor(HEAD),legacyClockReadiness:clock(HEAD,metadataFor(HEAD).compiledManifestSha256,'release')};
	input.expectedBeforeBuild=build;input.beforeContext.fullBuild=build;input.beforeContext.conditions.browserControl=before;input.before.sourceCommit=build;input.before.liveVersion=build.slice(0,7);input.before.browserControl=testBrowserBinding(build,before);refreshProgress(input.before);input.expectedHeadBrowserControl=after;
	return input;
}
function phaseComparison(input,budget,actionId){
	const head=fixture(HEAD);head.browserControl=testBrowserBinding(HEAD,input.expectedHeadBrowserControl);refreshProgress(head,undefined,actionId);
	return {budgets:budget,budgetSha256:hash,expectedBudgetSha256:hash,before:input.before,beforeSha256:hash,head,headSha256:hash,protocol:input.protocol,protocolSha256:hash,operatorSha256:hash,headContextSha256:hash,observedAt:"2026-10-25T04:00:00.000Z",headContext:{...input.beforeContext,fullBuild:HEAD,conditions:{...input.beforeContext.conditions,browserControl:input.expectedHeadBrowserControl,browserControlMetadataFileSha256:input.expectedHeadBrowserControlFileSha256},phase:"release",observationTimeoutMs:30000,firstControlledHeadStartedAt:"2026-10-25T02:00:00.000Z",startedAt:"2026-10-25T02:00:00.000Z",finishedAt:"2026-10-25T03:00:00.000Z"}};
}
test('valid distinct phase source configurations share conditions without sharing their exact certificates',()=>{
	const input=phaseCertificateInput(),budget=budgets.deriveMixedClockBudgets(input),comparison=phaseComparison(input,budget);
	assert.equal(budgets.compareMixedClockBudgets(comparison).passed,true);
	assert.equal(budget.policy.version,9);assert.equal(budget.clock.in.ceilingMs,500);assert.equal(budget.clock.out.ceilingMs,630);
});

test('phase configuration normalization cannot admit missing swapped or altered actual certificates',()=>{
	for(const field of ['legacyClockReadiness','originalTeamSource','requestShapeDiagnostic'])for(const mutation of ['missing','altered','swapped']){
		const input=phaseCertificateInput();
		if(mutation==='missing')delete input.before.browserControl[field];
		else if(mutation==='altered')input.before.browserControl[field]={...input.before.browserControl[field],unregistered:'changed'};
		else input.before.browserControl[field]=input.expectedHeadBrowserControl[field];
		refreshProgress(input.before);assert.throws(()=>budgets.deriveMixedClockBudgets(input),undefined,field+':'+mutation);
	}
	const input=phaseCertificateInput(),budget=budgets.deriveMixedClockBudgets(input);
	for(const mutation of ['missing','altered','swapped']){
		const comparison=phaseComparison(input,budget);
		if(mutation==='missing')delete comparison.head.browserControl.legacyClockReadiness;
		else if(mutation==='altered')comparison.head.browserControl.legacyClockReadiness.review.sha256='9'.repeat(64);
		else comparison.head.browserControl.legacyClockReadiness=structuredClone(input.beforeContext.conditions.browserControl.legacyClockReadiness);
		refreshProgress(comparison.head);assert.throws(()=>budgets.compareMixedClockBudgets(comparison),undefined,'HEAD:'+mutation);
	}
});

test('distinct compiled annual action identities remain phase-bound while their shared method is comparable',()=>{
	const input=phaseCertificateInput(),before=input.beforeContext.conditions.browserControl,after=input.expectedHeadBrowserControl,otherAction='40'+'b'.repeat(40);
	before.teamAnnualAction=testTeamAnnualSource(input.expectedBeforeBuild,before.compiledManifestSha256);after.teamAnnualAction=testTeamAnnualSource(HEAD,after.compiledManifestSha256);after.teamAnnualAction.registrySha256='8'.repeat(64);after.teamAnnualAction.actionHeaderSha256=createHash('sha256').update(otherAction).digest('hex');
	input.before.browserControl=testBrowserBinding(input.expectedBeforeBuild,before);refreshProgress(input.before);
	const budget=budgets.deriveMixedClockBudgets(input),comparison=phaseComparison(input,budget,otherAction);
	assert.notEqual(before.teamAnnualAction.compiledBuild,after.teamAnnualAction.compiledBuild);assert.notEqual(before.teamAnnualAction.compiledManifestSha256,after.teamAnnualAction.compiledManifestSha256);assert.notEqual(before.teamAnnualAction.registrySha256,after.teamAnnualAction.registrySha256);assert.notEqual(before.teamAnnualAction.actionHeaderSha256,after.teamAnnualAction.actionHeaderSha256);
	assert.equal(budgets.compareMixedClockBudgets(comparison).passed,true);
	for(const field of ['compiledBuild','compiledManifestSha256','registrySha256','actionHeaderSha256']){const changed=structuredClone(comparison);changed.head.browserControl.teamAnnualAction[field]=before.teamAnnualAction[field];refreshProgress(changed.head,undefined,otherAction);assert.throws(()=>budgets.compareMixedClockBudgets(changed));}
	for(const field of ['protocol','moduleSha256','workersSha256','exportName']){const changed=structuredClone(comparison);changed.headContext.conditions.browserControl.teamAnnualAction[field]='changed';assert.throws(()=>budgets.compareMixedClockBudgets(changed));}
});

test('registered phase metadata is a snapshot and cannot borrow later caller certificate mutations',()=>{
	const input=phaseCertificateInput(),before=structuredClone(input.beforeContext.conditions.browserControl),after=structuredClone(input.expectedHeadBrowserControl),budget=budgets.deriveMixedClockBudgets(input);
	input.beforeContext.conditions.browserControl.legacyClockReadiness.review.sha256='0'.repeat(64);input.expectedHeadBrowserControl.legacyClockReadiness.review.sha256='0'.repeat(64);
	assert.deepEqual(budget.expectedBeforeBrowserControl,before);assert.deepEqual(budget.expectedHeadBrowserControl,after);
	assert.throws(()=>budgets.compareMixedClockBudgets(phaseComparison(input,budget)));
});

test('phase normalization retains shared observer policy public-worker and unknown condition mismatches',()=>{
	for(const mutate of [c=>c.temporaryValueObservation.annualTeam.deadline='changed',c=>c.policy.version=999]){
		const input=phaseCertificateInput();mutate(input.expectedHeadBrowserControl);assert.throws(()=>budgets.deriveMixedClockBudgets(input));
	}
	const input=phaseCertificateInput();
	const publicSources=(build,manifest)=>({protocol:'qualified-serving-worker-sources-v1',compiledBuild:build,compiledManifestSha256:manifest,files:['sw.js','lib/offline-queue-db.js','lib/sync-service.js','lib/clock-command-dispatch.js'].map(file=>({file,bytes:12,sha256:hash,gitBlob:'a'.repeat(40)}))});
	input.beforeContext.conditions.browserControl.nativePublicSources=publicSources(input.expectedBeforeBuild,input.before.browserControl.compiledManifestSha256);input.before.browserControl.nativePublicSources=structuredClone(input.beforeContext.conditions.browserControl.nativePublicSources);refreshProgress(input.before);
	input.expectedHeadBrowserControl.nativePublicSources=publicSources(HEAD,input.expectedHeadBrowserControl.compiledManifestSha256);input.expectedHeadBrowserControl.nativePublicSources.files[0].sha256='b'.repeat(64);
	const budget=budgets.deriveMixedClockBudgets(input);assert.throws(()=>budgets.compareMixedClockBudgets(phaseComparison(input,budget)),/identical conditions/);
	for(const field of ['unknownSharedObserver','unknownSharedSource']){const candidate=phaseCertificateInput();candidate.expectedHeadBrowserControl[field]='head-only';const registered=budgets.deriveMixedClockBudgets(candidate);assert.throws(()=>budgets.compareMixedClockBudgets(phaseComparison(candidate,registered)),/identical conditions/);}
});
