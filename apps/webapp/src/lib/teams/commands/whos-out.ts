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
import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsCommand:WhosOut");

export const whosOutCommand: BotCommand = {
	name: "whosout",
	aliases: ["out", "absent", "leave", "vacation"],
	description: "See which team members are currently out/on leave",
	usage: "whosout",
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
			const today = DateTime.now().setZone(ctx.tenant.digestTimezone).toISODate();

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
					text: `All ${orgManagedEmployees.length} of your team members are available today.`,
				};
			}

			// Build response with details
			const lines = absences.map((absence) => {
				const endDate = DateTime.fromISO(absence.endDate).setZone(ctx.tenant.digestTimezone);
				const returnDate = endDate.plus({ days: 1 }).toFormat("EEE, MMM d");
				const category = absence.categoryName || "Leave";

				return `• **${absence.employeeName}** - ${category} (returns ${returnDate})`;
			});

			const response = [
				`**${absences.length} of ${orgManagedEmployees.length} team members out today:**`,
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
