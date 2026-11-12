"use server";

import { and, eq, gt } from "drizzle-orm";
import { Effect } from "effect";
import { headers } from "next/headers";
import { z } from "zod";
import * as authSchema from "@/db/auth-schema";
import { employeeInvitationDraft, organizationNotificationSettings, team } from "@/db/schema";
import { auth, runAuthMutation } from "@/lib/auth";
import {
	isInvitationActionable,
	normalizeInvitationEmail,
	persistEmployeeInvitationDraft,
	syncInvitationTargetTeam,
} from "@/lib/auth/employee-invitation-draft";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { assertEnterpriseIdentityInvitationAllowed } from "@/lib/enterprise-identity/enforcement";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { revokeShareLinksAfterAccessChange } from "@/lib/projects/report-share/access-change";
import { pauseSchedulesAfterOwnerAccessChange } from "@/lib/scheduled-exports/application/owner-access-change";
import { changeOrganizationTimezone } from "@/lib/timezone/organization-timezone-change";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import {
	invitationSchema,
	updateMemberRoleSchema,
	updateOrganizationSchema,
} from "@/lib/validations/invitation";
import {
	failureMessage,
	processWorkBalanceRebuildIntents,
} from "@/lib/work-balance/rebuild-intents";
import { ALL_LANGUAGES } from "@/tolgee/shared";
import {
	ORGANIZATION_FEATURES,
	organizationFeatureRequiredRole,
	organizationFeatureUpdate,
	requiresDedicatedSwitch,
} from "./organization-features";

const logger = createLogger("OrganizationActions");

const initialRoleOf = (role: string) =>
	role === "admin" || role === "owner" ? "admin" : "employee";

/** A target team of the session's organization, or a `ValidationError` naming the field. */
function validateTargetTeam(organizationId: string, targetTeamId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const targetTeam = yield* dbService.query("getInvitationTargetTeam", () =>
			dbService.db.query.team.findFirst({
				where: and(eq(team.id, targetTeamId), eq(team.organizationId, organizationId)),
			}),
		);
		if (!targetTeam) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Target team not found in this organization",
					field: "targetTeamId",
					value: targetTeamId,
				}),
			);
		}
	});
}

function validateInvitationAllowed(organizationId: string, email: string) {
	return Effect.tryPromise({
		try: () => assertEnterpriseIdentityInvitationAllowed({ organizationId, email }),
		catch: (error) =>
			new ValidationError({
				message: error instanceof Error ? error.message : "Invitation is not allowed",
				field: "email",
				value: email,
			}),
	});
}

// =============================================================================
// Invitation Management Actions (org admins)
// =============================================================================

const sendInvitationSchema = z.strictObject({
	...invitationSchema.shape,
	email: z.string().transform(normalizeInvitationEmail).pipe(invitationSchema.shape.email),
});

/**
 * Send an invitation to join the organization
 */
