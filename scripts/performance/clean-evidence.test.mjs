import { testBrowserEvidence, testBrowserMetadata } from "./control-cancellation-test-fixtures.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	cleanEvidenceGates,
	cleanObservationMatches,
	cleanVisitObservationGates,
	cleanBrowserContextEvidence,
	cleanMeasuredCostGates,
	runCleanVisitWorkers,
} from "./clean-evidence.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { createBrowserControlCollector, createProxyControlCollector } from "./browser-control-collector.mjs";
import { setImmediate as tick } from "node:timers/promises";
import { classifyControlCancellations, inspectRequiredFlightBody, chromiumSWRRevision, controlCancellationPolicy } from "./control-cancellation-evidence.mjs";

const ids = ["measured", "prerequisite", "background"];
const plan = { routes: [{ name: "dashboard", clockReady: "button" }] };
const browserEvidence = (controlled = false) => testBrowserEvidence(ids[0], controlled);
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
			(v) => { delete v.browserControlEvidence.protocolErrors; },
			(v) => { v.browserControlEvidence.protocolErrors.observed = 1; },
			(v) => { v.browserControlEvidence.protocolErrors.records.push({ source: "proxy" }); },
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

test("a completed response with nested Flight E blocks even without a browser loading failure", async () => {
	const proxy = createProxyControlCollector({ contextId: ids[0], compiledCachedNavigations: false });
	proxy.installed();
	const browser = createBrowserControlCollector({ contextId: ids[0], origin: "http://localhost", browserRevision: chromiumSWRRevision, proxyObservation: proxy.snapshot });
	browser.installed(); browser.beginMeasurement(); browser.endMeasurement();
	const inner = Buffer.from('#0:E{"digest":"PRIVATE_CANARY"}\n');
	const bytes = Buffer.concat([Buffer.from(`0:{"q":"","i":false,"t":{"t":{"s":"en"}},"p":"$1"}\n1:R\n1:o${inner.length.toString(16)},`), inner, Buffer.from('1:C\n')]);
	proxy.request("packet", { url: "http://localhost/en", method: "GET", headers: { RSC: "1" }, traceId: ids[0] });
	proxy.response("packet", { status: 200, headers: { "content-type": "text/x-component" } });
	proxy.bytes("packet", bytes); proxy.end("packet");
	await tick(); browser.endScope();
	assert.equal(proxy.snapshot().rows[0].bodyProof.serverErrors, 1);
	const evidence = browser.snapshot();
	assert.equal(evidence.measured.rawFailedRequests, 0);
	assert.equal(cleanBrowserContextEvidence(ids[0], evidence, 0), false);
	assert.equal(evidence.protocolErrors.observed, 1);
	assert.equal(evidence.protocolErrors.records[0].source, "proxy");
	for (const phase of ["baseline", "release"])
		assert.ok(gates({ ...sample(), browserControlEvidence: evidence }, rows(), phase).some((gate) => /browser request proofs/i.test(gate)));
	assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_CANARY/);
});

