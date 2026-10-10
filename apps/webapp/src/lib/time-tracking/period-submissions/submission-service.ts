import { createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db as applicationDatabase } from "@/db";
import { user } from "@/db/auth-schema";
import { approvalStageAssignment, employee, workPeriod } from "@/db/schema";
import { kickApprovalDelivery } from "@/lib/approvals/delivery/kick";
import { periodSubmissionRoutingContext } from "@/lib/approvals/domain-adapters/period-submission.adapter";
import {
	PERIOD_SUBMISSION_SOURCE_TYPE,
	PERIOD_SUBMISSION_WORKFLOW_TYPE,
} from "@/lib/approvals/domain-adapters/period-submission-contract";
import {
	PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION,
	type PeriodSubmissionSubmittedFacts,
} from "@/lib/approvals/evidence/period-submission-facts";
import { capturePeriodSubmissionSubmittedRevision } from "@/lib/approvals/evidence/store";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { createPeriodSubmissionApprovalRuntime } from "@/lib/approvals/server/period-submission-runtime";
import {
	ApprovalWorkflowStartError,
	startApprovalWorkflow,
} from "@/lib/approvals/workflow/start-workflow";
import { AuditAction } from "@/lib/audit-logger";
import { buildDailyCompletedMinutes } from "@/lib/calendar/work-hours-summary";
import {
	type Clock,
	comparePlainDates,
	dateFromInstant,
	type Instant,
	parsePlainDate,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { isUuid } from "@/lib/validations/uuid";
import { loadExpectedSubmissionPeriods } from "./employee-expected-periods";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import { findPeriodSubmissionBlockers, type PeriodSubmissionBlocker } from "./submission-blockers";
import {
	bindPeriodSubmissionWorkflow,
	countPeriodSubmissionsOfWorkflow,
	findLivePeriodSubmission,
	insertPendingPeriodSubmission,
	insertPeriodSubmissionAudit,
	lockEmployeePeriodSubmissions,
	type PeriodSubmissionDatabase,
} from "./submission-store";

/**
 * Period submission entry points (#1059): submitting a period and deciding a submission. Both
 * run in one transaction with the canonical workflow, the submitted revision and the audit entry.
 * Period submissions are canonical-only (Approvals ADR-0002): nothing here writes a legacy
 * approval request.
 */

type Database = typeof applicationDatabase;

export type PeriodSubmissionRefusal =
	/** The user has no active employee in the organization. */
	| "not_employee"
	/** The period is not one the employee is expected to submit. */
	| "not_expected"
	/** Submitting opens on the period's last day. */
	| "period_not_ended"
	/** The period has a pending or approved submission. */
	| "already_submitted"
	/** Nobody other than the employee can decide it. */
	| "no_approver"
	/** Live work started in the period is running, or a request touching it is undecided (#1060). */
	| "period_open";

export type SubmitPeriodSubmissionResult =
	| {
			kind: "submitted";
			submissionId: string;
			workflowId: string;
			approverEmployeeIds: string[];
	  }
	| { kind: "refused"; reason: "period_open"; blockers: PeriodSubmissionBlocker[] }
	| { kind: "refused"; reason: Exclude<PeriodSubmissionRefusal, "period_open"> };

class SubmissionRefused extends Error {
	constructor(readonly reason: Exclude<PeriodSubmissionRefusal, "period_open">) {
		super(`Period submission refused: ${reason}`);
	}
}

class PeriodOpen extends Error {
	constructor(readonly blockers: PeriodSubmissionBlocker[]) {
		super("Period submission refused: period_open");
	}
}

function rangeOf(period: ExpectedSubmissionPeriod): { start: Instant; end: Instant } {
	return {
		start: period.startDate.toZonedDateTime(period.timezone).toInstant(),
		end: period.endDate.add({ days: 1 }).toZonedDateTime(period.timezone).toInstant(),
	};
}

/** Completed work of the range, per local day of the period's zone (the submitted totals). */
async function loadSubmittedWork(
	database: PeriodSubmissionDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		timezone: string;
		range: { start: Instant; end: Instant };
	},
): Promise<PeriodSubmissionSubmittedFacts["work"]> {
	const start = dateFromInstant(input.range.start);
	const end = dateFromInstant(input.range.end);
	const rows = await database
		.select({ startTime: workPeriod.startTime, endTime: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				completedWorkPeriodCondition(),
				lt(workPeriod.startTime, end),
				gt(workPeriod.endTime, start),
			),
		);
	const dayTotals = buildDailyCompletedMinutes(
		rows.flatMap((row) =>
			row.endTime ? [{ startedAt: row.startTime, endedAt: row.endTime }] : [],
		),
		input.timezone,
		{ start, endExclusive: end },
	);
	const sorted = Object.fromEntries(
		Object.entries(dayTotals).toSorted(([a], [b]) => a.localeCompare(b)),
	);
	return {
		totalMinutes: Object.values(sorted).reduce((total, minutes) => total + minutes, 0),
		dayTotals: sorted,
	};
}

