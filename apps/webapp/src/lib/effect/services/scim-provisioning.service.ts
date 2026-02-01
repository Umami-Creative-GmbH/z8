import { Context, Effect, Layer } from "effect";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/auth-schema";
import {
	employee,
	teamPermissions,
	scimProviderConfig,
	scimProvisioningLog,
	roleTemplate,
	roleTemplateMapping,
	userRoleTemplateAssignment,
	userLifecycleEvent,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import {
	getScimProviderConfig,
	getRoleTemplateById,
	findRoleTemplateMappingForGroup,
} from "./cached-queries";

const logger = createLogger("SCIMProvisioning");

// ============================================
// SCIM Provisioning Service
// Handles user lifecycle events from SCIM 2.0 provisioning
// ============================================

export interface SCIMProvisioningService {
	/**
	 * Handle user creation from SCIM
	 */
	readonly onUserProvisioned: (params: {
		userId: string;
		email: string;
		name: string;
		organizationId: string;
		scimExternalId?: string;
	}) => Effect.Effect<void, Error>;

	/**
	 * Handle user update from SCIM
	 */
	readonly onUserUpdated: (params: {
		userId: string;
		email: string;
		name: string;
		organizationId: string;
	}) => Effect.Effect<void, Error>;

	/**
	 * Handle user deprovisioning from SCIM
	 */
	readonly onUserDeprovisioned: (params: {
		userId: string;
		organizationId: string;
	}) => Effect.Effect<void, Error>;

	/**
	 * Handle user reactivation from SCIM
	 */
	readonly onUserReactivated: (params: {
		userId: string;
		organizationId: string;
	}) => Effect.Effect<void, Error>;

	/**
	 * Handle group membership change - apply role template mapping
	 */
	readonly onGroupMembershipChanged: (params: {
		userId: string;
		organizationId: string;
		groupId: string;
		action: "added" | "removed";
	}) => Effect.Effect<void, Error>;

	/**
	 * Apply a role template to an employee
	 */
	readonly applyRoleTemplate: (params: {
		userId: string;
		organizationId: string;
		roleTemplateId: string;
		source: "manual" | "scim" | "sso" | "invite_code";
		idpGroupId?: string;
	}) => Effect.Effect<void, Error>;
}

export const SCIMProvisioningService = Context.GenericTag<SCIMProvisioningService>(
	"@z8/SCIMProvisioningService",
);

export const SCIMProvisioningServiceLive = Layer.succeed(
	SCIMProvisioningService,
	SCIMProvisioningService.of({
		onUserProvisioned: ({ userId, email, name, organizationId, scimExternalId }) =>
			Effect.gen(function* () {
				try {
					// Parallelize independent queries for better performance
					// @see async-parallel rule - 2-3x improvement
					const [config, existingEmployee] = yield* Effect.all([
						// Get org-specific SCIM config (cached per request)
						Effect.tryPromise(() => getScimProviderConfig(organizationId)),
						// Check if employee record already exists
						Effect.tryPromise(() =>
							db.query.employee.findFirst({
								where: (emp, { eq: eqOp, and: andOp }) =>
									andOp(eqOp(emp.userId, userId), eqOp(emp.organizationId, organizationId)),
							}),
						),
					]);

					let newEmployee = existingEmployee;

					if (!existingEmployee) {
						// Create employee record
						// isActive depends on autoActivateUsers config (defaults to false = needs approval)
						const [created] = yield* Effect.tryPromise(() =>
							db
								.insert(employee)
								.values({
									userId,
									organizationId,
									role: "employee",
									isActive: config?.autoActivateUsers ?? false,
								})
								.returning(),
						);
						newEmployee = created;

						// Apply default role template if configured
						if (config?.defaultRoleTemplateId && newEmployee) {
							// Use cached query for role template lookup
							const template = yield* Effect.tryPromise(() =>
								getRoleTemplateById(config.defaultRoleTemplateId!),
							);

							if (template) {
								yield* applyRoleTemplateToEmployee(newEmployee, template, organizationId);

								// Record template assignment
								yield* Effect.tryPromise(() =>
									db
										.insert(userRoleTemplateAssignment)
										.values({
											userId,
											organizationId,
											roleTemplateId: template.id,
											assignmentSource: "scim",
											idpGroupId: undefined,
										})
										.onConflictDoUpdate({
											target: [
												userRoleTemplateAssignment.userId,
												userRoleTemplateAssignment.organizationId,
											],
											set: {
												roleTemplateId: template.id,
												assignmentSource: "scim",
												assignedAt: new Date(),
											},
										}),
								);
							}
						}
					}

					// Log the provisioning event
					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: "user_created",
							userId,
							externalId: scimExternalId ?? email,
							metadata: {
								scimUserName: email,
								scimDisplayName: name,
								autoActivated: config?.autoActivateUsers ?? false,
								roleTemplateId: config?.defaultRoleTemplateId ?? undefined,
							},
						}),
					);

					// Log lifecycle event
					yield* Effect.tryPromise(() =>
						db.insert(userLifecycleEvent).values({
							userId,
							organizationId,
							eventType: "join",
							source: "scim",
							createdBy: userId, // Self-created via SCIM
							metadata: {
								scimExternalId,
								notes: config?.autoActivateUsers ? "Auto-activated via SCIM" : "Pending approval",
							},
						}),
					);

					logger.info({ userId, organizationId }, "SCIM user provisioned successfully");
				} catch (error) {
					logger.error({ error, userId, organizationId }, "SCIM user provisioning failed");

					// Log error event
					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: "error",
							userId,
							metadata: {
								errorCode: "PROVISIONING_FAILED",
								errorMessage: error instanceof Error ? error.message : "Unknown error",
							},
						}),
					);

					throw error;
				}
			}),

		onUserUpdated: ({ userId, email, name, organizationId }) =>
			Effect.gen(function* () {
				try {
					// Log the update event
					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: "user_updated",
							userId,
							metadata: {
								scimUserName: email,
								scimDisplayName: name,
							},
						}),
					);

					logger.info({ userId, organizationId }, "SCIM user updated");
				} catch (error) {
					logger.error({ error, userId }, "SCIM user update logging failed");
				}
			}),

		onUserDeprovisioned: ({ userId, organizationId }) =>
			Effect.gen(function* () {
				try {
					// Parallelize independent queries
					// @see async-parallel rule
					const [config, employeeRecord] = yield* Effect.all([
						// Get org-specific SCIM config (cached per request)
						Effect.tryPromise(() => getScimProviderConfig(organizationId)),
						// Find the employee record
						Effect.tryPromise(() =>
							db.query.employee.findFirst({
								where: (emp, { eq: eqOp, and: andOp }) =>
									andOp(eqOp(emp.userId, userId), eqOp(emp.organizationId, organizationId)),
							}),
						),
					]);

					const deprovisionAction = config?.deprovisionAction ?? "suspend";

					if (employeeRecord) {
						if (deprovisionAction === "soft_delete") {
							// Soft delete: deactivate employee (preserves data for compliance)
							yield* Effect.tryPromise(() =>
								db.update(employee).set({ isActive: false }).where(eq(employee.id, employeeRecord.id)),
							);
						} else {
							// Suspend: update member status (can be reactivated via SCIM)
							yield* Effect.tryPromise(() =>
								db
									.update(schema.member)
									.set({ status: "suspended" })
									.where(
										and(
											eq(schema.member.userId, userId),
											eq(schema.member.organizationId, organizationId),
										),
									),
							);
						}
					}

					// Log the deprovisioning event
					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: "user_deactivated",
							userId,
							metadata: {
								deprovisionAction,
							},
						}),
					);

					// Log lifecycle event
					yield* Effect.tryPromise(() =>
						db.insert(userLifecycleEvent).values({
							userId,
							organizationId,
							eventType: "leave",
							source: "scim",
							createdBy: userId,
							metadata: {
								reason: "SCIM deprovisioning",
							},
						}),
					);

					logger.info({ userId, organizationId, deprovisionAction }, "SCIM user deprovisioned");
				} catch (error) {
					logger.error({ error, userId }, "SCIM user deprovisioning failed");

					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: "error",
							userId,
							metadata: {
								errorCode: "DEPROVISIONING_FAILED",
								errorMessage: error instanceof Error ? error.message : "Unknown error",
							},
						}),
					);

					throw error;
				}
			}),

		onUserReactivated: ({ userId, organizationId }) =>
			Effect.gen(function* () {
				try {
					// Find the employee record
					const employeeRecord = yield* Effect.tryPromise(() =>
						db.query.employee.findFirst({
							where: (emp, { eq: eqOp, and: andOp }) =>
								andOp(eqOp(emp.userId, userId), eqOp(emp.organizationId, organizationId)),
						}),
					);

					if (employeeRecord) {
						// Parallelize independent updates for better performance
						// @see async-parallel rule
						yield* Effect.all([
							// Reactivate employee
							Effect.tryPromise(() =>
								db.update(employee).set({ isActive: true }).where(eq(employee.id, employeeRecord.id)),
							),
							// Also update member status if suspended
							Effect.tryPromise(() =>
								db
									.update(schema.member)
									.set({ status: "approved" })
									.where(
										and(
											eq(schema.member.userId, userId),
											eq(schema.member.organizationId, organizationId),
										),
									),
							),
						]);
					}

					// Log the reactivation event
					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: "user_reactivated",
							userId,
							metadata: {},
						}),
					);

					logger.info({ userId, organizationId }, "SCIM user reactivated");
				} catch (error) {
					logger.error({ error, userId }, "SCIM user reactivation failed");
					throw error;
				}
			}),

		onGroupMembershipChanged: ({ userId, organizationId, groupId, action }) =>
			Effect.gen(function* () {
				try {
					if (action === "added") {
						// Parallelize: fetch mapping and employee record concurrently
						// @see async-parallel rule
						const [mappingResult, employeeRecord] = yield* Effect.all([
							// Use cached query for IdP group mapping lookup
							Effect.tryPromise(() =>
								findRoleTemplateMappingForGroup(organizationId, "scim", groupId),
							),
							// Fetch employee record in parallel
							Effect.tryPromise(() =>
								db.query.employee.findFirst({
									where: (emp, { eq: eqOp, and: andOp }) =>
										andOp(eqOp(emp.userId, userId), eqOp(emp.organizationId, organizationId)),
								}),
							),
						]);

						// The mapping includes the roleTemplate via relation
						const mapping = mappingResult;
						const template = mapping?.roleTemplate;

						if (template && employeeRecord) {
							yield* applyRoleTemplateToEmployee(employeeRecord, template, organizationId);

							// Record template assignment
							yield* Effect.tryPromise(() =>
								db
									.insert(userRoleTemplateAssignment)
									.values({
										userId,
										organizationId,
										roleTemplateId: template.id,
										assignmentSource: "scim",
										idpGroupId: groupId,
									})
									.onConflictDoUpdate({
										target: [
											userRoleTemplateAssignment.userId,
											userRoleTemplateAssignment.organizationId,
										],
										set: {
											roleTemplateId: template.id,
											assignmentSource: "scim",
											idpGroupId: groupId,
											assignedAt: new Date(),
										},
									}),
							);

							// Log lifecycle event for role change
							yield* Effect.tryPromise(() =>
								db.insert(userLifecycleEvent).values({
									userId,
									organizationId,
									eventType: "move",
									source: "scim",
									createdBy: userId,
									metadata: {
										toTemplateId: template.id,
										notes: `Applied via IdP group: ${groupId}`,
									},
								}),
							);
						}
					}

					// Log group membership change
					yield* Effect.tryPromise(() =>
						db.insert(scimProvisioningLog).values({
							organizationId,
							eventType: action === "added" ? "group_member_added" : "group_member_removed",
							userId,
							metadata: {
								scimGroupId: groupId,
							},
						}),
					);

					logger.info({ userId, organizationId, groupId, action }, "SCIM group membership changed");
				} catch (error) {
					logger.error({ error, userId, groupId, action }, "SCIM group membership change failed");
					throw error;
				}
			}),

		applyRoleTemplate: ({ userId, organizationId, roleTemplateId, source, idpGroupId }) =>
			Effect.gen(function* () {
				// Use cached query for role template lookup
				const template = yield* Effect.tryPromise(() =>
					getRoleTemplateById(roleTemplateId),
				);

				if (!template) {
					throw new Error(`Role template ${roleTemplateId} not found`);
				}

				const employeeRecord = yield* Effect.tryPromise(() =>
					db.query.employee.findFirst({
						where: (emp, { eq: eqOp, and: andOp }) =>
							andOp(eqOp(emp.userId, userId), eqOp(emp.organizationId, organizationId)),
					}),
				);

				if (!employeeRecord) {
					throw new Error(`Employee record not found for user ${userId} in org ${organizationId}`);
				}

				yield* applyRoleTemplateToEmployee(employeeRecord, template, organizationId);

				// Record template assignment
				yield* Effect.tryPromise(() =>
					db
						.insert(userRoleTemplateAssignment)
						.values({
							userId,
							organizationId,
							roleTemplateId: template.id,
							assignmentSource: source,
							idpGroupId,
						})
						.onConflictDoUpdate({
							target: [userRoleTemplateAssignment.userId, userRoleTemplateAssignment.organizationId],
							set: {
								roleTemplateId: template.id,
								assignmentSource: source,
								idpGroupId,
								assignedAt: new Date(),
							},
						}),
				);

				logger.info({ userId, organizationId, roleTemplateId, source }, "Role template applied");
			}),
	}),
);

