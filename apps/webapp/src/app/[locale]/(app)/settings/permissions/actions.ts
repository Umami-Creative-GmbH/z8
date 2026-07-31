"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import * as z from "zod";
import { employee, team, teamPermissions } from "@/db/schema";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type EmployeePermissions,
	PermissionsService,
} from "@/lib/effect/services/permissions.service";
import { createLogger } from "@/lib/logger";
import type { SelectableEmployee } from "../employees/employee-action-types";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
	requireSettingsActorEmployeeRecord,
} from "../employees/employee-action-utils";

const logger = createLogger("PermissionsActions");

export interface PermissionsPageData {
	organizationId: string;
	employees: SelectableEmployee[];
	teams: Array<{ id: string; name: string; organizationId: string }>;
	permissions: Array<{
		employee: Pick<SelectableEmployee, "id">;
		permissions: EmployeePermissions[];
	}>;
}

// =============================================================================
// Validation Schemas
// =============================================================================

const permissionFlagsSchema = z.object({
	canCreateTeams: z.boolean().optional(),
	canManageTeamMembers: z.boolean().optional(),
	canManageTeamSettings: z.boolean().optional(),
	canApproveTeamRequests: z.boolean().optional(),
});

const grantPermissionsSchema = z.object({
	employeeId: z.uuid("Invalid employee ID"),
	permissions: permissionFlagsSchema,
	teamId: z.uuid("Invalid team ID").nullable().optional(),
});

type GrantPermissions = z.infer<typeof grantPermissionsSchema>;

// =============================================================================
// Permission Management Actions
// =============================================================================

/**
 * Grant team permissions to an employee
 * Requires admin role
 */
export async function grantTeamPermissions(
	data: GrantPermissions,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("permissions");

	const effect = tracer.startActiveSpan(
		"grantTeamPermissions",
		{
			attributes: {
				"employee.id": data.employeeId,
				"team.id": data.teamId || "organization-wide",
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const permissionsService = yield* _(PermissionsService);

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only org admins can grant permissions",
						resource: "team_permissions",
						action: "grant",
					}),
				);

				const actorEmployee = yield* _(
					requireSettingsActorEmployeeRecord(actor, {
						message: "Employee profile required to grant permissions",
						resource: "employee",
						action: "grant",
					}),
				);
				const grantedBy = actorEmployee.id;

				span.setAttribute("currentEmployee.id", grantedBy);

				// Validate data
				const validationResult = grantPermissionsSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message:
									validationResult.error.issues[0]?.message || "Invalid input",
								field:
									validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Grant permissions using PermissionsService
				yield* _(
					permissionsService.grantPermissions(
						validatedData.employeeId,
						actor.organizationId,
						validatedData.permissions,
						validatedData.teamId || null,
						grantedBy,
					),
				);

				logger.info(
					{
						employeeId: validatedData.employeeId,
						teamId: validatedData.teamId,
						permissions: validatedData.permissions,
					},
					"Permissions granted successfully",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error({ error, data }, "Failed to grant permissions");
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Revoke team permissions from an employee
 * Requires admin role
 */
export async function revokeTeamPermissions(
	employeeId: string,
	teamId?: string | null,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("permissions");

	const effect = tracer.startActiveSpan(
		"revokeTeamPermissions",
		{
			attributes: {
				"employee.id": employeeId,
				"team.id": teamId || "organization-wide",
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const actor = yield* _(getEmployeeSettingsActorContext());
				const permissionsService = yield* _(PermissionsService);

				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actor, {
						message: "Only org admins can revoke permissions",
						resource: "team_permissions",
						action: "revoke",
					}),
				);

				const actorEmployee = yield* _(
					requireSettingsActorEmployeeRecord(actor, {
						message: "Employee profile required to revoke permissions",
						resource: "employee",
						action: "revoke",
					}),
				);
				span.setAttribute("currentEmployee.id", actorEmployee.id);

				// Revoke permissions using PermissionsService
				yield* _(
					permissionsService.revokePermissions(
						employeeId,
						actor.organizationId,
						teamId || null,
					),
				);

				logger.info(
					{
						employeeId,
						teamId,
					},
					"Permissions revoked successfully",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error(
							{ error, employeeId, teamId },
							"Failed to revoke permissions",
						);
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}

/**
 * Get employee permissions
 * Admins can view any employee's permissions
 * Employees can view their own permissions
 */
export async function getEmployeePermissions(
	employeeId: string,
): Promise<ServerActionResult<EmployeePermissions[]>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const _dbService = yield* _(DatabaseService);
		const permissionsService = yield* _(PermissionsService);

		const isOrgAdmin = actor.accessTier === "orgAdmin";
		const isSelf = actor.currentEmployee?.id === employeeId;

		if (!isOrgAdmin && !isSelf) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Cannot view permissions for other employees",
						userId: actor.session.user.id,
						resource: "team_permissions",
						action: "read",
					}),
				),
			);
		}

		// Get permissions using PermissionsService
		const permissions = yield* _(
			permissionsService.getEmployeePermissions(
				employeeId,
				actor.organizationId,
			),
		);

		return permissions;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * Check if employee has a specific permission
 * Can be called by anyone to check their own or others' permissions
 */
