/**
 * Work records' own invariants, which Clocking's completed-work receipts share:
 * the error a write that misses its locked row throws, and the date the work
 * balance refreshes from. Here, not in Clocking policy, so work records needs
 * nothing from `close-active-work` (which imports work records). No I/O, no
 * server-only imports.
 */
import { comparePlainDates, type Instant } from "@/lib/datetime/temporal-core";

/** A defect, never a refusal: the rows changed under their lock, or a write disagrees. */
export class CompletedWorkIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CompletedWorkIntegrityError";
	}
}

/** The earlier of the UTC and captured-offset local date of an instant. */
export function earliestStartDate(start: Instant, utcOffsetMinutes: number): string {
	const utcDate = start.toZonedDateTimeISO("UTC").toPlainDate();
	const localDate = start.toZonedDateTimeISO(fixedOffsetZone(utcOffsetMinutes)).toPlainDate();
	return (comparePlainDates(localDate, utcDate) < 0 ? localDate : utcDate).toString();
}

/** The captured event offset as an explicit fixed-offset zone, e.g. `-05:30`. */
function fixedOffsetZone(utcOffsetMinutes: number): string {
	const sign = utcOffsetMinutes < 0 ? "-" : "+";
	const minutes = Math.abs(utcOffsetMinutes);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}
