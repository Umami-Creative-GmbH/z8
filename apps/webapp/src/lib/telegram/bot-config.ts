/**
 * Telegram Bot Config Resolver
 *
 * Resolves organization bot configuration from the database.
 * Bot tokens are stored in HashiCorp Vault, not in the database.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { telegramBotConfig } from "@/db/schema";
import {
	type ChatDispatchTargetHint,
	listSwitchedActiveChatInstallationsForProvider,
	readInstallationRevisionSecret,
	resolveSwitchedActiveChatInstallation,
	type SwitchedActiveChatInstallation,
} from "@/lib/chat-installations/runtime-target";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import type { ResolvedTelegramBot } from "./types";

const logger = createLogger("TelegramBotConfig");

const VAULT_KEY = "telegram/bot_token";

async function hydrateSwitchedTelegramBot(
	target: SwitchedActiveChatInstallation,
): Promise<ResolvedTelegramBot | null> {
	if (!target.credentialRevisionId) return null;
	const botToken = await readInstallationRevisionSecret({
		organizationId: target.organizationId,
		installationId: target.installationId,
		credentialRevisionId: target.credentialRevisionId,
		secretKeyNames: ["bot_token"],
	});
	if (!botToken) {
		logger.error(
			{
				organizationId: target.organizationId,
				installationId: target.installationId,
				credentialRevisionId: target.credentialRevisionId,
			},
			"Active organization-owned Telegram bot token not found in secret store",
		);
		return null;
	}

	return {
		organizationId: target.organizationId,
		botToken,
		botUsername: target.externalBotUsername,
		webhookSecret: target.routeId,
		setupStatus: "active",
		...target.effectiveSettings,
	};
}

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

	return hydrateBot(config);
}

/**
 * Get bot config for an organization.
 * Prefers a switched active organization-owned chat installation (or explicit
 * durable dispatch target) and falls back to the legacy bot config.
 */
export async function getBotConfigByOrganization(
	organizationId: string,
	options?: ChatDispatchTargetHint,
): Promise<ResolvedTelegramBot | null> {
	const resolution = await resolveSwitchedActiveChatInstallation(
		organizationId,
		"telegram",
		options,
	);
	if (resolution.kind === "organization_owned_active") {
		return hydrateSwitchedTelegramBot(resolution.target);
	}

	const config = await db.query.telegramBotConfig.findFirst({
		where: eq(telegramBotConfig.organizationId, organizationId),
	});

	if (!config) return null;

	return hydrateBot(config);
}

/**
 * Check if Telegram is enabled for an organization
 */
export async function isTelegramEnabledForOrganization(organizationId: string): Promise<boolean> {
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "telegram");
	if (resolution.kind === "organization_owned_active") {
		return true;
	}

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
	const switchedInstallations = await listSwitchedActiveChatInstallationsForProvider("telegram");
	const switchedOrgIds = new Set(switchedInstallations.map((inst) => inst.organizationId));
	const switchedBots = await Promise.all(switchedInstallations.map(hydrateSwitchedTelegramBot));

	const configs = await db.query.telegramBotConfig.findMany({
		where: eq(telegramBotConfig.setupStatus, "active"),
	});
	const legacyConfigs = configs.filter((config) => !switchedOrgIds.has(config.organizationId));
	const legacyBots = await Promise.all(legacyConfigs.map(hydrateBot));

	return [...switchedBots, ...legacyBots].filter((bot): bot is ResolvedTelegramBot => bot !== null);
}

/**
 * Hydrate a bot config with the bot token from Vault.
 * Falls back to the DB column for configs that haven't been migrated yet.
 */
async function hydrateBot(
	config: typeof telegramBotConfig.$inferSelect,
): Promise<ResolvedTelegramBot | null> {
	let botToken = await getOrgSecret(config.organizationId, VAULT_KEY);

	// Fallback: read from DB column for pre-migration configs
	if (!botToken && config.botToken && config.botToken !== "vault:managed") {
		botToken = config.botToken;
		logger.warn(
			{ organizationId: config.organizationId },
			"Telegram bot token read from DB column — run migration to move to Vault",
		);
	}

	if (!botToken) {
		logger.error(
			{ organizationId: config.organizationId },
			"Telegram bot token not found in Vault or DB",
		);
		return null;
	}

	return {
		organizationId: config.organizationId,
		botToken,
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
