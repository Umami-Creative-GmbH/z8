import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { ValidationError } from "@/lib/effect/errors";
import { logger } from "@/lib/logger";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";

/**
 * Shared steps of the travel expense settings actions (#1617). Who may
 * configure travel expenses is decided by `organizationAction` (org admin);
 * these helpers only attribute the writes. Store work runs through `storeStep`.
 */

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
