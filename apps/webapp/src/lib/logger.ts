import { trace } from "@opentelemetry/api";
import pino from "pino";

const isDev = process.env.NODE_ENV === "development";
const hasRemoteOtel = Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);

const transport = isDev
	? {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss Z",
				ignore: "pid,hostname",
			},
		}
	: hasRemoteOtel
		? {
				target: "pino-opentelemetry-transport",
			}
		: undefined;

export const logger = pino({
	level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
	transport,
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
