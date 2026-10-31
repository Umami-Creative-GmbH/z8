/** Finite real-PG/Effect oracle on the repository's guarded disposable database seam. No SQL/results are persisted. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { context, trace } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
	FixtureNativeCoverage,
	installFixtureDriverCounter,
} from "@/lib/performance-fixture-native-coverage";

let stage = "start-sdk";
async function run() {
	const coverage = new FixtureNativeCoverage();
	const exporter = new InMemorySpanExporter();
	const delegate = new SimpleSpanProcessor({ exporter });
	const sdk = new NodeSDK({
		spanProcessors: [
			{
				onStart(span, parent) {
					coverage.onStart(span);
					delegate.onStart(span, parent);
				},
				onEnd(span) {
					coverage.onEnd(span);
					delegate.onEnd(span);
				},
				forceFlush: () => delegate.forceFlush(),
				shutdown: () => delegate.shutdown(),
			},
		],
		instrumentations: [
			getNodeAutoInstrumentations({
				"@opentelemetry/instrumentation-fs": { enabled: false },
			}),
		],
	});
	sdk.start();
	stage = "install-native-boundary";
	const pg = await import("pg");
	const connection =
		Reflect.get(pg, "Connection") ?? Reflect.get(pg, "default")?.Connection;
	if (typeof connection !== "function")
		throw new Error("Native wire boundary unavailable");
	installFixtureDriverCounter(
		connection,
		coverage,
		() => trace.getActiveSpan()?.spanContext().traceId,
	);
	const { integrationAdminPool, verifySuiteDatabase, closeIntegrationPools } =
		await import("@/test/integration-database");
	const runtime = ManagedRuntime.make(Layer.empty);
	try {
		stage = "guard-disposable-database";
		await verifySuiteDatabase();
		const pool = integrationAdminPool();
		const before = coverage.snapshot();
		const ids = [
			randomBytes(16).toString("hex"),
			randomBytes(16).toString("hex"),
		];
		coverage.register(ids);
		stage = "concurrent-native-queries";
		await Promise.all(
			[3, 5].map((count, index) =>
				context.with(
					trace.setSpanContext(context.active(), {
						traceId: ids[index],
						spanId: randomBytes(8).toString("hex"),
						traceFlags: 1,
						isRemote: true,
					}),
					() =>
						runtime.runPromise(
							Effect.forEach(
								Array.from({ length: count }, (_, item) => item),
								(item) =>
									Effect.tryPromise(async () => {
										const result = await pool.query(
											item % 2 === 0
												? {
														name: "fixture_native_wire",
														text: "select generate_series(1, 2) as fixture_value",
													}
												: "select generate_series(1, 2) as fixture_value",
										);
										assert.equal(result.rows.length, 2);
									}),
								{ concurrency: 2 },
							),
						),
				),
			),
		);
		await delegate.forceFlush();
		const proof = coverage.close(ids);
		const after = coverage.snapshot();
		stage = "assert-native-counts";
		console.log(
			JSON.stringify({
				driverDelta: after.driverQueries - before.driverQueries,
				nativeDelta: after.ended.queries - before.ended.queries,
				perVisit: proof.map(
					({
						queries,
						driverQueries,
						driverComplete,
						complete,
						unattributedNativeSpans,
					}) => ({
						queries,
						driverQueries,
						driverComplete,
						complete,
						unattributedNativeSpans,
					}),
				),
			}),
		);
		assert.deepEqual(
			proof.map(({ queries, driverQueries, driverComplete, complete }) => ({
				queries,
				driverQueries,
				driverComplete,
				complete,
			})),
			[
				{ queries: 3, driverQueries: 3, driverComplete: true, complete: true },
				{ queries: 5, driverQueries: 5, driverComplete: true, complete: true },
			],
		);
		assert.equal(after.driverQueries - before.driverQueries, 8);
		assert.equal(after.ended.queries - before.ended.queries, 8);
		console.log(
			JSON.stringify({
				driverCalls: 8,
				nativeEndedQueries: 8,
				perVisitDriverCalls: proof.map((entry) => entry.driverQueries),
				perVisitNativeQueries: proof.map((entry) => entry.queries),
				unattributedNativeSpans: proof.reduce(
					(sum, entry) => sum + entry.unattributedNativeSpans,
					0,
				),
				complete: proof.every(
					(entry) => entry.complete && entry.driverComplete,
				),
			}),
		);
	} finally {
		await runtime.dispose();
		await closeIntegrationPools();
		await sdk.shutdown();
	}
}
run().catch(() => {
	console.error(
		`Finite native driver coverage verification failed at ${stage}; no SQL, parameters, or credentials were emitted.`,
	);
	process.exitCode = 1;
});
