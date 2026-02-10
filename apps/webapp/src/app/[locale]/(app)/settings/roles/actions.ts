"use server";

import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	CustomRoleService,
	type CustomRoleWithPermissions,
	type CreateCustomRoleInput,
	type UpdateCustomRoleInput,
} from "@/lib/effect/services/custom-role.service";

// Re-export types for client components
export type { CustomRoleWithPermissions, CreateCustomRoleInput, UpdateCustomRoleInput };

// =============================================================================
// Helpers
// =============================================================================

function getAdminEmployee() {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const currentEmployee = yield* _(
			dbService.query("getCurrentEmployeeForRoles", async () => {
				return await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});
			}),
			Effect.flatMap((emp) =>
				emp
					? Effect.succeed(emp)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
							}),
						),
			),
		);

		if (currentEmployee.role !== "admin") {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Only admins can manage custom roles",
						userId: currentEmployee.id,
						resource: "custom_role",
						action: "manage",
					}),
				),
			);
		}

		return { session, currentEmployee };
	});
}

// =============================================================================
// CRUD Actions
// =============================================================================

export async function listCustomRoles(): Promise<
	ServerActionResult<CustomRoleWithPermissions[]>
> {
	const effect = Effect.gen(function* (_) {
		const { currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		return yield* _(customRoleService.listRoles(currentEmployee.organizationId));
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function getCustomRole(
	roleId: string,
): Promise<ServerActionResult<CustomRoleWithPermissions>> {
	const effect = Effect.gen(function* (_) {
		const { currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		return yield* _(
			customRoleService.getRole(roleId, currentEmployee.organizationId),
		);
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function createCustomRole(
	input: CreateCustomRoleInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* (_) {
		const { session, currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		const id = yield* _(
			customRoleService.createRole(
				currentEmployee.organizationId,
				input,
				session.user.id,
			),
		);

		return { id };
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function updateCustomRole(
	roleId: string,
	input: UpdateCustomRoleInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const { session, currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		yield* _(
			customRoleService.updateRole(
				roleId,
				currentEmployee.organizationId,
				input,
				session.user.id,
			),
		);
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function deleteCustomRole(
	roleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const { session, currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		yield* _(
			customRoleService.deleteRole(
				roleId,
				currentEmployee.organizationId,
				session.user.id,
			),
		);
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function setRolePermissions(
	roleId: string,
	permissions: Array<{ action: string; subject: string }>,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const { session, currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		yield* _(
			customRoleService.setPermissions(
				roleId,
				currentEmployee.organizationId,
				permissions,
				session.user.id,
			),
		);
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function assignRoleToEmployee(
	employeeId: string,
	roleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const { session, currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		yield* _(
			customRoleService.assignRole(
				employeeId,
				roleId,
				currentEmployee.organizationId,
				session.user.id,
			),
		);
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function unassignRoleFromEmployee(
	employeeId: string,
	roleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* (_) {
		const { session, currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		yield* _(
			customRoleService.unassignRole(
				employeeId,
				roleId,
				currentEmployee.organizationId,
				session.user.id,
			),
		);
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function getEmployeeCustomRoles(
	employeeId: string,
): Promise<ServerActionResult<CustomRoleWithPermissions[]>> {
	const effect = Effect.gen(function* (_) {
		const { currentEmployee } = yield* _(getAdminEmployee());
		const customRoleService = yield* _(CustomRoleService);

		return yield* _(customRoleService.getEmployeeRoles(employeeId, currentEmployee.organizationId));
	}).pipe(
		Effect.catchAll((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}
