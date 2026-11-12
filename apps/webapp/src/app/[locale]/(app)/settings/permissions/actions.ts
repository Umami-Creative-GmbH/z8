"use server";

import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as z from "zod";
import { employee, team, teamPermissions } from "@/db/schema";
import { AuthorizationError, NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	type EmployeePermissions,
	PermissionsService,
} from "@/lib/effect/services/permissions.service";
import { createLogger } from "@/lib/logger";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import type { SelectableEmployee } from "../employees/employee-action-types";

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

const permissionFlagsSchema = z.strictObject({
	canCreateTeams: z.boolean().optional(),
	canManageTeamMembers: z.boolean().optional(),
	canManageTeamSettings: z.boolean().optional(),
	canApproveTeamRequests: z.boolean().optional(),
});

const grantPermissionsSchema = z.strictObject({
	employeeId: z.uuid("Invalid employee ID"),
	permissions: permissionFlagsSchema,
	teamId: z.uuid("Invalid team ID").nullable().optional(),
});

const revokePermissionsSchema = z.strictObject({
	employeeId: z.string().min(1, "Employee ID is required"),
	teamId: z.string().min(1).nullable().optional(),
});

const hasTeamPermissionSchema = z.strictObject({
	employeeId: z.string().min(1, "Employee ID is required"),
	permission: z.enum([
		"canCreateTeams",
		"canManageTeamMembers",
		"canManageTeamSettings",
		"canApproveTeamRequests",
	]),
	teamId: z.string().min(1).nullable().optional(),
});

/** The granter recorded on a permission change: the actor's employee record. */
function granterEmployee(actor: OrganizationActor, action: "grant" | "revoke") {
	return actor.employee
		? Effect.succeed(actor.employee)
		: Effect.fail(
				new NotFoundError({
					message: `Employee profile required to ${action} permissions`,
					entityType: "employee",
					entityId: actor.userId,
				}),
			);
}

// =============================================================================
// Permission Management Actions
// =============================================================================

/** Grant team permissions to an employee; org admins with an employee record. */
export const grantTeamPermissions = organizationAction(
	{
		name: "permissions.grant",
		requires: "orgAdmin",
		schema: grantPermissionsSchema,
		// Clearing a former employee's flags stays possible (#1438).
		addsEmployees: (input) =>
			Object.values(input.permissions).some((flag) => flag === true) ? [input.employeeId] : [],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const permissionsService = yield* PermissionsService;
			const granter = yield* granterEmployee(actor, "grant");

			yield* permissionsService.grantPermissions(
				input.employeeId,
				organizationId,
				input.permissions,
				input.teamId || null,
				granter.id,
			);

			logger.info(
				{ employeeId: input.employeeId, teamId: input.teamId, permissions: input.permissions },
				"Permissions granted successfully",
			);
		}),
);

/** Revoke team permissions from an employee; org admins with an employee record. */
export const revokeTeamPermissions = organizationAction(
	{
		name: "permissions.revoke",
		requires: "orgAdmin",
		schema: revokePermissionsSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const permissionsService = yield* PermissionsService;
			yield* granterEmployee(actor, "revoke");

			yield* permissionsService.revokePermissions(
				input.employeeId,
				organizationId,
				input.teamId || null,
			);

			logger.info(
				{ employeeId: input.employeeId, teamId: input.teamId },
				"Permissions revoked successfully",
			);
		}),
);

/**
 * An employee's team permissions: org admins see anyone's, scoped managers
 * only their own.
 */
export const getEmployeePermissions = organizationAction(
	{
		name: "permissions.getForEmployee",
		requires: "scopedManager",
		schema: z.string().min(1, "Employee ID is required"),
	},
	({ actor, organizationId, input: employeeId }) =>
		Effect.gen(function* () {
			const isOrgAdmin = meetsSettingsAccess(actor.settingsAccess, "orgAdmin");
			if (!isOrgAdmin && actor.employee?.id !== employeeId) {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Cannot view permissions for other employees",
						userId: actor.userId,
						resource: "team_permissions",
						action: "read",
					}),
				);
			}

			const permissionsService = yield* PermissionsService;
			return yield* permissionsService.getEmployeePermissions(employeeId, organizationId);
		}),
);

