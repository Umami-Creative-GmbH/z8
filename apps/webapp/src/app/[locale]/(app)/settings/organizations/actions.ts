"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { auth } from "@/lib/auth";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import {
	type InvitationData,
	invitationSchema,
	type UpdateMemberRoleData,
	type UpdateOrganizationData,
	updateMemberRoleSchema,
	updateOrganizationSchema,
} from "@/lib/validations/invitation";

const logger = createLogger("OrganizationActions");

// =============================================================================
// Invitation Management Actions
// =============================================================================

/**
 * Send an invitation to join the organization
 * Requires admin or owner role
 */
export async function sendInvitation(
	data: InvitationData & {
		organizationId: string;
	},
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"sendInvitation",
		{
			attributes: {
				"organization.id": data.organizationId,
				"invitation.email": data.email,
				"invitation.role": data.role,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get current user's member record to check role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, data.organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify admin/owner role
				if (memberRecord.role !== "admin" && memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can send invitations",
								userId: session.user.id,
								resource: "invitation",
								action: "create",
							}),
						),
					);
				}

				span.setAttribute("currentMember.role", memberRecord.role);

				// Validate input
				const validationResult = invitationSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Check for existing pending invitation
				const existingInvitation = yield* _(
					dbService.query("checkExistingInvitation", async () => {
						return await db.query.invitation.findFirst({
							where: and(
								eq(authSchema.invitation.organizationId, data.organizationId),
								eq(authSchema.invitation.email, validatedData.email),
								eq(authSchema.invitation.status, "pending"),
							),
						});
					}),
				);

				if (existingInvitation) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "An invitation for this email is already pending",
								field: "email",
								value: validatedData.email,
							}),
						),
					);
				}

				// Check if user is already a member
				const existingUser = yield* _(
					dbService.query("checkExistingUser", async () => {
						return await db.query.user.findFirst({
							where: eq(authSchema.user.email, validatedData.email),
						});
					}),
				);

				if (existingUser) {
					const existingMember = yield* _(
						dbService.query("checkExistingMember", async () => {
							return await db.query.member.findFirst({
								where: and(
									eq(authSchema.member.userId, existingUser.id),
									eq(authSchema.member.organizationId, data.organizationId),
								),
							});
						}),
					);

					if (existingMember) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "This user is already a member of the organization",
									field: "email",
									value: validatedData.email,
								}),
							),
						);
					}
				}

				// Use Better Auth organization.createInvitation API
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.createInvitation({
								body: {
									organizationId: data.organizationId,
									email: validatedData!.email,
									role: validatedData!.role,
								},
								headers: await headers(),
							});

							// Update invitation record with canCreateOrganizations flag if specified
							if (validatedData!.canCreateOrganizations) {
								const newInvitation = await db.query.invitation.findFirst({
									where: and(
										eq(authSchema.invitation.email, validatedData!.email),
										eq(authSchema.invitation.organizationId, data.organizationId),
										eq(authSchema.invitation.status, "pending"),
									),
									orderBy: (invitation, { desc }) => [desc(invitation.createdAt)],
								});

								if (newInvitation) {
									await db
										.update(authSchema.invitation)
										.set({ canCreateOrganizations: true })
										.where(eq(authSchema.invitation.id, newInvitation.id));
								}
							}
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to send invitation",
								field: "invitation",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId: data.organizationId,
						email: validatedData!.email,
						role: validatedData!.role,
					},
					"Invitation sent successfully",
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
						logger.error({ error }, "Failed to send invitation");
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
 * Cancel a pending invitation
 * Requires admin or owner role
 */
