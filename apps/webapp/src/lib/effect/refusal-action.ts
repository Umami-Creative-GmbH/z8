import "server-only";

import { runServerActionSafe } from "./result";
import { type DatabaseClient, DatabaseService } from "./services/database.service";

/** A refusal the user can act on, carrying a stable code the client translates. */
export type ActionRefusal<Code extends string> = Error & { readonly code: Code };

/** A server action's result; a failure always carries a stable code, `failed` for anything unexpected. */
export type RefusalActionResult<T, Code extends string> =
	| { success: true; data: T }
	| { success: false; error: string; code: Code | "failed" };

type Outcome<T, Code extends string> =
	| { refusal: null; data: T }
	| { refusal: ActionRefusal<Code>; data: null };

/**
 * Runs a Promise-style server action with the client of the runtime's
 * `DatabaseService` (spec #761: kiosks, kiosk PINs, kiosk-only employees and
 * assigned locations). A refusal of the given class thrown by the action (after
 * any transaction it ran in has rolled back) comes back with its stable code;
 * any other failure is `failed`. Authorization is the action's or the store's.
 */
export async function runRefusalAction<Code extends string, T>(
	name: string,
	refusal: abstract new (...args: never[]) => ActionRefusal<Code>,
	action: (db: DatabaseClient) => Promise<T>,
): Promise<RefusalActionResult<T, Code>> {
	const result = await runServerActionSafe(
		DatabaseService.use((dbService) =>
			dbService.query(name, () =>
				action(dbService.db).then(
					(data): Outcome<T, Code> => ({ refusal: null, data }),
					(error: unknown): Outcome<T, Code> => {
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
		return { success: false, error: outcome.refusal.message, code: outcome.refusal.code };
	}
	return { success: true, data: outcome.data };
}
