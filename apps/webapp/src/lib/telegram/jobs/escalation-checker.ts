/**
 * Telegram Escalation Checker Job
 *
 * Checks for stale approval requests and escalates to backup managers.
 * Mirrors the Teams escalation checker pattern.
 */

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	approvalRequest,
	employee,
	employeeManagers,
	telegramEscalation,
	telegramUserMapping,
} from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { sendApprovalMessageToManager } from "../approval-handler";
import { getAllActiveBotConfigs } from "../bot-config";

const logger = createLogger("TelegramEscalationChecker");

export interface TelegramEscalationResult {
	success: boolean;
	botsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/**
 * Run the Telegram escalation checker job
 */
export async function runTelegramEscalationCheckerJob(): Promise<TelegramEscalationResult> {
	const errors: string[] = [];
	let approvalsEscalated = 0;

	try {
		const bots = await getAllActiveBotConfigs();
		const escalationEnabledBots = bots.filter((b) => b.enableEscalations);

		logger.info({ botCount: escalationEnabledBots.length }, "Starting Telegram escalation checker");

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
			"Telegram escalation checker completed",
		);

		return {
			success: errors.length === 0,
			botsProcessed: escalationEnabledBots.length,
			approvalsEscalated,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Telegram escalation checker failed");
		throw error;
	}
}

async function processBotEscalations(bot: {
	organizationId: string;
	botToken: string;
	escalationTimeoutHours: number;
}): Promise<number> {
	const cutoffTime = DateTime.now().minus({ hours: bot.escalationTimeoutHours }).toJSDate();

	// Find pending approvals older than the timeout that haven't been escalated via Telegram
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
	const existingEscalations = await db.query.telegramEscalation.findMany({
		where: and(
			inArray(telegramEscalation.approvalRequestId, approvalIds),
			eq(telegramEscalation.organizationId, bot.organizationId),
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
			// and who has a Telegram account linked
			let backupManagerId: string | null = null;

			for (const mgr of managers) {
				if (mgr.managerId === approval.approverId) continue;

				// Check if this manager has Telegram linked
				const emp = await db.query.employee.findFirst({
					where: eq(employee.id, mgr.managerId),
					columns: { userId: true },
				});
				if (!emp?.userId) continue;

				const telegramMapping = await db.query.telegramUserMapping.findFirst({
					where: and(
						eq(telegramUserMapping.userId, emp.userId),
						eq(telegramUserMapping.organizationId, bot.organizationId),
						eq(telegramUserMapping.isActive, true),
					),
				});

				if (telegramMapping) {
					backupManagerId = mgr.managerId;
					break;
				}
			}

			if (!backupManagerId) continue;

			// Record the escalation
			const ageHours = DateTime.now().diff(DateTime.fromJSDate(approval.createdAt), "hours").hours;

			await db.insert(telegramEscalation).values({
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
				"Escalated approval via Telegram",
			);
		} catch (error) {
			logger.warn({ error, approvalId: approval.id }, "Failed to escalate approval");
		}
	}

	return escalated;
}
