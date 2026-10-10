import "server-only";

import { runServerActionSafe } from "./result";
import { type DatabaseClient, DatabaseService } from "./services/database.service";

/**
 * A refusal the user can act on, carrying a stable code the client translates,
 * and optionally details the client shows with it (plain, serializable data).
 */
export type ActionRefusal<
	Code extends string,
	Details extends object = Record<never, never>,
> = Error & {
	readonly code: Code;
	readonly details?: Details;
};

/**
 * A server action's result; a failure always carries a stable code, `failed`
 * for anything unexpected, and a refusal's details next to it.
 */
export type RefusalActionResult<
	T,
	Code extends string,
	Details extends object = Record<never, never>,
> =
	| { success: true; data: T }
	| ({ success: false; error: string; code: Code | "failed" } & Partial<Details>);

type Outcome<T, Code extends string, Details extends object> =
	| { refusal: null; data: T }
	| { refusal: ActionRefusal<Code, Details>; data: null };

/**
 * Runs a Promise-style server action with the client of the runtime's
 * `DatabaseService` (spec #761: kiosks, kiosk PINs, kiosk-only employees and
 * assigned locations). A refusal of the given class thrown by the action (after
 * any transaction it ran in has rolled back) comes back with its stable code
 * and its details; any other failure is `failed`. Authorization is the
 * action's or the store's.
 */
export async function runRefusalAction<
	Code extends string,
	T,
	Details extends object = Record<never, never>,
>(
	name: string,
	refusal: abstract new (...args: never[]) => ActionRefusal<Code, Details>,
	action: (db: DatabaseClient) => Promise<T>,
): Promise<RefusalActionResult<T, Code, Details>> {
	const result = await runServerActionSafe(
		DatabaseService.use((dbService) =>
			dbService.query(name, () =>
				action(dbService.db).then(
					(data): Outcome<T, Code, Details> => ({ refusal: null, data }),
					(error: unknown): Outcome<T, Code, Details> => {
						if (error instanceof refusal) return { refusal: error, data: null };
						throw error;
					},
				),
			),
		),
	);
	if (!result.success) return { success: false, error: result.error, code: "failed" };
	const outcome = result.data;
	if (outcome.refusal) {
		return {
			...outcome.refusal.details,
			success: false,
			error: outcome.refusal.message,
			code: outcome.refusal.code,
		} as RefusalActionResult<T, Code, Details>;
	}
	return { success: true, data: outcome.data };
}
