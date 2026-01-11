import { SpanStatusCode } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
	BatchSpanProcessor,
	ConsoleSpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

// Custom span processor that only logs exception spans to console
class ExceptionOnlySpanProcessor implements SpanProcessor {
	private exporter: ConsoleSpanExporter;

	constructor() {
		this.exporter = new ConsoleSpanExporter();
	}

	onStart(): void {
		// No-op
	}

	onEnd(span: ReadableSpan): void {
		// Only export spans with errors or exception events
		const hasError = span.status.code === SpanStatusCode.ERROR;
		const hasExceptionEvent = span.events.some((event) => event.name === "exception");

		if (hasError || hasExceptionEvent) {
			this.exporter.export([span], () => {});
		}
	}

	shutdown(): Promise<void> {
		return this.exporter.shutdown();
	}

	forceFlush(): Promise<void> {
		return this.exporter.forceFlush();
	}
}

export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const isDev = process.env.NODE_ENV === "development";
		const hasRemoteOtel = !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

		const resource = resourceFromAttributes({
			[ATTR_SERVICE_NAME]: "z8-webapp",
			environment: process.env.NODE_ENV || "development",
		});

		// Determine span processors based on environment and configuration
		const spanProcessors =
			isDev || !hasRemoteOtel
				? [new ExceptionOnlySpanProcessor()]
				: [
						new BatchSpanProcessor(
							new OTLPTraceExporter({
								url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
							}),
						),
					];

		const sdk = new NodeSDK({
			resource,
			spanProcessors,
			instrumentations: [
				getNodeAutoInstrumentations({
					"@opentelemetry/instrumentation-fs": { enabled: false },
				}),
			],
		});

		sdk.start();

		// Run startup health checks after OpenTelemetry is initialized
		const { runStartupChecks } = await import("@/lib/health");
		const healthy = await runStartupChecks();

		if (!healthy) {
			console.error(
				"[FATAL] Critical startup checks failed - database unavailable",
			);
			// In production, you may want to exit: process.exit(1)
			// For now, we log and continue to allow debugging
		}

		process.on("SIGTERM", () => {
			sdk.shutdown().finally(() => process.exit(0));
		});
	}
}
