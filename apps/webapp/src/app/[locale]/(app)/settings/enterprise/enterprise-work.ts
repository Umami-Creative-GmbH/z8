import { Effect } from "effect";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";

/**
 * A refusal an org admin can act on, thrown inside enterprise work: its
 * message is shown as is, as a validation refusal or as "not found".
 */
class EnterpriseSettingsRefusal extends Error {
	constructor(
		message: string,
		readonly notFound?: { entityType: string; entityId: string },
	) {
		super(message);
	}
}

export function refuse(message: string): never {
	throw new EnterpriseSettingsRefusal(message);
}

export function notFound(message: string, entityType: string, entityId: string): never {
	throw new EnterpriseSettingsRefusal(message, { entityType, entityId });
}

/**
 * Runs enterprise work written against Promises (the domain, vault, SCIM,
 * social OAuth and Better Auth helpers) inside an organization action. A
 * `refuse`/`notFound` becomes a `ValidationError`/`NotFoundError`; any other
 * failure keeps its message unless it wraps a cause (a database error), then
 * `fallback` is shown.
 */
export function enterpriseWork<T>(fallback: string, run: () => Promise<T>) {
	return Effect.tryPromise({ try: run, catch: (error) => error }).pipe(
		Effect.catch((error) => {
			if (error instanceof EnterpriseSettingsRefusal) {
				return Effect.fail(
					error.notFound
						? new NotFoundError({ message: error.message, ...error.notFound })
						: new ValidationError({ message: error.message, field: "input" }),
				);
			}
			return Effect.die(
				new Error(error instanceof Error && !error.cause ? error.message.slice(0, 500) : fallback),
			);
		}),
	);
}

/** `enterpriseWork` with the action's database. */
export const withDatabase = <T>(
	fallback: string,
	run: (database: DatabaseClient) => Promise<T>,
): Effect.Effect<T, ValidationError | NotFoundError, DatabaseService> =>
	Effect.flatMap(DatabaseService, (dbService) => enterpriseWork(fallback, () => run(dbService.db)));
