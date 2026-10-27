/** File-only prospective budgets for complete single-app mixed clock cohorts. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isNextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";
import { cleanApplicationEvidence, cleanObservationPolicy, observationTimeoutMs, cleanEvidencePolicy, cleanBrowserContextEvidence } from "./clean-evidence.mjs";
import { mixedNativeProgressPolicy, knownBrowserControlMetadata, matchingBrowserControlBinding,knownNativePublicSources,validateMixedTeamAnnualGolden } from "./control-cancellation-evidence.mjs";
import { mixedBrowserWorkScope, readBrowserControlBinding } from "./browser-control-collector.mjs";
import {
	clockObservationIsComplete,
	mixedTransportIsComplete,
	reconcileMixedNative,
} from "./mixed-load-observation.mjs";

import { mixedProtocolFiles } from "./protocol-fingerprints.mjs";
export { mixedProtocolFiles } from "./protocol-fingerprints.mjs";
const policy = {
	version: 9,
	cleanEvidence: cleanEvidencePolicy,
	observation: cleanObservationPolicy,
	latency: { multiplier: 1.25, allowanceMs: 250, floorMs: 500 },
};
export function getMixedClockBudgetPolicyVersion() {
	return policy.version;
}
const actors = ["large-admin", "small-admin", "small-manager", "large-manager"];
const kinds = ["work", "team", "overtime"];
const check = (value, field) => {
	if (!value) throw Error(`Incomplete mixed evidence: ${field}`);
};
const finite = (value) => Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const canonical = (value) =>
	JSON.stringify(value, (_key, row) =>
		row && typeof row === "object" && !Array.isArray(row)
			? Object.fromEntries(
					Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
				)
			: row,
	);
const digest = (value) => createHash("sha256").update(value).digest("hex");
// Transitive validator bytes are bound separately from the measuring modules.
const conditionValidatorSha256 = digest(
	await readFile(
		new URL("./next-stream-completion-patch.mjs", import.meta.url),
	),
);
const sha = (value) =>
	typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fullBuild = (value) =>
	typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const isoTime = (value) => {
	check(
		typeof value === "string" &&
			/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
			Number.isFinite(Date.parse(value)),
		"UTC provenance timestamp",
	);
	return Date.parse(value);
};
const same = (a, b) => canonical(a) === canonical(b);
const commonConditions = (conditions) => {
	const result = structuredClone(conditions);
	delete result.browserControlMetadataFileSha256;
	if (result.browserControl) delete result.browserControl.compiledManifestSha256;
	for(const key of ["legacyClockReadiness","originalTeamSource","requestShapeDiagnostic"])if(result.browserControl)delete result.browserControl[key];
	if(result.browserControl?.teamAnnualAction)for(const key of ["compiledBuild","compiledManifestSha256","registrySha256","actionHeaderSha256"])delete result.browserControl.teamAnnualAction[key];
	if (result.browserControl?.nativePublicSources) {
		delete result.browserControl.nativePublicSources.compiledBuild;
		delete result.browserControl.nativePublicSources.compiledManifestSha256;
	}
	return result;
};
const distribution = (values) => {
	check(values.length && values.every(finite), "finite distribution");
	const ordered = [...values].sort((a, b) => a - b);
	return {
		samples: values.length,
		p50Ms: ordered[Math.ceil(ordered.length * 0.5) - 1],
		p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1],
	};
};
const clockSummary = (records) =>
	Object.fromEntries(
		["in", "out"].map((action) => [
			action,
			distribution(
				records
					.filter((row) => row.family === "clock" && row.action === action)
					.map((row) => row.clockReadyMs),
			),
		]),
	);

function validateProtocol(protocol) {
	check(
		protocol?.schema === 1 &&
			protocol.files &&
			same(
				Object.keys(protocol.files).sort(),
				[...mixedProtocolFiles].sort(),
			) &&
			Object.values(protocol.files).every(sha),
		"complete measuring source hashes",
	);
}
function validateConditions(value) {
	check(knownBrowserControlMetadata(value?.browserControl) && sha(value.browserControlMetadataFileSha256), "actual browser control metadata and file identity");
	check(
		isNextStreamCompletionPatch(value?.nextStreamCompletionPatch),
		"common Next patch",
	);
	check(
		value &&
			value.topology === "single app" &&
			same(value.actors, actors) &&
			value.poolMax === 10 &&
			value.poolAcquisitionTimeoutMs === cleanObservationPolicy.sharedPoolAcquisitionTimeoutMs &&
			same(value.observation, cleanObservationPolicy) &&
			value.clockPairs === 20 &&
			value.annualYear === 2025 &&
			value.analyticsMaxRequestsPerCallerPerCommand === 100 &&
			value.telemetryDrain === "once-after-condition" &&
			same(value.viewport, { width: 1280, height: 900 }) &&
			value.timezone === "Europe/Berlin" &&
			value.locale === "en" &&
			value.origin === "http://localhost:58792" &&
			value.cacheWarming === "annual-public-preparation-complete",
		"fixed mixed conditions",
	);
	check(
		typeof value.browser === "string" &&
			/^Chrome\//.test(value.browser) &&
			typeof value.node === "string" &&
			/^v\d+\./.test(value.node),
		"actual browser and Node context",
	);
	check(
		value.hardware &&
			["platform", "arch", "cpuModel"].every(
				(key) => typeof value.hardware[key] === "string" && value.hardware[key],
			) &&
			integer(value.hardware.logicalCpus) &&
			value.hardware.logicalCpus > 0 &&
			integer(value.hardware.memoryBytes) &&
			value.hardware.memoryBytes > 0,
		"actual hardware context",
	);
	check(
		value.fixture &&
			typeof value.fixture.version === "string" &&
			value.fixture.version &&
			same(value.fixture.populations, [8, 200]) &&
			/^\d{4}-\d\d-\d\d$/.test(value.fixture.rangeStart) &&
			/^\d{4}-\d\d-\d\d$/.test(value.fixture.rangeEnd) &&
			value.fixture.rangeStart <= value.fixture.rangeEnd,
		"actual fixture context",
	);
}
function validateContext(context, artifactSha, build, protocolSha, phase) {
	check(
		context?.schema === 1 &&
			context.mixedArtifactSha256 === artifactSha &&
			context.fullBuild === build &&
			context.phase === phase &&
			context.observationTimeoutMs === observationTimeoutMs(phase) &&
			context.protocolSha256 === protocolSha,
		"independent artifact/source/protocol context",
	);
	check(
		isoTime(context.startedAt) < isoTime(context.finishedAt),
		"actual run interval",
	);
	validateConditions(context.conditions);
}
function validateRecordedBrowser(run, context) {
	check(matchingBrowserControlBinding({ build: context.fullBuild, browserControl: context.conditions.browserControl }, run.browserControl) &&
		run.browserControlMetadataFileSha256 === context.conditions.browserControlMetadataFileSha256,
		"actual compiled/browser control admission matches context");
	check(
		run.transports.every(
			(row) =>
				row.traceTransport.browserInitialization.launch.browserVersion ===
				context.conditions.browser,
		),
		"actual browser matches run context",
	);
}

/** Validate every record and every registered native group, never a selected success subset. */
export function validateMixedClockRun(run, build, phase = "baseline",authority) {
	check(validateMixedTeamAnnualGolden(run,authority?.origin),"mandatory selected annual TEAM natural-EOF golden CORE");
	check(same(run?.nativeProgressPolicy,mixedNativeProgressPolicy) && same(run?.cleanEvidencePolicy, cleanEvidencePolicy) && run.browserFailureScope === mixedBrowserWorkScope &&
		matchingBrowserControlBinding({ build, browserControl: run.browserControl }, run.browserControl) && sha(run.browserControlMetadataFileSha256),
		"qualified browser control run metadata");
	check(
		fullBuild(build) &&
			run?.sourceCommit === build &&
			typeof run.liveVersion === "string" &&
			/^[a-f0-9]{7,40}$/.test(run.liveVersion) &&
			build.startsWith(run.liveVersion),
		"corresponding full/live build identity",
	);
	check(
		run.version === 2 &&
			run.topology === "single app" &&
			run.collectorProtocol === "z8-fixture-otlp-collector-v2" &&
			run.traceTransport === "context-loopback-proxy-v1" &&
			run.browserPolicy === "isolated-profile-no-prediction-v1" &&
			run.semanticTraceIdentities === 56 &&
			run.activeRegistrationLimit === 64 &&
			run.retainedIdentityLimit === 10000 &&
			run.userConcurrency === 4 &&
			run.poolMax === 10 &&
			run.clockPairs === 20 &&
			run.clockActor === actors[3] &&
			run.analyticsMaxRequestsPerCallerPerCommand === 100 &&
			run.phase === phase &&
			observationTimeoutMs(phase) !== undefined &&
			run.requestTimeoutMs === observationTimeoutMs(phase) &&
			run.poolAcquisitionTimeoutMs === cleanObservationPolicy.sharedPoolAcquisitionTimeoutMs,
		"operator protocol",
	);
	check(
		same(
			run.analyticsCallers,
			kinds.map((kind, index) => ({
				kind,
				actor: actors[index],
				range: "annual 2025",
			})),
		),
		"annual public callers",
	);
	check(
		run.success === true &&
			run.pairsCompleted === 20 &&
			run.stopped === false &&
			run.cleanupRequired === false &&
			run.unknownOutstanding === false &&
			run.completeCoverage === true &&
			run.browserClosed === true &&
			run.pageErrors === 0 &&
			run.userMaxInflight === 4 &&
			run.failureStage === null,
		"complete restored condition",
	);
	check(
		Array.isArray(run.records) &&
			run.records.every((row) => ["clock", "analytics"].includes(row.family)),
		"all command/analytics records",
	);
	const clocks = run.records.filter((row) => row.family === "clock");
	check(
		clocks.length === 40 &&
			new Set(clocks.map((row) => `${row.pair}/${row.action}`)).size === 40 &&
			new Set(clocks.map((row) => row.traceId)).size === 40 &&
			clocks.every(
				(row) =>
					integer(row.pair) &&
					row.pair >= 1 &&
					row.pair <= 20 &&
					["in", "out"].includes(row.action) &&
					clockObservationIsComplete(row) &&
					finite(row.headerPrepareMs) &&
					finite(row.workloadWindowMs) &&
					row.analyticsInflightAtCommandStart === 3,
			),
		"all twenty in/out pairs with real overlap",
	);
	check(
		run.transports?.length === 4 &&
			same(run.transports.map((row) => row.actor).sort(), [...actors].sort()) &&
			run.transports.every((row) => row.browserControlEvidence?.mixedProgress?.protocol === "mixed-native-progress-observations-v1" && mixedTransportIsComplete(row) && cleanApplicationEvidence(row.traceTransport.applicationEvidence) &&
				row.browserFailureScope === mixedBrowserWorkScope && cleanBrowserContextEvidence(row.contextId, row.browserControlEvidence, row.rawBrowserFailedRequests,authority)) &&
			new Set(run.transports.map((row) => row.contextId)).size === 4,
		"four closed strict transports",
	);
	check(
		run.analyticsWindows?.length === 4 &&
			run.analyticsWindows.every(
				(row, index) =>
					row.firstPair === index * 5 + 1 &&
					row.lastPair === index * 5 + 5 &&
					row.traceIds?.length === 3,
			),
		"semantic analytics windows",
	);
	const analytics = run.records.filter((row) => row.family === "analytics");
	for (const row of analytics) {
		const index = kinds.indexOf(row.kind),
			window = run.analyticsWindows[Math.floor((row.pair - 1) / 5)];
		check(
			index >= 0 &&
				row.actor === actors[index] &&
				["in", "out"].includes(row.action) &&
				integer(row.pair) &&
				row.pair >= 1 &&
				row.pair <= 20 &&
				row.traceId === window?.traceIds[index] &&
				row.success === true &&
				row.censored === false &&
				row.httpStatus === 200 &&
				finite(row.elapsedMs) &&
				integer(row.bytes) &&
				row.summary?.correct === true,
			"successful literal analytics record",
		);
		check(
			row.kind === "work"
				? row.summary.employees === 200 && row.summary.hours === 417600
				: row.kind === "team"
					? row.summary.employees === 8 && row.summary.hours === 16704
					: row.summary.overtimeHours === 0 &&
						integer(row.summary.weeks) &&
						row.summary.weeks > 0,
			"literal annual totals",
		);
	}
	for (let pair = 1; pair <= 20; pair++)
		for (const action of ["in", "out"])
			for (const kind of kinds) {
				const count = analytics.filter(
					(row) =>
						row.pair === pair && row.action === action && row.kind === kind,
				).length;
				check(
					count > 0 && count <= 100,
					"bounded successful reader coverage for every command",
				);
			}
	const rows = run.backendGroups,
		proofs = run.nativeCloseProof;
	check(
		rows?.length === 56 && proofs?.length === 56,
		"all fifty-six native identities",
	);
	const ids = rows.map((row) => row.traceId);
	check(run.transports.every((row) => ids.includes(row.contextId)), "browser work contexts are registered native identities");
	check(
		ids.every((value) => /^[a-f0-9]{32}$/.test(value)) &&
			new Set(ids).size === 56 &&
			new Set(proofs.map((row) => row.traceId)).size === 56 &&
			proofs.every((row) => ids.includes(row.traceId)),
		"unique exact native identities",
	);
	const commandIds = clocks.map((row) => row.traceId),
		groupIds = run.analyticsWindows.flatMap((row) => row.traceIds);
	check(
		new Set([...commandIds, ...groupIds]).size === 52 &&
			[...commandIds, ...groupIds].every((value) => ids.includes(value)),
		"command/group/preparation identity ownership",
	);
	const native = run.nativeRunCoverage;
	check(
		native?.complete === true &&
			native.standard?.complete === true &&
			same(native.registration, {
				began: true,
				closed: true,
				traceCount: 56,
				protocol: "z8-fixture-otlp-collector-v2",
			}),
		"closed standard whole-run native proof",
	);
	const reconciled = reconcileMixedNative({
		before: native.before,
		after: native.after,
		rows,
		ids,
	});
	check(reconciled.complete, "recomputed driver/SDK/received/metrics proof");
	check(
		[
			"driverQueryCount",
			"nativeQueryStartedCount",
			"nativeQueryEndedCount",
			"observedQueryCount",
		].every((key) => native.standard[key] === reconciled.driverQueries) &&
			native.standard.pendingNativeQueries === 0 &&
			native.standard.activeTraces === 0 &&
			native.standard.allReceivedTracesReconciled === true,
		"retained standard reconciliation counters",
	);
	for (const proof of proofs) {
		const row = rows.find((row) => row.traceId === proof.traceId);
		check(
			proof.complete === true &&
				proof.driverComplete === true &&
				proof.drained === true &&
				proof.unattributedNativeSpans === 0 &&
				proof.serverBalance === 0 &&
				integer(proof.serverStarted) &&
				proof.serverStarted === proof.serverEnded &&
				finite(proof.lastActivityAgeMs) &&
				finite(proof.drainElapsedMs),
			"complete balanced server drain proof",
		);
		let total = 0;
		for (const scope of ["http", "next", "other"]) {
			const count = proof.serverScopes?.[scope];
			check(
				count && integer(count.started) && count.started === count.ended,
				"fixed server scope balance",
			);
			total += count.started;
		}
		check(total === proof.serverStarted, "server scope sum");
		for (const [key, value] of Object.entries({
			queries: row.observedQueryCount,
			acquisitions: row.observedPoolAcquisitions,
			cache: row.cacheHits + row.cacheMisses,
		}))
			check(
				proof[key] === value &&
					proof.started?.[key] === value &&
					proof.ended?.[key] === value,
				"per-identity native accounting",
			);
		check(
			proof.driverQueries === row.observedQueryCount,
			"per-identity driver proof",
		);
	}
	return {
		clock: clockSummary(run.records),
		descriptive: {
			commandResponseMs: distribution(
				clocks.map((row) => row.commandResponseMs),
			),
			headerPrepareMs: distribution(clocks.map((row) => row.headerPrepareMs)),
			workloadWindowMs: distribution(clocks.map((row) => row.workloadWindowMs)),
			analyticsResponses: analytics.length,
			analyticsResponseMs: distribution(analytics.map((row) => row.elapsedMs)),
			decodedUtf8ResponseBytes: analytics.reduce(
				(sum, row) => sum + row.bytes,
				0,
			),
			backendSemanticGroups: rows.length,
			backend: Object.fromEntries(
				[
					"queryCount",
					"queryDurationMs",
					"rowsRetrieved",
					"poolWaitMs",
					"cacheHits",
					"cacheMisses",
					"observedPoolAcquisitions",
				].map((key) => [key, rows.reduce((sum, row) => sum + row[key], 0)]),
			),
			maximumGroupEventLoopDelayMs: Math.max(
				...rows.map((row) => row.eventLoopDelayMs),
			),
			cpuRss: {
				available: false,
				reason:
					"No validated process sampler in the current mixed protocol; no zero substituted",
			},
		},
	};
}

