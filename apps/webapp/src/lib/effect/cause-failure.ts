import { Cause, Option, Result } from "effect";

/**
 * The typed failure of an Effect cause, else its defect, else a generic error:
 * what an owner that runs `Effect.runPromiseExit` rethrows so its transaction
 * rolls back with the original error (docs/refs/effect.md).
 */
export function failureOfCause(cause: Cause.Cause<unknown>): unknown {
	return (
		Option.getOrNull(Cause.findErrorOption(cause)) ??
		Result.getOrNull(Cause.findDefect(cause)) ??
		new Error("An error has occurred")
	);
}