export const sendInvitation = organizationAction(
	{ name: "organization.sendInvitation", requires: "orgAdmin", schema: sendInvitationSchema },
	({ actor, organizationId, input }) => {
		let authoritativeInvitationId: string | undefined;
		let failurePhase = "precondition";
		return Effect.gen(function* () {
			const now = systemClock.nowInstant();
			const dbService = yield* DatabaseService;
			const draftFields = {
				organizationId,
				normalizedEmail: input.email,
				canCreateOrganizations: input.canCreateOrganizations ?? false,
				targetTeamId: input.targetTeamId ?? null,
				initialRole: initialRoleOf(input.role),
				updatedBy: actor.userId,
			} as const;

			if (input.targetTeamId) yield* validateTargetTeam(organizationId, input.targetTeamId);
			yield* validateInvitationAllowed(organizationId, input.email);

			const existingInvitation = yield* dbService.query("checkExistingInvitation", () =>
				dbService.db.query.invitation.findFirst({
					where: and(
						eq(authSchema.invitation.organizationId, organizationId),
						eq(authSchema.invitation.email, input.email),
						eq(authSchema.invitation.status, "pending"),
						gt(authSchema.invitation.expiresAt, dateFromInstant(now)),
					),
				}),
			);

			if (
				existingInvitation?.organizationId === organizationId &&
				isInvitationActionable(existingInvitation, now)
			) {
				authoritativeInvitationId = existingInvitation.id;
				failurePhase = "persistInvitationState";
				const persistence = yield* Effect.tryPromise({
					try: () =>
						persistEmployeeInvitationDraft(dbService.db, {
							...draftFields,
							invitationId: existingInvitation.id,
						}),
					catch: () =>
						new ValidationError({ message: "Failed to send invitation", field: "invitation" }),
				});
				if (persistence.outcome === "consumed") return;
				return yield* Effect.fail(
					new ValidationError({
						message: "An invitation for this email is already pending",
						field: "email",
						value: input.email,
					}),
				);
			}

			const existingUser = yield* dbService.query("checkExistingUser", () =>
				dbService.db.query.user.findFirst({ where: eq(authSchema.user.email, input.email) }),
			);
			if (existingUser) {
				const existingMember = yield* dbService.query("checkExistingMember", () =>
					dbService.db.query.member.findFirst({
						where: and(
							eq(authSchema.member.userId, existingUser.id),
							eq(authSchema.member.organizationId, organizationId),
						),
					}),
				);
				if (existingMember) {
					return yield* Effect.fail(
						new ValidationError({
							message: "This user is already a member of the organization",
							field: "email",
							value: input.email,
						}),
					);
				}
			}

			// Better Auth may deliver email before app persistence. The actionable-invite
			// branch above is the idempotent repair boundary for a failed persistence step.
			failurePhase = "createInvitation";
			yield* Effect.tryPromise({
				try: async () => {
					const newInvitation = await auth.api.createInvitation({
						body: { organizationId, email: input.email, role: input.role, resend: false },
						headers: await headers(),
					});
					authoritativeInvitationId = newInvitation.id;
					failurePhase = "persistInvitationState";
					await persistEmployeeInvitationDraft(dbService.db, {
						...draftFields,
						invitationId: newInvitation.id,
					});
				},
				catch: () =>
					new ValidationError({ message: "Failed to send invitation", field: "invitation" }),
			});
			logger.info({ organizationId, role: input.role }, "Invitation sent successfully");
		}).pipe(
			Effect.tapError(() =>
				Effect.sync(() =>
					logger.error(
						{
							operation: "sendInvitation",
							failurePhase,
							organizationId,
							...(authoritativeInvitationId ? { invitationId: authoritativeInvitationId } : {}),
						},
						"Failed to send invitation",
					),
				),
			),
		);
	},
);

/**
 * Resend a pending invitation of the session's organization
 */
