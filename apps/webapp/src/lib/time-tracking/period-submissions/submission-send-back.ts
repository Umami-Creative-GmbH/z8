import { and, eq, gt, gte, inArray, lte, ne, or, type SQL } from "drizzle-orm";
import { employee, periodSubmission } from "@/db/schema";
import { periodSubmissionCadenceChange } from "@/db/schema/period-submission";
import { AuditAction } from "@/lib/audit-logger";
import {
	type Clock,
	compareInstants,
	dateFromInstant,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { type PeriodChange, periodChangeTouches } from "./period-change";
import { LIVE_PERIOD_SUBMISSION_STATUSES } from "./submission-status";
import {
	insertPeriodSubmissionAudit,
	lockEmployeePeriodSubmissions,
	outdateApprovedPeriodSubmission,
	type PeriodSubmissionDatabase,
} from "./submission-store";
import { withdrawPeriodSubmissionInTransaction } from "./submission-withdrawal";

/**
 * The writer seam of period submissions (#1062, spec #805): every writer of work, work
 * attribution and absences calls it inside its own transaction, after its write, with what it
 * changed. A pending submission whose period the change touches is withdrawn automatically (its
 * approval is cancelled, so cards and inbox items go), and an approved one goes out of date (the
 * approval stays as history). Either way the period awaits submission again, shown as "sent back
 * after a change", and the employee is notified by the period submission reminder job.
 *
 * The transaction client is the writer's: a work transaction's `scope.db`, the drizzle
 * transaction inside an Effect `dbService`, or a plain `db.transaction` client. At runtime each is
 * a drizzle transaction; the approval engine opens a savepoint on it. Nothing leaves the
 * transaction, so a coordinator may retry the writer's operation.
 */

/** The writer's transaction client; a drizzle transaction at runtime. */
export type PeriodSubmissionChangeClient = Pick<Transaction, "select" | "execute">;

export interface SendBackPeriodSubmissionsResult {
	/** Pending submissions withdrawn, with the workflow that was cancelled. */
	withdrawn: { submissionId: string; workflowId: string }[];
	/** Approved submissions now out of date. */
	outdated: string[];
}

const NOTHING: SendBackPeriodSubmissionsResult = { withdrawn: [], outdated: [] };

/**
 * Sends back the employee's submitted periods that `change` touches, even in part.
 *
 * Cheap when the organization never collected period submissions: one indexed read of its
 * cadence history, and nothing else. A submission can only exist where a cadence was on, and a
 * first submission cannot follow a cadence switched on within one transaction (the first
 * expected period starts at the next boundary), so that read cannot miss a concurrent submit.
 * Otherwise the employee's period-submission lock serializes the seam with submitting,
 * deciding and withdrawing: a submit either commits first (and is seen here) or waits for the
 * writer's commit (and reads the change).
 */
export async function sendBackChangedPeriodSubmissions(
	client: PeriodSubmissionChangeClient,
	input: { organizationId: string; employeeId: string } & PeriodChange,
	dependencies: { clock?: Clock } = {},
): Promise<SendBackPeriodSubmissionsResult> {
	const work = input.work ?? [];
	const days = input.days ?? [];
	if (work.length === 0 && days.length === 0) return NOTHING;
	const database = client as unknown as PeriodSubmissionDatabase;
	const [collecting] = await database
		.select({ id: periodSubmissionCadenceChange.id })
		.from(periodSubmissionCadenceChange)
		.where(
			and(
				eq(periodSubmissionCadenceChange.organizationId, input.organizationId),
				ne(periodSubmissionCadenceChange.cadence, "off"),
			),
		)
		.limit(1);
	if (!collecting) return NOTHING;

	await lockEmployeePeriodSubmissions(database, input);
	const window = changeWindow({ work, days });
	const candidates = await database
		.select({
			id: periodSubmission.id,
			status: periodSubmission.status,
			startDate: periodSubmission.startDate,
			endDate: periodSubmission.endDate,
			rangeStart: periodSubmission.rangeStart,
			rangeEnd: periodSubmission.rangeEnd,
			submitterUserId: employee.userId,
		})
		.from(periodSubmission)
		.innerJoin(
			employee,
			and(
				eq(employee.id, periodSubmission.employeeId),
				eq(employee.organizationId, periodSubmission.organizationId),
			),
		)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.employeeId, input.employeeId),
				inArray(periodSubmission.status, [...LIVE_PERIOD_SUBMISSION_STATUSES]),
				window,
			),
		)
		.orderBy(periodSubmission.startDate)
		.for("update", { of: periodSubmission });
	const touched = candidates.filter((row) =>
		periodChangeTouches(
			{ work, days },
			{
				startDate: row.startDate,
				endDate: row.endDate,
				rangeStart: instantFromDate(row.rangeStart),
				rangeEnd: instantFromDate(row.rangeEnd),
			},
		),
	);
	if (touched.length === 0) return NOTHING;

	const clock = dependencies.clock ?? systemClock;
	const result: SendBackPeriodSubmissionsResult = { withdrawn: [], outdated: [] };
	for (const row of touched) {
		if (row.status === "pending") {
			const withdrawn = await withdrawPeriodSubmissionInTransaction(
				database,
				{
					organizationId: input.organizationId,
					submissionId: row.id,
					cause: "change",
					actor: { kind: "system" },
				},
				{ clock },
			);
			if (withdrawn.kind === "withdrawn") {
				result.withdrawn.push({ submissionId: row.id, workflowId: withdrawn.workflowId });
			}
			continue;
		}
		const now = clock.nowInstant();
		const outdated = await outdateApprovedPeriodSubmission(database, {
			organizationId: input.organizationId,
			submissionId: row.id,
			closedAt: now,
		});
		await insertPeriodSubmissionAudit(database, {
			organizationId: input.organizationId,
			submission: outdated,
			action: AuditAction.PERIOD_SUBMISSION_OUTDATED,
			actorUserId: row.submitterUserId,
			at: now,
			closedCause: "change",
			metadata: { automatic: true },
		});
		result.outdated.push(row.id);
	}
	return result;
}

/**
 * A coarse SQL prefilter for the rows a change may touch: the instants from the earliest work
 * start to the latest end (open for live work), or the local days from the earliest absence day
 * to the latest. `periodChangeTouches` decides exactly.
 */
function changeWindow(change: Required<PeriodChange>): SQL | undefined {
	const conditions: SQL[] = [];
	if (change.work.length > 0) {
		const starts = change.work.map((interval) => interval.start);
		const earliest = starts.reduce((left, right) =>
			compareInstants(left, right) <= 0 ? left : right,
		);
		const ends = change.work.map((interval) => interval.end);
		const latest = ends.some((end) => end === null)
			? null
			: (ends as NonNullable<(typeof ends)[number]>[]).reduce((left, right) =>
					compareInstants(left, right) >= 0 ? left : right,
				);
		const condition = and(
			gt(periodSubmission.rangeEnd, dateFromInstant(earliest)),
			latest ? lte(periodSubmission.rangeStart, dateFromInstant(latest)) : undefined,
		);
		if (condition) conditions.push(condition);
	}
	if (change.days.length > 0) {
		const first = change.days.map((range) => range.startDate).toSorted()[0];
		const last = change.days
			.map((range) => range.endDate)
			.toSorted()
			.at(-1);
		if (first && last) {
			const condition = and(
				lte(periodSubmission.startDate, last),
				gte(periodSubmission.endDate, first),
			);
			if (condition) conditions.push(condition);
		}
	}
	return or(...conditions);
}
