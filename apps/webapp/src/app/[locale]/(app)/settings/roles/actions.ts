"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { employee } from "@/db/schema";
import { getSettingsAccessTierForUser } from "@/lib/auth-helpers";
import { type AnyAppError, AuthorizationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	type CreateCustomRoleInput,
	CustomRoleService,
	type CustomRoleWithPermissions,
	type UpdateCustomRoleInput,
} from "@/lib/effect/services/custom-role.service";
import { DatabaseService } from "@/lib/effect/services/database.service";

// =============================================================================
// Helpers
// =============================================================================

function getRolesActorContext() {
	return Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const dbService = yield* DatabaseService;
		const organizationId = session.session.activeOrganizationId;

		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "An active organization is required to manage custom roles",
					userId: session.user.id,
					resource: "custom_role",
					action: "manage",
				}),
			);
		}

		const activeOrganizationId: string = organizationId;

		const settingsAccessTier = yield* Effect.promise(() =>
			getSettingsAccessTierForUser(session.user.id, activeOrganizationId),
		);

		if (settingsAccessTier !== "orgAdmin") {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Only org admins can manage custom roles",
					userId: session.user.id,
					resource: "custom_role",
					action: "manage",
				}),
			);
		}

		const actingEmployee = yield* dbService.query("getCurrentEmployeeForRoles", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.userId, session.user.id),
					eq(employee.organizationId, activeOrganizationId),
					eq(employee.isActive, true),
				),
			});
		});

		return { session, organizationId: activeOrganizationId, actingEmployee };
	});
}

// =============================================================================
// CRUD Actions
// =============================================================================

export async function listCustomRoles(): Promise<ServerActionResult<CustomRoleWithPermissions[]>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		return yield* customRoleService.listRoles(organizationId);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function getCustomRole(
	roleId: string,
): Promise<ServerActionResult<CustomRoleWithPermissions>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		return yield* customRoleService.getRole(roleId, organizationId);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function createCustomRole(
	input: CreateCustomRoleInput,
): Promise<ServerActionResult<{ id: string }>> {
	const effect = Effect.gen(function* () {
		const { session, organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		const id = yield* customRoleService.createRole(organizationId, input, session.user.id);

		return { id };
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function updateCustomRole(
	roleId: string,
	input: UpdateCustomRoleInput,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const { session, organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		yield* customRoleService.updateRole(roleId, organizationId, input, session.user.id);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function deleteCustomRole(roleId: string): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const { session, organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		yield* customRoleService.deleteRole(roleId, organizationId, session.user.id);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function setRolePermissions(
	roleId: string,
	permissions: Array<{ action: string; subject: string }>,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const { session, organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		yield* customRoleService.setPermissions(roleId, organizationId, permissions, session.user.id);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function assignRoleToEmployee(
	employeeId: string,
	roleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const { session, organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		yield* customRoleService.assignRole(employeeId, roleId, organizationId, session.user.id);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function unassignRoleFromEmployee(
	employeeId: string,
	roleId: string,
): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const { session, organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		yield* customRoleService.unassignRole(employeeId, roleId, organizationId, session.user.id);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}

export async function getEmployeeCustomRoles(
	employeeId: string,
): Promise<ServerActionResult<CustomRoleWithPermissions[]>> {
	const effect = Effect.gen(function* () {
		const { organizationId } = yield* getRolesActorContext();
		const customRoleService = yield* CustomRoleService;

		return yield* customRoleService.getEmployeeRoles(employeeId, organizationId);
	}).pipe(
		Effect.catch((error) => Effect.fail(error as AnyAppError)),
		Effect.provide(AppLayer),
	);

	return runServerActionSafe(effect);
}
