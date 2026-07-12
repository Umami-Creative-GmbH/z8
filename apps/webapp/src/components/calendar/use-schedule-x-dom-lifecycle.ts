import { DateTime } from "luxon";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { WorkPeriodEvent } from "@/lib/calendar/types";
import { buildRequirementHeaderContent } from "./daily-requirement-strip";
import {
	buildCalendarTimeZoneDate,
	buildCurrentTimeIndicatorPosition,
	hasExceededPointerDragThreshold,
	isIntentionalRangePointerDown,
	isScheduleXEventElement,
	resolveEventModalLeft,
	shouldRetryRequirementHeaderInjection,
} from "./schedule-x-calendar-utils";
import type { ViewMode } from "./schedule-x-calendar";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";

interface RangeSelectionStart {
	date: Date;
	clientX: number;
	clientY: number;
}

function getHeaderCells(container: HTMLDivElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			".sx__week-header .sx__week-grid__date, .sx__week-header .sx__date-grid__date, .sx__week-header [data-time-grid-date]",
		),
	);
}

function getEventModalAnchorRect(eventElement: HTMLElement) {
	const eventRect = eventElement.getBoundingClientRect();
	const cellRect = eventElement
		.closest<HTMLElement>(".sx__time-grid-day, .sx__date-grid-day, .sx__month-grid-day")
		?.getBoundingClientRect();

	return {
		left: cellRect ? Math.max(eventRect.left, cellRect.left) : eventRect.left,
		right: cellRect ? Math.min(eventRect.right, cellRect.right) : eventRect.right,
	};
}

function clearRequirementHeaderContent(container: HTMLDivElement) {
	for (const node of container.querySelectorAll(".z8-requirement-header-summary")) {
		node.remove();
	}
}

function roundToQuarterHour(minutes: number) {
	return Math.max(0, Math.min(23 * 60 + 45, Math.round(minutes / 15) * 15));
}

function getPointerDateTime(
	container: HTMLDivElement,
	event: PointerEvent,
	visibleDates: DateTime[],
	timeZone: string,
) {
	if (visibleDates.length === 0) return null;

	const target = event.target instanceof Element ? event.target : null;
	const dateAttributeElement = target?.closest<HTMLElement>(
		"[data-time-grid-date], [data-date], [data-date-time]",
	);
	const dateAttribute =
		dateAttributeElement?.dataset.timeGridDate ??
		dateAttributeElement?.dataset.date ??
		dateAttributeElement?.dataset.dateTime;
	const attributeDate = dateAttribute
		? DateTime.fromISO(dateAttribute.slice(0, 10), { zone: timeZone })
		: null;

	const dayCells = Array.from(container.querySelectorAll<HTMLElement>(".sx__time-grid-day"));
	const matchingDayCell = dayCells.find((cell) => {
		const rect = cell.getBoundingClientRect();
		return (
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom
		);
	});
	const timeGrid =
		matchingDayCell ?? container.querySelector<HTMLElement>(".sx__time-grid-wrapper");
	if (!timeGrid) return null;

	const timeGridRect = timeGrid.getBoundingClientRect();
	if (timeGridRect.height <= 0) return null;

	const dayIndex = matchingDayCell ? Math.max(0, dayCells.indexOf(matchingDayCell)) : 0;
	const date = attributeDate?.isValid
		? attributeDate
		: visibleDates[Math.min(dayIndex, visibleDates.length - 1)];
	const minutes = roundToQuarterHour(
		((event.clientY - timeGridRect.top) / timeGridRect.height) * 24 * 60,
	);

	return buildCalendarTimeZoneDate(date.toISODate() ?? "", minutes, timeZone);
}

export function useScheduleXClockOutDelegation({
	calendarContainerRef,
	events,
	clockOutAllowedWorkPeriodIds,
	onRunningPeriodClockOutRequest,
}: {
	calendarContainerRef: RefObject<HTMLDivElement | null>;
	events: CalendarEvent[];
	clockOutAllowedWorkPeriodIds: ReadonlySet<string>;
	onRunningPeriodClockOutRequest?: (event: WorkPeriodEvent) => void;
}) {
	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container || !onRunningPeriodClockOutRequest) return;

		const handleClick = (event: MouseEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			const button = target?.closest<HTMLElement>("[data-running-clock-out-button]");
			if (!button || !container.contains(button)) return;

			event.preventDefault();
			event.stopPropagation();

			const workPeriodId = button.dataset.workPeriodId;
			if (!workPeriodId) return;

			const calendarEvent = events.find(
				(candidate): candidate is WorkPeriodEvent =>
					candidate.id === workPeriodId &&
					candidate.type === "work_period" &&
					candidate.metadata.isRunning,
			);
			if (calendarEvent && clockOutAllowedWorkPeriodIds.has(calendarEvent.id)) {
				onRunningPeriodClockOutRequest(calendarEvent);
			}
		};

		container.addEventListener("click", handleClick, { capture: true });
		return () => container.removeEventListener("click", handleClick, { capture: true });
	}, [calendarContainerRef, clockOutAllowedWorkPeriodIds, events, onRunningPeriodClockOutRequest]);
}

