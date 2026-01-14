// Use global Temporal (polyfilled via temporal-polyfill/global in schedule-x-wrapper.tsx)
// Do NOT import from temporal-polyfill directly - Schedule-X requires the global instance
import type { CalendarEvent, CalendarEventType } from "./types";

// Type declaration for global Temporal (provided by temporal-polyfill/global)
declare const Temporal: typeof import("temporal-polyfill").Temporal;

/**
 * Schedule-X event format for v3
 * Uses Temporal API types directly
 * @see https://schedule-x.dev/docs/calendar/events
 */
export interface ScheduleXEvent {
	id: string;
	title: string;
	start: Temporal.PlainDate | Temporal.ZonedDateTime;
	end: Temporal.PlainDate | Temporal.ZonedDateTime;
	calendarId: CalendarEventType;
	_eventData: CalendarEvent; // Store original for details panel
}

/**
 * Color configuration for each calendar type
 * Matches existing legend colors
 */
export const calendarColors = {
	holiday: {
		colorName: "holiday",
		lightColors: {
			main: "#f59e0b", // Amber
			container: "#fef3c7",
			onContainer: "#92400e",
		},
		darkColors: {
			main: "#fbbf24",
			container: "#78350f",
			onContainer: "#fde68a",
		},
	},
	absence: {
		colorName: "absence",
		lightColors: {
			main: "#3b82f6", // Blue
			container: "#dbeafe",
			onContainer: "#1e40af",
		},
		darkColors: {
			main: "#60a5fa",
			container: "#1e3a8a",
			onContainer: "#bfdbfe",
		},
	},
	work_period: {
		colorName: "work_period",
		lightColors: {
			main: "#10b981", // Green (emerald)
			container: "#d1fae5",
			onContainer: "#065f46",
		},
		darkColors: {
			main: "#34d399",
			container: "#064e3b",
			onContainer: "#a7f3d0",
		},
	},
	time_entry: {
		colorName: "time_entry",
		lightColors: {
			main: "#8b5cf6", // Purple
			container: "#ede9fe",
			onContainer: "#5b21b6",
		},
		darkColors: {
			main: "#a78bfa",
			container: "#4c1d95",
			onContainer: "#ddd6fe",
		},
	},
	break: {
		colorName: "break",
		lightColors: {
			main: "#6b7280", // Gray
			container: "#f3f4f6",
			onContainer: "#374151",
		},
		darkColors: {
			main: "#9ca3af",
			container: "#374151",
			onContainer: "#e5e7eb",
		},
	},
} as const;

/**
 * Safely convert a date value to a Date object
 * With SuperJSON in place, dates should arrive as proper Date objects.
 * This function provides validation and fallback for edge cases.
 */
function toSafeDate(value: Date | string | number | unknown): Date {
	// Handle null/undefined
	if (value == null) {
		console.warn("[Schedule-X Adapter] Null date value, falling back to current date");
		return new Date();
	}

	// Direct Date instance check (expected path with SuperJSON)
	if (value instanceof Date) {
		if (!Number.isNaN(value.getTime())) {
			return value;
		}
		console.warn("[Schedule-X Adapter] Invalid Date object, falling back to current date");
		return new Date();
	}

	// Fallback: Handle string dates (for backwards compatibility)
	if (typeof value === "string") {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date;
		}
	}

	// Fallback: Handle numeric timestamps
	if (typeof value === "number") {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) {
			return date;
		}
	}

	// Fallback to current date if all else fails
	console.warn(
		"[Schedule-X Adapter] Invalid date value, falling back to current date:",
		value,
		typeof value,
	);
	return new Date();
}

/**
 * Convert a Date to Temporal.ZonedDateTime for timed events
 * Uses the global Temporal API (required by Schedule-X)
 * Format: Temporal.ZonedDateTime.from('2025-01-01T12:00:00+01:00[Europe/Berlin]')
 */
