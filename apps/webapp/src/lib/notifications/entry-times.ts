/** A `time_entry` time: its instant and the UTC offset stored on that entry. */
export interface EntryTime {
	at: Date;
	utcOffsetMinutes: number;
}

/** The clock-in and clock-out of a work period, each at its own entry's offset. */
export interface WorkPeriodEntryTimes {
	clockIn: EntryTime;
	clockOut: EntryTime | null;
}

/** What a stored `time_entry` row gives an entry time. */
export interface TimeEntryInstant {
	timestamp: Date;
	utcOffsetMinutes: number;
}

/** A work period's endpoints as entry times, each at the offset stored on its own entry. */
export function workPeriodEntryTimesOf(
	clockIn: TimeEntryInstant,
	clockOut: TimeEntryInstant | null | undefined,
): WorkPeriodEntryTimes {
	const entryTime = (entry: TimeEntryInstant): EntryTime => ({
		at: entry.timestamp,
		utcOffsetMinutes: entry.utcOffsetMinutes,
	});
	return { clockIn: entryTime(clockIn), clockOut: clockOut ? entryTime(clockOut) : null };
}
