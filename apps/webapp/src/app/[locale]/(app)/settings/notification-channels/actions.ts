"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	chatInstallation,
	chatProviderSettings,
	discordBotConfig,
	slackWorkspaceConfig,
	teamsTenantConfig,
} from "@/db/schema";
import { env } from "@/env";
import {
	buildDiscordInteractionEndpointUrl,
	CHAT_INSTALLATION_PROVIDERS,
	type ChatProviderInventory,
	getOrganizationChatInstallationsInventory,
	getProviderChatInstallationInventory as loadProviderChatInstallationInventory,
	isChatInstallationSwitchEnabled,
	type OrganizationChatInstallationsInventory,
} from "@/lib/chat-installations";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import { deleteOrgSecret, getOrgSecret, storeOrgSecret } from "@/lib/vault";

const logger = createLogger("NotificationChannelSettings");

export interface NotificationChannelSettingsFormValues {
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface NotificationChannelConfig {
	setupStatus: string;
	displayName: string | null;
	enableApprovals: boolean;
	enableCommands: boolean;
	enableDailyDigest: boolean;
	enableEscalations: boolean;
	digestTime: string;
	digestTimezone: string;
	escalationTimeoutHours: number;
}

export interface DiscordNotificationChannelConfig extends NotificationChannelConfig {
	interactionUrl: string | null;
}

export interface DiscordConnectFormValues {
	botToken: string;
	applicationId: string;
	publicKey: string;
}

export interface DiscordConnectResult {
	applicationId: string;
	commandsRegistered: boolean;
	interactionUrl: string;
}

const notificationChannelSettingsSchema = z.object(
	{
		enableApprovals: z.boolean({ error: "Enable approvals must be a boolean" }),
		enableCommands: z.boolean({ error: "Enable commands must be a boolean" }),
		enableDailyDigest: z.boolean({ error: "Enable daily digest must be a boolean" }),
		enableEscalations: z.boolean({ error: "Enable escalations must be a boolean" }),
		digestTime: z
			.string({ error: "Digest time must use HH:mm format" })
			.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Digest time must use HH:mm format"),
		digestTimezone: z
			.string({ error: "Digest timezone is required" })
			.trim()
			.min(1, "Digest timezone is required")
			.refine(isValidIanaTimeZone, "Digest timezone must be a valid timezone"),
		escalationTimeoutHours: z
			.number({ error: "Escalation timeout must be at least 1 hour" })
			.int("Escalation timeout must be at least 1 hour")
			.min(1, "Escalation timeout must be at least 1 hour"),
	},
	"Settings are required",
) satisfies z.ZodType<NotificationChannelSettingsFormValues>;

const connectDiscordSchema = z.strictObject(
	{
		botToken: z.string({ error: "Bot token is required" }).trim().min(1, "Bot token is required"),
		applicationId: z
			.string({ error: "Application ID is required" })
			.trim()
			.min(1, "Application ID is required")
			.regex(/^\d+$/, "Application ID must be a numeric Discord ID"),
		publicKey: z
			.string({ error: "Public key is required" })
			.trim()
			.min(1, "Public key is required")
			.regex(/^[0-9a-fA-F]{64}$/, "Public key must be a 64-character hex string"),
	},
	"Discord credentials are required",
) satisfies z.ZodType<DiscordConnectFormValues>;

function discordServiceCall<T>(operation: string, message: string, run: () => Promise<T>) {
	return Effect.tryPromise({
		try: run,
		catch: (cause) =>
			new ExternalServiceError({
				message,
				service: "discord",
				operation,
				cause,
			}),
	});
}

function buildDiscordInteractionUrl(webhookSecret: string): string {
	const appUrl = (env.APP_URL || "https://z8-time.app").replace(/\/+$/, "");
	return `${appUrl}/api/discord/interactions/${webhookSecret}`;
}

function mapConfig(
	config:
		| (NotificationChannelSettingsFormValues & {
				setupStatus: string;
		  })
		| undefined,
	displayName: string | null | undefined,
): NotificationChannelConfig | null {
	if (!config) {
		return null;
	}

	return {
		setupStatus: config.setupStatus,
		displayName: displayName ?? null,
		enableApprovals: config.enableApprovals,
		enableCommands: config.enableCommands,
		enableDailyDigest: config.enableDailyDigest,
		enableEscalations: config.enableEscalations,
		digestTime: config.digestTime,
		digestTimezone: config.digestTimezone,
		escalationTimeoutHours: config.escalationTimeoutHours,
	};
}

export const getSlackNotificationChannelConfig = organizationAction(
	{ name: "notificationChannels.getSlackConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("notificationChannels.getSlackConfig", async () => {
				const authoritative = await dbService.db.query?.chatProviderSettings?.findFirst({
					where: and(
						eq(chatProviderSettings.organizationId, organizationId),
						eq(chatProviderSettings.provider, "slack"),
						eq(chatProviderSettings.isAuthoritative, true),
					),
				});
				if (authoritative) {
					const activeInst = authoritative.activeInstallationId
						? await dbService.db.query?.chatInstallation?.findFirst({
								where: and(
									eq(chatInstallation.id, authoritative.activeInstallationId),
									eq(chatInstallation.organizationId, organizationId),
								),
							})
						: undefined;
					return mapConfig(
						{
							setupStatus: activeInst?.status === "active" ? "active" : "disconnected",
							enableApprovals: authoritative.enableApprovals,
							enableCommands: authoritative.enableCommands,
							enableDailyDigest: authoritative.enableDailyDigest,
							enableEscalations: authoritative.enableEscalations,
							digestTime: authoritative.digestTime,
							digestTimezone: authoritative.digestTimezone,
							escalationTimeoutHours: authoritative.escalationTimeoutHours,
						},
						activeInst?.externalSpaceName ?? activeInst?.externalDisplayName ?? null,
					);
				}

				const config = await dbService.db.query.slackWorkspaceConfig.findFirst({
					where: eq(slackWorkspaceConfig.organizationId, organizationId),
				});
				return mapConfig(config, config?.slackTeamName);
			});
		}),
);

