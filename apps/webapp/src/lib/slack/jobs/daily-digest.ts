/**
 * Slack Daily Digest Job
 *
 * Sends daily summary messages to managers via Slack at their configured time.
 * Reuses the shared buildDigestDataForManager from the Teams implementation.
 */

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, employeeManagers } from "@/db/schema";
import type { DailyDigestData } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";
import { postMessage } from "../api";
import { getAllActiveBotConfigs } from "../bot-config";
import { getOrganizationPrivateConversations } from "../conversation-manager";
import { buildDailyDigestBlocks } from "../formatters";

const logger = createLogger("SlackDailyDigest");

export interface SlackDailyDigestResult {
	success: boolean;
	botsProcessed: number;
	digestsSent: number;
	errors: string[];
}

/**
 * Run the Slack daily digest job
 */
export async function runSlackDailyDigestJob(): Promise<SlackDailyDigestResult> {
	const errors: string[] = [];
	let digestsSent = 0;

	try {
		const bots = await getAllActiveBotConfigs();
		const digestEnabledBots = bots.filter((b) => b.enableDailyDigest);

		logger.info({ botCount: digestEnabledBots.length }, "Starting Slack daily digest job");

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
			{ botsProcessed: digestEnabledBots.length, digestsSent, errors: errors.length },
			"Slack daily digest job completed",
		);

		return {
			success: errors.length === 0,
			botsProcessed: digestEnabledBots.length,
			digestsSent,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Slack daily digest job failed");
		throw error;
	}
}

async function processBotDigest(bot: {
	organizationId: string;
	botAccessToken: string;
	digestTime: string;
	digestTimezone: string;
}): Promise<number> {
	// Check if it's time to send
	const now = DateTime.now().setZone(bot.digestTimezone);
	const [digestHour, digestMinute] = bot.digestTime.split(":").map(Number);
	const digestTime = now.set({ hour: digestHour, minute: digestMinute, second: 0 });
	const minutesSinceDigestTime = now.diff(digestTime, "minutes").minutes;

	if (minutesSinceDigestTime < 0 || minutesSinceDigestTime >= 15) {
		return 0;
	}

	const conversations = await getOrganizationPrivateConversations(bot.organizationId);
	if (conversations.length === 0) return 0;

	let sent = 0;
	const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.z8.works";

	for (const conv of conversations) {
		try {
			// Get employee record
			const emp = await db.query.employee.findFirst({
				where: and(
					eq(employee.userId, conv.userId),
					eq(employee.organizationId, bot.organizationId),
				),
			});

			if (!emp) continue;

			// Check if manager
			const manages = await db.query.employeeManagers.findFirst({
				where: eq(employeeManagers.managerId, emp.id),
			});

			if (!manages) continue;

			// Build digest data - reuse the shared function from Teams
			const { buildDigestDataForManager } = await import("@/lib/teams/jobs/daily-digest");
			const digestData: DailyDigestData = await buildDigestDataForManager(
				emp.id,
				bot.organizationId,
				bot.digestTimezone,
			);

			// Build Block Kit message
			const { blocks, text } = buildDailyDigestBlocks(digestData, appUrl);

			await postMessage(bot.botAccessToken, {
				channel: conv.channelId,
				text,
				blocks,
			});

			sent++;
		} catch (error) {
			logger.warn({ error, userId: conv.userId }, "Failed to send digest");
		}
	}

	logger.info(
		{ organizationId: bot.organizationId, digestsSent: sent },
		"Sent Slack daily digests",
	);

	return sent;
}
