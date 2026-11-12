import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";

/**
 * An employee of the active organization whose vacation settings the actor may
 * see or change: anyone for an org admin, a report for a scoped manager.
 * Another organization's employee is not found.
 */
export function findManagedEmployee(
	actor: OrganizationActor,
	organizationId: string,
	employeeId: string,
	resource: string,
	action: string,
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const target = yield* dbService.query("vacation.findManagedEmployee", () =>
			dbService.db.query.employee.findFirst({
				where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
			}),
		);
		if (!target) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Employee not found",
					entityType: "employee",
					entityId: employeeId,
				}),
			);
		}
		yield* refuseUnlessManaged(actor, employeeId, resource, action);
		return target;
	});
}

/** Fails unless the actor is an org admin or manages the employee. */
export function refuseUnlessManaged(
	actor: OrganizationActor,
	employeeId: string,
	resource: string,
	action: string,
) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		if (scope.organizationWide || scope.employeeIds.has(employeeId)) return;
		return yield* Effect.fail(
			new AuthorizationError({
				message: "Insufficient permissions",
				userId: actor.userId,
				resource,
				action,
			}),
		);
	});
}
