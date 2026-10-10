import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { db } from "@/db";
import { auditLog, periodSubmission } from "@/db/schema";
import type { AuditAction } from "@/lib/audit-logger";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { SubmissionWeekday } from "./cadence";
import {
	LIVE_PERIOD_SUBMISSION_STATUSES,
	type PeriodSubmissionClosedCause,
	type PeriodSubmissionStatus,
} from "./submission-status";

/**
 * The period submission store (#1059): every read and write of `period_submission` rows. All
 * functions take the caller's client (the application database or a transaction) and scope by
 * organization. Writes run inside the caller's transaction; the workflow, evidence and audit of
 * the same change commit or roll back with them.
 */

export type PeriodSubmissionDatabase =
	| typeof db
	| Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PeriodSubmissionRow = typeof periodSubmission.$inferSelect;

/** Audit entity type of period submission entries. */
export const PERIOD_SUBMISSION_AUDIT_ENTITY_TYPE = "period_submission";

/**
 * Serializes every write about one employee's period submissions in the caller's transaction:
 * submitting, deciding, withdrawing and the writer seam (#1062) take it before they read the
 * rows they change, so a concurrent change cannot slip between a check and the write.
 */
export async function lockEmployeePeriodSubmissions(
	database: Pick<PeriodSubmissionDatabase, "execute">,
	input: { organizationId: string; employeeId: string },
): Promise<void> {
	await database.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`period_submission:${input.organizationId}:${input.employeeId}`}, 0))`,
	);
}

export interface NewPeriodSubmission {
	organizationId: string;
	employeeId: string;
	cadence: "weekly" | "monthly";
	weekStartDay: SubmissionWeekday | null;
	timezone: string;
	startDate: string;
	endDate: string;
	cadenceStartDate: string;
	cadenceEndDate: string;
	rangeStart: Instant;
	rangeEnd: Instant;
	submittedBy: string;
	submittedAt: Instant;
}

/** Inserts a pending submission without its workflow (bound right after routing). */
export async function insertPendingPeriodSubmission(
	database: PeriodSubmissionDatabase,
	input: NewPeriodSubmission,
): Promise<PeriodSubmissionRow> {
	const [row] = await database
		.insert(periodSubmission)
		.values({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			cadence: input.cadence,
			weekStartDay: input.weekStartDay,
			timezone: input.timezone,
			startDate: input.startDate,
			endDate: input.endDate,
			cadenceStartDate: input.cadenceStartDate,
			cadenceEndDate: input.cadenceEndDate,
			rangeStart: dateFromInstant(input.rangeStart),
			rangeEnd: dateFromInstant(input.rangeEnd),
			status: "pending",
			submittedBy: input.submittedBy,
			submittedAt: dateFromInstant(input.submittedAt),
		})
		.returning();
	if (!row) throw new Error("Period submission insert returned no row");
	return row;
}

/** Links a pending submission to its workflow; returns the affected row count. */
export async function bindPeriodSubmissionWorkflow(
	database: PeriodSubmissionDatabase,
	input: { organizationId: string; submissionId: string; workflowId: string },
): Promise<number> {
	const rows = await database
		.update(periodSubmission)
		.set({ approvalWorkflowId: input.workflowId, updatedAt: new Date() })
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.id, input.submissionId),
				eq(periodSubmission.status, "pending"),
				sql`${periodSubmission.approvalWorkflowId} is null`,
			),
		)
		.returning({ id: periodSubmission.id });
	return rows.length;
}

/** The number of submissions linked to exactly this workflow (a replayed start's check). */
export async function countPeriodSubmissionsOfWorkflow(
	database: PeriodSubmissionDatabase,
	input: { organizationId: string; submissionId: string; workflowId: string },
): Promise<number> {
	const rows = await database
		.select({ id: periodSubmission.id })
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.id, input.submissionId),
				eq(periodSubmission.approvalWorkflowId, input.workflowId),
			),
		);
	return rows.length;
}

/** The live (pending or approved) submission of a period, if any. */
export async function findLivePeriodSubmission(
	database: PeriodSubmissionDatabase,
	input: { organizationId: string; employeeId: string; startDate: string },
): Promise<PeriodSubmissionRow | null> {
	const [row] = await database
		.select()
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.employeeId, input.employeeId),
				eq(periodSubmission.startDate, input.startDate),
				inArray(periodSubmission.status, [...LIVE_PERIOD_SUBMISSION_STATUSES]),
			),
		)
		.limit(1);
	return row ?? null;
}

/** One submission, locked for the caller's transaction. */
export async function loadPeriodSubmissionForUpdate(
	database: PeriodSubmissionDatabase,
	input: { organizationId: string; submissionId: string },
): Promise<PeriodSubmissionRow | null> {
	const [row] = await database
		.select()
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.id, input.submissionId),
			),
		)
		.for("update")
		.limit(1);
	return row ?? null;
}

/** One submission by its workflow. */
export async function loadPeriodSubmissionByWorkflow(
	database: PeriodSubmissionDatabase,
	input: { organizationId: string; workflowId: string },
): Promise<PeriodSubmissionRow | null> {
	const [row] = await database
		.select()
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.approvalWorkflowId, input.workflowId),
			),
		)
		.limit(1);
	return row ?? null;
}

/**
 * Every submission of one employee whose period starts in `[from, to]`, newest first within a
 * period. The first row per `startDate` is the period's latest submission.
 */
export async function listEmployeePeriodSubmissions(
	database: PeriodSubmissionDatabase,
	input: { organizationId: string; employeeId: string; from: string; to: string },
): Promise<PeriodSubmissionRow[]> {
	return database
		.select()
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.employeeId, input.employeeId),
				gte(periodSubmission.startDate, input.from),
				lte(periodSubmission.startDate, input.to),
			),
		)
		.orderBy(
			periodSubmission.startDate,
			desc(periodSubmission.submittedAt),
			desc(periodSubmission.id),
		);
}

/** The latest submission of each period in a list (rows from `listEmployeePeriodSubmissions`). */
export function latestSubmissionByPeriod(
	rows: readonly PeriodSubmissionRow[],
): Map<string, PeriodSubmissionRow> {
	const latest = new Map<string, PeriodSubmissionRow>();
	for (const row of rows) {
		const current = latest.get(row.startDate);
		if (!current || row.submittedAt.getTime() > current.submittedAt.getTime()) {
			latest.set(row.startDate, row);
		}
	}
	return latest;
}

/**
 * Records the approver's decision on a pending submission, in the decision's transaction.
 * Throws when the row is not the pending submission of that workflow.
 */
export async function recordPeriodSubmissionDecision(
	database: PeriodSubmissionDatabase,
	input: {
		organizationId: string;
		submissionId: string;
		workflowId: string;
		status: Extract<PeriodSubmissionStatus, "approved" | "rejected">;
		decidedAt: Instant;
		decidedByEmployeeId: string;
		reason: string | null;
	},
): Promise<PeriodSubmissionRow> {
	const [row] = await database
		.update(periodSubmission)
		.set({
			status: input.status,
			decidedAt: dateFromInstant(input.decidedAt),
			decidedByEmployeeId: input.decidedByEmployeeId,
			decisionReason: input.reason,
			revision: sql`${periodSubmission.revision} + 1`,
			updatedAt: dateFromInstant(input.decidedAt),
		})
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.id, input.submissionId),
				eq(periodSubmission.approvalWorkflowId, input.workflowId),
				eq(periodSubmission.status, "pending"),
			),
		)
		.returning();
	if (!row) throw new Error("Period submission is not pending for this workflow");
	return row;
}

/** Audit actions of period submissions (spec #805: actor, time and any reason). */
export type PeriodSubmissionAuditAction =
	| AuditAction.PERIOD_SUBMISSION_SUBMITTED
	| AuditAction.PERIOD_SUBMISSION_APPROVED
	| AuditAction.PERIOD_SUBMISSION_REJECTED
	| AuditAction.PERIOD_SUBMISSION_WITHDRAWN
	| AuditAction.PERIOD_SUBMISSION_OUTDATED;

/** One audit entry about a submission, written in the caller's transaction. */
export async function insertPeriodSubmissionAudit(
	database: PeriodSubmissionDatabase,
	input: {
		organizationId: string;
		submission: Pick<
			PeriodSubmissionRow,
			"id" | "employeeId" | "startDate" | "endDate" | "timezone" | "approvalWorkflowId"
		>;
		action: PeriodSubmissionAuditAction;
		actorUserId: string;
		at: Instant;
		reason?: string | null;
		closedCause?: PeriodSubmissionClosedCause;
		metadata?: Record<string, unknown>;
	},
): Promise<void> {
	await database.insert(auditLog).values({
		id: randomUUID(),
		organizationId: input.organizationId,
		entityType: PERIOD_SUBMISSION_AUDIT_ENTITY_TYPE,
		entityId: input.submission.id,
		action: input.action,
		performedBy: input.actorUserId,
		employeeId: input.submission.employeeId,
		metadata: JSON.stringify({
			startDate: input.submission.startDate,
			endDate: input.submission.endDate,
			timezone: input.submission.timezone,
			workflowId: input.submission.approvalWorkflowId,
			at: input.at.toString(),
			...(input.reason ? { reason: input.reason } : {}),
			...(input.closedCause ? { closedCause: input.closedCause } : {}),
			...input.metadata,
		}),
		timestamp: dateFromInstant(input.at),
	});
}
