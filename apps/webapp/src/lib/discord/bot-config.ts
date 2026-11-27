/**
 * Discord Bot Config Resolver
 *
 * Resolves organization bot configuration from the database.
 * Bot tokens are stored in HashiCorp Vault, not in the database.
 */

import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { chatInstallation, discordBotConfig } from "@/db/schema";
import {
	type ChatDispatchTargetHint,
	listSwitchedActiveChatInstallationsForProvider,
	readInstallationRevisionSecret,
	resolveSwitchedActiveChatInstallation,
	type SwitchedActiveChatInstallation,
} from "@/lib/chat-installations/runtime-target";
import { instantFromDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { getOrgSecret } from "@/lib/vault";
import type { ResolvedDiscordBot } from "./types";

const logger = createLogger("DiscordBotConfig");

const VAULT_KEY = "discord/bot_token";

async function hydrateSwitchedDiscordBot(
	target: SwitchedActiveChatInstallation,
): Promise<ResolvedDiscordBot | null> {
	if (!target.credentialRevisionId) return null;
	const [botToken, publicKey] = await Promise.all([
		readInstallationRevisionSecret({
			organizationId: target.organizationId,
			installationId: target.installationId,
			credentialRevisionId: target.credentialRevisionId,
			secretKeyNames: ["bot_token"],
		}),
		readInstallationRevisionSecret({
			organizationId: target.organizationId,
			installationId: target.installationId,
			credentialRevisionId: target.credentialRevisionId,
			secretKeyNames: ["public_key"],
		}),
	]);
	if (!botToken) {
		logger.error(
			{
				organizationId: target.organizationId,
				installationId: target.installationId,
				credentialRevisionId: target.credentialRevisionId,
			},
			"Active organization-owned Discord bot token not found in secret store",
		);
		return null;
	}

	return {
		organizationId: target.organizationId,
		installationId: target.installationId,
		botToken,
		applicationId: target.externalAppId ?? "",
		publicKey: publicKey ?? "",
		webhookSecret: target.routeId,
		setupStatus: "active",
		...target.effectiveSettings,
	};
}

/**
 * Resolve bot config by webhook secret (used in legacy interaction route).
 * Respects chat_installation lifecycle state: refuses revoked/retired/expired-retiring
 * installations and tags active/retiring legacy installations with their `installationId`.
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

	let installationId: string | null = null;
	let effectiveStatus = config.setupStatus;

	if (typeof db.select === "function") {
		const [inst] = await db
			.select({
				id: chatInstallation.id,
				status: chatInstallation.status,
				revokedAt: chatInstallation.revokedAt,
				retiredAt: chatInstallation.retiredAt,
				retirementDeadlineAt: chatInstallation.retirementDeadlineAt,
			})
			.from(chatInstallation)
			.where(
				and(
					eq(chatInstallation.organizationId, config.organizationId),
					eq(chatInstallation.legacyTable, "discord_bot_config"),
					eq(chatInstallation.legacyRecordId, config.id),
				),
			)
			.limit(1);

		if (inst) {
			if (
				inst.status === "revoked" ||
				inst.status === "retired" ||
				inst.revokedAt ||
				inst.retiredAt
			) {
				return null;
			}
			if (inst.status === "retiring") {
				if (
					inst.retirementDeadlineAt &&
					Temporal.Instant.compare(
						instantFromDate(inst.retirementDeadlineAt),
						systemClock.nowInstant(),
					) <= 0
				) {
					return null;
				}
				effectiveStatus = "retiring";
			}
			installationId = inst.id;
		}
	}

	const hydrated = await hydrateBot(config);
	if (!hydrated) return null;
	return {
		...hydrated,
		...(installationId ? { installationId } : {}),
		setupStatus: effectiveStatus,
	};
}

/**
 * Get bot config for an organization.
 * Prefers a switched active organization-owned chat installation (or explicit
 * durable dispatch target) and falls back to the legacy bot config.
 */
export async function getBotConfigByOrganization(
	organizationId: string,
	options?: ChatDispatchTargetHint,
): Promise<ResolvedDiscordBot | null> {
	const resolution = await resolveSwitchedActiveChatInstallation(
		organizationId,
		"discord",
		options,
	);
	if (resolution.kind === "organization_owned_active") {
		return hydrateSwitchedDiscordBot(resolution.target);
	}

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
	const resolution = await resolveSwitchedActiveChatInstallation(organizationId, "discord");
	if (resolution.kind === "organization_owned_active") {
		return true;
	}

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
	const [switchedInstallations, configs] = await Promise.all([
		listSwitchedActiveChatInstallationsForProvider("discord"),
		db.query.discordBotConfig.findMany({
			where: eq(discordBotConfig.setupStatus, "active"),
		}),
	]);
	const switchedOrgIds = new Set(switchedInstallations.map((inst) => inst.organizationId));
	const legacyConfigs = configs.filter((config) => !switchedOrgIds.has(config.organizationId));
	const [switchedBots, legacyBots] = await Promise.all([
		Promise.all(switchedInstallations.map(hydrateSwitchedDiscordBot)),
		Promise.all(legacyConfigs.map(hydrateBot)),
	]);

	return [...switchedBots, ...legacyBots].filter((bot): bot is ResolvedDiscordBot => bot !== null);
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
