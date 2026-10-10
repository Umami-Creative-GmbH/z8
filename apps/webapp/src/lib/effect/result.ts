import { type Effect, Exit, type Layer } from "effect";
import { env } from "@/env";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { failureOfCause, isInterruptOnly } from "./cause-failure";
import type { AnyAppError } from "./errors";
import { type AppLayer, runtime } from "./runtime";

export type ServerActionResult<T> =
	| { success: true; data: T }
	| {
			success: false;
			error: string;
			code?: string;
			holidayName?: string;
			/** `YYYY-MM` of a "month closed" refusal (#762), with `code: "MonthClosedError"`. */
			closedMonth?: string;
	  };

export function toServerActionResult<T>(exit: Exit.Exit<T, AnyAppError>): ServerActionResult<T> {
	return Exit.match(exit, {
		onFailure: (cause) => {
			// Without a typed failure or defect (interrupt-only), keep the cause so the
			// client gets the generic message instead of Cause.squash's internal one.
			const failure = isInterruptOnly(cause) ? cause : failureOfCause(cause);
			// A closed month refuses as itself, also when the database refusal arrives
			// wrapped in a `DatabaseError` or a defect (#762).
			const error = monthClosedRefusalOf(failure) ?? failure;
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
				if (appError._tag === "MonthClosedError") {
					result.closedMonth = appError.month;
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
	const result = toServerActionResult(exit);
	if (!result.success && result.closedMonth) {
		const { monthClosedMessage } = await import(
			"@/lib/time-tracking/closed-months/refusal-message"
		);
		result.error = await monthClosedMessage(result.closedMonth);
	}
	return result;
}
