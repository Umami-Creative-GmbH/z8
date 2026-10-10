import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { type SubmissionCadenceChange, scheduledSubmissionPeriods } from "./cadence";
import type { ExpectedSubmissionPeriod } from "./expected-periods";
import {
	isPeriodSubmittable,
	type PeriodSubmissionClosedCause,
	type PeriodSubmissionStatus,
	type PeriodSubmissionViewStatus,
	periodSubmissionViewStatus,
} from "./submission-status";

/**
 * The period submission status overview (#1063), pure parts. One submission period is selected
 * across employees by its whole week or month (`cadenceStartDate`..`cadenceEndDate`).
 */

/** Whose statuses the viewer sees: owners and admins everyone, managers the employees they manage. */
export type PeriodSubmissionOverviewScope =
	| { kind: "all" }
	| { kind: "managed"; managerEmployeeId: string };

/**
 * The viewer's scope in the active organization, by settings access tier: owners and admins see
 * every covered employee, managers the ones they manage, everyone else nothing (null).
 */
export function periodSubmissionOverviewScope(input: {
	accessTier: "member" | "manager" | "orgAdmin";
	organizationId: string;
	employee: { id: string; organizationId: string } | null;
}): PeriodSubmissionOverviewScope | null {
	if (input.accessTier === "orgAdmin") return { kind: "all" };
	if (input.accessTier === "manager" && input.employee?.organizationId === input.organizationId) {
		return { kind: "managed", managerEmployeeId: input.employee.id };
	}
	return null;
}

/** A submission period the overview can show. Plain data; crosses to the client. */
export interface OverviewPeriod {
	/** The whole week or month, which identifies the period across employees. */
	startDate: string;
	endDate: string;
	cadence: "weekly" | "monthly";
}

/** How far back the period picker reaches. */
const OVERVIEW_LOOKBACK_MONTHS = 12;

/**
 * The periods the organization's cadence history schedules in its timezone that have started by
 * `today`, newest first, reaching back a year.
 */
export function listOverviewPeriods(input: {
	history: readonly SubmissionCadenceChange[];
	timezone: string;
	today: PlainDate;
}): OverviewPeriod[] {
	const scheduled = scheduledSubmissionPeriods(input.history, input.timezone, {
		from: input.today.subtract({ months: OVERVIEW_LOOKBACK_MONTHS }),
		to: input.today,
	});
	const periods = new Map<string, OverviewPeriod>();
	for (const period of scheduled) {
		if (comparePlainDates(period.startDate, input.today) > 0) continue;
		const startDate = period.cadenceStartDate.toString();
		periods.set(startDate, {
			startDate,
			endDate: period.cadenceEndDate.toString(),
			cadence: period.cadence.kind,
		});
	}
	return [...periods.values()].toSorted((left, right) =>
		right.startDate.localeCompare(left.startDate),
	);
}

/**
 * The period to show: the requested one if it is listed, else the newest period whose last day
 * has come (submissions are open), else the running period. Null when nothing is listed.
 */
export function selectOverviewPeriod(
	periods: readonly OverviewPeriod[],
	requested: string | null | undefined,
	today: PlainDate,
): OverviewPeriod | null {
	const match = requested ? periods.find((period) => period.startDate === requested) : undefined;
	if (match) return match;
	const todayKey = today.toString();
	return periods.find((period) => period.endDate <= todayKey) ?? periods[0] ?? null;
}

/** A submission of the selected period, as the overview reads it. */
export interface OverviewSubmission {
	startDate: string;
	endDate: string;
	status: PeriodSubmissionStatus;
	closedCause: PeriodSubmissionClosedCause | null;
	submittedAt: Date;
}

/** One covered employee of the overview. Plain data; crosses to the client. */
export interface OverviewRow {
	employeeId: string;
	name: string;
	/** The employee's own range of the period: the submitted range, else the expected one. */
	startDate: string;
	endDate: string;
	status: PeriodSubmissionViewStatus;
	/** ISO instant of the latest submission, if any. */
	submittedAt: string | null;
	/** The employee owes the period: it is open for submission and has no live submission. */
	highlighted: boolean;
	/** The period's last day in the employee's zone, from which they can submit. */
	opensOn: string;
}

export type OverviewStatusCounts = Record<PeriodSubmissionViewStatus, number>;

export interface OverviewEmployee {
	employeeId: string;
	name: string;
	/** The employee's expected submission periods around the selected period. */
	expected: readonly ExpectedSubmissionPeriod[];
	/** The employee's submissions of the selected period, in any order. */
	submissions: readonly OverviewSubmission[];
}

function latestSubmission(
	submissions: readonly OverviewSubmission[],
	startDate: string,
): OverviewSubmission | null {
	let latest: OverviewSubmission | null = null;
	for (const submission of submissions) {
		if (submission.startDate !== startDate) continue;
		if (!latest || submission.submittedAt.getTime() > latest.submittedAt.getTime()) {
			latest = submission;
		}
	}
	return latest;
}

/**
 * The overview of one selected period: every employee expected to submit it, with the status of
 * their latest submission of their expected range (as the employee's own period view shows it).
 * Employees who owe the period once its last day has come in their zone are highlighted and
 * listed first; the rest follow by name.
 */
export function buildOverviewRows(input: {
	selected: OverviewPeriod;
	employees: readonly OverviewEmployee[];
	now: Instant;
}): { rows: OverviewRow[]; counts: OverviewStatusCounts } {
	const counts: OverviewStatusCounts = {
		awaiting_submission: 0,
		submitted: 0,
		approved: 0,
		rejected: 0,
		sent_back_after_change: 0,
	};
	const rows: OverviewRow[] = [];
	for (const person of input.employees) {
		const period = person.expected.find(
			(candidate) => candidate.cadenceStartDate.toString() === input.selected.startDate,
		);
		if (!period) continue;
		const startDate = period.startDate.toString();
		const submission = latestSubmission(person.submissions, startDate);
		const status = periodSubmissionViewStatus(submission);
		const live = status === "submitted" || status === "approved";
		const open = comparePlainDates(plainDateAt(input.now, period.timezone), period.endDate) >= 0;
		counts[status] += 1;
		rows.push({
			employeeId: person.employeeId,
			name: person.name,
			startDate,
			endDate: live && submission ? submission.endDate : period.endDate.toString(),
			status,
			submittedAt: submission ? submission.submittedAt.toISOString() : null,
			highlighted: open && isPeriodSubmittable(status),
			opensOn: period.endDate.toString(),
		});
	}
	rows.sort(
		(left, right) =>
			Number(right.highlighted) - Number(left.highlighted) || left.name.localeCompare(right.name),
	);
	return { rows, counts };
}
