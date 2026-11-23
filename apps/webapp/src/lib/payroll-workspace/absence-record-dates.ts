import { Temporal } from "temporal-polyfill";
import type { PayrollDayPeriod } from "./types";

/** A canonical absence record as stored: `time_record` instants and its absence periods. */
export interface StoredAbsenceRecord {
	startAt: Date;
	endAt: Date | null;
	startPeriod: PayrollDayPeriod;
	endPeriod: PayrollDayPeriod;
}

export interface AbsenceRecordDates {
	/** Inclusive logical (employee-local) dates. */
	startDate: string;
	endDate: string;
	/** Wall-clock times of a timed partial absence, HH:mm:ss; absent otherwise. */
	startTime?: string;
	endTime?: string;
}

const MIDNIGHT = new Temporal.PlainTime();
const NOON = new Temporal.PlainTime(12);
const LAST_MORNING_MILLISECOND = new Temporal.PlainTime(11, 59, 59, 999);

/**
 * The logical dates of a canonical absence record.
 *
 * Absence instants encode the employee's local wall clock as if it were UTC, so the
 * dates are read in UTC, never in a real zone. Two end encodings exist: absence requests
 * end a day inclusively at 23:59:59.999 (`mapAbsenceDurationToCanonicalTimestamps`),
 * while the canonical backfill of legacy absence entries (`runCanonicalBackfill`, which
 * covers demo data and imported absences) ends it exclusively at the next midnight. An
 * end exactly at midnight is therefore exclusive and belongs to the day before.
 *
 * A timed partial absence (both periods `am`, as requests store it) keeps its wall-clock
 * times and its end date as stored: an overnight one ending at midnight is read on its
 * start day by the absence layout. A legacy morning half day (00:00 to noon) is no timed
 * partial and carries no times.
 */
export function absenceRecordDates(record: StoredAbsenceRecord): AbsenceRecordDates {
	const start = wallClock(record.startAt);
	const end = wallClock(record.endAt ?? record.startAt);
	const timed = isTimedPartial(record, start, end);
	const exclusiveMidnightEnd =
		!timed &&
		Temporal.PlainDateTime.compare(end, start) > 0 &&
		Temporal.PlainTime.compare(end.toPlainTime(), MIDNIGHT) === 0;
	const endDate = exclusiveMidnightEnd
		? end.toPlainDate().subtract({ days: 1 })
		: end.toPlainDate();

	return {
		startDate: start.toPlainDate().toString(),
		endDate: endDate.toString(),
		...(timed
			? {
					startTime: start.toPlainTime().toString({ smallestUnit: "second" }),
					endTime: end.toPlainTime().toString({ smallestUnit: "second" }),
				}
			: {}),
	};
}

function wallClock(value: Date): Temporal.PlainDateTime {
	return Temporal.Instant.fromEpochMilliseconds(value.getTime())
		.toZonedDateTimeISO("UTC")
		.toPlainDateTime();
}

function isTimedPartial(
	record: Pick<StoredAbsenceRecord, "startPeriod" | "endPeriod">,
	start: Temporal.PlainDateTime,
	end: Temporal.PlainDateTime,
): boolean {
	if (record.startPeriod !== "am" || record.endPeriod !== "am") return false;
	const legacyMorningHalf =
		Temporal.PlainTime.compare(start.toPlainTime(), MIDNIGHT) === 0 &&
		(Temporal.PlainTime.compare(end.toPlainTime(), NOON) === 0 ||
			Temporal.PlainTime.compare(end.toPlainTime(), LAST_MORNING_MILLISECOND) === 0);
	return !legacyMorningHalf;
}
