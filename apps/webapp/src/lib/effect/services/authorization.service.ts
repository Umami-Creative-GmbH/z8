/**
 * Effect Authorization Service
 *
 * Provides Effect-based authorization capabilities using CASL.
 * Loads principal context from database and builds abilities.
 */

import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { member } from "@/db/auth-schema";
import {
	employee,
	employeeCustomRole,
	employeeManagers,
	customRole,
	customRolePermission,
	teamPermissions,
} from "@/db/schema";
import {
	defineAbilityFor,
	type AppAbility,
	type PrincipalContext,
	type Action,
	type Subject,
	type TeamPermissions,
	type CustomRoleInfo,
} from "@/lib/authorization";
import type { PermissionFlags } from "./permissions.service";
import { AuthorizationError, type DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";

// ============================================
// SERVICE INTERFACE
// ============================================

export class AuthorizationService extends Context.Tag("AuthorizationService")<
	AuthorizationService,
	{
		/**
		 * Load principal context from user ID and active organization
		 */
		readonly loadPrincipal: (
			userId: string,
			activeOrganizationId: string | null,
			isPlatformAdmin: boolean,
		) => Effect.Effect<PrincipalContext, DatabaseError>;

		/**
		 * Build CASL ability from principal context
		 */
		readonly getAbility: (
			principal: PrincipalContext,
		) => Effect.Effect<AppAbility, never>;

		/**
		 * Load principal and build ability in one step
		 */
		readonly buildAbility: (
			userId: string,
			activeOrganizationId: string | null,
			isPlatformAdmin: boolean,
		) => Effect.Effect<AppAbility, DatabaseError>;

		/**
		 * Check if action is allowed (non-throwing)
		 */
		readonly can: (
			ability: AppAbility,
			action: Action,
			subject: Subject,
		) => Effect.Effect<boolean, never>;

		/**
		 * Assert action is allowed (throws AuthorizationError if denied)
		 */
		readonly require: (
			ability: AppAbility,
			action: Action,
			subject: Subject,
			subjectId?: string,
		) => Effect.Effect<void, AuthorizationError>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const AuthorizationServiceLive = Layer.effect(
	AuthorizationService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		return AuthorizationService.of({
			loadPrincipal: (userId, activeOrganizationId, isPlatformAdmin) =>
				Effect.gen(function* (_) {
					// If platform admin, return minimal context
					if (isPlatformAdmin) {
						return {
							userId,
							isPlatformAdmin: true,
							activeOrganizationId,
							orgMembership: null,
							employee: null,
							permissions: { orgWide: null, byTeamId: new Map() },
							managedEmployeeIds: [],
							customRoles: [],
						} satisfies PrincipalContext;
					}

					// No active org = limited context
					if (!activeOrganizationId) {
						return {
							userId,
							isPlatformAdmin: false,
							activeOrganizationId: null,
							orgMembership: null,
							employee: null,
							permissions: { orgWide: null, byTeamId: new Map() },
							managedEmployeeIds: [],
							customRoles: [],
						} satisfies PrincipalContext;
					}

					// Load organization membership
					const memberRecord = yield* _(
						dbService.query("getMemberForAuth", async () => {
							return await dbService.db.query.member.findFirst({
								where: and(
									eq(member.userId, userId),
									eq(member.organizationId, activeOrganizationId),
								),
							});
						}),
					);

					// Load employee record
					const employeeRecord = yield* _(
						dbService.query("getEmployeeForAuth", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.userId, userId),
									eq(employee.organizationId, activeOrganizationId),
									eq(employee.isActive, true),
								),
							});
						}),
					);

					// Load permissions if employee exists
					let permissions: TeamPermissions = {
						orgWide: null,
						byTeamId: new Map(),
					};

					if (employeeRecord) {
						const permRecords = yield* _(
							dbService.query("getPermissionsForAuth", async () => {
								return await dbService.db.query.teamPermissions.findMany({
									where: eq(teamPermissions.employeeId, employeeRecord.id),
								});
							}),
						);

						for (const perm of permRecords) {
							const flags: PermissionFlags = {
								canCreateTeams: perm.canCreateTeams,
								canManageTeamMembers: perm.canManageTeamMembers,
								canManageTeamSettings: perm.canManageTeamSettings,
								canApproveTeamRequests: perm.canApproveTeamRequests,
							};

							if (perm.teamId === null) {
								// Org-wide permissions
								permissions.orgWide = flags;
							} else {
								// Team-specific permissions
								permissions.byTeamId.set(perm.teamId, flags);
							}
						}
					}

					// Load managed employee IDs
					let managedEmployeeIds: string[] = [];

					if (employeeRecord && (employeeRecord.role === "manager" || employeeRecord.role === "admin")) {
						const managedRecords = yield* _(
							dbService.query("getManagedEmployeesForAuth", async () => {
								return await dbService.db.query.employeeManagers.findMany({
									where: eq(employeeManagers.managerId, employeeRecord.id),
									columns: { employeeId: true },
								});
							}),
						);

						managedEmployeeIds = managedRecords.map((r) => r.employeeId);
					}

					// Load custom roles
					let customRolesInfo: CustomRoleInfo[] = [];

					if (employeeRecord) {
						const assignments = yield* _(
							dbService.query("getCustomRolesForAuth", async () => {
								return await dbService.db
									.select({
										roleId: customRole.id,
										roleName: customRole.name,
										baseTier: customRole.baseTier,
										permAction: customRolePermission.action,
										permSubject: customRolePermission.subject,
									})
									.from(employeeCustomRole)
									.innerJoin(customRole, and(
										eq(employeeCustomRole.customRoleId, customRole.id),
										eq(customRole.isActive, true),
										eq(customRole.organizationId, employeeRecord.organizationId),
									))
									.leftJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
									.where(eq(employeeCustomRole.employeeId, employeeRecord.id));
							}),
						);

						// Group permissions by role
						const roleMap = new Map<string, CustomRoleInfo>();
						for (const row of assignments) {
							if (!roleMap.has(row.roleId)) {
								roleMap.set(row.roleId, {
									roleId: row.roleId,
									roleName: row.roleName,
									baseTier: row.baseTier,
									permissions: [],
								});
							}
							if (row.permAction && row.permSubject) {
								roleMap.get(row.roleId)!.permissions.push({
									action: row.permAction as Action,
									subject: row.permSubject as Subject,
								});
							}
						}
						customRolesInfo = Array.from(roleMap.values());
					}

					return {
						userId,
						isPlatformAdmin: false,
						activeOrganizationId,
						orgMembership: memberRecord
							? {
									organizationId: memberRecord.organizationId,
									role: memberRecord.role as "owner" | "admin" | "member",
									status: "active",
								}
							: null,
						employee: employeeRecord
							? {
									id: employeeRecord.id,
									organizationId: employeeRecord.organizationId,
									role: employeeRecord.role,
									teamId: employeeRecord.teamId,
								}
							: null,
						permissions,
						managedEmployeeIds,
						customRoles: customRolesInfo,
					} satisfies PrincipalContext;
				}),

			getAbility: (principal) => Effect.succeed(defineAbilityFor(principal)),

			buildAbility: (userId, activeOrganizationId, isPlatformAdmin) =>
				Effect.gen(function* (_) {
					// If platform admin, return minimal context
					if (isPlatformAdmin) {
						const principal: PrincipalContext = {
							userId,
							isPlatformAdmin: true,
							activeOrganizationId,
							orgMembership: null,
							employee: null,
							permissions: { orgWide: null, byTeamId: new Map() },
							managedEmployeeIds: [],
							customRoles: [],
						};
						return defineAbilityFor(principal);
					}

					// No active org = limited context
					if (!activeOrganizationId) {
						const principal: PrincipalContext = {
							userId,
							isPlatformAdmin: false,
							activeOrganizationId: null,
							orgMembership: null,
							employee: null,
							permissions: { orgWide: null, byTeamId: new Map() },
							managedEmployeeIds: [],
							customRoles: [],
						};
						return defineAbilityFor(principal);
					}

					// Load organization membership
					const memberRecord = yield* _(
						dbService.query("getMemberForAuth", async () => {
							return await dbService.db.query.member.findFirst({
								where: and(
									eq(member.userId, userId),
									eq(member.organizationId, activeOrganizationId),
								),
							});
						}),
					);

					// Load employee record
					const employeeRecord = yield* _(
						dbService.query("getEmployeeForAuth", async () => {
							return await dbService.db.query.employee.findFirst({
								where: and(
									eq(employee.userId, userId),
									eq(employee.organizationId, activeOrganizationId),
									eq(employee.isActive, true),
								),
							});
						}),
					);

					// Load permissions if employee exists
					const permissions: TeamPermissions = {
						orgWide: null,
						byTeamId: new Map(),
					};

					if (employeeRecord) {
						const permRecords = yield* _(
							dbService.query("getPermissionsForAuth", async () => {
								return await dbService.db.query.teamPermissions.findMany({
									where: eq(teamPermissions.employeeId, employeeRecord.id),
								});
							}),
						);

						for (const perm of permRecords) {
							const flags = {
								canCreateTeams: perm.canCreateTeams,
								canManageTeamMembers: perm.canManageTeamMembers,
								canManageTeamSettings: perm.canManageTeamSettings,
								canApproveTeamRequests: perm.canApproveTeamRequests,
							};

							if (perm.teamId === null) {
								permissions.orgWide = flags;
							} else {
								permissions.byTeamId.set(perm.teamId, flags);
							}
						}
					}

					// Load managed employee IDs
					let managedEmployeeIds: string[] = [];

					if (employeeRecord && (employeeRecord.role === "manager" || employeeRecord.role === "admin")) {
						const managedRecords = yield* _(
							dbService.query("getManagedEmployeesForAuth", async () => {
								return await dbService.db.query.employeeManagers.findMany({
									where: eq(employeeManagers.managerId, employeeRecord.id),
									columns: { employeeId: true },
								});
							}),
						);

						managedEmployeeIds = managedRecords.map((r) => r.employeeId);
					}

					// Load custom roles
					let customRolesInfo: CustomRoleInfo[] = [];

					if (employeeRecord) {
						const assignments = yield* _(
							dbService.query("getCustomRolesForBuildAbility", async () => {
								return await dbService.db
									.select({
										roleId: customRole.id,
										roleName: customRole.name,
										baseTier: customRole.baseTier,
										permAction: customRolePermission.action,
										permSubject: customRolePermission.subject,
									})
									.from(employeeCustomRole)
									.innerJoin(customRole, and(
										eq(employeeCustomRole.customRoleId, customRole.id),
										eq(customRole.isActive, true),
										eq(customRole.organizationId, employeeRecord.organizationId),
									))
									.leftJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id))
									.where(eq(employeeCustomRole.employeeId, employeeRecord.id));
							}),
						);

						const roleMap = new Map<string, CustomRoleInfo>();
						for (const row of assignments) {
							if (!roleMap.has(row.roleId)) {
								roleMap.set(row.roleId, {
									roleId: row.roleId,
									roleName: row.roleName,
									baseTier: row.baseTier,
									permissions: [],
								});
							}
							if (row.permAction && row.permSubject) {
								roleMap.get(row.roleId)!.permissions.push({
									action: row.permAction as Action,
									subject: row.permSubject as Subject,
								});
							}
						}
						customRolesInfo = Array.from(roleMap.values());
					}

					const principal: PrincipalContext = {
						userId,
						isPlatformAdmin: false,
						activeOrganizationId,
						orgMembership: memberRecord
							? {
									organizationId: memberRecord.organizationId,
									role: memberRecord.role as "owner" | "admin" | "member",
									status: "active",
								}
							: null,
						employee: employeeRecord
							? {
									id: employeeRecord.id,
									organizationId: employeeRecord.organizationId,
									role: employeeRecord.role,
									teamId: employeeRecord.teamId,
								}
							: null,
						permissions,
						managedEmployeeIds,
						customRoles: customRolesInfo,
					};

					return defineAbilityFor(principal);
				}),

			can: (ability, action, subject) =>
				Effect.succeed(ability.can(action, subject)),

			require: (ability, action, subject, subjectId) =>
				Effect.gen(function* (_) {
					if (ability.cannot(action, subject)) {
						yield* _(
							Effect.fail(
								new AuthorizationError({
									message: `Cannot ${action} ${subject}`,
									resource: subjectId ?? subject,
									action,
								}),
							),
						);
					}
				}),
		});
	}),
);

// ============================================
// CONVENIENCE LAYER
// ============================================

/**
 * Full authorization layer with database dependency
 */
export const AuthorizationServiceWithDeps = Layer.provide(
	AuthorizationServiceLive,
	Layer.succeed(DatabaseService, DatabaseService.of({
		db: null as any, // Will be provided at runtime
		query: () => Effect.die("DatabaseService not provided"),
	})),
);
