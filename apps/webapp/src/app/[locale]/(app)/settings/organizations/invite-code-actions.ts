"use server";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { z } from "zod";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import {
	type AnyAppError,
	AuthorizationError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import {
	InviteCodeService,
	InviteCodeServiceLive,
} from "@/lib/effect/services/invite-code.service";
import type {
	InviteCodeWithRelations as InviteCodeWithRelationsType,
	ValidateInviteCodeResult,
} from "@/lib/effect/services/invite-code.service";
import {
	PendingMemberService,
	PendingMemberServiceLive,
} from "@/lib/effect/services/pending-member.service";
import type { PendingMember, ApprovalResult } from "@/lib/effect/services/pending-member.service";
import { QRCodeService, QRCodeServiceLive } from "@/lib/effect/services/qrcode.service";
import type { QRCodeResult, QRCodeFormat } from "@/lib/effect/services/qrcode.service";

// Note: Types are NOT re-exported from server action files due to Turbopack bundling issues.
// Import types directly from the service files:
// - PendingMember, ApprovalResult from "@/lib/effect/services/pending-member.service"
// - InviteCodeWithRelations from "@/lib/effect/services/invite-code.service"
//
// LEGACY: Re-exporting for backward compatibility with existing components
// TODO: Migrate components to import directly from service files
export type { InviteCodeWithRelations } from "@/lib/effect/services/invite-code.service";
import { createLogger } from "@/lib/logger";

const logger = createLogger("InviteCodeActions");

// Validation schemas
const createInviteCodeSchema = z.object({
	organizationId: z.string().min(1),
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
});

const updateInviteCodeSchema = z.object({
	label: z.string().min(1).max(100).optional(),
	description: z.string().max(500).optional().nullable(),
	maxUses: z.number().int().positive().optional().nullable(),
	expiresAt: z.coerce.date().optional().nullable(),
	defaultTeamId: z.string().optional().nullable(),
	requiresApproval: z.boolean().optional(),
	status: z.enum(["active", "paused", "expired", "archived"]).optional(),
});

const approveMemberSchema = z.object({
	memberId: z.string().min(1),
	organizationId: z.string().min(1),
	assignedTeamId: z.string().optional().nullable(),
	notes: z.string().max(500).optional(),
});

const rejectMemberSchema = z.object({
	memberId: z.string().min(1),
	organizationId: z.string().min(1),
	notes: z.string().max(500).optional(),
});

// Extended layer with invite code services
const InviteCodeLayer = Layer.mergeAll(
	AppLayer,
	InviteCodeServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	PendingMemberServiceLive.pipe(Layer.provide(DatabaseServiceLive)),
	QRCodeServiceLive,
);

// =============================================================================
// Invite Code Management Actions
// =============================================================================

/**
 * Create a new invite code for the organization
 * Requires admin or owner role
 */
export async function createInviteCode(
	data: z.infer<typeof createInviteCodeSchema>,
): Promise<ServerActionResult<InviteCodeWithRelationsType>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"createInviteCode",
		{
			attributes: {
				"organization.id": data.organizationId,
				"inviteCode.label": data.label,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const inviteCodeService = yield* _(InviteCodeService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, data.organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can create invite codes",
								userId: session.user.id,
								resource: "inviteCode",
								action: "create",
							}),
						),
					);
				}

				// Validate input
				const validationResult = createInviteCodeSchema.safeParse(data);
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

				// Create the invite code
				const inviteCode = yield* _(
					inviteCodeService.create({
						organizationId: validatedData.organizationId,
						code: validatedData.code?.toUpperCase(),
						label: validatedData.label,
						description: validatedData.description,
						maxUses: validatedData.maxUses,
						expiresAt: validatedData.expiresAt,
						defaultTeamId: validatedData.defaultTeamId,
						requiresApproval: validatedData.requiresApproval,
						createdBy: session.user.id,
					}),
				);

				// Get the full record with relations
				const fullCode = yield* _(inviteCodeService.getById(inviteCode.id));

				span.setStatus({ code: SpanStatusCode.OK });
				return fullCode!;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Update an existing invite code
 * Requires admin or owner role
 */
