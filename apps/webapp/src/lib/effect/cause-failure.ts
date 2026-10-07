import { Cause, Option, Result } from "effect";

/**
 * The typed failure of an Effect cause, else its defect, else `Cause.squash`:
 * the one value to return or rethrow when a `runPromiseExit` caller unwraps a
 * failed exit, for example so a transaction rolls back with the original error
 * (docs/refs/effect.md). A typed failure wins over a finalizer defect.
 */
export function failureOfCause(cause: Cause.Cause<unknown>): unknown {
	return (
		Option.getOrNull(Cause.findErrorOption(cause)) ??
		Result.getOrNull(Cause.findDefect(cause)) ??
		Cause.squash(cause)
	);
}

/**
 * Only the typed failure of an Effect cause, or `undefined` when it died or was
 * interrupted. For callers that must not expose a defect to the user.
 */
export function typedFailureOfCause<E>(cause: Cause.Cause<E>): E | undefined {
	return Option.getOrUndefined(Cause.findErrorOption(cause));
}