/** Whether an employee of the session's organization has a team permission. */
export const hasTeamPermission = organizationAction(
	{
		name: "permissions.has",
		requires: "member",
		schema: hasTeamPermissionSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const target = yield* dbService.query("permissions.getEmployee", async () => {
				return await dbService.db.query.employee.findFirst({
					where: and(
						eq(employee.id, input.employeeId),
						eq(employee.organizationId, organizationId),
					),
					columns: { id: true },
				});
			});
			if (!target) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Employee not found",
						entityType: "employee",
						entityId: input.employeeId,
					}),
				);
			}

			const permissionsService = yield* PermissionsService;
			return yield* permissionsService.hasTeamPermission(
				input.employeeId,
				input.permission,
				input.teamId || null,
			);
		}),
);

/** Every employee of the organization with their permissions; org admins only. */
export const listEmployeePermissions = organizationAction(
	{
		name: "permissions.list",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const permissionsService = yield* PermissionsService;

			const employees = yield* dbService.query("listEmployees", async () => {
				return await dbService.db.query.employee.findMany({
					where: eq(employee.organizationId, organizationId),
					with: {
						user: true,
					},
					orderBy: (employee, { asc }) => [asc(employee.userId)],
				});
			});

			return yield* Effect.all(
				employees.map((emp) =>
					Effect.gen(function* () {
						const permissions = yield* permissionsService.getEmployeePermissions(
							emp.id,
							organizationId,
						);
						return {
							employee: emp as typeof employee.$inferSelect,
							permissions,
						};
					}),
				),
			);
		}),
);

/** The permissions page: employees, teams and permission rows in one snapshot; org admins only. */
export const loadPermissionsPageData = organizationAction(
	{
		name: "permissions.loadPageData",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;

			const snapshot = yield* dbService.query("loadPermissionsPageData", async () => {
				return await dbService.db.transaction(
					async (tx) => {
						const [employeeRows, teamRows, permissionRows] = await Promise.all([
							tx.query.employee.findMany({
								where: eq(employee.organizationId, organizationId),
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
								where: eq(team.organizationId, organizationId),
								columns: { id: true, name: true, organizationId: true },
								orderBy: (team, { asc }) => [asc(team.name)],
							}),
							tx.query.teamPermissions.findMany({
								where: eq(teamPermissions.organizationId, organizationId),
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
			});

			const teamsById = new Map(snapshot.teamRows.map((teamRecord) => [teamRecord.id, teamRecord]));
			const employees: SelectableEmployee[] = snapshot.employeeRows.map((employeeRecord) => {
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
					team: employeeTeam ? { id: employeeTeam.id, name: employeeTeam.name } : null,
				};
			});
			const permissionsByEmployee = Map.groupBy(
				snapshot.permissionRows,
				(permission) => permission.employeeId,
			);

			return {
				organizationId,
				employees,
				teams: snapshot.teamRows.map((teamRecord) => ({
					id: teamRecord.id,
					name: teamRecord.name,
					organizationId: teamRecord.organizationId,
				})),
				permissions: employees.map((employeeRecord) => ({
					employee: { id: employeeRecord.id },
					permissions: (permissionsByEmployee.get(employeeRecord.id) ?? []).map((permission) => ({
						employeeId: permission.employeeId,
						organizationId: permission.organizationId,
						teamId: permission.teamId,
						canCreateTeams: permission.canCreateTeams,
						canManageTeamMembers: permission.canManageTeamMembers,
						canManageTeamSettings: permission.canManageTeamSettings,
						canApproveTeamRequests: permission.canApproveTeamRequests,
						grantedBy: permission.grantedBy,
						grantedAt: permission.grantedAt,
					})),
				})),
			} satisfies PermissionsPageData;
		}),
);
