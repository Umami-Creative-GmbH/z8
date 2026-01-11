import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { employee, teamPermissions } from "@/db/schema";
import { AuthorizationError, type DatabaseError, NotFoundError } from "../errors";
import { DatabaseService } from "./database.service";

export interface PermissionFlags {
	canCreateTeams?: boolean;
	canManageTeamMembers?: boolean;
	canManageTeamSettings?: boolean;
	canApproveTeamRequests?: boolean;
}

export interface EmployeePermissions {
	employeeId: string;
	organizationId: string;
	teamId: string | null;
	canCreateTeams: boolean;
	canManageTeamMembers: boolean;
	canManageTeamSettings: boolean;
	canApproveTeamRequests: boolean;
	grantedBy: string;
	grantedAt: Date;
}

export type TeamPermission =
	| "canCreateTeams"
	| "canManageTeamMembers"
	| "canManageTeamSettings"
	| "canApproveTeamRequests";

export class PermissionsService extends Context.Tag("PermissionsService")<
	PermissionsService,
	{
		readonly hasTeamPermission: (
			employeeId: string,
			permission: TeamPermission,
			teamId?: string | null,
		) => Effect.Effect<boolean, DatabaseError>;
		readonly getEmployeePermissions: (
			employeeId: string,
		) => Effect.Effect<EmployeePermissions[], NotFoundError | DatabaseError>;
		readonly grantPermissions: (
			employeeId: string,
			organizationId: string,
			permissions: PermissionFlags,
			teamId: string | null,
			grantedBy: string,
		) => Effect.Effect<void, NotFoundError | AuthorizationError | DatabaseError>;
		readonly revokePermissions: (
			employeeId: string,
			organizationId: string,
			teamId?: string | null,
		) => Effect.Effect<void, NotFoundError | DatabaseError>;
	}
>() {}