export function useScheduleXDomLifecycle({
	calendarContainerRef,
	events,
	clockOutAllowedWorkPeriodIds,
	onRunningPeriodClockOutRequest,
	isLoading,
	viewMode,
	timeZone,
	visibleRequirementDates,
	workHoursData,
	isSummaryLoading,
	t,
	onTimeRangeSelect,
}: {
	calendarContainerRef: RefObject<HTMLDivElement | null>;
	events: CalendarEvent[];
	clockOutAllowedWorkPeriodIds: ReadonlySet<string>;
	onRunningPeriodClockOutRequest?: (event: WorkPeriodEvent) => void;
	isLoading: boolean;
	viewMode: ViewMode;
	timeZone: string;
	visibleRequirementDates: DateTime[];
	workHoursData: DailyWorkHoursSummaries;
	isSummaryLoading: boolean;
	t: (key: string, fallback: string) => string;
	onTimeRangeSelect?: (range: { start: Date; end: Date }) => void;
}) {
	const lastEventModalAnchorRef = useRef<HTMLElement | null>(null);
	const selectionStartRef = useRef<RangeSelectionStart | null>(null);

	useScheduleXClockOutDelegation({
		calendarContainerRef,
		events,
		clockOutAllowedWorkPeriodIds,
		onRunningPeriodClockOutRequest,
	});

	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container) return;
		const repositionFrames = new Set<number>();

		const rememberEventAnchor = (event: PointerEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			lastEventModalAnchorRef.current = target?.closest<HTMLElement>(".sx__event") ?? null;
		};
		const repositionEventModal = () => {
			const eventElement = lastEventModalAnchorRef.current;
			const modal = container.querySelector<HTMLElement>(".sx__event-modal.is-open");
			if (!eventElement || !modal) return;

			const appRect = container.getBoundingClientRect();
			const eventRect = getEventModalAnchorRect(eventElement);
			const modalWidth = modal.getBoundingClientRect().width || 400;
			const left = resolveEventModalLeft({
				appLeft: appRect.left,
				appRight: appRect.right,
				eventLeft: eventRect.left,
				eventRight: eventRect.right,
				modalWidth,
			});

			document.documentElement.style.setProperty("--sx-event-modal-left", `${left}px`);
		};
		const scheduleReposition = () => {
			const frame = window.requestAnimationFrame(() => {
				repositionFrames.delete(frame);
				repositionEventModal();
			});
			repositionFrames.add(frame);
		};

		const observer = new MutationObserver(scheduleReposition);
		observer.observe(container, { childList: true, subtree: true });
		container.addEventListener("pointerup", rememberEventAnchor, { capture: true });
		container.addEventListener("scroll", scheduleReposition, { capture: true, passive: true });
		window.addEventListener("resize", scheduleReposition);

		return () => {
			observer.disconnect();
			for (const frame of repositionFrames) window.cancelAnimationFrame(frame);
			container.removeEventListener("pointerup", rememberEventAnchor, { capture: true });
			container.removeEventListener("scroll", scheduleReposition, { capture: true });
			window.removeEventListener("resize", scheduleReposition);
		};
	}, [calendarContainerRef]);

	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container || isLoading || (viewMode !== "day" && viewMode !== "week")) return;

		let frame = 0;
		let timeout: number | null = null;
		const clearIndicators = () => {
			for (const indicator of container.querySelectorAll(".z8-current-time-indicator")) {
				indicator.remove();
			}
		};
		const renderIndicator = () => {
			clearIndicators();
			const position = buildCurrentTimeIndicatorPosition(new Date(), timeZone);
			if (!position) return;

			const todayElement = container.querySelector<HTMLElement>(
				`[data-time-grid-date="${position.dateKey}"]`,
			);
			if (!todayElement) return;

			const indicator = document.createElement("div");
			indicator.className = "sx__current-time-indicator z8-current-time-indicator";
			indicator.style.top = `${position.topPercent}%`;
			indicator.setAttribute("aria-hidden", "true");
			todayElement.append(indicator);
		};
		const scheduleIndicator = () => {
			frame = window.requestAnimationFrame(renderIndicator);
			timeout = window.setTimeout(scheduleIndicator, 60_000 - (Date.now() % 60_000));
		};

		scheduleIndicator();
		const observer = new MutationObserver(() => {
			if (container.querySelector(".z8-current-time-indicator")) return;
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(renderIndicator);
		});
		observer.observe(container, { childList: true, subtree: true });

		return () => {
			observer.disconnect();
			window.cancelAnimationFrame(frame);
			if (timeout !== null) window.clearTimeout(timeout);
			clearIndicators();
		};
	}, [calendarContainerRef, timeZone, viewMode, isLoading]);

	useEffect(() => {
		if (isLoading || (viewMode !== "day" && viewMode !== "week")) return;

		const timer = window.setTimeout(() => {
			const timeIndicator = calendarContainerRef.current?.querySelector(
				".sx__current-time-indicator",
			);
			if (timeIndicator) {
				timeIndicator.scrollIntoView({ behavior: "smooth", block: "center" });
				return;
			}

			const now = DateTime.now().setZone(timeZone);
			const hoursFromStart = now.hour + now.minute / 60;
			const scrollContainer = calendarContainerRef.current?.querySelector(".sx__time-grid-day");
			if (!scrollContainer) return;

			const hourHeight = scrollContainer.scrollHeight / 24;
			const scrollPosition = hoursFromStart * hourHeight - 200;
			scrollContainer.parentElement?.scrollTo({ top: scrollPosition, behavior: "smooth" });
		}, 100);

		return () => clearTimeout(timer);
	}, [calendarContainerRef, timeZone, viewMode, isLoading]);

	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container || (viewMode !== "day" && viewMode !== "week")) return;

		let frame = 0;
		let retryTimeout: number | null = null;
		let disposed = false;
		const maxAttempts = 40;
		const retryDelayMs = 50;

		const renderHeaderContent = (attempt = 0) => {
			if (disposed) return;

			clearRequirementHeaderContent(container);
			const headerCells = getHeaderCells(container);
			const shouldRetry = shouldRetryRequirementHeaderInjection({
				headerCellCount: headerCells.length,
				visibleDateCount: visibleRequirementDates.length,
			});

			for (const [index, date] of visibleRequirementDates.entries()) {
				const headerCell = headerCells[index];
				if (!headerCell) continue;

				if (isSummaryLoading) {
					const skeleton = document.createElement("div");
					skeleton.className =
						"z8-requirement-header-summary z8-requirement-header-summary--skeleton";
					skeleton.setAttribute("aria-hidden", "true");
					headerCell.append(skeleton);
					continue;
				}

				const summary = workHoursData.get(date.toFormat("yyyy-MM-dd"));
				if (!summary) continue;

				const content = buildRequirementHeaderContent(summary, date.toFormat("cccc, LLLL d"), t);
				const wrapper = document.createElement("div");
				wrapper.className = `z8-requirement-header-summary z8-requirement-header-summary--${content.status}`;
				wrapper.setAttribute("aria-label", content.accessibleLabel);

				const screenReaderLabel = document.createElement("span");
				screenReaderLabel.className = "sr-only";
				screenReaderLabel.textContent = content.accessibleLabel;
				wrapper.append(screenReaderLabel);

				const required = document.createElement("span");
				required.className = "z8-requirement-header-summary__required";
				required.textContent = content.requiredHours;
				wrapper.append(required);

				if (content.deltaHours !== null) {
					const delta = document.createElement("span");
					delta.className = "z8-requirement-header-summary__delta";
					delta.textContent = content.deltaHours;
					wrapper.append(delta);
				}

				headerCell.append(wrapper);
			}

			if (shouldRetry && attempt < maxAttempts) {
				retryTimeout = window.setTimeout(() => {
					frame = window.requestAnimationFrame(() => renderHeaderContent(attempt + 1));
				}, retryDelayMs);
			}
		};

		frame = window.requestAnimationFrame(() => renderHeaderContent());

		return () => {
			disposed = true;
			window.cancelAnimationFrame(frame);
			if (retryTimeout !== null) window.clearTimeout(retryTimeout);
			clearRequirementHeaderContent(container);
		};
	}, [calendarContainerRef, t, viewMode, visibleRequirementDates, workHoursData, isSummaryLoading]);

	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container || !onTimeRangeSelect || (viewMode !== "day" && viewMode !== "week")) return;

		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target instanceof Element ? event.target : null;
			if (
				!(target instanceof HTMLElement) ||
				isScheduleXEventElement(target) ||
				!isIntentionalRangePointerDown(event)
			) {
				return;
			}

			const date = getPointerDateTime(container, event, visibleRequirementDates, timeZone);
			selectionStartRef.current = date
				? { date, clientX: event.clientX, clientY: event.clientY }
				: null;
		};

		const handlePointerUp = (event: PointerEvent) => {
			const start = selectionStartRef.current;
			selectionStartRef.current = null;
			if (!start || !hasExceededPointerDragThreshold(start, event)) return;

			const target = event.target instanceof Element ? event.target : null;
			if (target instanceof HTMLElement && isScheduleXEventElement(target)) return;

			const end = getPointerDateTime(container, event, visibleRequirementDates, timeZone);
			if (!end || start.date.getTime() === end.getTime()) return;

			onTimeRangeSelect({ start: start.date, end });
		};

		container.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("pointerup", handlePointerUp);

		return () => {
			selectionStartRef.current = null;
			container.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("pointerup", handlePointerUp);
		};
	}, [calendarContainerRef, onTimeRangeSelect, timeZone, viewMode, visibleRequirementDates]);
}
