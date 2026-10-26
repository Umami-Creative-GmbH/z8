/** Acceptance is identical before and after: failed observations remain diagnostic evidence only. */
import { actionResultPolicy } from "./action-result-observer.mjs";
import { cleanBrowserFailureEvidence, completeAllPhaseBrowserObservation, controlCancellationPolicy, matchingBrowserControlBinding } from "./control-cancellation-evidence.mjs";

export const cleanObservationPolicy = Object.freeze({
	version: 1,
	originalTimeoutMs: 90000,
	optimizedTimeoutMs: 30000,
	sharedPoolAcquisitionTimeoutMs: 60000,
	sharedPoolMax: 10,
});

export const cleanEvidencePolicy = Object.freeze({
	version: 3,
	baseline: "clean-required",
	release: "clean-required",
	backendScope: "every registered visit, prerequisite and cleanup identity",
	failedCohortBudget: "forbidden",
	browserFailures: "raw failures retained; only positively proven protocol controls excluded from required failures",
	browserControl: controlCancellationPolicy,
	applicationScope: actionResultPolicy.scope,
	observation: cleanObservationPolicy,
});

export function observationTimeoutMs(phase) {
	if (phase === "baseline") return cleanObservationPolicy.originalTimeoutMs;
	if (phase === "release") return cleanObservationPolicy.optimizedTimeoutMs;
	return undefined;
}

export function cleanObservationMatches(plan) {
	if (plan.runtime?.traceTransport !== "context-loopback-proxy-v1") return true;
	const timeout = observationTimeoutMs(plan.phase);
	return (
		timeout !== undefined &&
		plan.timeoutMs === timeout &&
		plan.runtime.poolMax === cleanObservationPolicy.sharedPoolMax &&
		plan.runtime.poolAcquisitionTimeoutMs ===
			cleanObservationPolicy.sharedPoolAcquisitionTimeoutMs
	);
}

export function cleanApplicationEvidence(application) {
	const counts = [
		"observed",
		"successes",
		"failures",
		"serverErrors",
		"unknown",
		"outOfScope",
		"httpErrors",
		"pending",
		"overflows",
		"decodeFailures",
		"registryConflicts",
	];
	return Boolean(
		application &&
			JSON.stringify(application.policy) ===
				JSON.stringify(actionResultPolicy) &&
			application.complete === true &&
			counts.every(
				(key) =>
					Number.isSafeInteger(application[key]) && application[key] >= 0,
			) &&
			[
				"failures",
				"serverErrors",
				"unknown",
				"httpErrors",
				"pending",
				"overflows",
				"decodeFailures",
				"registryConflicts",
			].every((key) => application[key] === 0) &&
			application.observed ===
				application.successes +
					application.failures +
					application.serverErrors +
					application.unknown +
					application.outOfScope,
	);
}

export function cleanBrowserVisitEvidence(sample) {
	const id = sample.backendTraceId ?? sample.traceId;
	return cleanBrowserContextEvidence(id, sample.browserControlEvidence, sample.failedRequests);
}

export function cleanBrowserContextEvidence(id, evidence, rawFailedRequests) {
	if (!id || evidence?.contextId !== id ||
		!cleanBrowserFailureEvidence(evidence.measured, rawFailedRequests) ||
		!completeAllPhaseBrowserObservation(evidence.allPhase) || evidence.allPhase.realFailures !== 0) return false;
	if (evidence.allPhase.records.some((row) => row.proof && row.proof.failure?.contextId !== id)) return false;
	return evidence.measured.records.every((row) => {
		const all = evidence.allPhase.records.filter((candidate) => candidate.requestId === row.requestId);
		return row.proof?.failure?.contextId === id && all.length === 1 &&
			JSON.stringify(all[0]) === JSON.stringify(row);
	});
}