export function toTemporalZonedDateTime(date: Date | string | unknown): Temporal.ZonedDateTime {
	const safeDate = toSafeDate(date);

	// Get the user's timezone from the global Temporal
	const timeZone = Temporal.Now.timeZoneId();

	// Format the date as ISO string with timezone offset
	const year = safeDate.getFullYear();
	const month = String(safeDate.getMonth() + 1).padStart(2, "0");
	const day = String(safeDate.getDate()).padStart(2, "0");
	const hours = String(safeDate.getHours()).padStart(2, "0");
	const minutes = String(safeDate.getMinutes()).padStart(2, "0");
	const seconds = String(safeDate.getSeconds()).padStart(2, "0");

	// Create ZonedDateTime using the from() method with timezone annotation
	// This is the format Schedule-X expects
	const isoString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}[${timeZone}]`;

	return Temporal.ZonedDateTime.from(isoString);
}

/**
 * Convert a Date to Temporal.PlainDate for all-day events
 * Uses UTC to avoid timezone-related day shifts for all-day events
 * Uses the global Temporal API (required by Schedule-X)
 * Format: Temporal.PlainDate.from('2025-01-01')
 */
export function toTemporalPlainDate(date: Date | string | unknown): Temporal.PlainDate {
	const safeDate = toSafeDate(date);
	const year = safeDate.getUTCFullYear();
	const month = String(safeDate.getUTCMonth() + 1).padStart(2, "0");
	const day = String(safeDate.getUTCDate()).padStart(2, "0");

	// Create PlainDate using the from() method with string format
	// This is the format Schedule-X expects
	return Temporal.PlainDate.from(`${year}-${month}-${day}`);
}

/**
 * Transform a CalendarEvent to Schedule-X event format
 * Uses Temporal API types as required by Schedule-X v3
 * Returns null if the event cannot be transformed (invalid dates)
 */
export function calendarEventToScheduleX(event: CalendarEvent): ScheduleXEvent | null {
	try {
		// Debug: Log raw date values to identify parsing issues
		if (process.env.NODE_ENV === "development") {
			const dateValue = event.date;
			const dateType = Object.prototype.toString.call(dateValue);
			if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) {
				console.warn(
					`[Schedule-X Adapter] Invalid date for event ${event.id} (${event.type}):`,
					dateValue,
					"type:",
					dateType,
				);
			}
		}

		const startDate = toSafeDate(event.date);
		const endDate = event.endDate ? toSafeDate(event.endDate) : toSafeDate(event.date);

		// Determine if this is an all-day event
		// - Holidays and absences are always all-day
		const isAllDay = event.type === "holiday" || event.type === "absence";

		if (isAllDay) {
			// For all-day events, use Temporal.PlainDate
			// End date is exclusive in Schedule-X, so add 1 day
			const start = toTemporalPlainDate(startDate);
			const end = toTemporalPlainDate(endDate).add({ days: 1 });

			return {
				id: event.id,
				title: event.title,
				start,
				end,
				calendarId: event.type,
				_eventData: event,
			};
		}

		if (event.type === "work_period") {
			// Work periods span from clock-in to clock-out
			// Display as a timed block showing work time
			// Breaks appear as gaps between these blocks
			const start = toTemporalZonedDateTime(startDate);
			const end = toTemporalZonedDateTime(endDate);

			return {
				id: event.id,
				title: event.title,
				start,
				end,
				calendarId: event.type,
				_eventData: event,
			};
		}

		if (event.type === "time_entry") {
			// Time entries are point-in-time, show as 30-minute block
			// Use Temporal.ZonedDateTime for timed events
			const start = toTemporalZonedDateTime(startDate);
			const end = start.add({ minutes: 30 });

			return {
				id: event.id,
				title: event.title,
				start,
				end,
				calendarId: event.type,
				_eventData: event,
			};
		}

		// Fallback: show as all-day event to be safe
		const start = toTemporalPlainDate(startDate);
		const end = start.add({ days: 1 });

		return {
			id: event.id,
			title: event.title,
			start,
			end,
			calendarId: event.type,
			_eventData: event,
		};
	} catch (error) {
		console.error(`[Schedule-X Adapter] Error transforming event ${event.id}:`, error, {
			originalDate: event.date,
			originalEndDate: event.endDate,
		});
		return null;
	}
}

/**
 * Transform multiple CalendarEvents to Schedule-X events
 * Filters out any events with invalid dates
 */
export function calendarEventsToScheduleX(events: CalendarEvent[]): ScheduleXEvent[] {
	const validEvents: ScheduleXEvent[] = [];
	let invalidCount = 0;

	for (const event of events) {
		const scheduleXEvent = calendarEventToScheduleX(event);
		if (scheduleXEvent) {
			validEvents.push(scheduleXEvent);
		} else {
			invalidCount++;
		}
	}

	if (invalidCount > 0) {
		console.warn(
			`[Schedule-X Adapter] Filtered out ${invalidCount} events with invalid dates out of ${events.length} total`,
		);
	}

	return validEvents;
}

/**
 * Get Schedule-X calendars configuration
 */
export function getScheduleXCalendars() {
	return {
		holiday: calendarColors.holiday,
		absence: calendarColors.absence,
		work_period: calendarColors.work_period,
		time_entry: calendarColors.time_entry,
		break: calendarColors.break,
	};
}

/**
 * Format duration in minutes to human-readable string
 * Examples: "8h 30m", "4h", "45m"
 */
function formatBreakDuration(minutes: number): string {
	if (minutes < 0) return "0m";

	const hours = Math.floor(minutes / 60);
	const mins = Math.round(minutes % 60);

	if (hours === 0) {
		return `${mins}m`;
	} else if (mins === 0) {
		return `${hours}h`;
	} else {
		return `${hours}h ${mins}m`;
	}
}

/**
 * Generate break events from work periods
 * Breaks are the gaps between consecutive work periods on the same day
 * Returns Schedule-X formatted events for display in day/week view
 */
export function generateBreakEvents(workPeriodEvents: ScheduleXEvent[]): ScheduleXEvent[] {
	const breakEvents: ScheduleXEvent[] = [];

	// Group work periods by date and employee
	const periodsByDayAndEmployee = new Map<string, ScheduleXEvent[]>();

	for (const event of workPeriodEvents) {
		if (event.calendarId !== "work_period") continue;

		const employeeName = event._eventData.metadata?.employeeName || "Unknown";
		// Get date string from the start time
		const startDate = event._eventData.date;
		const dateKey =
			startDate instanceof Date
				? `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`
				: String(startDate).split("T")[0];
		const groupKey = `${dateKey}_${employeeName}`;

		if (!periodsByDayAndEmployee.has(groupKey)) {
			periodsByDayAndEmployee.set(groupKey, []);
		}
		periodsByDayAndEmployee.get(groupKey)!.push(event);
	}

	// For each group, sort by start time and find gaps
	for (const [groupKey, periods] of periodsByDayAndEmployee) {
		if (periods.length < 2) continue; // Need at least 2 periods for a break

		// Sort by start time
		periods.sort((a, b) => {
			const aStart = a._eventData.date;
			const bStart = b._eventData.date;
			const aTime = aStart instanceof Date ? aStart.getTime() : new Date(String(aStart)).getTime();
			const bTime = bStart instanceof Date ? bStart.getTime() : new Date(String(bStart)).getTime();
			return aTime - bTime;
		});

		// Find gaps between consecutive periods
		for (let i = 0; i < periods.length - 1; i++) {
			const currentPeriod = periods[i];
			const nextPeriod = periods[i + 1];

			// Get end time of current period and start time of next period
			const currentEnd = currentPeriod._eventData.endDate;
			const nextStart = nextPeriod._eventData.date;

			if (!currentEnd) continue;

			const currentEndTime =
				currentEnd instanceof Date ? currentEnd.getTime() : new Date(String(currentEnd)).getTime();
			const nextStartTime =
				nextStart instanceof Date ? nextStart.getTime() : new Date(String(nextStart)).getTime();

			// Calculate gap duration in minutes
			const gapMinutes = (nextStartTime - currentEndTime) / (1000 * 60);

			// Only create break if gap is at least 1 minute
			if (gapMinutes >= 1) {
				const employeeName = currentPeriod._eventData.metadata?.employeeName || "Unknown";
				const breakStart = currentEnd instanceof Date ? currentEnd : new Date(String(currentEnd));
				const breakEnd = nextStart instanceof Date ? nextStart : new Date(String(nextStart));

				const breakEvent: ScheduleXEvent = {
					id: `break_${groupKey}_${i}`,
					title: `Break - ${formatBreakDuration(gapMinutes)}`,
					start: toTemporalZonedDateTime(breakStart),
					end: toTemporalZonedDateTime(breakEnd),
					calendarId: "break",
					_eventData: {
						id: `break_${groupKey}_${i}`,
						type: "break",
						date: breakStart,
						endDate: breakEnd,
						title: `Break - ${formatBreakDuration(gapMinutes)}`,
						description: "Break between work periods",
						color: "#6b7280",
						metadata: {
							durationMinutes: gapMinutes,
							employeeName,
						},
					},
				};

				breakEvents.push(breakEvent);
			}
		}
	}

	return breakEvents;
}
