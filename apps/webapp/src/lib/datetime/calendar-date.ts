import { Temporal } from "temporal-polyfill";
import type { PlainDate } from "./temporal-core";

/** Convert a Date emitted by a calendar control into its civil date. */
export function plainDateFromCalendarDate(value: Date): PlainDate {
	if (!Number.isFinite(value.getTime())) {
		throw new RangeError("Cannot convert an invalid Date to a calendar date");
	}

	return Temporal.PlainDate.from({
		year: value.getFullYear(),
		month: value.getMonth() + 1,
		day: value.getDate(),
	});
}
