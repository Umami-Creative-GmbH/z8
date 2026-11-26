/**
 * Slack Bot Config Resolver
 *
 * Resolves organization workspace configuration from the database.
 * Bot access tokens are stored in HashiCorp Vault, not in the database.
 */

import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { chatInstallation, slackWorkspaceConfig } from "@/db/schema";
import {
	type ChatDispatchTargetHint,
	listSwitchedActiveChatInstallationsForProvider,
	readInstallationRevisionSecret,
	resolveSwitchedActiveChatInstallation,
	type SwitchedActiveChatInstallation,
} from "@/lib/chat-installations/runtime-target";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import type { ResolvedSlackBot } from "./types";

const logger = createLogger("SlackBotConfig");

const VAULT_KEY = "slack/bot_access_token";

async function hydrateSwitchedSlackBot(
	target: SwitchedActiveChatInstallation,
): Promise<ResolvedSlackBot | null> {
	if (!target.credentialRevisionId) return null;
	const botAccessToken = await readInstallationRevisionSecret({
		organizationId: target.organizationId,
		installationId: target.installationId,
		credentialRevisionId: target.credentialRevisionId,
		secretKeyNames: ["bot_access_token", "bot_token"],
	});
	if (!botAccessToken) {
		logger.error(
			{
				organizationId: target.organizationId,
				installationId: target.installationId,
				credentialRevisionId: target.credentialRevisionId,
			},
			"Active organization-owned Slack bot token not found in secret store",
		);
		return null;
	}

	return {
		organizationId: target.organizationId,
		installationId: target.installationId,
		botAccessToken,
		slackTeamId: target.externalSpaceId ?? "",
		slackTeamName: target.externalSpaceName,
		botUserId: target.externalBotId,
		setupStatus: "active",
		...target.effectiveSettings,
	};
}

/**
 * Get bot config for an organization.
 * Prefers a switched active organization-owned chat installation (or an explicit
 * durable dispatch target) and falls back to the legacy workspace config.
 */
export async function getBotConfigByOrganization(
	organizationId: string,
	options?: ChatDispatchTargetHint,
): Promise<ResolvedSlackBot | null> {
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "slack", options);
	if (resolution.kind === "organization_owned_active") {
		return hydrateSwitchedSlackBot(resolution.target);
	}

	const config = await db.query.slackWorkspaceConfig.findFirst({
		where: eq(slackWorkspaceConfig.organizationId, organizationId),
	});

	if (!config) return null;

	return hydrateBot(config);
}

/**
 * Get bot config by Slack workspace/team ID for legacy deployment-managed endpoints.
 * Keeps verified legacy callbacks working for eligible non-replaced installations,
 * allows retiring legacy installations ONLY when `options.allowRetiring` is true
 * (e.g. old-card interactions before the 30-day retirement deadline), and blocks
 * retired/revoked or superseded legacy routes.
 */
export async function getBotConfigByTeamId(
	slackTeamId: string,
	options?: { allowRetiring?: boolean; now?: Date },
): Promise<ResolvedSlackBot | null> {
	const config = await db.query.slackWorkspaceConfig.findFirst({
		where: and(
			eq(slackWorkspaceConfig.slackTeamId, slackTeamId),
			eq(slackWorkspaceConfig.setupStatus, "active"),
		),
	});

	if (!config) return null;

	let legacyInstallationId: string | null = null;
	if (typeof db.select === "function") {
		const installations = await db
			.select()
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, config.organizationId),
					eq(chatInstallation.provider, "slack"),
				),
			);

		if (installations.length > 0) {
			const legacyInst = installations.find(
				(row) => row.legacyTable === "slack_workspace_config" && row.legacyRecordId === config.id,
			);
			const hasActiveOrgOwned = installations.some(
				(row) => row.status === "active" && row.credentialSource === "organization_owned",
			);

			if (legacyInst) {
				legacyInstallationId = legacyInst.id;
				if (legacyInst.status === "retired" || legacyInst.status === "revoked") {
					return null;
				}
				if (legacyInst.status === "retiring") {
					if (!options?.allowRetiring) return null;
					const now = options?.now ?? new Date();
					if (
						legacyInst.revokedAt !== null ||
						(legacyInst.retirementDeadlineAt !== null &&
							Temporal.Instant.compare(
								instantFromDate(legacyInst.retirementDeadlineAt),
								instantFromDate(now),
							) <= 0)
					) {
						return null;
					}
				}
			} else if (hasActiveOrgOwned && !options?.allowRetiring) {
				return null;
			}
		}
	}

	const bot = await hydrateBot(config);
	if (!bot) return null;
	return legacyInstallationId ? { ...bot, installationId: legacyInstallationId } : bot;
}

/**
 * Check if Slack is enabled for an organization
 */
export async function isSlackEnabledForOrganization(organizationId: string): Promise<boolean> {
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "slack");
	if (resolution.kind === "organization_owned_active") {
		return true;
	}

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
 * Get all active Slack workspace configs (for cron jobs).
 * Switched organizations resolve from their active organization-owned installation;
 * unswitched organizations continue using their active legacy workspace config.
 */
export async function getAllActiveBotConfigs(): Promise<ResolvedSlackBot[]> {
	const switchedInstallations = await listSwitchedActiveChatInstallationsForProvider("slack");
	const switchedOrgIds = new Set(switchedInstallations.map((inst) => inst.organizationId));
	const switchedBots = await Promise.all(switchedInstallations.map(hydrateSwitchedSlackBot));

	const configs = await db.query.slackWorkspaceConfig.findMany({
		where: eq(slackWorkspaceConfig.setupStatus, "active"),
	});
	const legacyConfigs = configs.filter((config) => !switchedOrgIds.has(config.organizationId));
	const legacyBots = await Promise.all(legacyConfigs.map(hydrateBot));

	return [...switchedBots, ...legacyBots].filter((bot): bot is ResolvedSlackBot => bot !== null);
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
