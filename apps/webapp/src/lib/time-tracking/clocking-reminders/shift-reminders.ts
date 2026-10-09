import { compareInstants, type Instant, type PlainDate } from "@/lib/datetime/temporal-core";
import { shiftInterval, workMatchesShift } from "@/lib/scheduling/shift-occasion";
import { clockingReminderOccasionKey, type DueClockingReminder } from "./occasion";
import type { ClockingReminderSettings } from "./settings-policy";

/** A published shift assigned to the employee. */
export interface ReminderShift {
	id: string;
	/** The shift's calendar date, read from `shift.date` in the organization's timezone. */
	date: PlainDate;
	startTime: string;
	endTime: string;
}

export interface ReminderWork {
	start: Instant;
	/** `null` while the work is live. */
	end: Instant | null;
	/** The recorded minutes of completed work, which the compliance check counts. */
	durationMinutes: number | null;
}

export interface ShiftReminderInput {
	now: Instant;
	employeeId: string;
	/** The employee's effective timezone (their own, otherwise the organization's). */
	timezone: string;
	settings: ClockingReminderSettings;
	shifts: readonly ReminderShift[];
	/** The employee's recent and live work. */
	work: readonly ReminderWork[];
}

const notBefore = (left: Instant, right: Instant) => compareInstants(left, right) >= 0;

/**
 * The missed clock-in and forgotten clock-out reminders due now for an employee's published
 * shifts. Absence and holiday exemptions are applied by the caller.
 */
export function evaluateShiftReminders(input: ShiftReminderInput): DueClockingReminder[] {
	const { now, settings } = input;
	return input.shifts.flatMap((shift): DueClockingReminder[] => {
		const interval = shiftInterval(shift, input.timezone);
		const reminder = (type: DueClockingReminder["type"], expectedAt: Instant) => ({
			type,
			occasionKey: clockingReminderOccasionKey(type, {
				kind: "shift",
				shiftId: shift.id,
				employeeId: input.employeeId,
			}),
			day: shift.date,
			expectedAt,
			shift: { id: shift.id, ...interval },
		});
		const matching = input.work.filter((work) => workMatchesShift(interval, work));
		const due: DueClockingReminder[] = [];

		if (
			settings.missedClockIn.enabled &&
			notBefore(now, interval.start.add({ minutes: settings.missedClockIn.graceMinutes })) &&
			compareInstants(now, interval.end) < 0 &&
			matching.length === 0 &&
			!input.work.some((work) => coversInstant(work, interval.start))
		) {
			due.push(reminder("missed_clock_in_reminder", interval.start));
		}

		if (
			settings.forgottenClockOut.enabled &&
			notBefore(now, interval.end.add({ minutes: settings.forgottenClockOut.graceMinutes })) &&
			matching.some((work) => work.end === null)
		) {
			due.push(reminder("forgotten_clock_out_reminder", interval.end));
		}
		return due;
	});
}

/** Work that had started by `instant` and had not ended at it: the employee was clocked in. */
function coversInstant(work: ReminderWork, instant: Instant): boolean {
	return (
		compareInstants(work.start, instant) <= 0 &&
		(work.end === null || compareInstants(work.end, instant) > 0)
	);
}
