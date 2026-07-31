import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { member } from "@/db/auth-schema";
import { employee, team, teamPermissions } from "@/db/schema";
import {
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
} from "../errors";
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

function permissionMutationLockKey(
	organizationId: string,
	employeeId: string,
	teamId: string | null,
) {
	return `team-permissions:${organizationId}:${employeeId}:${teamId ?? "organization-wide"}`;
}

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
			organizationId: string,
		) => Effect.Effect<EmployeePermissions[], NotFoundError | DatabaseError>;
		readonly grantPermissions: (
			employeeId: string,
			organizationId: string,
			permissions: PermissionFlags,
			teamId: string | null,
			grantedBy: string,
		) => Effect.Effect<
			void,
			NotFoundError | AuthorizationError | DatabaseError
		>;
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

					// Step 4: Fallback to organization-wide permissions (teamId = NULL)
					const orgPerms = yield* _(
						dbService.query("getOrganizationWidePermissions", async () => {
							return await dbService.db.query.teamPermissions.findFirst({
								where: and(
									eq(teamPermissions.employeeId, employeeId),
									eq(teamPermissions.organizationId, emp.organizationId),
									isNull(teamPermissions.teamId),
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

			getEmployeePermissions: (employeeId, organizationId) =>
				Effect.gen(function* (_) {
					// Verify employee exists
					const _emp = yield* _(
						dbService.query("getEmployeeById", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.id, employeeId),
									eq(employee.organizationId, organizationId),
								),
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
								where: and(
									eq(teamPermissions.employeeId, employeeId),
									eq(teamPermissions.organizationId, organizationId),
								),
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

			grantPermissions: (
				employeeId,
				organizationId,
				permissions,
				teamId,
				grantedBy,
			) =>
				Effect.gen(function* (_) {
					const outcome = yield* _(
						dbService.query("grantPermissions", async () => {
							return await dbService.db.transaction(async (tx) => {
								const target = await tx.query.employee.findFirst({
									where: and(
										eq(employee.id, employeeId),
										eq(employee.organizationId, organizationId),
									),
								});
								if (!target) return { _tag: "TargetNotFound" } as const;

								const granter = await tx.query.employee.findFirst({
									where: and(
										eq(employee.id, grantedBy),
										eq(employee.organizationId, organizationId),
									),
								});
								if (!granter) return { _tag: "GranterNotFound" } as const;

								let canGrant = granter.role === "admin";
								if (!canGrant) {
									const granterMembership = await tx.query.member.findFirst({
										where: and(
											eq(member.userId, granter.userId),
											eq(member.organizationId, organizationId),
										),
										columns: { role: true },
									});
									canGrant =
										granterMembership?.role === "owner" ||
										granterMembership?.role === "admin";
								}
								if (!canGrant) return { _tag: "Unauthorized" } as const;

								if (teamId) {
									const targetTeam = await tx.query.team.findFirst({
										where: and(
											eq(team.id, teamId),
											eq(team.organizationId, organizationId),
										),
									});
									if (!targetTeam) return { _tag: "TeamNotFound" } as const;
								}

								const lockKey = permissionMutationLockKey(
									organizationId,
									employeeId,
									teamId,
								);
								await tx.execute(
									sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
								);

								const scopeWhere = and(
									eq(teamPermissions.employeeId, employeeId),
									eq(teamPermissions.organizationId, organizationId),
									teamId
										? eq(teamPermissions.teamId, teamId)
										: isNull(teamPermissions.teamId),
								);
								const existing = await tx.query.teamPermissions.findMany({
									where: scopeWhere,
									orderBy: (permission, { asc }) => [asc(permission.id)],
								});

								const primary = existing[0];
								if (primary) {
									await tx
										.update(teamPermissions)
										.set({
											canCreateTeams:
												permissions.canCreateTeams ?? primary.canCreateTeams,
											canManageTeamMembers:
												permissions.canManageTeamMembers ??
												primary.canManageTeamMembers,
											canManageTeamSettings:
												permissions.canManageTeamSettings ??
												primary.canManageTeamSettings,
											canApproveTeamRequests:
												permissions.canApproveTeamRequests ??
												primary.canApproveTeamRequests,
											grantedBy,
											grantedAt: new Date(),
											updatedAt: new Date(),
										})
										.where(and(eq(teamPermissions.id, primary.id), scopeWhere));

									const duplicateIds = existing.slice(1).map((row) => row.id);
									if (duplicateIds.length > 0) {
										await tx
											.delete(teamPermissions)
											.where(
												and(
													eq(teamPermissions.organizationId, organizationId),
													eq(teamPermissions.employeeId, employeeId),
													inArray(teamPermissions.id, duplicateIds),
												),
											);
									}
								} else {
									await tx.insert(teamPermissions).values({
										employeeId,
										organizationId,
										teamId,
										canCreateTeams: permissions.canCreateTeams ?? false,
										canManageTeamMembers:
											permissions.canManageTeamMembers ?? false,
										canManageTeamSettings:
											permissions.canManageTeamSettings ?? false,
										canApproveTeamRequests:
											permissions.canApproveTeamRequests ?? false,
										grantedBy,
									});
								}

								return { _tag: "Success" } as const;
							});
						}),
					);

					if (outcome._tag === "TargetNotFound") {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: employeeId,
								}),
							),
						);
					}
					if (outcome._tag === "GranterNotFound") {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Granting employee not found",
									entityType: "employee",
									entityId: grantedBy,
								}),
							),
						);
					}
					if (outcome._tag === "TeamNotFound") {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Team not found",
									entityType: "team",
									entityId: teamId ?? undefined,
								}),
							),
						);
					}
					if (outcome._tag === "Unauthorized") {
						return yield* _(
							Effect.fail(
								new AuthorizationError({
									message: "Only org admins can grant permissions",
									userId: grantedBy,
									resource: "team_permissions",
									action: "grant",
								}),
							),
						);
					}
				}),

			revokePermissions: (employeeId, organizationId, teamId = null) =>
				Effect.gen(function* (_) {
					const outcome = yield* _(
						dbService.query("revokePermissions", async () => {
							return await dbService.db.transaction(async (tx) => {
								const target = await tx.query.employee.findFirst({
									where: and(
										eq(employee.id, employeeId),
										eq(employee.organizationId, organizationId),
									),
								});
								if (!target) return { _tag: "TargetNotFound" } as const;

								if (teamId) {
									const targetTeam = await tx.query.team.findFirst({
										where: and(
											eq(team.id, teamId),
											eq(team.organizationId, organizationId),
										),
									});
									if (!targetTeam) return { _tag: "TeamNotFound" } as const;
								}

								const lockKey = permissionMutationLockKey(
									organizationId,
									employeeId,
									teamId,
								);
								await tx.execute(
									sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
								);
								await tx
									.delete(teamPermissions)
									.where(
										and(
											eq(teamPermissions.employeeId, employeeId),
											eq(teamPermissions.organizationId, organizationId),
											teamId
												? eq(teamPermissions.teamId, teamId)
												: isNull(teamPermissions.teamId),
										),
									);
								return { _tag: "Success" } as const;
							});
						}),
					);

					if (outcome._tag === "TargetNotFound") {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Employee not found",
									entityType: "employee",
									entityId: employeeId,
								}),
							),
						);
					}
					if (outcome._tag === "TeamNotFound") {
						return yield* _(
							Effect.fail(
								new NotFoundError({
									message: "Team not found",
									entityType: "team",
									entityId: teamId ?? undefined,
								}),
							),
						);
					}
				}),
		});
	}),
);