export async function cancelInvitation(invitationId: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"cancelInvitation",
		{
			attributes: {
				"invitation.id": invitationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Get invitation to check organization
				const invitation = yield* _(
					dbService.query("getInvitation", async () => {
						return await db.query.invitation.findFirst({
							where: eq(authSchema.invitation.id, invitationId),
						});
					}),
					Effect.flatMap((inv) =>
						inv
							? Effect.succeed(inv)
							: Effect.fail(
									new NotFoundError({
										message: "Invitation not found",
										entityType: "invitation",
										entityId: invitationId,
									}),
								),
					),
				);

				// Check user's role in the organization
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, invitation.organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify admin/owner role
				if (memberRecord.role !== "admin" && memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can cancel invitations",
								userId: session.user.id,
								resource: "invitation",
								action: "delete",
							}),
						),
					);
				}

				// Use Better Auth organization.cancelInvitation API
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.cancelInvitation({
								body: {
									invitationId,
								},
								headers: await headers(),
							});
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to cancel invitation",
								field: "invitation",
							});
						},
					}),
				);

				logger.info(
					{
						invitationId,
						organizationId: invitation.organizationId,
					},
					"Invitation cancelled successfully",
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
						logger.error({ error, invitationId }, "Failed to cancel invitation");
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

// =============================================================================
// Member Management Actions
// =============================================================================

/**
 * Remove a member from the organization
 * Requires owner role
 */
export async function removeMember(
	organizationId: string,
	userId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"removeMember",
		{
			attributes: {
				"organization.id": organizationId,
				"user.id": userId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Check current user's role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify owner role (only owners can remove members)
				if (memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only owners can remove members",
								userId: session.user.id,
								resource: "member",
								action: "delete",
							}),
						),
					);
				}

				// Prevent removing self
				if (userId === session.user.id) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "You cannot remove yourself from the organization",
								field: "userId",
								value: userId,
							}),
						),
					);
				}

				// Use Better Auth organization.removeMember API
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.removeMember({
								body: {
									organizationId,
									memberIdOrEmail: userId,
								},
								headers: await headers(),
							});
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to remove member",
								field: "member",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						userId,
					},
					"Member removed successfully",
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
						logger.error({ error, organizationId, userId }, "Failed to remove member");
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
 * Update a member's role in the organization
 * Requires owner role
 */
export async function updateMemberRole(
	organizationId: string,
	userId: string,
	data: UpdateMemberRoleData,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateMemberRole",
		{
			attributes: {
				"organization.id": organizationId,
				"user.id": userId,
				role: data.role,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Check current user's role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify owner role (only owners can change roles)
				if (memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only owners can change member roles",
								userId: session.user.id,
								resource: "member",
								action: "update",
							}),
						),
					);
				}

				// Validate input
				const validationResult = updateMemberRoleSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data;

				// Use Better Auth organization.updateMemberRole API
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.updateMemberRole({
								body: {
									organizationId,
									memberId: userId,
									role: validatedData.role,
								},
								headers: await headers(),
							});
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to update member role",
								field: "role",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						userId,
						newRole: validatedData.role,
					},
					"Member role updated successfully",
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
						logger.error({ error, organizationId, userId }, "Failed to update member role");
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

// =============================================================================
// Organization Management Actions
// =============================================================================

/**
 * Update organization details
 * Requires owner role
 */
