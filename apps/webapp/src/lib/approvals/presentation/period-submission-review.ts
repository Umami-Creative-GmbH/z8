import { comparePlainDates, parsePlainDate } from "@/lib/datetime/temporal-core";
import type {
	PeriodSubmissionAbsenceFact,
	PeriodSubmissionSubmittedFacts,
} from "../evidence/period-submission-facts";
import type {
	ApprovalInboxDetailSection,
	ApprovalInboxLocalizedText,
	ApprovalInboxValue,
} from "../inbox/types";

/**
 * The approver's card of a period submission (#1061): the period, its overall total, target and
 * difference, the day totals, the approved absences and public holidays, the compliance
 * violations recorded in the period (read-only), and a link to the calendar for the period.
 * Everything comes from the submitted facts, so every channel shows the same content.
 */

type KeyValueSection = Extract<ApprovalInboxDetailSection, { type: "key_value" }>;
type Row = KeyValueSection["rows"][number];

/** Minutes as `h:mm`. */
export function periodSubmissionHours(totalMinutes: number): string {
	const magnitude = Math.abs(totalMinutes);
	return `${Math.floor(magnitude / 60)}:${String(magnitude % 60).padStart(2, "0")}`;
}

/** A difference as a signed `h:mm` (`+0:00` when the target is met exactly). */
export function periodSubmissionDifference(totalMinutes: number): string {
	return `${totalMinutes < 0 ? "-" : "+"}${periodSubmissionHours(totalMinutes)}`;
}

function hoursText(totalMinutes: number): ApprovalInboxLocalizedText {
	return {
		key: "approvals:approvals.periodSubmission.totalHours",
		fallback: "{total} h",
		params: { total: periodSubmissionHours(totalMinutes) },
	};
}

function dateLabel(date: string): ApprovalInboxLocalizedText {
	return {
		key: "approvals:approvals.periodSubmission.dateLabel",
		fallback: "{date}",
		params: { date: { kind: "plain_date", date } },
	};
}

function rangeValue(startDate: string, endDate: string): ApprovalInboxValue {
	return { kind: "plain_date_range", start: startDate, end: endDate };
}

function rangeLabel(startDate: string, endDate: string): ApprovalInboxLocalizedText {
	return {
		key: "approvals:approvals.periodSubmission.rangeLabel",
		fallback: "{range}",
		params: { range: rangeValue(startDate, endDate) },
	};
}

/** The URL of the employee's calendar opened on the period's first day. */
export function periodSubmissionCalendarPath(facts: PeriodSubmissionSubmittedFacts): string {
	return `/calendar/${encodeURIComponent(facts.subjectEmployeeId)}?date=${facts.period.startDate}`;
}

function eachDate(startDate: string, endDate: string): string[] {
	const dates: string[] = [];
	const end = parsePlainDate(endDate);
	for (
		let day = parsePlainDate(startDate);
		comparePlainDates(day, end) <= 0;
		day = day.add({ days: 1 })
	) {
		dates.push(day.toString());
	}
	return dates;
}

function dayRows(facts: PeriodSubmissionSubmittedFacts): Row[] {
	const dayTargets = facts.target?.dayTargets ?? {};
	return eachDate(facts.period.startDate, facts.period.endDate).flatMap((date): Row[] => {
		const worked = facts.work.dayTotals[date];
		const target = dayTargets[date];
		if (worked === undefined && target === undefined) return [];
		return [
			{
				label: dateLabel(date),
				value:
					target === undefined
						? hoursText(worked ?? 0)
						: {
								key: "approvals:approvals.periodSubmission.dayOfTarget",
								fallback: "{worked} h of {target} h",
								params: {
									worked: periodSubmissionHours(worked ?? 0),
									target: periodSubmissionHours(target),
								},
							},
			},
		];
	});
}

function absenceValue(absence: PeriodSubmissionAbsenceFact): string | ApprovalInboxLocalizedText {
	const halfDay =
		absence.startDate === absence.endDate &&
		(absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day") &&
		absence.startPeriod === absence.endPeriod;
	if (halfDay) {
		return {
			key: "approvals:approvals.periodSubmission.absenceHalfDay",
			fallback: "{category} (half day)",
			params: { category: absence.categoryName },
		};
	}
	if (absence.startPeriod !== "full_day" || absence.endPeriod !== "full_day") {
		return {
			key: "approvals:approvals.periodSubmission.absencePartialDays",
			fallback: "{category} (with half days)",
			params: { category: absence.categoryName },
		};
	}
	return absence.categoryName;
}

// Keys stay full string literals so the Tolgee extractor can see them.
const VIOLATION_TYPES: Record<string, ApprovalInboxLocalizedText> = {
	max_daily: {
		key: "approvals:approvals.periodSubmission.violationType.maxDaily",
		fallback: "Maximum daily hours exceeded",
	},
	max_weekly: {
		key: "approvals:approvals.periodSubmission.violationType.maxWeekly",
		fallback: "Maximum weekly hours exceeded",
	},
	max_uninterrupted: {
		key: "approvals:approvals.periodSubmission.violationType.maxUninterrupted",
		fallback: "Maximum uninterrupted work exceeded",
	},
	break_required: {
		key: "approvals:approvals.periodSubmission.violationType.breakRequired",
		fallback: "Required break missing",
	},
	rest_period: {
		key: "approvals:approvals.periodSubmission.violationType.restPeriod",
		fallback: "Rest period too short",
	},
	overtime_daily: {
		key: "approvals:approvals.periodSubmission.violationType.overtimeDaily",
		fallback: "Daily overtime threshold exceeded",
	},
	overtime_weekly: {
		key: "approvals:approvals.periodSubmission.violationType.overtimeWeekly",
		fallback: "Weekly overtime threshold exceeded",
	},
	overtime_monthly: {
		key: "approvals:approvals.periodSubmission.violationType.overtimeMonthly",
		fallback: "Monthly overtime threshold exceeded",
	},
};

function groupedByDate<T>(entries: readonly T[], dateOf: (entry: T) => string): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const entry of entries) {
		const group = groups.get(dateOf(entry));
		if (group) group.push(entry);
		else groups.set(dateOf(entry), [entry]);
	}
	return groups;
}

