import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { employee, periodSubmission, userSettings } from "@/db/schema";
import { periodSubmissionCadenceChange } from "@/db/schema/period-submission";
import { dateFromInstant, type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { LIVE_PERIOD_SUBMISSION_STATUSES } from "@/lib/time-tracking/period-submissions/submission-status";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";

type Database = Pick<typeof db, "select" | "selectDistinct">;

export interface PeriodSubmissionReminderOrganization {
	organizationId: string;
	/** The zone employees without their own timezone fall back to. */
	timezone: string;
}

/**
 * Organizations that are not deleted and ever saved a submission cadence other than off: only they
 * can expect period submissions. Independent of the clocking reminder settings, so an
 * organization whose only reminder is the period submission one is visited too.
 */
export async function listPeriodSubmissionReminderOrganizations(
	input: { after: string | null; limit: number },
	database: Database,
): Promise<PeriodSubmissionReminderOrganization[]> {
	const rows = await database
		.selectDistinct({
			organizationId: periodSubmissionCadenceChange.organizationId,
			timezone: organization.timezone,
		})
		.from(periodSubmissionCadenceChange)
		.innerJoin(organization, eq(organization.id, periodSubmissionCadenceChange.organizationId))
		.where(
			and(
				isNull(organization.deletedAt),
				ne(periodSubmissionCadenceChange.cadence, "off"),
				input.after ? gt(periodSubmissionCadenceChange.organizationId, input.after) : undefined,
			),
		)
		.orderBy(asc(periodSubmissionCadenceChange.organizationId))
		.limit(input.limit);
	return rows.map((row) => ({
		organizationId: row.organizationId,
		timezone: resolveEffectiveTimezone(null, row.timezone),
	}));
}

/**
 * The last days (YYYY-MM-DD) of the periods each employee has a live (pending or approved)
 * submission for, among `endDates`, in one query.
 */
export async function loadSubmittedPeriodEndDates(
	input: { organizationId: string; employeeIds: readonly string[]; endDates: readonly string[] },
	database: Database,
): Promise<Map<string, Set<string>>> {
	const submitted = new Map<string, Set<string>>();
	if (input.employeeIds.length === 0 || input.endDates.length === 0) return submitted;
	const rows = await database
		.select({ employeeId: periodSubmission.employeeId, endDate: periodSubmission.endDate })
		.from(periodSubmission)
		.where(
			and(
				eq(periodSubmission.organizationId, input.organizationId),
				inArray(periodSubmission.employeeId, [...input.employeeIds]),
				inArray(periodSubmission.endDate, [...input.endDates]),
				inArray(periodSubmission.status, [...LIVE_PERIOD_SUBMISSION_STATUSES]),
			),
		);
	for (const row of rows) {
		const dates = submitted.get(row.employeeId) ?? new Set<string>();
		dates.add(row.endDate);
		submitted.set(row.employeeId, dates);
	}
	return submitted;
}

/** A submitted period a change sent back (#1062), with the employee to tell. */
export interface SentBackPeriodSubmission {
	submissionId: string;
	employeeId: string;
	userId: string;
	/** The employee's own timezone, otherwise the organization's. */
	timezone: string;
	startDate: string;
	endDate: string;
	outcome: "withdrawn" | "outdated";
	closedAt: Instant;
}

/**
 * The organization's submissions sent back after a change in `[since, now]` whose employee still
 * has access and has not submitted the period again, oldest first, in one query.
 */
export async function listSentBackPeriodSubmissions(
	input: {
		organization: PeriodSubmissionReminderOrganization;
		since: Instant;
		now: Instant;
		limit: number;
	},
	database: Database,
): Promise<SentBackPeriodSubmission[]> {
	const rows = await database
		.select({
			submissionId: periodSubmission.id,
			employeeId: periodSubmission.employeeId,
			userId: employee.userId,
			userTimezone: userSettings.timezone,
			startDate: periodSubmission.startDate,
			endDate: periodSubmission.endDate,
			status: periodSubmission.status,
			closedAt: periodSubmission.closedAt,
		})
		.from(periodSubmission)
		.innerJoin(
			employee,
			and(
				eq(employee.id, periodSubmission.employeeId),
				eq(employee.organizationId, periodSubmission.organizationId),
			),
		)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(periodSubmission.organizationId, input.organization.organizationId),
				eq(periodSubmission.closedCause, "change"),
				inArray(periodSubmission.status, ["withdrawn", "outdated"]),
				gte(periodSubmission.closedAt, dateFromInstant(input.since)),
				lte(periodSubmission.closedAt, dateFromInstant(input.now)),
				employeeHasOrganizationAccess(input.now),
				// Table-qualified: inside the subquery a bare column would bind to its own table.
				sql`not exists (
					select 1 from period_submission resubmitted
					where resubmitted.organization_id = "period_submission"."organization_id"
						and resubmitted.employee_id = "period_submission"."employee_id"
						and resubmitted.start_date = "period_submission"."start_date"
						and resubmitted.status in ('pending', 'approved')
				)`,
			),
		)
		.orderBy(asc(periodSubmission.closedAt), asc(periodSubmission.id))
		.limit(input.limit);
	return rows.flatMap((row) =>
		row.closedAt && (row.status === "withdrawn" || row.status === "outdated")
			? [
					{
						submissionId: row.submissionId,
						employeeId: row.employeeId,
						userId: row.userId,
						timezone: resolveEffectiveTimezone(row.userTimezone, input.organization.timezone),
						startDate: row.startDate,
						endDate: row.endDate,
						outcome: row.status,
						closedAt: instantFromDate(row.closedAt),
					},
				]
			: [],
	);
}