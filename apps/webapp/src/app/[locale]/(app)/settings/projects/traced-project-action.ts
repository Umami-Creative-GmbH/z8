import { SpanStatusCode, trace } from "@opentelemetry/api";
import { Effect } from "effect";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { logger } from "@/lib/logger";

/** Refusals the caller is told about: expected outcomes, not failures to log. */
function isExpectedRefusal(error: unknown) {
	return (
		error instanceof ValidationError ||
		error instanceof AuthorizationError ||
		error instanceof NotFoundError ||
		error instanceof ConflictError
	);
}

/**
 * Runs a project settings action inside an OpenTelemetry span. Every failure
 * marks the span; only unexpected ones are logged as errors.
 */
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
					if (!isExpectedRefusal(error)) {
						logger.error({ error, ...attributes }, `Failed to run ${name}`);
					}
					return yield* Effect.fail(error);
				}),
			),
			Effect.ensuring(Effect.sync(() => span.end())),
		),
	);
}