export const PermissionsServiceLive = Layer.effect(
	PermissionsService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return PermissionsService.of({
			hasTeamPermission: (employeeId, permission, teamId = null) =>
				Effect.gen(function* (_) {
					// Step 1: Check if employee exists and get their role
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
					);

					// If employee doesn't exist, return false (no permission)
					if (!emp) {
						return false;
					}

					// Step 2: Admins bypass all permission checks
					if (emp.role === "admin") {
						return true;
					}

					// Step 3: Check team-specific permissions first (if teamId provided)
					if (teamId) {
						const teamPerms = yield* _(
							dbService.query("getTeamSpecificPermissions", async () => {
								return await dbService.db.query.teamPermissions.findFirst({
									where: and(
										eq(teamPermissions.employeeId, employeeId),
										eq(teamPermissions.teamId, teamId),
									),
								});
							}),
						);

						if (teamPerms?.[permission]) {
							return true;
						}
					}

					// Step 4: Fallback to organization-wide permissions (teamId = null)
					const orgPerms = yield* _(
						dbService.query("getOrganizationWidePermissions", async () => {
							return await dbService.db.query.teamPermissions.findFirst({
								where: and(
									eq(teamPermissions.employeeId, employeeId),
									eq(teamPermissions.teamId, emp.organizationId),
								),
							});
						}),
					);

					if (orgPerms?.[permission]) {
						return true;
					}

					// No permissions found
					return false;
				}),

			getEmployeePermissions: (employeeId) =>
				Effect.gen(function* (_) {
					// Verify employee exists
					const _emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Get all permissions for this employee
					const permissions = yield* _(
						dbService.query("getEmployeePermissions", async () => {
							return await dbService.db.query.teamPermissions.findMany({
								where: eq(teamPermissions.employeeId, employeeId),
							});
						}),
					);

					return permissions.map((p) => ({
						employeeId: p.employeeId,
						organizationId: p.organizationId,
						teamId: p.teamId,
						canCreateTeams: p.canCreateTeams,
						canManageTeamMembers: p.canManageTeamMembers,
						canManageTeamSettings: p.canManageTeamSettings,
						canApproveTeamRequests: p.canApproveTeamRequests,
						grantedBy: p.grantedBy,
						grantedAt: p.grantedAt,
					}));
				}),

			grantPermissions: (employeeId, organizationId, permissions, teamId, grantedBy) =>
				Effect.gen(function* (_) {
					// Step 1: Verify employee exists
					const emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Step 2: Verify employee belongs to the organization
					if (emp.organizationId !== organizationId) {
						yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Employee does not belong to this organization",
									userId: employeeId,
									resource: "team_permissions",
									action: "grant",
								}),
							),
						);
					}

					// Step 3: Verify granter exists and has admin role
					const granter = yield* _(
						dbService.query("getGranterEmployee", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, grantedBy),
							});
						}),
						Effect.flatMap((g) =>
							g
								? Effect.succeed(g)
								: Effect.fail(
										new NotFoundError({
											message: "Granter employee not found",
											entityType: "employee",
											entityId: grantedBy,
										}),
									),
						),
					);

					if (granter.role !== "admin") {
						yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Only admins can grant permissions",
									userId: grantedBy,
									resource: "team_permissions",
									action: "grant",
								}),
							),
						);
					}

					// Step 4: Check if permissions already exist
					const existing = yield* _(
						dbService.query("checkExistingPermissions", async () => {
							return await dbService.db.query.teamPermissions.findFirst({
								where: and(
									eq(teamPermissions.employeeId, employeeId),
									eq(teamPermissions.organizationId, organizationId),
									teamId
										? eq(teamPermissions.teamId, teamId)
										: eq(teamPermissions.teamId, organizationId),
								),
							});
						}),
					);

					if (existing) {
						// Update existing permissions
						yield* _(
							dbService.query("updatePermissions", async () => {
								await dbService.db
									.update(teamPermissions)
									.set({
										canCreateTeams: permissions.canCreateTeams ?? existing.canCreateTeams,
										canManageTeamMembers:
											permissions.canManageTeamMembers ?? existing.canManageTeamMembers,
										canManageTeamSettings:
											permissions.canManageTeamSettings ?? existing.canManageTeamSettings,
										canApproveTeamRequests:
											permissions.canApproveTeamRequests ?? existing.canApproveTeamRequests,
										grantedBy,
										grantedAt: new Date(),
										updatedAt: new Date(),
									})
									.where(eq(teamPermissions.id, existing.id));
							}),
						);
					} else {
						// Create new permissions
						yield* _(
							dbService.query("createPermissions", async () => {
								await dbService.db.insert(teamPermissions).values({
									employeeId,
									organizationId,
									teamId: teamId || organizationId, // Use orgId for org-wide permissions
									canCreateTeams: permissions.canCreateTeams ?? false,
									canManageTeamMembers: permissions.canManageTeamMembers ?? false,
									canManageTeamSettings: permissions.canManageTeamSettings ?? false,
									canApproveTeamRequests: permissions.canApproveTeamRequests ?? false,
									grantedBy,
								});
							}),
						);
					}
				}),

			revokePermissions: (employeeId, organizationId, teamId = null) =>
				Effect.gen(function* (_) {
					// Verify employee exists
					const _emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: eq(employee.id, employeeId),
							});
						}),
						Effect.flatMap((e) =>
							e
								? Effect.succeed(e)
								: Effect.fail(
										new NotFoundError({
											message: "Employee not found",
											entityType: "employee",
											entityId: employeeId,
										}),
									),
						),
					);

					// Delete permissions
					yield* _(
						dbService.query("revokePermissions", async () => {
							await dbService.db
								.delete(teamPermissions)
								.where(
									and(
										eq(teamPermissions.employeeId, employeeId),
										eq(teamPermissions.organizationId, organizationId),
										teamId
											? eq(teamPermissions.teamId, teamId)
											: eq(teamPermissions.teamId, organizationId),
									),
								);
						}),
					);
				}),
		});
	}),
);