/**
 * Submits one expected period of the user's own employee. The period is named by the first date
 * of its (clipped) range, as `deriveExpectedSubmissionPeriods` gives it. Refused before the
 * period's last day in the employee's zone, for a period that is not expected, while the
 * period has a pending or approved submission, and while it is still open (#1060: live work
 * started in it is running, or a request touching it is undecided; the refusal lists them). Routed by a matching period submission policy,
 * else to the primary manager; never to the employee themselves.
 */
export async function submitPeriodSubmission(
	input: { organizationId: string; userId: string; periodStartDate: string },
	dependencies: { database?: Database; clock?: Clock } = {},
): Promise<SubmitPeriodSubmissionResult> {
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	let startDate: ReturnType<typeof parsePlainDate>;
	try {
		startDate = parsePlainDate(input.periodStartDate);
	} catch {
		return { kind: "refused", reason: "not_expected" };
	}
	const [submitter] = await database
		.select({ id: employee.id, teamId: employee.teamId, name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.userId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!submitter) return { kind: "refused", reason: "not_employee" };
	const period = (
		await loadExpectedSubmissionPeriods(database, {
			organizationId: input.organizationId,
			employeeId: submitter.id,
			window: { from: startDate, to: startDate },
		})
	).find((candidate) => comparePlainDates(candidate.startDate, startDate) === 0);
	if (!period) return { kind: "refused", reason: "not_expected" };
	const now = clock.nowInstant();
	if (comparePlainDates(plainDateAt(now, period.timezone), period.endDate) < 0) {
		return { kind: "refused", reason: "period_not_ended" };
	}
	const range = rangeOf(period);
	const runtime = createPeriodSubmissionApprovalRuntime(database, { clock });
	try {
		const submitted = await runtime.repository.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as PeriodSubmissionDatabase;
			await lockEmployeePeriodSubmissions(tx, {
				organizationId: input.organizationId,
				employeeId: submitter.id,
			});
			const live = await findLivePeriodSubmission(tx, {
				organizationId: input.organizationId,
				employeeId: submitter.id,
				startDate: period.startDate.toString(),
			});
			if (live) throw new SubmissionRefused("already_submitted");
			const blockers = await findPeriodSubmissionBlockers(tx, {
				organizationId: input.organizationId,
				employeeId: submitter.id,
				timezone: period.timezone,
				startDate: period.startDate.toString(),
				endDate: period.endDate.toString(),
				range,
			});
			if (blockers.length > 0) throw new PeriodOpen(blockers);
			const row = await insertPendingPeriodSubmission(tx, {
				organizationId: input.organizationId,
				employeeId: submitter.id,
				cadence: period.cadence.kind,
				weekStartDay: period.cadence.kind === "weekly" ? period.cadence.weekStartDay : null,
				timezone: period.timezone,
				startDate: period.startDate.toString(),
				endDate: period.endDate.toString(),
				cadenceStartDate: period.cadenceStartDate.toString(),
				cadenceEndDate: period.cadenceEndDate.toString(),
				rangeStart: range.start,
				rangeEnd: range.end,
				submittedBy: input.userId,
				submittedAt: now,
			});
			const work = await loadSubmittedWork(tx, {
				organizationId: input.organizationId,
				employeeId: submitter.id,
				timezone: period.timezone,
				range,
			});
			const teamIds = submitter.teamId ? [submitter.teamId] : [];
			const defaultApproverEmployeeId = await getPrimaryEligibleManagerIdForRequester({
				db: tx as never,
				requesterEmployeeId: submitter.id,
				organizationId: input.organizationId,
			});
			const sourceIdentity = {
				organizationId: input.organizationId,
				workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
				sourceType: PERIOD_SUBMISSION_SOURCE_TYPE,
				sourceId: row.id,
			};
			const submissionKey = `period-submission:${row.id}`;
			const link = (workflowId: string, affectedRows: number) => ({
				organizationId: input.organizationId,
				sourceType: PERIOD_SUBMISSION_SOURCE_TYPE,
				sourceId: row.id,
				workflowId,
				affectedRows,
			});
			let started: Awaited<ReturnType<typeof startApprovalWorkflow>>;
			try {
				started = await startApprovalWorkflow({
					context,
					nowInstant: () => now,
					organizationId: input.organizationId,
					workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
					sourceIdentity,
					requesterEmployeeId: submitter.id,
					actor: { kind: "employee", employeeId: submitter.id, userId: input.userId },
					submissionKey,
					defaultApproverEmployeeId,
					routingContext: periodSubmissionRoutingContext({
						organizationId: input.organizationId,
						submissionId: row.id,
						requesterEmployeeId: submitter.id,
						teamIds,
					}),
					contextSnapshot: {
						teamIds,
						periodSubmission: {
							id: row.id,
							employeeId: submitter.id,
							timezone: period.timezone,
							startDate: row.startDate,
							endDate: row.endDate,
						},
					},
					displayProjection: {
						displayPayload: {
							kind: PERIOD_SUBMISSION_WORKFLOW_TYPE,
							cadence: row.cadence,
							timezone: row.timezone,
							startDate: row.startDate,
							endDate: row.endDate,
							totalMinutes: work.totalMinutes,
						},
						searchText: "period submission",
					},
					bindSourceWorkflow: async (workflowId) =>
						link(
							workflowId,
							await bindPeriodSubmissionWorkflow(tx, {
								organizationId: input.organizationId,
								submissionId: row.id,
								workflowId,
							}),
						),
					verifySourceWorkflow: async (workflowId) =>
						link(
							workflowId,
							await countPeriodSubmissionsOfWorkflow(tx, {
								organizationId: input.organizationId,
								submissionId: row.id,
								workflowId,
							}),
						),
				});
			} catch (error) {
				if (
					error instanceof ApprovalWorkflowStartError &&
					(error.code === "NO_DEFAULT_APPROVER" || error.code === "ACTIVATION_FAILED")
				) {
					throw new SubmissionRefused("no_approver");
				}
				throw error;
			}
			// The resolver never lets a period submission complete itself (#1059).
			if (started.kind !== "created" || started.terminal) {
				throw new Error("Period submission workflow did not start pending");
			}
			const workflowId = started.snapshot.id;
			await capturePeriodSubmissionSubmittedRevision(tx as never, {
				organizationId: input.organizationId,
				workflowId,
				requestCycleKey: submissionKey,
				submittedAt: now,
				facts: {
					schemaVersion: PERIOD_SUBMISSION_EVIDENCE_SCHEMA_VERSION,
					kind: "period_submission",
					organizationId: input.organizationId,
					periodSubmissionId: row.id,
					subjectEmployeeId: submitter.id,
					requesterEmployeeId: submitter.id,
					period: {
						cadence: row.cadence,
						timezone: row.timezone,
						startDate: row.startDate,
						endDate: row.endDate,
						rangeStart: range.start.toString(),
						rangeEnd: range.end.toString(),
					},
					work,
				},
				labels: { subjectName: submitter.name },
				submitter: { employeeId: submitter.id, userId: input.userId },
			});
			await insertPeriodSubmissionAudit(tx, {
				organizationId: input.organizationId,
				submission: { ...row, approvalWorkflowId: workflowId },
				action: AuditAction.PERIOD_SUBMISSION_SUBMITTED,
				actorUserId: input.userId,
				at: now,
				metadata: { totalMinutes: work.totalMinutes },
			});
			const approverEmployeeIds = started.snapshot.stages
				.flatMap((stage) => stage.assignments)
				.filter((assignment) => assignment.status === "pending")
				.map((assignment) => assignment.approverEmployeeId);
			return { kind: "submitted" as const, submissionId: row.id, workflowId, approverEmployeeIds };
		});
		kickApprovalDelivery({
			organizationId: input.organizationId,
			workflowId: submitted.workflowId,
		});
		return submitted;
	} catch (error) {
		if (error instanceof SubmissionRefused) return { kind: "refused", reason: error.reason };
		if (error instanceof PeriodOpen) {
			return { kind: "refused", reason: "period_open", blockers: error.blockers };
		}
		throw error;
	}
}

