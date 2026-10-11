import { and, eq } from "drizzle-orm";
import { db as applicationDatabase } from "@/db";
import { employee, periodSubmission } from "@/db/schema";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import {
	PERIOD_SUBMISSION_CANCEL_REASONS,
	PERIOD_SUBMISSION_WORKFLOW_TYPE,
} from "@/lib/approvals/domain-adapters/period-submission-contract";
import { createPeriodSubmissionApprovalRuntime } from "@/lib/approvals/server/period-submission-runtime";
import { PERIOD_SUBMISSION_CHANGE_SYSTEM_ID } from "@/lib/approvals/workflow/ports";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { AuditAction } from "@/lib/audit-logger";
import { type Clock, parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import { isUuid } from "@/lib/validations/uuid";
import type { PeriodSubmissionClosedCause } from "./submission-status";
import {
	findLivePeriodSubmission,
	insertPeriodSubmissionAudit,
	loadPeriodSubmissionForUpdate,
	lockEmployeePeriodSubmissions,
	type PeriodSubmissionDatabase,
} from "./submission-store";

/**
 * Withdrawing a pending period submission (#1060). The canonical workflow is cancelled (its
 * cards are refreshed to a status notice by the delivery owner, and it leaves every inbox), the
 * row closes as `withdrawn` with its cause, and an audit entry records who and when. An approved
 * or rejected submission is never withdrawn here.
 */

type Database = typeof applicationDatabase;

/** Who caused a withdrawal. `system` is a change nobody signed in made (#1062). */
export type PeriodSubmissionWithdrawalActor = { kind: "user"; userId: string } | { kind: "system" };

export type WithdrawPeriodSubmissionResult =
	| { kind: "withdrawn"; submissionId: string; workflowId: string }
	| {
			kind: "refused";
			reason: /** The user has no active employee in the organization. */
				| "not_employee"
				/** No pending submission of the employee for that period or id. */
				| "not_pending";
	  };

class WithdrawalRefused extends Error {
	constructor(readonly reason: "not_pending") {
		super(`Period submission withdrawal refused: ${reason}`);
	}
}

/**
 * Withdraws one pending submission inside the caller's transaction (the application database or
 * an open drizzle transaction; the approval engine runs in a savepoint of it). Takes the
 * employee's period-submission lock first, like submitting and deciding.
 *
 * - `cause: "employee"`: the employee takes it back; `actor` must be the submitter's user.
 * - `cause: "change"` (#1062): the period changed. A user actor other than the submitter cancels
 *   under a management grant scoped to this one cancel; that user must be an active employee of
 *   the organization. A `system` actor cancels with the writer seam's narrow system capability
 *   (`PERIOD_SUBMISSION_CHANGE_SYSTEM_ID`), so a departed submitter's submission is withdrawn
 *   too, and is audited as the submitter with `automatic: true`.
 *
 * Returns `not_pending` (and changes nothing) when the submission is missing, not pending, or
 * not the actor's own for an employee withdrawal. Delivery is not kicked: callers kick after
 * commit (`kickApprovalDelivery`), or the delivery owner picks the cancellation up on its run.
 */
export async function withdrawPeriodSubmissionInTransaction(
	database: PeriodSubmissionDatabase,
	input: {
		organizationId: string;
		submissionId: string;
		cause: PeriodSubmissionClosedCause;
		actor: PeriodSubmissionWithdrawalActor;
	},
	dependencies: { clock?: Clock } = {},
): Promise<WithdrawPeriodSubmissionResult> {
	const clock = dependencies.clock ?? systemClock;
	if (!isUuid(input.submissionId)) return { kind: "refused", reason: "not_pending" };
	const [unlocked] = await database
		.select({ employeeId: periodSubmission.employeeId })
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.id, input.submissionId),
			),
		)
		.limit(1);
	if (!unlocked) return { kind: "refused", reason: "not_pending" };
	await lockEmployeePeriodSubmissions(database, {
		organizationId: input.organizationId,
		employeeId: unlocked.employeeId,
	});
	const row = await loadPeriodSubmissionForUpdate(database, {
		organizationId: input.organizationId,
		submissionId: input.submissionId,
	});
	if (row?.status !== "pending" || !row.approvalWorkflowId) {
		return { kind: "refused", reason: "not_pending" };
	}
	const workflowId = row.approvalWorkflowId;
	const [submitter] = await database
		.select({ userId: employee.userId })
		.from(employee)
		.where(and(eq(employee.organizationId, input.organizationId), eq(employee.id, row.employeeId)))
		.limit(1);
	if (!submitter) return { kind: "refused", reason: "not_pending" };
	const actorUserId = input.actor.kind === "user" ? input.actor.userId : submitter.userId;
	if (input.cause === "employee" && actorUserId !== submitter.userId) {
		return { kind: "refused", reason: "not_pending" };
	}
	const now = clock.nowInstant();
	const runtime = createPeriodSubmissionApprovalRuntime(
		database as unknown as ApprovalWorkflowDatabase,
		{
			clock: { nowInstant: () => now },
			// Only a withdrawal after a change may be cancelled by someone other than the submitter.
			canManageApproval: async () => input.cause === "change",
		},
	);
	try {
		await runtime.repository.withTransaction(async (context) => {
			const snapshot = await context.repository.loadSnapshot({
				organizationId: input.organizationId,
				workflowId,
			});
			if (snapshot.workflowType !== PERIOD_SUBMISSION_WORKFLOW_TYPE) {
				throw new Error("Period submission is bound to another workflow kind");
			}
			if (snapshot.status !== "pending") throw new WithdrawalRefused("not_pending");
			await runtime.transitionEngine.executeInTransactionWithDisposition(context, {
				organizationId: input.organizationId,
				workflowId,
				expectedVersion: snapshot.version,
				idempotencyKey: `period-submission-withdrawal:${row.id}`,
				principal:
					input.actor.kind === "system"
						? { kind: "system", systemId: PERIOD_SUBMISSION_CHANGE_SYSTEM_ID }
						: { kind: "employee", userId: actorUserId },
				command: { type: "cancel", reason: PERIOD_SUBMISSION_CANCEL_REASONS[input.cause] },
			});
		});
	} catch (error) {
		if (error instanceof WithdrawalRefused) return { kind: "refused", reason: error.reason };
		throw error;
	}
	await insertPeriodSubmissionAudit(database, {
		organizationId: input.organizationId,
		submission: row,
		action: AuditAction.PERIOD_SUBMISSION_WITHDRAWN,
		actorUserId,
		at: now,
		closedCause: input.cause,
		...(input.actor.kind === "system" ? { metadata: { automatic: true } } : {}),
	});
	return { kind: "withdrawn", submissionId: row.id, workflowId };
}

