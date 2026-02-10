/**
 * Custom Role Service
 *
 * Effect service for managing custom roles with configurable permissions.
 * Follows the same patterns as permissions.service.ts and skill.service.ts.
 */

import { and, eq, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import {
	customRole,
	customRoleAuditLog,
	customRolePermission,
	employeeCustomRole,
} from "@/db/schema";
import { isValidPermission } from "@/lib/authorization/permission-registry";
import type { Action, Subject } from "@/lib/authorization/types";
import {
	ConflictError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "../errors";
import { DatabaseService } from "./database.service";

// ============================================
// TYPES
// ============================================

export interface CustomRoleWithPermissions {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	color: string;
	isActive: boolean;
	baseTier: "admin" | "manager" | "employee";
	createdAt: Date;
	createdBy: string;
	updatedAt: Date;
	updatedBy: string | null;
	permissions: Array<{ action: string; subject: string }>;
	assignedCount: number;
}

export interface CreateCustomRoleInput {
	name: string;
	description?: string;
	color?: string;
	baseTier: "admin" | "manager" | "employee";
}

export interface UpdateCustomRoleInput {
	name?: string;
	description?: string;
	color?: string;
	baseTier?: "admin" | "manager" | "employee";
}

type CustomRoleAuditEventType =
	| "role_created"
	| "role_updated"
	| "role_deleted"
	| "permission_added"
	| "permission_removed"
	| "employee_assigned"
	| "employee_unassigned";

// ============================================
// SERVICE INTERFACE
// ============================================

export class CustomRoleService extends Context.Tag("CustomRoleService")<
	CustomRoleService,
	{
		readonly createRole: (
			orgId: string,
			input: CreateCustomRoleInput,
			createdBy: string,
		) => Effect.Effect<string, DatabaseError | ValidationError | ConflictError>;

		readonly updateRole: (
			roleId: string,
			orgId: string,
			input: UpdateCustomRoleInput,
			updatedBy: string,
		) => Effect.Effect<void, DatabaseError | NotFoundError | ConflictError>;

		readonly deleteRole: (
			roleId: string,
			orgId: string,
			deletedBy: string,
		) => Effect.Effect<void, DatabaseError | NotFoundError>;

		readonly getRole: (
			roleId: string,
			orgId: string,
		) => Effect.Effect<CustomRoleWithPermissions, DatabaseError | NotFoundError>;

		readonly listRoles: (
			orgId: string,
		) => Effect.Effect<CustomRoleWithPermissions[], DatabaseError>;

		readonly setPermissions: (
			roleId: string,
			orgId: string,
			permissions: Array<{ action: string; subject: string }>,
			userId: string,
		) => Effect.Effect<void, DatabaseError | NotFoundError | ValidationError>;

		readonly assignRole: (
			employeeId: string,
			roleId: string,
			orgId: string,
			assignedBy: string,
		) => Effect.Effect<void, DatabaseError | NotFoundError>;

		readonly unassignRole: (
			employeeId: string,
			roleId: string,
			orgId: string,
			unassignedBy: string,
		) => Effect.Effect<void, DatabaseError | NotFoundError>;

		readonly getEmployeeRoles: (
			employeeId: string,
		) => Effect.Effect<CustomRoleWithPermissions[], DatabaseError>;
	}
>() {}

// ============================================
// SERVICE IMPLEMENTATION
// ============================================

export const CustomRoleServiceLive = Layer.effect(
	CustomRoleService,
	Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);

		// Helper to write audit log
		const writeAuditLog = (
			orgId: string,
			roleId: string | null,
			eventType: CustomRoleAuditEventType,
			metadata: Record<string, unknown>,
			createdBy: string,
		) =>
			dbService.query("writeCustomRoleAuditLog", async () => {
				await dbService.db.insert(customRoleAuditLog).values({
					organizationId: orgId,
					customRoleId: roleId,
					eventType,
					metadata,
					createdBy,
				});
			});

		// Helper to load a role with permissions and assigned count
		const loadRoleWithDetails = async (
			roleRecord: typeof customRole.$inferSelect,
		): Promise<CustomRoleWithPermissions> => {
			const perms = await dbService.db.query.customRolePermission.findMany({
				where: eq(customRolePermission.customRoleId, roleRecord.id),
			});

			const assignedCountResult = await dbService.db
				.select({ count: sql<number>`count(*)::int` })
				.from(employeeCustomRole)
				.where(eq(employeeCustomRole.customRoleId, roleRecord.id));

			return {
				id: roleRecord.id,
				organizationId: roleRecord.organizationId,
				name: roleRecord.name,
				description: roleRecord.description,
				color: roleRecord.color,
				isActive: roleRecord.isActive,
				baseTier: roleRecord.baseTier,
				createdAt: roleRecord.createdAt,
				createdBy: roleRecord.createdBy,
				updatedAt: roleRecord.updatedAt,
				updatedBy: roleRecord.updatedBy,
				permissions: perms.map((p) => ({ action: p.action, subject: p.subject })),
				assignedCount: assignedCountResult[0]?.count ?? 0,
			};
		};

		return CustomRoleService.of({
			createRole: (orgId, input, createdBy) =>
				Effect.gen(function* (_) {
					if (!input.name?.trim()) {
						return yield* _(
							Effect.fail(
								new ValidationError({
									message: "Role name is required",
									field: "name",
								}),
							),
						);
					}

					// Check for duplicate name
					const existing = yield* _(
						dbService.query("checkDuplicateRoleName", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.organizationId, orgId),
									eq(customRole.name, input.name.trim()),
								),
							});
						}),
					);

					if (existing) {
						return yield* _(
							Effect.fail(
								new ConflictError({
									message: `A role with the name "${input.name}" already exists`,
									conflictType: "duplicate_name",
								}),
							),
						);
					}

					const result = yield* _(
						dbService.query("createCustomRole", async () => {
							const [row] = await dbService.db
								.insert(customRole)
								.values({
									organizationId: orgId,
									name: input.name.trim(),
									description: input.description?.trim() ?? null,
									color: input.color ?? "#6366f1",
									baseTier: input.baseTier,
									createdBy,
									updatedAt: new Date(),
								})
								.returning({ id: customRole.id });
							return row!;
						}),
					);

					yield* _(
						writeAuditLog(orgId, result.id, "role_created", {
							name: input.name,
							baseTier: input.baseTier,
						}, createdBy),
					);

					return result.id;
				}),

			updateRole: (roleId, orgId, input, updatedBy) =>
				Effect.gen(function* (_) {
					// Verify role exists and belongs to org
					const role = yield* _(
						dbService.query("getCustomRoleForUpdate", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.id, roleId),
									eq(customRole.organizationId, orgId),
								),
							});
						}),
						Effect.flatMap((r) =>
							r
								? Effect.succeed(r)
								: Effect.fail(
										new NotFoundError({
											message: "Custom role not found",
											entityType: "custom_role",
											entityId: roleId,
										}),
									),
						),
					);

					// Check name conflict if name is being changed
					if (input.name && input.name.trim() !== role.name) {
						const existing = yield* _(
							dbService.query("checkDuplicateRoleNameOnUpdate", async () => {
								return await dbService.db.query.customRole.findFirst({
									where: and(
										eq(customRole.organizationId, orgId),
										eq(customRole.name, input.name!.trim()),
									),
								});
							}),
						);

						if (existing) {
							return yield* _(
								Effect.fail(
									new ConflictError({
										message: `A role with the name "${input.name}" already exists`,
										conflictType: "duplicate_name",
									}),
								),
							);
						}
					}

					yield* _(
						dbService.query("updateCustomRole", async () => {
							await dbService.db
								.update(customRole)
								.set({
									...(input.name && { name: input.name.trim() }),
									...(input.description !== undefined && {
										description: input.description?.trim() ?? null,
									}),
									...(input.color && { color: input.color }),
									...(input.baseTier && { baseTier: input.baseTier }),
									updatedBy,
									updatedAt: new Date(),
								})
								.where(eq(customRole.id, roleId));
						}),
					);

					yield* _(
						writeAuditLog(orgId, roleId, "role_updated", {
							changes: input,
						}, updatedBy),
					);
				}),

			deleteRole: (roleId, orgId, deletedBy) =>
				Effect.gen(function* (_) {
					// Verify role exists
					yield* _(
						dbService.query("getCustomRoleForDelete", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.id, roleId),
									eq(customRole.organizationId, orgId),
								),
							});
						}),
						Effect.flatMap((r) =>
							r
								? Effect.succeed(r)
								: Effect.fail(
										new NotFoundError({
											message: "Custom role not found",
											entityType: "custom_role",
											entityId: roleId,
										}),
									),
						),
					);

					// Soft delete: set isActive = false
					yield* _(
						dbService.query("softDeleteCustomRole", async () => {
							await dbService.db
								.update(customRole)
								.set({
									isActive: false,
									updatedBy: deletedBy,
									updatedAt: new Date(),
								})
								.where(eq(customRole.id, roleId));
						}),
					);

					yield* _(
						writeAuditLog(orgId, roleId, "role_deleted", {}, deletedBy),
					);
				}),

			getRole: (roleId, orgId) =>
				Effect.gen(function* (_) {
					const role = yield* _(
						dbService.query("getCustomRole", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.id, roleId),
									eq(customRole.organizationId, orgId),
								),
							});
						}),
						Effect.flatMap((r) =>
							r
								? Effect.succeed(r)
								: Effect.fail(
										new NotFoundError({
											message: "Custom role not found",
											entityType: "custom_role",
											entityId: roleId,
										}),
									),
						),
					);

					return yield* _(
						dbService.query("getCustomRoleDetails", async () => {
							return await loadRoleWithDetails(role);
						}),
					);
				}),

			listRoles: (orgId) =>
				Effect.gen(function* (_) {
					const roles = yield* _(
						dbService.query("listCustomRoles", async () => {
							return await dbService.db.query.customRole.findMany({
								where: and(
									eq(customRole.organizationId, orgId),
									eq(customRole.isActive, true),
								),
								orderBy: (table, { asc }) => [asc(table.name)],
							});
						}),
					);

					return yield* _(
						dbService.query("listCustomRolesWithDetails", async () => {
							return await Promise.all(
								roles.map((role) => loadRoleWithDetails(role)),
							);
						}),
					);
				}),

			setPermissions: (roleId, orgId, permissions, userId) =>
				Effect.gen(function* (_) {
					// Verify role exists
					yield* _(
						dbService.query("getCustomRoleForSetPerms", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.id, roleId),
									eq(customRole.organizationId, orgId),
								),
							});
						}),
						Effect.flatMap((r) =>
							r
								? Effect.succeed(r)
								: Effect.fail(
										new NotFoundError({
											message: "Custom role not found",
											entityType: "custom_role",
											entityId: roleId,
										}),
									),
						),
					);

					// Validate all permissions
					for (const perm of permissions) {
						if (!isValidPermission(perm.action, perm.subject)) {
							return yield* _(
								Effect.fail(
									new ValidationError({
										message: `Invalid permission: ${perm.action}:${perm.subject}`,
										field: "permissions",
									}),
								),
							);
						}
					}

					// Replace all permissions (delete + insert)
					yield* _(
						dbService.query("setCustomRolePermissions", async () => {
							await dbService.db
								.delete(customRolePermission)
								.where(eq(customRolePermission.customRoleId, roleId));

							if (permissions.length > 0) {
								await dbService.db.insert(customRolePermission).values(
									permissions.map((p) => ({
										customRoleId: roleId,
										action: p.action,
										subject: p.subject,
									})),
								);
							}
						}),
					);

					yield* _(
						writeAuditLog(orgId, roleId, "permission_added", {
							permissions: permissions.map((p) => `${p.action}:${p.subject}`),
						}, userId),
					);
				}),

			assignRole: (employeeId, roleId, orgId, assignedBy) =>
				Effect.gen(function* (_) {
					// Verify role exists and is active
					yield* _(
						dbService.query("getCustomRoleForAssign", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.id, roleId),
									eq(customRole.organizationId, orgId),
									eq(customRole.isActive, true),
								),
							});
						}),
						Effect.flatMap((r) =>
							r
								? Effect.succeed(r)
								: Effect.fail(
										new NotFoundError({
											message: "Custom role not found or inactive",
											entityType: "custom_role",
											entityId: roleId,
										}),
									),
						),
					);

					// Insert with conflict ignore (idempotent)
					yield* _(
						dbService.query("assignCustomRole", async () => {
							await dbService.db
								.insert(employeeCustomRole)
								.values({
									employeeId,
									customRoleId: roleId,
									assignedBy,
								})
								.onConflictDoNothing();
						}),
					);

					yield* _(
						writeAuditLog(orgId, roleId, "employee_assigned", {
							employeeId,
						}, assignedBy),
					);
				}),

			unassignRole: (employeeId, roleId, orgId, unassignedBy) =>
				Effect.gen(function* (_) {
					// Verify role exists
					yield* _(
						dbService.query("getCustomRoleForUnassign", async () => {
							return await dbService.db.query.customRole.findFirst({
								where: and(
									eq(customRole.id, roleId),
									eq(customRole.organizationId, orgId),
								),
							});
						}),
						Effect.flatMap((r) =>
							r
								? Effect.succeed(r)
								: Effect.fail(
										new NotFoundError({
											message: "Custom role not found",
											entityType: "custom_role",
											entityId: roleId,
										}),
									),
						),
					);

					yield* _(
						dbService.query("unassignCustomRole", async () => {
							await dbService.db
								.delete(employeeCustomRole)
								.where(
									and(
										eq(employeeCustomRole.employeeId, employeeId),
										eq(employeeCustomRole.customRoleId, roleId),
									),
								);
						}),
					);

					yield* _(
						writeAuditLog(orgId, roleId, "employee_unassigned", {
							employeeId,
						}, unassignedBy),
					);
				}),

			getEmployeeRoles: (employeeId) =>
				Effect.gen(function* (_) {
					const assignments = yield* _(
						dbService.query("getEmployeeCustomRoleAssignments", async () => {
							return await dbService.db.query.employeeCustomRole.findMany({
								where: eq(employeeCustomRole.employeeId, employeeId),
								with: {
									customRole: true,
								},
							});
						}),
					);

					const activeRoles = assignments
						.filter((a) => a.customRole.isActive)
						.map((a) => a.customRole);

					return yield* _(
						dbService.query("getEmployeeCustomRolesWithDetails", async () => {
							return await Promise.all(
								activeRoles.map((role) => loadRoleWithDetails(role)),
							);
						}),
					);
				}),
		});
	}),
);
