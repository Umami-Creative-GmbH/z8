// @vitest-environment node
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";
import {
	context,
	createContextKey,
	propagation,
	trace,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	BatchSpanProcessor,
	type ReadableSpan,
	type SpanExporter,
} from "@opentelemetry/sdk-trace";
import { describe, expect, it, vi } from "vitest";
import { isolateFixtureExporter } from "./performance-fixture-export-scope";

describe("fixture export context", () => {
	it("exports the real inherited SDK timer batch over HTTP without render clock IO and preserves OTel suppression and parent context", async () => {
		const render = new AsyncLocalStorage<boolean>();
		const parentKey = createContextKey("fixture-export-parent");
		const suppressionKey = createContextKey(
			"OpenTelemetry SDK Context Key SUPPRESS_TRACING",
		);
		const ended: ReadableSpan[] = [];
		const sdk = new NodeSDK({
			autoDetectResources: false,
			instrumentations: [],
			metricReaders: [],
			logRecordProcessors: [],
			spanProcessors: [
				{
					onStart() {},
					onEnd(span) {
						ended.push(span);
					},
					async forceFlush() {},
					async shutdown() {},
				},
			],
		});
		sdk.start();
		const span = trace
			.getTracer("fixture-export-test")
			.startSpan("actual-ended-span");
		span.end();
		const actualSpan = ended[0];
		if (!actualSpan) throw Error("Actual SDK span missing");
		let received = 0;
		let receivedResolve: () => void = () => {};
		const receivedRequest = new Promise<void>((resolve) => {
			receivedResolve = resolve;
		});
		const server = createServer((request, response) => {
			received++;
			request.resume();
			request.once("end", () => {
				response.writeHead(200).end();
				receivedResolve();
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw Error("Owned HTTP server missing");
		const exporter = new OTLPTraceExporter({
			url: `http://127.0.0.1:${address.port}/v1/traces`,
		});
		const original = exporter.export;
		let attemptResolve: () => void = () => {};
		const attempted = new Promise<void>((resolve) => {
			attemptResolve = resolve;
		});
		const observations: {
			render: boolean | undefined;
			parent: unknown;
			suppressed: unknown;
			baggage: string | undefined;
			batch: ReadableSpan[];
		}[] = [];
		exporter.export = function (batch, callback) {
			observations.push({
				render: render.getStore(),
				parent: context.active().getValue(parentKey),
				suppressed: context.active().getValue(suppressionKey),
				baggage: propagation.getBaggage(context.active())?.getEntry("fixture")
					?.value,
				batch,
			});
			attemptResolve();
			return original.call(this, batch, callback);
		};
		const batch = new BatchSpanProcessor({
			exporter: isolateFixtureExporter(exporter),
			scheduledDelayMillis: 5,
			maxExportBatchSize: 128,
		});
		const now = Date.now.bind(Date);
		const clock = vi.spyOn(Date, "now").mockImplementation(() => {
			if (render.getStore()) throw Error("Uncached prerender clock IO");
			return now();
		});
		try {
			const parent = propagation.setBaggage(
				trace.setSpanContext(
					context.active().setValue(parentKey, "preserved"),
					actualSpan.spanContext(),
				),
				propagation.createBaggage({ fixture: { value: "preserved" } }),
			);
			context.with(parent, () =>
				render.run(true, () => batch.onEnd(actualSpan)),
			);
			await attempted;
			expect(observations).toHaveLength(1);
			expect(observations[0]?.render).toBeUndefined();
			expect(observations[0]?.parent).toBe("preserved");
			expect(observations[0]?.baggage).toBe("preserved");
			expect(observations[0]?.suppressed).toBe(true);
			expect(observations[0]?.batch[0]).toBe(actualSpan);
			await receivedRequest;
			await batch.forceFlush();
			expect(received).toBe(1);
		} finally {
			clock.mockRestore();
			await batch.shutdown();
			await sdk.shutdown();
			context.disable();
			trace.disable();
			propagation.disable();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}, 5000);

	it("preserves exact batch, callback, receiver, return, errors and flush/shutdown methods", async () => {
		const batch: ReadableSpan[] = [],
			callback: Parameters<SpanExporter["export"]>[1] = () => {};
		const marker = Symbol("return"),
			failure = Error("unchanged"),
			flushed = Promise.resolve(),
			stopped = Promise.resolve();
		let throws = false,
			calls = 0;
		const exporter = {
			export(values: ReadableSpan[], complete: typeof callback) {
				expect(this).toBe(exporter);
				expect(values).toBe(batch);
				expect(complete).toBe(callback);
				calls++;
				if (throws) throw failure;
				return marker;
			},
			forceFlush: () => flushed,
			shutdown: () => stopped,
		};
		const originalFlush = exporter.forceFlush,
			originalShutdown = exporter.shutdown;
		expect(isolateFixtureExporter(exporter)).toBe(exporter);
		expect(exporter.export(batch, callback)).toBe(marker);
		throws = true;
		expect(() => exporter.export(batch, callback)).toThrow(failure);
		expect(calls).toBe(2);
		expect(exporter.forceFlush).toBe(originalFlush);
		expect(exporter.shutdown).toBe(originalShutdown);
		expect(exporter.forceFlush()).toBe(flushed);
		expect(exporter.shutdown()).toBe(stopped);
	});
});
