import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type {
	ManagedScope,
	OrganizationActor,
} from "@/lib/organization-action/organization-action";

/**
 * The employees an organization action's actor reaches (#1613): null for an
 * organization-wide scope (org admins), else the employees they manage.
 */
export function managedEmployeeIdsOf(scope: ManagedScope): ReadonlySet<string> | null {
	return scope.organizationWide ? null : scope.employeeIds;
}

/** Whether the scope reaches the employee. */
export function scopeReachesEmployee(scope: ManagedScope, employeeId: string): boolean {
	return scope.organizationWide || scope.employeeIds.has(employeeId);
}

/**
 * Loads the employee by ID in the session's organization, with the user's
 * names; another organization's employee is not found. A scoped manager is
 * refused an employee outside `actor.managedScope()`.
 */
export function loadManagedEmployee(
	context: { actor: OrganizationActor; organizationId: string },
	employeeId: string,
	options: { queryName?: string; message?: string } = {},
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const target = yield* dbService.query(options.queryName ?? "loadManagedEmployee", () =>
			dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, employeeId),
					eq(employee.organizationId, context.organizationId),
				),
				with: { user: { columns: { firstName: true, lastName: true, name: true } } },
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
		const scope = yield* context.actor.managedScope();
		if (!scopeReachesEmployee(scope, target.id)) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: options.message ?? "You do not have access to this employee",
					userId: context.actor.userId,
					resource: "employee",
					action: "access",
				}),
			);
		}
		return target;
	});
}
