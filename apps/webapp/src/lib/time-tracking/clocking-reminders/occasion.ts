import type { Instant } from "@/lib/datetime/temporal-core";

export type ClockingReminderType =
	| "missed_clock_in_reminder"
	| "forgotten_clock_out_reminder"
	| "break_due_reminder";

/**
 * What one reminder is about. At most one reminder is ever sent per type and source, across all
 * channels. New sources (a work-policy day, a live work's break rule) are added as new kinds.
 */
export type ClockingReminderOccasionSource =
	| {
			kind: "shift";
			shiftId: string;
			employeeId: string;
	  }
	| {
			/** One break rule of one live work; resumed work after a break is a new live work. */
			kind: "live_work";
			workPeriodId: string;
			/** `max_uninterrupted` or `break_rule:<threshold minutes>`. */
			rule: string;
	  };

/** The organization-unique key that dedupes one reminder occasion. */
export function clockingReminderOccasionKey(
	type: ClockingReminderType,
	source: ClockingReminderOccasionSource,
): string {
	switch (source.kind) {
		case "shift":
			return `${type}:shift:${source.shiftId}:${source.employeeId}`;
		case "live_work":
			return `${type}:live_work:${source.workPeriodId}:${source.rule}`;
	}
}

/** A reminder the evaluator found due now. */
export interface DueClockingReminder {
	type: ClockingReminderType;
	occasionKey: string;
	/** The employee-local calendar day the occasion belongs to, `YYYY-MM-DD`. */
	day: string;
	/**
	 * The expected start (missed clock-in), the expected end (forgotten clock-out), or when the
	 * break is due (break due).
	 */
	expectedAt: Instant;
	shift: { id: string; start: Instant; end: Instant } | null;
}

/** Approved absences and public holidays exempt only the missed clock-in reminder. */
export function isExemptOnAbsenceOrHoliday(type: ClockingReminderType): boolean {
	return type === "missed_clock_in_reminder";
}