test("zero browser failures cannot default a missing or malformed positive-error observer to zero", () => {
	for (const change of [
		(v) => { delete v.protocolErrors; },
		(v) => { v.protocolErrors.observed = undefined; },
		(v) => { v.protocolErrors.observed = null; },
		(v) => { v.protocolErrors.observed = "0"; },
		(v) => { v.protocolErrors.scopeClosed = false; },
		(v) => { v.protocolErrors.installed = false; },
		(v) => { v.protocolErrors.contextId = "wrong-context"; },
		(v) => { v.protocolErrors.overflow = 1; },
	]) {
		const evidence = browserEvidence(); change(evidence);
		assert.equal(cleanBrowserContextEvidence(ids[0], evidence, 0), false);
	}
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
			browserControl: testBrowserMetadata(),
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

// Original-only request-value/source authority tests are registered in this existing suite.
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	originalTeamTemporaryProfiles,
	knownOriginalTeamSourceFacts,
	isOriginalTeamSourceQualification,
	originalTeamSourceFileFacts,
	readOriginalTeamSourceQualification,
	projectInertDateRangeRequest,
	knownClosedDateRangeTypeFacts,
	createTeamTemporaryValueStore,
	createTeamReplayDispatchJournal,
	teamReplayHeader,
} from "./team-temporary-value-authority.mjs";
import { parseInertDateRangeRequest, forgetInertDateRangeRequestValue } from "./inert-date-range-request.mjs";

const sourceFacts = () => {
	const profile = originalTeamTemporaryProfiles[0];
	return {
		protocol: "original-team-temporary-source-facts-v1",
		profileId: profile.id,
		phase: "baseline",
		binarySource: "bfdf2d573052eb485d2a6b9bd75896f98882baeb",
		manifestSha256: "8cd0fc10a5288431c5b7afbc4f3d36273f965d6ff4d5b4a54bebe33a21201e64",
		buildRecordSha256: "34acb938396ed571886c66933415dd7cede4dda6aaf4ccb82a5048ddf68be147",
		registrySha256: "301a1afee35124ef83695e842e4d1fe2402d06da38964e0f0def9c4c66741f30",
		actionHeaderSha256: "355ec2d858094c87d7c3ef4b72d291185893ee976b865ce2916bd10922204884",
		selectedActionMatches: 1,
		concurrentRouterQueue: false,
		cachedNavigations: true,
		appFiles: profile.appFiles.map(row => ({ ...row })),
		frameworkFiles: profile.frameworkFiles.map(row => ({ ...row })),
	};
};

test("original temporary source facts identify the one reviewed baseline without becoming a live qualification", () => {
	assert.equal(originalTeamTemporaryProfiles.length, 1);
	const facts = sourceFacts();
	assert.equal(knownOriginalTeamSourceFacts(facts), true);
	assert.equal(isOriginalTeamSourceQualification(facts), false);
	assert.equal(isOriginalTeamSourceQualification(structuredClone(facts)), false);
	assert.ok(Object.isFrozen(originalTeamTemporaryProfiles));
	assert.ok(Object.isFrozen(originalTeamTemporaryProfiles[0].appFiles));
	assert.throws(() => { originalTeamTemporaryProfiles[0].binarySource = "foreign"; }, TypeError);
});

test("all120 field orders project the same five inert leaves without changing inline Flight obligations", () => {
	const expected = { start: "$D2025-01-01T00:00:00.000Z", end: "$D2025-01-02T23:59:59.999Z", startDate: "2025-01-01", endDate: "2025-01-02", timezone: "$$L9" };
	const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, n) => n !== index)).map(rest => [value, ...rest])) : [[]];
	let count = 0, firstFacts, firstSteps;
	for (const order of permutations(Object.keys(expected))) {
		const bytes = Buffer.from(JSON.stringify([Object.fromEntries(order.map(key => [key, expected[key]]))]));
		const descriptor = parseInertDateRangeRequest(bytes), projection = projectInertDateRangeRequest(descriptor);
		assert.deepEqual(projection.value, expected);
		assert.equal(knownClosedDateRangeTypeFacts(projection.facts), true);
		assert.doesNotMatch(JSON.stringify(projection.facts), /2025-01|\$D|\$L9/);
		assert.ok(Object.isFrozen(projection.value));
		const body = Buffer.from('0:' + JSON.stringify({ a: { success: true, data: { dateRange: projection.value } } }) + '\n');
		const proof = inspectRequiredFlightBody(body, { action: true, cachedNavigations: true });
		assert.equal(proof.complete, true);
		if (!count) { firstFacts = projection.facts; firstSteps = proof.modelSteps; }
		else { assert.deepEqual(projection.facts, firstFacts); assert.equal(proof.modelSteps, firstSteps); }
		assert.equal(forgetInertDateRangeRequestValue(descriptor), true);
		assert.equal(projectInertDateRangeRequest(descriptor), null);
		count++;
	}
	assert.equal(count, 120);
});

test("closed DateRange type facts reject altered roles kinds bounds keys and undocumented assertions", () => {
	const descriptor = parseInertDateRangeRequest(Buffer.from('[{"start":"$D2025-01-01T00:00:00.000Z","end":"$D2025-01-02T00:00:00.000Z","startDate":"x","endDate":"y","timezone":"z"}]'));
	const facts = projectInertDateRangeRequest(descriptor).facts;
	for (const mutate of [
		v => { v.fieldCount = 4; }, v => { v.nodes = 0; }, v => { v.depth = 3; },
		v => { v.fields.pop(); }, v => { v.fields[0].field = "__proto__"; },
		v => { v.fields[0].kind = "literal-string"; }, v => { v.fields[0].canonical = false; },
		v => { v.fields[0].utf16Units = 25; }, v => { v.fields[2].utf8Bytes = 16385; },
		v => { v.fields[2].protocolEdges = true; }, v => { v.fields[2].sha256 = "unknown"; },
		v => { v.rolePassed = true; },
	]) { const changed = structuredClone(facts); mutate(changed); assert.equal(knownClosedDateRangeTypeFacts(changed), false); }
	for (const value of [null, {}, { ...descriptor }]) assert.equal(projectInertDateRangeRequest(value), null);
	forgetInertDateRangeRequestValue(descriptor);
});