async function loadLegacyDiscordMutationBlock(
	db: Parameters<typeof isChatInstallationSwitchEnabled>[0] & {
		query?: {
			chatInstallation?: {
				findMany?: (
					...args: never[]
				) => Promise<Array<{ status: string; credentialSource: string }>>;
			};
		};
	},
	organizationId: string,
): Promise<"legacy_setup_superseded" | "migration_blocked" | null> {
	if (typeof (db as { select?: unknown }).select !== "function") {
		return null;
	}
	const switchEnabled = await isChatInstallationSwitchEnabled(db, organizationId, "discord");
	if (switchEnabled) {
		return "legacy_setup_superseded";
	}
	const installations = await db
		.select({
			status: chatInstallation.status,
			legacyTable: chatInstallation.legacyTable,
		})
		.from(chatInstallation)
		.where(
			and(
				eq(chatInstallation.organizationId, organizationId),
				eq(chatInstallation.provider, "discord"),
			),
		);
	if (
		installations.some(
			(row) => (row.status === "active" || row.status === "retiring") && row.legacyTable === null,
		)
	) {
		return "legacy_setup_superseded";
	}
	if (installations.some((row) => row.status === "remediation_required")) {
		return "migration_blocked";
	}
	return null;
}

export const getDiscordNotificationChannelConfig = organizationAction(
	{ name: "notificationChannels.getDiscordConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query("notificationChannels.getDiscordConfig", async () => {
				const authoritative = await dbService.db.query?.chatProviderSettings?.findFirst({
					where: and(
						eq(chatProviderSettings.organizationId, organizationId),
						eq(chatProviderSettings.provider, "discord"),
						eq(chatProviderSettings.isAuthoritative, true),
					),
				});
				if (authoritative) {
					const activeInst = authoritative.activeInstallationId
						? await dbService.db.query?.chatInstallation?.findFirst({
								where: and(
									eq(chatInstallation.id, authoritative.activeInstallationId),
									eq(chatInstallation.organizationId, organizationId),
								),
							})
						: undefined;
					const base = mapConfig(
						{
							setupStatus: activeInst?.status === "active" ? "active" : "disconnected",
							enableApprovals: authoritative.enableApprovals,
							enableCommands: authoritative.enableCommands,
							enableDailyDigest: authoritative.enableDailyDigest,
							enableEscalations: authoritative.enableEscalations,
							digestTime: authoritative.digestTime,
							digestTimezone: authoritative.digestTimezone,
							escalationTimeoutHours: authoritative.escalationTimeoutHours,
						},
						activeInst?.externalDisplayName ?? activeInst?.externalAppId ?? null,
					);
					if (!base) return null;
					return {
						...base,
						interactionUrl:
							activeInst?.status === "active" && activeInst.routeId
								? buildDiscordInteractionEndpointUrl(activeInst.routeId)
								: null,
					} satisfies DiscordNotificationChannelConfig;
				}

				const config = await dbService.db.query.discordBotConfig.findFirst({
					where: eq(discordBotConfig.organizationId, organizationId),
				});
				const base = mapConfig(config, config?.applicationId);
				if (!base) {
					return null;
				}
				const interactionUrl =
					config && config.setupStatus !== "disconnected" && config.webhookSecret
						? buildDiscordInteractionUrl(config.webhookSecret)
						: null;
				return {
					...base,
					interactionUrl,
				} satisfies DiscordNotificationChannelConfig;
			});
		}),
);

