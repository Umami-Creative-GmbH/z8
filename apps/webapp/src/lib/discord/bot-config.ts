/**
 * Discord Bot Config Resolver
 *
 * Resolves organization bot configuration from the database.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discordBotConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedDiscordBot } from "./types";

const _logger = createLogger("DiscordBotConfig");

/**
 * Resolve bot config by webhook secret (used in interaction route)
 */
export async function resolveBotByWebhookSecret(
	webhookSecret: string,
): Promise<ResolvedDiscordBot | null> {
	const config = await db.query.discordBotConfig.findFirst({
		where: and(
			eq(discordBotConfig.webhookSecret, webhookSecret),
			eq(discordBotConfig.setupStatus, "active"),
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
): Promise<ResolvedDiscordBot | null> {
	const config = await db.query.discordBotConfig.findFirst({
		where: eq(discordBotConfig.organizationId, organizationId),
	});

	if (!config) return null;

	return mapToResolvedBot(config);
}

/**
 * Check if Discord is enabled for an organization
 */
export async function isDiscordEnabledForOrganization(organizationId: string): Promise<boolean> {
	const config = await db.query.discordBotConfig.findFirst({
		where: and(
			eq(discordBotConfig.organizationId, organizationId),
			eq(discordBotConfig.setupStatus, "active"),
		),
		columns: { id: true },
	});

	return !!config;
}

/**
 * Get all active Discord bot configs (for cron jobs)
 */
export async function getAllActiveBotConfigs(): Promise<ResolvedDiscordBot[]> {
	const configs = await db.query.discordBotConfig.findMany({
		where: eq(discordBotConfig.setupStatus, "active"),
	});

	return configs.map(mapToResolvedBot);
}

function mapToResolvedBot(config: typeof discordBotConfig.$inferSelect): ResolvedDiscordBot {
	return {
		organizationId: config.organizationId,
		botToken: config.botToken,
		applicationId: config.applicationId,
		publicKey: config.publicKey,
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