test("bounded request value store holds private values through actual consumers and forgets before releasing bytes", () => {
	const descriptor = parseInertDateRangeRequest(Buffer.from('[{"start":"$D2025-01-01T00:00:00.000Z","end":"$D2025-01-02T00:00:00.000Z","startDate":"PRIVATE_START","endDate":"PRIVATE_END","timezone":"PRIVATE_ZONE"}]'));
	let retained = 0, forgotBeforeRelease = false;
	const store = createTeamTemporaryValueStore({ contextId: "synthetic-context", reserve(bytes) { retained += bytes; return true; }, release(bytes) {
		forgotBeforeRelease = projectInertDateRangeRequest(descriptor) === null;
		retained -= bytes;
	} });
	const handle = store.retain({ id: "a".repeat(32) + ".1", descriptor });
	assert.notEqual(handle, null);
	assert.equal(store.snapshot().payloadRetainedBytes, 262144);
	assert.equal(store.snapshot().metadataRetainedBytes, 2048);
	assert.equal(retained, 264192);
	const pending = store.beginInspection(handle);
	assert.equal(store.snapshot().pendingConsumers, 1);
	assert.equal(store.finishInspection(pending), true);
	assert.equal(store.release(handle), true);
	assert.equal(forgotBeforeRelease, true);
	assert.equal(retained, 2048);
	assert.equal(projectInertDateRangeRequest(descriptor), null);
	store.close();
	const facts = store.snapshot();
	assert.equal(facts.closed, true); assert.equal(facts.pendingConsumers, 0);
	assert.equal(facts.payloadRetainedBytes, 0); assert.equal(facts.errors, 0);
	assert.equal(facts.sourceBound, false); assert.equal(facts.acceptanceClaim, "none");
	assert.doesNotMatch(JSON.stringify(facts), /PRIVATE_|2025-01|\$D/);
});

const teamStoreDescriptor = () => parseInertDateRangeRequest(Buffer.from('[{"start":"$D2025-01-01T00:00:00.000Z","end":"$D2025-01-02T00:00:00.000Z","startDate":"x","endDate":"y","timezone":"z"}]'));
const teamStorePool = (limit = 32 * 1024 * 1024) => {
	let bytes = 0;
	return { reserve: count => { if (bytes + count > limit) return false; bytes += count; return true; }, release: count => { bytes -= count; }, retained: () => bytes };
};
test("value store cannot close pending consumers or borrow copied and cross-store handles", () => {
	const pool = teamStorePool(), store = createTeamTemporaryValueStore({ contextId: "one", ...pool }), other = createTeamTemporaryValueStore({ contextId: "two", ...pool });
	const descriptor = teamStoreDescriptor(), handle = store.retain({ id: "a".repeat(32) + ".1", descriptor });
	assert.equal(other.beginInspection(handle), null);
	assert.equal(store.beginInspection({ ...handle }), null);
	const token = store.beginInspection(handle);
	assert.equal(store.release(handle), false);
	assert.notEqual(projectInertDateRangeRequest(descriptor), null);
	store.close();
	assert.equal(store.snapshot().pendingConsumers, 1);
	assert.equal(store.snapshot().payloadRetainedBytes, 262144);
	assert.equal(store.finishInspection({ ...token }), false);
	assert.equal(store.snapshot().pendingConsumers, 1);
	assert.equal(other.finishInspection(token), false);
	assert.equal(store.finishInspection(token), true);
	assert.equal(store.snapshot().pendingConsumers, 0);
	assert.equal(store.snapshot().payloadRetainedBytes, 0);
	assert.equal(projectInertDateRangeRequest(descriptor), null);
	assert.equal(store.finishInspection(token), false);
	assert.ok(store.snapshot().errors > 0);
	assert.ok(other.snapshot().errors > 0);
});

