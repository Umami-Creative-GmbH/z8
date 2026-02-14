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
import { getBotTranslate, getUserLocale } from "@/lib/bot-platform/i18n";
import type { DailyDigestData } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
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

		logger.info(
			{ botCount: digestEnabledBots.length },
			"Starting Telegram daily digest job",
		);

		for (const bot of digestEnabledBots) {
			try {
				const sent = await processBotDigest(bot);
				digestsSent += sent;
			} catch (error) {
				const errorMsg = `Failed to process digest for org ${bot.organizationId}: ${error instanceof Error ? error.message : String(error)}`;
				logger.error({ error, organizationId: bot.organizationId }, errorMsg);
				errors.push(errorMsg);
			}
		}

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
	const now = DateTime.now().setZone(bot.digestTimezone);
	const [digestHour, digestMinute] = bot.digestTime.split(":").map(Number);
	const digestTime = now.set({
		hour: digestHour,
		minute: digestMinute,
		second: 0,
	});
	const minutesSinceDigestTime = now.diff(digestTime, "minutes").minutes;

	if (minutesSinceDigestTime < 0 || minutesSinceDigestTime >= 15) {
		return 0;
	}

	const conversations = await getOrganizationPrivateConversations(
		bot.organizationId,
	);
	if (conversations.length === 0) return 0;

	const appUrl = process.env.APP_URL || "https://z8-time.app";
	const { buildDigestDataForManager } = await import(
		"@/lib/teams/jobs/daily-digest"
	);

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

				// Build Telegram-formatted message (use recipient's locale)
				const userLocale = await getUserLocale(conv.userId);
				const digestData: DailyDigestData = await buildDigestDataForManager(
					emp.id,
					bot.organizationId,
					bot.digestTimezone,
					userLocale,
				);

				const t = await getBotTranslate(userLocale);
				const messageText = buildDailyDigestMessage(digestData, appUrl, t, userLocale);

				await sendMessage(bot.botToken, {
					chat_id: conv.chatId,
					text: messageText,
					parse_mode: "MarkdownV2",
				});

				return true;
			} catch (error) {
				logger.warn({ error, userId: conv.userId }, "Failed to send digest");
				return false;
			}
		}),
	);

	const sent = results.filter(
		(r) => r.status === "fulfilled" && r.value === true,
	).length;

	logger.info(
		{ organizationId: bot.organizationId, digestsSent: sent },
		"Sent Telegram daily digests",
	);

	return sent;
}
