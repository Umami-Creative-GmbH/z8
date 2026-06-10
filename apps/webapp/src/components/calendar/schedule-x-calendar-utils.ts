import { DateTime } from "luxon";

import type { ScheduleXEvent } from "@/lib/calendar/schedule-x-adapter";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { ViewMode } from "./schedule-x-calendar";

export function filterEventsForScheduleXView(
	events: CalendarEvent[],
	viewMode: ViewMode,
): CalendarEvent[] {
	if (viewMode === "day" || viewMode === "week") return events;

	return events.filter((event) => !(event.type === "work_period" && event.metadata.isRunning));
}

export function resolveClickableCalendarEvent(
	events: Pick<ScheduleXEvent, "id" | "_eventData">[],
	clickedEvent: { id: string },
): CalendarEvent | null {
	const scheduleXEvent = events.find((event) => event.id === clickedEvent.id);
	const eventData = scheduleXEvent?._eventData;

	if (eventData?.type === "work_period" && eventData.metadata.isRunning) {
		return null;
	}

	return eventData ?? null;
}

export function shouldRetryRequirementHeaderInjection({
	headerCellCount,
	visibleDateCount,
}: {
	headerCellCount: number;
	visibleDateCount: number;
}) {
	return visibleDateCount > 0 && headerCellCount < visibleDateCount;
}

export function isScheduleXEventElement(target: HTMLElement) {
	return Boolean(target.closest(".sx__event, .sx__time-grid-event, .sx__date-grid-event"));
}

export function resolveEventModalLeft({
	appLeft,
	appRight,
	eventLeft,
	eventRight,
	modalWidth,
	gap = 10,
}: {
	appLeft: number;
	appRight: number;
	eventLeft: number;
	eventRight: number;
	modalWidth: number;
	gap?: number;
}) {
	const rightSideLeft = eventRight + gap;
	if (rightSideLeft + modalWidth <= appRight) return rightSideLeft;

	const leftSideLeft = eventLeft - modalWidth - gap;
	if (leftSideLeft >= appLeft) return leftSideLeft;

	return appLeft;
}

export function isIntentionalRangePointerDown({
	button,
	pointerType,
}: Pick<PointerEvent, "button" | "pointerType">) {
	return button === 0 && (pointerType === "mouse" || pointerType === "pen");
}

export function hasExceededPointerDragThreshold(
	start: Pick<PointerEvent, "clientX" | "clientY">,
	end: Pick<PointerEvent, "clientX" | "clientY">,
	threshold = 4,
) {
	return Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) > threshold;
}

export function buildCalendarTimeZoneDate(dateValue: string, minutes: number, timeZone: string) {
	return DateTime.fromISO(dateValue, { zone: timeZone })
		.startOf("day")
		.plus({ minutes })
		.toJSDate();
}

export function buildCurrentTimeIndicatorPosition(now: Date, timeZone: string) {
	const zonedNow = DateTime.fromJSDate(now, { zone: timeZone });
	if (!zonedNow.isValid) return null;

	const minutes = zonedNow.hour * 60 + zonedNow.minute + zonedNow.second / 60;
	return {
		dateKey: zonedNow.toFormat("yyyy-MM-dd"),
		topPercent: (minutes * 100) / (24 * 60),
	};
}
