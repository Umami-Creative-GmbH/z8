import { trace } from "@opentelemetry/api";
import pino from "pino";
import { env } from "@/env";

const isDev = env.NODE_ENV === "development";
const hasRemoteOtel = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);

const transport = isDev
	? {
			// Let Pino resolve the package at runtime. Turbopack emits a module ID for require.resolve.
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss Z",
				ignore: "pid,hostname",
			},
		}
	: hasRemoteOtel
		? {
				// Resolve statically so standalone tracing follows this worker's dependencies.
				target: require.resolve("pino-opentelemetry-transport"),
			}
		: undefined;

export const logger = pino({
	level: env.LOG_LEVEL || (isDev ? "debug" : "info"),
	transport,
	// Pino serializes errors only under `err`; this codebase logs them as `{ error }`,
	// whose Error properties are not enumerable and would otherwise log as `{}`.
	serializers: { error: pino.stdSerializers.err },
	mixin() {
		const span = trace.getActiveSpan();
		if (!span) return {};

		const spanContext = span.spanContext();
		return {
			trace_id: spanContext.traceId,
			span_id: spanContext.spanId,
		};
	},
});

export function createLogger(component: string) {
	return logger.child({ component });
}
