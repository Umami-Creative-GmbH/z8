import assert from "node:assert/strict";
import test from "node:test";
import {
	cleanEvidenceGates,
	cleanObservationMatches,
} from "./clean-evidence.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";

const ids = ["measured", "prerequisite", "background"];
const plan = { routes: [{ name: "dashboard", clockReady: "button" }] };
const sample = () => ({
	traceId: ids[0],
	prerequisiteTraceId: ids[1],
	backgroundTraceId: ids[2],
	route: "dashboard",
	mode: "first-document",
	failed: false,
	failedRequests: 0,
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

test("clean successful evidence stays eligible in both phases", () => {
	for (const phase of ["baseline", "release"])
		assert.deepEqual(gates(sample(), rows(), phase), []);
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
		};
		const s = {
			...sample(),
			applicationEvidence: createActionResultObserver().snapshot(),
		};
		const p = { ...plan, phase, timeoutMs, runtime };
		assert.deepEqual(
			cleanEvidenceGates(p, { runtime, samples: [s] }, rows()),
			[],
		);
		for (const field of ["usableContentMs", "clockReadyMs"])
			assert.ok(
				cleanEvidenceGates(
					p,
					{ runtime, samples: [{ ...s, [field]: timeoutMs + 1 }] },
					rows(),
				).length > 0,
			);
		assert.ok(
			cleanEvidenceGates(
				p,
				{ runtime: { ...runtime, poolMax: 20 }, samples: [s] },
				rows(),
			).length > 0,
		);
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
