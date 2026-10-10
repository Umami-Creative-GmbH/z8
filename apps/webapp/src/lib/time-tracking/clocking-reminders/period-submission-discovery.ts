import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import type { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { periodSubmission } from "@/db/schema";
import { periodSubmissionCadenceChange } from "@/db/schema/period-submission";
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
