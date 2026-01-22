import { trace } from "@opentelemetry/api";
import pino from "pino";
import { env } from "@/env";

const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
	level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
	transport: isDev
		? {
				target: "pino-pretty",
				options: {
					colorize: true,
					translateTime: "HH:MM:ss Z",
					ignore: "pid,hostname",
				},
			}
		: {
				target: "pino-opentelemetry-transport",
			},
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
