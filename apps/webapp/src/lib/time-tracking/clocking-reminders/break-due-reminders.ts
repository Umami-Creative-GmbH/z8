import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import {
	type BreakDueRegulation,
	type BreakDueRule,
	breakDueStatus,
} from "@/lib/time-tracking/break-due";
import { clockingReminderOccasionKey, type DueClockingReminder } from "./occasion";
import type { ClockingReminderSettings } from "./settings-policy";

export interface BreakDueReminderInput {
	now: Instant;
	/** The employee's effective timezone (their own, otherwise the organization's). */
	timezone: string;
	settings: ClockingReminderSettings;
	liveWork: { id: string; start: Instant };
	/** The effective work policy's regulation now; `null` without a regulated policy. */
	regulation: BreakDueRegulation | null;
	/** Completed work on the live work's local start day, the live work left out. */
	completedMinutes: number;
	/** Breaks taken on that day so far. */
	breakMinutes: number;
}

function ruleKey(rule: BreakDueRule): string {
	return rule.kind === "max_uninterrupted"
		? "max_uninterrupted"
		: `break_rule:${rule.workingMinutesThreshold}`;
}

/**
 * The break-due reminder due now for live work: the next rule it would break without a break,
 * once the lead minutes before that moment have begun. Each (live work, rule) is one occasion.
 * Absences and holidays never exempt it.
 */
export function evaluateBreakDueReminders(input: BreakDueReminderInput): DueClockingReminder[] {
	const { now, settings } = input;
	if (!settings.breakDue.enabled) return [];
	const next = breakDueStatus({
		regulation: input.regulation,
		completedMinutes: input.completedMinutes,
		breakMinutes: input.breakMinutes,
		liveStart: input.liveWork.start,
		now,
	}).breaches.find((breach) => compareInstants(breach.at, now) > 0);
	if (!next) return [];
	if (compareInstants(now, next.at.subtract({ minutes: settings.breakDue.leadMinutes })) < 0) {
		return [];
	}
	return [
		{
			type: "break_due_reminder",
			occasionKey: clockingReminderOccasionKey("break_due_reminder", {
				kind: "live_work",
				workPeriodId: input.liveWork.id,
				rule: ruleKey(next.rule),
			}),
			day: input.liveWork.start.toZonedDateTimeISO(input.timezone).toPlainDate().toString(),
			expectedAt: next.at,
			shift: null,
		},
	];
}
