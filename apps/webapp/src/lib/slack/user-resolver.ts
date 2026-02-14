/**
 * Slack User Resolver
 *
 * Resolves Slack users to Z8 accounts via link codes.
 * Mirrors telegram/user-resolver.ts pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employee, slackLinkCode, slackUserMapping } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedSlackUser } from "./types";

const logger = createLogger("SlackUserResolver");

// ============================================
// USER RESOLUTION
// ============================================

export type SlackUserResolutionResult =
	| { status: "found"; user: ResolvedSlackUser }
	| { status: "not_linked"; slackUserId: string };

/**
 * Resolve a Slack user to a Z8 user within an organization
 */
export async function resolveSlackUser(
	slackUserId: string,
	slackTeamId: string,
	slackUsername?: string,
): Promise<SlackUserResolutionResult> {
	// Check existing mapping
	const mapping = await db.query.slackUserMapping.findFirst({
		where: and(
			eq(slackUserMapping.slackUserId, slackUserId),
			eq(slackUserMapping.slackTeamId, slackTeamId),
			eq(slackUserMapping.isActive, true),
		),
	});

	if (mapping) {
		// Update last seen and username if changed
		await db
			.update(slackUserMapping)
			.set({
				lastSeenAt: new Date(),
				...(slackUsername ? { slackUsername } : {}),
			})
			.where(eq(slackUserMapping.id, mapping.id));

		// Get employee ID
		const emp = await db.query.employee.findFirst({
			where: and(
				eq(employee.userId, mapping.userId),
				eq(employee.organizationId, mapping.organizationId),
			),
			columns: { id: true },
		});

		return {
			status: "found",
			user: {
				userId: mapping.userId,
				employeeId: emp?.id || "",
				organizationId: mapping.organizationId,
				slackUserId: mapping.slackUserId,
				slackTeamId: mapping.slackTeamId,
				slackUsername: mapping.slackUsername,
			},
		};
	}

	return { status: "not_linked", slackUserId };
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
		.update(slackLinkCode)
		.set({ status: "expired" })
		.where(
			and(
				eq(slackLinkCode.userId, userId),
				eq(slackLinkCode.organizationId, organizationId),
				eq(slackLinkCode.status, "pending"),
			),
		);

	// Generate a random 6-character alphanumeric code
	const code = generateRandomCode(LINK_CODE_LENGTH);
	const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);

	await db.insert(slackLinkCode).values({
		userId,
		organizationId,
		code,
		expiresAt,
		status: "pending",
	});

	logger.info({ userId, organizationId, codeLength: code.length }, "Slack link code generated");

	return { code, expiresAt };
}

/**
 * Claim a link code (called when user sends /link CODE in Slack).
 */
export async function claimLinkCode(
	code: string,
	slackUserId: string,
	slackTeamId: string,
	organizationId: string,
	slackUsername?: string,
	slackDisplayName?: string,
): Promise<
	| { status: "success"; userId: string; employeeId: string }
	| { status: "invalid_code" }
	| { status: "expired" }
	| { status: "already_linked" }
> {
	// Find the link code
	const linkCode = await db.query.slackLinkCode.findFirst({
		where: and(
			eq(slackLinkCode.code, code.toUpperCase()),
			eq(slackLinkCode.organizationId, organizationId),
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
			.update(slackLinkCode)
			.set({ status: "expired" })
			.where(eq(slackLinkCode.id, linkCode.id));
		return { status: "expired" };
	}

	// Check if this Slack user is already linked in this workspace
	const existingMapping = await db.query.slackUserMapping.findFirst({
		where: and(
			eq(slackUserMapping.slackUserId, slackUserId),
			eq(slackUserMapping.slackTeamId, slackTeamId),
			eq(slackUserMapping.isActive, true),
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
	await db.insert(slackUserMapping).values({
		userId: linkCode.userId,
		organizationId,
		slackUserId,
		slackTeamId,
		slackUsername: slackUsername || null,
		slackDisplayName: slackDisplayName || null,
		isActive: true,
	});

	// Mark code as used
	await db
		.update(slackLinkCode)
		.set({
			status: "used",
			claimedBySlackUserId: slackUserId,
			claimedAt: new Date(),
		})
		.where(eq(slackLinkCode.id, linkCode.id));

	logger.info(
		{ userId: linkCode.userId, slackUserId, organizationId },
		"Slack account linked via code",
	);

	return { status: "success", userId: linkCode.userId, employeeId: emp.id };
}

/**
 * Unlink a Slack account
 */
export async function unlinkSlackUser(userId: string, organizationId: string): Promise<boolean> {
	const result = await db
		.update(slackUserMapping)
		.set({ isActive: false })
		.where(
			and(eq(slackUserMapping.userId, userId), eq(slackUserMapping.organizationId, organizationId)),
		)
		.returning({ id: slackUserMapping.id });

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