export function deriveMixedClockBudgets(input) {
	const {
		before,
		beforeSha256,
		beforeContext,
		beforeContextSha256,
		protocol,
		protocolSha256,
		expectedBeforeBuild,
		expectedHeadBuild,
		expectedHeadBrowserControl,
		expectedHeadBrowserControlFileSha256,
		operatorSha256,
		registeredAt,
	} = input;
	check(
		[beforeSha256, beforeContextSha256, protocolSha256, operatorSha256].every(
			sha,
		),
		"input hashes",
	);
	validateProtocol(protocol);
	check(
		fullBuild(expectedBeforeBuild) &&
			fullBuild(expectedHeadBuild) &&
			expectedBeforeBuild !== expectedHeadBuild,
		"explicit different full before/head pins",
	);
	validateContext(
		beforeContext,
		beforeSha256,
		expectedBeforeBuild,
		protocolSha256,
		"baseline",
	);
	check(knownBrowserControlMetadata(expectedHeadBrowserControl) && sha(expectedHeadBrowserControlFileSha256) &&
		Object.hasOwn(expectedHeadBrowserControl,"nativePublicSources") === Object.hasOwn(beforeContext.conditions.browserControl,"nativePublicSources") &&
		(!expectedHeadBrowserControl.nativePublicSources || knownNativePublicSources(expectedHeadBrowserControl.nativePublicSources,expectedHeadBuild,expectedHeadBrowserControl.compiledManifestSha256)) &&
		["browserRevision", "compiledCachedNavigations"].every((key) => expectedHeadBrowserControl[key] === beforeContext.conditions.browserControl[key]),
		"independently pinned common head browser control method");
	check(
		isoTime(registeredAt) > isoTime(beforeContext.finishedAt),
		"registration after complete original",
	);
	const summary = validateMixedClockRun(before, expectedBeforeBuild,"baseline",{runtime:{build:expectedBeforeBuild,browserControl:beforeContext.conditions.browserControl},protocolSources:protocol.files,origin:beforeContext.conditions.origin});
	validateRecordedBrowser(before, beforeContext);
	return {
		schema: 1,
		kind: "single-app-mixed-clock-budgets",
		policy: structuredClone(policy),
		registeredAt,
		beforeSha256,
		beforeContextSha256,
		protocolSha256,
		protocolFiles: { ...protocol.files },
		operatorSha256,
		conditionValidatorSha256,
		expectedBeforeBuild,
		expectedHeadBuild,
		expectedOrigin:beforeContext.conditions.origin,
		expectedBeforeBrowserControl: structuredClone(beforeContext.conditions.browserControl),
		expectedBeforeBrowserControlFileSha256: beforeContext.conditions.browserControlMetadataFileSha256,
		expectedHeadBrowserControl:structuredClone(expectedHeadBrowserControl),
		expectedHeadBrowserControlFileSha256,
		conditionsSha256: digest(canonical(commonConditions(beforeContext.conditions))),
		clock: Object.fromEntries(
			Object.entries(summary.clock).map(([action, values]) => [
				action,
				{
					samples: 20,
					beforeP50Ms: values.p50Ms,
					beforeP95Ms: values.p95Ms,
					ceilingMs: Math.min(cleanObservationPolicy.optimizedTimeoutMs, Math.ceil(
						Math.max(values.p95Ms * 1.25, values.p95Ms + 250, 500),
					)),
				},
			]),
		),
		descriptiveBefore: summary.descriptive,
	};
}