export const resendInvitation = organizationAction(
	{ name: "organization.resendInvitation", requires: "orgAdmin", schema: z.string().min(1) },
	({ actor, organizationId, input: invitationId }) => {
		let authoritativeInvitationId = invitationId;
		let failurePhase = "precondition";
		return Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const invitation = yield* dbService.query("getInvitationForResend", () =>
				dbService.db.query.invitation.findFirst({
					where: and(
						eq(authSchema.invitation.id, invitationId),
						eq(authSchema.invitation.organizationId, organizationId),
					),
				}),
			);
			if (!invitation) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Invitation not found",
						entityType: "invitation",
						entityId: invitationId,
					}),
				);
			}

			const normalizedEmail = normalizeInvitationEmail(invitation.email);
			const stableDraft = yield* dbService.query("getCurrentEmployeeInvitationDraft", () =>
				dbService.db.query.employeeInvitationDraft.findFirst({
					where: and(
						eq(employeeInvitationDraft.organizationId, organizationId),
						eq(employeeInvitationDraft.normalizedEmail, normalizedEmail),
					),
				}),
			);
			const invitationRole = invitation.role;
			if (
				invitation.status !== "pending" ||
				stableDraft?.invitationId !== invitationId ||
				(invitationRole !== "member" && invitationRole !== "admin" && invitationRole !== "owner")
			) {
				return yield* Effect.fail(
					new ValidationError({ message: "Invitation cannot be resent", field: "invitation" }),
				);
			}

			// The restriction may have been activated after this invitation was created.
			yield* validateInvitationAllowed(organizationId, normalizedEmail);

			failurePhase = "createInvitation";
			const resentInvitation = yield* Effect.tryPromise({
				try: async () =>
					auth.api.createInvitation({
						body: { organizationId, email: normalizedEmail, role: invitationRole, resend: true },
						headers: await headers(),
					}),
				catch: () =>
					new ValidationError({ message: "Failed to resend invitation", field: "invitation" }),
			});

			authoritativeInvitationId = resentInvitation.id;
			failurePhase = "persistInvitationState";
			yield* Effect.promise(async () => {
				try {
					await persistEmployeeInvitationDraft(dbService.db, {
						organizationId,
						normalizedEmail,
						invitationId: resentInvitation.id,
						canCreateOrganizations: invitation.canCreateOrganizations ?? false,
						targetTeamId: invitation.targetTeamId,
						initialRole: initialRoleOf(invitationRole),
						updatedBy: actor.userId,
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
			});

			logger.info({ organizationId, invitationId }, "Invitation resent successfully");
		}).pipe(
			Effect.tapError(() =>
				Effect.sync(() =>
					logger.error(
						{
							operation: "resendInvitation",
							failurePhase,
							organizationId,
							invitationId: authoritativeInvitationId,
						},
						"Failed to resend invitation",
					),
				),
			),
		);
	},
);

/**
 * Change or clear the team a pending invitation of the session's organization joins
 */
export const updateInvitationTargetTeam = organizationAction(
	{
		name: "organization.updateInvitationTargetTeam",
		requires: "orgAdmin",
		schema: z.strictObject({
			invitationId: z.string().min(1),
			targetTeamId: z.uuid({ message: "Invalid target team" }).nullable().optional(),
		}),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const invitation = yield* dbService.query("getPendingInvitation", () =>
				dbService.db.query.invitation.findFirst({
					where: and(
						eq(authSchema.invitation.id, input.invitationId),
						eq(authSchema.invitation.organizationId, organizationId),
						eq(authSchema.invitation.status, "pending"),
					),
				}),
			);
			if (!invitation) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Invitation not found",
						entityType: "invitation",
						entityId: input.invitationId,
					}),
				);
			}

			if (input.targetTeamId) yield* validateTargetTeam(organizationId, input.targetTeamId);

			yield* Effect.tryPromise({
				try: () =>
					syncInvitationTargetTeam(dbService.db, {
						organizationId,
						invitationId: invitation.id,
						email: invitation.email,
						targetTeamId: input.targetTeamId ?? null,
					}),
				catch: () =>
					new ValidationError({ message: "Failed to update invitation", field: "invitation" }),
			});
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() => logger.error({ error }, "Failed to update invitation target team")),
			),
		),
);

/**
 * Cancel a pending invitation of the session's organization
 */
export const cancelInvitation = organizationAction(
	{ name: "organization.cancelInvitation", requires: "orgAdmin", schema: z.string().min(1) },
	({ organizationId, input: invitationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const invitation = yield* dbService.query("getInvitation", () =>
				dbService.db.query.invitation.findFirst({
					where: and(
						eq(authSchema.invitation.id, invitationId),
						eq(authSchema.invitation.organizationId, organizationId),
					),
				}),
			);
			if (!invitation) {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Invitation not found",
						entityType: "invitation",
						entityId: invitationId,
					}),
				);
			}

			yield* Effect.tryPromise({
				try: async () => {
					await auth.api.cancelInvitation({
						body: { invitationId },
						headers: await headers(),
					});
				},
				catch: () =>
					new ValidationError({ message: "Failed to cancel invitation", field: "invitation" }),
			});
			logger.info({ invitationId, organizationId }, "Invitation cancelled successfully");
		}).pipe(
			Effect.tapError(() =>
				Effect.sync(() =>
					logger.error(
						{ operation: "cancelInvitation", invitationId, organizationId },
						"Failed to cancel invitation",
					),
				),
			),
		),
);