test("value storage budget refusal and duplicate selection never erase the first owned value", () => {
	const pool = teamStorePool(264192), store = createTeamTemporaryValueStore({ contextId: "one", ...pool });
	const first = teamStoreDescriptor(), handle = store.retain({ id: "a".repeat(32) + ".1", descriptor: first });
	const refused = teamStoreDescriptor();
	assert.equal(store.retain({ id: "a".repeat(32) + ".2", descriptor: refused }), null);
	assert.equal(projectInertDateRangeRequest(refused), null);
	assert.equal(pool.retained(), 264192);
	assert.equal(store.snapshot().overflow, 1);
	const duplicate = teamStoreDescriptor();
	assert.equal(store.retain({ id: "a".repeat(32) + ".1", descriptor: duplicate }), null);
	assert.equal(projectInertDateRangeRequest(duplicate), null);
	assert.notEqual(projectInertDateRangeRequest(first), null);
	const other = createTeamTemporaryValueStore({ contextId: "two", ...pool });
	assert.equal(other.retain({ id: "b".repeat(32) + ".1", descriptor: first }), null);
	assert.notEqual(projectInertDateRangeRequest(first), null);
	assert.equal(store.release(handle), true);
	assert.equal(pool.retained(), 2048);
	assert.equal(store.snapshot().rows.length, 1);
	assert.equal(store.snapshot().unavailable, 2);
	store.close(); other.close();
});

test("value release callback loss is sticky unknown and never reports invented retained-byte zeros", () => {
	let calls = 0;
	const store = createTeamTemporaryValueStore({ contextId: "one", reserve: () => true, release: () => { calls++; throw Error("PRIVATE_RELEASE_CAUSE"); } });
	const descriptor = teamStoreDescriptor(), handle = store.retain({ id: "a".repeat(32) + ".1", descriptor });
	assert.equal(store.release(handle), false);
	assert.equal(projectInertDateRangeRequest(descriptor), null);
	store.close();
	const facts = store.snapshot();
	assert.equal(facts.budgetKnown, false);
	assert.equal(facts.payloadRetainedBytes, null);
	assert.equal(facts.metadataRetainedBytes, null);
	assert.equal(facts.pendingConsumers, 0);
	assert.equal(calls, 1);
	assert.ok(facts.errors > 0);
	assert.doesNotMatch(JSON.stringify(facts), /PRIVATE_RELEASE_CAUSE/);
});

test("ambiguous reservation returns cannot manufacture a known zero allocation", () => {
	for (const result of [undefined, null, 1, NaN, {}]) {
		const store = createTeamTemporaryValueStore({ contextId: "one", reserve: () => result, release() {} });
		const descriptor = teamStoreDescriptor();
		assert.equal(store.retain({ id: "a".repeat(32) + ".1", descriptor }), null);
		assert.equal(projectInertDateRangeRequest(descriptor), null);
		assert.equal(store.snapshot().budgetKnown, false);
		assert.equal(store.snapshot().payloadRetainedBytes, null);
		assert.ok(store.snapshot().errors > 0);
	}
});

test("request values keep the exact10000 record and32MiB ownership limits", () => {
	const pool = teamStorePool(), store = createTeamTemporaryValueStore({ contextId: "one", ...pool });
	for (let n = 1; n <= 10000; n++) {
		const descriptor = teamStoreDescriptor(), handle = store.retain({ id: "a".repeat(32) + "." + n, descriptor });
		assert.notEqual(handle, null); assert.equal(store.release(handle), true);
	}
	const overflow = teamStoreDescriptor();
	assert.equal(store.retain({ id: "a".repeat(32) + ".10001", descriptor: overflow }), null);
	assert.equal(projectInertDateRangeRequest(overflow), null);
	store.close();
	const facts = store.snapshot();
	assert.equal(facts.rows.length, 10000); assert.equal(facts.overflow, 1);
	assert.equal(facts.payloadRetainedBytes, 0); assert.equal(facts.metadataRetainedBytes, 20480000);
	assert.equal(pool.retained(), 20480000);
});

