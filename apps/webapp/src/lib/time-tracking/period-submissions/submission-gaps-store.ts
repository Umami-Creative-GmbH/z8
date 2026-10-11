import { and, asc, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, periodSubmission } from "@/db/schema";
import { type Instant, type PlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { scheduledSubmissionPeriods, widenedForEveryZone } from "./cadence";
import { deriveExpectedSubmissionPeriods } from "./expected-periods";
import { loadExpectedSubmissionFactsByEmployee } from "./organization-expected-periods";
import { employeeDisplayName } from "./overview-store";
import { periodSubmissionOverlaps } from "./period-overlap";
import { loadSubmissionCadenceHistory } from "./settings";
import { type PeriodSubmissionGap, periodSubmissionGaps } from "./submission-gaps";

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
 * ones) for the expected periods overlapping `window` (local days, inclusive) that started by
 * `now` in each employee's zone; one still running without a submission is `running`, not
 * missing. With no cadence in effect in the window nothing is collected
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
	const collected =
		scheduledSubmissionPeriods(history, "UTC", widenedForEveryZone(input.window)).length > 0;
	if (!collected) return { collected, gaps: [] };
	if (input.employeeIds?.length === 0) return { collected, gaps: [] };

	const employees = await database
		.select({ id: employee.id, name: employeeDisplayName })
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
				periodSubmissionOverlaps(input.window.from.toString(), input.window.to.toString()),
			),
		);
	const submissionsByEmployee = Map.groupBy(submissions, (row) => row.employeeId);
	const factsByEmployee = await loadExpectedSubmissionFactsByEmployee(database, {
		organizationId: input.organizationId,
		employeeIds: employees.map((row) => row.id),
		window: input.window,
	});

	const gaps: EmployeePeriodSubmissionGap[] = employees.flatMap((row) => {
		const facts = factsByEmployee.get(row.id);
		if (!facts) return [];
		const employeeName = row.name?.trim() || "—";
		return periodSubmissionGaps({
			periods: deriveExpectedSubmissionPeriods(facts, input.window),
			submissions: submissionsByEmployee.get(row.id) ?? [],
			today: plainDateAt(input.now, facts.timezone),
		}).map((gap) => ({ ...gap, employeeId: row.id, employeeName, timezone: facts.timezone }));
	});
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
