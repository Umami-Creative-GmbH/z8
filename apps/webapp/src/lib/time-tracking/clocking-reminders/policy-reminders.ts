import {
	compareInstants,
	type Instant,
	type PlainDate,
	type PlainTime,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { shiftInterval, workMatchesShift } from "@/lib/scheduling/shift-occasion";
import { clockingReminderOccasionKey, type DueClockingReminder } from "./occasion";
import type { ReminderWork, ShiftReminderInput } from "./shift-reminders";

/** What the evaluator needs to know about the employee's work policy on a local day. */
export interface PolicyDayFacts {
	/** The effective policy's latest clock-in for the day's weekday, if any. */
	latestClockIn(day: PlainDate): Promise<PlainTime | null>;
	/** The day's required minutes, after absences, holidays and employment; 0 when none. */
	requiredMinutes(day: PlainDate): Promise<number>;
}

export type PolicyReminderInput = ShiftReminderInput;

const notBefore = (left: Instant, right: Instant) => compareInstants(left, right) >= 0;

/**
 * The missed clock-in and forgotten clock-out reminders due now on employee-local days without a
 * published shift, judged by the employee's work policy. Policy facts are read only when needed.
 */
export async function evaluatePolicyReminders(
	input: PolicyReminderInput,
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
 * Live work is judged against the local day it started on, like the compliance check: completed
 * work that started that day plus the elapsed live work. The expected end is the moment that
 * total reaches the day's required minutes.
 */
async function forgottenClockOut(
	input: PolicyReminderInput,
	policy: PolicyDayFacts,
): Promise<DueClockingReminder | null> {
	const { now, settings } = input;
	if (!settings.forgottenClockOut.enabled) return null;
	const live = input.work.find((work) => work.end === null);
	if (!live) return null;
	const day = plainDateAt(live.start, input.timezone);
	if (hasShiftOn(input, day) || matchesAnyShift(input, live)) return null;
	const completedMs = input.work.reduce(
		(total, work) =>
			work.end !== null && plainDateAt(work.start, input.timezone).equals(day)
				? total + (work.end.epochMilliseconds - work.start.epochMilliseconds)
				: total,
		0,
	);
	const workedMs = completedMs + (now.epochMilliseconds - live.start.epochMilliseconds);
	const graceMs = settings.forgottenClockOut.graceMinutes * MINUTE_MS;
	// Nothing can be due before the grace alone has been worked; skip reading the requirements.
	if (workedMs < graceMs) return null;
	const requiredMinutes = await policy.requiredMinutes(day);
	if (requiredMinutes <= 0) return null;
	const requiredMs = requiredMinutes * MINUTE_MS;
	if (workedMs < requiredMs + graceMs) return null;
	const type = "forgotten_clock_out_reminder";
	return {
		type,
		occasionKey: clockingReminderOccasionKey(type, {
			kind: "policy_day",
			employeeId: input.employeeId,
			day,
		}),
		day,
		expectedAt: live.start.add({ milliseconds: Math.max(0, requiredMs - completedMs) }),
		shift: null,
	};
}

const MINUTE_MS = 60_000;

function matchesAnyShift(input: PolicyReminderInput, work: ReminderWork): boolean {
	return input.shifts.some((shift) => workMatchesShift(shiftInterval(shift, input.timezone), work));
}

async function missedClockIn(
	input: PolicyReminderInput,
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

/** A published shift dated on `day` hands the whole day to the shift rules. */
function hasShiftOn(input: PolicyReminderInput, day: PlainDate): boolean {
	return input.shifts.some((shift) => shift.date.equals(day));
}

function coversInstant(work: ReminderWork, instant: Instant): boolean {
	return (
		compareInstants(work.start, instant) <= 0 &&
		(work.end === null || compareInstants(work.end, instant) > 0)
	);
}
