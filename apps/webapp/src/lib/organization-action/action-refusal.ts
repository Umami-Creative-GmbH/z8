import { Effect } from "effect";
import { ValidationError } from "@/lib/effect/errors";
import type { ActionRefusal } from "@/lib/effect/refusal-action";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";

type Outcome<T, Code extends string, Details extends object> =
	| { refusal: null; data: T }
	| { refusal: ActionRefusal<Code, Details>; data: null };

/**
 * Runs Promise-style domain code that throws a refusal class (the stores behind
 * `runRefusalAction`) inside an `organizationAction` handler, with the runtime's
 * database. A refusal of the class becomes a `ValidationError` whose `refusal`
 * is the refusal's code and whose `value` holds its details, so the client gets
 * `{ code: "ValidationError", refusal, details }`. Anything else thrown is a
 * `DatabaseError`, as with `dbService.query`.
 */
export function refusalStep<Code extends string, T, Details extends object>(
	name: string,
	refusal: abstract new (...args: never[]) => ActionRefusal<Code, Details>,
	step: (db: DatabaseClient) => Promise<T>,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query(name, () =>
			step(dbService.db).then(
				(data): Outcome<T, Code, Details> => ({ refusal: null, data }),
				(error: unknown): Outcome<T, Code, Details> => {
					if (error instanceof refusal) return { refusal: error, data: null };
					throw error;
				},
			),
		);
		if (outcome.refusal) {
			const refused = outcome.refusal;
			const details = refused.details && Object.keys(refused.details).length > 0
				? refused.details
				: undefined;
			return yield* Effect.fail(
				new ValidationError({
					message: refused.message,
					field: "input",
					refusal: refused.code,
					...(details ? { value: details } : {}),
				}),
			);
		}
		return outcome.data as T;
	});
}
