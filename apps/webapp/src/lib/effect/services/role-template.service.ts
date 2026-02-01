import { Context, Effect, Layer } from "effect";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import {
	employee,
	teamPermissions,
	roleTemplate,
	roleTemplateMapping,
	userRoleTemplateAssignment,
	userLifecycleEvent,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getRoleTemplateById, findRoleTemplateMappingForGroup } from "./cached-queries";

const logger = createLogger("RoleTemplate");

// ============================================
// Types
// ============================================

export interface CreateRoleTemplateInput {
	organizationId?: string; // null = global template
	name: string;
	description?: string;
	isGlobal?: boolean;
	employeeRole?: "admin" | "manager" | "employee";
	defaultTeamId?: string;
	teamPermissions?: {
		canCreateTeams?: boolean;
		canManageTeamMembers?: boolean;
		canManageTeamSettings?: boolean;
		canApproveTeamRequests?: boolean;
	};
	canUseWebapp?: boolean;
	canUseDesktop?: boolean;
	canUseMobile?: boolean;
	accessPolicyId?: string;
	createdBy?: string;
}

export interface UpdateRoleTemplateInput {
	id: string;
	name?: string;
	description?: string;
	isActive?: boolean;
	employeeRole?: "admin" | "manager" | "employee";
	defaultTeamId?: string | null;
	teamPermissions?: {
		canCreateTeams?: boolean;
		canManageTeamMembers?: boolean;
		canManageTeamSettings?: boolean;
		canApproveTeamRequests?: boolean;
	};
	canUseWebapp?: boolean;
	canUseDesktop?: boolean;
	canUseMobile?: boolean;
	accessPolicyId?: string | null;
}

export interface CreateIdpMappingInput {
	organizationId: string;
	idpType: "sso" | "scim";
	idpGroupId: string;
	idpGroupName?: string;
	roleTemplateId: string;
	priority?: number;
	createdBy: string;
}

// ============================================
// Role Template Service
// Manages role templates and IdP group mappings
// ============================================

export interface RoleTemplateService {
	/**
	 * Create a new role template
	 */
	readonly createTemplate: (
		input: CreateRoleTemplateInput,
	) => Effect.Effect<typeof roleTemplate.$inferSelect, Error>;

	/**
	 * Update an existing role template
	 */
	readonly updateTemplate: (
		input: UpdateRoleTemplateInput,
	) => Effect.Effect<typeof roleTemplate.$inferSelect, Error>;

	/**
	 * Delete a role template (soft delete by setting isActive=false)
	 */
	readonly deleteTemplate: (id: string) => Effect.Effect<void, Error>;

	/**
	 * Get a role template by ID
	 */
	readonly getTemplate: (
		id: string,
	) => Effect.Effect<typeof roleTemplate.$inferSelect | undefined, Error>;

	/**
	 * List role templates available to an organization (includes global templates)
	 */
	readonly listTemplates: (
		organizationId: string,
	) => Effect.Effect<(typeof roleTemplate.$inferSelect)[], Error>;

	/**
	 * List only global templates
	 */
	readonly listGlobalTemplates: () => Effect.Effect<(typeof roleTemplate.$inferSelect)[], Error>;

	/**
	 * Create an IdP group to role template mapping
	 */
	readonly createIdpMapping: (
		input: CreateIdpMappingInput,
	) => Effect.Effect<typeof roleTemplateMapping.$inferSelect, Error>;

	/**
	 * Delete an IdP mapping
	 */
	readonly deleteIdpMapping: (id: string) => Effect.Effect<void, Error>;

	/**
	 * List IdP mappings for an organization
	 */
	readonly listIdpMappings: (
		organizationId: string,
	) => Effect.Effect<(typeof roleTemplateMapping.$inferSelect)[], Error>;

