import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { DatabaseError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";

/**
 * Shared steps of the travel expense settings actions (#1617). Who may
 * configure travel expenses is decided by `organizationAction` (org admin);
 * these helpers only run the travel expense stores and attribute the writes.
 */

/**
 * Runs travel expense store work on the database. A failure reaches the
 * administrator as `failure`, except the validation and not-found errors the
 * stores write for them, which keep their own message.
 */
export function expenseStore<T>(
	name: string,
	failure: string,
	run: (database: DatabaseClient) => Promise<T>,
): Effect.Effect<T, ValidationError | NotFoundError | DatabaseError, DatabaseService> {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		return yield* dbService
			.query(name, () => run(dbService.db))
			.pipe(
				Effect.mapError((error) =>
					error.cause instanceof ValidationError || error.cause instanceof NotFoundError
						? error.cause
						: new DatabaseError({ message: failure, operation: name, cause: error.cause }),
				),
			);
	});
}

/** The writer of an authorization, override or approval: the administrator's employee profile. */
export interface ExpenseAdministrator {
	organizationId: string;
	userId: string;
	employeeId: string;
}

/**
 * Some writes are attributed to the administrator's employee profile; an org
 * admin without one in the organization cannot make them.
 */
export function expenseAdministrator(
	actor: OrganizationActor,
	organizationId: string,
): Effect.Effect<ExpenseAdministrator, ValidationError> {
	return actor.employee
		? Effect.succeed({ organizationId, userId: actor.userId, employeeId: actor.employee.id })
		: Effect.fail(
				new ValidationError({ message: "An employee profile in this organization is required" }),
			);
}

export function revalidateExpenseSettings(...paths: string[]): Effect.Effect<void> {
	return Effect.sync(() => {
		for (const path of ["/settings/travel-expenses", ...paths]) revalidatePath(path);
	});
}

/** Fires an audit write without waiting for it; a failed write is only logged. */
export function auditLater(write: () => Promise<unknown>, failure: string): Effect.Effect<void> {
	return Effect.sync(() => {
		write().catch((error) => logger.error({ error }, failure));
	});
}
