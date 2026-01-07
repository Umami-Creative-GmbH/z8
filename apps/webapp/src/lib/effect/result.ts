import { Effect, Exit, Cause, Option } from "effect";
import type { AnyAppError } from "./errors";
import { runtime } from "./runtime";

export type ServerActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code?: string; holidayName?: string };

export function toServerActionResult<T>(exit: Exit.Exit<T, AnyAppError>): ServerActionResult<T> {
	return Exit.match(exit, {
		onFailure: (cause) => {
			// Extract defect or failure from cause
			const defects = Cause.defects(cause);
			const defect = [...defects][0] ?? null;
			// Effect 3.x: failure might be wrapped in cause
			const failure = Option.getOrNull(Cause.failureOption(cause));

			const error = defect ?? failure ?? cause;

			// Log error for debugging
			console.error("[ServerAction Error]", error);

			if (error && typeof error === "object" && "_tag" in error) {
				const appError = error as AnyAppError;
				const result: ServerActionResult<T> = {
					success: false,
					error: appError.message,
					code: appError._tag,
				};

				if (appError._tag === "ValidationError" && "value" in appError && typeof appError.value === "string") {
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

export async function runServerActionSafe<T>(
	effect: Effect.Effect<T, AnyAppError>,
): Promise<ServerActionResult<T>> {
	// Use the runtime which provides all required layers
	const exit = await runtime.runPromiseExit(effect);
	return toServerActionResult(exit);
}