export function compareMixedClockBudgets(input) {
	const {
		budgets,
		budgetSha256,
		expectedBudgetSha256,
		before,
		beforeSha256,
		head,
		headSha256,
		protocol,
		protocolSha256,
		operatorSha256,
		headContext,
		headContextSha256,
		observedAt,
	} = input;
	check(
		sha(budgetSha256) &&
			budgetSha256 === expectedBudgetSha256 &&
			[beforeSha256, headSha256, headContextSha256].every(sha),
		"externally registered budget and artifact hashes",
	);
	check(
		budgets?.schema === 1 &&
			budgets.kind === "single-app-mixed-clock-budgets" &&
			same(budgets.policy, policy) &&
			budgets.beforeSha256 === beforeSha256 &&
			budgets.protocolSha256 === protocolSha256 &&
			budgets.operatorSha256 === operatorSha256 &&
			budgets.conditionValidatorSha256 === conditionValidatorSha256 &&
			same(budgets.protocolFiles, protocol.files),
		"unchanged registration/source protocol",
	);
	validateProtocol(protocol);
	check(
		fullBuild(budgets.expectedBeforeBuild) &&
			fullBuild(budgets.expectedHeadBuild) &&
			budgets.expectedBeforeBuild !== budgets.expectedHeadBuild,
		"registered build transition",
	);
	validateContext(
		headContext,
		headSha256,
		budgets.expectedHeadBuild,
		protocolSha256,
		"release",
	);
	check(
		same(headContext.conditions.browserControl, budgets.expectedHeadBrowserControl) &&
			headContext.conditions.origin === budgets.expectedOrigin &&
			headContext.conditions.browserControlMetadataFileSha256 === budgets.expectedHeadBrowserControlFileSha256 &&
			same(before.browserControl.policy, budgets.expectedBeforeBrowserControl?.policy) &&
			matchingBrowserControlBinding({ build: budgets.expectedBeforeBuild, browserControl: budgets.expectedBeforeBrowserControl }, before.browserControl) &&
			before.browserControlMetadataFileSha256 === budgets.expectedBeforeBrowserControlFileSha256 &&
			digest(canonical(commonConditions(headContext.conditions))) === budgets.conditionsSha256 &&
			isoTime(headContext.firstControlledHeadStartedAt) >
				isoTime(budgets.registeredAt) &&
			isoTime(headContext.startedAt) >=
				isoTime(headContext.firstControlledHeadStartedAt),
		"independent identical conditions and prospective head start",
	);
	check(
		isoTime(headContext.finishedAt) <= isoTime(observedAt),
		"head run completed before comparison",
	);
	const original = validateMixedClockRun(before, budgets.expectedBeforeBuild,"baseline",{runtime:{build:budgets.expectedBeforeBuild,browserControl:budgets.expectedBeforeBrowserControl},protocolSources:protocol.files,origin:budgets.expectedOrigin}),
		current = validateMixedClockRun(head, budgets.expectedHeadBuild, "release",{runtime:{build:budgets.expectedHeadBuild,browserControl:budgets.expectedHeadBrowserControl},protocolSources:protocol.files,origin:budgets.expectedOrigin});
	validateRecordedBrowser(head, headContext);
	const clock = Object.fromEntries(
		["in", "out"].map((action) => {
			const baseline = original.clock[action],
				registered = budgets.clock[action];
			check(
				same(registered, {
					samples: 20,
					beforeP50Ms: baseline.p50Ms,
					beforeP95Ms: baseline.p95Ms,
					ceilingMs: Math.min(cleanObservationPolicy.optimizedTimeoutMs, Math.ceil(
						Math.max(baseline.p95Ms * 1.25, baseline.p95Ms + 250, 500),
					)),
				}),
				"recomputed registered clock ceiling",
			);
			return [
				action,
				{
					...registered,
					headP50Ms: current.clock[action].p50Ms,
					headP95Ms: current.clock[action].p95Ms,
					passed: current.clock[action].p95Ms <= registered.ceilingMs,
				},
			];
		}),
	);
	return {
		schema: 1,
		kind: "single-app-mixed-clock-comparison",
		comparedAt: observedAt,
		budgetSha256,
		beforeSha256,
		headSha256,
		headContextSha256,
		protocolSha256,
		conditionsSha256: budgets.conditionsSha256,
		expectedBeforeBuild: budgets.expectedBeforeBuild,
		expectedHeadBuild: budgets.expectedHeadBuild,
		clock,
		passed: Object.values(clock).every((row) => row.passed),
		descriptiveBefore: original.descriptive,
		descriptiveHead: current.descriptive,
		otherMetricsBudgeted: false,
	};
}

