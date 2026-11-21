/** One month of a run of consecutive calendar dates, as the header's month row spans it. */
export interface PayrollMonthSegment {
	/** `YYYY-MM`. */
	month: string;
	/** The segment's first date, to format the month label from. */
	firstDate: string;
	/** Index of the segment's first date in the dates. */
	start: number;
	/** How many dates (day columns) the segment spans. */
	length: number;
}

/** The dates split into their months, in order. */
export function payrollMonthSegments(dates: readonly string[]): PayrollMonthSegment[] {
	const segments: PayrollMonthSegment[] = [];
	dates.forEach((date, index) => {
		const month = date.slice(0, 7);
		const current = segments.at(-1);
		if (current?.month === month) {
			current.length += 1;
			return;
		}
		segments.push({ month, firstDate: date, start: index, length: 1 });
	});
	return segments;
}

/** Whether the date at `index` opens a month after the first one shown. */
export function startsNewMonth(dates: readonly string[], index: number): boolean {
	return index > 0 && dates[index]?.slice(0, 7) !== dates[index - 1]?.slice(0, 7);
}
