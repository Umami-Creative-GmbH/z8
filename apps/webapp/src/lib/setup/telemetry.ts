import type { Context } from "@opentelemetry/api";
import type {
	ReadableSpan,
	SpanProcessor,
} from "@opentelemetry/sdk-trace";

// Shared with Next's incoming-request logger. Setup URLs must not enter routine logs.
export const SETUP_REQUEST_PATH =
	/\/(?:[a-z]{2,3}\/)?setup(?:[/?]|$)|\/api\/setup(?:[/?]|$)/;

// Report share link pages (#806): the path's token opens the shared snapshot.
export const REPORT_SHARE_REQUEST_PATH = /(?:^|\/)(?:[a-z]{2,3}\/)?share\/[^/?#]+/;

// OpenTelemetry API 1.10 attribute values may be arrays and maps nested to any depth.
function containsSetupData(value: unknown): boolean {
	if (typeof value === "string") {
		return (
			SETUP_REQUEST_PATH.test(value) ||
			REPORT_SHARE_REQUEST_PATH.test(value) ||
			value.includes("{setup-bootstrap}")
		);
	}
	if (Array.isArray(value)) return value.some(containsSetupData);
	if (value !== null && typeof value === "object" && !ArrayBuffer.isView(value)) {
		return Object.values(value).some(containsSetupData);
	}
	return false;
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
