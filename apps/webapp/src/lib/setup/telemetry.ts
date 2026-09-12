import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

// Shared with Next's incoming-request logger. Setup URLs must not enter routine logs.
export const SETUP_REQUEST_PATH =
	/\/(?:[a-z]{2,3}\/)?setup(?:[/?]|$)|\/api\/setup(?:[/?]|$)/;

function containsSetupData(value: unknown): boolean {
	return (
		typeof value === "string" &&
		(SETUP_REQUEST_PATH.test(value) || value.includes("{setup-bootstrap}"))
	);
}

// Redis EVAL instrumentation includes command arguments, and HTTP spans include URLs.
// Drop these spans before either the console exporter or remote telemetry receives them.
export class SetupPrivacySpanProcessor implements SpanProcessor {
	constructor(private readonly delegate: SpanProcessor) {}
	onStart(
		span: Parameters<SpanProcessor["onStart"]>[0],
		parentContext: Context,
	): void {
		this.delegate.onStart(span, parentContext);
	}
	onEnd(span: ReadableSpan): void {
		if (
			containsSetupData(span.name) ||
			Object.values(span.attributes).some(containsSetupData)
		)
			return;
		this.delegate.onEnd(span);
	}
	shutdown(): Promise<void> {
		return this.delegate.shutdown();
	}
	forceFlush(): Promise<void> {
		return this.delegate.forceFlush();
	}
}
