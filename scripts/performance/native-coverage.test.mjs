import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";
import { FixtureNativeCoverage } from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";

test("SERVER witnesses identify an actual SDK-created open Next span without changing completion", async () => {
	const require = createRequire(
		new URL("../../apps/webapp/package.json", import.meta.url),
	);
	const { BasicTracerProvider } = require("@opentelemetry/sdk-trace-base");
	const {
		ROOT_CONTEXT,
		trace,
		SpanKind,
		TraceFlags,
	} = require("@opentelemetry/api");
	const coverage = new FixtureNativeCoverage();
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
	const first = "1".repeat(32),
		second = "2".repeat(32),
		parentId = "3".repeat(16);
	coverage.register([first, second]);
	const tracer = provider.getTracer("next.js");
	const context = (traceId) =>
		trace.setSpanContext(ROOT_CONTEXT, {
			traceId,
			spanId: parentId,
			traceFlags: TraceFlags.SAMPLED,
			isRemote: true,
		});
	const sensitiveName = "GET /en/employees/private-person?secret=value";
	const open = tracer.startSpan(
		sensitiveName,
		{
			kind: SpanKind.SERVER,
			attributes: {
				"next.span_type": "BaseServer.handleRequest",
				"http.target": "/private-person",
				"db.statement": "private-sql",
			},
		},
		context(first),
	);
	const ended = tracer.startSpan(
		"ended",
		{ kind: SpanKind.SERVER },
		context(second),
	);
	ended.end();
	const client = tracer.startSpan(
		"client",
		{ kind: SpanKind.CLIENT },
		context(second),
	);
	try {
		const [failed, complete] = coverage.close([first, second]);
		assert.equal(failed.complete, false);
		assert.equal(failed.queries, 0);
		assert.equal(failed.serverBalance, 1);
		assert.equal(failed.serverWitnesses.open.length, 1);
		const witness = failed.serverWitnesses.open[0];
		assert.equal(witness.spanId, open.spanContext().spanId);
		assert.equal(witness.parentSpanId, parentId);
		assert.equal(witness.scope, "next");
		assert.equal(witness.nextSpanType, "BaseServer.handleRequest");
		assert.equal(
			witness.nameSha256,
			createHash("sha256").update(sensitiveName).digest("hex"),
		);
		assert.equal(witness.sdkEnded, false);
		assert.equal(witness.recording, true);
		assert.equal(witness.kind, SpanKind.SERVER);
		assert.ok(witness.ageMs >= 0);
		assert.equal(witness.onEndObserved, false);
		assert.equal(complete.complete, true);
		assert.equal(complete.serverStarted, 1);
		assert.equal(complete.serverEnded, 1);
		assert.deepEqual(complete.serverWitnesses.open, []);
		const serialized = JSON.stringify([failed, complete]);
		for (const value of [
			"private-person",
			"secret=value",
			"private-sql",
			"http.target",
			"db.statement",
		])
			assert.equal(serialized.includes(value), false);
	} finally {
		open.end();
		client.end();
		await provider.shutdown();
	}
});

test("SERVER witnesses are bounded and expose overflow, missing IDs and safe failed property reads", () => {
	const coverage = new FixtureNativeCoverage(),
		traceId = "4".repeat(32);
	coverage.register([traceId]);
	const server = (index) => ({
		name: "private-route",
		kind: 1,
		instrumentationScope: { name: "next.js" },
		attributes: { "next.span_type": "private-route" },
		spanContext: () => ({
			traceId,
			spanId: index.toString(16).padStart(16, "0"),
		}),
	});
	for (let index = 1; index <= 129; index++) coverage.onStart(server(index));
	coverage.onStart(server(1));
	coverage.onStart({ ...server(130), spanContext: () => ({ traceId }) });
	const proof = coverage.close([traceId])[0];
	assert.equal(proof.complete, false);
	assert.equal(proof.serverStarted, 131);
	assert.equal(proof.serverBalance, 131);
	assert.equal(proof.serverWitnesses.limit, 128);
	assert.equal(proof.serverWitnesses.open.length, 128);
	assert.equal(proof.serverWitnesses.overflow, 1);
	assert.equal(proof.serverWitnesses.missingIds, 1);
	assert.equal(proof.serverWitnesses.duplicateStarts, 1);
	assert.equal(JSON.stringify(proof).includes("private-route"), false);
	coverage.register([traceId]);
	const unavailable = server(131);
	for (const property of [
		"ended",
		"isRecording",
		"attributes",
		"parentSpanContext",
	])
		Object.defineProperty(unavailable, property, {
			get() {
				throw Error("private-getter");
			},
		});
	assert.doesNotThrow(() => coverage.onStart(unavailable));
	const safe = coverage.close([traceId])[0].serverWitnesses.open[0];
	assert.equal(safe.sdkEnded, null);
	assert.equal(safe.recording, null);
	assert.equal(safe.nextSpanType, null);
});

test("SERVER witnesses retain a mismatching end callback without repairing the original balance", () => {
	const coverage = new FixtureNativeCoverage(),
		traceId = "5".repeat(32);
	coverage.register([traceId]);
	const span = {
		name: "technical",
		kind: 1,
		ended: false,
		isRecording: () => false,
		instrumentationScope: { name: "next.js" },
		spanContext: () => ({ traceId, spanId: "6".repeat(16) }),
	};
	coverage.onStart(span);
	span.kind = 0;
	span.ended = true;
	coverage.onEnd(span);
	const proof = coverage.close([traceId])[0];
	assert.equal(proof.complete, false);
	assert.equal(proof.serverBalance, 1);
	assert.equal(proof.serverStarted, 1);
	assert.equal(proof.serverEnded, 0);
	assert.equal(proof.serverWitnesses.open[0].onEndObserved, true);
	assert.equal(proof.serverWitnesses.open[0].sdkEnded, true);
	assert.equal(proof.serverWitnesses.open[0].kind, 0);
});

