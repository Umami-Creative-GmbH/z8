/**
 * Teams Escalation Checker Job
 *
 * Checks for pending approvals that have exceeded the escalation timeout
 * and escalates them to backup managers.
 */

import { and, eq, lt, isNull } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest, teamsEscalation, employeeManagers, employee } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { createLogger } from "@/lib/logger";
import { getAllActiveTenants } from "../tenant-resolver";
import { sendApprovalCardToManager } from "../approval-handler";
import type { EscalationResult } from "../types";

const logger = createLogger("TeamsEscalationChecker");

export interface EscalationCheckerResult {
	success: boolean;
	tenantsProcessed: number;
	approvalsEscalated: number;
	errors: string[];
}

/**
 * Run the escalation checker job
 *
 * Checks all tenants for pending approvals past their escalation timeout
 * and escalates them to backup managers.
 */
export async function runEscalationCheckerJob(): Promise<EscalationCheckerResult> {
	const startedAt = new Date();
	const errors: string[] = [];
	let approvalsEscalated = 0;

	try {
		// Get all active tenants with escalations enabled
		const tenants = await getAllActiveTenants();
		const escalationEnabledTenants = tenants.filter((t) => t.enableEscalations);

		logger.info(
			{ tenantCount: escalationEnabledTenants.length },
			"Starting escalation checker job",
		);

		for (const tenant of escalationEnabledTenants) {
			try {
				const escalated = await processTenantEscalations(tenant);
				approvalsEscalated += escalated;
			} catch (error) {
				const errorMsg = `Failed to process escalations for tenant ${tenant.tenantId}: ${error instanceof Error ? error.message : String(error)}`;
				logger.error({ error, tenantId: tenant.tenantId }, errorMsg);
				errors.push(errorMsg);
			}
		}

		logger.info(
			{
				duration: Date.now() - startedAt.getTime(),
				tenantsProcessed: escalationEnabledTenants.length,
				approvalsEscalated,
				errors: errors.length,
			},
			"Escalation checker job completed",
		);

		return {
			success: errors.length === 0,
			tenantsProcessed: escalationEnabledTenants.length,
			approvalsEscalated,
			errors,
		};
	} catch (error) {
		logger.error({ error }, "Escalation checker job failed");
		throw error;
	}
}

/**
 * Process escalations for a single tenant
 */
async function processTenantEscalations(tenant: {
	tenantId: string;
	organizationId: string;
	escalationTimeoutHours: number;
}): Promise<number> {
	const cutoffTime = DateTime.now()
		.minus({ hours: tenant.escalationTimeoutHours })
		.toJSDate();

	// Find pending approvals older than the cutoff that haven't been escalated
	const pendingApprovals = await db
		.select({
			id: approvalRequest.id,
			approverId: approvalRequest.approverId,
			requestedBy: approvalRequest.requestedBy,
			entityType: approvalRequest.entityType,
			createdAt: approvalRequest.createdAt,
		})
		.from(approvalRequest)
		.leftJoin(
			teamsEscalation,
			eq(approvalRequest.id, teamsEscalation.approvalRequestId),
		)
		.where(
			and(
				eq(approvalRequest.organizationId, tenant.organizationId),
				eq(approvalRequest.status, "pending"),
				lt(approvalRequest.createdAt, cutoffTime),
				isNull(teamsEscalation.id), // Not already escalated
			),
		);

	if (pendingApprovals.length === 0) {
		logger.debug(
			{ organizationId: tenant.organizationId },
			"No approvals to escalate",
		);
		return 0;
	}

	let escalated = 0;

	for (const approval of pendingApprovals) {
		try {
			const result = await escalateApproval(
				approval.id,
				approval.approverId,
				approval.requestedBy,
				tenant.organizationId,
				tenant.escalationTimeoutHours,
			);

			if (result.success) {
				escalated++;
			} else if (result.error) {
				logger.warn(
					{ approvalId: approval.id, error: result.error },
					"Could not escalate approval",
				);
			}
		} catch (error) {
			logger.error(
				{ error, approvalId: approval.id },
				"Failed to escalate approval",
			);
		}
	}

	if (escalated > 0) {
		logger.info(
			{ organizationId: tenant.organizationId, escalated },
			"Escalated approvals",
		);
	}

	return escalated;
}

/**
 * Escalate a single approval to the backup manager
 */
async function escalateApproval(
	approvalId: string,
	currentApproverId: string,
	requestedById: string,
	organizationId: string,
	timeoutHours: number,
): Promise<EscalationResult> {
	// Find all managers for the requesting employee who are in this org
	const managers = await db.query.employeeManagers.findMany({
		where: eq(employeeManagers.employeeId, requestedById),
		with: {
			manager: {
				columns: { id: true, organizationId: true },
			},
		},
	});

	// Filter to managers in this organization
	const orgManagers = managers.filter((m) => m.manager.organizationId === organizationId);

	// Find a backup (non-primary manager who isn't the current approver)
	const backupManager = orgManagers.find(
		(m) => m.managerId !== currentApproverId && !m.isPrimary,
	);

	// If no backup, try any other manager
	const escalateTo =
		backupManager?.managerId ||
		orgManagers.find((m) => m.managerId !== currentApproverId)?.managerId;

	if (!escalateTo) {
		return {
			approvalRequestId: approvalId,
			escalatedTo: "",
			success: false,
			error: "No backup manager found",
		};
	}

	// Get escalation target's name for logging
	const escalateToEmployee = await db.query.employee.findFirst({
		where: eq(employee.id, escalateTo),
		with: {
			user: { columns: { name: true } },
		},
	});

	// Record the escalation
	await db.insert(teamsEscalation).values({
		approvalRequestId: approvalId,
		organizationId,
		originalApproverId: currentApproverId,
		escalatedToApproverId: escalateTo,
		escalatedAt: new Date(),
		timeoutHours,
	});

	// Update the approval to the new approver
	await db
		.update(approvalRequest)
		.set({ approverId: escalateTo })
		.where(eq(approvalRequest.id, approvalId));

	// Send approval card to the new approver via Teams
	await sendApprovalCardToManager(approvalId, escalateTo, organizationId);

	logger.info(
		{
			approvalId,
			originalApproverId: currentApproverId,
			escalatedTo: escalateTo,
			escalatedToName: escalateToEmployee?.user?.name,
		},
		"Approval escalated",
	);

	return {
		approvalRequestId: approvalId,
		escalatedTo: escalateToEmployee?.user?.name || escalateTo,
		success: true,
	};
}