// =============================================================================
// Member Management Actions (owners)
// =============================================================================

/**
 * Update an approved member's role in the session's organization
 */
export const updateMemberRole = organizationAction(
	{
		name: "organization.updateMemberRole",
		requires: "owner",
		schema: z.strictObject({ memberId: z.string().min(1), ...updateMemberRoleSchema.shape }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { memberId, role } = input;
			const dbService = yield* DatabaseService;
			const targetMember = yield* dbService.query("getTargetMemberForRoleUpdate", () =>
				dbService.db.query.member.findFirst({
					where: and(
						eq(authSchema.member.id, memberId),
						eq(authSchema.member.organizationId, organizationId),
						eq(authSchema.member.status, "approved"),
					),
					columns: { id: true, userId: true, status: true },
				}),
			);
			if (targetMember?.status !== "approved") {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Member not found",
						entityType: "member",
						entityId: memberId,
					}),
				);
			}
			if (targetMember.userId === actor.userId) {
				return yield* Effect.fail(
					new ValidationError({
						message: "You cannot change your own organization role",
						field: "memberId",
						value: memberId,
					}),
				);
			}

			yield* Effect.tryPromise({
				try: async () => {
					const requestHeaders = await headers();
					// The role update commits with its access guard (#314).
					await runAuthMutation(() =>
						auth.api.updateMemberRole({
							body: { organizationId, memberId, role },
							headers: requestHeaders,
						}),
					);
				},
				catch: () =>
					new ValidationError({ message: "Failed to update member role", field: "role" }),
			});
			logger.info({ organizationId, memberId, newRole: role }, "Member role updated successfully");

			// An owner or admin who becomes a member can lose projects in their share links (#806).
			yield* dbService.query("reportShareLink.revokeAfterRoleUpdate", () =>
				revokeShareLinksAfterAccessChange(dbService.db, {
					organizationId,
					creator: { userId: targetMember.userId },
					actorUserId: actor.userId,
				}),
			);
			// An owner or admin who becomes a member can no longer own scheduled exports (#988).
			yield* dbService.query("scheduledExport.pauseAfterRoleUpdate", () =>
				pauseSchedulesAfterOwnerAccessChange(dbService.db, {
					organizationId,
					owner: { userId: targetMember.userId },
					actorUserId: actor.userId,
				}),
			);
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() =>
					logger.error(
						{ error, organizationId, memberId: input.memberId },
						"Failed to update member role",
					),
				),
			),
		),
);

// =============================================================================
// Organization Management Actions
// =============================================================================

/**
 * Update the session organization's name, slug or metadata. Owners only.
 */
export const updateOrganizationDetails = organizationAction(
	{
		name: "organization.updateDetails",
		requires: "owner",
		schema: z.strictObject(updateOrganizationSchema.shape),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const updateData: { name?: string; slug?: string; metadata?: Record<string, unknown> } = {};
			if (input.name !== undefined) updateData.name = input.name;
			if (input.slug !== undefined) updateData.slug = input.slug;
			if (input.metadata !== undefined) {
				try {
					updateData.metadata = JSON.parse(input.metadata) as Record<string, unknown>;
				} catch {
					// If metadata is not valid JSON, skip it
				}
			}

			yield* Effect.tryPromise({
				try: async () => {
					await auth.api.updateOrganization({
						body: { organizationId, data: updateData },
						headers: await headers(),
					});
				},
				catch: (error) =>
					new ValidationError({
						message: error instanceof Error ? error.message : "Failed to update organization",
						field: "organization",
					}),
			});
			logger.info({ organizationId, updates: input }, "Organization updated successfully");
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() => logger.error({ error, organizationId }, "Failed to update organization")),
			),
		),
);