test("installed SDK and shared Effect runtime preserve independently counted concurrent native identities", async () => {
	const require = createRequire(
		new URL("../../apps/webapp/package.json", import.meta.url),
	);
	const { NodeSDK } = require("@opentelemetry/sdk-node");
	const {
		InMemorySpanExporter,
		SimpleSpanProcessor,
	} = require("@opentelemetry/sdk-trace-base");
	const { trace } = require("@opentelemetry/api");
	const { Effect, ManagedRuntime, Layer } = require("effect");
	const coverage = new FixtureNativeCoverage();
	const exporter = new InMemorySpanExporter();
	const delegate = new SimpleSpanProcessor(exporter);
	const sdk = new NodeSDK({
		spanProcessors: [
			{
				onStart(span, context) {
					coverage.onStart(span);
					delegate.onStart(span, context);
				},
				onEnd(span) {
					coverage.onEnd(span);
					delegate.onEnd(span);
				},
				forceFlush: () => delegate.forceFlush(),
				shutdown: () => delegate.shutdown(),
			},
		],
	});
	sdk.start();
	const runtime = ManagedRuntime.make(Layer.empty);
	const ids = [];
	try {
		await Promise.all(
			[3, 5].map((count) =>
				trace
					.getTracer("fixture-parent")
					.startActiveSpan("fixture-visit", async (parent) => {
						const traceId = parent.spanContext().traceId;
						ids.push(traceId);
						coverage.register([traceId]);
						try {
							await runtime.runPromise(
								Effect.forEach(
									Array.from({ length: count }),
									() =>
										Effect.tryPromise(async () => {
											await new Promise((done) => setTimeout(done, 1));
											const child = trace
												.getTracer("@opentelemetry/instrumentation-pg")
												.startSpan("pg.query");
											assert.equal(child.spanContext().traceId, traceId);
											child.end();
										}),
									{ concurrency: 2 },
								),
							);
						} finally {
							parent.end();
						}
					}),
			),
		);
		await delegate.forceFlush();
		const proof = coverage.close(ids);
		assert.deepEqual(
			proof.map(({ queries, complete }) => ({ queries, complete })),
			[
				{ queries: 3, complete: true },
				{ queries: 5, complete: true },
			],
		);
		assert.equal(
			exporter
				.getFinishedSpans()
				.filter(
					(span) =>
						span.instrumentationScope.name ===
						"@opentelemetry/instrumentation-pg",
				).length,
			8,
		);
	} finally {
		await runtime.dispose();
		await sdk.shutdown();
	}
});

const span = (
	traceId,
	name = "pg.query",
	scope = "@opentelemetry/instrumentation-pg",
) => ({
	name,
	instrumentationScope: { name: scope },
	spanContext: () => ({ traceId }),
});
test("native lifecycle detects pending, dropped, and unowned work without storing SQL", () => {
	const coverage = new FixtureNativeCoverage();
	coverage.enableDriverCounter();
	const first = "a".repeat(32),
		second = "b".repeat(32);
	coverage.register([first, second]);
	coverage.onStart(span(first));
	coverage.onEnd(span(first));
	coverage.driverQuery(first);
	coverage.onStart(span(second));
	const proof = coverage.close([first, second]);
	assert.equal(proof[0].complete, true);
	assert.equal(proof[0].queries, 1);
	assert.equal(proof[0].driverQueries, 1);
	assert.equal(proof[0].driverComplete, true);
	assert.equal(
		proof[1].driverComplete,
		true,
		"No completed native query exists yet; pending state is independently incomplete",
	);
	assert.equal(proof[1].complete, false);
	assert.equal(proof[1].started.queries, 1);
	assert.equal(proof[1].ended.queries, 0);
	coverage.register([first]);
	coverage.onStart(span("c".repeat(32)));
	coverage.onEnd(span("c".repeat(32)));
	assert.equal(coverage.close([first])[0].complete, false);
	assert.equal(coverage.snapshot().activeTraces, 0);
});
test("concurrent native identities stay distinct and a million irrelevant spans consume no retained state", () => {
	const coverage = new FixtureNativeCoverage();
	const first = "a".repeat(32),
		second = "b".repeat(32);
	coverage.register([first, second]);
	for (let index = 0; index < 1000001; index++)
		coverage.onStart(span(first, "manual", "effect"));
	for (let index = 0; index < 3; index++) {
		coverage.onStart(span(first));
		coverage.onEnd(span(first));
	}
	for (let index = 0; index < 5; index++) {
		coverage.onStart(span(second));
		coverage.onEnd(span(second));
	}
	const proof = coverage.close([first, second]);
	assert.deepEqual(
		proof.map(({ queries, complete }) => ({ queries, complete })),
		[
			{ queries: 3, complete: true },
			{ queries: 5, complete: true },
		],
	);
	assert.equal(coverage.snapshot().activeTraces, 0);
	assert.equal(coverage.snapshot().ended.queries, 8);
});