/**
 * The signed-in employee takes back their own pending submission of one period, named like
 * `submitPeriodSubmission` names it (the first date of its range). The period then awaits
 * submission again.
 */
export async function withdrawOwnPeriodSubmission(
	input: { organizationId: string; userId: string; periodStartDate: string },
	dependencies: { database?: Database; clock?: Clock } = {},
): Promise<WithdrawPeriodSubmissionResult> {
	const database = dependencies.database ?? applicationDatabase;
	try {
		parsePlainDate(input.periodStartDate);
	} catch {
		return { kind: "refused", reason: "not_pending" };
	}
	const [submitter] = await database
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.userId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!submitter) return { kind: "refused", reason: "not_employee" };
	const live = await findLivePeriodSubmission(database, {
		organizationId: input.organizationId,
		employeeId: submitter.id,
		startDate: input.periodStartDate,
	});
	if (live?.status !== "pending") return { kind: "refused", reason: "not_pending" };
	const result = await database.transaction((tx) =>
		withdrawPeriodSubmissionInTransaction(
			tx,
			{
				organizationId: input.organizationId,
				submissionId: live.id,
				cause: "employee",
				actor: { kind: "user", userId: input.userId },
			},
			{ clock: dependencies.clock },
		),
	);
	if (result.kind === "withdrawn") {
		kickApprovalDelivery({ organizationId: input.organizationId, workflowId: result.workflowId });
	}
	return result;
}