test("manual replay journal requires actual nonce proxy EOF and both browser header observations", () => {
	const origin = "http://localhost:58792", traceId = "a".repeat(32), action = "9".repeat(40), body = "synthetic-body";
	const pool = teamStorePool(), journal = createTeamReplayDispatchJournal({ contextId: "one", origin, ...pool });
	const handle = journal.arm({ traceId, action, body, url: origin + "/en/analytics/team-performance" });
	const headers = journal.headers(handle);
	assert.match(headers[teamReplayHeader], /^[a-f0-9]{32}$/);
	assert.equal(journal.headers({ ...handle }), null);
	const nonceSha256 = createHash("sha256").update(headers[teamReplayHeader]).digest("hex"), proxyId = traceId + ".1";
	assert.equal(journal.proxyRequest({ id: proxyId, traceId, method: "POST", url: origin + "/en/analytics/team-performance", action, nonce: headers[teamReplayHeader] }), true);
	assert.equal(journal.requestEOF(proxyId, { encodedBytes: Buffer.byteLength(body), bodySha256: createHash("sha256").update(body).digest("hex") }), true);
	assert.equal(journal.factsFor(proxyId), null);
	assert.equal(journal.browserRequest({ proxyId, contextId: "one", requestId: "browser.1", method: "POST", traceId,
		urlSha256: createHash("sha256").update(origin + "/en/analytics/team-performance").digest("hex"), actionHeaderSha256: createHash("sha256").update(action).digest("hex"),
		frameId: "frame", loaderId: "loader", documentGeneration: "one:1", initialHeadersKnown: true, extraHeadersKnown: true, initialReplaySha256: nonceSha256, extraReplaySha256: nonceSha256 }), true);
	const joined = journal.factsFor(proxyId);
	assert.equal(joined.proxyId, proxyId); assert.equal(joined.browser.requestId, "browser.1");
	assert.equal(joined.requestEOF.bodySha256, createHash("sha256").update(body).digest("hex"));
	assert.equal(journal.finished(handle, { error: false }), true);
	journal.close();
	const facts = journal.snapshot();
	assert.equal(facts.pendingDispatches, 0); assert.equal(facts.rows.length, 1);
	assert.equal(facts.rows[0].nonceSha256, nonceSha256);
	assert.equal(facts.sourceBound, false); assert.equal(facts.acceptanceClaim, "none");
	assert.doesNotMatch(JSON.stringify(facts), new RegExp(headers[teamReplayHeader]));
	assert.doesNotMatch(JSON.stringify(facts), /synthetic-body|localhost|team-performance|9999999999/);
});

test("actual source file qualification fails with a fixed private error on unknown phase profile and malformed inputs", async () => {
	const folder = await mkdtemp(join(tmpdir(), "z8-team-source-test-"));
	try {
		const app = join(folder, "apps/webapp/.next"); await mkdir(app, { recursive: true });
		const manifest = join(app, "required-server-files.json"), record = join(folder, "build.json");
		await writeFile(record, "PRIVATE_SOURCE_SENTINEL");
		for (const text of ["PRIVATE_SOURCE_SENTINEL", '{"PRIVATE_SOURCE_SENTINEL":', "x".repeat(4194305)]) {
			await writeFile(manifest, text);
			for (const change of [{}, { phase: "release" }, { profileId: "unreviewed-original" }]) {
				await assert.rejects(readOriginalTeamSourceQualification({ profileId: "original-team-bfdf-v1", phase: "baseline", compiledManifestPath: manifest, buildRecordPath: record, ...change }), error => {
					assert.equal(error.message, "Original team temporary source qualification unavailable.");
					assert.equal(Object.hasOwn(error, "cause"), false);
					assert.doesNotMatch(String(error), /PRIVATE_SOURCE_SENTINEL|apps[\\/]webapp|build\.json/);
					return true;
				});
			}
		}
	} finally { assert.ok(folder.startsWith(join(tmpdir(), "z8-team-source-test-"))); await rm(folder, { recursive: true, force: true }); }
});

test("source issuer captures argument acquisition inside its fixed private failure boundary", async () => {
	const throwing = { get profileId() { throw Error("PRIVATE_ISSUER_GETTER_SENTINEL"); } };
	for (const input of [throwing, null, undefined, false, 1, "PRIVATE_ISSUER_ARGUMENT"]) {
		await assert.rejects(readOriginalTeamSourceQualification(input), error => {
			assert.equal(error.message, "Original team temporary source qualification unavailable.");
			assert.equal(Object.hasOwn(error, "cause"), false);
			assert.doesNotMatch(String(error), /PRIVATE_ISSUER/);
			return true;
		});
	}
});

