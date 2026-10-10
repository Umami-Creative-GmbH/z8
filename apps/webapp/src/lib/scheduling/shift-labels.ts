/** Wall times only: a shift ending at or before its start ends on the next day. */
export function shiftEndsNextDay(shift: { startTime: string; endTime: string }): boolean {
	return shift.endTime <= shift.startTime;
}

/** Where a shift takes place, "Location · Subarea", or what is known of it. */
export function shiftPlaceLabel(
	locationName: string | null | undefined,
	subareaName: string | null | undefined,
): string {
	return [locationName, subareaName].filter(Boolean).join(" · ");
}
