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

		const botResults = await Promise.all(
			escalationEnabledBots.map(async (bot) => {
				try {
					return { escalated: await processBotEscalations(bot), error: undefined };
				} catch (error) {
					const errorMsg = `Failed to process escalations for org ${bot.organizationId}: ${error instanceof Error ? error.message : String(error)}`;
					logger.error({ error, organizationId: bot.organizationId }, errorMsg);
					return { escalated: 0, error: errorMsg };
				}
			}),
		);
		approvalsEscalated = botResults.reduce((total, result) => total + result.escalated, 0);
		errors.push(...botResults.flatMap((result) => (result.error ? [result.error] : [])));

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

	const escalationResults = await Promise.all(
		staleApprovals.map(async (approval) => {
			if (alreadyEscalated.has(approval.id)) return 0;

			try {
			// Find a backup manager (next manager up the chain)
			const managers = await db.query.employeeManagers.findMany({
				where: eq(employeeManagers.employeeId, approval.approverId),
			});

			// Find the first backup manager in manager order who has Slack linked.
			const candidateManagerIds = managers
				.map((mgr) => mgr.managerId)
				.filter((managerId) => managerId !== approval.approverId);
			const managerEmployees =
				candidateManagerIds.length > 0
					? await db.query.employee.findMany({
							where: and(
								inArray(employee.id, candidateManagerIds),
								eq(employee.organizationId, bot.organizationId),
							),
							columns: { id: true, userId: true },
						})
					: [];
			const userIds = managerEmployees.flatMap((emp) => (emp.userId ? [emp.userId] : []));
			const mappings =
				userIds.length > 0
					? await db.query.slackUserMapping.findMany({
							where: and(
								inArray(slackUserMapping.userId, userIds),
								eq(slackUserMapping.organizationId, bot.organizationId),
								eq(slackUserMapping.isActive, true),
							),
						})
					: [];
			const employeesById = new Map(managerEmployees.map((emp) => [emp.id, emp]));
			const mappedUserIds = new Set(mappings.map((mapping) => mapping.userId));
			const backupManagerId =
				candidateManagerIds.find((managerId) => {
					const userId = employeesById.get(managerId)?.userId;
					return userId ? mappedUserIds.has(userId) : false;
				}) ?? null;

			if (!backupManagerId) return 0;

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

			logger.info(
				{
					approvalId: approval.id,
					originalApprover: approval.approverId,
					backupManager: backupManagerId,
				},
				"Escalated approval via Slack",
			);

			return 1;
		} catch (error) {
			logger.warn({ error, approvalId: approval.id }, "Failed to escalate approval");
			return 0;
		}
		}),
	);

	return escalationResults.reduce<number>((total, result) => total + result, 0);
}