test("source file normalization permits only CRLF and rejects BOM invalid text and oversize input", () => {
	assert.deepEqual(originalTeamSourceFileFacts(Buffer.from("synthetic\r\nsource\r\n")), originalTeamSourceFileFacts(Buffer.from("synthetic\nsource\n")));
	for (const bytes of [Buffer.from([239,187,191,120]), Buffer.from([255]), Buffer.alloc(4194305), new Uint8Array(4), null])
		assert.equal(originalTeamSourceFileFacts(bytes), null);
});

test("original source facts reject HEAD foreign profiles omitted files and copied altered configuration", () => {
	for (const mutate of [
		v => { v.phase = "release"; },
		v => { v.binarySource = "05cd9e40c38a3dd8c49d41a621999543a9a64e17"; },
		v => { v.profileId = "future-original-not-reviewed"; },
		v => { v.manifestSha256 = "0".repeat(64); },
		v => { v.registrySha256 = "0".repeat(64); },
		v => { v.buildRecordSha256 = "0".repeat(64); },
		v => { v.actionHeaderSha256 = "0".repeat(64); },
		v => { v.selectedActionMatches = 2; },
		v => { v.concurrentRouterQueue = true; },
		v => { v.cachedNavigations = undefined; },
		v => { v.appFiles.pop(); },
		v => { v.frameworkFiles.pop(); },
		v => { v.appFiles[0].canonicalLfSha256 = "0".repeat(64); },
		v => { v.frameworkFiles[0].sha256 = "0".repeat(64); },
		v => { v.appFiles.push(v.appFiles[0]); },
		v => { v.qualifierSaysKnown = true; },
	]) {
		const facts = sourceFacts(); mutate(facts);
		assert.equal(knownOriginalTeamSourceFacts(facts), false);
		assert.equal(isOriginalTeamSourceQualification(facts), false);
	}
});

test("observer-only temporary body inspections close without granting value authority", async () => {
	const { openOriginalTeamBodyInspection, resolveOriginalTeamTemporaryReference, closeOriginalTeamBodyInspection, originalTeamBodyObservation, validateOriginalTeamTemporaryValues } = await import("./team-temporary-value-authority.mjs");
	const boundary = { bodySha256: "a".repeat(64), decodedBytes: 32, action: true, requestKind: "action" };
	const inspection = openOriginalTeamBodyInspection({ bodySha256: boundary.bodySha256, decodedBytes: boundary.decodedBytes });
	assert.ok(inspection);
	assert.equal(originalTeamBodyObservation(inspection), null);
	assert.equal(resolveOriginalTeamTemporaryReference({ ...inspection }, "$T0:0", boundary), null);
	assert.equal(closeOriginalTeamBodyInspection({ ...inspection }), false);
	assert.equal(resolveOriginalTeamTemporaryReference(inspection, "$T0:0", boundary), null);
	assert.equal(closeOriginalTeamBodyInspection(inspection), true);
	assert.equal(closeOriginalTeamBodyInspection(inspection), false);
	const observed = originalTeamBodyObservation(inspection);
	assert.deepEqual(observed, { protocol: "original-team-body-value-observation-v1", bodySha256: boundary.bodySha256, decodedBytes: 32, lookupAttempted: true, valueUsed: false, bindingSha256: null, closed: true });
	const section = { protocol: "original-team-temporary-values-v1", referenceCount: 0, binding: null, obligations: [] };
	assert.equal(validateOriginalTeamTemporaryValues(section, { ...boundary, request: { temporaryValueObservation: observed } }), false);
    const pristine=openOriginalTeamBodyInspection({bodySha256:boundary.bodySha256,decodedBytes:32});closeOriginalTeamBodyInspection(pristine);
    assert.equal(validateOriginalTeamTemporaryValues(section,{...boundary,request:{temporaryValueObservation:originalTeamBodyObservation(pristine)}}),true);
	for (const changed of [undefined, { ...observed, valueUsed: true }, { ...observed, bindingSha256: "b".repeat(64) }, { ...observed, closed: false }, { ...observed, decodedBytes: 31 }])
		assert.equal(validateOriginalTeamTemporaryValues(section, { ...boundary, request: { temporaryValueObservation: changed } }), false);
	assert.equal(openOriginalTeamBodyInspection(null), null);
	assert.equal(openOriginalTeamBodyInspection({ bodySha256: boundary.bodySha256, decodedBytes: 8388609 }), null);
});