export const connectDiscordBot = organizationAction(
	{
		name: "notificationChannels.connectDiscord",
		requires: "orgAdmin",
		schema: connectDiscordSchema,
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const legacyBlock = yield* dbService.query(
				"notificationChannels.connectDiscord.checkLifecycle",
				() => loadLegacyDiscordMutationBlock(dbService.db, organizationId),
			);
			if (legacyBlock) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							legacyBlock === "migration_blocked"
								? "Resolve Discord migration blockers before modifying bot credentials."
								: "Use the organization-owned Discord lifecycle workflow (Prepare, Test, Switch, Rotate) to manage Discord bots.",
						refusal: legacyBlock,
					}),
				);
			}
			const { registerDiscordSlashCommands, verifyBotApplication } = yield* Effect.promise(
				() => import("@/lib/discord"),
			);

			const verification = yield* discordServiceCall(
				"verifyBotApplication",
				"Failed to connect Discord bot",
				() => verifyBotApplication(input.botToken),
			);
			if (verification.kind === "unauthorized") {
				return yield* Effect.fail(
					new ValidationError({
						message: "Invalid bot token. Please check your Discord bot credentials.",
						field: "botToken",
						refusal: "invalid_bot_token",
					}),
				);
			}
			if (verification.kind === "error") {
				return yield* Effect.fail(
					new ExternalServiceError({
						message: "Failed to connect Discord bot",
						service: "discord",
						operation: "verifyBotApplication",
						cause: { status: verification.status },
					}),
				);
			}

			if (verification.application.id !== input.applicationId) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Application ID does not match the provided bot token.",
						field: "applicationId",
						refusal: "application_id_mismatch",
					}),
				);
			}

			if (verification.application.verifyKey.toLowerCase() !== input.publicKey.toLowerCase()) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Public key does not match the Discord application.",
						field: "publicKey",
						refusal: "public_key_mismatch",
					}),
				);
			}

			const existing = yield* dbService.query("notificationChannels.getDiscordConfig", () =>
				dbService.db.query.discordBotConfig.findFirst({
					where: eq(discordBotConfig.organizationId, organizationId),
				}),
			);

			const previousToken =
				existing && existing.setupStatus !== "disconnected"
					? yield* discordServiceCall("readPreviousBotToken", "Failed to connect Discord bot", () =>
							getOrgSecret(organizationId, "discord/bot_token"),
						)
					: null;

			const webhookSecret = randomBytes(32).toString("hex");

			yield* discordServiceCall("storeBotToken", "Failed to connect Discord bot", () =>
				storeOrgSecret(organizationId, "discord/bot_token", input.botToken),
			);

			const configured = {
				botToken: "vault:managed",
				applicationId: input.applicationId,
				publicKey: input.publicKey,
				webhookSecret,
				interactionEndpointConfigured: false,
				setupStatus: "active",
				configuredByUserId: actor.userId,
				configuredAt: new Date(),
			};

			yield* dbService
				.query("notificationChannels.saveDiscordBotConfig", async () => {
					if (existing) {
						await dbService.db
							.update(discordBotConfig)
							.set(configured)
							.where(
								and(
									eq(discordBotConfig.id, existing.id),
									eq(discordBotConfig.organizationId, organizationId),
								),
							);
					} else {
						await dbService.db.insert(discordBotConfig).values({
							organizationId,
							...configured,
						});
					}
				})
				.pipe(
					Effect.catchCause((dbCause) =>
						Effect.gen(function* () {
							yield* Effect.tryPromise({
								try: () =>
									previousToken
										? storeOrgSecret(organizationId, "discord/bot_token", previousToken)
										: deleteOrgSecret(organizationId, "discord/bot_token"),
								catch: (rollbackError) => rollbackError,
							}).pipe(
								Effect.catch((rollbackError) => {
									logger.error(
										{ rollbackError, organizationId },
										"Failed to compensate Discord bot token in Vault after DB failure",
									);
									return Effect.void;
								}),
							);
							return yield* Effect.failCause(dbCause);
						}),
					),
				);

			const commandsRegistered = yield* Effect.tryPromise({
				try: () => registerDiscordSlashCommands(input.botToken, input.applicationId),
				catch: (error) => error,
			}).pipe(
				Effect.catch((error) => {
					logger.warn({ error, organizationId }, "Failed to register Discord slash commands");
					return Effect.succeed(false);
				}),
			);

			const interactionUrl = buildDiscordInteractionUrl(webhookSecret);

			revalidatePath("/settings/notification-channels");

			logger.info(
				{ organizationId, applicationId: input.applicationId, commandsRegistered },
				"Discord bot configured via settings",
			);

			return {
				applicationId: input.applicationId,
				commandsRegistered,
				interactionUrl,
			} satisfies DiscordConnectResult;
		}),
);

