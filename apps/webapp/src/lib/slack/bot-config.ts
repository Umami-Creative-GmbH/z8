/**
 * Slack Bot Config Resolver
 *
 * Resolves organization workspace configuration from the database.
 * Mirrors telegram/bot-config.ts pattern.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { slackWorkspaceConfig } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import type { ResolvedSlackBot } from "./types";

const _logger = createLogger("SlackBotConfig");

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

	return mapToResolvedBot(config);
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

	return mapToResolvedBot(config);
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

	return configs.map(mapToResolvedBot);
}

function mapToResolvedBot(config: typeof slackWorkspaceConfig.$inferSelect): ResolvedSlackBot {
	return {
		organizationId: config.organizationId,
		botAccessToken: config.botAccessToken,
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
