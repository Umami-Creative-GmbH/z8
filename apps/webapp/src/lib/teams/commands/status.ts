/**
 * "Status" Command
 *
 * Shows the current user's clock-in status:
 * whether they are clocked in, since when, and for how long.
 */

import { and, eq, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, userSettings, workPeriod } from "@/db/schema";
import { fmtTime, getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BotCommand:Status");

export const statusCommand: BotCommand = {
	name: "status",
	aliases: ["st"],
	description: "bot.cmd.status.desc",
	usage: "status",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			const t = await getBotTranslate(ctx.locale);

			const emp = await db.query.employee.findFirst({
				where: and(eq(employee.id, ctx.employeeId), eq(employee.organizationId, ctx.organizationId)),
			});

			if (!emp) {
				return { type: "text", text: t("bot.cmd.status.noProfile", "Employee profile not found.") };
			}

			// Get user timezone
			const settingsData = await db.query.userSettings.findFirst({
				where: eq(userSettings.userId, ctx.userId),
				columns: { timezone: true },
			});
			const timezone = settingsData?.timezone || "UTC";

			// Check for active work period
			const activePeriod = await db.query.workPeriod.findFirst({
				where: and(eq(workPeriod.employeeId, emp.id), isNull(workPeriod.endTime)),
			});

			if (!activePeriod) {
				return {
					type: "text",
					text: t("bot.cmd.status.notClockedIn", "You are not currently clocked in."),
				};
			}

			const clockInTime = DateTime.fromJSDate(activePeriod.startTime).setZone(timezone);
			const now = DateTime.now().setZone(timezone);
			const duration = now.diff(clockInTime, ["hours", "minutes"]);
			const hours = Math.floor(duration.hours);
			const minutes = Math.floor(duration.minutes % 60);

			return {
				type: "text",
				text: t("bot.cmd.status.clockedIn", "You are clocked in since {time} ({hours}h {minutes}m).", {
					time: fmtTime(clockInTime, ctx.locale),
					hours,
					minutes,
				}),
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to get status");
			throw error;
		}
	},
};
