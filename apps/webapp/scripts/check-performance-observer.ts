/** Existing PostgreSQL seam + real OTel SDK. No request fakes, private query assertions or ORM replacements. */
import { SpanKind, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
	FixturePerformanceSpanProcessor,
	observeFixturePgResponse,
} from "@/lib/performance-fixture-observer";

let failureStage = "start-sdk";
async function run() {
	const exporter = new InMemorySpanExporter();
	const remote = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
		? new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })
		: undefined;
	const processor = new FixturePerformanceSpanProcessor(
		new SimpleSpanProcessor(
			remote
				? {
						export(spans, callback) {
							exporter.export(spans, () => remote.export(spans, callback));
						},
						async shutdown() {
							await Promise.all([exporter.shutdown(), remote.shutdown()]);
						},
					}
				: exporter,
		),
	);
	const sdk = new NodeSDK({
		resource: resourceFromAttributes({ "z8.perf.observer.version": 1 }),
		spanProcessors: [processor],
		instrumentations: [
			getNodeAutoInstrumentations({
				"@opentelemetry/instrumentation-fs": { enabled: false },
				"@opentelemetry/instrumentation-pg": {
					enhancedDatabaseReporting: false,
					responseHook: observeFixturePgResponse,
					ignoreConnectSpans: false,
				},
			}),
		],
	});
	sdk.start();
	failureStage = "initial-cache-coverage";
	const first = trace
		.getTracer("fixture-observer-probe")
		.startSpan("before-cache-initialization", { kind: SpanKind.SERVER });
	first.end();
	const { initializeCacheHandlers, getCacheHandler, isBuiltInCacheHandler } =
		await import("next/dist/server/use-cache/handlers");
	initializeCacheHandlers(50 * 1024 * 1024);
	const originalHandler = getCacheHandler("default");
	if (!originalHandler)
		throw new Error("Installed default handler is unavailable");
	const { integrationAdminPool, verifySuiteDatabase, closeIntegrationPools } =
		await import("@/test/integration-database");
	try {
		await trace
			.getTracer("fixture-observer-probe")
			.startActiveSpan(
				"fixture-request",
				{ kind: SpanKind.SERVER },
				async (span) => {
					try {
						failureStage = "native-cache-contract";
						const handler = getCacheHandler("default");
						if (
							handler !== originalHandler ||
							!isBuiltInCacheHandler("default")
						)
							throw new Error("Native cache handler identity changed");
						const key = "fixture-private-cache-key";
						failureStage = "native-cache-initial-miss";
						if (await handler.get(key, []))
							throw new Error("Expected initial cache miss");
						failureStage = "native-cache-set";
						await handler.set(
							key,
							Promise.resolve({
								value: new ReadableStream({
									start(controller) {
										controller.enqueue(
											new TextEncoder().encode("fixture-only-bytes"),
										);
										controller.close();
									},
								}),
								tags: ["fixture-private-tag"],
								stale: 0,
								timestamp: performance.timeOrigin + performance.now(),
								expire: 60,
								revalidate: 60,
							}),
						);
						for (let index = 0; index < 2; index++) {
							failureStage = "native-cache-stream-replay";
							const hit = await handler.get(key, []);
							if (
								!hit ||
								(await new Response(hit.value).text()) !== "fixture-only-bytes"
							)
								throw new Error("Native cache stream reuse changed");
						}
						await new Promise((done) => setTimeout(done, 2));
						failureStage = "native-cache-tag-invalidation";
						await handler.updateTags(["fixture-private-tag"]);
						// The installed native handler rounds tag timestamps to milliseconds; let that instant pass before reading.
						await new Promise((done) => setTimeout(done, 2));
						if (await handler.get(key, []))
							throw new Error("Native tag invalidation changed");
						failureStage = "guarded-database";
						await verifySuiteDatabase();
						failureStage = "driver-query-observation";
						const pool = integrationAdminPool();
						await pool.query("select generate_series(1, 3) as fixture_value");
						const client = await pool.connect();
						try {
							await client.query("begin");
							await client.query(
								"select generate_series(1, 2) as fixture_value",
							);
							await client.query("commit");
						} finally {
							client.release();
						}
						// Controlled local probe verifies that scheduling lateness reaches the exported request span.
						Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
						await new Promise((done) => setTimeout(done, 25));
					} finally {
						span.end();
					}
				},
			);
		failureStage = "export-observations";
		await processor.forceFlush();
		const spans = exporter.getFinishedSpans();
		const queries = spans.filter(
			(span) =>
				span.instrumentationScope.name ===
					"@opentelemetry/instrumentation-pg" &&
				span.name.startsWith("pg.query"),
		);
		const acquisitions = spans.filter(
			(span) =>
				span.instrumentationScope.name ===
					"@opentelemetry/instrumentation-pg" &&
				span.name === "pg-pool.connect",
		);
		const returnedRows = queries.reduce(
			(sum, span) =>
				sum +
				Number(span.attributes["db.response.returned_rows"] ?? Number.NaN),
			0,
		);
		const request = spans.find((span) => span.name === "fixture-request");
		const cacheReads = spans.filter(
			(span) => span.name === "fixture.cache.get",
		);
		const firstWindow = spans.find(
			(span) => span.name === "before-cache-initialization",
		);
		const observed = {
			driverQueries: queries.length,
			returnedRows,
			poolAcquisitions: acquisitions.length,
			eventLoopProbes: Number(
				request?.attributes["z8.perf.event_loop.probes"] ?? 0,
			),
			eventLoopDelayMs: Number(
				request?.attributes["z8.perf.event_loop.max_delay_ms"] ?? Number.NaN,
			),
			cacheHits: cacheReads.filter(
				(span) => span.attributes["z8.perf.cache.hit"] === true,
			).length,
			cacheMisses: cacheReads.filter(
				(span) => span.attributes["z8.perf.cache.hit"] === false,
			).length,
			firstWindowCacheKnown: firstWindow?.attributes["z8.perf.cache.coverage"],
			laterWindowCacheKnown: request?.attributes["z8.perf.cache.coverage"],
		};
		console.log(JSON.stringify(observed));
		if (
			observed.driverQueries !== 5 ||
			observed.returnedRows !== 6 ||
			observed.poolAcquisitions < 3 ||
			observed.eventLoopProbes < 1 ||
			observed.eventLoopDelayMs < 20 ||
			observed.cacheHits !== 2 ||
			observed.cacheMisses !== 2 ||
			observed.firstWindowCacheKnown !== false ||
			observed.laterWindowCacheKnown !== true
		)
			throw new Error("Observer numeric coverage incomplete");
	} finally {
		await closeIntegrationPools();
		await sdk.shutdown();
	}
}

run().catch(() => {
	console.error(
		`Fixture observer verification failed at ${failureStage}; acceptance remains unfulfilled.`,
	);
	process.exitCode = 1;
});