	/**
	 * Find the role template for an IdP group
	 */
	readonly findTemplateForIdpGroup: (params: {
		organizationId: string;
		idpType: "sso" | "scim";
		idpGroupId: string;
	}) => Effect.Effect<typeof roleTemplate.$inferSelect | undefined, Error>;

	/**
	 * Apply a role template to a user
	 */
	readonly applyTemplateToUser: (params: {
		userId: string;
		organizationId: string;
		roleTemplateId: string;
		source: "manual" | "scim" | "sso" | "invite_code";
		appliedBy: string;
		idpGroupId?: string;
	}) => Effect.Effect<void, Error>;

	/**
	 * Get the current role template assignment for a user
	 */
	readonly getUserTemplateAssignment: (params: {
		userId: string;
		organizationId: string;
	}) => Effect.Effect<typeof userRoleTemplateAssignment.$inferSelect | undefined, Error>;

	/**
	 * Remove a user's role template assignment
	 */
	readonly removeUserTemplateAssignment: (params: {
		userId: string;
		organizationId: string;
	}) => Effect.Effect<void, Error>;
}

export const RoleTemplateService = Context.GenericTag<RoleTemplateService>(
	"@z8/RoleTemplateService",
);

export const RoleTemplateServiceLive = Layer.succeed(
	RoleTemplateService,
	RoleTemplateService.of({
		createTemplate: (input: CreateRoleTemplateInput) =>
			Effect.gen(function* () {
				const [created] = yield* Effect.tryPromise(() =>
					db
						.insert(roleTemplate)
						.values({
							organizationId: input.organizationId,
							name: input.name,
							description: input.description,
							isGlobal: input.isGlobal ?? false,
							isActive: true,
							employeeRole: input.employeeRole ?? "employee",
							defaultTeamId: input.defaultTeamId,
							teamPermissions: input.teamPermissions ?? {},
							canUseWebapp: input.canUseWebapp ?? true,
							canUseDesktop: input.canUseDesktop ?? true,
							canUseMobile: input.canUseMobile ?? true,
							accessPolicyId: input.accessPolicyId,
							createdBy: input.createdBy,
						})
						.returning(),
				);

				logger.info(
					{ templateId: created.id, name: created.name, organizationId: input.organizationId },
					"Role template created",
				);

				return created;
			}),

		updateTemplate: (input: UpdateRoleTemplateInput) =>
			Effect.gen(function* () {
				const updateData: Partial<typeof roleTemplate.$inferInsert> = {};

				if (input.name !== undefined) updateData.name = input.name;
				if (input.description !== undefined) updateData.description = input.description;
				if (input.isActive !== undefined) updateData.isActive = input.isActive;
				if (input.employeeRole !== undefined) updateData.employeeRole = input.employeeRole;
				if (input.defaultTeamId !== undefined) updateData.defaultTeamId = input.defaultTeamId;
				if (input.teamPermissions !== undefined) updateData.teamPermissions = input.teamPermissions;
				if (input.canUseWebapp !== undefined) updateData.canUseWebapp = input.canUseWebapp;
				if (input.canUseDesktop !== undefined) updateData.canUseDesktop = input.canUseDesktop;
				if (input.canUseMobile !== undefined) updateData.canUseMobile = input.canUseMobile;
				if (input.accessPolicyId !== undefined) updateData.accessPolicyId = input.accessPolicyId;

				const [updated] = yield* Effect.tryPromise(() =>
					db.update(roleTemplate).set(updateData).where(eq(roleTemplate.id, input.id)).returning(),
				);

				logger.info({ templateId: input.id }, "Role template updated");

				return updated;
			}),

		deleteTemplate: (id: string) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() =>
					db.update(roleTemplate).set({ isActive: false }).where(eq(roleTemplate.id, id)),
				);

				logger.info({ templateId: id }, "Role template deactivated");
			}),

		getTemplate: (id: string) =>
			Effect.tryPromise(() =>
				db.query.roleTemplate.findFirst({
					where: eq(roleTemplate.id, id),
				}),
			),

		listTemplates: (organizationId: string) =>
			Effect.tryPromise(() =>
				db.query.roleTemplate.findMany({
					where: and(
						or(eq(roleTemplate.organizationId, organizationId), isNull(roleTemplate.organizationId)),
						eq(roleTemplate.isActive, true),
					),
				}),
			),

		listGlobalTemplates: () =>
			Effect.tryPromise(() =>
				db.query.roleTemplate.findMany({
					where: and(isNull(roleTemplate.organizationId), eq(roleTemplate.isActive, true)),
				}),
			),

		createIdpMapping: (input: CreateIdpMappingInput) =>
			Effect.gen(function* () {
				const [created] = yield* Effect.tryPromise(() =>
					db
						.insert(roleTemplateMapping)
						.values({
							organizationId: input.organizationId,
							idpType: input.idpType,
							idpGroupId: input.idpGroupId,
							idpGroupName: input.idpGroupName,
							roleTemplateId: input.roleTemplateId,
							priority: input.priority ?? 0,
							createdBy: input.createdBy,
						})
						.returning(),
				);

				logger.info(
					{
						mappingId: created.id,
						idpGroupId: input.idpGroupId,
						roleTemplateId: input.roleTemplateId,
					},
					"IdP mapping created",
				);

				return created;
			}),

		deleteIdpMapping: (id: string) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() =>
					db.delete(roleTemplateMapping).where(eq(roleTemplateMapping.id, id)),
				);

				logger.info({ mappingId: id }, "IdP mapping deleted");
			}),

		listIdpMappings: (organizationId: string) =>
			Effect.tryPromise(() =>
				db.query.roleTemplateMapping.findMany({
					where: eq(roleTemplateMapping.organizationId, organizationId),
					with: {
						roleTemplate: true,
					},
				}),
			),

		findTemplateForIdpGroup: ({ organizationId, idpType, idpGroupId }) =>
			Effect.gen(function* () {
				// Use cached query for IdP group mapping lookup
				const mapping = yield* Effect.tryPromise(() =>
					findRoleTemplateMappingForGroup(organizationId, idpType, idpGroupId),
				);

				return mapping?.roleTemplate;
			}),

		applyTemplateToUser: ({ userId, organizationId, roleTemplateId, source, appliedBy, idpGroupId }) =>
			Effect.gen(function* () {
				// Parallelize all independent lookups for better performance
				// @see async-parallel rule - 3x improvement
				const [template, employeeRecord, currentAssignment] = yield* Effect.all([
					// Get the template (cached per request)
					Effect.tryPromise(() => getRoleTemplateById(roleTemplateId)),
					// Get the employee record
					Effect.tryPromise(() =>
						db.query.employee.findFirst({
							where: and(eq(employee.userId, userId), eq(employee.organizationId, organizationId)),
						}),
					),
					// Get current assignment to detect role change
					Effect.tryPromise(() =>
						db.query.userRoleTemplateAssignment.findFirst({
							where: and(
								eq(userRoleTemplateAssignment.userId, userId),
								eq(userRoleTemplateAssignment.organizationId, organizationId),
							),
						}),
					),
				]);

				if (!template) {
					throw new Error(`Role template ${roleTemplateId} not found`);
				}

				if (!employeeRecord) {
					throw new Error(`Employee record not found for user ${userId} in org ${organizationId}`);
				}

				// Parallelize independent updates for better performance
				// @see async-parallel rule
				yield* Effect.all([
					// Update employee role
					Effect.tryPromise(() =>
						db.update(employee).set({ role: template.employeeRole }).where(eq(employee.id, employeeRecord.id)),
					),
					// Update user app access permissions
					Effect.tryPromise(() =>
						db
							.update(schema.user)
							.set({
								canUseWebapp: template.canUseWebapp,
								canUseDesktop: template.canUseDesktop,
								canUseMobile: template.canUseMobile,
							})
							.where(eq(schema.user.id, userId)),
					),
				]);

				// Apply team permissions if specified
				if (template.teamPermissions) {
					const permissions = template.teamPermissions as {
						canCreateTeams?: boolean;
						canManageTeamMembers?: boolean;
						canManageTeamSettings?: boolean;
						canApproveTeamRequests?: boolean;
					};

					// Upsert org-wide team permissions
					const existingPermission = yield* Effect.tryPromise(() =>
						db.query.teamPermissions.findFirst({
							where: and(
								eq(teamPermissions.employeeId, employeeRecord.id),
								eq(teamPermissions.organizationId, organizationId),
								isNull(teamPermissions.teamId),
							),
						}),
					);

					if (existingPermission) {
						yield* Effect.tryPromise(() =>
							db
								.update(teamPermissions)
								.set({
									canCreateTeams: permissions.canCreateTeams ?? false,
									canManageTeamMembers: permissions.canManageTeamMembers ?? false,
									canManageTeamSettings: permissions.canManageTeamSettings ?? false,
									canApproveTeamRequests: permissions.canApproveTeamRequests ?? false,
								})
								.where(eq(teamPermissions.id, existingPermission.id)),
						);
					} else {
						yield* Effect.tryPromise(() =>
							db.insert(teamPermissions).values({
								employeeId: employeeRecord.id,
								organizationId,
								teamId: null,
								canCreateTeams: permissions.canCreateTeams ?? false,
								canManageTeamMembers: permissions.canManageTeamMembers ?? false,
								canManageTeamSettings: permissions.canManageTeamSettings ?? false,
								canApproveTeamRequests: permissions.canApproveTeamRequests ?? false,
								grantedBy: employeeRecord.id,
							}),
						);
					}
				}

				// Record template assignment (upsert)
				yield* Effect.tryPromise(() =>
					db
						.insert(userRoleTemplateAssignment)
						.values({
							userId,
							organizationId,
							roleTemplateId,
							assignmentSource: source,
							idpGroupId,
							assignedBy: appliedBy,
						})
						.onConflictDoUpdate({
							target: [userRoleTemplateAssignment.userId, userRoleTemplateAssignment.organizationId],
							set: {
								roleTemplateId,
								assignmentSource: source,
								idpGroupId,
								assignedBy: appliedBy,
								assignedAt: new Date(),
							},
						}),
				);

				// Log lifecycle event if this is a role change
				if (currentAssignment && currentAssignment.roleTemplateId !== roleTemplateId) {
					yield* Effect.tryPromise(() =>
						db.insert(userLifecycleEvent).values({
							userId,
							organizationId,
							employeeId: employeeRecord.id,
							eventType: "move",
							source,
							createdBy: appliedBy,
							metadata: {
								fromTemplateId: currentAssignment.roleTemplateId,
								toTemplateId: roleTemplateId,
							},
						}),
					);
				}

				logger.info(
					{ userId, organizationId, roleTemplateId, source },
					"Role template applied to user",
				);
			}),

		getUserTemplateAssignment: ({ userId, organizationId }) =>
			Effect.tryPromise(() =>
				db.query.userRoleTemplateAssignment.findFirst({
					where: and(
						eq(userRoleTemplateAssignment.userId, userId),
						eq(userRoleTemplateAssignment.organizationId, organizationId),
					),
					with: {
						roleTemplate: true,
					},
				}),
			),

		removeUserTemplateAssignment: ({ userId, organizationId }) =>
			Effect.gen(function* () {
				yield* Effect.tryPromise(() =>
					db
						.delete(userRoleTemplateAssignment)
						.where(
							and(
								eq(userRoleTemplateAssignment.userId, userId),
								eq(userRoleTemplateAssignment.organizationId, organizationId),
							),
						),
				);

				logger.info({ userId, organizationId }, "Role template assignment removed");
			}),
	}),
);
