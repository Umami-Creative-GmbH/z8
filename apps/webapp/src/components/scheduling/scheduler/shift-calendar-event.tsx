"use client";

import { useTimeFormat } from "@/components/providers/user-preferences-provider";
import { formatTimeStringForPreference, type TimeFormat } from "@/lib/user-preferences/time-format";
import "./shift-calendar-event.css";
import { shiftColorName } from "./shift-calendars";

/**
 * The part of the event a shift's custom component reads. Schedule-X hands custom components the
 * external event (`_getExternalEvent`), not the internal one, so `_color` is not available.
 */
interface ShiftCalendarEventProps {
	calendarEvent: {
		title?: string;
		/** `published`, `draft` or `open`: one of `SHIFT_CALENDARS`, which selects the colours. */
		calendarId?: string;
		start?: CalendarEventEndpoint;
		end?: CalendarEventEndpoint;
	};
}

/** A `Temporal.ZonedDateTime` for timed events; a `Temporal.PlainDate` has none of these. */
interface CalendarEventEndpoint {
	hour?: number;
	minute?: number;
	epochMilliseconds?: number;
}

/**
 * Schedule-X stacks title and time only when an event is at least 36 px tall. On its default
 * 1600 px week grid an hour is about 67 px, and two lines of our text need 40 px (36 minutes), so
 * anything shorter than 45 minutes gets one line.
 */
const COMPACT_BELOW_MS = 45 * 60 * 1000;

function isShortEvent(event: ShiftCalendarEventProps["calendarEvent"]): boolean {
	const start = event.start?.epochMilliseconds;
	const end = event.end?.epochMilliseconds;
	return start !== undefined && end !== undefined && end - start < COMPACT_BELOW_MS;
}

/**
 * A wall time of the event as it was built: shift events are created in the organization's zone,
 * which is also the calendar's zone. Shown on the user's 12/24-hour clock.
 */
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

/** Schedule-X's own event colours, with the start border it omits where an event continues. */
function colorStyle(calendarId: string | undefined, { startBorder = true } = {}) {
	const colorName = shiftColorName(calendarId);
	return {
		backgroundColor: `var(--sx-color-${colorName}-container)`,
		color: `var(--sx-color-on-${colorName}-container)`,
		...(startBorder ? { borderInlineStart: `3px solid var(--sx-color-${colorName})` } : {}),
	};
}

/**
 * Schedule-X draws event times with its locale alone (`toLocaleTimeString`), so an English planner
 * on the 24-hour clock would read "2:00 PM". These components draw the times themselves.
 */
export function ShiftTimeGridEvent({ calendarEvent }: ShiftCalendarEventProps) {
	const timeFormat = useTimeFormat();
	const start = wallTime(calendarEvent.start, timeFormat);
	const end = wallTime(calendarEvent.end, timeFormat);
	if (isShortEvent(calendarEvent)) {
		return (
			<div
				className="flex h-full w-full min-w-0 flex-row items-center gap-1 rounded-sm px-1.5 text-xs"
				data-shift-event=""
				style={colorStyle(calendarEvent.calendarId)}
			>
				<span className="min-w-0 flex-1 truncate font-medium">{calendarEvent.title}</span>
				{start ? <span className="shrink-0 tabular-nums opacity-80">{start}</span> : null}
			</div>
		);
	}
	return (
		<div
			className="flex h-full w-full min-w-0 flex-col rounded-sm px-1.5 py-1 text-xs"
			data-shift-event=""
			style={colorStyle(calendarEvent.calendarId)}
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

/**
 * `hasStartDate` is false on the part of an event that continues from an earlier week, which
 * Schedule-X draws without the start border.
 */
export function ShiftMonthGridEvent({
	calendarEvent,
	hasStartDate = true,
}: ShiftCalendarEventProps & { hasStartDate?: boolean }) {
	const timeFormat = useTimeFormat();
	const start = wallTime(calendarEvent.start, timeFormat);
	return (
		<div
			className="flex h-full w-full min-w-0 items-center gap-1 self-stretch rounded-sm px-1 text-xs"
			data-shift-event=""
			style={colorStyle(calendarEvent.calendarId, { startBorder: hasStartDate })}
		>
			{start ? <span className="shrink-0 tabular-nums opacity-80">{start}</span> : null}
			<span className="truncate">{calendarEvent.title}</span>
		</div>
	);
}

/**
 * A shift crossing midnight is a multi-day timed event, which the week and day views draw in the
 * date-grid row above the hours rather than in the time grid. Where it runs past the visible days,
 * `shift-calendar-event.css` draws Schedule-X's continuation arrows, which it leaves out for custom
 * components.
 */
export function ShiftDateGridEvent({ calendarEvent }: ShiftCalendarEventProps) {
	const timeFormat = useTimeFormat();
	const start = wallTime(calendarEvent.start, timeFormat);
	return (
		<div
			className="relative flex h-full w-full min-w-0 items-center gap-1 self-stretch rounded-sm px-1 text-xs"
			data-shift-event=""
			style={colorStyle(calendarEvent.calendarId)}
		>
			<span className="truncate">{calendarEvent.title}</span>
			{start ? <span className="shrink-0 font-normal tabular-nums opacity-80">{start}</span> : null}
		</div>
	);
}