export class PeriodSubmissionDecisionError extends Error {
	constructor(readonly code: "not_found" | "not_pending" | "reason_required") {
		super(
			code === "reason_required"
				? "Rejection reason is required"
				: code === "not_pending"
					? "Period submission is not pending"
					: "Period submission approval not found",
		);
		this.name = "PeriodSubmissionDecisionError";
	}
}

function decisionKey(input: {
	assignmentId: string;
	action: string;
	reason: string | null;
}): string {
	const reason = createHash("sha256")
		.update(input.reason ?? "")
		.digest("hex");
	return `period-submission-decision:${input.assignmentId}:${input.action}:${reason}`;
}

/**
 * Decides one pending period submission assignment as the given employee: the assigned
 * approver, or (when the caller vouches that the actor manages approvals organization-wide) a
 * manager of approvals. The requester can never decide their own submission. A rejection needs
 * a reason. The approval locks nothing.
 */
export async function decidePeriodSubmission(
	input: {
		organizationId: string;
		actorEmployeeId: string;
		assignmentId: string;
		action: "approve" | "reject";
		reason?: string | null;
		/** The actor decides as a manager of approvals, re-checked by `canManageApprovals`. */
		allowOrganizationWideApprover?: boolean;
	},
	dependencies: {
		database?: Database;
		clock?: Clock;
		/** Whether the actor manages approvals organization-wide (the request's ability). */
		canManageApprovals?: () => Promise<boolean>;
	} = {},
): Promise<{ workflowId: string; status: "pending" | "approved" | "rejected" }> {
	const database = dependencies.database ?? applicationDatabase;
	const clock = dependencies.clock ?? systemClock;
	const reason = input.reason?.trim() ? input.reason.trim() : null;
	if (input.action === "reject" && !reason) {
		throw new PeriodSubmissionDecisionError("reason_required");
	}
	if (!isUuid(input.assignmentId) || !isUuid(input.actorEmployeeId)) {
		throw new PeriodSubmissionDecisionError("not_found");
	}
	const [actor] = await database
		.select({ userId: employee.userId })
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.id, input.actorEmployeeId),
				eq(employee.isActive, true),
			),
		)
		.limit(1);
	if (!actor) throw new PeriodSubmissionDecisionError("not_found");
	const runtime = createPeriodSubmissionApprovalRuntime(database, {
		clock,
		canManageApproval: async (actorEmployeeId) =>
			input.allowOrganizationWideApprover === true &&
			actorEmployeeId === input.actorEmployeeId &&
			(await (dependencies.canManageApprovals?.() ?? defaultCanManageApprovals())),
	});
	const decided = await runtime.repository.withTransaction(async (context) => {
		const tx = context.dbService.db as unknown as PeriodSubmissionDatabase;
		const [assignment] = await tx
			.select({
				workflowId: approvalStageAssignment.workflowId,
				stageId: approvalStageAssignment.stageId,
			})
			.from(approvalStageAssignment)
			.where(
				and(
					eq(approvalStageAssignment.organizationId, input.organizationId),
					eq(approvalStageAssignment.id, input.assignmentId),
				),
			)
			.limit(1);
		if (!assignment) throw new PeriodSubmissionDecisionError("not_found");
		const snapshot = await context.repository.loadSnapshot({
			organizationId: input.organizationId,
			workflowId: assignment.workflowId,
		});
		if (
			snapshot.workflowType !== PERIOD_SUBMISSION_WORKFLOW_TYPE ||
			!snapshot.requesterEmployeeId
		) {
			throw new PeriodSubmissionDecisionError("not_found");
		}
		if (snapshot.status !== "pending") throw new PeriodSubmissionDecisionError("not_pending");
		await lockEmployeePeriodSubmissions(tx, {
			organizationId: input.organizationId,
			employeeId: snapshot.requesterEmployeeId,
		});
		const execution = await runtime.transitionEngine.executeInTransactionWithDisposition(context, {
			organizationId: input.organizationId,
			workflowId: snapshot.id,
			expectedVersion: snapshot.version,
			idempotencyKey: decisionKey({
				assignmentId: input.assignmentId,
				action: input.action,
				reason,
			}),
			principal: { kind: "employee", userId: actor.userId },
			command:
				input.action === "approve"
					? { type: "approve", stageId: assignment.stageId, assignmentId: input.assignmentId }
					: {
							type: "reject",
							stageId: assignment.stageId,
							assignmentId: input.assignmentId,
							reason: reason ?? "",
						},
		});
		const status = execution.result.snapshot.status;
		return {
			workflowId: snapshot.id,
			status: status === "approved" || status === "rejected" ? status : ("pending" as const),
		};
	});
	kickApprovalDelivery({ organizationId: input.organizationId, workflowId: decided.workflowId });
	return decided;
}

async function defaultCanManageApprovals(): Promise<boolean> {
	const { getAbility } = await import("@/lib/auth-helpers");
	const ability = await getAbility();
	return ability?.cannot("manage", "Approval") === false;
}