export async function hasTeamPermission(
	employeeId: string,
	permission:
		| "canCreateTeams"
		| "canManageTeamMembers"
		| "canManageTeamSettings"
		| "canApproveTeamRequests",
	teamId?: string | null,
): Promise<ServerActionResult<boolean>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const permissionsService = yield* _(PermissionsService);

		// Get current employee (just to verify authentication)
		const _currentEmployee = yield* _(
			dbService.query("getCurrentEmployee", async () => {
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

		// Check permission using PermissionsService
		const hasPermission = yield* _(
			permissionsService.hasTeamPermission(
				employeeId,
				permission,
				teamId || null,
			),
		);

		return hasPermission;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

/**
 * List all employees with their permissions in an organization
 * Requires admin role
 */
export async function listEmployeePermissions(): Promise<
	ServerActionResult<
		Array<{
			employee: typeof employee.$inferSelect;
			permissions: EmployeePermissions[];
		}>
	>
> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const dbService = yield* _(DatabaseService);
		const permissionsService = yield* _(PermissionsService);

		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can list all permissions",
				resource: "team_permissions",
				action: "list",
			}),
		);

		// Get all employees in organization
		const employees = yield* _(
			dbService.query("listEmployees", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, actor.organizationId),
					with: {
						user: true,
					},
					orderBy: (employee, { asc }) => [asc(employee.userId)],
				});
			}),
		);

		// Get permissions for each employee
		const employeePermissions = yield* _(
			Effect.all(
				employees.map((emp) =>
					Effect.gen(function* (_) {
						const permissions = yield* _(
							permissionsService.getEmployeePermissions(
								emp.id,
								actor.organizationId,
							),
						);
						return {
							employee: emp,
							permissions,
						};
					}),
				),
			),
		);

		return employeePermissions;
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function loadPermissionsPageData(
	expectedOrganizationId: string,
): Promise<ServerActionResult<PermissionsPageData>> {
	const effect = Effect.gen(function* (_) {
		const actor = yield* _(getEmployeeSettingsActorContext());
		const dbService = yield* _(DatabaseService);

		yield* _(
			requireOrgAdminEmployeeSettingsAccess(actor, {
				message: "Only org admins can list all permissions",
				resource: "team_permissions",
				action: "list",
			}),
		);

		if (actor.organizationId !== expectedOrganizationId) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Organization not found or access denied",
						userId: actor.session.user.id,
						resource: "team_permissions",
						action: "list",
					}),
				),
			);
		}

		const snapshot = yield* _(
			dbService.query("loadPermissionsPageData", async () => {
				return await dbService.db.transaction(
					async (tx) => {
						const [employeeRows, teamRows, permissionRows] = await Promise.all([
							tx.query.employee.findMany({
								where: eq(employee.organizationId, actor.organizationId),
								columns: {
									id: true,
									userId: true,
									pronouns: true,
									position: true,
									role: true,
									isActive: true,
									teamId: true,
								},
								with: {
									user: {
										columns: {
											id: true,
											firstName: true,
											lastName: true,
											name: true,
											email: true,
											image: true,
										},
									},
								},
								orderBy: (employee, { asc }) => [asc(employee.userId)],
							}),
							tx.query.team.findMany({
								where: eq(team.organizationId, actor.organizationId),
								columns: { id: true, name: true, organizationId: true },
								orderBy: (team, { asc }) => [asc(team.name)],
							}),
							tx.query.teamPermissions.findMany({
								where: eq(teamPermissions.organizationId, actor.organizationId),
								columns: {
									employeeId: true,
									organizationId: true,
									teamId: true,
									canCreateTeams: true,
									canManageTeamMembers: true,
									canManageTeamSettings: true,
									canApproveTeamRequests: true,
									grantedBy: true,
									grantedAt: true,
								},
							}),
						]);
						return { employeeRows, teamRows, permissionRows };
					},
					{ isolationLevel: "repeatable read" },
				);
			}),
		);

		const teamsById = new Map(
			snapshot.teamRows.map((teamRecord) => [teamRecord.id, teamRecord]),
		);
		const employees: SelectableEmployee[] = snapshot.employeeRows.map(
			(employeeRecord) => {
				const employeeTeam = employeeRecord.teamId
					? teamsById.get(employeeRecord.teamId)
					: undefined;
				return {
					id: employeeRecord.id,
					userId: employeeRecord.userId,
					firstName: employeeRecord.user.firstName,
					lastName: employeeRecord.user.lastName,
					pronouns: employeeRecord.pronouns,
					position: employeeRecord.position,
					role: employeeRecord.role,
					isActive: employeeRecord.isActive,
					teamId: employeeRecord.teamId,
					user: {
						id: employeeRecord.user.id,
						firstName: employeeRecord.user.firstName,
						lastName: employeeRecord.user.lastName,
						name: employeeRecord.user.name,
						email: employeeRecord.user.email,
						image: employeeRecord.user.image,
					},
					team: employeeTeam
						? { id: employeeTeam.id, name: employeeTeam.name }
						: null,
				};
			},
		);
		const permissionsByEmployee = Map.groupBy(
			snapshot.permissionRows,
			(permission) => permission.employeeId,
		);

		return {
			organizationId: actor.organizationId,
			employees,
			teams: snapshot.teamRows.map((teamRecord) => ({
				id: teamRecord.id,
				name: teamRecord.name,
				organizationId: teamRecord.organizationId,
			})),
			permissions: employees.map((employeeRecord) => ({
				employee: { id: employeeRecord.id },
				permissions: (permissionsByEmployee.get(employeeRecord.id) ?? []).map(
					(permission) => ({
						employeeId: permission.employeeId,
						organizationId: permission.organizationId,
						teamId: permission.teamId,
						canCreateTeams: permission.canCreateTeams,
						canManageTeamMembers: permission.canManageTeamMembers,
						canManageTeamSettings: permission.canManageTeamSettings,
						canApproveTeamRequests: permission.canApproveTeamRequests,
						grantedBy: permission.grantedBy,
						grantedAt: permission.grantedAt,
					}),
				),
			})),
		};
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