export const disconnectDiscordBot = organizationAction(
	{
		name: "notificationChannels.disconnectDiscord",
		requires: "orgAdmin",
		schema: noInput,
	},
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const legacyBlock = yield* dbService.query(
				"notificationChannels.disconnectDiscord.checkLifecycle",
				() => loadLegacyDiscordMutationBlock(dbService.db, organizationId),
			);
			if (legacyBlock) {
				return yield* Effect.fail(
					new ValidationError({
						message:
							legacyBlock === "migration_blocked"
								? "Resolve Discord migration blockers before disconnecting the bot."
								: "Use the Discord installation revoke action to disconnect an organization-owned Discord bot.",
						refusal: legacyBlock,
					}),
				);
			}
			const config = yield* dbService.query("notificationChannels.getDiscordConfig", () =>
				dbService.db.query.discordBotConfig.findFirst({
					where: eq(discordBotConfig.organizationId, organizationId),
				}),
			);

			if (config) {
				yield* dbService.query("notificationChannels.markDiscordDisconnected", () =>
					dbService.db
						.update(discordBotConfig)
						.set({
							setupStatus: "disconnected",
							interactionEndpointConfigured: false,
						})
						.where(
							and(
								eq(discordBotConfig.id, config.id),
								eq(discordBotConfig.organizationId, organizationId),
							),
						),
				);

				yield* discordServiceCall("deleteBotToken", "Failed to disconnect Discord bot", () =>
					deleteOrgSecret(organizationId, "discord/bot_token"),
				);
			}

			revalidatePath("/settings/notification-channels");

			logger.info({ organizationId }, "Discord bot disconnected via settings");
			return undefined;
		}),
);

