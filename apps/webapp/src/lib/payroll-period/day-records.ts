import { Temporal } from "temporal-polyfill";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { PayrollPeriodDayRecord } from "./types";

/** One stored work or break record, as the database part of the records loader reads it. */
export interface PayrollPeriodRecordSource {
	id: string;
	kind: PayrollPeriodDayRecord["kind"];
	approvalState: PayrollPeriodDayRecord["approvalState"];
	startAt: Instant;
	/** Null while the record is still running. */
	endAt: Instant | null;
	/** Stored minutes of the whole record. */
	durationMinutes: number | null;
	/** For breaks: whether the break is paid. */
	isPaid: boolean | null;
}

/** The records of a period's employee-days: employee ID, then local date, then its records. */
export type PayrollPeriodRecordsByDay = ReadonlyMap<
	string,
	ReadonlyMap<string, readonly PayrollPeriodDayRecord[]>
>;

/**
 * Puts one employee's work and break records on the local days of `startDate` to
 * `endDate` (inclusive) they touch in `timezone`, as the day side panel reads one day
 * (#1894): a record is on every local day its half-open interval overlaps, so a record
 * across local midnight is on both days. A running record touches the days up to `now`.
 * Each record keeps its whole local wall-clock start and end, `YYYY-MM-DDTHH:mm`, so a
 * day can tell a record that began the day before or ends the day after. Days without
 * records are absent; each day's records are sorted by start.
 *
 * Clocked breaks are stored as gaps between work records (a break closes the work and
 * resumes it as new work), so the breaks between a day's work are added as break
 * records (`gapBreaks`); stored break records stay as they are.
 */
export function attributeRecordsToLocalDays(
	records: readonly PayrollPeriodRecordSource[],
	options: { timezone: string; startDate: string; endDate: string; now: Instant },
): Map<string, PayrollPeriodDayRecord[]> {
	const { timezone } = options;
	const periodStart = Temporal.PlainDate.from(options.startDate);
	const periodEnd = Temporal.PlainDate.from(options.endDate);
	const localDate = (instant: Instant) => instant.toZonedDateTimeISO(timezone).toPlainDate();
	const localTime = (instant: Instant) =>
		instant.toZonedDateTimeISO(timezone).toPlainDateTime().toString({ smallestUnit: "minute" });

	const days = new Map<string, PayrollPeriodDayRecord[]>();
	const sorted = [...records, ...gapBreaks(records, timezone)].sort(
		(left, right) =>
			Temporal.Instant.compare(left.startAt, right.startAt) || left.id.localeCompare(right.id),
	);
	for (const record of sorted) {
		const lastInstant = lastTouchedInstant(record, options.now);
		const first = laterDate(localDate(record.startAt), periodStart);
		const last = earlierDate(localDate(lastInstant), periodEnd);
		if (Temporal.PlainDate.compare(first, last) > 0) continue;

		const dayRecord: PayrollPeriodDayRecord = {
			id: record.id,
			kind: record.kind,
			approvalState: record.approvalState,
			start: localTime(record.startAt),
			end: record.endAt ? localTime(record.endAt) : null,
			durationMinutes: record.endAt ? record.durationMinutes : null,
			isPaid: record.kind === "break" ? (record.isPaid ?? false) : null,
		};
		for (let day = first; Temporal.PlainDate.compare(day, last) <= 0; day = day.add({ days: 1 })) {
			const key = day.toString();
			const list = days.get(key);
			if (list) list.push(dayRecord);
			else days.set(key, [dayRecord]);
		}
	}
	return days;
}

/** Prefix of a break read from the gap between two work records; never a stored ID. */
export const GAP_BREAK_ID_PREFIX = "gap:";

const APPROVAL_RANK = { draft: 0, pending: 1, approved: 2 } as const;

/**
 * The breaks between an employee's work records, as the app's break rules count them
 * (compliance totals, breaks taken, the calendar): a gap of more than one whole minute
 * between consecutive work records starting on the same local day in `timezone`.
 * Overlapping work covers its gap, and nothing follows a running record. Two records
 * starting on different local days are separate work, not a break, so a gap never
 * crosses local midnight and is on its start day only. Minutes are elapsed time, so
 * they hold on daylight saving days.
 *
 * A gap a stored break record overlaps is left to that record, the only source of
 * `isPaid`; a gap is unpaid. It is approved only when both its records are, and
 * otherwise takes the less approved state of the two.
 */
export function gapBreaks(
	records: readonly PayrollPeriodRecordSource[],
	timezone: string,
): PayrollPeriodRecordSource[] {
	const storedBreaks = records.filter((record) => record.kind === "break");
	const workByDay = new Map<string, PayrollPeriodRecordSource[]>();
	for (const record of records) {
		if (record.kind !== "work") continue;
		const day = record.startAt.toZonedDateTimeISO(timezone).toPlainDate().toString();
		const list = workByDay.get(day);
		if (list) list.push(record);
		else workByDay.set(day, [record]);
	}

	const gaps: PayrollPeriodRecordSource[] = [];
	for (const work of workByDay.values()) {
		work.sort(
			(left, right) =>
				Temporal.Instant.compare(left.startAt, right.startAt) || left.id.localeCompare(right.id),
		);
		// The latest end so far and the record reaching it; null once a record runs.
		let reach: { end: Instant; record: PayrollPeriodRecordSource } | null = null;
		for (const record of work) {
			if (reach && Temporal.Instant.compare(record.startAt, reach.end) > 0) {
				const minutes = Math.floor(reach.end.until(record.startAt).total({ unit: "minutes" }));
				const start = reach.end;
				const end = record.startAt;
				const covered = storedBreaks.some(
					(stored) =>
						Temporal.Instant.compare(stored.startAt, end) < 0 &&
						(stored.endAt === null || Temporal.Instant.compare(stored.endAt, start) > 0),
				);
				if (minutes > 1 && !covered) {
					gaps.push({
						id: `${GAP_BREAK_ID_PREFIX}${reach.record.id}:${record.id}`,
						kind: "break",
						approvalState: lessApproved(reach.record.approvalState, record.approvalState),
						startAt: start,
						endAt: end,
						durationMinutes: minutes,
						isPaid: false,
					});
				}
			}
			if (record.endAt === null) break;
			if (!reach || Temporal.Instant.compare(record.endAt, reach.end) > 0) {
				reach = { end: record.endAt, record };
			}
		}
	}
	return gaps;
}

function lessApproved(
	left: PayrollPeriodRecordSource["approvalState"],
	right: PayrollPeriodRecordSource["approvalState"],
): PayrollPeriodRecordSource["approvalState"] {
	return APPROVAL_RANK[left] <= APPROVAL_RANK[right] ? left : right;
}

/**
 * The last instant a record covers: just before its end, as intervals are half-open (a
 * record ending at local midnight does not touch the next day), or `now` for a running
 * record. Never before its start, so a zero-length record stays on its start day.
 */
function lastTouchedInstant(record: PayrollPeriodRecordSource, now: Instant): Instant {
	const end = record.endAt ? record.endAt.subtract({ nanoseconds: 1 }) : now;
	return Temporal.Instant.compare(end, record.startAt) < 0 ? record.startAt : end;
}

function laterDate(left: PlainDate, right: PlainDate): PlainDate {
	return Temporal.PlainDate.compare(left, right) >= 0 ? left : right;
}

function earlierDate(left: PlainDate, right: PlainDate): PlainDate {
	return Temporal.PlainDate.compare(left, right) <= 0 ? left : right;
}