export async function updateInviteCode(
	inviteCodeId: string,
	organizationId: string,
	data: z.infer<typeof updateInviteCodeSchema>,
): Promise<ServerActionResult<InviteCodeWithRelationsType>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"updateInviteCode",
		{
			attributes: {
				"inviteCode.id": inviteCodeId,
				"organization.id": organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const inviteCodeService = yield* _(InviteCodeService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can update invite codes",
								userId: session.user.id,
								resource: "inviteCode",
								action: "update",
							}),
						),
					);
				}

				// Validate input
				const validationResult = updateInviteCodeSchema.safeParse(data);
				if (!validationResult.success) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				// Update the invite code
				yield* _(
					inviteCodeService.update(inviteCodeId, {
						...validationResult.data,
						updatedBy: session.user.id,
					}),
				);

				// Get the full record with relations
				const fullCode = yield* _(inviteCodeService.getById(inviteCodeId));

				span.setStatus({ code: SpanStatusCode.OK });
				return fullCode!;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Delete (archive) an invite code
 * Requires admin or owner role
 */
export async function deleteInviteCode(
	inviteCodeId: string,
	organizationId: string,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"deleteInviteCode",
		{
			attributes: {
				"inviteCode.id": inviteCodeId,
				"organization.id": organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const inviteCodeService = yield* _(InviteCodeService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can delete invite codes",
								userId: session.user.id,
								resource: "inviteCode",
								action: "delete",
							}),
						),
					);
				}

				yield* _(inviteCodeService.delete(inviteCodeId, session.user.id));

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * List all invite codes for an organization
 * Requires admin or owner role
 */
export async function listInviteCodes(
	organizationId: string,
	includeArchived?: boolean,
): Promise<ServerActionResult<InviteCodeWithRelationsType[]>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"listInviteCodes",
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
				const inviteCodeService = yield* _(InviteCodeService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can view invite codes",
								userId: session.user.id,
								resource: "inviteCode",
								action: "read",
							}),
						),
					);
				}

				const codes = yield* _(
					inviteCodeService.list({
						organizationId,
						includeArchived,
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return codes;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Get usage statistics for an invite code
 * Requires admin or owner role
 */
export async function getInviteCodeStats(
	inviteCodeId: string,
	organizationId: string,
): Promise<
	ServerActionResult<{ total: number; pending: number; approved: number; rejected: number }>
> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"getInviteCodeStats",
		{
			attributes: {
				"inviteCode.id": inviteCodeId,
				"organization.id": organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const inviteCodeService = yield* _(InviteCodeService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can view invite code stats",
								userId: session.user.id,
								resource: "inviteCode",
								action: "read",
							}),
						),
					);
				}

				const stats = yield* _(inviteCodeService.getUsageStats(inviteCodeId));

				span.setStatus({ code: SpanStatusCode.OK });
				return stats;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Generate QR code for an invite code
 * Requires admin or owner role
 */
export async function generateInviteQRCode(
	inviteCodeId: string,
	organizationId: string,
	format: QRCodeFormat,
): Promise<ServerActionResult<QRCodeResult>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"generateInviteQRCode",
		{
			attributes: {
				"inviteCode.id": inviteCodeId,
				"organization.id": organizationId,
				"qrcode.format": format,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const inviteCodeService = yield* _(InviteCodeService);
				const qrCodeService = yield* _(QRCodeService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can generate QR codes",
								userId: session.user.id,
								resource: "inviteCode",
								action: "read",
							}),
						),
					);
				}

				// Get the invite code
				const inviteCode = yield* _(inviteCodeService.getById(inviteCodeId));

				if (!inviteCode) {
					yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Invite code not found",
								entityType: "inviteCode",
								entityId: inviteCodeId,
							}),
						),
					);
				}

				// Generate QR code
				const baseUrl =
					process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";
				const qrResult = yield* _(
					qrCodeService.generateInviteQR(inviteCode!.code, baseUrl, format).pipe(
						Effect.mapError(
							(err) =>
								new ValidationError({
									message: err.message || "Failed to generate QR code",
									field: "qrcode",
								}),
						),
					),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return qrResult;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Generate a random invite code
 */
export async function generateRandomCode(): Promise<ServerActionResult<string>> {
	const effect = Effect.gen(function* (_) {
		const inviteCodeService = yield* _(InviteCodeService);
		return yield* _(inviteCodeService.generateCode());
	});

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

// =============================================================================
// Pending Member Management Actions
// =============================================================================

/**
 * List pending members for an organization
 * Requires admin or owner role
 */
export async function listPendingMembers(
	organizationId: string,
): Promise<ServerActionResult<PendingMember[]>> {
	const tracer = trace.getTracer("pending-members");

	const effect = tracer.startActiveSpan(
		"listPendingMembers",
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
				const pendingMemberService = yield* _(PendingMemberService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can view pending members",
								userId: session.user.id,
								resource: "pendingMember",
								action: "read",
							}),
						),
					);
				}

				const pendingMembers = yield* _(pendingMemberService.listPending({ organizationId }));

				span.setStatus({ code: SpanStatusCode.OK });
				return pendingMembers;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Get count of pending members for an organization
 * Requires admin or owner role
 */
