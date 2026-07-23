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
import { useTolgee, useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUserTimezone, useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { addCalendarDateKey, todayCalendarDateKey } from "@/lib/calendar/date-keys";
import {
	calendarEventsToScheduleX,
	generateBreakEvents,
	getScheduleXCalendars,
} from "@/lib/calendar/schedule-x-adapter";
import { toScheduleXLocale } from "@/lib/calendar/schedule-x-locale";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { getWeekBounds } from "@/lib/user-preferences/week-start";
import { ScheduleXCalendarHeader } from "./schedule-x-calendar-header";
import {
	filterEventsForScheduleXView,
	resolveClickableCalendarEvent,
} from "./schedule-x-calendar-utils";
import { useScheduleXDomLifecycle } from "./use-schedule-x-dom-lifecycle";

export type ViewMode = "day" | "week" | "month" | "year";

interface ScheduleXCalendarWrapperProps {
	events: CalendarEvent[];
	timeZone?: string;
	isLoading?: boolean;
	viewMode: ViewMode;
	initialDateKey?: string;
	onViewModeChange: (mode: ViewMode) => void;
	onEventClick?: (event: CalendarEvent) => void;
	clockOutAllowedWorkPeriodIds?: ReadonlySet<string>;
	onRunningPeriodClockOutRequest?: (event: CalendarEvent) => void;
	onRangeChange?: (range: { startDateKey: string; endDateKey: string }) => void;
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

export function ScheduleXCalendarWrapper({
	events,
	timeZone: explicitTimeZone,
	isLoading = false,
	viewMode,
	initialDateKey,
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
	const scheduleXFirstDayOfWeek = weekStartDay === "monday" ? 1 : 7;
	const viewerTimeZone = useUserTimezone();
	const timeZone = explicitTimeZone ?? viewerTimeZone;
	const isDark = resolvedTheme === "dark";

	const nextInitialDateKey = initialDateKey ?? todayCalendarDateKey(timeZone);
	const [currentDateKey, setCurrentDateKey] = useState(() => nextInitialDateKey);
	const [previousInitialDateKey, setPreviousInitialDateKey] = useState(() => nextInitialDateKey);
	if (nextInitialDateKey !== previousInitialDateKey) {
		setPreviousInitialDateKey(nextInitialDateKey);
		setCurrentDateKey(nextInitialDateKey);
	}
	const currentDate = DateTime.fromISO(currentDateKey, { zone: timeZone });
	const [runningPeriodNow, setRunningPeriodNow] = useState<Date>(() => new Date());

	// Create calendar plugins (must be stable references)
	const [calendarControls] = useState(() => createCalendarControlsPlugin());
	const calendarContainerRef = useRef<HTMLDivElement>(null);

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

	// Navigation functions
	const navigatePrevious = () => {
		let duration: Temporal.DurationLike;
		switch (viewMode) {
			case "day":
				duration = { days: -1 };
				break;
			case "week":
				duration = { weeks: -1 };
				break;
			case "month":
				duration = { months: -1 };
				break;
			default:
				duration = { days: -1 };
		}
		const newDateKey = addCalendarDateKey(currentDateKey, duration);
		setCurrentDateKey(newDateKey);
		calendarControls.setDate(Temporal.PlainDate.from(newDateKey));
	};

	const navigateNext = () => {
		let duration: Temporal.DurationLike;
		switch (viewMode) {
			case "day":
				duration = { days: 1 };
				break;
			case "week":
				duration = { weeks: 1 };
				break;
			case "month":
				duration = { months: 1 };
				break;
			default:
				duration = { days: 1 };
		}
		const newDateKey = addCalendarDateKey(currentDateKey, duration);
		setCurrentDateKey(newDateKey);
		calendarControls.setDate(Temporal.PlainDate.from(newDateKey));
	};

	const navigateToday = () => {
		const today = todayCalendarDateKey(timeZone);
		setCurrentDateKey(today);
		calendarControls.setDate(Temporal.PlainDate.from(today));
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

		onRangeChange({
			startDateKey: String(range.start).slice(0, 10),
			endDateKey: String(range.end).slice(0, 10),
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
		selectedDate: Temporal.PlainDate.from(currentDateKey),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		events: scheduleXEvents as any,
		isDark,
		isResponsive: false,
		locale: scheduleXLocale,
		firstDayOfWeek: scheduleXFirstDayOfWeek,
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
		if (!calendar) return;
		calendarControls.setFirstDayOfWeek(scheduleXFirstDayOfWeek);
		calendarControls.setDate(Temporal.PlainDate.from(currentDateKey));
	}, [calendar, calendarControls, currentDateKey, scheduleXFirstDayOfWeek]);

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

	useScheduleXDomLifecycle({
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
	});

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
			<ScheduleXCalendarHeader
				dateRangeDisplay={dateRangeDisplay}
				mobileDateRangeDisplay={mobileDateRangeDisplay}
				viewMode={viewMode}
				onNavigatePrevious={navigatePrevious}
				onNavigateNext={navigateNext}
				onNavigateToday={navigateToday}
				onViewModeChange={handleViewModeChange}
				onRefresh={onRefresh}
				t={t}
			/>

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