export function buildPeriodSubmissionReviewSections(input: {
	facts: PeriodSubmissionSubmittedFacts;
	employeeName: string;
	/** The submission instant (ISO). */
	submittedAt: string;
}): ApprovalInboxDetailSection[] {
	const { facts } = input;
	const target = facts.target;
	const summaryRows: Row[] = [
		{
			label: { key: "approvals:approvals.periodSubmission.employee", fallback: "Employee" },
			value: input.employeeName,
		},
		{
			label: { key: "approvals:approvals.periodSubmission.period", fallback: "Period" },
			value: rangeValue(facts.period.startDate, facts.period.endDate),
		},
		{
			label: { key: "approvals:approvals.periodSubmission.total", fallback: "Total" },
			value: hoursText(facts.work.totalMinutes),
		},
	];
	if (target) {
		const difference = facts.work.totalMinutes - target.totalMinutes;
		summaryRows.push(
			{
				label: { key: "approvals:approvals.periodSubmission.target", fallback: "Target" },
				value: hoursText(target.totalMinutes),
			},
			{
				label: { key: "approvals:approvals.periodSubmission.difference", fallback: "Difference" },
				value: {
					key: "approvals:approvals.periodSubmission.differenceHours",
					fallback: "{difference} h",
					params: { difference: periodSubmissionDifference(difference) },
				},
				...(difference < 0 ? { tone: "warning" as const } : {}),
			},
		);
	}
	summaryRows.push(
		{
			label: { key: "approvals:approvals.periodSubmission.submittedAt", fallback: "Submitted" },
			value: { kind: "instant", at: input.submittedAt },
		},
		{
			label: { key: "approvals:approvals.periodSubmission.calendar", fallback: "Calendar" },
			value: {
				key: "approvals:approvals.periodSubmission.openCalendar",
				fallback: "Open the calendar for this period",
			},
			href: periodSubmissionCalendarPath(facts),
		},
	);
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: { key: "approvals:approvals.periodSubmission.title", fallback: "Period submission" },
			rows: summaryRows,
		},
	];
	const days = dayRows(facts);
	if (days.length > 0) {
		sections.push({
			type: "key_value",
			title: { key: "approvals:approvals.periodSubmission.dayTotals", fallback: "Day totals" },
			rows: days,
		});
	}
	if (facts.absences.length > 0) {
		sections.push({
			type: "key_value",
			title: {
				key: "approvals:approvals.periodSubmission.absences",
				fallback: "Approved absences",
			},
			rows: facts.absences.map((absence) => ({
				label: rangeLabel(absence.startDate, absence.endDate),
				value: absenceValue(absence),
			})),
		});
	}
	if (facts.holidays.length > 0) {
		const byRange = groupedByDate(
			facts.holidays,
			(holiday) => `${holiday.startDate}/${holiday.endDate}`,
		);
		sections.push({
			type: "key_value",
			title: { key: "approvals:approvals.periodSubmission.holidays", fallback: "Public holidays" },
			rows: [...byRange.values()].map((holidays) => ({
				label: rangeLabel(holidays[0]?.startDate ?? "", holidays[0]?.endDate ?? ""),
				value: holidays.map((holiday) => holiday.name).join("; "),
			})),
		});
	}
	if (facts.violations.length > 0) {
		const byDate = groupedByDate(facts.violations, (violation) => violation.date);
		sections.push({
			type: "key_value",
			title: {
				key: "approvals:approvals.periodSubmission.violations",
				fallback: "Compliance violations",
			},
			rows: [...byDate.entries()].map(([date, violations]) => ({
				label: dateLabel(date),
				value: {
					key: "approvals:approvals.periodSubmission.violationList",
					fallback: "{violations}",
					params: {
						violations: violations.map(
							(violation) => VIOLATION_TYPES[violation.type] ?? violation.type,
						),
					},
				},
				tone: "warning" as const,
			})),
		});
	}
	return sections;
}
