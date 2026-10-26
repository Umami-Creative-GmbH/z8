import assert from "node:assert/strict";
import test from "node:test";
import {
	cleanEvidenceGates,
	cleanObservationMatches,
	cleanVisitObservationGates,
	cleanMeasuredCostGates,
	runCleanVisitWorkers,
} from "./clean-evidence.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { classifyControlCancellations, inspectRequiredFlightBody, chromiumSWRRevision, controlCancellationPolicy } from "./control-cancellation-evidence.mjs";

const ids = ["measured", "prerequisite", "background"];
const plan = { routes: [{ name: "dashboard", clockReady: "button" }] };
const browserEvidence = (controlled = false) => {
	const identity = { contextId: ids[0], method: "POST", requestKind: "action", fullUrlSha256: "a".repeat(64),
		requestHeadersSha256: "b".repeat(64), documentGeneration: "context:1" };
	const bodyProof = inspectRequiredFlightBody(Buffer.from('0:{"a":{"success":true}}\n'), { action: true });
	const failure = { ...identity, requestId: "request", error: "net::ERR_ABORTED", canceled: true,
		status: 200, proxyResponseId: "packet", action: true, bodyReadbackComplete: true, bodyProof };
	const packet = { ...identity, id: "packet", status: 200, flight: true, action: true, complete: true,
		canceled: false, upstreamError: false, bodyProof };
	const input = { failures: controlled ? [failure] : [], proxy: controlled ? [packet] : [],
		browserRevision: chromiumSWRRevision,
		coverage: { installed: true, scopeClosed: true, missing: 0, overflow: 0, errors: 0, pendingBodies: 0 } };
	return { contextId: ids[0], measured: classifyControlCancellations(input),
		allPhase: classifyControlCancellations({ ...input, scope: "all-phase-semantic-correlation" }) };
};
const sample = () => ({
	traceId: ids[0],
	prerequisiteTraceId: ids[1],
	backgroundTraceId: ids[2],
	route: "dashboard",
	mode: "first-document",
	failed: false,
	failedRequests: 0,
	browserControlEvidence: browserEvidence(),
	censored: false,
	usableContentMs: 100,
	clockReadyMs: 50,
});
const rows = () =>
	ids.map((traceId) => ({
		traceId,
		observedQueryErrors: 0,
		observedPoolAcquisitionErrors: 0,
		coverage: {
			registration: true,
			closed: true,
			incomplete: false,
			nativeProof: true,
		},
	}));
const gates = (s = sample(), native = rows(), phase = "baseline") =>
	cleanEvidenceGates({ ...plan, phase }, { samples: [s] }, native);

test("per-visit measured costs fail fast on missing, duplicate, unknown or nonfinite actual native rows", () => {
	const measured = { ...rows()[0], queryCount: 1, queryDurationMs: 2, rowsRetrieved: 3, poolWaitMs: 4,
		cacheHits: 0, cacheMisses: 1, eventLoopDelayMs: 2,
		coverage: { ...rows()[0].coverage, observer: true, pg: true, rows: true, cache: true, eventLoop: true,
			unattributedNativeSpans: 0, rejectedBatches: 0, lateSpans: 0 } };
	assert.deepEqual(cleanMeasuredCostGates(sample(), [measured, rows()[1]]), []);
	for (const native of [[], [measured, measured], ...["eventLoopDelayMs", "poolWaitMs", "rowsRetrieved"].map((key) => [{ ...measured, [key]: null }]),
		[{ ...measured, coverage: { ...measured.coverage, eventLoop: false } }]])
		assert.ok(cleanMeasuredCostGates(sample(), native).length);
	assert.equal(rows()[1].eventLoopDelayMs, undefined, "No metric is fabricated for unrelated empty scopes.");
});

test("clean successful evidence stays eligible in both phases", () => {
	for (const phase of ["baseline", "release"])
		assert.deepEqual(gates(sample(), rows(), phase), []);
});

