"use server";

import { revalidatePath } from "next/cache";
import { Effect } from "effect";
import { z } from "zod";
import { db } from "@/db";
import "@/lib/approvals/init";
import { loadApprovalInboxDecisionTarget } from "@/lib/approvals/inbox/decision-service";
import { isEligibleManagerForApprovalRequest } from "@/lib/approvals/policies/manager-eligibility-db";
import { returnTravelExpenseReport } from "@/lib/approvals/server/travel-expense-report-return";
import { withdrawTravelExpenseReport } from "@/lib/approvals/server/travel-expense-report-withdrawal";
import type { ApprovalDbService, CurrentApprover } from "@/lib/approvals/server/types";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { canAccessApprovalInbox } from "@/lib/authorization";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	RETURN_ITEM_COMMENT_MAX_LENGTH,
	RETURN_NOTE_MAX_LENGTH,
} from "@/lib/travel-expenses/report-return";

/**
 * Review-cycle actions of travel expense reports (#603): an employee withdraws
 * their pending submission, and a reviewer returns one for changes. Both run
 * through their approval owners; nothing here writes report or approval rows.
 */

const withdrawSchema = z.object({
	reportId: z.uuid(),
	submissionCycle: z.number().int().positive(),
});

export type WithdrawTravelExpenseReportOutcome = { status: "withdrawn" } | { status: "not_pending" };

export async function withdrawTravelExpenseReportAction(input: {
	reportId: string;
	submissionCycle: number;
}): Promise<ServerActionResult<WithdrawTravelExpenseReportOutcome>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) return { success: false, error: "Unauthorized" };
		const parsed = withdrawSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Expense report not found" };
		const owner = {
			organizationId: authContext.employee.organizationId,
			employeeId: authContext.employee.id,
			userId: authContext.user.id,
		};
		const result = await withdrawTravelExpenseReport(db, { owner, ...parsed.data });
		switch (result.kind) {
			case "not_found":
				return { success: false, error: "Expense report not found" };
			case "authority_unsupported":
				return { success: false, error: "Expense reports cannot be withdrawn right now" };
			case "not_pending":
				return { success: true, data: { status: "not_pending" } };
			case "withdrawn":
				break;
		}
		if (!result.replayed) {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_WITHDRAWN,
				actorId: owner.userId,
				employeeId: owner.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: owner.organizationId,
				metadata: { model: "report", submissionCycle: result.submissionCycle },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log expense report withdrawal"));
		}
		revalidatePath("/travel-expenses");
		return { success: true, data: { status: "withdrawn" } };
	} catch (error) {
		logger.error({ error }, "Failed to withdraw expense report");
		return { success: false, error: "Failed to withdraw expense report" };
	}
}

const returnSchema = z.object({
	approvalId: z.uuid(),
	note: z.string().max(RETURN_NOTE_MAX_LENGTH * 2),
	itemComments: z
		.array(
			z.object({
				itemId: z.uuid(),
				body: z.string().max(RETURN_ITEM_COMMENT_MAX_LENGTH * 2),
			}),
		)
		.max(200),
});

const query: ApprovalDbService["query"] = (_name, fn) =>
	Effect.tryPromise({ try: fn, catch: (error) => error as AnyAppError });

/**
 * Returns a submitted report for changes from the Approvals inbox. Who may
 * return it is exactly who may reject it: the assigned reviewer, an eligible
 * manager of the requester, or an organization approval manager.
 */
export async function returnTravelExpenseReportAction(input: {
	approvalId: string;
	note: string;
	itemComments: Array<{ itemId: string; body: string }>;
}): Promise<ServerActionResult<{ status: "returned" }>> {
	try {
		const authContext = await getAuthContext();
		if (!authContext?.employee) return { success: false, error: "Unauthorized" };
		const parsed = returnSchema.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid return" };
		const ability = await getAbility();
		const actorEmployee = authContext.employee;
		if (!ability || !canAccessApprovalInbox(ability, actorEmployee)) {
			return { success: false, error: "Approval not found" };
		}
		const organizationId = actorEmployee.organizationId;
		const target = await loadApprovalInboxDecisionTarget({
			approvalId: parsed.data.approvalId,
			organizationId,
		}).catch(() => null);
		if (
			!target ||
			target.organizationId !== organizationId ||
			target.targetType !== "compatibility_request" ||
			target.entityType !== "travel_expense_report"
		) {
			return { success: false, error: "Approval not found" };
		}
		const canManageApprovals = ability.cannot("manage", "Approval") === false;
		const isAssigned = target.approverId === actorEmployee.id;
		const isEligibleManager =
			!isAssigned &&
			(await isEligibleManagerForApprovalRequest({
				db,
				approvalRequestId: target.id,
				managerEmployeeId: actorEmployee.id,
				organizationId,
			}));
		if (!isAssigned && !isEligibleManager && !canManageApprovals) {
			return { success: false, error: "Approval not found" };
		}
		// A request that is no longer pending reaches the owner too: an exact retry
		// of a committed return replays there, anything else is refused there.
		const actor = (await db.query.employee.findFirst({
			where: (employee, { and, eq }) =>
				and(eq(employee.id, actorEmployee.id), eq(employee.organizationId, organizationId)),
			with: { user: true },
		})) as CurrentApprover | undefined;
		if (!actor) return { success: false, error: "Approval not found" };
		const outcome = await returnTravelExpenseReport(
			{ db, query },
			{
				organizationId,
				reportId: target.entityId,
				actor,
				note: parsed.data.note,
				itemComments: parsed.data.itemComments,
				options: isAssigned
					? { approvalRequestId: target.id }
					: canManageApprovals
						? { approvalRequestId: target.id, allowOrganizationWideApprover: true }
						: { approvalRequestId: target.id, allowAnyApprover: true },
				canManageOrganizationApproval: async () => canManageApprovals,
			},
		);
		if (outcome.kind === "returned") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_RETURNED,
				actorId: authContext.user.id,
				employeeId: actorEmployee.id,
				targetId: target.entityId,
				targetType: "approval",
				organizationId,
				metadata: {
					model: "report",
					approvalRequestId: target.id,
					submissionCycle: outcome.submissionCycle,
				},
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log expense report return"));
		}
		revalidatePath("/approvals/inbox");
		return { success: true, data: { status: "returned" } };
	} catch (error) {
		if (
			error instanceof ConflictError ||
			error instanceof ValidationError ||
			error instanceof AuthorizationError ||
			error instanceof NotFoundError
		) {
			return { success: false, error: error.message };
		}
		logger.error({ error }, "Failed to return expense report");
		return { success: false, error: "Failed to return expense report" };
	}
}
