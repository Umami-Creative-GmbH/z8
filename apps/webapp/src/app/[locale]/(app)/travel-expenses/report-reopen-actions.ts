"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import "@/lib/approvals/init";
import {
	loadTravelExpenseReportReopenState,
	type ReopenActor,
	reopenTravelExpenseReport,
	type TravelExpenseReportReopenState,
} from "@/lib/approvals/server/travel-expense-report-reopen";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { canAccessApprovalInbox } from "@/lib/authorization";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	REOPEN_REASON_MAX_LENGTH,
	type ReopenAdjustmentReason,
} from "@/lib/travel-expenses/report-reopen";

/**
 * Reopening approved travel expense reports (#614). Only people with Approvals
 * inbox access reach the reopen owner, which then requires the approving
 * request's approver, an eligible manager or an organization approval manager.
 * Nothing here writes report or approval rows.
 */

const NOT_FOUND = "Expense report not found";

const reportIdSchema = z.uuid();
const reopenSchema = z.object({
	reportId: z.uuid(),
	submissionCycle: z.number().int().positive(),
	reason: z.string().max(REOPEN_REASON_MAX_LENGTH * 2),
});

export type ReopenTravelExpenseReportOutcome =
	| { status: "reopened" }
	/** The submission was resubmitted meanwhile; reload the report. */
	| { status: "stale" }
	/** No longer approved: already reopened by someone else, or decided otherwise. */
	| { status: "not_approved" }
	/** Exported or reimbursed: correct it through a linked adjustment (#615). */
	| { status: "adjustment_required"; reason: ReopenAdjustmentReason };

/**
 * The signed-in approver; whether they are one for this report is decided by
 * the reopen owner, exactly like a return: the approving request's approver,
 * an eligible manager of the employee, or an organization approval manager.
 */
async function reopenActor(): Promise<{
	actor: ReopenActor;
	organizationId: string;
} | null> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	const ability = await getAbility();
	if (!ability || !canAccessApprovalInbox(ability, authContext.employee)) return null;
	return {
		organizationId: authContext.employee.organizationId,
		actor: {
			employeeId: authContext.employee.id,
			userId: authContext.user.id,
			name: authContext.user.name ?? null,
			canManageApprovals: ability.cannot("manage", "Approval") === false,
		},
	};
}

/** Whether the signed-in reviewer can reopen the report, or why it needs an adjustment. */
export async function getTravelExpenseReportReopenState(
	reportId: string,
): Promise<ServerActionResult<TravelExpenseReportReopenState>> {
	try {
		if (!reportIdSchema.safeParse(reportId).success) {
			return { success: true, data: { status: "unavailable" } };
		}
		const reviewer = await reopenActor();
		if (!reviewer) return { success: true, data: { status: "unavailable" } };
		return {
			success: true,
			data: await loadTravelExpenseReportReopenState(db, {
				organizationId: reviewer.organizationId,
				reportId,
				actor: reviewer.actor,
			}),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the reopen state of an expense report");
		return { success: false, error: "Failed to load the expense report" };
	}
}

/** Reopens an approved, unexported and unpaid report for correction with a reason. */
export async function reopenTravelExpenseReportAction(input: {
	reportId: string;
	submissionCycle: number;
	reason: string;
}): Promise<ServerActionResult<ReopenTravelExpenseReportOutcome>> {
	try {
		const parsed = reopenSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: NOT_FOUND };
		const reviewer = await reopenActor();
		if (!reviewer) return { success: false, error: NOT_FOUND };
		const result = await reopenTravelExpenseReport(db, {
			organizationId: reviewer.organizationId,
			reportId: parsed.data.reportId,
			submissionCycle: parsed.data.submissionCycle,
			reason: parsed.data.reason,
			actor: reviewer.actor,
		});
		switch (result.kind) {
			case "not_found":
			case "forbidden":
				return { success: false, error: NOT_FOUND };
			case "invalid_reason":
				return {
					success: false,
					error:
						result.error === "reason_required"
							? "A reason is required to reopen an expense report"
							: `Keep the reason under ${REOPEN_REASON_MAX_LENGTH} characters`,
				};
			case "authority_unsupported":
				return { success: false, error: "Expense reports cannot be reopened right now" };
			case "stale":
			case "not_approved":
				return { success: true, data: { status: result.kind } };
			case "adjustment_required":
				return { success: true, data: { status: result.kind, reason: result.reason } };
			case "reopened":
				break;
		}
		if (!result.replayed) {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_REOPENED,
				actorId: reviewer.actor.userId,
				employeeId: reviewer.actor.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: reviewer.organizationId,
				metadata: {
					model: "report",
					submissionCycle: result.submissionCycle,
					closureId: result.closureId,
					cancelledExportBatchIds: result.cancelledExportBatchIds,
				},
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log expense report reopen"));
		}
		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "reopened" } };
	} catch (error) {
		logger.error({ error }, "Failed to reopen expense report");
		return { success: false, error: "Failed to reopen expense report" };
	}
}
