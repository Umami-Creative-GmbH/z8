/**
 * Discord Bot Config Resolver
 *
 * Resolves organization bot configuration from the database.
 * Bot tokens are stored in HashiCorp Vault, not in the database.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { discordBotConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import type { ResolvedDiscordBot } from "./types";

const logger = createLogger("DiscordBotConfig");

const VAULT_KEY = "discord/bot_token";

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

	return hydrateBot(config);
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

	return hydrateBot(config);
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

	const results = await Promise.all(configs.map(hydrateBot));
	return results.filter((bot): bot is ResolvedDiscordBot => bot !== null);
}

/**
 * Hydrate a bot config with the bot token from Vault.
 * Falls back to the DB column for configs that haven't been migrated yet.
 */
async function hydrateBot(
	config: typeof discordBotConfig.$inferSelect,
): Promise<ResolvedDiscordBot | null> {
	let botToken = await getOrgSecret(config.organizationId, VAULT_KEY);

	// Fallback: read from DB column for pre-migration configs
	if (!botToken && config.botToken && config.botToken !== "vault:managed") {
		botToken = config.botToken;
		logger.warn(
			{ organizationId: config.organizationId },
			"Discord bot token read from DB column — run migration to move to Vault",
		);
	}

	if (!botToken) {
		logger.error(
			{ organizationId: config.organizationId },
			"Discord bot token not found in Vault or DB",
		);
		return null;
	}

	return {
		organizationId: config.organizationId,
		botToken,
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