test("temporary observation condition and Original source configuration reject omitted or foreign declarations", async () => {
	const { temporaryValueObservation, knownTemporaryValueObservation, knownOriginalTeamSourceConfiguration, originalTeamTemporaryProfiles } = await import("./team-temporary-value-authority.mjs");
	assert.equal(knownTemporaryValueObservation(structuredClone(temporaryValueObservation)), true);
	for (const row of [undefined, null, {}, { ...temporaryValueObservation, replayHeader: "other" }, { ...temporaryValueObservation, extra: false }]) assert.equal(knownTemporaryValueObservation(row), false);
	const profile = originalTeamTemporaryProfiles[0];
	const config = { protocol: "original-team-source-configuration-v1", profileId: profile.id, phase: "baseline", compiledBuild: profile.binarySource, compiledManifestSha256: profile.manifestSha256, buildRecordPath: "owned/before-build.json", buildRecordSha256: profile.buildRecordSha256 };
	assert.equal(knownOriginalTeamSourceConfiguration(null), true);
	assert.equal(knownOriginalTeamSourceConfiguration(config, profile.binarySource, profile.manifestSha256), true);
	for (const row of [undefined, {}, { ...config, phase: "release" }, { ...config, compiledBuild: "a".repeat(40) }, { ...config, buildRecordSha256: "a".repeat(64) }, { ...config, buildRecordPath: "" }, { ...config, extra: true }]) assert.equal(knownOriginalTeamSourceConfiguration(row), false);
	assert.equal(knownOriginalTeamSourceConfiguration(config, "a".repeat(40)), false);
});

test("temporary request issuance rejects receipt copies and unqualified producer claims", async () => {
	const { bindOriginalTeamRequestValue, openOriginalTeamBodyInspection, resolveOriginalTeamTemporaryReference, closeOriginalTeamBodyInspection, originalTeamBodyObservation } = await import("./team-temporary-value-authority.mjs");
	const pool = teamStorePool(), store = createTeamTemporaryValueStore({ contextId: "issuer", reserve: pool.reserve, release: pool.release });
	const descriptor = teamStoreDescriptor(), handle = store.retain({ id: "a".repeat(32) + ".1", descriptor });
	assert.equal(bindOriginalTeamRequestValue({ qualification: {}, store, handle, request: {}, producer: {} }), null);
	const boundary = { bodySha256: "b".repeat(64), decodedBytes: 23, action: true, requestKind: "action" };
	const inspection = openOriginalTeamBodyInspection({ bodySha256: boundary.bodySha256, decodedBytes: 23, requestAuthority: {} });
	assert.ok(inspection);
	assert.equal(resolveOriginalTeamTemporaryReference(inspection, "$T0:0", boundary), null);
	assert.equal(closeOriginalTeamBodyInspection(inspection), true);
	assert.equal(originalTeamBodyObservation(inspection).valueUsed, false);
	store.close();
	assert.equal(pool.retained(), 2048);
});

test("source occurrence observations retain missing prior cuts and the existing record and byte limits", async () => {
 const {createTeamSourceCutJournal,bindOriginalTeamRequestValue}=await import("./team-temporary-value-authority.mjs");let retained=0;
 const journal=createTeamSourceCutJournal({contextId:"source-journal",reserve:bytes=>{retained+=bytes;return true;}});
 const captured=journal.capture("proxy-request","request-one",null);assert.ok(captured);
 assert.deepEqual(journal.snapshot().records,[{ordinal:1,kind:"proxy-request",id:"request-one",sourceCutOrdinal:null,sourceCutSha256:null}]);
 assert.equal(bindOriginalTeamRequestValue({proxyCut:captured,browserCut:{...captured}}),null);
 for(let index=1;index<8192;index++)assert.ok(journal.capture("browser-request","request-"+index,null));
 assert.equal(journal.capture("browser-request","over-limit",null),null);
 assert.equal(retained,33554432);assert.equal(journal.snapshot().records.length,8192);assert.equal(journal.snapshot().overflow,1);
 journal.close();assert.equal(journal.capture("browser-request","late",null),null);assert.equal(journal.snapshot().errors,1);
 assert.equal(JSON.stringify(journal.snapshot()).includes("PRIVATE"),false);
});
