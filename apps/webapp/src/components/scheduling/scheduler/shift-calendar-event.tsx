"use client";

import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { formatTimeStringForPreference, type TimeFormat } from "@/lib/user-preferences/time-format";

/** The part of Schedule-X's internal event a shift's custom component reads. */
interface ShiftCalendarEventProps {
	calendarEvent: {
		title?: string;
		/** The calendar's color name, which Schedule-X copies onto every event. */
		_color?: string;
		start?: { hour?: number; minute?: number };
		end?: { hour?: number; minute?: number };
	};
}

/** A wall time in the calendar's zone (the organization's), on the user's 12/24-hour clock. */
function wallTime(
	endpoint: ShiftCalendarEventProps["calendarEvent"]["start"],
	timeFormat: TimeFormat,
): string | null {
	if (endpoint?.hour === undefined || endpoint.minute === undefined) return null;
	return formatTimeStringForPreference(
		`${String(endpoint.hour).padStart(2, "0")}:${String(endpoint.minute).padStart(2, "0")}`,
		timeFormat,
	);
}

function colorStyle(colorName: string | undefined) {
	return colorName
		? {
				backgroundColor: `var(--sx-color-${colorName}-container)`,
				color: `var(--sx-color-on-${colorName}-container)`,
				borderInlineStart: `3px solid var(--sx-color-${colorName})`,
			}
		: undefined;
}

/**
 * Schedule-X draws event times with its locale alone (`toLocaleTimeString`), so an English planner
 * on the 24-hour clock would read "2:00 PM". These components draw the times themselves.
 */
function ShiftTimeGridEvent({ calendarEvent }: ShiftCalendarEventProps) {
	const timeFormat = useTimeFormat();
	const start = wallTime(calendarEvent.start, timeFormat);
	const end = wallTime(calendarEvent.end, timeFormat);
	return (
		<div
			className="flex h-full w-full min-w-0 flex-col rounded-sm px-1.5 py-1 text-xs"
			style={colorStyle(calendarEvent._color)}
		>
			<span className="block truncate font-medium">{calendarEvent.title}</span>
			{start ? (
				<span className="block truncate tabular-nums opacity-80">
					{end ? `${start} – ${end}` : start}
				</span>
			) : null}
		</div>
	);
}

function ShiftMonthGridEvent({ calendarEvent }: ShiftCalendarEventProps) {
	const timeFormat = useTimeFormat();
	const start = wallTime(calendarEvent.start, timeFormat);
	return (
		<div
			className="flex w-full min-w-0 items-baseline gap-1 rounded-sm px-1 text-xs"
			style={colorStyle(calendarEvent._color)}
		>
			{start ? <span className="shrink-0 tabular-nums opacity-80">{start}</span> : null}
			<span className="truncate">{calendarEvent.title}</span>
		</div>
	);
}

export const shiftCalendarEventComponents = {
	timeGridEvent: ShiftTimeGridEvent,
	monthGridEvent: ShiftMonthGridEvent,
};
