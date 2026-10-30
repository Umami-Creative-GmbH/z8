/**
 * "Who's Clocked In" Command
 *
 * Shows which team members are currently clocked in.
 * Only shows employees that the requesting manager manages.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, workPeriod } from "@/db/schema";
import { currentRosterReportIds } from "@/lib/bot-platform/current-roster-team";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { elapsedHoursAndMinutes, getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("TeamsCommand:ClockedIn");

export const clockedInCommand: BotCommand = {
	name: "clockedin",
	aliases: ["whosclockedin", "active"],
	description: "bot.cmd.clockedin.desc",
	usage: "clockedin",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			const t = await getBotTranslate(ctx.locale);
			const temporal = ctx.temporal ?? getCommandTemporalContext(ctx);

			// The manager's team in this organization: its current roster only (#1438).
			const managedEmployeeIds = await currentRosterReportIds(db, {
				organizationId: ctx.organizationId,
				managerEmployeeId: ctx.employeeId,
			});

			if (managedEmployeeIds.length === 0) {
				return {
					type: "text",
					text: t("bot.cmd.clockedin.noTeam", "You don't have any team members assigned to you."),
				};
			}

			// Get active work periods (isActive = true) for managed employees
			const activeWorkPeriods = await db
				.select({
					employeeId: workPeriod.employeeId,
					startTime: workPeriod.startTime,
					employeeName: user.name,
				})
				.from(workPeriod)
				.innerJoin(employee, eq(workPeriod.employeeId, employee.id))
				.innerJoin(user, eq(employee.userId, user.id))
				.where(
					and(
						eq(workPeriod.organizationId, ctx.organizationId),
						eq(workPeriod.isActive, true),
						inArray(workPeriod.employeeId, managedEmployeeIds),
					),
				);

			if (activeWorkPeriods.length === 0) {
				return {
					type: "text",
					text: t(
						"bot.cmd.clockedin.noneActive",
						"None of your {total} team members are currently clocked in.",
						{ total: managedEmployeeIds.length },
					),
				};
			}

			// Build response with details
			const lines = activeWorkPeriods.map((entry) => {
				const clockInTime = instantFromDate(entry.startTime);
				const { hours, minutes } = elapsedHoursAndMinutes(clockInTime, temporal.now);

				return `• **${entry.employeeName}** - Clocked in at ${formatInstant(clockInTime, temporal, "time")} (${hours}h ${minutes}m)`;
			});

			const response = [
				`**${t("bot.cmd.clockedin.header", "{active} of {total} team members currently clocked in:", { active: activeWorkPeriods.length, total: managedEmployeeIds.length })}**`,
				"",
				...lines,
			].join("\n");

			return {
				type: "text",
				text: response,
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to get clocked in employees");
			throw error;
		}
	},
};
