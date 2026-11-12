"use server";

import { Effect, Layer } from "effect";
import { z } from "zod";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import {
	InviteCodeService,
	InviteCodeServiceLive,
} from "@/lib/effect/services/invite-code.service";
import {
	PendingMemberService,
	PendingMemberServiceLive,
} from "@/lib/effect/services/pending-member.service";
import { QRCodeService, QRCodeServiceLive } from "@/lib/effect/services/qrcode.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

// Note: Types are NOT re-exported from server action files due to Turbopack bundling issues.
// Import types directly from the service files:
// - PendingMember, ApprovalResult from "@/lib/effect/services/pending-member.service"
// - InviteCodeWithRelations from "@/lib/effect/services/invite-code.service"
//
// LEGACY: Re-exporting for backward compatibility with existing components
// TODO: Migrate components to import directly from service files
export type { InviteCodeWithRelations } from "@/lib/effect/services/invite-code.service";

// Invite code management is for org admins. The public invite-code actions
// (validate, store, process, redeem) live in the auth area (#1610).

// Invite code services sit outside AppLayer; the shared runtime supplies their DatabaseService.
const InviteCodeLayer = Layer.mergeAll(
	InviteCodeServiceLive,
	PendingMemberServiceLive,
	QRCodeServiceLive,
);

const inviteCodeId = z.string().min(1);

function inviteCodeNotFound(id: string) {
	return new NotFoundError({
		message: "Invite code not found",
		entityType: "inviteCode",
		entityId: id,
	});
}

/** The invite code with its relations, by ID within the organization. */
function loadInviteCode(id: string, organizationId: string) {
	return Effect.gen(function* () {
		const inviteCode = yield* (yield* InviteCodeService).getById(id, organizationId);
		if (!inviteCode) return yield* Effect.fail(inviteCodeNotFound(id));
		return inviteCode;
	});
}

// =============================================================================
// Invite Code Management Actions
// =============================================================================

/**
 * Create a new invite code for the session's organization
 */
