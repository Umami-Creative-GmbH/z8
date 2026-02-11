/**
 * "Who's Clocked In" Command
 *
 * Shows which team members are currently clocked in.
 * Only shows employees that the requesting manager manages.
 */

import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, workPeriod } from "@/db/schema";
import { fmtTime, getBotTranslate } from "@/lib/bot-platform/i18n";
import type {
	BotCommand,
	BotCommandContext,
	BotCommandResponse,
} from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";

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

			// Get employees this user manages (join through employee to filter by org)
			const managedEmployees = await db.query.employeeManagers.findMany({
				where: eq(employeeManagers.managerId, ctx.employeeId),
				with: {
					employee: {
						columns: { id: true, organizationId: true },
						with: {
							user: {
								columns: { name: true },
							},
						},
					},
				},
			});

			// Filter to employees in this organization
			const orgManagedEmployees = managedEmployees.filter(
				(m) => m.employee.organizationId === ctx.organizationId,
			);

			if (orgManagedEmployees.length === 0) {
				return {
					type: "text",
					text: t("bot.cmd.clockedin.noTeam", "You don't have any team members assigned to you."),
				};
			}

			const managedEmployeeIds = orgManagedEmployees.map((m) => m.employeeId);

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
					text: t("bot.cmd.clockedin.noneActive", "None of your {total} team members are currently clocked in.", { total: orgManagedEmployees.length }),
				};
			}

			// Build response with details
			const now = DateTime.now().setZone(ctx.config.digestTimezone);
			const lines = activeWorkPeriods.map((entry) => {
				const clockInTime = DateTime.fromJSDate(entry.startTime).setZone(
					ctx.config.digestTimezone,
				);
				const duration = now.diff(clockInTime, ["hours", "minutes"]);
				const hours = Math.floor(duration.hours);
				const minutes = Math.floor(duration.minutes % 60);

				return `• **${entry.employeeName}** - Clocked in at ${fmtTime(clockInTime, ctx.locale)} (${hours}h ${minutes}m)`;
			});

			const response = [
				`**${t("bot.cmd.clockedin.header", "{active} of {total} team members currently clocked in:", { active: activeWorkPeriods.length, total: orgManagedEmployees.length })}**`,
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
