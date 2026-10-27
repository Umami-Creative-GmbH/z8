import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
	createMixedTracePlan,
	reconcileMixedNative,
	runMixedReader,
} from "./mixed-load-observation.mjs";

const id = (n) => n.toString(16).padStart(32, "0");
test("acknowledged stop guards are awaited at reader entry and at the finite bound", async () => {
	let entryResolve, boundResolve, boundEnteredResolve;
	const entry = new Promise(resolve => { entryResolve = resolve; });
	const bound = new Promise(resolve => { boundResolve = resolve; });
	const boundEntered = new Promise(resolve => { boundEnteredResolve = resolve; });
	let reads=0, guards=0, settled=false;
	const running=runMixedReader({limit:1,stopped:()=>{guards++;if(guards===1)return entry;boundEnteredResolve();return bound;},
		read:async()=>{reads++;return {success:true};},observe:()=>{}});
	running.then(()=>{settled=true;});
	await Promise.resolve();assert.equal(reads,0);assert.equal(settled,false);
	entryResolve(false);
	await boundEntered;assert.equal(reads,1);assert.equal(settled,false);
	boundResolve(true);
	assert.deepEqual(await running,{count:1,failed:false,boundReached:false});assert.equal(guards,2);
});

test("acknowledged stop guard rejection starts no new read and the hundred-read bound is unchanged", async () => {
	let reads=0;
	await assert.rejects(runMixedReader({limit:100,stopped:async()=>{throw Error("unknown prefix");},read:async()=>{reads++;return {success:true};},observe:()=>{}}),/unknown prefix/);
	assert.equal(reads,0);
	const result=await runMixedReader({limit:100,stopped:async()=>false,read:async()=>{reads++;return {success:true};},observe:()=>{}});
	assert.deepEqual(result,{count:100,failed:false,boundReached:true});assert.equal(reads,100);
});
test("semantic mixed identities bound the entire twenty-pair condition below the real active-registration cap", () => {
	let n = 0;
	const plan = createMixedTracePlan(() => id(++n));
	assert.equal(plan.ids.length, 56);
	assert.equal(new Set(plan.ids).size, 56);
	assert.equal(plan.analytics(1, 0), plan.analytics(5, 0));
	assert.notEqual(plan.analytics(5, 0), plan.analytics(6, 0));
	assert.notEqual(plan.clock(1, "in"), plan.clock(1, "out"));
	assert.throws(() => createMixedTracePlan(() => id(1)), /identity/i);
	assert.throws(() => plan.analytics(21, 0), /window/i);
});

