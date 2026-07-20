"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import {
	employeeInvitationDraft,
	organizationNotificationSettings,
	team,
} from "@/db/schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import {
	isInvitationActionable,
	normalizeInvitationEmail,
	persistEmployeeInvitationDraft,
	syncInvitationTargetTeam,
} from "@/lib/auth/employee-invitation-draft";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
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
import { assertEnterpriseIdentityInvitationAllowed } from "@/lib/enterprise-identity/enforcement";
import { createLogger } from "@/lib/logger";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import {
	type InvitationData,
	invitationSchema,
	type UpdateMemberRoleData,
	type UpdateOrganizationData,
	updateMemberRoleSchema,
	updateOrganizationSchema,
} from "@/lib/validations/invitation";
import { requestOrganizationWorkBalanceFullRebuild } from "@/lib/work-balance/service";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import { isOrganizationFeature } from "./organization-features";

const logger = createLogger("OrganizationActions");

const updateInvitationTargetTeamSchema = z.object({
	invitationId: z.string().min(1),
	organizationId: z.string().min(1),
	targetTeamId: z
		.uuid({ message: "Invalid target team" })
		.nullable()
		.optional(),
});

type UpdateInvitationTargetTeamData = z.infer<
	typeof updateInvitationTargetTeamSchema
>;

