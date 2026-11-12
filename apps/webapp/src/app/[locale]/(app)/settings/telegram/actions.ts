"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";
import { telegramBotConfig, telegramUserMapping } from "@/db/schema";
import { env } from "@/env";
import { ExternalServiceError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { isValidIanaTimeZone } from "@/lib/timezone/validation";
import { deleteOrgSecret, getOrgSecret, storeOrgSecret } from "@/lib/vault";

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

const telegramSettingsSchema = z.object(
	{
		enableApprovals: z.boolean("Enable approvals must be a boolean"),
		enableCommands: z.boolean("Enable commands must be a boolean"),
		enableDailyDigest: z.boolean("Enable daily digest must be a boolean"),
		enableEscalations: z.boolean("Enable escalations must be a boolean"),
		digestTime: z
			.string("Digest time must use HH:mm format")
			.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Digest time must use HH:mm format"),
		digestTimezone: z
			.string("Digest timezone must be a valid timezone")
			.refine(isValidIanaTimeZone, "Digest timezone must be a valid timezone"),
		escalationTimeoutHours: z
			.number("Escalation timeout must be at least 1 hour")
			.int("Escalation timeout must be at least 1 hour")
			.min(1, "Escalation timeout must be at least 1 hour"),
	},
	"Settings are required",
) satisfies z.ZodType<TelegramSettingsFormValues>;

/** A failed call to Telegram or the secret store, with a message safe to show users. */
function telegramFailure(operation: string, message: string) {
	return (cause: unknown) =>
		new ExternalServiceError({ message, service: "telegram", operation, cause });
}

function telegram<T>(operation: string, message: string, run: () => Promise<T>) {
	return Effect.tryPromise({ try: run, catch: telegramFailure(operation, message) });
}

// ============================================
// BOT CONFIGURATION (org admins)
// ============================================

export const getTelegramConfig = organizationAction(
	{ name: "telegram.getConfig", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("telegram.getConfig", () =>
				dbService.db.query.telegramBotConfig.findFirst({
					where: eq(telegramBotConfig.organizationId, organizationId),
				}),
			);

			if (!config || config.setupStatus === "disconnected") {
				return null;
			}

			return {
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
			} satisfies TelegramConfig;
		}),
);

export const setupTelegramBot = organizationAction(
	{
		name: "telegram.setupBot",
		requires: "orgAdmin",
		schema: z.strictObject({
			botToken: z.string().trim().min(1, "Bot token is required"),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const { getMe, setWebhook } = yield* Effect.promise(() => import("@/lib/telegram"));

			// Verify the bot token with Telegram
			const botInfo = yield* telegram("getMe", "Failed to set up Telegram bot", () =>
				getMe(input.botToken),
			);
			if (!botInfo) {
				return yield* Effect.fail(
					new ValidationError({
						message: "Invalid bot token. Please check your BotFather token.",
						field: "botToken",
					}),
				);
			}

			const webhookSecret = randomBytes(32).toString("hex");
			yield* telegram("storeBotToken", "Failed to set up Telegram bot", () =>
				storeOrgSecret(organizationId, "telegram/bot_token", input.botToken),
			);

			const configured = {
				botToken: "vault:managed",
				botUsername: botInfo.username || null,
				botDisplayName: botInfo.first_name,
				webhookSecret,
				setupStatus: "active",
				webhookRegistered: false,
				configuredByUserId: actor.userId,
				configuredAt: new Date(),
			};
			yield* dbService.query("telegram.saveBotConfig", async () => {
				const existing = await dbService.db.query.telegramBotConfig.findFirst({
					where: eq(telegramBotConfig.organizationId, organizationId),
				});
				if (existing) {
					await dbService.db
						.update(telegramBotConfig)
						.set(configured)
						.where(
							and(
								eq(telegramBotConfig.id, existing.id),
								eq(telegramBotConfig.organizationId, organizationId),
							),
						);
				} else {
					await dbService.db.insert(telegramBotConfig).values({ organizationId, ...configured });
				}
			});

			const appUrl = env.APP_URL || "https://z8-time.app";
			const webhookUrl = `${appUrl}/api/telegram/webhook/${webhookSecret}`;
			const webhookRegistered = yield* telegram("setWebhook", "Failed to set up Telegram bot", () =>
				setWebhook(input.botToken, webhookUrl, webhookSecret),
			);

			if (webhookRegistered) {
				yield* dbService.query("telegram.markWebhookRegistered", () =>
					dbService.db
						.update(telegramBotConfig)
						.set({ webhookRegistered: true })
						.where(eq(telegramBotConfig.organizationId, organizationId)),
				);
			}

			logger.info(
				{ organizationId, botUsername: botInfo.username, webhookRegistered },
				"Telegram bot configured via settings",
			);

			return { botUsername: botInfo.username || null, botDisplayName: botInfo.first_name };
		}),
);

export const updateTelegramSettings = organizationAction(
	{ name: "telegram.updateSettings", requires: "orgAdmin", schema: telegramSettingsSchema },
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("telegram.updateSettings", () =>
				dbService.db
					.update(telegramBotConfig)
					.set({
						enableApprovals: input.enableApprovals,
						enableCommands: input.enableCommands,
						enableDailyDigest: input.enableDailyDigest,
						enableEscalations: input.enableEscalations,
						digestTime: input.digestTime,
						digestTimezone: input.digestTimezone,
						escalationTimeoutHours: input.escalationTimeoutHours,
					})
					.where(eq(telegramBotConfig.organizationId, organizationId)),
			);
		}),
);

