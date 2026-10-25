import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	FixtureNativeCoverage,
	startFixtureNativeControl,
} from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";
import { createAdmissionResponseWitness } from "./admission-response-witness.mjs";
import * as observationModule from "./multi-instance-observation.mjs";
import { beginMultiInstanceObservation } from "./multi-instance-observation.mjs";
import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
import { createFixtureTraceTransport } from "./trace-transport.mjs";

test("one declared real clock denial retains raw HTTP error and completes paired cleanup", async () => {
	const id = "a".repeat(32),
		backend = createServer((_req, res) => {
			res.writeHead(401, { "content-type": "application/json" });
			res.end('{"hasEmployee":false}');
		});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => id,
	});
	const expectedAdmissionResponse = createAdmissionResponseWitness({
		origin,
		traceIds: [id, "b".repeat(32), "c".repeat(32)],
		scenario: "signed-out",
	});
	let snapshot,
		closed = false,
		nativeClosed = false;
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		await new Promise((done, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/api/time-entries/status`,
					headers: { host: new URL(origin).host },
				},
				(res) => {
					res.resume();
					res.once("end", done);
					res.once("error", reject);
				},
			);
			call.once("error", reject);
			call.end();
		});
		expectedAdmissionResponse.confirm({
			response: {
				status: 401,
				json: true,
				redirected: false,
				hasEmployee: false,
				employeeIdMaterialized: false,
				clockedIn: false,
				activePeriodMaterialized: false,
			},
			clockStatusDenied: true,
			protectedContentEmitted: false,
		});
		await observationModule.closeMultiInstanceContext({
			context: {
				async close() {
					closed = true;
				},
			},
			transport,
			expectedAdmissionResponse,
			closeVisit: async () => {
				nativeClosed = true;
			},
			recordSnapshot: (value) => {
				snapshot = value;
			},
		});
		assert.equal(closed, true);
		assert.equal(nativeClosed, true);
		assert.equal(snapshot.nativeCleanup.mandatoryErrors, 1);
		assert.equal(snapshot.nativeCleanup.groups.otherFinite.errors, 1);
		assert.equal(
			snapshot.nativeCleanup.complete,
			false,
			"Raw zero-error proof is retained unchanged.",
		);
		assert.equal(snapshot.admissionResponse.matches, 1);
		for (const changed of [
			{ ...snapshot.admissionResponse, unknown: 1 },
			{ ...snapshot.admissionResponse, responses: undefined },
			{
				...snapshot.admissionResponse,
				responses: [
					{ ...snapshot.admissionResponse.responses[0], aborted: true },
				],
			},
		])
			assert.equal(
				observationModule.pairedContextCleanupComplete({
					...snapshot,
					admissionResponse: changed,
				}),
				false,
			);
		assert.equal(snapshot.expectedAdmissionDenial.complete, true);
		assert.equal(snapshot.expectedAdmissionDenial.rawCleanupComplete, false);
		assert.equal(
			observationModule.pairedContextCleanupComplete({
				...snapshot,
				nativeCleanup: { ...snapshot.nativeCleanup, capped: true },
			}),
			false,
		);
		assert.equal(
			observationModule.pairedContextCleanupComplete({
				...snapshot,
				nativeCleanup: { ...snapshot.nativeCleanup, mandatoryErrors: 2 },
			}),
			false,
		);
		assert.equal(
			observationModule.pairedContextCleanupComplete(snapshot),
			true,
		);
	} finally {
		expectedAdmissionResponse.close();
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
	}
});

test("declared admission cannot cover a wrong response, extra error, duplicate, missing acknowledgement or protected data", async (t) => {
	for (const mode of [
		"500",
		"wrong-route",
		"wrong-method",
		"query",
		"duplicate",
		"extra-error",
		"no-ack",
		"leak",
		"unknown-payload",
	])
		await t.test(mode, async () => {
			const id = "a".repeat(32),
				backend = createServer((req, res) => {
					res.writeHead(mode === "500" || req.url === "/extra" ? 500 : 401, {
						"content-type": "application/json",
					});
					res.end("{}");
				});
			await new Promise((done) => backend.listen(0, "127.0.0.1", done));
			const origin = `http://127.0.0.1:${backend.address().port}`;
			const transport = await createFixtureTraceTransport({
				origin,
				getTraceId: () => id,
			});
			const expectedAdmissionResponse = createAdmissionResponseWitness({
				origin,
				traceIds: [id, "b".repeat(32), "c".repeat(32)],
				scenario: "signed-out",
			});
			let snapshot,
				closed = false,
				nativeClosed = false;
			try {
				transport.wire.begin(performance.now());
				const proxy = new URL(transport.browserContextOptions.proxyServer);
				const call = (path) =>
					new Promise((done, reject) => {
						const req = request(
							{
								hostname: proxy.hostname,
								port: proxy.port,
								path: origin + path,
								method: mode === "wrong-method" ? "POST" : "GET",
								headers: { host: new URL(origin).host },
							},
							(res) => {
								res.resume();
								res.once("end", done);
								res.once("error", reject);
							},
						);
						req.once("error", reject);
						req.end();
					});
				const path =
					mode === "wrong-route"
						? "/wrong"
						: mode === "query"
							? "/api/time-entries/status?other=1"
							: "/api/time-entries/status";
				await call(path);
				if (mode === "duplicate") await call(path);
				if (mode === "extra-error") await call("/extra");
				const confirm = () =>
					expectedAdmissionResponse.confirm({
						response: {
							status: mode === "500" ? 500 : 401,
							json: true,
							redirected: false,
							hasEmployee: mode === "leak",
							employeeIdMaterialized: false,
							clockedIn: false,
							activePeriodMaterialized:
								mode === "unknown-payload" ? undefined : false,
						},
						clockStatusDenied: true,
						protectedContentEmitted: false,
					});
				if (["500", "leak", "unknown-payload"].includes(mode))
					assert.throws(confirm);
				else if (mode !== "no-ack") confirm();
				await assert.rejects(
					observationModule.closeMultiInstanceContext({
						context: {
							async close() {
								closed = true;
							},
						},
						transport,
						expectedAdmissionResponse,
						closeVisit: async () => {
							nativeClosed = true;
						},
						recordSnapshot: (value) => {
							snapshot = value;
						},
					}),
				);
				assert.equal(closed, true);
				assert.equal(nativeClosed, true);
				assert.equal(
					observationModule.pairedContextCleanupComplete(snapshot),
					false,
				);
				assert.ok(snapshot.nativeCleanup.mandatoryErrors > 0);
			} finally {
				expectedAdmissionResponse.close();
				await transport.close();
				backend.closeAllConnections();
				await new Promise((done) => backend.close(done));
			}
		});
});