type MemberWithUser = typeof authSchema.member.$inferSelect & {
	user: Pick<typeof authSchema.user.$inferSelect, "name" | "email"> | null;
};

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
	let authoritativeInvitationId: string | undefined;
	let failurePhase = "precondition";

	const effect = tracer.startActiveSpan(
		"sendInvitation",
		{
			attributes: {
				"organization.id": data.organizationId,
				"invitation.role": data.role,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const normalizedEmail = normalizeInvitationEmail(data.email);
				const now = systemClock.nowInstant();
				const databaseNow = dateFromInstant(now);
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId: data.organizationId,
						requiredRole: "admin",
						message: "Only admins and owners can send invitations",
						resource: "invitation",
						action: "create",
					}),
				);

				// Validate input
				const validationResult = invitationSchema.safeParse({
					...data,
					email: normalizedEmail,
				});
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
				if (validatedData.targetTeamId) {
					const targetTeamId = validatedData.targetTeamId;
					const targetTeam = yield* _(
						dbService.query("getInvitationTargetTeam", async () => {
							return await db.query.team.findFirst({
								where: and(
									eq(team.id, targetTeamId),
									eq(team.organizationId, data.organizationId),
								),
							});
						}),
					);

					if (!targetTeam) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Target team not found in this organization",
									field: "targetTeamId",
									value: validatedData.targetTeamId,
								}),
							),
						);
					}
				}

				yield* _(
					Effect.tryPromise({
						try: async () => {
							await assertEnterpriseIdentityInvitationAllowed({
								organizationId: data.organizationId,
								email: validatedData.email,
							});
						},
						catch: (error) =>
							new ValidationError({
								message:
									error instanceof Error
										? error.message
										: "Invitation is not allowed",
								field: "email",
								value: validatedData.email,
							}),
					}),
				);

				// Check for existing pending invitation
				const existingInvitation = yield* _(
					dbService.query("checkExistingInvitation", async () => {
						return await db.query.invitation.findFirst({
							where: and(
								eq(authSchema.invitation.organizationId, data.organizationId),
								eq(authSchema.invitation.email, validatedData.email),
								eq(authSchema.invitation.status, "pending"),
								gt(authSchema.invitation.expiresAt, databaseNow),
							),
						});
					}),
				);

				if (
					existingInvitation?.organizationId === data.organizationId &&
					isInvitationActionable(existingInvitation, now)
				) {
					authoritativeInvitationId = existingInvitation.id;
					failurePhase = "persistInvitationState";
					const persistence = yield* _(
						Effect.tryPromise({
							try: () =>
								persistEmployeeInvitationDraft(db, {
									organizationId: data.organizationId,
									normalizedEmail,
									invitationId: existingInvitation.id,
									canCreateOrganizations:
										validatedData.canCreateOrganizations ?? false,
									targetTeamId: validatedData.targetTeamId ?? null,
									initialRole:
										validatedData.role === "admin" ||
										validatedData.role === "owner"
											? "admin"
											: "employee",
									updatedBy: session.user.id,
								}),
							catch: () =>
								new ValidationError({
									message: "Failed to send invitation",
									field: "invitation",
								}),
						}),
					);
					if (persistence.outcome === "consumed") {
						span.setStatus({ code: SpanStatusCode.OK });
						return;
					}
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

				// Better Auth may deliver email before app persistence. The actionable-invite
				// branch above is the idempotent repair boundary for a failed persistence step.
				failurePhase = "createInvitation";
				yield* _(
					Effect.tryPromise({
						try: async () => {
							const newInvitation = await auth.api.createInvitation({
								body: {
									organizationId: data.organizationId,
									email: validatedData.email,
									role: validatedData.role,
									resend: false,
								},
								headers: await headers(),
							});
							authoritativeInvitationId = newInvitation.id;
							failurePhase = "persistInvitationState";
							await persistEmployeeInvitationDraft(db, {
								organizationId: data.organizationId,
								normalizedEmail,
								invitationId: newInvitation.id,
								canCreateOrganizations:
									validatedData.canCreateOrganizations ?? false,
								targetTeamId: validatedData.targetTeamId ?? null,
								initialRole:
									validatedData.role === "admin" ||
									validatedData.role === "owner"
										? "admin"
										: "employee",
								updatedBy: session.user.id,
							});
						},
						catch: () => {
							return new ValidationError({
								message: "Failed to send invitation",
								field: "invitation",
							});
						},
					}),
				);
				logger.info(
					{
						organizationId: data.organizationId,
						role: validatedData.role,
					},
					"Invitation sent successfully",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(new Error("Invitation send failed"));
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: "Invitation send failed",
						});
						logger.error(
							{
								operation: "sendInvitation",
								failurePhase,
								organizationId: data.organizationId,
								...(authoritativeInvitationId
									? { invitationId: authoritativeInvitationId }
									: {}),
							},
							"Failed to send invitation",
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

export async function resendInvitation(
	organizationId: string,
	invitationId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");
	let authoritativeInvitationId = invitationId;
	let failurePhase = "precondition";

	const effect = tracer.startActiveSpan(
		"resendInvitation",
		{
			attributes: {
				"organization.id": organizationId,
				"invitation.id": invitationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "admin",
						message: "Only admins and owners can resend invitations",
						resource: "invitation",
						action: "create",
					}),
				);

				const invitation = yield* _(
					dbService.query("getInvitationForResend", async () => {
						return await db.query.invitation.findFirst({
							where: and(
								eq(authSchema.invitation.id, invitationId),
								eq(authSchema.invitation.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((record) =>
						record
							? Effect.succeed(record)
							: Effect.fail(
									new NotFoundError({
										message: "Invitation not found",
										entityType: "invitation",
										entityId: invitationId,
									}),
								),
					),
				);

				const normalizedEmail = normalizeInvitationEmail(invitation.email);
				const stableDraft = yield* _(
					dbService.query("getCurrentEmployeeInvitationDraft", async () => {
						return await db.query.employeeInvitationDraft.findFirst({
							where: and(
								eq(employeeInvitationDraft.organizationId, organizationId),
								eq(employeeInvitationDraft.normalizedEmail, normalizedEmail),
							),
						});
					}),
				);

				if (
					invitation.status !== "pending" ||
					stableDraft?.invitationId !== invitationId
				) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Invitation cannot be resent",
								field: "invitation",
							}),
						),
					);
				}

				if (
					invitation.role !== "member" &&
					invitation.role !== "admin" &&
					invitation.role !== "owner"
				) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Invitation cannot be resent",
								field: "invitation",
							}),
						),
					);
				}

				const invitationRole = invitation.role;
				failurePhase = "createInvitation";
				const resentInvitation = yield* _(
					Effect.tryPromise({
						try: async () =>
							await auth.api.createInvitation({
								body: {
									organizationId,
									email: normalizedEmail,
									role: invitationRole,
									resend: true,
								},
								headers: await headers(),
							}),
						catch: () =>
							new ValidationError({
								message: "Failed to resend invitation",
								field: "invitation",
							}),
					}),
				);

				authoritativeInvitationId = resentInvitation.id;
				failurePhase = "persistInvitationState";
				yield* _(
					Effect.promise(async () => {
						try {
							await persistEmployeeInvitationDraft(db, {
								organizationId,
								normalizedEmail,
								invitationId: resentInvitation.id,
								canCreateOrganizations:
									invitation.canCreateOrganizations ?? false,
								targetTeamId: invitation.targetTeamId,
								initialRole:
									invitationRole === "admin" || invitationRole === "owner"
										? "admin"
										: "employee",
								updatedBy: session.user.id,
							});
						} catch {
							// Better Auth has already delivered the email. Reporting failure here
							// would invite a retry and duplicate delivery; acceptance can recover
							// prepared fields from the stable identity-scoped draft.
							logger.warn(
								{
									operation: "repairResentInvitationPersistence",
									organizationId,
									invitationId: resentInvitation.id,
								},
								"Resent invitation requires app-state repair",
							);
						}
					}),
				);

				logger.info(
					{ organizationId, invitationId },
					"Invitation resent successfully",
				);
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(new Error("Invitation resend failed"));
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: "Invitation resend failed",
						});
						logger.error(
							{
								operation: "resendInvitation",
								failurePhase,
								organizationId,
								invitationId: authoritativeInvitationId,
							},
							"Failed to resend invitation",
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

export async function updateInvitationTargetTeam(
	data: UpdateInvitationTargetTeamData,
): Promise<ServerActionResult<void>> {
	const validationResult = updateInvitationTargetTeamSchema.safeParse(data);
	if (!validationResult.success) {
		const issue = validationResult.error.issues[0];
		return {
			success: false,
			error: issue?.message || "Invalid input",
			code: "ValidationError",
		};
	}

	const validatedData = validationResult.data;
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateInvitationTargetTeam",
		{
			attributes: {
				"invitation.id": validatedData.invitationId,
				"organization.id": validatedData.organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId: validatedData.organizationId,
						requiredRole: "admin",
						message: "Only admins and owners can update invitations",
						resource: "invitation",
						action: "update",
					}),
				);

				const invitation = yield* _(
					dbService.query("getPendingInvitation", async () => {
						return await db.query.invitation.findFirst({
							where: and(
								eq(authSchema.invitation.id, validatedData.invitationId),
								eq(
									authSchema.invitation.organizationId,
									validatedData.organizationId,
								),
								eq(authSchema.invitation.status, "pending"),
							),
						});
					}),
					Effect.flatMap((invitationRecord) =>
						invitationRecord
							? Effect.succeed(invitationRecord)
							: Effect.fail(
									new NotFoundError({
										message: "Invitation not found",
										entityType: "invitation",
										entityId: validatedData.invitationId,
									}),
								),
					),
				);

				if (validatedData.targetTeamId) {
					const targetTeamId = validatedData.targetTeamId;
					const targetTeam = yield* _(
						dbService.query("getInvitationTargetTeam", async () => {
							return await db.query.team.findFirst({
								where: and(
									eq(team.id, targetTeamId),
									eq(team.organizationId, invitation.organizationId),
								),
							});
						}),
					);

					if (!targetTeam) {
						yield* _(
							Effect.fail(
								new ValidationError({
									message: "Target team not found in this organization",
									field: "targetTeamId",
									value: validatedData.targetTeamId,
								}),
							),
						);
					}
				}

				yield* _(
					Effect.tryPromise({
						try: () =>
							syncInvitationTargetTeam(db, {
								organizationId: invitation.organizationId,
								invitationId: invitation.id,
								email: invitation.email,
								targetTeamId: validatedData.targetTeamId ?? null,
							}),
						catch: () =>
							new ValidationError({
								message: "Failed to update invitation",
								field: "invitation",
							}),
					}),
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
						logger.error({ error }, "Failed to update invitation target team");
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
export async function cancelInvitation(
	invitationId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");
	let authoritativeOrganizationId: string | undefined;

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
				authoritativeOrganizationId = invitation.organizationId;
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId: invitation.organizationId,
						requiredRole: "admin",
						message: "Only admins and owners can cancel invitations",
						resource: "invitation",
						action: "delete",
					}),
				);

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
						catch: () => {
							return new ValidationError({
								message: "Failed to cancel invitation",
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
						span.recordException(new Error("Invitation cancellation failed"));
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: "Invitation cancellation failed",
						});
						logger.error(
							{
								operation: "cancelInvitation",
								invitationId,
								...(authoritativeOrganizationId
									? { organizationId: authoritativeOrganizationId }
									: {}),
							},
							"Failed to cancel invitation",
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

// =============================================================================
// Member Management Actions
// =============================================================================

/**
 * Update a member's role in the organization
 * Requires owner role
 */
export async function updateMemberRole(
	organizationId: string,
	memberId: string,
	data: UpdateMemberRoleData,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateMemberRole",
		{
			attributes: {
				"organization.id": organizationId,
				"member.id": memberId,
				role: data.role,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "owner",
						message: "Only owners can change member roles",
						resource: "member",
						action: "update",
					}),
				);

				// Validate input
				const validationResult = updateMemberRoleSchema.safeParse(data);
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
				const targetMember = yield* _(
					dbService.query("getTargetMemberForRoleUpdate", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.id, memberId),
								eq(authSchema.member.organizationId, organizationId),
								eq(authSchema.member.status, "approved"),
							),
							columns: { id: true, userId: true, status: true },
						});
					}),
				);

				if (targetMember?.status !== "approved") {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Member not found",
								entityType: "member",
								entityId: memberId,
							}),
						),
					);
				}

				if (targetMember.userId === session.user.id) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "You cannot change your own organization role",
								field: "memberId",
								value: memberId,
							}),
						),
					);
				}

				// Use Better Auth organization.updateMemberRole API
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await auth.api.updateMemberRole({
								body: {
									organizationId,
									memberId,
									role: validatedData.role,
								},
								headers: await headers(),
							});
						},
						catch: () => {
							return new ValidationError({
								message: "Failed to update member role",
								field: "role",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						memberId,
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
						logger.error(
							{ error, organizationId, memberId },
							"Failed to update member role",
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
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "owner",
						message: "Only owners can update organization details",
						resource: "organization",
						action: "update",
					}),
				);

				// Validate input
				const validationResult = updateOrganizationSchema.safeParse(data);
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

				// Build the update data object, only including defined fields
				const updateData: {
					name?: string;
					slug?: string;
					metadata?: Record<string, unknown>;
				} = {};
				if (validatedData.name !== undefined)
					updateData.name = validatedData.name;
				if (validatedData.slug !== undefined)
					updateData.slug = validatedData.slug;
				if (validatedData.metadata !== undefined) {
					try {
						updateData.metadata = JSON.parse(validatedData.metadata) as Record<
							string,
							unknown
						>;
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
								message:
									error instanceof Error
										? error.message
										: "Failed to update organization",
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
						logger.error(
							{ error, organizationId },
							"Failed to update organization",
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
 * Clear organization logo
 * Requires owner role. Does not delete the underlying storage object.
 */
export async function removeOrganizationLogo(
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"removeOrganizationLogo",
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
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "owner",
						message: "Only owners can update organization details",
						resource: "organization",
						action: "update",
					}),
				);

				yield* _(
					dbService.query("removeOrganizationLogo", async () => {
						await db
							.update(authSchema.organization)
							.set({ logo: null })
							.where(eq(authSchema.organization.id, organizationId));
					}),
				);

				logger.info(
					{ organizationId },
					"Organization logo removed successfully",
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
							{ error, organizationId },
							"Failed to remove organization logo",
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

// =============================================================================
// Organization Features Actions
// =============================================================================

/**
 * Toggle organization features (e.g., shift scheduling)
 * Requires owner role
 */
export async function toggleOrganizationFeature(
	organizationId: string,
	feature: string,
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
				if (!isOrganizationFeature(feature)) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Invalid organization feature",
								field: "feature",
								value: feature,
							}),
						),
					);
				}

				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "owner",
						message: "Only owners can change organization features",
						resource: "organization",
						action: "update",
					}),
				);

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
									error instanceof Error
										? error.message
										: "Failed to update organization feature",
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
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "owner",
						message: "Only owners can change organization timezone",
						resource: "organization",
						action: "update",
					}),
				);

				if (!isValidIanaTimeZone(timezone)) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Timezone must be a valid timezone",
								field: "timezone",
								value: timezone,
							}),
						),
					);
				}

				// Update the organization timezone
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db.transaction(async (tx) => {
								await tx
									.update(authSchema.organization)
									.set({ timezone })
									.where(eq(authSchema.organization.id, organizationId));
								await requestOrganizationWorkBalanceFullRebuild(
									{ organizationId },
									{ dbClient: tx },
								);
							});
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error
										? error.message
										: "Failed to update organization timezone",
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
						logger.error(
							{ error, organizationId, timezone },
							"Failed to update organization timezone",
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
 * Update organization default notification language
 * Requires admin or owner role
 */
export async function updateOrganizationDefaultNotificationLanguage(
	organizationId: string,
	defaultLanguage: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateOrganizationDefaultNotificationLanguage",
		{
			attributes: {
				"organization.id": organizationId,
				defaultLanguage,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				if (!ALL_LANGUAGES.includes(defaultLanguage)) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Unsupported language",
								field: "defaultLanguage",
								value: defaultLanguage,
							}),
						),
					);
				}

				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());

				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "admin",
						message:
							"Only admins and owners can change organization notification language",
						resource: "organization",
						action: "update",
					}),
				);

				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.insert(organizationNotificationSettings)
								.values({ organizationId, defaultLanguage })
								.onConflictDoUpdate({
									target: organizationNotificationSettings.organizationId,
									set: { defaultLanguage },
								});
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error
										? error.message
										: "Failed to update organization notification language",
								field: "defaultLanguage",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						defaultLanguage,
					},
					`Organization notification language updated to ${defaultLanguage}`,
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
							{ error, organizationId, defaultLanguage },
							"Failed to update organization notification language",
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

