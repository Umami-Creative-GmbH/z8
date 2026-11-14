"use server";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { timeEntry, workPeriod } from "@/db/schema";
import {
	decideTimeApproval,
	type TimeApprovalDecisionRefusalReason,
} from "@/lib/approvals/server/time-approval-decision";
import { isTimeApprovalAboutWorkPeriod } from "@/lib/approvals/server/time-approval-work-period";
import type { ApprovalDatabase } from "@/lib/approvals/server/types";
import type { ServerActionResult } from "@/lib/effect/result";
import { getCurrentEmployee, getCurrentSession } from "./auth";
import { updateWorkPeriodProject as updateWorkPeriodProjectAction } from "../actions";
import { logger } from "./shared";
import { splitOwnWorkPeriod } from "./work-period-split";

export async function approveWorkPeriod(input: {
	workPeriodId: string;
	approvalRequestId: string;
}): Promise<ServerActionResult<{ workPeriodId: string }>> {
	const { workPeriodId, approvalRequestId } = input;
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}
	try {
		const database = db as unknown as ApprovalDatabase;
		// The table shows one work period; an approval about another is refused here,
		// because the decision itself finds the work period from the approval.
		const aboutThisWorkPeriod = await isTimeApprovalAboutWorkPeriod(database, {
			organizationId: currentEmployee.organizationId,
			approvalId: approvalRequestId,
			workPeriodId,
		});
		if (!aboutThisWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		// Management is verified from the database inside the decision, as for the inbox.
		const result = await decideTimeApproval({
			organizationId: currentEmployee.organizationId,
			approvalId: approvalRequestId,
			actor: { employeeId: currentEmployee.id, userId: session.user.id },
			right: { as: "approval_manager" },
			decision: { kind: "approve" },
		});
		if (result.status === "decided") {
			return { success: true, data: { workPeriodId: result.workPeriodId } };
		}
		return approveWorkPeriodRefusal(result.reason, workPeriodId);
	} catch (error) {
		logger.error({ error, workPeriodId }, "Approve work period error");
		return APPROVE_WORK_PERIOD_FAILED;
	}
}

const APPROVE_WORK_PERIOD_FAILED = {
	success: false,
	error: "Failed to approve work period. Please try again.",
} as const;

const APPROVE_WORK_PERIOD_CONFLICTS: Partial<Record<TimeApprovalDecisionRefusalReason, string>> = {
	already_decided: "This approval has already been decided.",
	changed: "This approval changed after it was loaded. Reload and try again.",
	evidence_required:
		"The evidence for this decision is incomplete. Review is required before a decision can be recorded.",
	month_closed:
		"The month of this entry is closed. It must be reopened before its work can change.",
};

// A conflict reaches the table as its conflict result; any other refusal is redacted.
function approveWorkPeriodRefusal(
	reason: TimeApprovalDecisionRefusalReason,
	workPeriodId: string,
): ServerActionResult<{ workPeriodId: string }> {
	if (reason === "right_not_held") {
		return { success: false, error: "Only admins and owners can approve time entries" };
	}
	const conflict = APPROVE_WORK_PERIOD_CONFLICTS[reason];
	if (conflict) {
		return { success: false, error: conflict, code: "ConflictError" };
	}
	logger.error({ reason, workPeriodId }, "Approve work period refused");
	return APPROVE_WORK_PERIOD_FAILED;
}

export async function updateWorkPeriodNotes(
	workPeriodId: string,
	notes: string,
): Promise<ServerActionResult<{ workPeriodId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedWorkPeriod] = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.employeeId, currentEmployee.id),
					eq(workPeriod.organizationId, currentEmployee.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1);

		if (!selectedWorkPeriod) {
			return { success: false, error: "Work period not found" };
		}

		if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
			return {
				success: false,
				error: "You can only update your own work periods",
			};
		}

		if (!selectedWorkPeriod.clockOutId) {
			return {
				success: false,
				error: "Cannot add notes to an active work period",
			};
		}

		await db
			.update(timeEntry)
			.set({ notes })
			.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		return { success: true, data: { workPeriodId } };
	} catch (error) {
		logger.error({ error }, "Update work period notes error");
		return {
			success: false,
			error: "Failed to update notes. Please try again.",
		};
	}
}

export async function deleteWorkPeriod(
	workPeriodId: string,
): Promise<ServerActionResult<{ deleted: boolean }>> {
	void workPeriodId;
	return { success: false, error: "Deletion requires manager approval" };
}

export async function splitWorkPeriod(
	workPeriodId: string,
	splitDateKey: string,
	splitTime: string,
	beforeNotes?: string,
	afterNotes?: string,
	disambiguation?: "earlier" | "later",
	submissionId?: string,
	vehicleSplitKm?: number,
): Promise<
	ServerActionResult<{ firstPeriodId: string; secondPeriodId: string }>
> {
	return splitOwnWorkPeriod({
		workPeriodId,
		splitDateKey,
		splitTime,
		beforeNotes,
		afterNotes,
		disambiguation,
		submissionId,
		vehicleSplitKm,
	});
}

export async function updateTimeEntryNotes(
	entryId: string,
	notes: string,
): Promise<ServerActionResult<{ entryId: string }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	try {
		const [selectedEntry] = await db
			.select()
			.from(timeEntry)
			.where(eq(timeEntry.id, entryId))
			.limit(1);

		if (!selectedEntry) {
			return { success: false, error: "Time entry not found" };
		}

		if (selectedEntry.employeeId !== currentEmployee.id) {
			return {
				success: false,
				error: "You can only update your own time entries",
			};
		}

		await db.update(timeEntry).set({ notes }).where(eq(timeEntry.id, entryId));
		return { success: true, data: { entryId } };
	} catch (error) {
		logger.error({ error }, "Update time entry notes error");
		return {
			success: false,
			error: "Failed to update notes. Please try again.",
		};
	}
}

/** One implementation: the calendar action owns project changes (#286). */
export async function updateWorkPeriodProject(
	workPeriodId: string,
	projectId: string | null,
	taskId?: string | null,
	options: { billable?: boolean } = {},
): Promise<
	ServerActionResult<{ workPeriodId: string; projectId: string | null }>
> {
	return updateWorkPeriodProjectAction(workPeriodId, projectId, taskId, options);
}
