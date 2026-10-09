import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { type PlainDate, type PlainTime, plainDateAt } from "@/lib/datetime/temporal-core";
import { shiftInterval, workMatchesShift } from "@/lib/scheduling/shift-occasion";
import { complianceDayTotalsOf } from "@/lib/time-tracking/compliance-totals";
import { clockingReminderOccasionKey, type DueClockingReminder } from "./occasion";
import { coversInstant, notBefore, type ReminderInput, type ReminderWork } from "./shift-reminders";

/** What the evaluator needs to know about the employee's work policy on a local day. */
export interface PolicyDayFacts {
	/** The effective policy's latest clock-in for the day's weekday, if any. */
	latestClockIn(day: PlainDate): Promise<PlainTime | null>;
	/** The day's required minutes, after absences, holidays and employment; 0 when none. */
	requiredMinutes(day: PlainDate): Promise<number>;
}

/**
 * The reminders due now that the employee's work policy judges: a missed clock-in on an
 * employee-local day without a published shift, and a forgotten clock-out for live work that
 * matches no published shift. Policy facts are read only when needed.
 */
export async function evaluatePolicyReminders(
	input: ReminderInput,
	policy: PolicyDayFacts,
): Promise<DueClockingReminder[]> {
	const due: DueClockingReminder[] = [];
	const missed = await missedClockIn(input, policy);
	if (missed) due.push(missed);
	const forgotten = await forgottenClockOut(input, policy);
	if (forgotten) due.push(forgotten);
	return due;
}

/**
 * Live work is judged against the local day it started on, as the compliance check counts it:
 * the recorded minutes of completed work that started that day plus the elapsed live work. The
 * expected end is the moment that total reaches the day's required minutes.
 */
async function forgottenClockOut(
	input: ReminderInput,
	policy: PolicyDayFacts,
): Promise<DueClockingReminder | null> {
	const { now, settings } = input;
	if (!settings.forgottenClockOut.enabled) return null;
	const live = input.work.find((work) => work.end === null);
	if (!live) return null;
	const day = plainDateAt(live.start, input.timezone);
	// Live work that matches a published shift owes the shift's forgotten clock-out instead.
	if (matchesAnyShift(input, live)) return null;
	const { dailyMinutes: completedMinutes } = complianceDayTotalsOf(
		input.work.filter((work) => work.end !== null),
		localDayRange(day.toString(), input.timezone),
	);
	const workedMinutes = completedMinutes + live.start.until(now).total({ unit: "minutes" });
	const { graceMinutes } = settings.forgottenClockOut;
	// Nothing can be due before the grace alone has been worked; skip reading the requirements.
	if (workedMinutes < graceMinutes) return null;
	const requiredMinutes = await policy.requiredMinutes(day);
	if (requiredMinutes <= 0) return null;
	if (workedMinutes < requiredMinutes + graceMinutes) return null;
	const type = "forgotten_clock_out_reminder";
	return {
		type,
		occasionKey: clockingReminderOccasionKey(type, {
			kind: "policy_day",
			employeeId: input.employeeId,
			day,
		}),
		day,
		expectedAt: live.start.add({ minutes: Math.max(0, requiredMinutes - completedMinutes) }),
		shift: null,
	};
}

function matchesAnyShift(input: ReminderInput, work: ReminderWork): boolean {
	return input.shifts.some((shift) => workMatchesShift(shiftInterval(shift, input.timezone), work));
}

async function missedClockIn(
	input: ReminderInput,
	policy: PolicyDayFacts,
): Promise<DueClockingReminder | null> {
	const { now, settings } = input;
	if (!settings.missedClockIn.enabled) return null;
	const day = plainDateAt(now, input.timezone);
	if (hasShiftOn(input, day)) return null;
	if (input.work.some((work) => plainDateAt(work.start, input.timezone).equals(day))) return null;
	const latestClockIn = await policy.latestClockIn(day);
	if (!latestClockIn) return null;
	// A latest clock-in inside a DST gap moves forward, like a shift start.
	const expectedAt = day
		.toZonedDateTime({ timeZone: input.timezone, plainTime: latestClockIn })
		.toInstant();
	if (!notBefore(now, expectedAt.add({ minutes: settings.missedClockIn.graceMinutes }))) {
		return null;
	}
	// Work carried over from the previous day still covers the expected start.
	if (input.work.some((work) => coversInstant(work, expectedAt))) return null;
	if ((await policy.requiredMinutes(day)) <= 0) return null;
	const type = "missed_clock_in_reminder";
	return {
		type,
		occasionKey: clockingReminderOccasionKey(type, {
			kind: "policy_day",
			employeeId: input.employeeId,
			day,
		}),
		day,
		expectedAt,
		shift: null,
	};
}

/** A published shift dated on `day` hands the day's missed clock-in to the shift rules. */
function hasShiftOn(input: ReminderInput, day: PlainDate): boolean {
	return input.shifts.some((shift) => shift.date.equals(day));
}
