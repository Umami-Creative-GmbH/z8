/**
 * Telegram Daily Digest Job
 *
 * Sends daily summary messages to managers via Telegram at their configured time.
 * Reuses the shared buildDigestDataForManager from the Teams implementation.
 * Integrates with the durable chat notification dispatch ledger (#2044 / #2047) so
 * uncertain outcomes across a bot switch quarantine without automatic repeat.
 */

import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { env } from "@/env";
import { currentRosterDigestManager } from "@/lib/bot-platform/current-roster-team";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { DailyDigestData } from "@/lib/bot-platform/types";
import { extractRedactedErrorDiagnostics } from "@/lib/chat-installations/durable-dispatch";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { shouldSkipDigestForManager } from "@/lib/teams/jobs/daily-digest";
import * as telegramApi from "../api";
import { getAllActiveBotConfigs } from "../bot-config";
import { getOrganizationPrivateConversations } from "../conversation-manager";
import { buildDailyDigestMessage } from "../formatters";
import type { TelegramMessage } from "../types";
import * as digestLedger from "./digest-delivery-ledger";
import { evaluateDigestOccurrence } from "./digest-schedule";

const logger = createLogger("TelegramDailyDigest");

export interface TelegramDailyDigestResult {
	success: boolean;
	botsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/**
 * Run the Telegram daily digest job
 */
export async function runTelegramDailyDigestJob(): Promise<TelegramDailyDigestResult> {
	const errors: string[] = [];
	let digestsSent = 0;

	try {
		const bots = await getAllActiveBotConfigs();
		const digestEnabledBots = bots.filter((b) => b.enableDailyDigest);

		logger.info({ botCount: digestEnabledBots.length }, "Starting Telegram daily digest job");

		const botResults = await Promise.all(
			digestEnabledBots.map(async (bot) => {
				try {
					return { sent: await processTelegramBotDigest(bot), error: undefined };
				} catch (error) {
					const errorMsg = `Failed to process digest for org ${bot.organizationId}: ${error instanceof Error ? error.message : String(error)}`;
					logger.error({ error, organizationId: bot.organizationId }, errorMsg);
					return { sent: 0, error: errorMsg };
				}
			}),
		);
		digestsSent = botResults.reduce((total, result) => total + result.sent, 0);
		errors.push(...botResults.flatMap((result) => (result.error ? [result.error] : [])));

		logger.info(
			{
				botsProcessed: digestEnabledBots.length,
				digestsSent,
				errors: errors.length,
			},
			"Telegram daily digest job completed",
		);

		return {
			success: errors.length === 0,
			botsProcessed: digestEnabledBots.length,
			digestsSent,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Telegram daily digest job failed");
		throw error;
	}
}

type TelegramDigestBot = {
	organizationId: string;
	installationId?: string | null;
	credentialRevisionId?: string | null;
	botToken: string;
	digestTime: string;
	digestTimezone: string;
};

function isConfirmedUnsentTelegramError(errorCode: number | null): boolean {
	// Telegram 4xx rejections (bad request, unauthorized, forbidden/bot blocked, not found)
	// confirm the message was NOT delivered before acceptance.
	return errorCode !== null && errorCode >= 400 && errorCode < 500 && errorCode !== 429;
}

async function sendDigestMessage(
	botToken: string,
	chatId: string,
	text: string,
): Promise<telegramApi.TelegramCallOutcome<TelegramMessage>> {
	if (
		"sendMessageWithOutcome" in telegramApi &&
		typeof telegramApi.sendMessageWithOutcome === "function"
	) {
		return telegramApi.sendMessageWithOutcome(botToken, {
			chat_id: chatId,
			text,
			parse_mode: "MarkdownV2",
		});
	}
	const result = await telegramApi.sendMessage(botToken, {
		chat_id: chatId,
		text,
		parse_mode: "MarkdownV2",
	});
	if (result) {
		return { kind: "ok", result };
	}
	return { kind: "unknown", reason: "invalid_response" };
}

export async function processTelegramBotDigest(
	bot: TelegramDigestBot,
	now: Date = new Date(),
): Promise<number> {
	const occurrence = evaluateDigestOccurrence({
		now,
		time: bot.digestTime,
		timezone: bot.digestTimezone,
		windowMinutes: 15,
	});
	if (!occurrence.due) {
		return 0;
	}

	const conversations =
		bot.installationId || bot.credentialRevisionId
			? await getOrganizationPrivateConversations(bot.organizationId, {
					installationId: bot.installationId,
					credentialRevisionId: bot.credentialRevisionId,
				})
			: await getOrganizationPrivateConversations(bot.organizationId);
	if (conversations.length === 0) return 0;

	const appUrl = env.APP_URL || "https://z8-time.app";
	const [{ buildDigestDataForManager }, { complianceExceptionInboxScopesFor }] = await Promise.all([
		import("@/lib/teams/jobs/daily-digest"),
		import("@/lib/approvals/inbox/compliance-exception-inbox"),
	]);
	const complianceScopes = complianceExceptionInboxScopesFor({
		organizationId: bot.organizationId,
		userIds: conversations.map((conv) => conv.userId),
	});

	const useDurableLedger =
		"beginTelegramDigestDispatch" in digestLedger &&
		typeof digestLedger.beginTelegramDigestDispatch === "function";

	const results = await Promise.allSettled(
		conversations.map(async (conv) => {
			try {
				// A current manager of at least one current report (#1438).
				const emp = await currentRosterDigestManager(db, {
					organizationId: bot.organizationId,
					userId: conv.userId,
				});

				if (!emp) return false;

				// Skip managers who are not scheduled to work or are absent.
				if (await shouldSkipDigestForManager(emp.id, bot.organizationId, bot.digestTimezone)) {
					return false;
				}

				const display = await resolveRecipientDisplayContext({
					userId: conv.userId,
					organizationId: bot.organizationId,
				});
				if (!display) return false;

				const recipientDate = Temporal.Instant.from(now.toISOString())
					.toZonedDateTimeISO(display.timezone)
					.toPlainDate()
					.toString();
				const delivery = {
					organizationId: bot.organizationId,
					recipientEmployeeId: emp.id,
					recipientUserId: conv.userId,
					logicalDate: recipientDate,
				};

				if (!useDurableLedger) {
					if (!(await digestLedger.claimTelegramDigestDelivery(delivery))) return false;
					try {
						const digestData: DailyDigestData = await buildDigestDataForManager(
							emp.id,
							bot.organizationId,
							display.timezone,
							display.locale,
							await complianceScopes.of({ userId: conv.userId, employeeId: emp.id }),
						);
						const t = await getBotTranslate(display.locale);
						const messageText = buildDailyDigestMessage(digestData, appUrl, t, display.locale);
						await telegramApi.sendMessage(bot.botToken, {
							chat_id: conv.chatId,
							text: messageText,
							parse_mode: "MarkdownV2",
						});
					} catch (error) {
						await digestLedger.markTelegramDigestDeliveryFailed(delivery);
						throw error;
					}
					await digestLedger.markTelegramDigestDeliverySent(delivery);
					return true;
				}

				const dispatch = await digestLedger.beginTelegramDigestDispatch(
					delivery,
					{
						installationId: bot.installationId ?? null,
						credentialRevisionId: bot.credentialRevisionId ?? null,
					},
					{ now: () => now },
				);

				if (dispatch.kind !== "proceed") {
					if (dispatch.kind === "reconciliation_required") {
						logger.warn(
							{
								organizationId: bot.organizationId,
								attemptId: dispatch.attempt.id,
								installationSwitched: dispatch.installationSwitched,
							},
							"Skipping Telegram daily digest due to uncertain prior dispatch requiring reconciliation",
						);
					}
					return false;
				}

				const attemptId = dispatch.attempt.id;
				let messageText: string;
				try {
					const digestData: DailyDigestData = await buildDigestDataForManager(
						emp.id,
						bot.organizationId,
						display.timezone,
						display.locale,
						await complianceScopes.of({ userId: conv.userId, employeeId: emp.id }),
					);
					const t = await getBotTranslate(display.locale);
					messageText = buildDailyDigestMessage(digestData, appUrl, t, display.locale);
				} catch (error) {
					// Failed before calling Telegram -> confirmed unsent so retries can safely proceed.
					await digestLedger.completeTelegramDigestDispatchConfirmedUnsent(
						delivery,
						attemptId,
						extractRedactedErrorDiagnostics(error, "telegram_digest_preflight_failed"),
						{ now: () => now },
					);
					throw error;
				}

				await digestLedger.markTelegramDigestProviderCalled(bot.organizationId, attemptId, {
					now: () => now,
				});

				let outcome: telegramApi.TelegramCallOutcome<TelegramMessage>;
				try {
					outcome = await sendDigestMessage(bot.botToken, conv.chatId, messageText);
				} catch (error) {
					await digestLedger.completeTelegramDigestDispatchUncertain(
						delivery,
						attemptId,
						{
							classification: "provider_error",
							diagnostics: extractRedactedErrorDiagnostics(
								error,
								"telegram_digest_provider_call_uncertain",
							),
						},
						{ now: () => now },
					);
					throw error;
				}

				if (outcome.kind === "ok") {
					await digestLedger.completeTelegramDigestDispatchSent(delivery, attemptId, {
						now: () => now,
					});
					return true;
				}

				if (outcome.kind === "failed" && isConfirmedUnsentTelegramError(outcome.errorCode)) {
					await digestLedger.completeTelegramDigestDispatchConfirmedUnsent(
						delivery,
						attemptId,
						{
							reason: "telegram_confirmed_unsent",
							httpStatus: outcome.errorCode,
							errorCode: `telegram_${outcome.errorCode}`,
						},
						{ now: () => now },
					);
					return false;
				}

				// Timeout, network disconnect, 429/5xx, or invalid response -> uncertain!
				await digestLedger.completeTelegramDigestDispatchUncertain(
					delivery,
					attemptId,
					{
						classification: outcome.kind === "unknown" ? "ambiguous" : "provider_error",
						diagnostics: {
							reason:
								outcome.kind === "unknown"
									? `telegram_${outcome.reason}`
									: `telegram_${outcome.errorCode ?? "error"}`,
							httpStatus: outcome.kind === "failed" ? outcome.errorCode : null,
						},
					},
					{ now: () => now },
				);
				return false;
			} catch (error) {
				logger.warn({ error, userId: conv.userId }, "Failed to send digest");
				return false;
			}
		}),
	);

	const sent = results.filter((r) => r.status === "fulfilled" && r.value === true).length;

	logger.info(
		{ organizationId: bot.organizationId, digestsSent: sent },
		"Sent Telegram daily digests",
	);

	return sent;
}