export const createInviteCode = organizationAction(
	{
		name: "inviteCodes.create",
		requires: "orgAdmin",
		schema: z.strictObject({
			code: z
				.string()
				.min(4)
				.max(20)
				.regex(/^[A-Z0-9][A-Z0-9-]*[A-Z0-9]$/, "Code must be alphanumeric with optional hyphens")
				.optional(),
			label: z.string().min(1).max(100),
			description: z.string().max(500).optional(),
			maxUses: z.number().int().positive().optional().nullable(),
			expiresAt: z.coerce.date().optional().nullable(),
			defaultTeamId: z.string().optional().nullable(),
			requiresApproval: z.boolean().default(true),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const inviteCodeService = yield* InviteCodeService;
			const inviteCode = yield* inviteCodeService.create({
				organizationId,
				code: input.code?.toUpperCase(),
				label: input.label,
				description: input.description,
				maxUses: input.maxUses,
				expiresAt: input.expiresAt,
				defaultTeamId: input.defaultTeamId,
				requiresApproval: input.requiresApproval,
				createdBy: actor.userId,
			});
			return yield* loadInviteCode(inviteCode.id, organizationId);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Update an invite code of the session's organization
 */
export const updateInviteCode = organizationAction(
	{
		name: "inviteCodes.update",
		requires: "orgAdmin",
		schema: z.strictObject({
			inviteCodeId,
			label: z.string().min(1).max(100).optional(),
			description: z.string().max(500).optional().nullable(),
			maxUses: z.number().int().positive().optional().nullable(),
			expiresAt: z.coerce.date().optional().nullable(),
			defaultTeamId: z.string().optional().nullable(),
			requiresApproval: z.boolean().optional(),
			status: z.enum(["active", "paused", "expired", "archived"]).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const { inviteCodeId: id, ...changes } = input;
			yield* (yield* InviteCodeService).update(id, organizationId, {
				...changes,
				updatedBy: actor.userId,
			});
			return yield* loadInviteCode(id, organizationId);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Delete (archive) an invite code of the session's organization
 */
export const deleteInviteCode = organizationAction(
	{ name: "inviteCodes.delete", requires: "orgAdmin", schema: inviteCodeId },
	({ actor, organizationId, input: id }) =>
		Effect.gen(function* () {
			yield* (yield* InviteCodeService).delete(id, organizationId, actor.userId);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * List the invite codes of the session's organization
 */
export const listInviteCodes = organizationAction(
	{ name: "inviteCodes.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			return yield* (yield* InviteCodeService).list({ organizationId });
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Usage statistics of an invite code of the session's organization
 */
export const getInviteCodeStats = organizationAction(
	{ name: "inviteCodes.stats", requires: "orgAdmin", schema: inviteCodeId },
	({ organizationId, input: id }) =>
		Effect.gen(function* () {
			return yield* (yield* InviteCodeService).getUsageStats(id, organizationId);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * QR code for an invite code of the session's organization
 */
export const generateInviteQRCode = organizationAction(
	{
		name: "inviteCodes.qrCode",
		requires: "orgAdmin",
		schema: z.strictObject({ inviteCodeId, format: z.enum(["png", "svg"]) }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const inviteCode = yield* loadInviteCode(input.inviteCodeId, organizationId);
			const baseUrl = yield* Effect.promise(() => getOrganizationBaseUrl(organizationId));
			return yield* (yield* QRCodeService)
				.generateInviteQR(inviteCode.code, baseUrl, input.format)
				.pipe(
					Effect.mapError(
						(err) =>
							new ValidationError({
								message: err.message || "Failed to generate QR code",
								field: "qrcode",
							}),
					),
				);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Generate a random invite code
 */
export const generateRandomCode = organizationAction(
	{ name: "inviteCodes.generateCode", requires: "orgAdmin", schema: noInput },
	() =>
		Effect.gen(function* () {
			return yield* (yield* InviteCodeService).generateCode();
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Base URL of the session organization's invite links; its verified custom
 * domain when it has one.
 */
export const getInviteBaseUrl = organizationAction(
	{ name: "inviteCodes.baseUrl", requires: "orgAdmin", schema: noInput },
	({ organizationId }) => Effect.promise(() => getOrganizationBaseUrl(organizationId)),
);

// =============================================================================
// Pending Member Management Actions
// =============================================================================

/**
 * List the pending members of the session's organization
 */
export const listPendingMembers = organizationAction(
	{ name: "pendingMembers.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			return yield* (yield* PendingMemberService).listPending({ organizationId });
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Count the pending members of the session's organization
 */
export const getPendingMemberCount = organizationAction(
	{ name: "pendingMembers.count", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			return yield* (yield* PendingMemberService).countPending(organizationId);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Approve a pending member of the session's organization
 */
export const approvePendingMember = organizationAction(
	{
		name: "pendingMembers.approve",
		requires: "orgAdmin",
		schema: z.strictObject({
			memberId: z.string().min(1),
			assignedTeamId: z.string().optional().nullable(),
			notes: z.string().max(500).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			return yield* (yield* PendingMemberService).approve({
				...input,
				organizationId,
				approvedBy: actor.userId,
			});
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Reject a pending member of the session's organization
 */
export const rejectPendingMember = organizationAction(
	{
		name: "pendingMembers.reject",
		requires: "orgAdmin",
		schema: z.strictObject({
			memberId: z.string().min(1),
			notes: z.string().max(500).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			return yield* (yield* PendingMemberService).reject({
				...input,
				organizationId,
				rejectedBy: actor.userId,
			});
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Approve several pending members of the session's organization
 */
export const bulkApprovePendingMembers = organizationAction(
	{
		name: "pendingMembers.bulkApprove",
		requires: "orgAdmin",
		schema: z.strictObject({
			memberIds: z.array(z.string().min(1)),
			assignedTeamId: z.string().optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			return yield* (yield* PendingMemberService).bulkApprove(
				input.memberIds,
				organizationId,
				actor.userId,
				input.assignedTeamId,
			);
		}).pipe(Effect.provide(InviteCodeLayer)),
);

/**
 * Reject several pending members of the session's organization
 */
export const bulkRejectPendingMembers = organizationAction(
	{
		name: "pendingMembers.bulkReject",
		requires: "orgAdmin",
		schema: z.strictObject({
			memberIds: z.array(z.string().min(1)),
			notes: z.string().max(500).optional(),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			return yield* (yield* PendingMemberService).bulkReject(
				input.memberIds,
				organizationId,
				actor.userId,
				input.notes,
			);
		}).pipe(Effect.provide(InviteCodeLayer)),
);
