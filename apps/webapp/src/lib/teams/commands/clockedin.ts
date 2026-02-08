/**
 * "Who's Clocked In" Command
 *
 * Shows which team members are currently clocked in.
 * Only shows employees that the requesting manager manages.
 */

import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { workPeriod, employee, employeeManagers } from "@/db/schema";
import { user } from "@/db/auth-schema";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsCommand:ClockedIn");

export const clockedInCommand: BotCommand = {
	name: "clockedin",
	aliases: ["whosclockedin", "clockin", "active"],
	description: "See which team members are currently clocked in",
	usage: "clockedin",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
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
					text: "You don't have any team members assigned to you.",
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
					text: `None of your ${orgManagedEmployees.length} team members are currently clocked in.`,
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

				return `• **${entry.employeeName}** - Clocked in at ${clockInTime.toFormat("HH:mm")} (${hours}h ${minutes}m)`;
			});

			const response = [
				`**${activeWorkPeriods.length} of ${orgManagedEmployees.length} team members currently clocked in:**`,
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