test("actual sequential HTTP reader keeps throughput until stop without collector drains between reads", async () => {
	let requests = 0,
		done = false;
	const server = createServer((_req, res) => {
		requests++;
		res.end("ok");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const observations = [];
		const result = await runMixedReader({
			limit: 100,
			stopped: () => done,
			read: async () => {
				const response = await fetch(
					`http://127.0.0.1:${server.address().port}`,
				);
				await response.text();
				if (requests === 8) done = true;
				return { success: true };
			},
			observe: (value) => observations.push(value),
		});
		assert.equal(requests, 8);
		assert.equal(observations.length, 8);
		assert.equal(result.boundReached, false);
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

test("reader fails visibly at its finite request cap, and observes an actual failed read", async () => {
	let n = 0;
	const first = await runMixedReader({
		limit: 2,
		stopped: () => false,
		read: async () => ({ success: true }),
		observe: () => n++,
	});
	assert.equal(first.boundReached, true);
	assert.equal(n, 2);
	const failed = await runMixedReader({
		limit: 100,
		stopped: () => false,
		read: async () => {
			throw Error("transport");
		},
		observe: (value) => {
			assert.equal(value.success, false);
			assert.equal(value.censored, true);
		},
	});
	assert.equal(failed.failed, true);
	assert.equal(failed.boundReached, false);
});

function counters(queries = 0, acquisitions = 0, cache = 0) {
	return {
		incoming: {
			knownHeaderKnownSpan: 0,
			knownHeaderOtherSpan: 0,
			otherHeaderKnownSpan: 0,
			otherHeaderOtherSpan: 0,
			matchingParent: 0,
			mismatchingParent: 0,
		},
		driverCounter: true,
		driverQueries: queries,
		activeTraces: 0,
		unknown: 0,
		started: { queries, acquisitions, cache },
		ended: { queries, acquisitions, cache },
	};
}
function row() {
	return {
		traceId: id(1),
		observedQueryCount: 3,
		observedPoolAcquisitions: 2,
		cacheHits: 1,
		cacheMisses: 1,
		queryCount: 3,
		queryDurationMs: 2,
		rowsRetrieved: 4,
		poolWaitMs: 1,
		eventLoopDelayMs: 0,
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
			incomplete: false,
			nativeProof: true,
			unattributedNativeSpans: 0,
			lateSpans: 0,
			rejectedBatches: 0,
			nativeDriverQueries: 3,
		},
	};
}
test("whole-run native proof requires driver=SDK=received and exact registered identities", () => {
	const before = counters(),
		after = counters(3, 2, 2),
		rows = [row()],
		ids = [id(1)];
	assert.equal(
		reconcileMixedNative({ before, after, rows, ids }).complete,
		true,
	);
	for (const mutate of [
		(x) => x.driverQueries++,
		(x) => x.ended.queries++,
		(x) => x.started.cache++,
		(x) => x.ended.acquisitions++,
		(x) => x.unknown++,
		(x) => x.activeTraces++,
		(x) => x.incoming.knownHeaderOtherSpan++,
		(x) => x.incoming.otherHeaderKnownSpan++,
		(x) => x.incoming.mismatchingParent++,
	]) {
		const bad = structuredClone(after);
		mutate(bad);
		assert.equal(
			reconcileMixedNative({ before, after: bad, rows, ids }).complete,
			false,
		);
	}
	assert.equal(
		reconcileMixedNative({ before, after, rows: [], ids }).complete,
		false,
	);
	assert.equal(
		reconcileMixedNative({ before, after, rows: [row(), row()], ids }).complete,
		false,
	);
	for (const key of [
		"nativeProof",
		"closed",
		"pg",
		"rows",
		"cache",
		"eventLoop",
	]) {
		const bad = row();
		bad.coverage[key] = false;
		assert.equal(
			reconcileMixedNative({ before, after, rows: [bad], ids }).complete,
			false,
		);
	}
	for (const key of [
		"lateSpans",
		"rejectedBatches",
		"unattributedNativeSpans",
	]) {
		const bad = row();
		bad.coverage[key] = 1;
		assert.equal(
			reconcileMixedNative({ before, after, rows: [bad], ids }).complete,
			false,
		);
	}
	const missing = row();
	missing.rowsRetrieved = null;
	assert.equal(
		reconcileMixedNative({ before, after, rows: [missing], ids }).complete,
		false,
	);
});

test("whole mixed observation uses real v2 registration, native close/flush and SDK receipt around finite HTTP reads", {
	timeout: 15000,
}, async () => {
	const { spawn } = await import("node:child_process");
	const { mkdtemp, readFile, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const { FixtureNativeCoverage, startFixtureNativeControl } = await import(
		"../../apps/webapp/src/lib/performance-fixture-native-coverage.ts"
	);
	const { beginMixedObservation, finishMixedObservation } = await import(
		"./mixed-load-observation.mjs"
	);
	const { readCollectorCounters } = await import("./collector-client.mjs");
	const folder = await mkdtemp(join(tmpdir(), "z8-mixed-v2-")),
		control = join(folder, "collector.json"),
		nativeControl = join(folder, "native.json");
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(new URL("./collector.mjs", import.meta.url)),
			"--control",
			control,
			"--out",
			join(folder, "metrics.json"),
			"--require-registration",
			"--observer-control",
			nativeControl,
		],
		{ stdio: "ignore", windowsHide: true },
	);
	let native, server;
	try {
		let endpoint;
		for (let n = 0; n < 100; n++) {
			try {
				endpoint = JSON.parse(await readFile(control, "utf8")).endpoint;
				break;
			} catch {
				await new Promise((done) => setTimeout(done, 20));
			}
		}
		assert.ok(endpoint);
		const coverage = new FixtureNativeCoverage();
		coverage.enableDriverCounter();
		const traceId = id(7),
			spans = [];
		let sequence = 0,
			flushes = 0;
		native = await startFixtureNativeControl(
			coverage,
			async () => {
				flushes++;
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						resourceSpans: [
							{
								resource: {
									attributes: [
										{
											key: "z8.perf.observer.version",
											value: { intValue: "2" },
										},
									],
								},
								scopeSpans: [
									{
										scope: { name: "@opentelemetry/instrumentation-pg" },
										spans,
									},
								],
							},
						],
					}),
				});
				assert.equal(response.status, 200);
			},
			nativeControl,
		);
		const observation = await beginMixedObservation(control, [traceId]);
		server = createServer((_request, response) => {
			const acquisition = {
				name: "pg-pool.connect",
				instrumentationScope: { name: "@opentelemetry/instrumentation-pg" },
				spanContext: () => ({ traceId }),
			};
			coverage.onStart(acquisition);
			coverage.onEnd(acquisition);
			spans.push({
				traceId,
				spanId: (++sequence).toString(16).padStart(16, "0"),
				name: "pg-pool.connect",
				startTimeUnixNano: "1000000",
				endTimeUnixNano: "2000000",
			});
			const span = {
				name: "pg.query",
				instrumentationScope: { name: "@opentelemetry/instrumentation-pg" },
				spanContext: () => ({ traceId }),
			};
			coverage.driverQuery(traceId);
			coverage.onStart(span);
			coverage.onEnd(span);
			spans.push({
				traceId,
				spanId: (++sequence).toString(16).padStart(16, "0"),
				name: "pg.query",
				startTimeUnixNano: "1000000",
				endTimeUnixNano: "2000000",
				attributes: [
					{ key: "db.response.returned_rows", value: { intValue: "2" } },
				],
			});
			spans.push({
				traceId,
				spanId: (++sequence).toString(16).padStart(16, "0"),
				name: "test.http",
				kind: 2,
				startTimeUnixNano: "1000000",
				endTimeUnixNano: "2000000",
				attributes: [
					{ key: "z8.perf.cache.coverage", value: { boolValue: true } },
					{ key: "z8.perf.event_loop.probes", value: { intValue: "1" } },
					{ key: "z8.perf.event_loop.max_delay_ms", value: { doubleValue: 0 } },
				],
			});
			response.end("ok");
		});
		await new Promise((done) => server.listen(0, "127.0.0.1", done));
		let reads = 0;
		await runMixedReader({
			limit: 100,
			stopped: () => reads === 4,
			read: async () => {
				await (await fetch(`http://127.0.0.1:${server.address().port}`)).text();
				return { success: true };
			},
			observe: () => reads++,
		});
		assert.equal(
			flushes,
			0,
			"No exporter/native drain occurs between hot reads",
		);
		server.closeAllConnections();
		await new Promise((done) => server.close(done));
		server = null;
		const result = await finishMixedObservation(observation);
		assert.equal(flushes, 1);
		assert.equal(
			result.nativeRunCoverage.complete,
			true,
			JSON.stringify(result),
		);
		assert.equal(result.nativeRunCoverage.driverQueries, 4);
		assert.equal(result.nativeRunCoverage.receivedQueries, 4);
		assert.equal(result.nativeRunCoverage.standard.complete, true);
		const {
			serverBalance,
			serverStarted,
			serverEnded,
			serverScopes,
			lastActivityAgeMs,
			drained,
			drainElapsedMs,
			...accounting
		} = result.nativeCloseProof[0];
		assert.deepEqual(
			[accounting],
			[
				{
					traceId,
					queries: 4,
					acquisitions: 4,
					cache: 0,
					started: { queries: 4, acquisitions: 4, cache: 0 },
					ended: { queries: 4, acquisitions: 4, cache: 0 },
					unattributedNativeSpans: 0,
					driverQueries: 4,
					driverComplete: true,
					complete: true,
					serverWitnesses: {
						limit: 128,
						overflow: 0,
						missingIds: 0,
						duplicateStarts: 0,
						unmatchedEnds: 0,
						open: [],
					},
					incomingHttp: {
						records: [],
						overflow: 0,
						missingSpanIds: 0,
						duplicateSpanIds: 0,
						invalidPathnames: 0,
						readErrors: 0,
						rejected: {
							missingOrMalformedParent: 0,
							unknownHeaderTrace: 0,
							traceMismatch: 0,
						},
						limit: 128,
					},
				},
			],
		);
		assert.equal(serverBalance, 0);
		assert.equal(serverStarted, 0);
		assert.equal(serverEnded, 0);
		assert.deepEqual(serverScopes, {
			http: { started: 0, ended: 0 },
			next: { started: 0, ended: 0 },
			other: { started: 0, ended: 0 },
		});
		assert.ok(lastActivityAgeMs >= 500);
		assert.equal(drained, true);
		assert.ok(Number.isFinite(drainElapsedMs) && drainElapsedMs >= 0);
		assert.ok(Number.isFinite(result.nativeCloseElapsedMs));
		assert.ok(result.nativeCloseElapsedMs >= 0);
		coverage.driverQuery();
		assert.equal(
			reconcileMixedNative({
				before: observation.before,
				after: await readCollectorCounters(control),
				rows: result.rows,
				ids: [traceId],
			}).complete,
			false,
			"Even wholly lost late SDK/export work cannot hide a real driver call",
		);
		const failedTrace = id(8);
		spans.length = 0;
		spans.push({
			traceId: failedTrace,
			spanId: (++sequence).toString(16).padStart(16, "0"),
			name: "test.http",
			kind: 2,
			startTimeUnixNano: "1000000",
			endTimeUnixNano: "2000000",
		});
		const failedObservation = await beginMixedObservation(control, [
			failedTrace,
		]);
		coverage.driverQuery(failedTrace);
		const failed = await finishMixedObservation(failedObservation);
		assert.equal(failed.nativeRunCoverage.complete, false);
		assert.equal(failed.nativeRunCoverage.standard.complete, false);
		assert.equal(failed.nativeCloseProof[0].driverQueries, 1);
		assert.equal(failed.nativeCloseProof[0].queries, 0);
		assert.equal(failed.nativeCloseProof[0].driverComplete, false);
		assert.equal(failed.nativeCloseProof[0].complete, false);
		assert.equal(failed.nativeCloseProof[0].drained, true);
		assert.equal(failed.nativeCloseProof[0].serverBalance, 0);
		assert.ok(Number.isFinite(failed.nativeCloseElapsedMs));
		assert.equal(failed.rows[0].queryCount, null);
		assert.equal(failed.rows[0].coverage.nativeProof, false);
	} finally {
		server?.closeAllConnections();
		if (server) await new Promise((done) => server.close(done));
		native?.closeAllConnections();
		if (native) await new Promise((done) => native.close(done));
		child.kill();
		await new Promise((done) =>
			child.exitCode !== null ? done() : child.once("exit", done),
		);
		await rm(folder, { recursive: true, force: true });
	}
});

