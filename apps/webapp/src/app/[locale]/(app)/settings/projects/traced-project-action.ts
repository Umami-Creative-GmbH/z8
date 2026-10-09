import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Effect } from "effect";
import { logger } from "@/lib/logger";

/** Runs a project settings action inside an OpenTelemetry span, logging failures. */
export function tracedProjectAction<A, E, R>(
	name: string,
	attributes: Record<string, string>,
	effect: Effect.Effect<A, E, R>,
) {
	return trace.getTracer("projects").startActiveSpan(name, { attributes }, (span) =>
		effect.pipe(
			Effect.tap(() => Effect.sync(() => span.setStatus({ code: SpanStatusCode.OK }))),
			Effect.catch((error) =>
				Effect.gen(function* () {
					span.recordException(error as Error);
					span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
					logger.error({ error, ...attributes }, `Failed to run ${name}`);
					return yield* Effect.fail(error);
				}),
			),
			Effect.ensuring(Effect.sync(() => span.end())),
		),
	);
}
