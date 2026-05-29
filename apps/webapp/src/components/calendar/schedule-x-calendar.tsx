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

import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";

// Schedule-X CSS customizations must load after the default theme.
import "./schedule-x-calendar.css";
import { IconChevronLeft, IconChevronRight, IconReload } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";

import { useEffect, useRef, useState } from "react";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	calendarEventsToScheduleX,
	generateBreakEvents,
	getScheduleXCalendars,
	type ScheduleXEvent,
} from "@/lib/calendar/schedule-x-adapter";
import { toScheduleXLocale } from "@/lib/calendar/schedule-x-locale";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";
import { getWeekBounds } from "@/lib/user-preferences/week-start";
import { useOrganizationTimezone } from "@/stores/organization-settings-store";
import { buildRequirementHeaderContent } from "./daily-requirement-strip";

export type ViewMode = "day" | "week" | "month" | "year";

interface ScheduleXCalendarWrapperProps {
	events: CalendarEvent[];
	isLoading?: boolean;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onEventClick?: (event: CalendarEvent) => void;
	onRangeChange?: (range: { start: Date; end: Date }) => void;
	onRefresh?: () => void;
	workHoursData?: DailyWorkHoursSummaries;
}

// Map view mode to Schedule-X view names
const viewModeToScheduleX: Record<ViewMode, string> = {
	day: "day",
	week: "week",
	month: "month-grid",
	year: "month-grid", // Year view is handled separately, fallback to month-grid
};

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

function getHeaderCells(container: HTMLDivElement): HTMLElement[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(
			".sx__week-header .sx__week-grid__date, .sx__week-header .sx__date-grid__date, .sx__week-header [data-time-grid-date]",
		),
	);
}

function clearRequirementHeaderContent(container: HTMLDivElement) {
	for (const node of container.querySelectorAll(".z8-requirement-header-summary")) {
		node.remove();
	}
}

export function ScheduleXCalendarWrapper({
	events,
	isLoading = false,
	viewMode,
	onViewModeChange,
	onEventClick,
	onRangeChange,
	onRefresh,
	workHoursData = new Map(),
}: ScheduleXCalendarWrapperProps) {
	const { resolvedTheme } = useTheme();
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const scheduleXLocale = toScheduleXLocale(locale);
	const weekStartDay = useWeekStartDay();
	const timeZone = useOrganizationTimezone();
	const isDark = resolvedTheme === "dark";

	// Track current date for display
	const [currentDate, setCurrentDate] = useState<DateTime>(() => DateTime.now());
	const [runningPeriodNow, setRunningPeriodNow] = useState<Date>(() => new Date());

	// Create calendar plugins (must be stable references)
	const [calendarControls] = useState(() => createCalendarControlsPlugin());
	const [currentTimePlugin] = useState(() => createCurrentTimePlugin());
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

	// Create calendar instance with controls plugin
	const calendar = useCalendarApp({
		views: [createViewDay(), createViewWeek(), createViewMonthGrid(), createViewMonthAgenda()],
		defaultView: viewModeToScheduleX[viewMode],
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		events: scheduleXEvents as any,
		isDark,
		locale: scheduleXLocale,
		calendars: getScheduleXCalendars(),
		plugins: [createEventModalPlugin(), calendarControls, currentTimePlugin],
		callbacks: {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onEventClick: handleEventClick as any,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onRangeUpdate: handleRangeChange as any,
		},
	});

	// Update view when viewMode changes using calendar controls plugin
	useEffect(() => {
		if (calendar && viewMode !== "year") {
			const scheduleXView = viewModeToScheduleX[viewMode];
			calendarControls.setView(scheduleXView);
		}
	}, [calendar, viewMode, calendarControls]);

	useEffect(() => {
		if (!hasVisibleRunningPeriod) return;

		const interval = window.setInterval(() => {
			setRunningPeriodNow(new Date());
		}, 60_000);

		setRunningPeriodNow(new Date());
		return () => window.clearInterval(interval);
	}, [hasVisibleRunningPeriod]);

	// Update events when they change
	useEffect(() => {
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

	// Update dark mode when theme changes
	useEffect(() => {
		if (calendar) {
			calendar.setTheme(isDark ? "dark" : "light");
		}
	}, [calendar, isDark]);

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

		const frame = window.requestAnimationFrame(() => {
			clearRequirementHeaderContent(container);
			const headerCells = getHeaderCells(container);

			for (const [index, date] of visibleRequirementDates.entries()) {
				const headerCell = headerCells[index];
				if (!headerCell) continue;

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
		});

		return () => {
			window.cancelAnimationFrame(frame);
			clearRequirementHeaderContent(container);
		};
	}, [t, viewMode, visibleRequirementDates, workHoursData]);

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
			<div className="flex items-center justify-between gap-4 pb-3 mb-3">
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
				<Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
					<TabsList>
						<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
						<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
						<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
						<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
					</TabsList>
				</Tabs>
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