export const getTeamsNotificationChannelConfig = organizationAction(
	{ name: "notificationChannels.getTeamsConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("notificationChannels.getTeamsConfig", () =>
				dbService.db.query.teamsTenantConfig.findFirst({
					where: eq(teamsTenantConfig.organizationId, organizationId),
				}),
			);
			return mapConfig(config, config?.tenantName);
		}),
);

export const updateSlackNotificationChannelSettings = organizationAction(
	{
		name: "notificationChannels.updateSlackSettings",
		requires: "orgAdmin",
		schema: notificationChannelSettingsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.updateSlackSettings", async () => {
				const authoritative = await dbService.db.query?.chatProviderSettings?.findFirst({
					where: and(
						eq(chatProviderSettings.organizationId, organizationId),
						eq(chatProviderSettings.provider, "slack"),
						eq(chatProviderSettings.isAuthoritative, true),
					),
				});
				if (authoritative) {
					await dbService.db
						.update(chatProviderSettings)
						.set(input)
						.where(
							and(
								eq(chatProviderSettings.id, authoritative.id),
								eq(chatProviderSettings.organizationId, organizationId),
							),
						);
					return;
				}
				await dbService.db
					.update(slackWorkspaceConfig)
					.set(input)
					.where(eq(slackWorkspaceConfig.organizationId, organizationId));
			});
			revalidatePath("/settings/notification-channels");
			return undefined;
		}),
);

export const updateDiscordNotificationChannelSettings = organizationAction(
	{
		name: "notificationChannels.updateDiscordSettings",
		requires: "orgAdmin",
		schema: notificationChannelSettingsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.updateDiscordSettings", async () => {
				const authoritative = await dbService.db.query?.chatProviderSettings?.findFirst({
					where: and(
						eq(chatProviderSettings.organizationId, organizationId),
						eq(chatProviderSettings.provider, "discord"),
						eq(chatProviderSettings.isAuthoritative, true),
					),
				});
				if (authoritative) {
					await dbService.db
						.update(chatProviderSettings)
						.set(input)
						.where(
							and(
								eq(chatProviderSettings.id, authoritative.id),
								eq(chatProviderSettings.organizationId, organizationId),
							),
						);
					return;
				}
				await dbService.db
					.update(discordBotConfig)
					.set(input)
					.where(eq(discordBotConfig.organizationId, organizationId));
			});
			revalidatePath("/settings/notification-channels");
			return undefined;
		}),
);

export const updateTeamsNotificationChannelSettings = organizationAction(
	{
		name: "notificationChannels.updateTeamsSettings",
		requires: "orgAdmin",
		schema: notificationChannelSettingsSchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("notificationChannels.updateTeamsSettings", () =>
				dbService.db
					.update(teamsTenantConfig)
					.set(input)
					.where(eq(teamsTenantConfig.organizationId, organizationId)),
			);
			revalidatePath("/settings/notification-channels");
			return undefined;
		}),
);

export const getChatInstallationsInventory = organizationAction(
	{ name: "notificationChannels.getInventory", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.getInventory",
				(): Promise<OrganizationChatInstallationsInventory> =>
					getOrganizationChatInstallationsInventory(organizationId, { db: dbService.db }),
			);
		}),
);

const providerInventorySchema = z.strictObject({
	provider: z.enum(CHAT_INSTALLATION_PROVIDERS),
});

export const getProviderChatInstallationInventory = organizationAction(
	{
		name: "notificationChannels.getProviderInventory",
		requires: "orgAdmin",
		schema: providerInventorySchema,
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			return yield* dbService.query(
				"notificationChannels.getProviderInventory",
				(): Promise<ChatProviderInventory> =>
					loadProviderChatInstallationInventory(organizationId, input.provider, {
						db: dbService.db,
					}),
			);
		}),
);