/**
 * Clear the session organization's logo. Owners only. Does not delete the
 * underlying storage object.
 */
export const removeOrganizationLogo = organizationAction(
	{ name: "organization.removeLogo", requires: "owner", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("removeOrganizationLogo", () =>
				dbService.db
					.update(authSchema.organization)
					.set({ logo: null })
					.where(eq(authSchema.organization.id, organizationId)),
			);
			logger.info({ organizationId }, "Organization logo removed successfully");
		}),
);

// =============================================================================
// Organization Features Actions
// =============================================================================

/**
 * Switch an organization feature (e.g. shift scheduling). Org admins may switch
 * personnel files and equipment; every other feature steps up to owners.
 */
export const toggleOrganizationFeature = organizationAction(
	{
		name: "organization.toggleFeature",
		requires: "orgAdmin",
		schema: z.strictObject({
			feature: z
				.enum(ORGANIZATION_FEATURES, { error: "Invalid organization feature" })
				.refine((feature) => !requiresDedicatedSwitch(feature), {
					error: "This feature has its own switch",
				}),
			enabled: z.boolean(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { feature, enabled } = input;
			if (organizationFeatureRequiredRole(feature) === "owner") yield* actor.require("owner");

			// Switching projects off also switches Billable Time off (#897).
			const dbService = yield* DatabaseService;
			yield* dbService.query("organization.toggleFeature", () =>
				dbService.db
					.update(authSchema.organization)
					.set(organizationFeatureUpdate(feature, enabled))
					.where(eq(authSchema.organization.id, organizationId)),
			);
			logger.info(
				{ organizationId, feature, enabled },
				`Organization feature ${feature} ${enabled ? "enabled" : "disabled"}`,
			);
		}),
);

/**
 * Change the session organization's timezone. Owners only.
 */
export const updateOrganizationTimezone = organizationAction(
	{
		name: "organization.updateTimezone",
		requires: "owner",
		schema: z.string().refine(isValidIanaTimeZone, { error: "Timezone must be a valid timezone" }),
	},
	({ actor, organizationId, input: timezone }) =>
		Effect.gen(function* () {
			// Protected change (#311): the zone and, once adopted, its durable
			// balance-rebuild intent commit together.
			const change = yield* Effect.tryPromise({
				try: () =>
					changeOrganizationTimezone({ organizationId, actorUserId: actor.userId, timezone }),
				// Nothing was committed; keep statement text out of the response.
				catch: (error) => {
					logger.error(
						{ error, organizationId, timezone },
						"Organization timezone change rolled back",
					);
					return new ValidationError({
						message: "Failed to update organization timezone",
						field: "timezone",
					});
				},
			});
			if (change.status === "not_found") {
				return yield* Effect.fail(
					new NotFoundError({
						message: "Organization not found",
						entityType: "organization",
						entityId: organizationId,
					}),
				);
			}
			if (change.status === "not_authorized") {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "Only owners can change organization timezone",
						userId: actor.userId,
						resource: "organization",
						action: "update",
					}),
				);
			}

			// The save is committed. Rebuilding runs separately; a failure stays on
			// the intent for the balance worker and does not fail the save.
			if (change.status === "changed" && change.rebuild === "intent") {
				const rebuild = yield* Effect.promise(() =>
					processWorkBalanceRebuildIntents({ organizationId }).catch((error: unknown) => ({
						organizationsRebuilt: 0,
						failures: [{ organizationId, error: failureMessage(error) }],
					})),
				);
				if (rebuild.failures.length > 0) {
					logger.warn(
						{ organizationId, failures: rebuild.failures },
						"Organization timezone saved; balance rebuild is pending retry",
					);
				}
			}

			logger.info({ organizationId, timezone }, `Organization timezone updated to ${timezone}`);
		}),
);

