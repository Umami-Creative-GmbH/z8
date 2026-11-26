/**
 * Telegram User Resolver
 *
 * Resolves Telegram users to Z8 accounts via link codes.
 * Unlike Teams (which uses email matching), Telegram requires explicit linking.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	chatInstallation,
	chatInstallationMemberLink,
	telegramLinkCode,
	telegramUserMapping,
} from "@/db/schema";
import {
	redeemChatLinkProof,
	resolveTelegramInstallationForBot,
	unlinkMemberChatLink,
} from "@/lib/chat-installations/member-links";
import { resolveCommandActorEmployee } from "@/lib/integrations/resolve-command-actor";
import { createLogger } from "@/lib/logger";
import type { ResolvedTelegramUser } from "./types";

const logger = createLogger("TelegramUserResolver");

// ============================================
// USER RESOLUTION
// ============================================

export type TelegramUserResolutionResult =
	| { status: "found"; user: ResolvedTelegramUser }
	| { status: "not_linked"; telegramUserId: string };

/**
 * Resolve a Telegram user to a Z8 user within an organization.
 * When `options.installationId` is provided (organization-owned or retiring installation),
 * checks installation-scoped live `chat_installation_member_link` first and falls back to
 * legacy `telegram_user_mapping` only for legacy installations.
 */
export async function resolveTelegramUser(
	telegramUserId: string,
	organizationId: string,
	telegramUsername?: string,
	options?: { installationId?: string | null },
): Promise<TelegramUserResolutionResult> {
	let allowLegacyFallback = true;

	if (options?.installationId && typeof db.select === "function") {
		const [instLink] = await db
			.select()
			.from(chatInstallationMemberLink)
			.where(
				and(
					eq(chatInstallationMemberLink.organizationId, organizationId),
					eq(chatInstallationMemberLink.installationId, options.installationId),
					eq(chatInstallationMemberLink.externalUserId, telegramUserId),
					eq(chatInstallationMemberLink.isCandidateEnrollment, false),
					eq(chatInstallationMemberLink.isActive, true),
				),
			)
			.limit(1);

		if (instLink) {
			const emp = await resolveCommandActorEmployee(instLink.userId, organizationId);
			if (!emp) return { status: "not_linked", telegramUserId };

			if (typeof db.update === "function") {
				await db
					.update(chatInstallationMemberLink)
					.set({
						lastSeenAt: new Date(),
						...(telegramUsername ? { externalUsername: telegramUsername } : {}),
					})
					.where(eq(chatInstallationMemberLink.id, instLink.id));
			}

			return {
				status: "found",
				user: {
					userId: instLink.userId,
					employeeId: emp.id,
					organizationId,
					telegramUserId: instLink.externalUserId,
					telegramUsername: instLink.externalUsername,
				},
			};
		}

		const [inst] = await db
			.select({ legacyTable: chatInstallation.legacyTable })
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.id, options.installationId),
					eq(chatInstallation.organizationId, organizationId),
				),
			)
			.limit(1);
		if (inst && inst.legacyTable !== "telegram_bot_config") {
			allowLegacyFallback = false;
		}
	}

	if (!allowLegacyFallback) {
		return { status: "not_linked", telegramUserId };
	}

	// Check existing legacy mapping
	const mapping = await db.query.telegramUserMapping.findFirst({
		where: and(
			eq(telegramUserMapping.telegramUserId, telegramUserId),
			eq(telegramUserMapping.organizationId, organizationId),
			eq(telegramUserMapping.isActive, true),
		),
	});

	if (mapping) {
		const emp = await resolveCommandActorEmployee(mapping.userId, mapping.organizationId);
		if (!emp) return { status: "not_linked", telegramUserId };

		// Update last seen and username if changed
		await db
			.update(telegramUserMapping)
			.set({
				lastSeenAt: new Date(),
				...(telegramUsername ? { telegramUsername } : {}),
			})
			.where(eq(telegramUserMapping.id, mapping.id));

		return {
			status: "found",
			user: {
				userId: mapping.userId,
				employeeId: emp.id,
				organizationId: mapping.organizationId,
				telegramUserId: mapping.telegramUserId,
				telegramUsername: mapping.telegramUsername,
			},
		};
	}

	return { status: "not_linked", telegramUserId };
}

// ============================================
// LINK CODE MANAGEMENT
// ============================================

const LINK_CODE_TTL_MINUTES = 15;
const LINK_CODE_LENGTH = 6;

/**
 * Generate a link code for a user.
 * Called from the webapp settings page.
 */
export async function generateLinkCode(
	userId: string,
	organizationId: string,
): Promise<{ code: string; expiresAt: Date }> {
	// Expire any existing pending codes for this user
	await db
		.update(telegramLinkCode)
		.set({ status: "expired" })
		.where(
			and(
				eq(telegramLinkCode.userId, userId),
				eq(telegramLinkCode.organizationId, organizationId),
				eq(telegramLinkCode.status, "pending"),
			),
		);

	// Generate a random 6-character alphanumeric code
	const code = generateRandomCode(LINK_CODE_LENGTH);
	const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);

	await db.insert(telegramLinkCode).values({
		userId,
		organizationId,
		code,
		expiresAt,
		status: "pending",
	});

	logger.info({ userId, organizationId, codeLength: code.length }, "Link code generated");

	return { code, expiresAt };
}

