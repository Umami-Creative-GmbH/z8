/**
 * Slack Escalation Checker Job
 *
 * Checks for stale approval requests and escalates to backup managers.
 * Mirrors the Telegram escalation checker pattern.
 */

import { and, eq, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import {
	approvalRequest,
	employee,
	employeeManagers,
	slackEscalation,
	slackUserMapping,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { sendApprovalMessageToManager } from "../approval-handler";
import { getAllActiveBotConfigs } from "../bot-config";

const logger = createLogger("SlackEscalationChecker");

export interface SlackEscalationResult {
	success: boolean;
	botsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/**
 * Run the Slack escalation checker job
 */
export async function runSlackEscalationCheckerJob(): Promise<SlackEscalationResult> {
	const errors: string[] = [];
	let approvalsEscalated = 0;

	try {
		const bots = await getAllActiveBotConfigs();
		const escalationEnabledBots = bots.filter((b) => b.enableEscalations);

		logger.info({ botCount: escalationEnabledBots.length }, "Starting Slack escalation checker");

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
			"Slack escalation checker completed",
		);

		return {
			success: errors.length === 0,
			botsProcessed: escalationEnabledBots.length,
			approvalsEscalated,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Slack escalation checker failed");
		throw error;
	}
}

async function processBotEscalations(bot: {
	organizationId: string;
	botAccessToken: string;
	escalationTimeoutHours: number;
}): Promise<number> {
	const cutoffTime = DateTime.now().minus({ hours: bot.escalationTimeoutHours }).toJSDate();

	// Find pending approvals older than the timeout that haven't been escalated via Slack
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
	const existingEscalations = await db.query.slackEscalation.findMany({
		where: and(
			inArray(slackEscalation.approvalRequestId, approvalIds),
			eq(slackEscalation.organizationId, bot.organizationId),
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
			// and who has a Slack account linked
			let backupManagerId: string | null = null;

			for (const mgr of managers) {
				if (mgr.managerId === approval.approverId) continue;

				// Check if this manager has Slack linked
				const emp = await db.query.employee.findFirst({
					where: and(
						eq(employee.id, mgr.managerId),
						eq(employee.organizationId, bot.organizationId),
					),
					columns: { userId: true },
				});
				if (!emp?.userId) continue;

				const mapping = await db.query.slackUserMapping.findFirst({
					where: and(
						eq(slackUserMapping.userId, emp.userId),
						eq(slackUserMapping.organizationId, bot.organizationId),
						eq(slackUserMapping.isActive, true),
					),
				});

				if (mapping) {
					backupManagerId = mgr.managerId;
					break;
				}
			}

			if (!backupManagerId) continue;

			// Record the escalation
			await db.insert(slackEscalation).values({
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
				bot.botAccessToken,
			);

			escalated++;

			logger.info(
				{
					approvalId: approval.id,
					originalApprover: approval.approverId,
					backupManager: backupManagerId,
				},
				"Escalated approval via Slack",
			);
		} catch (error) {
			logger.warn({ error, approvalId: approval.id }, "Failed to escalate approval");
		}
	}

	return escalated;
}
