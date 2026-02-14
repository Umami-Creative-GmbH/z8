/**
 * "Who's Out" Command
 *
 * Shows which team members are currently on leave/absent.
 * Only shows employees that the requesting manager manages.
 */

import { and, eq, lte, gte, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { absenceEntry, absenceCategory, employee, employeeManagers } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { fmtWeekdayShortDate, getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsCommand:WhosOut");

export const whosOutCommand: BotCommand = {
	name: "whosout",
	aliases: ["out", "absent", "leave", "vacation"],
	description: "bot.cmd.whosout.desc",
	usage: "whosout",
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
					text: t("bot.cmd.whosout.noTeam", "You don't have any team members assigned to you."),
				};
			}

			const managedEmployeeIds = orgManagedEmployees.map((m) => m.employeeId);
			const today = DateTime.now().setZone(ctx.config.digestTimezone).toISODate();

			// Get approved absence entries that cover today for managed employees
			const absences = await db
				.select({
					employeeId: absenceEntry.employeeId,
					startDate: absenceEntry.startDate,
					endDate: absenceEntry.endDate,
					employeeName: user.name,
					categoryName: absenceCategory.name,
				})
				.from(absenceEntry)
				.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
				.innerJoin(user, eq(employee.userId, user.id))
				.leftJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
				.where(
					and(
						eq(absenceEntry.status, "approved"),
						lte(absenceEntry.startDate, today!),
						gte(absenceEntry.endDate, today!),
						inArray(absenceEntry.employeeId, managedEmployeeIds),
					),
				);

			if (absences.length === 0) {
				return {
					type: "text",
					text: t("bot.cmd.whosout.noneOut", "All {total} of your team members are available today.", { total: orgManagedEmployees.length }),
				};
			}

			// Build response with details
			const lines = absences.map((absence) => {
				const endDate = DateTime.fromISO(absence.endDate).setZone(ctx.config.digestTimezone);
				const returnDate = fmtWeekdayShortDate(endDate.plus({ days: 1 }), ctx.locale);
				const category = absence.categoryName || "Leave";

				return `• **${absence.employeeName}** - ${category} (returns ${returnDate})`;
			});

			const response = [
				`**${t("bot.cmd.whosout.header", "{outCount} of {total} team members out today:", { outCount: absences.length, total: orgManagedEmployees.length })}**`,
				"",
				...lines,
			].join("\n");

			return {
				type: "text",
				text: response,
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to get absent employees");
			throw error;
		}
	},
};