/**
 * Claim a link code (called when user sends /link CODE to the bot).
 * Verifies installation-bound digest proofs first, falling back to unexpired
 * legacy codes for backward compatibility while checking current member eligibility.
 */
export async function claimLinkCode(
	code: string,
	telegramUserId: string,
	organizationId: string,
	telegramUsername?: string,
	telegramDisplayName?: string,
	options?: {
		botToken?: string;
		installationId?: string;
		chatId?: string;
	},
): Promise<
	| { status: "success"; userId: string; employeeId: string }
	| { status: "invalid_code" }
	| { status: "expired" }
	| { status: "already_linked" }
	| { status: "rate_limited" }
	| { status: "ineligible" }
> {
	// 1. Try installation-bound digest proof redemption first.
	const installation = await resolveTelegramInstallationForBot({
		organizationId,
		botToken: options?.botToken,
		installationId: options?.installationId,
	});

	if (installation) {
		const proofResult = await redeemChatLinkProof({
			organizationId,
			installationId: installation.id,
			purpose: "member_link",
			code,
			externalUserId: telegramUserId,
			externalUsername: telegramUsername ?? null,
			externalDisplayName: telegramDisplayName ?? null,
			externalConversationId: options?.chatId ?? null,
			conversationType: "private",
		});

		switch (proofResult.status) {
			case "success":
				return {
					status: "success",
					userId: proofResult.userId,
					employeeId: proofResult.employeeId,
				};
			case "expired":
				return { status: "expired" };
			case "already_used":
				return { status: "invalid_code" };
			case "already_linked":
				return { status: "already_linked" };
			case "rate_limited":
				return { status: "rate_limited" };
			case "ineligible":
				return { status: "ineligible" };
			case "invalid_code":
			case "installation_unavailable":
				// Fall through to legacy unexpired code compatibility check below.
				break;
		}
	}

	// 2. Backward-compatible fallback for unexpired legacy 6-char codes in telegram_link_code.
	const linkCode = await db.query.telegramLinkCode.findFirst({
		where: and(
			eq(telegramLinkCode.code, code.trim().toUpperCase()),
			eq(telegramLinkCode.organizationId, organizationId),
		),
	});

	if (!linkCode) {
		return { status: "invalid_code" };
	}

	if (linkCode.status !== "pending") {
		return {
			status: linkCode.status === "expired" ? "expired" : "invalid_code",
		};
	}

	if (linkCode.expiresAt < new Date()) {
		// Mark as expired
		await db
			.update(telegramLinkCode)
			.set({ status: "expired" })
			.where(eq(telegramLinkCode.id, linkCode.id));
		return { status: "expired" };
	}

	// Check if this Telegram user is already linked to another Z8 user in this org
	const existingMapping = await db.query.telegramUserMapping.findFirst({
		where: and(
			eq(telegramUserMapping.telegramUserId, telegramUserId),
			eq(telegramUserMapping.organizationId, organizationId),
			eq(telegramUserMapping.isActive, true),
		),
	});

	if (existingMapping && existingMapping.userId !== linkCode.userId) {
		return { status: "already_linked" };
	}

	// Verify current active membership and non-former employee eligibility.
	const emp = await resolveCommandActorEmployee(linkCode.userId, organizationId);
	if (!emp) {
		return { status: "ineligible" };
	}

	// Create the user mapping
	await db.insert(telegramUserMapping).values({
		userId: linkCode.userId,
		organizationId,
		telegramUserId,
		telegramUsername: telegramUsername || null,
		telegramDisplayName: telegramDisplayName || null,
		isActive: true,
	});

	// Mark code as used
	await db
		.update(telegramLinkCode)
		.set({
			status: "used",
			claimedByTelegramUserId: telegramUserId,
			claimedAt: new Date(),
		})
		.where(eq(telegramLinkCode.id, linkCode.id));

	logger.info(
		{ userId: linkCode.userId, telegramUserId, organizationId },
		"Telegram account linked via legacy code",
	);

	return { status: "success", userId: linkCode.userId, employeeId: emp.id };
}

/**
 * Unlink a Telegram account for a single organization.
 */
export async function unlinkTelegramUser(userId: string, organizationId: string): Promise<boolean> {
	const result = await unlinkMemberChatLink({
		userId,
		organizationId,
		provider: "telegram",
	});

	return result.unlinked;
}

function generateRandomCode(length: number): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous chars: 0/O, 1/I/L
	const randomBytes = crypto.getRandomValues(new Uint8Array(length));
	let code = "";
	for (let i = 0; i < length; i++) {
		code += chars[randomBytes[i] % chars.length];
	}
	return code;
}
