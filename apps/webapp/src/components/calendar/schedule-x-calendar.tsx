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

// Schedule-X CSS customizations (extracted to separate file for performance)
import "./schedule-x-calendar.css";
import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { DateTime } from "luxon";
import { useTheme } from "next-themes";

// Use global Temporal (polyfilled via temporal-polyfill/global in schedule-x-wrapper.tsx)
// Do NOT import from temporal-polyfill directly - Schedule-X requires the global instance
declare const Temporal: typeof import("temporal-polyfill").Temporal;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	calendarEventsToScheduleX,
	generateBreakEvents,
	getScheduleXCalendars,
} from "@/lib/calendar/schedule-x-adapter";
import type { CalendarEvent } from "@/lib/calendar/types";

export type ViewMode = "day" | "week" | "month" | "year";

interface ScheduleXCalendarWrapperProps {
	events: CalendarEvent[];
	isLoading?: boolean;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onEventClick?: (event: CalendarEvent) => void;
	onRangeChange?: (range: { start: Date; end: Date }) => void;
	onRefresh?: () => void;
}

// Map view mode to Schedule-X view names
const viewModeToScheduleX: Record<ViewMode, string> = {
	day: "day",
	week: "week",
	month: "month-grid",
	year: "month-grid", // Year view is handled separately, fallback to month-grid
};

export function ScheduleXCalendarWrapper({
	events,
	isLoading = false,
	viewMode,
	onViewModeChange,
	onEventClick,
	onRangeChange,
	onRefresh,
}: ScheduleXCalendarWrapperProps) {
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme === "dark";

	// Track current date for display
	const [currentDate, setCurrentDate] = useState<DateTime>(DateTime.now());

	// Create calendar plugins (must be stable references)
	const calendarControlsRef = useRef(createCalendarControlsPlugin());
	const calendarControls = calendarControlsRef.current;
	const currentTimePluginRef = useRef(createCurrentTimePlugin());
	const currentTimePlugin = currentTimePluginRef.current;
	const calendarContainerRef = useRef<HTMLDivElement>(null);

	// Convert events to Schedule-X format
	const baseScheduleXEvents = useMemo(() => calendarEventsToScheduleX(events), [events]);

	// Generate break events only for day/week view
	const scheduleXEvents = useMemo(() => {
		if (viewMode === "day" || viewMode === "week") {
			const breakEvents = generateBreakEvents(baseScheduleXEvents);
			return [...baseScheduleXEvents, ...breakEvents];
		}
		return baseScheduleXEvents;
	}, [baseScheduleXEvents, viewMode]);

	// Helper to convert Luxon DateTime to Temporal.PlainDate
	const luxonToPlainDate = useCallback((dt: DateTime): Temporal.PlainDate => {
		return Temporal.PlainDate.from({
			year: dt.year,
			month: dt.month,
			day: dt.day,
		});
	}, []);

	// Navigation functions
	const navigatePrevious = useCallback(() => {
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
	}, [viewMode, currentDate, calendarControls, luxonToPlainDate]);

	const navigateNext = useCallback(() => {
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
	}, [viewMode, currentDate, calendarControls, luxonToPlainDate]);

	const navigateToday = useCallback(() => {
		const today = DateTime.now();
		setCurrentDate(today);
		calendarControls.setDate(luxonToPlainDate(today));
	}, [calendarControls, luxonToPlainDate]);

	// Format the date range display based on view mode
	const dateRangeDisplay = useMemo(() => {
		switch (viewMode) {
			case "day":
				return currentDate.toFormat("EEEE, MMMM d, yyyy");
			case "week": {
				const weekStart = currentDate.startOf("week");
				const weekEnd = currentDate.endOf("week");
				if (weekStart.month === weekEnd.month) {
					return `${weekStart.toFormat("MMMM d")} - ${weekEnd.toFormat("d, yyyy")}`;
				}
				return `${weekStart.toFormat("MMM d")} - ${weekEnd.toFormat("MMM d, yyyy")}`;
			}
			case "month":
				return currentDate.toFormat("MMMM yyyy");
			default:
				return currentDate.toFormat("MMMM d, yyyy");
		}
	}, [viewMode, currentDate]);

	// Handle event click - Schedule-X passes the event object
	const handleEventClick = useCallback(
		(event: { id: string }) => {
			if (!onEventClick) return;

			const scheduleXEvent = scheduleXEvents.find((e) => e.id === event.id);
			if (scheduleXEvent?._eventData) {
				onEventClick(scheduleXEvent._eventData);
			}
		},
		[scheduleXEvents, onEventClick],
	);

	// Handle date range change from Schedule-X
	// Schedule-X returns Temporal objects or strings depending on context
	const handleRangeChange = useCallback(
		(range: { start: unknown; end: unknown }) => {
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
		},
		[onRangeChange],
	);

	// Create calendar instance with controls plugin
	const calendar = useCalendarApp({
		views: [createViewDay(), createViewWeek(), createViewMonthGrid(), createViewMonthAgenda()],
		defaultView: viewModeToScheduleX[viewMode],
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		events: scheduleXEvents as any,
		isDark,
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

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full min-h-[400px]">
				<div className="animate-pulse text-muted-foreground">Loading calendar...</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full min-h-[500px]">
			{/* Custom navigation header */}
			<div className="flex items-center justify-between gap-4 pb-3 mb-3">
				<div className="flex items-center gap-2">
					<Button variant="outline" size="icon" onClick={navigatePrevious}>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<Button variant="outline" size="icon" onClick={navigateNext}>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={navigateToday}>
						Today
					</Button>
					{onRefresh && (
						<Button variant="outline" size="icon" onClick={onRefresh} title="Refresh">
							<RefreshCw className="h-4 w-4" />
						</Button>
					)}
				</div>
				<h2 className="text-lg font-semibold">{dateRangeDisplay}</h2>
				<Tabs value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
					<TabsList>
						<TabsTrigger value="day">Day</TabsTrigger>
						<TabsTrigger value="week">Week</TabsTrigger>
						<TabsTrigger value="month">Month</TabsTrigger>
						<TabsTrigger value="year">Year</TabsTrigger>
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