/**
 * Helper function to apply role template permissions to an employee
 */
function applyRoleTemplateToEmployee(
	employeeRecord: typeof employee.$inferSelect,
	template: typeof roleTemplate.$inferSelect,
	organizationId: string,
): Effect.Effect<void, Error> {
	return Effect.gen(function* () {
		// Update employee role
		yield* Effect.tryPromise(() =>
			db
				.update(employee)
				.set({
					role: template.employeeRole,
				})
				.where(eq(employee.id, employeeRecord.id)),
		);

		// Update user app access permissions
		yield* Effect.tryPromise(() =>
			db
				.update(schema.user)
				.set({
					canUseWebapp: template.canUseWebapp,
					canUseDesktop: template.canUseDesktop,
					canUseMobile: template.canUseMobile,
				})
				.where(eq(schema.user.id, employeeRecord.userId)),
		);

		// Apply team permissions if specified in template
		if (template.teamPermissions) {
			const permissions = template.teamPermissions as {
				canCreateTeams?: boolean;
				canManageTeamMembers?: boolean;
				canManageTeamSettings?: boolean;
				canApproveTeamRequests?: boolean;
			};

			// Upsert team permissions (organization-wide)
			const existingPermission = yield* Effect.tryPromise(() =>
				db.query.teamPermissions.findFirst({
					where: (tp, { eq: eqOp, and: andOp, isNull }) =>
						andOp(
							eqOp(tp.employeeId, employeeRecord.id),
							eqOp(tp.organizationId, organizationId),
							isNull(tp.teamId),
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
						teamId: null, // organization-wide
						canCreateTeams: permissions.canCreateTeams ?? false,
						canManageTeamMembers: permissions.canManageTeamMembers ?? false,
						canManageTeamSettings: permissions.canManageTeamSettings ?? false,
						canApproveTeamRequests: permissions.canApproveTeamRequests ?? false,
						grantedBy: employeeRecord.id, // Self-granted via template
					}),
				);
			}
		}

		// Assign to default team if specified
		if (template.defaultTeamId) {
			logger.info(
				{ employeeId: employeeRecord.id, teamId: template.defaultTeamId },
				"Default team assignment from role template (implementation pending)",
			);
		}
	});
}
