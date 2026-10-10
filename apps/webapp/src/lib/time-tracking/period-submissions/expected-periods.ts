import { comparePlainDates, type PlainDate } from "@/lib/datetime/temporal-core";
import {
	type EmploymentInterval,
	isDateKeyEmployed,
} from "@/lib/employee-lifecycle/employment-coverage";
import {
	type ActiveSubmissionCadence,
	type SubmissionCadenceChange,
	scheduledSubmissionPeriods,
} from "./cadence";

export type AbsenceDayPart = "full_day" | "am" | "pm";

/** An approved absence on which no work is expected, by local calendar dates (both inclusive). */
export interface ApprovedAbsenceSpan {
	startDate: PlainDate;
	startPeriod: AbsenceDayPart;
	endDate: PlainDate;
	endPeriod: AbsenceDayPart;
}

/** Everything the derivation needs about one employee, already scoped to their organization. */
export interface ExpectedSubmissionPeriodFacts {
	/** The organization's saved cadence settings, in any order. */
	cadenceHistory: readonly SubmissionCadenceChange[];
	/** The employee's timezone, which periods not yet submitted use. */
	timezone: string;
	/**
	 * Employment intervals, half-open [startedAt, endedAt). A null start is unknown and does not
	 * narrow; an `endedAt` is the cutoff of a departure, effective or scheduled.
	 */
	employment: readonly EmploymentInterval[];
	/** Kiosk-only employees are never covered by period submissions. */
	kioskOnly: boolean;
	approvedAbsences: readonly ApprovedAbsenceSpan[];
	/** Public holidays assigned to the employee, as `YYYY-MM-DD`. */
	publicHolidays: ReadonlySet<string>;
	/** Days on which the employee's schedule expects no work, as `YYYY-MM-DD`. */
	nonWorkingDays: ReadonlySet<string>;
}

/** A submission period the employee is expected to submit. */
export interface ExpectedSubmissionPeriod {
	cadence: ActiveSubmissionCadence;
	/** The timezone the local dates are in. */
	timezone: string;
	/** The first and last day (inclusive) of the period, clipped to employment and the cadence. */
	startDate: PlainDate;
	endDate: PlainDate;
	/** The whole week or month, which identifies the period across employees. */
	cadenceStartDate: PlainDate;
	cadenceEndDate: PlainDate;
}

type DayHalves = { am: boolean; pm: boolean };

function absenceHalvesOn(absence: ApprovedAbsenceSpan, day: PlainDate): DayHalves {
	if (
		comparePlainDates(day, absence.startDate) < 0 ||
		comparePlainDates(day, absence.endDate) > 0
	) {
		return { am: false, pm: false };
	}
	const isStart = day.equals(absence.startDate);
	const isEnd = day.equals(absence.endDate);
	if (isStart && isEnd) {
		if (absence.startPeriod === "full_day" || absence.endPeriod === "full_day") {
			return { am: true, pm: true };
		}
		return { am: absence.startPeriod === "am", pm: absence.endPeriod === "pm" };
	}
	if (isStart) return { am: absence.startPeriod !== "pm", pm: true };
	if (isEnd) return { am: true, pm: absence.endPeriod !== "am" };
	return { am: true, pm: true };
}

function isWholeDayAbsent(absences: readonly ApprovedAbsenceSpan[], day: PlainDate): boolean {
	let am = false;
	let pm = false;
	for (const absence of absences) {
		const halves = absenceHalvesOn(absence, day);
		am ||= halves.am;
		pm ||= halves.pm;
		if (am && pm) return true;
	}
	return false;
}

function eachDay(startDate: PlainDate, endDate: PlainDate): PlainDate[] {
	const days: PlainDate[] = [];
	for (let day = startDate; comparePlainDates(day, endDate) <= 0; day = day.add({ days: 1 })) {
		days.push(day);
	}
	return days;
}

/**
 * The submission periods `facts` expects the employee to submit that overlap `window` (local
 * dates in the employee's timezone, both inclusive), in order. Pure: every fact is passed in.
 *
 * - A period is the week or calendar month of the cadence in effect, in the employee's timezone,
 *   clipped to their employment.
 * - A period entirely covered by approved absences, public holidays and non-working days is not
 *   expected.
 * - The period in which employment ends (a departing employee's final period) is not expected.
 * - Kiosk-only employees are expected to submit nothing.
 */
export function deriveExpectedSubmissionPeriods(
	facts: ExpectedSubmissionPeriodFacts,
	window: { from: PlainDate; to: PlainDate },
): ExpectedSubmissionPeriod[] {
	if (facts.kioskOnly) return [];
	const employed = (day: PlainDate) =>
		isDateKeyEmployed(facts.employment, day.toString(), facts.timezone);
	const coveredOff = (day: PlainDate) => {
		const key = day.toString();
		return (
			!employed(day) ||
			facts.publicHolidays.has(key) ||
			facts.nonWorkingDays.has(key) ||
			isWholeDayAbsent(facts.approvedAbsences, day)
		);
	};

	const expected: ExpectedSubmissionPeriod[] = [];
	for (const period of scheduledSubmissionPeriods(facts.cadenceHistory, facts.timezone, window)) {
		const employedDays = eachDay(period.startDate, period.endDate).filter(employed);
		const first = employedDays.at(0);
		const last = employedDays.at(-1);
		if (!first || !last) continue;
		if (!employed(last.add({ days: 1 }))) continue;
		const days = eachDay(first, last);
		if (days.every(coveredOff)) continue;
		expected.push({
			cadence: period.cadence,
			timezone: facts.timezone,
			startDate: first,
			endDate: last,
			cadenceStartDate: period.cadenceStartDate,
			cadenceEndDate: period.cadenceEndDate,
		});
	}
	return expected;
}
