/**
 * The Schedule-X calendars of the planner and the employee schedule, by shift status. Each
 * calendar's `colorName` names the `--sx-color-<name>-…` variables Schedule-X defines for it, which
 * the shift event components read (see `shiftColorName`).
 */
export const SHIFT_CALENDARS = {
	published: {
		colorName: "published",
		lightColors: { main: "#3b82f6", container: "#dbeafe", onContainer: "#1e40af" },
		darkColors: { main: "#60a5fa", container: "#1e3a8a", onContainer: "#bfdbfe" },
	},
	draft: {
		colorName: "draft",
		lightColors: { main: "#9ca3af", container: "#f3f4f6", onContainer: "#374151" },
		darkColors: { main: "#6b7280", container: "#374151", onContainer: "#d1d5db" },
	},
	open: {
		colorName: "open",
		lightColors: { main: "#f59e0b", container: "#fef3c7", onContainer: "#92400e" },
		darkColors: { main: "#fbbf24", container: "#78350f", onContainer: "#fde68a" },
	},
} as const;

export type ShiftCalendarId = keyof typeof SHIFT_CALENDARS;

/**
 * The colour name of an event's calendar. Events outside the shift calendars take Schedule-X's
 * own default, `primary`, as Schedule-X does for an event without a calendar.
 */
export function shiftColorName(calendarId: string | undefined): string {
	return calendarId !== undefined && Object.hasOwn(SHIFT_CALENDARS, calendarId)
		? SHIFT_CALENDARS[calendarId as ShiftCalendarId].colorName
		: "primary";
}
