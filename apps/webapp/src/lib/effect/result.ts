import { Effect, Exit } from "effect";
import type { AnyAppError } from "./errors";

export type ServerActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code?: string };

export function toServerActionResult<T>(exit: Exit.Exit<T, AnyAppError>): ServerActionResult<T> {
	return Exit.match(exit, {
		onFailure: (cause) => {
			const error = cause.defect ?? cause.failure;

			if (error && typeof error === "object" && "_tag" in error) {
				const appError = error as AnyAppError;
				return {
					success: false,
					error: appError.message,
					code: appError._tag,
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
	const exit = await Effect.runPromiseExit(effect);
	return toServerActionResult(exit);
}