test("clock cleanup waits for an actual finite HTTP response and quiet window before browser closure", async () => {
	let release;
	const backend = createServer((_req, res) => {
		release = () => res.end("complete");
		res.writeHead(200);
		res.write("pending");
	});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "e".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const response = new Promise((done, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/finite`,
				},
				(answer) => {
					answer.resume();
					answer.on("end", done);
				},
			);
			call.on("error", reject);
			call.end();
		});
		while (!release) await pause(10);
		let drained = false;
		const drain = observationModule
			.waitForMultiInstanceContextDrain(transport)
			.then((result) => {
				drained = true;
				return result;
			});
		await pause(1100);
		assert.equal(
			drained,
			false,
			"A quiet but incomplete response must keep cleanup open.",
		);
		release();
		await response;
		const result = await drain;
		assert.equal(result.complete, true);
		assert.equal(result.mandatoryPending, 0);
		assert.equal(result.mandatoryErrors, 0);
		assert.ok(result.quietObservedMs >= 1000);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
	}
});

test("clock cleanup rejects real HTTP errors and caps unfinished prefetches", {
	timeout: 20000,
}, async () => {
	for (const mode of ["reset", "prefetch"]) {
		let received = false;
		const backend = createServer((req, res) => {
			received = true;
			if (mode === "reset") req.socket.destroy();
			else {
				res.writeHead(200);
				res.write("incomplete");
			}
		});
		await new Promise((done) => backend.listen(0, "127.0.0.1", done));
		const origin = `http://127.0.0.1:${backend.address().port}`;
		const transport = await createFixtureTraceTransport({
			origin,
			getTraceId: () => "f".repeat(32),
		});
		try {
			transport.wire.begin(performance.now());
			const proxy = new URL(transport.browserContextOptions.proxyServer);
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/pending`,
					headers: mode === "prefetch" ? { purpose: "prefetch" } : {},
				},
				(answer) => {
					answer.resume();
					answer.on("error", () => {});
				},
			);
			call.on("error", () => {});
			call.end();
			while (!received) await pause(10);
			const started = performance.now();
			await assert.rejects(
				observationModule.waitForMultiInstanceContextDrain(transport),
				(error) => {
					if (mode === "reset")
						assert.ok(error.cleanupProof.mandatoryErrors > 0);
					else {
						assert.equal(error.cleanupProof.groups.prefetch.pending, 1);
						assert.ok(performance.now() - started >= 10000);
					}
					return true;
				},
			);
		} finally {
			await transport.close();
			backend.closeAllConnections();
			await new Promise((done) => backend.close(done));
		}
	}
});

test("cleanup drains pending HTTP before rejecting a mandatory cancel; explicit header prefetch cancel stays separate", async () => {
	for (const prefetch of [false, true]) {
		let release;
		const backend = createServer((req, res) => {
			res.writeHead(200);
			res.write("pending");
			if (req.url === "/remaining") release = () => res.end("complete");
		});
		await new Promise((done) => backend.listen(0, "127.0.0.1", done));
		const origin = `http://127.0.0.1:${backend.address().port}`;
		const transport = await createFixtureTraceTransport({
			origin,
			getTraceId: () => "c".repeat(32),
		});
		try {
			transport.wire.begin(performance.now());
			const proxy = new URL(transport.browserContextOptions.proxyServer);
			const canceled = new Promise((done) => {
				const call = request(
					{
						hostname: proxy.hostname,
						port: proxy.port,
						path: `${origin}/cancel`,
						headers: prefetch ? { purpose: "prefetch" } : {},
					},
					(answer) => {
						answer.on("error", () => {});
						answer.once("data", () => {
							answer.destroy();
							done();
						});
					},
				);
				call.on("error", () => {});
				call.end();
			});
			await canceled;
			const remaining = new Promise((done) => {
				const call = request(
					{
						hostname: proxy.hostname,
						port: proxy.port,
						path: `${origin}/remaining`,
					},
					(answer) => {
						answer.resume();
						answer.on("end", done);
						answer.on("error", () => {});
					},
				);
				call.on("error", () => {});
				call.end();
			});
			while (!release || transport.snapshot().downstreamCancellations === 0)
				await pause(10);
			let settled = false;
			const drain = observationModule
				.waitForMultiInstanceContextDrain(transport)
				.then(
					(value) => {
						settled = true;
						return { value };
					},
					(error) => {
						settled = true;
						return { error };
					},
				);
			await pause(1100);
			assert.equal(
				settled,
				false,
				"Recorded errors must not force closure while another response remains pending.",
			);
			release();
			await remaining;
			const result = await drain;
			if (prefetch) {
				assert.equal(result.error, undefined);
				assert.equal(result.value.groups.prefetch.errors, 1);
				assert.equal(result.value.mandatoryErrors, 0);
			} else {
				assert.ok(result.error);
				assert.ok(result.error.cleanupProof.mandatoryErrors > 0);
				assert.equal(result.error.cleanupProof.mandatoryPending, 0);
			}
			assert.equal(transport.snapshot().upstreamFailures, 0);
			assert.equal(transport.snapshot().downstreamCancellations, 1);
		} finally {
			await transport.close();
			backend.closeAllConnections();
			await new Promise((done) => backend.close(done));
		}
	}
});

test("paired acceptance distinguishes zero-app-IO startup from a late escape and refuses broken arithmetic", () => {
	const reasons = {
		unexpectedLoopback: 0,
		nonLoopbackHttp: 0,
		loopbackConnect: 0,
		nonLoopbackConnect: 3,
		malformed: 0,
	};
	const startup = {
		policy: "isolated-profile-no-prediction-v1",
		launch: { policy: "isolated-profile-no-prediction-v1", headless: true },
		emptyContext: true,
		quietMs: 2000,
		capMs: 10000,
		quietObservedMs: 2010,
		elapsedMs: 2500,
		capped: false,
		pending: 0,
		complete: true,
		requests: 0,
		rewrittenRequests: 0,
		responseBodyBytes: 0,
		refusedRequests: 3,
		upstreamFailures: 0,
		refusalReasons: reasons,
	};
	const snapshot = {
		nativeCleanup: {
			...createProxyWireObserver().state(2000),
			policy: "post-snapshot-finite-prefetch-quiet-v1",
			scope: "post-snapshot-context-cleanup",
			usableContentClaim: false,
			complete: true,
			capped: false,
			quietMs: 1000,
			capMs: 10000,
			elapsedMs: 2000,
			quietObservedMs: 1000,
			prefetchQuietObservedMs: 1000,
		},
		requests: 2,
		rewrittenRequests: 2,
		responseBodyBytes: 33,
		refusedRequests: 3,
		upstreamFailures: 0,
		refusalReasons: reasons,
		browserInitialization: startup,
		afterInitialization: {
			requests: 2,
			rewrittenRequests: 2,
			responseBodyBytes: 33,
			refusedRequests: 0,
			upstreamFailures: 0,
			refusalReasons: { ...reasons, nonLoopbackConnect: 0 },
		},
	};
	assert.equal(
		typeof observationModule.multiInstanceTransportComplete,
		"function",
	);
	assert.equal(
		observationModule.multiInstanceTransportComplete(snapshot),
		true,
	);
	assert.equal(
		observationModule.multiInstanceTransportComplete({
			...snapshot,
			nativeCleanup: undefined,
		}),
		false,
	);
	assert.equal(
		observationModule.multiInstanceTransportComplete({
			...snapshot,
			nativeCleanup: { ...snapshot.nativeCleanup, complete: false },
		}),
		false,
	);
	assert.equal(
		observationModule.multiInstanceTransportComplete({
			...snapshot,
			responseBodyBytes: 34,
		}),
		false,
	);
	const escaped = structuredClone(snapshot);
	escaped.refusedRequests = 4;
	escaped.refusalReasons.nonLoopbackConnect = 4;
	escaped.afterInitialization.refusedRequests = 1;
	escaped.afterInitialization.refusalReasons.nonLoopbackConnect = 1;
	assert.equal(
		observationModule.multiInstanceTransportComplete(escaped),
		false,
	);
	const appDuringInit = structuredClone(snapshot);
	appDuringInit.browserInitialization.requests = 1;
	assert.equal(
		observationModule.multiInstanceTransportComplete(appDuringInit),
		false,
	);
	const capped = structuredClone(snapshot);
	capped.browserInitialization.capped = true;
	assert.equal(observationModule.multiInstanceTransportComplete(capped), false);
	const missingClock = structuredClone(snapshot);
	delete missingClock.browserInitialization.quietObservedMs;
	assert.equal(
		observationModule.multiInstanceTransportComplete(missingClock),
		false,
	);
	assert.equal(
		observationModule.multiInstanceTransportComplete({
			requests: 2,
			refusedRequests: 0,
			upstreamFailures: 0,
		}),
		false,
	);
});

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

test("transport context coverage rejects missing, duplicate, unexpected and failed-init snapshots", () => {
	const context = { contextId: "context-a", initialized: true };
	const snapshot = { contextId: "context-a" };
	const coverage = observationModule.multiInstanceTransportCoverage;
	assert.equal(typeof coverage, "function");
	assert.equal(
		coverage([], []).complete,
		true,
		"Node-only observations remain valid.",
	);
	assert.equal(coverage([context], []).complete, false);
	assert.equal(coverage([context], [snapshot]).complete, true);
	assert.equal(coverage([context], [snapshot, snapshot]).complete, false);
	assert.equal(coverage([context, context], [snapshot]).complete, false);
	assert.equal(coverage([context], [{ contextId: "other" }]).complete, false);
	assert.equal(coverage([], [snapshot]).complete, false);
	assert.equal(
		coverage([{ ...context, initialized: false }], [snapshot]).complete,
		false,
	);
	assert.equal(
		coverage([{ ...context, initialized: false }], []).complete,
		false,
	);
});

test("two replica labels cannot reuse one collector or native-control endpoint", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-reused-control-"));
	try {
		const native = join(directory, "native.json");
		await writeFile(
			native,
			JSON.stringify({
				endpoint: "http://127.0.0.1:9",
				protocol: "z8-fixture-native-observer-v2",
			}),
		);
		const controls = {
			a: join(directory, "a.json"),
			b: join(directory, "b.json"),
		};
		for (const path of Object.values(controls))
			await writeFile(
				path,
				JSON.stringify({
					kind: "z8-fixture-otlp-collector-v2",
					endpoint: "http://127.0.0.1:8",
					observerControl: native,
				}),
			);
		await assert.rejects(
			beginMultiInstanceObservation({ controls }),
			/independently/,
		);
	} finally {
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

test("paired V2 lifecycle adds both replicas' same-trace evidence and detects globally lost work", {
	timeout: 15000,
}, async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-observe-")),
		nodes = {};
	try {
		for (const replica of ["a", "b"]) {
			const control = join(directory, `${replica}-collector.json`),
				native = join(directory, `${replica}-native.json`);
			const child = spawn(
				process.execPath,
				[
					fileURLToPath(new URL("./collector.mjs", import.meta.url)),
					"--control",
					control,
					"--out",
					join(directory, `${replica}-metrics.json`),
					"--require-registration",
					"--observer-control",
					native,
				],
				{ stdio: "ignore", windowsHide: true },
			);
			nodes[replica] = { child };
			let endpoint;
			for (let attempt = 0; attempt < 100; attempt++) {
				try {
					endpoint = JSON.parse(await readFile(control, "utf8")).endpoint;
					break;
				} catch {
					await pause(20);
				}
			}
			assert.ok(endpoint);
			const coverage = new FixtureNativeCoverage();
			coverage.enableDriverCounter();
			const spans = [];
			const server = await startFixtureNativeControl(
				coverage,
				async () => {
					const response = await fetch(endpoint, {
						method: "POST",
						headers: { "content-type": "application/json" },
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
											spans: spans.splice(0),
										},
									],
								},
							],
						}),
					});
					assert.equal(response.status, 200);
				},
				native,
			);
			Object.assign(nodes[replica], { server, control, coverage, spans });
		}
		const observation = await beginMultiInstanceObservation({
			controls: { a: nodes.a.control, b: nodes.b.control },
		});
		const traceId = "d".repeat(32),
			visit = await observation.beginVisit([traceId]);
		for (const [replica, count] of [
			["a", 1],
			["b", 2],
		])
			for (let index = 0; index < count; index++) {
				const node = nodes[replica],
					span = {
						name: "pg.query",
						instrumentationScope: { name: "@opentelemetry/instrumentation-pg" },
						spanContext: () => ({ traceId }),
					};
				node.coverage.onStart(span);
				node.coverage.driverQuery(traceId);
				node.coverage.onEnd(span);
				node.spans.push({
					name: "pg.query",
					traceId,
					spanId: String(index + 1).padStart(16, "0"),
					startTimeUnixNano: "1000000",
					endTimeUnixNano: "2000000",
					attributes: [
						{ key: "db.response.returned_rows", value: { intValue: "1" } },
					],
				});
			}
		const closed = await observation.endVisit(visit);
		assert.equal(closed.replicas.a[0].observedQueryCount, 1);
		assert.equal(closed.replicas.b[0].observedQueryCount, 2);
		const proof = await observation.finish();
		assert.equal(proof.complete, true);
		assert.equal(proof.combined.driverQueryCount, 3);
		assert.equal(proof.combined.observedQueryCount, 3);
		const browser = {
			fixtureLaunchPolicy: {
				policy: "isolated-profile-no-prediction-v1",
				headless: true,
			},
			async createBrowserContext() {
				return {
					browser: () => browser,
					pages: async () => [],
					newPage: async () => ({ url: () => "about:blank" }),
					close: async () => {},
				};
			},
		};
		const context = await observation.createContext(
			browser,
			"http://127.0.0.1:9",
		);
		await observation.closeRemainingVisits();
		const missingSnapshot = await observation.reconcile();
		await assert.rejects(context.close(), /exactly once/);
		assert.equal(missingSnapshot.combined.pendingNativeQueries, 0);
		assert.equal(
			missingSnapshot.transportComplete,
			false,
			"Balanced native work cannot replace a missing browser transport.",
		);
		assert.equal(missingSnapshot.complete, false);
		const recorded = await observation.reconcile();
		assert.equal(recorded.transportComplete, true);
		assert.equal(recorded.transportCoverage.expectedContexts, 1);
		assert.equal(recorded.transportCoverage.observedSnapshots, 1);
		assert.equal(recorded.transportCoverage.uniqueSnapshots, 1);
		await assert.rejects(
			observation.createContext(
				{
					createBrowserContext: async () => ({
						browser: () => browser,
						pages: async () => ["not empty"],
						close: async () => {},
					}),
				},
				"http://127.0.0.1:9",
			),
			/empty fresh context/,
		);
		const failedInit = await observation.reconcile();
		assert.equal(failedInit.transportCoverage.expectedContexts, 2);
		assert.equal(failedInit.transportCoverage.observedSnapshots, 2);
		assert.equal(failedInit.transportCoverage.initializationFailures, 1);
		assert.equal(failedInit.transportComplete, false);
		// This deliberately never exports; the whole-run oracle must still detect it.
		nodes.b.coverage.driverQuery();
		const invalid = await observation.reconcile();
		assert.equal(invalid.complete, false);
		assert.equal(invalid.replicas.b.driverQueryCount, 3);
	} finally {
		for (const node of Object.values(nodes)) {
			node.server?.closeAllConnections();
			if (node.server) await new Promise((done) => node.server.close(done));
			node.child.kill();
			await new Promise((done) =>
				node.child.exitCode !== null ? done() : node.child.once("exit", done),
			);
		}
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});