/** Available at context closure, before whole-run backend export; no fake native rows. */
export function cleanVisitObservationGates(plan, sample) {
	const gates = [];
	if (!cleanBrowserVisitEvidence(sample)) gates.push("Clean browser request proof is required for this visit.");
	const application = sample.traceTransport?.applicationEvidence ?? sample.applicationEvidence;
	if (plan.runtime?.traceTransport === "context-loopback-proxy-v1" || application !== undefined) {
		if (!cleanApplicationEvidence(application)) gates.push("Complete zero-error known application-contract observations are required for this visit.");
		const route = plan.routes?.find((route) => route.name === sample.route);
		const required = { "work-hours": "getWorkHoursAnalyticsData", "employee-report": "generateReport" }[route?.result];
		const contract = application?.contracts?.[required];
		if (required && (!contract || !Number.isSafeInteger(contract.observed) || contract.observed <= 0 ||
			contract.successes !== contract.observed || ["failures", "serverErrors", "unknown", "httpErrors"].some((key) => contract[key] !== 0)))
			gates.push("Actual compiled application-contract coverage is required for this visit.");
	}
	return gates;
}

/** Same measured cost requirements as finalization, using only actual received rows. */
export function cleanMeasuredCostGates(sample, native) {
	const rows = native?.filter((row) => row.traceId === (sample.backendTraceId ?? sample.traceId));
	const row = rows?.length === 1 ? rows[0] : undefined;
	return row && ["queryCount", "queryDurationMs", "rowsRetrieved", "poolWaitMs", "cacheHits", "cacheMisses", "eventLoopDelayMs"].every(
		(key) => Number.isFinite(row[key]) && row[key] >= 0) &&
		["observer", "pg", "rows", "cache", "eventLoop", "registration", "closed", "nativeProof"].every((key) => row.coverage?.[key] === true) &&
		row.coverage.incomplete === false && ["unattributedNativeSpans", "rejectedBatches", "lateSpans"].every((key) => row.coverage[key] === 0)
		? [] : ["Actual measured native costs and all five coverage families must be complete before another visit."];
}

/** Stops new work after a bad observation; every already-started visit still cleans and checkpoints. */
export async function runCleanVisitWorkers({ count, concurrency, measure, checkpoint }) {
	if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(concurrency) || concurrency < 1)
		throw Error("Strict visit scheduling needs finite positive counts.");
	let next = 0, stopped = false;
	const results = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
		while (!stopped && next < count) {
			try {
				const sample = await measure(next++);
				if (sample.failed !== false || sample.censored !== false || sample.secondaryFailures?.length || sample.requiredObservationGates?.length) stopped = true;
				await checkpoint(sample);
			} catch (error) { stopped = true; throw error; }
		}
	}));
	const rejected = results.find((result) => result.status === "rejected");
	if (rejected) throw rejected.reason;
	if (stopped) throw Error("A strict visit failed; remaining work was not scheduled.");
}

function provenEmptyScope(sample, id) {
	const collector = sample.collector ?? sample.collectorVisit;
	const rows = collector?.nativeCloseProof?.filter((row) => row.traceId === id);
	if (
		collector?.registered !== true ||
		collector.closed !== true ||
		rows?.length !== 1
	)
		return false;
	const proof = rows[0];
	return (
		proof.complete === true &&
		proof.driverComplete === true &&
		proof.drained === true &&
		proof.driverQueries === 0 &&
		["queries", "acquisitions", "cache"].every(
			(key) =>
				proof[key] === 0 &&
				proof.started?.[key] === 0 &&
				proof.ended?.[key] === 0,
		)
	);
}

