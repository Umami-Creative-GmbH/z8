/**
 * "Status" Command
 *
 * Shows the current user's clock-in status:
 * whether they are clocked in, since when, and for how long.
 */

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { employee, workPeriod } from "@/db/schema";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { elapsedHoursAndMinutes, getCommandTemporalContext } from "./command-temporal";

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
			const temporal = ctx.temporal ?? getCommandTemporalContext(ctx);

			const emp = await db.query.employee.findFirst({
				where: and(
					eq(employee.id, ctx.employeeId),
					eq(employee.organizationId, ctx.organizationId),
				),
			});

			if (!emp) {
				return { type: "text", text: t("bot.cmd.status.noProfile", "Employee profile not found.") };
			}

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

			const clockInTime = instantFromDate(activePeriod.startTime);
			const { hours, minutes } = elapsedHoursAndMinutes(clockInTime, temporal.now);

			return {
				type: "text",
				text: t(
					"bot.cmd.status.clockedIn",
					"You are clocked in since {time} ({hours}h {minutes}m).",
					{
						time: formatInstant(clockInTime, temporal, "time"),
						hours,
						minutes,
					},
				),
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to get status");
			throw error;
		}
	},
};
