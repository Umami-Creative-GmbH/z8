/**
 * Telegram Daily Digest Job
 *
 * Sends daily summary messages to managers via Telegram at their configured time.
 * Reuses the shared buildDigestDataForManager from the Teams implementation.
 */

import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import { env } from "@/env";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import { resolveBotTemporalContext } from "@/lib/bot-platform/temporal-context";
import type { DailyDigestData } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import {
	claimDailyDigestDelivery,
	markDailyDigestDeliveryFailed,
	markDailyDigestDeliverySent,
} from "@/lib/notifications/daily-digest-delivery";
import { sendMessage } from "../api";
import { getAllActiveBotConfigs } from "../bot-config";
import { getOrganizationPrivateConversations } from "../conversation-manager";
import { buildDailyDigestMessage } from "../formatters";

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
					return { sent: await processBotDigest(bot), error: undefined };
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

async function processBotDigest(bot: {
	organizationId: string;
	botToken: string;
	digestTime: string;
	digestTimezone: string;
}): Promise<number> {
	// Check if it's time to send
	const now = Temporal.Now.instant().toZonedDateTimeISO(bot.digestTimezone);
	const [digestHour, digestMinute] = bot.digestTime.split(":").map(Number);
	const digestTime = now.with({
		hour: digestHour,
		minute: digestMinute,
		second: 0,
		millisecond: 0,
		microsecond: 0,
		nanosecond: 0,
	});
	const minutesSinceDigestTime = now.since(digestTime).total({ unit: "minutes" });

	if (minutesSinceDigestTime < 0 || minutesSinceDigestTime >= 15) {
		return 0;
	}

	const conversations = await getOrganizationPrivateConversations(bot.organizationId);
	if (conversations.length === 0) return 0;

	const appUrl = env.APP_URL || "https://z8-time.app";
	const { buildDigestDataForManager } = await import("@/lib/teams/jobs/daily-digest");

	const results = await Promise.allSettled(
		conversations.map(async (conv) => {
			let deliveryId: string | null = null;
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

				const temporal = await resolveBotTemporalContext({
					userId: conv.userId,
					employeeId: emp.id,
					organizationId: bot.organizationId,
				});
				if (!temporal) return false;
				deliveryId = await claimDailyDigestDelivery({
					organizationId: bot.organizationId,
					recipientUserId: conv.userId,
					platform: "telegram",
					type: "daily_digest",
					recipientLocalDate: Temporal.Now.instant()
						.toZonedDateTimeISO(temporal.effectiveTimezone)
						.toPlainDate()
						.toString(),
				});
				if (!deliveryId) return false;

				// Digest delivery is scheduled in the bot timezone, but content uses the recipient's context.
				const digestData: DailyDigestData = await buildDigestDataForManager(
					emp.id,
					bot.organizationId,
					temporal.effectiveTimezone,
					temporal.locale,
				);

				const t = await getBotTranslate(temporal.locale);
				const messageText = buildDailyDigestMessage(digestData, appUrl, t, temporal.locale);

				await sendMessage(bot.botToken, {
					chat_id: conv.chatId,
					text: messageText,
					parse_mode: "MarkdownV2",
				});
				await markDailyDigestDeliverySent({
					id: deliveryId,
					organizationId: bot.organizationId,
				});

				return true;
			} catch (error) {
				if (deliveryId) {
					await markDailyDigestDeliveryFailed(
						{ id: deliveryId, organizationId: bot.organizationId },
						error,
					);
				}
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
