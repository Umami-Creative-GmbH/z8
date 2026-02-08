/**
 * Discord Escalation Checker Job
 *
 * Checks for stale approval requests and escalates to backup managers.
 * Mirrors the Telegram escalation checker pattern.
 */

import { and, eq, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	approvalRequest,
	discordEscalation,
	discordUserMapping,
	employee,
	employeeManagers,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { sendApprovalMessageToManager } from "../approval-handler";
import { getAllActiveBotConfigs } from "../bot-config";

const logger = createLogger("DiscordEscalationChecker");

export interface DiscordEscalationResult {
	success: boolean;
	botsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/**
 * Run the Discord escalation checker job
 */
export async function runDiscordEscalationCheckerJob(): Promise<DiscordEscalationResult> {
	const errors: string[] = [];
	let approvalsEscalated = 0;

	try {
		const bots = await getAllActiveBotConfigs();
		const escalationEnabledBots = bots.filter((b) => b.enableEscalations);

		logger.info({ botCount: escalationEnabledBots.length }, "Starting Discord escalation checker");

		for (const bot of escalationEnabledBots) {
			try {
				const escalated = await processBotEscalations(bot);
				approvalsEscalated += escalated;
			} catch (error) {
				const errorMsg = `Failed to process escalations for org ${bot.organizationId}: ${error instanceof Error ? error.message : String(error)}`;
				logger.error({ error, organizationId: bot.organizationId }, errorMsg);
				errors.push(errorMsg);
			}
		}

		logger.info(
			{
				botsProcessed: escalationEnabledBots.length,
				approvalsEscalated,
				errors: errors.length,
			},
			"Discord escalation checker completed",
		);

		return {
			success: errors.length === 0,
			botsProcessed: escalationEnabledBots.length,
			approvalsEscalated,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Discord escalation checker failed");
		throw error;
	}
}

async function processBotEscalations(bot: {
	organizationId: string;
	botToken: string;
	escalationTimeoutHours: number;
}): Promise<number> {
	const cutoffTime = DateTime.now().minus({ hours: bot.escalationTimeoutHours }).toJSDate();

	// Find pending approvals older than the timeout that haven't been escalated via Discord
	const staleApprovals = await db
		.select({
			id: approvalRequest.id,
			approverId: approvalRequest.approverId,
			requestedBy: approvalRequest.requestedBy,
			createdAt: approvalRequest.createdAt,
		})
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, bot.organizationId),
				eq(approvalRequest.status, "pending"),
				lte(approvalRequest.createdAt, cutoffTime),
			),
		);

	if (staleApprovals.length === 0) return 0;

	// Filter out already escalated ones
	const approvalIds = staleApprovals.map((a) => a.id);
	const existingEscalations = await db.query.discordEscalation.findMany({
		where: and(
			inArray(discordEscalation.approvalRequestId, approvalIds),
			eq(discordEscalation.organizationId, bot.organizationId),
		),
		columns: { approvalRequestId: true },
	});
	const alreadyEscalated = new Set(existingEscalations.map((e) => e.approvalRequestId));

	let escalated = 0;

	for (const approval of staleApprovals) {
		if (alreadyEscalated.has(approval.id)) continue;

		try {
			// Find a backup manager (next manager up the chain)
			const managers = await db.query.employeeManagers.findMany({
				where: eq(employeeManagers.employeeId, approval.approverId),
			});

			// Find a backup manager who is not the original approver
			// and who has a Discord account linked
			let backupManagerId: string | null = null;

			for (const mgr of managers) {
				if (mgr.managerId === approval.approverId) continue;

				// Check if this manager has Discord linked
				const emp = await db.query.employee.findFirst({
					where: eq(employee.id, mgr.managerId),
					columns: { userId: true },
				});
				if (!emp?.userId) continue;

				const discordMapping = await db.query.discordUserMapping.findFirst({
					where: and(
						eq(discordUserMapping.userId, emp.userId),
						eq(discordUserMapping.organizationId, bot.organizationId),
						eq(discordUserMapping.isActive, true),
					),
				});

				if (discordMapping) {
					backupManagerId = mgr.managerId;
					break;
				}
			}

			if (!backupManagerId) continue;

			// Record the escalation
			await db.insert(discordEscalation).values({
				organizationId: bot.organizationId,
				approvalRequestId: approval.id,
				originalApproverId: approval.approverId,
				escalatedToApproverId: backupManagerId,
				timeoutHours: bot.escalationTimeoutHours,
			});

			// Send approval card to backup manager
			await sendApprovalMessageToManager(
				approval.id,
				backupManagerId,
				bot.organizationId,
				bot.botToken,
			);

			escalated++;

			logger.info(
				{
					approvalId: approval.id,
					originalApprover: approval.approverId,
					backupManager: backupManagerId,
				},
				"Escalated approval via Discord",
			);
		} catch (error) {
			logger.warn({ error, approvalId: approval.id }, "Failed to escalate approval");
		}
	}

	return escalated;
}
