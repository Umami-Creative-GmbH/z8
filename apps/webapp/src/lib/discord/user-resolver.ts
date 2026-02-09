/**
 * Discord User Resolver
 *
 * Resolves Discord users to Z8 accounts via link codes.
 * Like Telegram, Discord requires explicit linking (no email matching).
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discordLinkCode, discordUserMapping, employee } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedDiscordUser } from "./types";

const logger = createLogger("DiscordUserResolver");

// ============================================
// USER RESOLUTION
// ============================================

export type DiscordUserResolutionResult =
	| { status: "found"; user: ResolvedDiscordUser }
	| { status: "not_linked"; discordUserId: string };

/**
 * Resolve a Discord user to a Z8 user within an organization
 */
export async function resolveDiscordUser(
	discordUserId: string,
	organizationId: string,
	discordUsername?: string,
): Promise<DiscordUserResolutionResult> {
	// Check existing mapping
	const mapping = await db.query.discordUserMapping.findFirst({
		where: and(
			eq(discordUserMapping.discordUserId, discordUserId),
			eq(discordUserMapping.organizationId, organizationId),
			eq(discordUserMapping.isActive, true),
		),
	});

	if (mapping) {
		// Update last seen and username if changed
		await db
			.update(discordUserMapping)
			.set({
				lastSeenAt: new Date(),
				...(discordUsername ? { discordUsername } : {}),
			})
			.where(eq(discordUserMapping.id, mapping.id));

		// Get employee ID
		const emp = await db.query.employee.findFirst({
			where: and(eq(employee.userId, mapping.userId), eq(employee.organizationId, organizationId)),
			columns: { id: true },
		});

		if (!emp) {
			return { status: "not_linked", discordUserId };
		}

		return {
			status: "found",
			user: {
				userId: mapping.userId,
				employeeId: emp.id,
				organizationId: mapping.organizationId,
				discordUserId: mapping.discordUserId,
				discordUsername: mapping.discordUsername,
			},
		};
	}

	return { status: "not_linked", discordUserId };
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
		.update(discordLinkCode)
		.set({ status: "expired" })
		.where(
			and(
				eq(discordLinkCode.userId, userId),
				eq(discordLinkCode.organizationId, organizationId),
				eq(discordLinkCode.status, "pending"),
			),
		);

	// Generate a random 6-character alphanumeric code
	const code = generateRandomCode(LINK_CODE_LENGTH);
	const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);

	await db.insert(discordLinkCode).values({
		userId,
		organizationId,
		code,
		expiresAt,
		status: "pending",
	});

	logger.info({ userId, organizationId, codeLength: code.length }, "Discord link code generated");

	return { code, expiresAt };
}

/**
 * Claim a link code (called when user sends /link CODE to the bot).
 * Returns the Z8 user info if successful.
 */
export async function claimLinkCode(
	code: string,
	discordUserId: string,
	organizationId: string,
	discordUsername?: string,
	discordDisplayName?: string,
): Promise<
	| { status: "success"; userId: string; employeeId: string }
	| { status: "invalid_code" }
	| { status: "expired" }
	| { status: "already_linked" }
> {
	// Find the link code
	const linkCode = await db.query.discordLinkCode.findFirst({
		where: and(
			eq(discordLinkCode.code, code.toUpperCase()),
			eq(discordLinkCode.organizationId, organizationId),
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
			.update(discordLinkCode)
			.set({ status: "expired" })
			.where(eq(discordLinkCode.id, linkCode.id));
		return { status: "expired" };
	}

	// Check if this Discord user is already linked to another Z8 user in this org
	const existingMapping = await db.query.discordUserMapping.findFirst({
		where: and(
			eq(discordUserMapping.discordUserId, discordUserId),
			eq(discordUserMapping.organizationId, organizationId),
			eq(discordUserMapping.isActive, true),
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

	// Create the user mapping (with race condition handling)
	try {
		await db.insert(discordUserMapping).values({
			userId: linkCode.userId,
			organizationId,
			discordUserId,
			discordUsername: discordUsername || null,
			discordDisplayName: discordDisplayName || null,
			isActive: true,
		});
	} catch (error) {
		// Unique constraint violation = concurrent claim
		if (error instanceof Error && error.message.includes("unique")) {
			return { status: "already_linked" };
		}
		throw error;
	}

	// Mark code as used
	await db
		.update(discordLinkCode)
		.set({
			status: "used",
			claimedByDiscordUserId: discordUserId,
			claimedAt: new Date(),
		})
		.where(eq(discordLinkCode.id, linkCode.id));

	logger.info(
		{ userId: linkCode.userId, discordUserId, organizationId },
		"Discord account linked via code",
	);

	return { status: "success", userId: linkCode.userId, employeeId: emp.id };
}

/**
 * Unlink a Discord account
 */
export async function unlinkDiscordUser(userId: string, organizationId: string): Promise<boolean> {
	const result = await db
		.update(discordUserMapping)
		.set({ isActive: false })
		.where(
			and(
				eq(discordUserMapping.userId, userId),
				eq(discordUserMapping.organizationId, organizationId),
			),
		)
		.returning({ id: discordUserMapping.id });

	return result.length > 0;
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