export const disconnectTelegramBot = organizationAction(
	{ name: "telegram.disconnectBot", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const config = yield* dbService.query("telegram.getConfig", () =>
				dbService.db.query.telegramBotConfig.findFirst({
					where: eq(telegramBotConfig.organizationId, organizationId),
				}),
			);

			if (config) {
				const { deleteWebhook } = yield* Effect.promise(() => import("@/lib/telegram"));
				// Fetch the bot token from Vault (fall back to DB for pre-migration configs)
				const vaultToken = yield* telegram("getBotToken", "Failed to disconnect Telegram bot", () =>
					getOrgSecret(organizationId, "telegram/bot_token"),
				);
				const tokenForCleanup =
					vaultToken || (config.botToken !== "vault:managed" ? config.botToken : null);
				if (tokenForCleanup) {
					yield* telegram("deleteWebhook", "Failed to disconnect Telegram bot", () =>
						deleteWebhook(tokenForCleanup),
					);
				}

				yield* telegram("deleteBotToken", "Failed to disconnect Telegram bot", () =>
					deleteOrgSecret(organizationId, "telegram/bot_token"),
				);

				yield* dbService.query("telegram.markDisconnected", () =>
					dbService.db
						.update(telegramBotConfig)
						.set({ setupStatus: "disconnected", webhookRegistered: false })
						.where(
							and(
								eq(telegramBotConfig.id, config.id),
								eq(telegramBotConfig.organizationId, organizationId),
							),
						),
				);
			}

			logger.info({ organizationId }, "Telegram bot disconnected via settings");
		}),
);

// ============================================
// USER LINKING (the caller's own link, any org member)
// ============================================

export const getUserTelegramLink = organizationAction(
	{ name: "telegram.getUserLink", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const mapping = yield* dbService.query("telegram.getUserLink", () =>
				dbService.db.query.telegramUserMapping.findFirst({
					where: and(
						eq(telegramUserMapping.userId, actor.userId),
						eq(telegramUserMapping.organizationId, organizationId),
						eq(telegramUserMapping.isActive, true),
					),
				}),
			);

			if (!mapping) {
				return null;
			}

			return {
				telegramUsername: mapping.telegramUsername,
				telegramDisplayName: mapping.telegramDisplayName,
				isActive: mapping.isActive,
			} satisfies TelegramUserLink;
		}),
);

export const generateTelegramLinkCode = organizationAction(
	{ name: "telegram.generateLinkCode", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const { generateLinkCode, isTelegramEnabledForOrganization } = yield* Effect.promise(
				() => import("@/lib/telegram"),
			);

			const enabled = yield* telegram("isEnabled", "Failed to generate link code", () =>
				isTelegramEnabledForOrganization(organizationId),
			);
			if (!enabled) {
				return yield* Effect.fail(
					new ValidationError({ message: "Telegram is not configured for this organization" }),
				);
			}

			const { code, expiresAt } = yield* telegram(
				"generateLinkCode",
				"Failed to generate link code",
				() => generateLinkCode(actor.userId, organizationId),
			);
			return { code, expiresAt: expiresAt.toISOString() };
		}),
);

export const unlinkTelegramAccount = organizationAction(
	{ name: "telegram.unlinkAccount", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const { unlinkTelegramUser } = yield* Effect.promise(() => import("@/lib/telegram"));
			yield* telegram("unlinkUser", "Failed to unlink Telegram account", () =>
				unlinkTelegramUser(actor.userId, organizationId),
			);
		}),
);
