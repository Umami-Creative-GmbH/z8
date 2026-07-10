/**
 * "Pending Approvals" Command
 *
 * Shows pending approval requests for the manager.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { absenceEntry, approvalRequest, employee } from "@/db/schema";
import { getBotTranslate } from "@/lib/bot-platform/i18n";
import type { BotCommand, BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { createLogger } from "@/lib/logger";
import { getCommandTemporalContext } from "./command-temporal";

const logger = createLogger("TeamsCommand:Pending");

export const pendingCommand: BotCommand = {
	name: "pending",
	aliases: ["approvals", "requests", "approve"],
	description: "bot.cmd.pending.desc",
	usage: "pending",
	requiresAuth: true,
	handler: async (ctx: BotCommandContext): Promise<BotCommandResponse> => {
		try {
			const t = await getBotTranslate(ctx.locale);
			const temporal = ctx.temporal ?? getCommandTemporalContext(ctx);

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
					text: t(
						"bot.cmd.pending.none",
						"You have no pending approval requests. Nice work keeping up!",
					),
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
					const ageMinutes = Math.max(
						0,
						Math.floor(
							instantFromDate(request.createdAt).until(temporal.now, { largestUnit: "minute" })
								.minutes,
						),
					);

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
							const startDate = formatPlainDate(
								parsePlainDate(absence.startDate),
								temporal.locale,
								"dateShort",
							);
							const endDate = formatPlainDate(
								parsePlainDate(absence.endDate),
								temporal.locale,
								"dateShort",
							);
							description = `${categoryName}: ${startDate} - ${endDate}`;
						}
					} else if (request.entityType === "time_entry") {
						description = "Time entry correction";
					}

					// Format age
					let ageText = "";
					if (ageMinutes >= 24 * 60) {
						ageText = `${Math.floor(ageMinutes / (24 * 60))}d ago`;
					} else {
						ageText = `${Math.floor(ageMinutes / 60)}h ago`;
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
				`**${t("bot.cmd.pending.header", "You have {count} pending {count, plural, one {approval} other {approvals}}:", { count: pendingRequests.length })}**`,
				"",
				...lines,
				"",
				`_${t("bot.cmd.pending.footer", "View and approve in Z8 or wait for individual approval cards.")}_`,
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