// =============================================================================
// Organization Deletion Actions (Soft Delete with 5-Day Recovery)
// =============================================================================

/**
 * Soft delete an organization (mark for deletion with 5-day recovery window)
 * Requires admin or owner role
 * Sends email notification to all organization admins/owners
 */
export async function deleteOrganization(
	organizationId: string,
	confirmationName: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"deleteOrganization",
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
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "admin",
						message: "Only owners and admins can delete an organization",
						resource: "organization",
						action: "delete",
					}),
				);

				// Get organization details
				const organization = yield* _(
					dbService.query("getOrganization", async () => {
						return await db.query.organization.findFirst({
							where: eq(authSchema.organization.id, organizationId),
						});
					}),
					Effect.flatMap((org) =>
						org
							? Effect.succeed(org)
							: Effect.fail(
									new NotFoundError({
										message: "Organization not found",
										entityType: "organization",
										entityId: organizationId,
									}),
								),
					),
				);

				// Check if already deleted
				if (organization.deletedAt) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Organization is already scheduled for deletion",
								field: "organization",
							}),
						),
					);
				}

				// Verify confirmation name matches
				if (confirmationName !== organization.name) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message:
									"Organization name does not match. Please type the exact organization name to confirm deletion.",
								field: "confirmationName",
								value: confirmationName,
							}),
						),
					);
				}

				const deletionDate = new Date();

				// Soft delete: Set deletedAt and deletedBy
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.update(authSchema.organization)
								.set({
									deletedAt: deletionDate,
									deletedBy: session.user.id,
								})
								.where(eq(authSchema.organization.id, organizationId));
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error
										? error.message
										: "Failed to schedule organization for deletion",
								field: "organization",
							});
						},
					}),
				);

				// Send notification emails to all admins and owners
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await sendOrganizationDeletionNotifications(
								organizationId,
								organization.name,
								session.user.name || session.user.email,
								deletionDate,
							);
						},
						catch: (error) => {
							// Log but don't fail the action if email sending fails
							logger.warn(
								{ error, organizationId },
								"Failed to send deletion notification emails",
							);
						},
					}),
				);

				logger.info(
					{
						organizationId,
						organizationName: organization.name,
						deletedBy: session.user.id,
						deletionDate,
					},
					"Organization scheduled for deletion (5-day recovery window)",
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as unknown as Error);
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: String(error),
						});
						logger.error(
							{ error, organizationId },
							"Failed to delete organization",
						);
						return yield* _(Effect.fail(error as unknown as AnyAppError));
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
 * Recover a soft-deleted organization (cancel deletion)
 * Requires admin or owner role
 */
