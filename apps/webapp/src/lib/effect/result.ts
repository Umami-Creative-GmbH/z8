import { Cause, type Effect, Exit, type Layer } from "effect";
import { env } from "@/env";
import { failureOfCause } from "./cause-failure";
import type { AnyAppError } from "./errors";
import { type AppLayer, runtime } from "./runtime";

export type ServerActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code?: string; holidayName?: string };

export function toServerActionResult<T>(exit: Exit.Exit<T, AnyAppError>): ServerActionResult<T> {
	return Exit.match(exit, {
		onFailure: (cause) => {
			// Without a typed failure or defect (interrupt-only), keep the cause so the
			// client gets the generic message instead of Cause.squash's internal one.
			const error = Cause.hasFails(cause) || Cause.hasDies(cause) ? failureOfCause(cause) : cause;
			const taggedError =
				error && typeof error === "object" && "_tag" in error ? (error as AnyAppError) : null;
			const isBuildPhase = env.NEXT_PHASE === "phase-production-build";
			const isCi = env.CI === "true";
			const suppressExpectedAuthErrorLog =
				taggedError?._tag === "AuthenticationError" && (isBuildPhase || isCi);

			if (!suppressExpectedAuthErrorLog) {
				console.error("[ServerAction Error]", error);
			}

			if (taggedError) {
				const appError = taggedError;
				const result: ServerActionResult<T> = {
					success: false,
					error: appError.message,
					code: appError._tag,
				};

				if (
					appError._tag === "ValidationError" &&
					"value" in appError &&
					typeof appError.value === "string"
				) {
					result.holidayName = appError.value;
				}

				return result;
			}

			// Log additional details for unknown errors
			if (error instanceof Error) {
				console.error("[ServerAction Error Stack]", error.stack);
				return {
					success: false,
					error: error.message || "An unexpected error occurred",
					code: "UNKNOWN_ERROR",
				};
			}

			return {
				success: false,
				error: "An unexpected error occurred",
				code: "UNKNOWN_ERROR",
			};
		},
		onSuccess: (data) => ({ success: true, data }),
	});
}

/** The services the shared runtime provides: every `AppLayer` member. */
export type AppServices = Layer.Success<typeof AppLayer>;

export async function runServerActionSafe<T>(
	effect: Effect.Effect<T, AnyAppError, AppServices>,
): Promise<ServerActionResult<T>> {
	const exit = await runtime.runPromiseExit(effect);
	return toServerActionResult(exit);
}