export async function updateOrganizationDetails(
	organizationId: string,
	data: UpdateOrganizationData,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateOrganizationDetails",
		{
			attributes: {
				"organization.id": organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Check current user's role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify owner role (only owners can update organization details)
				if (memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only owners can update organization details",
								userId: session.user.id,
								resource: "organization",
								action: "update",
							}),
						),
					);
				}

				// Validate input
				const validationResult = updateOrganizationSchema.safeParse(data);
				if (!validationResult.success) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const validatedData = validationResult.data!;

				// Build the update data object, only including defined fields
				const updateData: {
					name?: string;
					slug?: string;
					metadata?: Record<string, unknown>;
				} = {};
				if (validatedData.name !== undefined) updateData.name = validatedData.name;
				if (validatedData.slug !== undefined) updateData.slug = validatedData.slug;
				if (validatedData.metadata !== undefined) {
					try {
						updateData.metadata = JSON.parse(validatedData.metadata) as Record<string, unknown>;
					} catch {
						// If metadata is not valid JSON, skip it
					}
				}

				// Use Better Auth organization.updateOrganization API
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.updateOrganization({
								body: {
									organizationId,
									data: updateData,
								},
								headers: await headers(),
							});
						},
						catch: (error) => {
							return new ValidationError({
								message: error instanceof Error ? error.message : "Failed to update organization",
								field: "organization",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						updates: validatedData,
					},
					"Organization updated successfully",
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
						logger.error({ error, organizationId }, "Failed to update organization");
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

// =============================================================================
// Organization Features Actions
// =============================================================================

/**
 * Toggle organization features (e.g., shift scheduling)
 * Requires owner role
 */
export async function toggleOrganizationFeature(
	organizationId: string,
	feature: "shiftsEnabled" | "projectsEnabled" | "surchargesEnabled",
	enabled: boolean,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"toggleOrganizationFeature",
		{
			attributes: {
				"organization.id": organizationId,
				feature,
				enabled,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Check current user's role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify owner role (only owners can toggle features)
				if (memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only owners can change organization features",
								userId: session.user.id,
								resource: "organization",
								action: "update",
							}),
						),
					);
				}

				// Update the organization feature directly
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.update(authSchema.organization)
								.set({ [feature]: enabled })
								.where(eq(authSchema.organization.id, organizationId));
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error ? error.message : "Failed to update organization feature",
								field: feature,
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						feature,
						enabled,
					},
					`Organization feature ${feature} ${enabled ? "enabled" : "disabled"}`,
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
							{ error, organizationId, feature },
							"Failed to toggle organization feature",
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
 * Update organization timezone
 * Requires owner role
 */
export async function updateOrganizationTimezone(
	organizationId: string,
	timezone: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateOrganizationTimezone",
		{
			attributes: {
				"organization.id": organizationId,
				timezone,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Check current user's role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify owner role (only owners can update timezone)
				if (memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only owners can change organization timezone",
								userId: session.user.id,
								resource: "organization",
								action: "update",
							}),
						),
					);
				}

				// Update the organization timezone
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.update(authSchema.organization)
								.set({ timezone })
								.where(eq(authSchema.organization.id, organizationId));
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error ? error.message : "Failed to update organization timezone",
								field: "timezone",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						timezone,
					},
					`Organization timezone updated to ${timezone}`,
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
						logger.error({ error, organizationId, timezone }, "Failed to update organization timezone");
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

// =============================================================================
// Employee Management Actions
// =============================================================================

/**
 * Toggle employee active status (activate/deactivate)
 * Requires admin or owner role
 */
export async function toggleEmployeeStatus(
	organizationId: string,
	employeeId: string,
	isActive: boolean,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"toggleEmployeeStatus",
		{
			attributes: {
				"organization.id": organizationId,
				"employee.id": employeeId,
				"employee.isActive": isActive,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				// Check current user's role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				// Verify admin/owner role
				if (memberRecord.role !== "admin" && memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can change employee status",
								userId: session.user.id,
								resource: "employee",
								action: "update",
							}),
						),
					);
				}

				// Get the employee record
				const employeeRecord = yield* _(
					dbService.query("getEmployee", async () => {
						return await db.query.employee.findFirst({
							where: and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)),
						});
					}),
					Effect.flatMap((emp) =>
						emp
							? Effect.succeed(emp)
							: Effect.fail(
									new NotFoundError({
										message: "Employee not found",
										entityType: "employee",
										entityId: employeeId,
									}),
								),
					),
				);

				// Prevent deactivating yourself
				if (employeeRecord.userId === session.user.id && !isActive) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "You cannot deactivate yourself",
								field: "employeeId",
								value: employeeId,
							}),
						),
					);
				}

				// Update the employee status
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.update(employee).set({ isActive }).where(eq(employee.id, employeeId));
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error ? error.message : "Failed to update employee status",
								field: "employee",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						employeeId,
						isActive,
					},
					`Employee ${isActive ? "activated" : "deactivated"} successfully`,
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
						logger.error({ error, organizationId, employeeId }, "Failed to toggle employee status");
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
