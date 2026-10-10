import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, periodSubmission } from "@/db/schema";
import { type Instant, type PlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { scheduledSubmissionPeriods } from "./cadence";
import { loadExpectedSubmissionPeriodFacts } from "./employee-expected-periods";
import { deriveExpectedSubmissionPeriods } from "./expected-periods";
import { loadSubmissionCadenceHistory } from "./settings";
import { type PeriodSubmissionGap, periodSubmissionGaps } from "./submission-gaps";
import type { PeriodSubmissionClosedCause, PeriodSubmissionStatus } from "./submission-status";

/** Employees whose facts are read at once; each read runs several queries. */
const EMPLOYEE_BATCH = 10;

export interface EmployeePeriodSubmissionGap extends PeriodSubmissionGap {
	employeeId: string;
	employeeName: string;
	/** The employee's timezone, which the period's days are in. */
	timezone: string;
}

export interface PeriodSubmissionGapReport {
	/** Whether a submission cadence is in effect anywhere in the window. */
	collected: boolean;
	gaps: EmployeePeriodSubmissionGap[];
}

/**
 * The missing or unapproved submissions (#1065) of the organization's employees (or the given
 * ones) for the expected periods overlapping `window` (local days, inclusive) that ended before
 * `now` in each employee's zone. With no cadence in effect in the window nothing is collected
 * and no employee is read. Every query is scoped to the organization.
 */
export async function loadPeriodSubmissionGaps(
	database: typeof db,
	input: {
		organizationId: string;
		employeeIds?: readonly string[];
		window: { from: PlainDate; to: PlainDate };
		now: Instant;
	},
): Promise<PeriodSubmissionGapReport> {
	const history = await loadSubmissionCadenceHistory(database, input.organizationId);
	// Widened by a day each side: every employee's zone is within a day of UTC.
	const collected =
		scheduledSubmissionPeriods(history, "UTC", {
			from: input.window.from.subtract({ days: 1 }),
			to: input.window.to.add({ days: 1 }),
		}).length > 0;
	if (!collected) return { collected, gaps: [] };
	if (input.employeeIds?.length === 0) return { collected, gaps: [] };

	const employees = await database
		.select({ id: employee.id, userName: user.name })
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				input.employeeIds ? inArray(employee.id, [...input.employeeIds]) : undefined,
			),
		)
		.orderBy(asc(employee.id));
	if (employees.length === 0) return { collected, gaps: [] };

	// Expected periods overlapping the window may start up to a month before it.
	const submissions = await database
		.select({
			employeeId: periodSubmission.employeeId,
			startDate: periodSubmission.startDate,
			status: periodSubmission.status,
			closedCause: periodSubmission.closedCause,
			submittedAt: periodSubmission.submittedAt,
		})
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				inArray(
					periodSubmission.employeeId,
					employees.map((row) => row.id),
				),
				lte(periodSubmission.startDate, input.window.to.toString()),
				gte(periodSubmission.endDate, input.window.from.toString()),
			),
		);
	const submissionsByEmployee = Map.groupBy(submissions, (row) => row.employeeId);

	const gaps: EmployeePeriodSubmissionGap[] = [];
	for (let index = 0; index < employees.length; index += EMPLOYEE_BATCH) {
		const batch = employees.slice(index, index + EMPLOYEE_BATCH);
		const results = await Promise.all(
			batch.map(async (row) => {
				const facts = await loadExpectedSubmissionPeriodFacts(database, {
					organizationId: input.organizationId,
					employeeId: row.id,
					window: input.window,
				});
				if (!facts) return [];
				const employeeGaps = periodSubmissionGaps({
					periods: deriveExpectedSubmissionPeriods(facts, input.window),
					submissions: (submissionsByEmployee.get(row.id) ?? []).map((submission) => ({
						startDate: submission.startDate,
						status: submission.status as PeriodSubmissionStatus,
						closedCause: submission.closedCause as PeriodSubmissionClosedCause | null,
						submittedAt: submission.submittedAt,
					})),
					today: plainDateAt(input.now, facts.timezone),
				});
				const employeeName = row.userName?.trim() || "—";
				return employeeGaps.map((gap) => ({
					...gap,
					employeeId: row.id,
					employeeName,
					timezone: facts.timezone,
				}));
			}),
		);
		gaps.push(...results.flat());
	}
	return {
		collected,
		gaps: gaps.toSorted(
			(left, right) =>
				left.employeeName.localeCompare(right.employeeName) ||
				left.employeeId.localeCompare(right.employeeId) ||
				left.startDate.localeCompare(right.startDate),
		),
	};
}
