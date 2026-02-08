/**
 * Telegram Bot Config Resolver
 *
 * Resolves organization bot configuration from the database.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramBotConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedTelegramBot } from "./types";

const logger = createLogger("TelegramBotConfig");

/**
 * Resolve bot config by webhook secret (used in webhook route)
 */
export async function resolveBotByWebhookSecret(
	webhookSecret: string,
): Promise<ResolvedTelegramBot | null> {
	const config = await db.query.telegramBotConfig.findFirst({
		where: and(
			eq(telegramBotConfig.webhookSecret, webhookSecret),
			eq(telegramBotConfig.setupStatus, "active"),
		),
	});

	if (!config) return null;

	return mapToResolvedBot(config);
}

/**
 * Get bot config for an organization
 */
export async function getBotConfigByOrganization(
	organizationId: string,
): Promise<ResolvedTelegramBot | null> {
	const config = await db.query.telegramBotConfig.findFirst({
		where: eq(telegramBotConfig.organizationId, organizationId),
	});

	if (!config) return null;

	return mapToResolvedBot(config);
}

/**
 * Check if Telegram is enabled for an organization
 */
export async function isTelegramEnabledForOrganization(organizationId: string): Promise<boolean> {
	const config = await db.query.telegramBotConfig.findFirst({
		where: and(
			eq(telegramBotConfig.organizationId, organizationId),
			eq(telegramBotConfig.setupStatus, "active"),
		),
		columns: { id: true },
	});

	return !!config;
}

/**
 * Get all active Telegram bot configs (for cron jobs)
 */
export async function getAllActiveBotConfigs(): Promise<ResolvedTelegramBot[]> {
	const configs = await db.query.telegramBotConfig.findMany({
		where: eq(telegramBotConfig.setupStatus, "active"),
	});

	return configs.map(mapToResolvedBot);
}

function mapToResolvedBot(config: typeof telegramBotConfig.$inferSelect): ResolvedTelegramBot {
	return {
		organizationId: config.organizationId,
		botToken: config.botToken,
		botUsername: config.botUsername,
		webhookSecret: config.webhookSecret,
		setupStatus: config.setupStatus,
		enableApprovals: config.enableApprovals,
		enableCommands: config.enableCommands,
		enableDailyDigest: config.enableDailyDigest,
		enableEscalations: config.enableEscalations,
		digestTime: config.digestTime,
		digestTimezone: config.digestTimezone,
		escalationTimeoutHours: config.escalationTimeoutHours,
	};
}