/**
 * Change the session organization's default notification language. Org admins.
 */
export const updateOrganizationDefaultNotificationLanguage = organizationAction(
	{
		name: "organization.updateDefaultNotificationLanguage",
		requires: "orgAdmin",
		schema: z
			.string()
			.refine((language) => ALL_LANGUAGES.includes(language), { error: "Unsupported language" }),
	},
	({ organizationId, input: defaultLanguage }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("organization.updateDefaultNotificationLanguage", () =>
				dbService.db
					.insert(organizationNotificationSettings)
					.values({ organizationId, defaultLanguage })
					.onConflictDoUpdate({
						target: organizationNotificationSettings.organizationId,
						set: { defaultLanguage },
					}),
			);
			logger.info(
				{ organizationId, defaultLanguage },
				`Organization notification language updated to ${defaultLanguage}`,
			);
		}),
);

// =============================================================================
// Organization Deletion Actions (Soft Delete with 5-Day Recovery), org admins
// =============================================================================

function loadOrganization(organizationId: string) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const organization = yield* dbService.query("getOrganization", () =>
			dbService.db.query.organization.findFirst({
				where: eq(authSchema.organization.id, organizationId),
			}),
		);
		if (!organization) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Organization not found",
					entityType: "organization",
					entityId: organizationId,
				}),
			);
		}
		return organization;
	});
}

/**
 * Soft delete the session organization (5-day recovery window) once its exact
 * name is typed, and notify its admins and owners by email.
 */
export const deleteOrganization = organizationAction(
	{
		name: "organization.delete",
		requires: "orgAdmin",
		schema: z.strictObject({ confirmationName: z.string() }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const organization = yield* loadOrganization(organizationId);
			if (organization.deletedAt) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Organization is already scheduled for deletion",
						field: "organization",
					}),
				);
			}
			if (input.confirmationName !== organization.name) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							"Organization name does not match. Please type the exact organization name to confirm deletion.",
						field: "confirmationName",
						value: input.confirmationName,
					}),
				);
			}

			const deletionDate = new Date();
			const dbService = yield* DatabaseService;
			yield* dbService.query("organization.scheduleDeletion", () =>
				dbService.db
					.update(authSchema.organization)
					.set({ deletedAt: deletionDate, deletedBy: actor.userId })
					.where(eq(authSchema.organization.id, organizationId)),
			);

			const { user } = yield* (yield* AuthService).getSession();
			// Email failures are logged and do not fail the action.
			yield* Effect.promise(async () => {
				try {
					const { sendOrganizationDeletionNotifications } = await import(
						"@/lib/jobs/organization-deletion-notification"
					);
					await sendOrganizationDeletionNotifications({
						organizationId,
						organizationName: organization.name,
						deletedByName: user.name || user.email,
						deletionDate: deletionDate.toISOString(),
					});
				} catch (error) {
					logger.warn({ error, organizationId }, "Failed to send deletion notification emails");
				}
			});

			logger.info(
				{
					organizationId,
					organizationName: organization.name,
					deletedBy: actor.userId,
					deletionDate,
				},
				"Organization scheduled for deletion (5-day recovery window)",
			);
		}),
);

/**
 * Recover the session organization from a scheduled deletion
 */
export const recoverOrganization = organizationAction(
	{ name: "organization.recover", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const organization = yield* loadOrganization(organizationId);
			if (!organization.deletedAt) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Organization is not scheduled for deletion",
						field: "organization",
					}),
				);
			}

			const dbService = yield* DatabaseService;
			yield* dbService.query("organization.recover", () =>
				dbService.db
					.update(authSchema.organization)
					.set({ deletedAt: null, deletedBy: null })
					.where(eq(authSchema.organization.id, organizationId)),
			);
			logger.info(
				{ organizationId, organizationName: organization.name, recoveredBy: actor.userId },
				"Organization recovered from deletion",
			);
		}),
);
