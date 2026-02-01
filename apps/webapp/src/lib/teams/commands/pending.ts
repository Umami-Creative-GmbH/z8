/**
 * "Pending Approvals" Command
 *
 * Shows pending approval requests for the manager.
 */

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest, employee, absenceEntry, absenceCategory } from "@/db/schema";
import { user } from "@/db/auth-schema";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "../types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("TeamsCommand:Pending");

export const pendingCommand: BotCommand = {
	name: "pending",
	aliases: ["approvals", "requests", "approve"],
	description: "See your pending approval requests",
	usage: "pending",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			// Get pending approval requests assigned to this employee
			const pendingRequests = await db.query.approvalRequest.findMany({
				where: and(
					eq(approvalRequest.approverId, ctx.employeeId),
					eq(approvalRequest.organizationId, ctx.organizationId),
					eq(approvalRequest.status, "pending"),
				),
				orderBy: (t, { asc }) => [asc(t.createdAt)],
			});

			if (pendingRequests.length === 0) {
				return {
					type: "text",
					text: "You have no pending approval requests. Nice work keeping up!",
				};
			}

			// Get details for each request
			const details = await Promise.all(
				pendingRequests.map(async (request) => {
					// Get requester info
					const requesterEmployee = await db.query.employee.findFirst({
						where: eq(employee.id, request.requestedBy),
						with: {
							user: {
								columns: { name: true },
							},
						},
					});

					const requesterName = requesterEmployee?.user?.name || "Unknown";
					const createdAt = DateTime.fromJSDate(request.createdAt).setZone(
						ctx.tenant.digestTimezone,
					);
					const age = DateTime.now()
						.setZone(ctx.tenant.digestTimezone)
						.diff(createdAt, ["days", "hours"]);

					let description = "";

					if (request.entityType === "absence_entry") {
						// Get absence details
						const absence = await db.query.absenceEntry.findFirst({
							where: eq(absenceEntry.id, request.entityId),
							with: {
								category: {
									columns: { name: true },
								},
							},
						});

						if (absence) {
							const categoryName = absence.category?.name || "Leave";
							const startDate = DateTime.fromISO(absence.startDate).toFormat("MMM d");
							const endDate = DateTime.fromISO(absence.endDate).toFormat("MMM d");
							description = `${categoryName}: ${startDate} - ${endDate}`;
						}
					} else if (request.entityType === "time_entry") {
						description = "Time entry correction";
					}

					// Format age
					let ageText = "";
					if (age.days >= 1) {
						ageText = `${Math.floor(age.days)}d ago`;
					} else {
						ageText = `${Math.floor(age.hours)}h ago`;
					}

					return {
						requesterName,
						description,
						ageText,
						entityType: request.entityType,
					};
				}),
			);

			// Build response
			const lines = details.map((d) => {
				return `• **${d.requesterName}** - ${d.description} (${d.ageText})`;
			});

			const response = [
				`**You have ${pendingRequests.length} pending approval${pendingRequests.length > 1 ? "s" : ""}:**`,
				"",
				...lines,
				"",
				"_View and approve in Z8 or wait for individual approval cards._",
			].join("\n");

			return {
				type: "text",
				text: response,
			};
		} catch (error) {
			logger.error({ error, ctx }, "Failed to get pending approvals");
			throw error;
		}
	},
};