const requireSdk = createRequire(
	new URL("../../apps/webapp/package.json", import.meta.url),
);
const { BasicTracerProvider } = requireSdk("@opentelemetry/sdk-trace-base");
const { SpanKind, ROOT_CONTEXT, trace } = requireSdk("@opentelemetry/api");
test("paired context closes after pending HTTP finishes and a real SDK SERVER span ends, preserving fixed snapshots", async () => {
	const id = "d".repeat(32),
		coverage = new FixtureNativeCoverage();
	coverage.register([id]);
	coverage.enableDriverCounter();
	const provider = new BasicTracerProvider({
		spanProcessors: [
			{
				onStart: (span) => coverage.onStart(span),
				onEnd: (span) => coverage.onEnd(span),
				forceFlush: async () => {},
				shutdown: async () => {},
			},
		],
	});
	const tracer = provider.getTracer("@opentelemetry/instrumentation-http");
	let release,
		finished = false;
	const backend = createServer((_req, res) => {
		const span = tracer.startSpan(
			"fixed-http-fixture",
			{ kind: SpanKind.SERVER },
			trace.setSpanContext(ROOT_CONTEXT, {
				traceId: id,
				spanId: "1".repeat(16),
				traceFlags: 1,
			}),
		);
		res.on("finish", () => {
			span.end();
			finished = true;
		});
		res.writeHead(200, { "content-type": "application/javascript" });
		res.write("early");
		release = () => res.end("late");
	});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => id,
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const response = new Promise((done, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/finite`,
				},
				(answer) => {
					answer.resume();
					answer.on("end", done);
					answer.on("error", reject);
				},
			);
			call.on("error", reject);
			call.end();
		});
		response.catch(() => {});
		while (!release) await pause(5);
		const sample = {
			usableContentMs: 42,
			lcpMs: 30,
			clockReadyMs: 40,
			javascriptBytes: 5,
			totalBytes: 5,
			resourceWindowComplete: false,
			resourcePendingRequests: 1,
			pendingScriptRequests: 1,
		};
		const fixed = structuredClone(sample);
		let closed = false;
		let snapshot,
			nativeClosed = false;
		const closing = observationModule.closeMultiInstanceContext({
			closeVisit: async () => {
				nativeClosed = await coverage.drain([id]);
				assert.equal(nativeClosed, true);
			},
			recordSnapshot: (value) => {
				snapshot = value;
			},
			context: {
				async close() {
					closed = true;
				},
			},
			transport,
			sample,
		});
		closing.catch(() => {});
		await pause(1100);
		assert.equal(
			closed,
			false,
			"Readiness must not close an unfinished finite response.",
		);
		assert.equal(finished, false);
		release();
		await response;
		await closing;
		assert.equal(closed, true);
		assert.equal(finished, true);
		assert.deepEqual(
			Object.fromEntries(Object.keys(fixed).map((k) => [k, sample[k]])),
			fixed,
		);
		assert.equal(snapshot.nativeCleanup.complete, true);
		assert.equal(nativeClosed, true);
		assert.equal(snapshot.nativeCleanup.groups.javascript.completedBytes, 9);
		assert.equal(coverage.close([id])[0].complete, true);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
		await provider.shutdown();
	}
});

test("paired closure drains remaining real HTTP before failing a mandatory error; explicit prefetch errors stay separate", async () => {
	for (const prefetch of [false, true]) {
		let release;
		const backend = createServer((req, res) => {
			if (req.url === "/error") {
				res.writeHead(500);
				res.end("failed");
			} else {
				res.writeHead(200);
				res.write("pending");
				release = () => res.end("done");
			}
		});
		await new Promise((done) => backend.listen(0, "127.0.0.1", done));
		const origin = `http://127.0.0.1:${backend.address().port}`;
		const transport = await createFixtureTraceTransport({
			origin,
			getTraceId: () => "c".repeat(32),
		});
		try {
			transport.wire.begin(performance.now());
			const proxy = new URL(transport.browserContextOptions.proxyServer);
			const call = (path, headers = {}) =>
				new Promise((done, reject) => {
					const req = request(
						{
							hostname: proxy.hostname,
							port: proxy.port,
							path: origin + path,
							headers,
						},
						(res) => {
							res.resume();
							res.on("end", done);
							res.on("error", reject);
						},
					);
					req.on("error", reject);
					req.end();
				});
			await call("/error", prefetch ? { purpose: "prefetch" } : {});
			const pending = call("/pending");
			pending.catch(() => {});
			while (!release) await pause(5);
			const context = {
				closed: false,
				async close() {
					this.closed = true;
				},
			};
			let snapshot,
				nativeClosed = false;
			const closing = observationModule
				.closeMultiInstanceContext({
					context,
					transport,
					closeVisit: async () => {
						nativeClosed = true;
					},
					recordSnapshot: (value) => {
						snapshot = value;
					},
				})
				.then(
					() => ({}),
					(error) => ({ error }),
				);
			await pause(1100);
			assert.equal(
				context.closed,
				false,
				"Even recorded errors cannot skip the pending-response drain.",
			);
			release();
			await pending;
			const result = await closing;
			assert.equal(Boolean(result.error), !prefetch);
			assert.equal(nativeClosed, true);
			assert.equal(context.closed, true);
			assert.equal(snapshot.nativeCleanup.complete, prefetch);

			assert.equal(snapshot.nativeCleanup.mandatoryPending, 0);
			assert.equal(
				snapshot.nativeCleanup.groups.prefetch.errors,
				prefetch ? 1 : 0,
			);
			assert.equal(snapshot.nativeCleanup.mandatoryErrors, prefetch ? 0 : 1);
		} finally {
			await transport.close();
			backend.closeAllConnections();
			await new Promise((done) => backend.close(done));
		}
	}
});

test("an unfinished actual HTTP prefetch caps paired closure and stays a failed observation", {
	timeout: 15000,
}, async () => {
	let received = false;
	const backend = createServer((_req, res) => {
		received = true;
		res.writeHead(200);
		res.write("pending");
	});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "b".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const req = request(
			{
				hostname: proxy.hostname,
				port: proxy.port,
				path: `${origin}/pending`,
				headers: { "next-router-prefetch": "1" },
			},
			(res) => {
				res.resume();
				res.on("error", () => {});
			},
		);
		req.on("error", () => {});
		req.end();
		while (!received) await pause(5);
		const context = {
			closed: false,
			async close() {
				this.closed = true;
			},
		};
		let snapshot,
			nativeClosed = false;
		await assert.rejects(
			observationModule.closeMultiInstanceContext({
				context,
				transport,
				closeVisit: async () => {
					nativeClosed = true;
					throw Error("retained-native-error");
				},
				recordSnapshot: (value) => {
					snapshot = value;
				},
			}),
			(error) => {
				assert.ok(error instanceof AggregateError);
				assert.equal(error.errors.length, 2);
				assert.equal(error.errors[1].message, "retained-native-error");
				return true;
			},
		);
		assert.equal(nativeClosed, true);
		assert.equal(context.closed, true);

		assert.equal(snapshot.nativeCleanup.capped, true);
		assert.equal(snapshot.nativeCleanup.groups.prefetch.pending, 1);
		assert.equal(snapshot.nativeCleanup.mandatoryPending, 0);
		assert.ok(snapshot.nativeCleanup.elapsedMs >= 10000);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
	}
});
