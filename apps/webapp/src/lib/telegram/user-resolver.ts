/**
 * Telegram User Resolver
 *
 * Resolves Telegram users to Z8 accounts via link codes.
 * Unlike Teams (which uses email matching), Telegram requires explicit linking.
 */

import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { employee, telegramLinkCode, telegramUserMapping } from "@/db/schema";
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
 * Resolve a Telegram user to a Z8 user within an organization
 */
export async function resolveTelegramUser(
	telegramUserId: string,
	organizationId: string,
	telegramUsername?: string,
): Promise<TelegramUserResolutionResult> {
	// Check existing mapping
	const mapping = await db.query.telegramUserMapping.findFirst({
		where: and(
			eq(telegramUserMapping.telegramUserId, telegramUserId),
			eq(telegramUserMapping.organizationId, organizationId),
			eq(telegramUserMapping.isActive, true),
		),
	});

	if (mapping) {
		// Update last seen and username if changed
		await db
			.update(telegramUserMapping)
			.set({
				lastSeenAt: new Date(),
				...(telegramUsername ? { telegramUsername } : {}),
			})
			.where(eq(telegramUserMapping.id, mapping.id));

		// Get employee ID
		const emp = await db.query.employee.findFirst({
			where: and(eq(employee.userId, mapping.userId), eq(employee.organizationId, organizationId)),
			columns: { id: true },
		});

		return {
			status: "found",
			user: {
				userId: mapping.userId,
				employeeId: emp?.id || "",
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
 * Returns the Z8 user info if successful.
 */
export async function claimLinkCode(
	code: string,
	telegramUserId: string,
	organizationId: string,
	telegramUsername?: string,
	telegramDisplayName?: string,
): Promise<
	| { status: "success"; userId: string; employeeId: string }
	| { status: "invalid_code" }
	| { status: "expired" }
	| { status: "already_linked" }
> {
	// Find the link code
	const linkCode = await db.query.telegramLinkCode.findFirst({
		where: and(
			eq(telegramLinkCode.code, code.toUpperCase()),
			eq(telegramLinkCode.organizationId, organizationId),
		),
	});

	if (!linkCode) {
		return { status: "invalid_code" };
	}

	if (linkCode.status !== "pending") {
		return { status: linkCode.status === "expired" ? "expired" : "invalid_code" };
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

	if (existingMapping) {
		return { status: "already_linked" };
	}

	// Get employee ID
	const emp = await db.query.employee.findFirst({
		where: and(eq(employee.userId, linkCode.userId), eq(employee.organizationId, organizationId)),
		columns: { id: true },
	});

	if (!emp) {
		return { status: "invalid_code" }; // User has no employee record
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
		"Telegram account linked via code",
	);

	return { status: "success", userId: linkCode.userId, employeeId: emp.id };
}

/**
 * Unlink a Telegram account
 */
export async function unlinkTelegramUser(userId: string, organizationId: string): Promise<boolean> {
	const result = await db
		.update(telegramUserMapping)
		.set({ isActive: false })
		.where(
			and(
				eq(telegramUserMapping.userId, userId),
				eq(telegramUserMapping.organizationId, organizationId),
			),
		)
		.returning({ id: telegramUserMapping.id });

	return result.length > 0;
}

function generateRandomCode(length: number): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous chars: 0/O, 1/I/L
	let code = "";
	for (let i = 0; i < length; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}
	return code;
}
