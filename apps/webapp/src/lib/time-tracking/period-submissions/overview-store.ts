import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee, employeeManagers, periodSubmission } from "@/db/schema";
import { type Instant, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { loadExpectedSubmissionPeriodsByEmployee } from "./organization-expected-periods";
import {
	buildOverviewRows,
	listOverviewPeriods,
	type OverviewPeriod,
	type OverviewRow,
	type OverviewStatusCounts,
	type OverviewSubmission,
	type PeriodSubmissionOverviewScope,
	selectOverviewPeriod,
} from "./overview";
import { loadSubmissionCadenceHistory } from "./settings";

type Database = typeof db;

export type PeriodSubmissionOverview =
	| { kind: "off" }
	| {
			kind: "ok";
			/** The organization's timezone, in which the period picker is laid out. */
			timezone: string;
			periods: OverviewPeriod[];
			selected: OverviewPeriod;
			/** The selected period has not reached its last day in the organization's timezone. */
			running: boolean;
			rows: OverviewRow[];
			counts: OverviewStatusCounts;
	  };

const displayName = sql<string>`coalesce(nullif(trim(concat_ws(' ', ${user.firstName}, ${user.lastName})), ''), ${user.name})`;

/** The active employees of the organization in the viewer's scope, by name. */
async function listScopedEmployees(
	database: Database,
	input: { organizationId: string; scope: PeriodSubmissionOverviewScope },
): Promise<Array<{ employeeId: string; name: string }>> {
	const conditions = [
		eq(employee.organizationId, input.organizationId),
		eq(employee.isActive, true),
	];
	if (input.scope.kind === "all") {
		return database
			.select({ employeeId: employee.id, name: displayName })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(and(...conditions))
			.orderBy(asc(displayName), asc(employee.id));
	}
	return database
		.selectDistinct({ employeeId: employee.id, name: displayName })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.innerJoin(
			employeeManagers,
			and(
				eq(employeeManagers.employeeId, employee.id),
				eq(employeeManagers.managerId, input.scope.managerEmployeeId),
			),
		)
		.where(and(...conditions))
		.orderBy(asc(displayName), asc(employee.id));
}

/** Every submission of the selected period by the listed employees. */
async function listPeriodSubmissions(
	database: Database,
	input: { organizationId: string; employeeIds: string[]; cadenceStartDate: string },
): Promise<Array<OverviewSubmission & { employeeId: string }>> {
	const rows = await database
		.select({
			employeeId: periodSubmission.employeeId,
			startDate: periodSubmission.startDate,
			endDate: periodSubmission.endDate,
			status: periodSubmission.status,
			closedCause: periodSubmission.closedCause,
			submittedAt: periodSubmission.submittedAt,
		})
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				eq(periodSubmission.cadenceStartDate, input.cadenceStartDate),
				inArray(periodSubmission.employeeId, input.employeeIds),
			),
		);
	return rows.map((row) => ({
		...row,
		status: row.status as OverviewSubmission["status"],
		closedCause: row.closedCause as OverviewSubmission["closedCause"],
	}));
}

/**
 * The period submission status overview (#1063): for one submission period of the organization
 * (the requested one, else the newest period whose last day has come), every covered employee in
 * the viewer's scope who is expected to submit it, with their status. Read-only and scoped to the
 * organization. Off when the organization never scheduled a period.
 */
export async function loadPeriodSubmissionOverview(
	database: Database,
	input: {
		organizationId: string;
		scope: PeriodSubmissionOverviewScope;
		requestedPeriod?: string | null;
		now: Instant;
	},
): Promise<PeriodSubmissionOverview> {
	const [timezone, history] = await Promise.all([
		loadOrganizationTimezone(database, input.organizationId),
		loadSubmissionCadenceHistory(database, input.organizationId),
	]);
	const today = plainDateAt(input.now, timezone);
	const periods = listOverviewPeriods({ history, timezone, today });
	const selected = selectOverviewPeriod(periods, input.requestedPeriod, today);
	if (!selected) return { kind: "off" };

	const people = await listScopedEmployees(database, input);
	const employeeIds = people.map((person) => person.employeeId);
	const [expected, submissions] =
		employeeIds.length === 0
			? [new Map(), []]
			: await Promise.all([
					loadExpectedSubmissionPeriodsByEmployee(database, {
						organizationId: input.organizationId,
						employeeIds,
						// The period's local dates, read in each employee's own timezone.
						window: {
							from: parsePlainDate(selected.startDate),
							to: parsePlainDate(selected.endDate),
						},
					}),
					listPeriodSubmissions(database, {
						organizationId: input.organizationId,
						employeeIds,
						cadenceStartDate: selected.startDate,
					}),
				]);
	const submissionsByEmployee = Map.groupBy(submissions, (submission) => submission.employeeId);
	const { rows, counts } = buildOverviewRows({
		selected,
		now: input.now,
		employees: people.map((person) => ({
			...person,
			expected: expected.get(person.employeeId) ?? [],
			submissions: submissionsByEmployee.get(person.employeeId) ?? [],
		})),
	});
	const running = today.toString() < selected.endDate;
	return { kind: "ok", timezone, periods, selected, running, rows, counts };
}
