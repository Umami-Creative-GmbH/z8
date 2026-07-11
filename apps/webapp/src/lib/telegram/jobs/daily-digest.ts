/**
 * Telegram Daily Digest Job
 *
 * Sends daily summary messages to managers via Telegram at their configured time.
 * Reuses the shared buildDigestDataForManager from the Teams implementation.
 */

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { env } from "@/env";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { DailyDigestData } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { resolveRecipientDisplayContext } from "@/lib/notifications/recipient-display-context";
import { shouldSkipDigestForManager } from "@/lib/teams/jobs/daily-digest";
import { sendMessage } from "../api";
import { getAllActiveBotConfigs } from "../bot-config";
import { getOrganizationPrivateConversations } from "../conversation-manager";
import { buildDailyDigestMessage } from "../formatters";
import {
	claimTelegramDigestDelivery,
	markTelegramDigestDeliveryFailed,
	markTelegramDigestDeliverySent,
} from "./digest-delivery-ledger";
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

export async function processTelegramBotDigest(
	bot: {
		organizationId: string;
		botToken: string;
		digestTime: string;
		digestTimezone: string;
	},
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

	const conversations = await getOrganizationPrivateConversations(bot.organizationId);
	if (conversations.length === 0) return 0;

	const appUrl = env.APP_URL || "https://z8-time.app";
	const { buildDigestDataForManager } = await import("@/lib/teams/jobs/daily-digest");

	const results = await Promise.allSettled(
		conversations.map(async (conv) => {
			try {
				// Get employee record
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.userId, conv.userId),
						eq(employee.organizationId, bot.organizationId),
					),
				});

				if (!emp) return false;

				// Check if manager
				const manages = await db.query.employeeManagers.findFirst({
					where: eq(employeeManagers.managerId, emp.id),
				});

				if (!manages) return false;

				// Skip managers who are not scheduled to work or are absent.
				if (await shouldSkipDigestForManager(emp.id, bot.organizationId, bot.digestTimezone)) {
					return false;
				}

				const display = await resolveRecipientDisplayContext({
					userId: conv.userId,
					organizationId: bot.organizationId,
				});
				if (!display) return false;

				const recipientDate = DateTime.fromJSDate(now, { zone: "utc" })
					.setZone(display.timezone)
					.toISODate()!;
				const delivery = {
					organizationId: bot.organizationId,
					recipientEmployeeId: emp.id,
					recipientUserId: conv.userId,
					logicalDate: recipientDate,
				};
				if (!(await claimTelegramDigestDelivery(delivery))) return false;

				try {
					const digestData: DailyDigestData = await buildDigestDataForManager({
						display,
						logicalDate: recipientDate,
						managerId: emp.id,
						now: now.toISOString(),
						organizationId: bot.organizationId,
					});

					const t = await getBotTranslate(display.locale);
					const messageText = buildDailyDigestMessage(digestData, appUrl, t, display.locale);

					await sendMessage(bot.botToken, {
						chat_id: conv.chatId,
						text: messageText,
						parse_mode: "MarkdownV2",
					});
				} catch (error) {
					await markTelegramDigestDeliveryFailed(delivery);
					throw error;
				}

				await markTelegramDigestDeliverySent(delivery);

				return true;
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
