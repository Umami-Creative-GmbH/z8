"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { telegramBotConfig, telegramUserMapping } from "@/db/schema";
import { requireUser } from "@/lib/auth-helpers";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TelegramSettings");

// ============================================
// TYPES
// ============================================

export interface TelegramConfig {
	botUsername: string | null;
	botDisplayName: string | null;
	setupStatus: string;
	webhookRegistered: boolean;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface TelegramUserLink {
	telegramUsername: string | null;
	telegramDisplayName: string | null;
	isActive: boolean;
}

export interface TelegramSettingsFormValues {
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

type ActionResult<T = void> = { success: true; data: T } | { success: false; error: string };

// ============================================
// HELPERS
// ============================================

async function requireAdmin(organizationId: string) {
	const authContext = await requireUser();
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
		throw new Error("Unauthorized");
	}

	return authContext;
}

// ============================================
// GET CONFIG
// ============================================

export async function getTelegramConfig(
	organizationId: string,
): Promise<ActionResult<TelegramConfig | null>> {
	try {
		await requireAdmin(organizationId);

		const config = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (!config || config.setupStatus === "disconnected") {
			return { success: true, data: null };
		}

		return {
			success: true,
			data: {
				botUsername: config.botUsername,
				botDisplayName: config.botDisplayName,
				setupStatus: config.setupStatus,
				webhookRegistered: config.webhookRegistered,
				enableApprovals: config.enableApprovals,
				enableCommands: config.enableCommands,
				enableDailyDigest: config.enableDailyDigest,
				enableEscalations: config.enableEscalations,
				digestTime: config.digestTime,
				digestTimezone: config.digestTimezone,
				escalationTimeoutHours: config.escalationTimeoutHours,
			},
		};
	} catch {
		return { success: false, error: "Failed to fetch Telegram configuration" };
	}
}

// ============================================
// SETUP BOT
// ============================================

export async function setupTelegramBot(
	botToken: string,
	organizationId: string,
): Promise<ActionResult<{ botUsername: string | null; botDisplayName: string }>> {
	try {
		const authContext = await requireAdmin(organizationId);

		if (!botToken?.trim()) {
			return { success: false, error: "Bot token is required" };
		}

		// Verify the bot token with Telegram
		const { getMe, setWebhook } = await import("@/lib/telegram");

		const botInfo = await getMe(botToken);
		if (!botInfo) {
			return { success: false, error: "Invalid bot token. Please check your BotFather token." };
		}

		// Generate webhook secret
		const webhookSecret = randomBytes(32).toString("hex");

		// Check if config already exists
		const existing = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (existing) {
			await db
				.update(telegramBotConfig)
				.set({
					botToken,
					botUsername: botInfo.username || null,
					botDisplayName: botInfo.first_name,
					webhookSecret,
					setupStatus: "active",
					webhookRegistered: false,
					configuredByUserId: authContext.user.id,
					configuredAt: new Date(),
				})
				.where(eq(telegramBotConfig.id, existing.id));
		} else {
			await db.insert(telegramBotConfig).values({
				organizationId,
				botToken,
				botUsername: botInfo.username || null,
				botDisplayName: botInfo.first_name,
				webhookSecret,
				setupStatus: "active",
				configuredByUserId: authContext.user.id,
				configuredAt: new Date(),
			});
		}

		// Register webhook with Telegram
		const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";
		const webhookUrl = `${appUrl}/api/telegram/webhook/${webhookSecret}`;

		const webhookRegistered = await setWebhook(botToken, webhookUrl, webhookSecret);

		if (webhookRegistered) {
			await db
				.update(telegramBotConfig)
				.set({ webhookRegistered: true })
				.where(eq(telegramBotConfig.organizationId, organizationId));
		}

		logger.info(
			{ organizationId, botUsername: botInfo.username, webhookRegistered },
			"Telegram bot configured via settings",
		);

		return {
			success: true,
			data: {
				botUsername: botInfo.username || null,
				botDisplayName: botInfo.first_name,
			},
		};
	} catch (error) {
		logger.error({ error }, "Telegram setup failed");
		return { success: false, error: "Failed to set up Telegram bot" };
	}
}

// ============================================
// UPDATE SETTINGS
// ============================================

export async function updateTelegramSettings(
	organizationId: string,
	settings: TelegramSettingsFormValues,
): Promise<ActionResult> {
	try {
		await requireAdmin(organizationId);

		await db
			.update(telegramBotConfig)
			.set({
				enableApprovals: settings.enableApprovals,
				enableCommands: settings.enableCommands,
				enableDailyDigest: settings.enableDailyDigest,
				enableEscalations: settings.enableEscalations,
				digestTime: settings.digestTime,
				digestTimezone: settings.digestTimezone,
				escalationTimeoutHours: settings.escalationTimeoutHours,
			})
			.where(eq(telegramBotConfig.organizationId, organizationId));

		return { success: true, data: undefined };
	} catch {
		return { success: false, error: "Failed to update Telegram settings" };
	}
}

// ============================================
// DISCONNECT BOT
// ============================================

export async function disconnectTelegramBot(organizationId: string): Promise<ActionResult> {
	try {
		await requireAdmin(organizationId);

		const config = await db.query.telegramBotConfig.findFirst({
			where: eq(telegramBotConfig.organizationId, organizationId),
		});

		if (config) {
			// Remove webhook from Telegram
			const { deleteWebhook } = await import("@/lib/telegram");
			await deleteWebhook(config.botToken);

			// Mark as disconnected
			await db
				.update(telegramBotConfig)
				.set({
					setupStatus: "disconnected",
					webhookRegistered: false,
				})
				.where(eq(telegramBotConfig.id, config.id));
		}

		logger.info({ organizationId }, "Telegram bot disconnected via settings");

		return { success: true, data: undefined };
	} catch {
		return { success: false, error: "Failed to disconnect Telegram bot" };
	}
}

// ============================================
// USER LINKING
// ============================================

export async function getUserTelegramLink(
	userId: string,
	organizationId: string,
): Promise<ActionResult<TelegramUserLink | null>> {
	try {
		// Verify the caller is the user requesting their own link status
		const authContext = await requireUser();
		if (authContext.user.id !== userId) {
			return { success: false, error: "Unauthorized" };
		}

		const mapping = await db.query.telegramUserMapping.findFirst({
			where: and(
				eq(telegramUserMapping.userId, userId),
				eq(telegramUserMapping.organizationId, organizationId),
				eq(telegramUserMapping.isActive, true),
			),
		});

		if (!mapping) {
			return { success: true, data: null };
		}

		return {
			success: true,
			data: {
				telegramUsername: mapping.telegramUsername,
				telegramDisplayName: mapping.telegramDisplayName,
				isActive: mapping.isActive,
			},
		};
	} catch {
		return { success: false, error: "Failed to get Telegram link status" };
	}
}

export async function generateTelegramLinkCode(
	userId: string,
	organizationId: string,
): Promise<ActionResult<{ code: string; expiresAt: string }>> {
	try {
		const authContext = await requireUser();
		if (authContext.user.id !== userId) {
			return { success: false, error: "Unauthorized" };
		}

		const { generateLinkCode, isTelegramEnabledForOrganization } = await import("@/lib/telegram");

		const enabled = await isTelegramEnabledForOrganization(organizationId);
		if (!enabled) {
			return { success: false, error: "Telegram is not configured for this organization" };
		}

		const { code, expiresAt } = await generateLinkCode(userId, organizationId);

		return {
			success: true,
			data: { code, expiresAt: expiresAt.toISOString() },
		};
	} catch {
		return { success: false, error: "Failed to generate link code" };
	}
}

export async function unlinkTelegramAccount(
	userId: string,
	organizationId: string,
): Promise<ActionResult> {
	try {
		const authContext = await requireUser();
		if (authContext.user.id !== userId) {
			return { success: false, error: "Unauthorized" };
		}

		const { unlinkTelegramUser } = await import("@/lib/telegram");

		await unlinkTelegramUser(userId, organizationId);

		return { success: true, data: undefined };
	} catch {
		return { success: false, error: "Failed to unlink Telegram account" };
	}
}
