import { Effect } from "effect";
import { type DatabaseError, ValidationError } from "./errors";
import type { ActionRefusal } from "./refusal-action";
import { type DatabaseClient, DatabaseService } from "./services/database.service";

type Outcome<T, Code extends string> =
	| { refusal: null; data: T }
	| { refusal: ActionRefusal<Code>; data: null };

/**
 * Runs Promise-style store work inside an `organizationAction` handler with the
 * runtime's database client. A refusal of `refusal`'s class thrown by the store
 * (after any transaction it ran in has rolled back) fails as a `ValidationError`
 * whose `refusal` is its stable code, which the client translates; anything
 * else is a `DatabaseError`.
 */
export function queryOrRefuse<Code extends string, T>(
	name: string,
	refusal: abstract new (...args: never[]) => ActionRefusal<Code>,
	run: (db: DatabaseClient) => Promise<T>,
): Effect.Effect<T, ValidationError | DatabaseError, DatabaseService> {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query(name, () =>
			// Async, so a refusal thrown before `run`'s first await is caught too.
			(async () => run(dbService.db))().then(
				(data): Outcome<T, Code> => ({ refusal: null, data }),
				(error: unknown): Outcome<T, Code> => {
					if (error instanceof refusal) return { refusal: error, data: null };
					throw error;
				},
			),
		);
		if (outcome.refusal) {
			return yield* Effect.fail(
				new ValidationError({ message: outcome.refusal.message, refusal: outcome.refusal.code }),
			);
		}
		return outcome.data;
	});
}