test("control-only HTTP remains diagnostic while any unmatched native work still fails reconciliation", () => {
	const before = counters(),
		after = counters(3, 2, 2);
	after.incoming.otherHeaderOtherSpan = 3;
	assert.equal(
		reconcileMixedNative({ before, after, rows: [row()], ids: [id(1)] })
			.complete,
		true,
	);
	for (const mutate of [
		(value) => value.unknown++,
		(value) => value.driverQueries++,
		(value) => {
			value.started.cache++;
			value.ended.cache++;
		},
	]) {
		const bad = structuredClone(after);
		mutate(bad);
		assert.equal(
			reconcileMixedNative({ before, after: bad, rows: [row()], ids: [id(1)] })
				.complete,
			false,
		);
	}
});

test("strict mixed transport keeps empty-profile proof and refuses later loss, overflow or censorship", async () => {
	const { mixedTransportIsComplete } = await import(
		"./mixed-load-observation.mjs"
	);
	const reasons = () => ({
		unexpectedLoopback: 0,
		nonLoopbackHttp: 0,
		loopbackConnect: 0,
		nonLoopbackConnect: 0,
		malformed: 0,
	});
	const counts = () => ({
		requests: 0,
		rewrittenRequests: 0,
		refusedRequests: 0,
		upstreamFailures: 0,
		responseBodyBytes: 0,
		refusalReasons: reasons(),
	});
	const sample = {
		traceTransport: {
			...counts(),
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
					preferences: {
						net: { network_prediction_options: 2 },
						search: { suggest_enabled: false },
						default_search_provider: { enabled: false },
					},
					arguments: ["--disable-features=AutofillServerCommunication"],
					browserVersion: "Chrome/test",
				},
			},
			afterInitialization: counts(),
		},
		wire: {
			complete: true,
			capped: false,
			mandatoryErrors: 0,
			mandatoryPending: 0,
			observationOverflows: 0,
			unknownInheritedRedirects: 0,
			censored: false,
		},
	};
	assert.equal(mixedTransportIsComplete(sample), true);
	for (const key of [
		"capped",
		"censored",
		"mandatoryErrors",
		"mandatoryPending",
		"observationOverflows",
		"unknownInheritedRedirects",
	]) {
		const bad = structuredClone(sample);
		bad.wire[key] = typeof bad.wire[key] === "boolean" ? true : 1;
		assert.equal(mixedTransportIsComplete(bad), false);
	}
	const bad = structuredClone(sample);
	bad.traceTransport.afterInitialization.upstreamFailures = 1;
	bad.traceTransport.upstreamFailures = 1;
	assert.equal(mixedTransportIsComplete(bad), false);
	const init = structuredClone(sample);
	init.traceTransport.browserInitialization.emptyContext = false;
	assert.equal(mixedTransportIsComplete(init), false);
});