export function cleanEvidenceGates(
	plan,
	artifact,
	native,
	timing = "usableContentMs",
) {
	const gates = [];
	if (!Array.isArray(artifact.samples) || artifact.samples.length === 0)
		return ["Clean evidence requires browser samples."];
	if (plan.runtime?.traceTransport === "context-loopback-proxy-v1" && !matchingBrowserControlBinding(plan.runtime, artifact.runtime?.browserControl))
		gates.push("Clean evidence requires the actual matching compiled manifest and browser revision admission.");
	if (
		!cleanObservationMatches(plan) ||
		(plan.runtime?.traceTransport === "context-loopback-proxy-v1" &&
			(artifact.runtime?.poolAcquisitionTimeoutMs !==
				plan.runtime.poolAcquisitionTimeoutMs ||
				artifact.runtime?.poolMax !== plan.runtime.poolMax))
	)
		gates.push(
			"Clean evidence requires the approved original/optimized observation windows and shared pool timeout.",
		);
	const seen = new Set();
	for (const sample of artifact.samples) {
		if (!cleanBrowserVisitEvidence(sample))
			gates.push(
				"Clean original and HEAD evidence requires complete browser request proofs with zero required or unknown measured failures.",
			);
		const window =
			plan.runtime?.traceTransport === "context-loopback-proxy-v1"
				? observationTimeoutMs(plan.phase)
				: undefined;
		if (
			sample.failed !== false ||
			sample.censored !== false ||
			sample.secondaryFailures?.length
		)
			gates.push(
				"Clean original and HEAD evidence requires successful uncensored journeys.",
			);
		if (
			!Number.isFinite(sample[timing]) ||
			sample[timing] < 0 ||
			(window !== undefined && sample[timing] > window)
		)
			gates.push("Clean evidence requires finite route readiness.");
		const route = plan.routes?.find((route) => route.name === sample.route);
		if (
			route?.clockReady &&
			(!Number.isFinite(sample.clockReadyMs) ||
				sample.clockReadyMs < 0 ||
				(window !== undefined && sample.clockReadyMs > window))
		)
			gates.push("Clean evidence requires the planned clock readiness.");
		if (sample.mode === "mutation-refresh" && sample.restored !== true)
			gates.push("Clean evidence requires mutation restoration.");
		const application =
			sample.traceTransport?.applicationEvidence ?? sample.applicationEvidence;
		if (
			plan.runtime?.traceTransport === "context-loopback-proxy-v1" ||
			application !== undefined
		) {
			if (!cleanApplicationEvidence(application))
				gates.push(
					"Clean evidence requires complete zero-error known application-contract observations.",
				);
			const required = {
				"work-hours": "getWorkHoursAnalyticsData",
				"employee-report": "generateReport",
			}[route?.result];
			const contract = application?.contracts?.[required];
			if (
				required &&
				(!contract ||
					!Number.isSafeInteger(contract.observed) ||
					contract.observed <= 0 ||
					contract.successes !== contract.observed ||
					["failures", "serverErrors", "unknown", "httpErrors"].some(
						(key) => contract[key] !== 0,
					))
			)
				gates.push(
					"Clean evidence lacks the required actual compiled action-contract coverage.",
				);
		}
		const measured = sample.backendTraceId ?? sample.traceId;
		const ids = [
			...new Set(
				[
					sample.traceId,
					measured,
					sample.prerequisiteTraceId,
					sample.backgroundTraceId,
				].filter((id) => id !== undefined),
			),
		];
		if (
			plan.runtime?.traceTransport === "context-loopback-proxy-v1" &&
			(!sample.prerequisiteTraceId ||
				!sample.backgroundTraceId ||
				new Set([
					sample.traceId,
					sample.prerequisiteTraceId,
					sample.backgroundTraceId,
				]).size !== 3)
		)
			gates.push(
				"Clean backend evidence requires every registered context identity.",
			);
		if (
			!ids.length ||
			ids.some((id) => typeof id !== "string" || !id || seen.has(id))
		)
			gates.push(
				"Clean backend evidence requires distinct current-run correlation identities.",
			);
		for (const id of ids) {
			seen.add(id);
			const rows = Array.isArray(native)
				? native.filter((row) => row.traceId === id)
				: [];
			if (!rows.length && id !== measured && provenEmptyScope(sample, id))
				continue;
			if (
				rows.length !== 1 ||
				rows[0].coverage?.registration !== true ||
				rows[0].coverage.closed !== true ||
				rows[0].coverage.nativeProof !== true ||
				rows[0].coverage.incomplete !== false ||
				["observedQueryErrors", "observedPoolAcquisitionErrors"].some(
					(key) => !Number.isSafeInteger(rows[0]?.[key]) || rows[0][key] !== 0,
				)
			)
				gates.push(
					"Clean backend evidence requires known zero query and acquisition errors for every current-run scope.",
				);
		}
	}
	return [...new Set(gates)];
}
