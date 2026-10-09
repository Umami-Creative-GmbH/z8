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

type PolicyDayReminderType = "missed_clock_in_reminder" | "forgotten_clock_out_reminder";

/**
 * The reminders due now that the employee's work policy judges: a missed clock-in on an
 * employee-local day without a published shift, and a forgotten clock-out for live work that
 * matches no published shift. Policy facts are read only when needed: never for an occasion in
 * `recorded`, the keys already sent.
 */
export async function evaluatePolicyReminders(
	input: ReminderInput,
	policy: PolicyDayFacts,
	recorded: ReadonlySet<string> = new Set(),
): Promise<DueClockingReminder[]> {
	const due: DueClockingReminder[] = [];
	const missed = await missedClockIn(input, policy, recorded);
	if (missed) due.push(missed);
	const forgotten = await forgottenClockOut(input, policy, recorded);
	if (forgotten) due.push(forgotten);
	return due;
}

/**
 * The keys of the policy-day occasions the evaluator may judge now: today's missed clock-in and
 * the live work's forgotten clock-out. A run looks them up for a whole page of employees at once.
 */
export function policyDayOccasionKeys(input: ReminderInput): string[] {
	const keys: string[] = [];
	if (input.settings.missedClockIn.enabled) {
		keys.push(missedClockInOccasion(input).occasionKey);
	}
	const live = liveWork(input);
	if (input.settings.forgottenClockOut.enabled && live) {
		keys.push(forgottenClockOutOccasion(input, live).occasionKey);
	}
	return keys;
}

function policyDayOccasion(input: ReminderInput, type: PolicyDayReminderType, day: PlainDate) {
	return {
		day,
		occasionKey: clockingReminderOccasionKey(type, {
			kind: "policy_day",
			employeeId: input.employeeId,
			day,
		}),
	};
}

/** The missed clock-in is judged on the employee-local day of `now`. */
function missedClockInOccasion(input: ReminderInput) {
	return policyDayOccasion(
		input,
		"missed_clock_in_reminder",
		plainDateAt(input.now, input.timezone),
	);
}

/** Live work is judged against the local day it started on. */
function forgottenClockOutOccasion(input: ReminderInput, live: ReminderWork) {
	return policyDayOccasion(
		input,
		"forgotten_clock_out_reminder",
		plainDateAt(live.start, input.timezone),
	);
}

function liveWork(input: ReminderInput): ReminderWork | undefined {
	return input.work.find((work) => work.end === null);
}

/**
 * Live work is judged against the local day it started on, as the compliance check counts it:
 * the recorded minutes of completed work that started that day plus the elapsed live work. The
 * expected end is the moment that total reaches the day's required minutes.
 */
async function forgottenClockOut(
	input: ReminderInput,
	policy: PolicyDayFacts,
	recorded: ReadonlySet<string>,
): Promise<DueClockingReminder | null> {
	const { now, settings } = input;
	if (!settings.forgottenClockOut.enabled) return null;
	const live = liveWork(input);
	if (!live) return null;
	const { day, occasionKey } = forgottenClockOutOccasion(input, live);
	if (recorded.has(occasionKey)) return null;
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
	return {
		type: "forgotten_clock_out_reminder",
		occasionKey,
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
	recorded: ReadonlySet<string>,
): Promise<DueClockingReminder | null> {
	const { now, settings } = input;
	if (!settings.missedClockIn.enabled) return null;
	const { day, occasionKey } = missedClockInOccasion(input);
	if (recorded.has(occasionKey)) return null;
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
	return {
		type: "missed_clock_in_reminder",
		occasionKey,
		day,
		expectedAt,
		shift: null,
	};
}

/** A published shift dated on `day` hands the day's missed clock-in to the shift rules. */
function hasShiftOn(input: ReminderInput, day: PlainDate): boolean {
	return input.shifts.some((shift) => shift.date.equals(day));
}
