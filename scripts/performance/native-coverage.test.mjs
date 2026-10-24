import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { FixtureNativeCoverage } from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";

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