test("fulfilled readers progress in microtasks without introducing a timer throttle", async () => {
	let count = 0;
	const running = runMixedReader({
		limit: 100,
		stopped: () => count === 8,
		read: async () => ({ success: true }),
		observe: () => count++,
	});
	for (let n = 0; n < 24; n++) await Promise.resolve();
	assert.equal(
		count,
		8,
		"No sleep or exporter drain may be inserted after a successful read",
	);
	await running;
});
test("clock success cannot replace missing response/readiness observations with zero", async () => {
	const { clockObservationIsComplete } = await import(
		"./mixed-load-observation.mjs"
	);
	const value = {
		success: true,
		censored: false,
		unknownCommandOutcome: false,
		httpStatus: 200,
		commandResponseMs: 10,
		clockReadyMs: 20,
	};
	assert.equal(clockObservationIsComplete(value), true);
	for (const key of Object.keys(value)) {
		const missing = { ...value };
		delete missing[key];
		assert.equal(clockObservationIsComplete(missing), false);
	}
	assert.equal(
		clockObservationIsComplete({ ...value, commandResponseMs: 30 }),
		false,
	);
});

test("mixed guard orchestration awaits every context then rejects errors appearing during the other acknowledgment",async()=>{
 const {requireCleanMixedProgress}=await import("./mixed-load-observation.mjs");
 const app=()=>({failures:0,serverErrors:0,unknown:0,httpErrors:0,overflows:0,decodeFailures:0,registryConflicts:0});
 let unknown=0,pageErrors=0,release,confirmed=0,settled=false,expectedDeadline=42;
 const item=hold=>({transport:{snapshot:()=>({applicationEvidence:{...app(),unknown}})},browserObservation:{snapshot:()=>({measured:{coverage:{missing:0,errors:0,overflow:0}},allPhase:{realFailures:0}}),acknowledgeMixedProgress:async({operationDeadlineMs})=>{assert.equal(operationDeadlineMs,expectedDeadline);if(hold)await new Promise(resolve=>{release=resolve;});return {technical:"token"};},confirmMixedProgress:()=>{confirmed++;}}});
 const opened=[item(false),item(true)];
 const running=requireCleanMixedProgress({opened,pageErrors:()=>pageErrors,operationDeadlineMs:42});running.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);assert.equal(confirmed,0);unknown=1;release();await assert.rejects(running,/not clean/);assert.equal(confirmed,0);
 unknown=0;expectedDeadline=null;opened.pop();await requireCleanMixedProgress({opened,pageErrors:()=>pageErrors});assert.equal(confirmed,1);
 pageErrors=1;await assert.rejects(requireCleanMixedProgress({opened,pageErrors:()=>pageErrors}));assert.equal(confirmed,1);
});
