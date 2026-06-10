"use client";

// Note: Temporal polyfill is imported in theme-provider.tsx to ensure
// it loads early enough for Schedule-X. Do not add it here.

import {
	createViewDay,
	createViewMonthAgenda,
	createViewMonthGrid,
	createViewWeek,
} from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";

import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";

// Schedule-X CSS customizations must load after the default theme.
import "./schedule-x-calendar.css";
import { IconChevronLeft, IconChevronRight, IconReload } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserTimezone, useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	calendarEventsToScheduleX,
	generateBreakEvents,
	getScheduleXCalendars,
} from "@/lib/calendar/schedule-x-adapter";
import { toScheduleXLocale } from "@/lib/calendar/schedule-x-locale";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { getWeekBounds } from "@/lib/user-preferences/week-start";
import { buildRequirementHeaderContent } from "./daily-requirement-strip";
import {
	buildCalendarTimeZoneDate,
	buildCurrentTimeIndicatorPosition,
	filterEventsForScheduleXView,
	hasExceededPointerDragThreshold,
	isIntentionalRangePointerDown,
	isScheduleXEventElement,
	resolveEventModalLeft,
	resolveClickableCalendarEvent,
	shouldRetryRequirementHeaderInjection,
} from "./schedule-x-calendar-utils";

export type ViewMode = "day" | "week" | "month" | "year";

interface RangeSelectionStart {
	date: Date;
	clientX: number;
	clientY: number;
}

interface ScheduleXCalendarWrapperProps {
	events: CalendarEvent[];
	timeZone?: string;
	isLoading?: boolean;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onEventClick?: (event: CalendarEvent) => void;
	clockOutAllowedWorkPeriodIds?: ReadonlySet<string>;
	onRunningPeriodClockOutRequest?: (event: CalendarEvent) => void;
	onRangeChange?: (range: { start: Date; end: Date }) => void;
	onTimeRangeSelect?: (range: { start: Date; end: Date }) => void;
	onRefresh?: () => void;
	workHoursData?: DailyWorkHoursSummaries;
	isSummaryLoading?: boolean;
}

// Map view mode to Schedule-X view names
const viewModeToScheduleX: Record<ViewMode, string> = {
	day: "day",
	week: "week",
	month: "month-grid",
	year: "month-grid", // Year view is handled separately, fallback to month-grid
};

const EMPTY_CLOCK_OUT_ALLOWED_WORK_PERIOD_IDS = new Set<string>();

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

