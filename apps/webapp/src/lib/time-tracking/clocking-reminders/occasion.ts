import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { NotificationType } from "@/lib/notifications/types";

export type ClockingReminderType = Extract<
	NotificationType,
	| "missed_clock_in_reminder"
	| "forgotten_clock_out_reminder"
	| "break_due_reminder"
	| "period_submission_reminder"
>;

/**
 * Which reminder of an unsubmitted submission period (#1064): the first when the period ends, the
 * second after the organization's delay.
 */
export type SubmissionPeriodReminderStage = "period_end" | "after_delay";

/** The break rule of a live work that a break-due reminder warns about. */
export type BreakRuleOccasion =
	| { kind: "max_uninterrupted" }
	/** A threshold rule, identified by its threshold so reordering the rules keeps the key. */
	| { kind: "break_rule"; workingMinutesThreshold: number };

/**
 * What one reminder is about. At most one reminder is ever sent per type and source, across all
 * channels. New sources (a work-policy day, a live work's break rule) are added as new kinds.
 */
export type ClockingReminderOccasionSource =
	| { kind: "shift"; shiftId: string; employeeId: string }
	/** An employee-local day without a shift, judged by the effective work policy (#830). */
	| { kind: "policy_day"; employeeId: string; day: PlainDate }
	| {
			/** One break rule of one live work; resumed work after a break is a new live work. */
			kind: "live_work";
			workPeriodId: string;
			rule: BreakRuleOccasion;
	  }
	| {
			/**
			 * One reminder stage of one employee's submission period, named by the period's last
			 * local day: an employee has at most one period ending on a day, and employment never
			 * clips the end of an expected period.
			 */
			kind: "submission_period";
			employeeId: string;
			endDate: PlainDate;
			stage: SubmissionPeriodReminderStage;
	  };

/** The organization-unique key that dedupes one reminder occasion. */
export function clockingReminderOccasionKey(
	type: ClockingReminderType,
	source: ClockingReminderOccasionSource,
): string {
	switch (source.kind) {
		case "shift":
			return `${type}:shift:${source.shiftId}:${source.employeeId}`;
		case "policy_day":
			return `${type}:policy_day:${source.employeeId}:${source.day.toString()}`;
		case "live_work":
			return `${type}:live_work:${source.workPeriodId}:${breakRuleKey(source.rule)}`;
		case "submission_period":
			return `${type}:submission_period:${source.employeeId}:${source.endDate.toString()}:${source.stage}`;
	}
}

function breakRuleKey(rule: BreakRuleOccasion): string {
	return rule.kind === "max_uninterrupted"
		? "max_uninterrupted"
		: `break_rule:${rule.workingMinutesThreshold}`;
}

/** A reminder the evaluator found due now. */
export interface DueClockingReminder {
	type: ClockingReminderType;
	occasionKey: string;
	/** The employee-local calendar day the occasion belongs to. */
	day: PlainDate;
	/**
	 * The expected start (missed clock-in), the expected end (forgotten clock-out), or when the
	 * break is due (break due).
	 */
	expectedAt: Instant;
	shift: { id: string; start: Instant; end: Instant } | null;
	/** The unsubmitted period a period submission reminder is about. */
	submissionPeriod?: {
		startDate: PlainDate;
		endDate: PlainDate;
		stage: SubmissionPeriodReminderStage;
	};
}

/** Approved absences and public holidays exempt only the missed clock-in reminder. */
export function isExemptOnAbsenceOrHoliday(type: ClockingReminderType): boolean {
	return type === "missed_clock_in_reminder";
}