test("both phases accept only positively recomputed controls while retaining their raw browser count", () => {
	for (const phase of ["baseline", "release"]) {
		const s = { ...sample(), failedRequests: 1, browserControlEvidence: browserEvidence(true) };
		assert.deepEqual(gates(s, rows(), phase), []);
		assert.equal(s.failedRequests, 1);
		const unrelated = structuredClone(s);
		unrelated.browserControlEvidence.allPhase.rawFailedRequests++;
		unrelated.browserControlEvidence.allPhase.unknownFailures++;
		unrelated.browserControlEvidence.allPhase.records.push({ requestId: "outside-measured", outcome: "unknown", reason: "unproven-cancellation" });
		assert.deepEqual(gates(unrelated, rows(), phase), []);
		const genuine = structuredClone(unrelated);
		genuine.browserControlEvidence.allPhase.unknownFailures--;
		genuine.browserControlEvidence.allPhase.realFailures++;
		genuine.browserControlEvidence.allPhase.records[1] = { requestId: "outside-measured", outcome: "real-failure", reason: "browser-or-http-error" };
		assert.ok(gates(genuine, rows(), phase).some((gate) => /browser/i.test(gate)));
		for (const change of [
			(v) => { delete v.browserControlEvidence; },
			(v) => { v.browserControlEvidence.contextId = "another-context"; },
			(v) => { v.browserControlEvidence.measured.records[0].proof.packet.bodyProof.explicitActionFailure = true; },
			(v) => { v.browserControlEvidence.measured.unknownFailures = 1; },
		]) {
			const bad = structuredClone(s); change(bad);
			assert.ok(gates(bad, rows(), phase).some((gate) => /browser/i.test(gate)));
		}
		assert.ok(gates({ ...sample(), browserControlEvidence: undefined }, rows(), phase).some((gate) => /browser/i.test(gate)));
	}
});

test("the per-visit gate blocks required semantic unknown without rewriting its raw observation", () => {
	const observer = createActionResultObserver();
	const id = observer.request({ traceId: ids[0], method: "GET", headers: {}, applicationOrigin: true });
	observer.response(id, { mimeType: "text/x-component", encoding: "identity", status: 200 });
	observer.abort(id, "downstream-cancellation");
	const raw = observer.snapshot();
	assert.equal(raw.unknown, 1);
	assert.ok(cleanVisitObservationGates(plan, { ...sample(), applicationEvidence: raw }).some((gate) => /application/i.test(gate)));
	assert.equal(raw.unknown, 1);
	assert.equal(raw.complete, false);
});

test("capture checkpoints the bad visit and joins in-flight cleanup before it stops scheduling", async () => {
	const calls = [], saved = [];
	let finishFirst;
	const first = new Promise((resolve) => { finishFirst = resolve; });
	const running = runCleanVisitWorkers({ count: 5, concurrency: 2,
		measure: async (index) => { calls.push(index); if (index === 0) await first;
			return { failed: index === 1, censored: false, cleanupComplete: true }; },
		checkpoint: async (sample) => { saved.push(sample); if (sample.failed) finishFirst(); },
	});
	await assert.rejects(running, /strict.*visit/i);
	assert.deepEqual(calls, [0, 1]);
	assert.equal(saved.length, 2);
	assert.ok(saved.every((sample) => sample.cleanupComplete));
});

test("both phases require a known zero browser loading-failure count", () => {
	for (const failedRequests of [1, undefined, null, "0", NaN, -1, 0.5])
		for (const phase of ["baseline", "release"])
			assert.match(
				gates({ ...sample(), failedRequests }, rows(), phase).join(" "),
				/browser.*request/i,
			);
});

test("only the approved original and optimized windows share the positive acquisition timeout", () => {
	const runtime = {
		traceTransport: "context-loopback-proxy-v1",
		poolMax: 10,
		poolAcquisitionTimeoutMs: 60000,
	};
	assert.equal(
		cleanObservationMatches({ phase: "baseline", timeoutMs: 90000, runtime }),
		true,
	);
	assert.equal(
		cleanObservationMatches({ phase: "release", timeoutMs: 30000, runtime }),
		true,
	);
	for (const change of [
		{ phase: "baseline", timeoutMs: 30000 },
		{ phase: "release", timeoutMs: 90000 },
		{ phase: "unknown", timeoutMs: 90000 },
	])
		assert.equal(cleanObservationMatches({ ...change, runtime }), false);
	for (const change of [
		{ poolMax: 20 },
		{ poolAcquisitionTimeoutMs: 10000 },
		{ poolAcquisitionTimeoutMs: undefined },
	])
		assert.equal(
			cleanObservationMatches({
				phase: "baseline",
				timeoutMs: 90000,
				runtime: { ...runtime, ...change },
			}),
			false,
		);
});
test("failed censored unknown readiness and unrestored journeys reject in either phase", () => {
	for (const change of [
		{ failed: true },
		{ censored: true },
		{ failed: undefined },
		{ usableContentMs: null },
		{ clockReadyMs: null },
		{ mode: "mutation-refresh", restored: false },
	])
		for (const phase of ["baseline", "release"])
			assert.ok(gates({ ...sample(), ...change }, rows(), phase).length > 0);
});