export function ScheduleXCalendarWrapper({
	events,
	timeZone: explicitTimeZone,
	isLoading = false,
	viewMode,
	onViewModeChange,
	onEventClick,
	clockOutAllowedWorkPeriodIds = EMPTY_CLOCK_OUT_ALLOWED_WORK_PERIOD_IDS,
	onRunningPeriodClockOutRequest,
	onRangeChange,
	onTimeRangeSelect,
	onRefresh,
	workHoursData = new Map(),
	isSummaryLoading = false,
}: ScheduleXCalendarWrapperProps) {
	const { resolvedTheme } = useTheme();
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const scheduleXLocale = toScheduleXLocale(locale);
	const weekStartDay = useWeekStartDay();
	const viewerTimeZone = useUserTimezone();
	const timeZone = explicitTimeZone ?? viewerTimeZone;
	const isDark = resolvedTheme === "dark";

	// Track current date for display
	const [currentDate, setCurrentDate] = useState<DateTime>(() => DateTime.now());
	const [runningPeriodNow, setRunningPeriodNow] = useState<Date>(() => new Date());

	// Create calendar plugins (must be stable references)
	const [calendarControls] = useState(() => createCalendarControlsPlugin());
	const calendarContainerRef = useRef<HTMLDivElement>(null);
	const lastEventModalAnchorRef = useRef<HTMLElement | null>(null);
	const selectionStartRef = useRef<RangeSelectionStart | null>(null);

	const hasVisibleRunningPeriod =
		(viewMode === "day" || viewMode === "week") &&
		events.some((event) => event.type === "work_period" && event.metadata.isRunning);

	const liveEvents = hasVisibleRunningPeriod
		? events.map((event) =>
				event.type === "work_period" && event.metadata.isRunning
					? { ...event, endDate: runningPeriodNow }
					: event,
			)
		: events;
	// Convert events to Schedule-X format
	const baseScheduleXEvents = calendarEventsToScheduleX(
		filterEventsForScheduleXView(liveEvents, viewMode),
		timeZone,
		{ clockOutAllowedWorkPeriodIds },
	);

	// Generate break events only for day/week view
	const scheduleXEvents = (() => {
		if (viewMode === "day" || viewMode === "week") {
			const breakEvents = generateBreakEvents(baseScheduleXEvents, timeZone);
			return [...baseScheduleXEvents, ...breakEvents];
		}
		return baseScheduleXEvents;
	})();

	// Helper to convert Luxon DateTime to Temporal.PlainDate
	const luxonToPlainDate = (dt: DateTime): Temporal.PlainDate => {
		return Temporal.PlainDate.from({
			year: dt.year,
			month: dt.month,
			day: dt.day,
		});
	};

	// Navigation functions
	const navigatePrevious = () => {
		let newDate: DateTime;
		switch (viewMode) {
			case "day":
				newDate = currentDate.minus({ days: 1 });
				break;
			case "week":
				newDate = currentDate.minus({ weeks: 1 });
				break;
			case "month":
				newDate = currentDate.minus({ months: 1 });
				break;
			default:
				newDate = currentDate.minus({ days: 1 });
		}
		setCurrentDate(newDate);
		calendarControls.setDate(luxonToPlainDate(newDate));
	};

	const navigateNext = () => {
		let newDate: DateTime;
		switch (viewMode) {
			case "day":
				newDate = currentDate.plus({ days: 1 });
				break;
			case "week":
				newDate = currentDate.plus({ weeks: 1 });
				break;
			case "month":
				newDate = currentDate.plus({ months: 1 });
				break;
			default:
				newDate = currentDate.plus({ days: 1 });
		}
		setCurrentDate(newDate);
		calendarControls.setDate(luxonToPlainDate(newDate));
	};

	const navigateToday = () => {
		const today = DateTime.now();
		setCurrentDate(today);
		calendarControls.setDate(luxonToPlainDate(today));
	};

	// Format the date range display based on view mode
	const dateRangeDisplay = (() => {
		const localizedCurrentDate = currentDate.setLocale(locale);

		switch (viewMode) {
			case "day":
				return localizedCurrentDate.toFormat("EEEE, MMMM d, yyyy");
			case "week": {
				const { start: weekStart, end: weekEnd } = getWeekBounds(
					localizedCurrentDate,
					weekStartDay,
				);
				if (weekStart.month === weekEnd.month) {
					return `${weekStart.toFormat("MMMM d")} - ${weekEnd.toFormat("d, yyyy")}`;
				}
				return `${weekStart.toFormat("MMM d")} - ${weekEnd.toFormat("MMM d, yyyy")}`;
			}
			case "month":
				return localizedCurrentDate.toFormat("MMMM yyyy");
			default:
				return localizedCurrentDate.toFormat("MMMM d, yyyy");
		}
	})();

	const mobileDateRangeDisplay = (() => {
		const localizedCurrentDate = currentDate.setLocale(locale);

		switch (viewMode) {
			case "day":
				return localizedCurrentDate.toFormat("ccc, d. LLL yyyy");
			case "week": {
				const { start: weekStart, end: weekEnd } = getWeekBounds(
					localizedCurrentDate,
					weekStartDay,
				);
				if (weekStart.year === weekEnd.year) {
					return `${weekStart.toFormat("d. LLL")} - ${weekEnd.toFormat("d. LLL yyyy")}`;
				}
				return `${weekStart.toFormat("d. LLL yyyy")} - ${weekEnd.toFormat("d. LLL yyyy")}`;
			}
			case "month":
				return localizedCurrentDate.toFormat("LLL yyyy");
			default:
				return localizedCurrentDate.toFormat("d. LLL yyyy");
		}
	})();

	const visibleRequirementDates = (() => {
		if (viewMode === "day") return [currentDate.startOf("day")];
		if (viewMode === "week") {
			const { start } = getWeekBounds(currentDate, weekStartDay);
			return Array.from({ length: 7 }, (_, index) => start.plus({ days: index }));
		}
		return [];
	})();

	// Handle event click - Schedule-X passes the event object
	const handleEventClick = (event: { id: string }) => {
		if (!onEventClick) return;

		const calendarEvent = resolveClickableCalendarEvent(scheduleXEvents, event);
		if (calendarEvent) {
			onEventClick(calendarEvent);
		}
	};

	// Handle date range change from Schedule-X
	// Schedule-X returns Temporal objects or strings depending on context
	const handleRangeChange = (range: { start: unknown; end: unknown }) => {
		if (!onRangeChange) return;

		// Convert to Date using Luxon for robust parsing
		const toDate = (value: unknown): Date => {
			if (value instanceof Date) return value;
			// Use Luxon to parse any string/Temporal format
			const str = String(value);
			const dt = DateTime.fromISO(str).isValid
				? DateTime.fromISO(str)
				: DateTime.fromSQL(str).isValid
					? DateTime.fromSQL(str)
					: DateTime.fromJSDate(new Date(str));
			return dt.toJSDate();
		};

		onRangeChange({
			start: toDate(range.start),
			end: toDate(range.end),
		});
	};

	const handleViewModeChange = (mode: ViewMode) => {
		if (mode !== "year") {
			calendarControls.setView(viewModeToScheduleX[mode]);
		}
		onViewModeChange(mode);
	};

	// Create calendar instance with controls plugin
	const calendar = useCalendarApp({
		views: [createViewDay(), createViewWeek(), createViewMonthGrid(), createViewMonthAgenda()],
		defaultView: viewModeToScheduleX[viewMode],
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		events: scheduleXEvents as any,
		isDark,
		isResponsive: false,
		locale: scheduleXLocale,
		calendars: getScheduleXCalendars(),
		plugins: [createEventModalPlugin(), calendarControls],
		callbacks: {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onEventClick: handleEventClick as any,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onRangeUpdate: handleRangeChange as any,
		},
	});

	useEffect(() => {
		if (!hasVisibleRunningPeriod) return;

		const interval = window.setInterval(() => {
			setRunningPeriodNow(new Date());
		}, 60_000);

		return () => window.clearInterval(interval);
	}, [hasVisibleRunningPeriod]);

	// Keep the imperative Schedule-X instance in sync before the stale event list can paint.
	useLayoutEffect(() => {
		if (calendar) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				calendar.events.set(scheduleXEvents as any);
			} catch (error) {
				console.error("[Schedule-X Calendar] Error setting events:", error);
				console.error(
					"[Schedule-X Calendar] Events that caused error:",
					scheduleXEvents.slice(0, 5), // Log first 5 events for debugging
					"... (total:",
					scheduleXEvents.length,
					")",
				);
			}
		}
	}, [calendar, scheduleXEvents]);

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
				(event) =>
					event.id === workPeriodId && event.type === "work_period" && event.metadata.isRunning,
			);
			if (calendarEvent && clockOutAllowedWorkPeriodIds.has(calendarEvent.id)) {
				onRunningPeriodClockOutRequest(calendarEvent);
			}
		};

		container.addEventListener("click", handleClick, { capture: true });
		return () => container.removeEventListener("click", handleClick, { capture: true });
	}, [clockOutAllowedWorkPeriodIds, events, onRunningPeriodClockOutRequest]);

	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container) return;

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
		const scheduleReposition = () => window.requestAnimationFrame(repositionEventModal);

		const observer = new MutationObserver(scheduleReposition);
		observer.observe(container, { childList: true, subtree: true });
		container.addEventListener("pointerup", rememberEventAnchor, { capture: true });
		container.addEventListener("scroll", scheduleReposition, { capture: true, passive: true });
		window.addEventListener("resize", scheduleReposition);

		return () => {
			observer.disconnect();
			container.removeEventListener("pointerup", rememberEventAnchor, { capture: true });
			container.removeEventListener("scroll", scheduleReposition, { capture: true });
			window.removeEventListener("resize", scheduleReposition);
		};
	}, []);

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
	}, [timeZone, viewMode, isLoading]);

	// Scroll to current time on mount and when switching to day/week view
	useEffect(() => {
		if (isLoading) return;
		if (viewMode === "day" || viewMode === "week") {
			// Wait for calendar to render, then scroll to current time indicator
			const timer = setTimeout(() => {
				const timeIndicator = calendarContainerRef.current?.querySelector(
					".sx__current-time-indicator",
				);
				if (timeIndicator) {
					timeIndicator.scrollIntoView({ behavior: "smooth", block: "center" });
				} else {
					// Fallback: scroll to approximate current hour position
					const now = DateTime.now();
					const hoursFromStart = now.hour + now.minute / 60;
					const scrollContainer = calendarContainerRef.current?.querySelector(".sx__time-grid-day");
					if (scrollContainer) {
						const hourHeight = scrollContainer.scrollHeight / 24;
						const scrollPosition = hoursFromStart * hourHeight - 200; // Center roughly
						scrollContainer.parentElement?.scrollTo({ top: scrollPosition, behavior: "smooth" });
					}
				}
			}, 100);
			return () => clearTimeout(timer);
		}
	}, [viewMode, isLoading]);

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
	}, [t, viewMode, visibleRequirementDates, workHoursData, isSummaryLoading]);

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
			if (!start) return;
			if (!hasExceededPointerDragThreshold(start, event)) return;

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
	}, [onTimeRangeSelect, timeZone, viewMode, visibleRequirementDates]);

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full min-h-[400px]">
				<div className="animate-pulse text-muted-foreground">
					{t("calendar.view.loading", "Loading calendar…")}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full min-h-[500px]">
			{/* Custom navigation header */}
			<div
				data-testid="calendar-desktop-header"
				className="hidden items-center justify-between gap-4 pb-3 mb-3 lg:flex"
			>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						onClick={navigatePrevious}
						aria-label={t("calendar.view.previous", "Previous")}
					>
						<IconChevronLeft className="size-4" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						onClick={navigateNext}
						aria-label={t("calendar.view.next", "Next")}
					>
						<IconChevronRight className="size-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={navigateToday}>
						{t("calendar.view.today", "Today")}
					</Button>
					{onRefresh && (
						<Button
							variant="outline"
							size="icon"
							onClick={onRefresh}
							aria-label={t("calendar.view.refresh", "Refresh")}
							title={t("calendar.view.refresh", "Refresh")}
						>
							<IconReload className="size-4" />
						</Button>
					)}
				</div>
				<h2 className="text-lg font-semibold">{dateRangeDisplay}</h2>
				<Tabs value={viewMode} onValueChange={(v) => handleViewModeChange(v as ViewMode)}>
					<TabsList>
						<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
						<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
						<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
						<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>
			<div data-testid="calendar-mobile-header" className="pb-3 mb-3 lg:hidden">
				<h2
					data-testid="calendar-mobile-date-range"
					className="mb-2 truncate whitespace-nowrap text-lg font-semibold"
				>
					{mobileDateRangeDisplay}
				</h2>
				<div
					data-testid="calendar-mobile-header-controls"
					className="overflow-x-auto whitespace-nowrap"
				>
					<div className="flex w-max items-center gap-2">
						<Button
							variant="outline"
							size="icon"
							onClick={navigatePrevious}
							aria-label={t("calendar.view.previous", "Previous")}
						>
							<IconChevronLeft className="size-4" />
						</Button>
						<Button
							variant="outline"
							size="icon"
							onClick={navigateNext}
							aria-label={t("calendar.view.next", "Next")}
						>
							<IconChevronRight className="size-4" />
						</Button>
						<Button variant="outline" size="sm" onClick={navigateToday}>
							{t("calendar.view.today", "Today")}
						</Button>
						{onRefresh && (
							<Button
								variant="outline"
								size="icon"
								onClick={onRefresh}
								aria-label={t("calendar.view.refresh", "Refresh")}
								title={t("calendar.view.refresh", "Refresh")}
							>
								<IconReload className="size-4" />
							</Button>
						)}
						<Tabs value={viewMode} onValueChange={(v) => handleViewModeChange(v as ViewMode)}>
							<TabsList>
								<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
								<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
								<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
								<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				</div>
			</div>

			{/* Calendar with internal scroll - styles applied via style tag above */}
			<div
				ref={calendarContainerRef}
				className="schedule-x-container flex-1 min-h-0 overflow-hidden"
			>
				<ScheduleXCalendar calendarApp={calendar} />
			</div>
		</div>
	);
}