const options = {
	derive: [
		"before",
		"protocol",
		"before-context",
		"expected-before-build",
		"expected-head-build",
		"head-app-manifest",
		"head-browser-control",
		"out",
	],
	compare: [
		"budgets",
		"budget-sha256",
		"before",
		"head",
		"protocol",
		"head-context",
		"out",
	],
};
export function parseMixedBudgetArguments(args) {
	const [command, ...flags] = args,
		allowed = options[command];
	check(allowed, "derive or compare command");
	const parsed = {};
	for (let index = 0; index < flags.length; index += 2) {
		const name = flags[index]?.slice(2),
			value = flags[index + 1];
		check(
			flags[index]?.startsWith("--") &&
				allowed.includes(name) &&
				!Object.hasOwn(parsed, name) &&
				typeof value === "string" &&
				value &&
				!value.startsWith("--"),
			"allowlisted nonduplicate arguments",
		);
		parsed[name] = value;
	}
	check(
		allowed.every((name) => parsed[name]),
		"required arguments",
	);
	return { command, ...parsed };
}
export const writeMixedBudgetOutput = (path, value) =>
	writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
async function load(path) {
	const bytes = await readFile(path);
	return { value: JSON.parse(bytes), sha256: digest(bytes) };
}
export async function runMixedBudgetCommand(args) {
	const flags = parseMixedBudgetArguments(args),
		before = await load(flags.before),
		protocol = await load(flags.protocol);
	validateProtocol(protocol.value);
	for (const name of mixedProtocolFiles)
		check(
			digest(await readFile(new URL(name, import.meta.url))) ===
				protocol.value.files[name],
			"actual twelve-module snapshot",
		);
	const operatorSha256 = digest(await readFile(new URL(import.meta.url)));
	let result;
	if (flags.command === "derive") {
		const context = await load(flags["before-context"]);
		const headControl = await load(flags["head-browser-control"]);
		await readBrowserControlBinding({ plan: { runtime: { build: flags["expected-head-build"], browserControl: headControl.value } },
			manifestPath: flags["head-app-manifest"] });
		result = deriveMixedClockBudgets({
			before: before.value,
			beforeSha256: before.sha256,
			beforeContext: context.value,
			beforeContextSha256: context.sha256,
			protocol: protocol.value,
			protocolSha256: protocol.sha256,
			operatorSha256,
			expectedBeforeBuild: flags["expected-before-build"],
			expectedHeadBuild: flags["expected-head-build"],
			expectedHeadBrowserControl: headControl.value,
			expectedHeadBrowserControlFileSha256: headControl.sha256,
			registeredAt: new Date().toISOString(),
		});
	} else {
		const budgets = await load(flags.budgets),
			head = await load(flags.head),
			context = await load(flags["head-context"]);
		result = compareMixedClockBudgets({
			budgets: budgets.value,
			budgetSha256: budgets.sha256,
			expectedBudgetSha256: flags["budget-sha256"],
			before: before.value,
			beforeSha256: before.sha256,
			head: head.value,
			headSha256: head.sha256,
			protocol: protocol.value,
			protocolSha256: protocol.sha256,
			operatorSha256,
			headContext: context.value,
			headContextSha256: context.sha256,
			observedAt: new Date().toISOString(),
		});
	}
	await writeMixedBudgetOutput(flags.out, result);
	console.log(
		JSON.stringify({
			written: true,
			command: flags.command,
			...(flags.command === "compare" ? { passed: result.passed } : {}),
		}),
	);
	if (result.passed === false) process.exitCode = 1;
}
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	runMixedBudgetCommand(process.argv.slice(2)).catch(() => {
		console.error(
			"Mixed-clock evidence rejected; no budget or acceptance was fabricated.",
		);
		process.exitCode = 1;
	});