test("recorded original and HEAD readiness cannot exceed their declared observation windows", () => {
	for (const [phase, timeoutMs] of [
		["baseline", 90000],
		["release", 30000],
	]) {
		const runtime = {
			traceTransport: "context-loopback-proxy-v1",
			poolMax: 10,
			poolAcquisitionTimeoutMs: 60000,
			build: "c".repeat(40),
			browserControl: { policy: controlCancellationPolicy, browserRevision: chromiumSWRRevision,
				compiledCachedNavigations: true, compiledManifestSha256: "d".repeat(64) },
		};
		const actualRuntime = { ...runtime, browserControl: { ...runtime.browserControl,
			compiledBuild: runtime.build, manifestVerified: true, browserVerified: true } };
		const s = {
			...sample(),
			applicationEvidence: createActionResultObserver().snapshot(),
		};
		const p = { ...plan, phase, timeoutMs, runtime };
		assert.deepEqual(
			cleanEvidenceGates(p, { runtime: actualRuntime, samples: [s] }, rows()),
			[],
		);
		for (const field of ["usableContentMs", "clockReadyMs"])
			assert.ok(
				cleanEvidenceGates(
					p,
					{ runtime: actualRuntime, samples: [{ ...s, [field]: timeoutMs + 1 }] },
					rows(),
				).length > 0,
			);
		assert.ok(
			cleanEvidenceGates(
				p,
				{ runtime: { ...actualRuntime, poolMax: 20 }, samples: [s] },
				rows(),
			).length > 0,
		);
		for (const change of [{ browserVerified: false }, { manifestVerified: false }, { compiledCachedNavigations: false }, { compiledBuild: "e".repeat(40) }])
			assert.ok(cleanEvidenceGates(p, { runtime: { ...actualRuntime, browserControl: { ...actualRuntime.browserControl, ...change } }, samples: [s] }, rows()).some((gate) => /manifest|browser revision/i.test(gate)));
	}
});
test("successful UI cannot hide errors in measured prerequisite or cleanup scopes", () => {
	for (const id of ids)
		for (const field of [
			"observedQueryErrors",
			"observedPoolAcquisitionErrors",
		]) {
			const native = rows();
			native.find((row) => row.traceId === id)[field] = 1;
			for (const phase of ["baseline", "release"])
				assert.ok(
					gates(sample(), native, phase).some((gate) => /backend/i.test(gate)),
				);
		}
});
test("unknown invalid duplicated and nonzero absent native evidence reject", () => {
	for (const value of [undefined, null, Number.NaN, -1, 0.5]) {
		const native = rows();
		native[1].observedPoolAcquisitionErrors = value;
		assert.ok(gates(sample(), native).length > 0);
	}
	assert.ok(gates(sample(), rows().slice(1)).length > 0);
	assert.ok(gates(sample(), [...rows(), rows()[0]]).length > 0);
});
test("only exact complete zero native proof can replace an absent nonmeasured row", () => {
	const zero = { queries: 0, acquisitions: 0, cache: 0 };
	const proof = {
		traceId: ids[2],
		complete: true,
		driverComplete: true,
		driverQueries: 0,
		drained: true,
		...zero,
		started: zero,
		ended: zero,
	};
	const s = {
		...sample(),
		collector: { registered: true, closed: true, nativeCloseProof: [proof] },
	};
	assert.deepEqual(gates(s, rows().slice(0, 2)), []);
	for (const change of [
		{ acquisitions: 1 },
		{ driverQueries: null },
		{ complete: false },
		{ drained: false },
	])
		assert.ok(
			gates(
				{
					...s,
					collector: {
						...s.collector,
						nativeCloseProof: [{ ...proof, ...change }],
					},
				},
				rows().slice(0, 2),
			).length > 0,
		);
	assert.ok(
		gates(
			{
				...s,
				collector: {
					...s.collector,
					nativeCloseProof: [{ ...proof, traceId: ids[0] }],
				},
			},
			rows().slice(1),
		).length > 0,
	);
});
test("unrelated historical errors do not contaminate current run identities", () => {
	assert.deepEqual(
		gates(sample(), [
			...rows(),
			{
				traceId: "old-diagnostic",
				observedQueryErrors: 8,
				observedPoolAcquisitionErrors: 10,
			},
		]),
		[],
	);
});

test("explicit application failure rejects despite zero SQL and acquisition errors", () => {
	const proof = createActionResultObserver().snapshot();
	Object.assign(proof, { observed: 1, failures: 1 });
	assert.ok(
		gates({ ...sample(), applicationEvidence: proof }).some((gate) =>
			/application/i.test(gate),
		),
	);
});

test("missing required named contract and pending semantic observations are unknown, not clean", () => {
	const s = {
		...sample(),
		applicationEvidence: createActionResultObserver().snapshot(),
	};
	assert.ok(
		cleanEvidenceGates(
			{ routes: [{ name: "dashboard", result: "work-hours" }] },
			{ samples: [s] },
			rows(),
		).some((gate) => /contract/i.test(gate)),
	);
	assert.ok(
		gates({
			...s,
			applicationEvidence: {
				...s.applicationEvidence,
				pending: 1,
				complete: false,
			},
		}).length > 0,
	);
});
