/**
 * Slack Bot Config Resolver
 *
 * Resolves organization workspace configuration from the database.
 * Bot access tokens are stored in HashiCorp Vault, not in the database.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { slackWorkspaceConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import type { ResolvedSlackBot } from "./types";

const logger = createLogger("SlackBotConfig");

const VAULT_KEY = "slack/bot_access_token";

/**
 * Get bot config for an organization
 */
export async function getBotConfigByOrganization(
	organizationId: string,
): Promise<ResolvedSlackBot | null> {
	const config = await db.query.slackWorkspaceConfig.findFirst({
		where: eq(slackWorkspaceConfig.organizationId, organizationId),
	});

	if (!config) return null;

	return hydrateBot(config);
}

/**
 * Get bot config by Slack workspace/team ID
 */
export async function getBotConfigByTeamId(slackTeamId: string): Promise<ResolvedSlackBot | null> {
	const config = await db.query.slackWorkspaceConfig.findFirst({
		where: and(
			eq(slackWorkspaceConfig.slackTeamId, slackTeamId),
			eq(slackWorkspaceConfig.setupStatus, "active"),
		),
	});

	if (!config) return null;

	return hydrateBot(config);
}

/**
 * Check if Slack is enabled for an organization
 */
export async function isSlackEnabledForOrganization(organizationId: string): Promise<boolean> {
	const config = await db.query.slackWorkspaceConfig.findFirst({
		where: and(
			eq(slackWorkspaceConfig.organizationId, organizationId),
			eq(slackWorkspaceConfig.setupStatus, "active"),
		),
		columns: { id: true },
	});

	return !!config;
}

/**
 * Get all active Slack workspace configs (for cron jobs)
 */
export async function getAllActiveBotConfigs(): Promise<ResolvedSlackBot[]> {
	const configs = await db.query.slackWorkspaceConfig.findMany({
		where: eq(slackWorkspaceConfig.setupStatus, "active"),
	});

	const results = await Promise.all(configs.map(hydrateBot));
	return results.filter((bot): bot is ResolvedSlackBot => bot !== null);
}

/**
 * Hydrate a bot config with the access token from Vault.
 * Falls back to the DB column for configs that haven't been migrated yet.
 */
async function hydrateBot(
	config: typeof slackWorkspaceConfig.$inferSelect,
): Promise<ResolvedSlackBot | null> {
	let botAccessToken = await getOrgSecret(config.organizationId, VAULT_KEY);

	// Fallback: read from DB column for pre-migration configs
	if (!botAccessToken && config.botAccessToken && config.botAccessToken !== "vault:managed") {
		botAccessToken = config.botAccessToken;
		logger.warn(
			{ organizationId: config.organizationId },
			"Slack bot access token read from DB column — run migration to move to Vault",
		);
	}

	if (!botAccessToken) {
		logger.error(
			{ organizationId: config.organizationId },
			"Slack bot access token not found in Vault or DB",
		);
		return null;
	}

	return {
		organizationId: config.organizationId,
		botAccessToken,
		slackTeamId: config.slackTeamId,
		slackTeamName: config.slackTeamName,
		botUserId: config.botUserId,
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