export async function getPendingMemberCount(
	organizationId: string,
): Promise<ServerActionResult<number>> {
	const tracer = trace.getTracer("pending-members");

	const effect = tracer.startActiveSpan(
		"getPendingMemberCount",
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
				const pendingMemberService = yield* _(PendingMemberService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can view pending member count",
								userId: session.user.id,
								resource: "pendingMember",
								action: "read",
							}),
						),
					);
				}

				const count = yield* _(pendingMemberService.countPending(organizationId));

				span.setStatus({ code: SpanStatusCode.OK });
				return count;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Approve a pending member
 * Requires admin or owner role
 */
export async function approvePendingMember(
	data: z.infer<typeof approveMemberSchema>,
): Promise<ServerActionResult<ApprovalResult>> {
	const tracer = trace.getTracer("pending-members");

	const effect = tracer.startActiveSpan(
		"approvePendingMember",
		{
			attributes: {
				"member.id": data.memberId,
				"organization.id": data.organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const pendingMemberService = yield* _(PendingMemberService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, data.organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can approve members",
								userId: session.user.id,
								resource: "pendingMember",
								action: "approve",
							}),
						),
					);
				}

				// Validate input
				const validationResult = approveMemberSchema.safeParse(data);
				if (!validationResult.success) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const result = yield* _(
					pendingMemberService.approve({
						memberId: data.memberId,
						organizationId: data.organizationId,
						assignedTeamId: data.assignedTeamId,
						notes: data.notes,
						approvedBy: session.user.id,
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Reject a pending member
 * Requires admin or owner role
 */
export async function rejectPendingMember(
	data: z.infer<typeof rejectMemberSchema>,
): Promise<ServerActionResult<ApprovalResult>> {
	const tracer = trace.getTracer("pending-members");

	const effect = tracer.startActiveSpan(
		"rejectPendingMember",
		{
			attributes: {
				"member.id": data.memberId,
				"organization.id": data.organizationId,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const pendingMemberService = yield* _(PendingMemberService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, data.organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can reject members",
								userId: session.user.id,
								resource: "pendingMember",
								action: "reject",
							}),
						),
					);
				}

				// Validate input
				const validationResult = rejectMemberSchema.safeParse(data);
				if (!validationResult.success) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: validationResult.error.issues[0]?.message || "Invalid input",
								field: validationResult.error.issues[0]?.path?.join(".") || "data",
							}),
						),
					);
				}

				const result = yield* _(
					pendingMemberService.reject({
						memberId: data.memberId,
						organizationId: data.organizationId,
						notes: data.notes,
						rejectedBy: session.user.id,
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Bulk approve pending members
 * Requires admin or owner role
 */
export async function bulkApprovePendingMembers(
	memberIds: string[],
	organizationId: string,
	assignedTeamId?: string,
): Promise<ServerActionResult<{ approved: number; failed: number }>> {
	const tracer = trace.getTracer("pending-members");

	const effect = tracer.startActiveSpan(
		"bulkApprovePendingMembers",
		{
			attributes: {
				"organization.id": organizationId,
				"members.count": memberIds.length,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const pendingMemberService = yield* _(PendingMemberService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can approve members",
								userId: session.user.id,
								resource: "pendingMember",
								action: "approve",
							}),
						),
					);
				}

				const result = yield* _(
					pendingMemberService.bulkApprove(
						memberIds,
						organizationId,
						session.user.id,
						assignedTeamId,
					),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Bulk reject pending members
 * Requires admin or owner role
 */
export async function bulkRejectPendingMembers(
	memberIds: string[],
	organizationId: string,
	notes?: string,
): Promise<ServerActionResult<{ rejected: number; failed: number }>> {
	const tracer = trace.getTracer("pending-members");

	const effect = tracer.startActiveSpan(
		"bulkRejectPendingMembers",
		{
			attributes: {
				"organization.id": organizationId,
				"members.count": memberIds.length,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);
				const pendingMemberService = yield* _(PendingMemberService);

				// Verify admin/owner role
				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
				);

				if (!memberRecord || (memberRecord.role !== "admin" && memberRecord.role !== "owner")) {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only admins and owners can reject members",
								userId: session.user.id,
								resource: "pendingMember",
								action: "reject",
							}),
						),
					);
				}

				const result = yield* _(
					pendingMemberService.bulkReject(memberIds, organizationId, session.user.id, notes),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

// =============================================================================
// Public Actions (for join page)
// =============================================================================

/**
 * Validate an invite code (public endpoint)
 */
export async function validateInviteCode(
	code: string,
): Promise<ServerActionResult<ValidateInviteCodeResult>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"validateInviteCode",
		{
			attributes: {
				"inviteCode.code": code,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const inviteCodeService = yield* _(InviteCodeService);
				const result = yield* _(inviteCodeService.validateCode(code));

				span.setStatus({ code: SpanStatusCode.OK });
				return result;
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Store a pending invite code for a user (called after registration)
 * This is called after signup when the user registered via /join/{code}
 * The code will be processed after email verification
 */
export async function storePendingInviteCode(code: string): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"storePendingInviteCode",
		{
			attributes: {
				"inviteCode.code": code,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const inviteCodeService = yield* _(InviteCodeService);

				yield* _(inviteCodeService.setPendingInviteCode(session.user.id, code));

				logger.info({ userId: session.user.id, code }, "Stored pending invite code for user");
				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Process a user's pending invite code (called after email verification)
 * This is typically called by the email verification callback or hook
 */
export async function processPendingInviteCode(): Promise<
	ServerActionResult<{
		success: boolean;
		status: "pending" | "approved";
		organizationName: string;
	} | null>
> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan("processPendingInviteCode", {}, (span) => {
		return Effect.gen(function* (_) {
			const authService = yield* _(AuthService);
			const session = yield* _(authService.getSession());
			const inviteCodeService = yield* _(InviteCodeService);

			const result = yield* _(inviteCodeService.processPendingInviteCode(session.user.id));

			if (result) {
				logger.info(
					{ userId: session.user.id, organizationId: result.organizationId, status: result.status },
					"Processed pending invite code",
				);
			}

			span.setStatus({ code: SpanStatusCode.OK });
			return result
				? {
						success: result.success,
						status: result.status,
						organizationName: result.organizationName,
					}
				: null;
		}).pipe(
			Effect.tapError((error) =>
				Effect.sync(() => {
					span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
					span.end();
				}),
			),
			Effect.tap(() =>
				Effect.sync(() => {
					span.end();
				}),
			),
		);
	});

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Get a user's pending invite code (if any)
 */
export async function getPendingInviteCode(): Promise<ServerActionResult<string | null>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const inviteCodeService = yield* _(InviteCodeService);

		return yield* _(inviteCodeService.getPendingInviteCode(session.user.id));
	});

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}

/**
 * Use an invite code to join an organization (requires authentication)
 */
export async function redeemInviteCode(
	code: string,
	ipAddress?: string,
	userAgent?: string,
): Promise<
	ServerActionResult<{ success: boolean; status: "pending" | "approved"; organizationName: string }>
> {
	const tracer = trace.getTracer("invite-codes");

	const effect = tracer.startActiveSpan(
		"redeemInviteCode",
		{
			attributes: {
				"inviteCode.code": code,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const inviteCodeService = yield* _(InviteCodeService);

				const result = yield* _(
					inviteCodeService.useCode({
						code,
						userId: session.user.id,
						ipAddress,
						userAgent,
					}),
				);

				span.setStatus({ code: SpanStatusCode.OK });
				return {
					success: result.success,
					status: result.status,
					organizationName: result.organizationName,
				};
			}).pipe(
				Effect.tapError((error) =>
					Effect.sync(() => {
						span.setStatus({ code: SpanStatusCode.ERROR, message: (error as AnyAppError).message });
						span.end();
					}),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						span.end();
					}),
				),
			);
		},
	);

	return runServerActionSafe(effect.pipe(Effect.provide(InviteCodeLayer)));
}
