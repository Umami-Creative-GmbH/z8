import type { db as appDb } from "@/db";
import { type Instant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { PeriodSubmissionGapStatus } from "@/lib/time-tracking/period-submissions/submission-gaps";
import { loadPeriodSubmissionGaps } from "@/lib/time-tracking/period-submissions/submission-gaps-store";
import { type ClosedMonthKey, firstDayOfMonth } from "./rules";
import { type CloseMonthScope, employeesInScope } from "./store";

/**
 * What the close screen warns about without refusing the close (#1065): an expected period
 * submission (#805) touching the month that is missing, rejected or sent back after a change.
 * A pending submission is a close blocker instead.
 */
export interface CloseMonthWarning {
	kind: "period_submission";
	employeeId: string;
	employeeName: string;
	/** The period's first and last local day in the employee's timezone. */
	startDate: string;
	endDate: string;
	status: Exclude<PeriodSubmissionGapStatus, "submitted">;
}

/**
 * The warnings a close of the month for the scope would carry, for the employees the close
 * would cover: missing or unapproved period submissions touching the month. They never block
 * the close. Empty when no submission cadence is in effect in the month.
 */
export async function monthCloseWarnings(
	database: typeof appDb,
	input: {
		organizationId: string;
		month: ClosedMonthKey;
		scope: CloseMonthScope;
		now: Instant;
	},
): Promise<CloseMonthWarning[]> {
	const covered = await employeesInScope(database, input);
	if (covered.length === 0) return [];
	const first = parsePlainDate(firstDayOfMonth(input.month));
	const report = await loadPeriodSubmissionGaps(database, {
		organizationId: input.organizationId,
		employeeIds: covered.map((row) => row.id),
		window: { from: first, to: first.add({ months: 1 }).subtract({ days: 1 }) },
		now: input.now,
	});
	return report.gaps.flatMap((gap): CloseMonthWarning[] =>
		gap.status === "submitted"
			? []
			: [
					{
						kind: "period_submission",
						employeeId: gap.employeeId,
						employeeName: gap.employeeName,
						startDate: gap.startDate,
						endDate: gap.endDate,
						status: gap.status,
					},
				],
	);
}