export async function recoverOrganization(
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"recoverOrganization",
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
				yield* _(
					requireActiveOrganizationActionActor({
						userId: session.user.id,
						organizationId,
						requiredRole: "admin",
						message: "Only owners and admins can recover an organization",
						resource: "organization",
						action: "update",
					}),
				);

				// Get organization details
				const organization = yield* _(
					dbService.query("getOrganization", async () => {
						return await db.query.organization.findFirst({
							where: eq(authSchema.organization.id, organizationId),
						});
					}),
					Effect.flatMap((org) =>
						org
							? Effect.succeed(org)
							: Effect.fail(
									new NotFoundError({
										message: "Organization not found",
										entityType: "organization",
										entityId: organizationId,
									}),
								),
					),
				);

				// Check if organization is actually scheduled for deletion
				if (!organization.deletedAt) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Organization is not scheduled for deletion",
								field: "organization",
							}),
						),
					);
				}

				// Clear deletion fields to recover
				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.update(authSchema.organization)
								.set({
									deletedAt: null,
									deletedBy: null,
								})
								.where(eq(authSchema.organization.id, organizationId));
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error
										? error.message
										: "Failed to recover organization",
								field: "organization",
							});
						},
					}),
				);

				logger.info(
					{
						organizationId,
						organizationName: organization.name,
						recoveredBy: session.user.id,
					},
					"Organization recovered from deletion",
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
							{ error, organizationId },
							"Failed to recover organization",
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
 * Helper function to send deletion notification emails to all admins and owners
 */
async function sendOrganizationDeletionNotifications(
	organizationId: string,
	organizationName: string,
	deletedByName: string,
	deletionDate: Date,
): Promise<void> {
	const [
		{ render },
		{ OrganizationDeletion },
		{ sendEmail },
		adminMembers,
		appUrl,
	] = await Promise.all([
		import("react-email"),
		import("@/lib/email/templates/organization-deletion"),
		import("@/lib/email/email-service"),
		db.query.member.findMany({
			where: and(
				eq(authSchema.member.organizationId, organizationId),
				// Include both admin and owner roles
			),
			with: {
				user: true,
			},
		}),
		getOrganizationBaseUrl(organizationId),
	]);

	// Filter to only admins and owners
	const typedAdminMembers = adminMembers as unknown as MemberWithUser[];
	const adminsAndOwners = typedAdminMembers.filter(
		(m) => m.role === "admin" || m.role === "owner",
	);

	const recoveryUrl = `${appUrl}/settings/organizations`;
	const permanentDeletionDate = new Date(deletionDate);
	permanentDeletionDate.setDate(permanentDeletionDate.getDate() + 5);

	// Send email to each admin/owner
	await Promise.all(
		adminsAndOwners.map(async (member) => {
			const user = member.user;
			const userEmail = user?.email;
			if (!userEmail) return;

			try {
				const html = await render(
					OrganizationDeletion({
						userName: user.name || userEmail,
						organizationName,
						deletedByName,
						deletionDate: deletionDate.toLocaleString(),
						permanentDeletionDate: permanentDeletionDate.toLocaleString(),
						recoveryUrl,
						appUrl,
					}),
				);

				await sendEmail({
					to: userEmail,
					subject: `Organization "${organizationName}" scheduled for deletion`,
					html,
					actionUrl: recoveryUrl,
					organizationId,
				});
			} catch (error) {
				logger.warn(
					{ error, email: userEmail, organizationId },
					"Failed to send deletion notification to user",
				);
			}
		}),
	);
}
