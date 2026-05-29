"use client";

import "temporal-polyfill/global";
import dynamic from "next/dynamic";
import { useTranslate } from "@tolgee/react";
import type { CalendarEvent, DailyWorkHoursSummaries } from "@/lib/calendar/types";
import type { ViewMode } from "./schedule-x-calendar";

function CalendarLoading() {
	const { t } = useTranslate();

	return (
		<div className="flex items-center justify-center h-full min-h-[400px]">
			<div className="animate-pulse text-muted-foreground">
				{t("calendar.view.loading", "Loading calendar…")}
			</div>
		</div>
	);
}

// Dynamically import Schedule-X calendar with no SSR
const ScheduleXCalendarWrapper = dynamic(
	() => import("./schedule-x-calendar").then((mod) => mod.ScheduleXCalendarWrapper),
	{
		ssr: false,
		loading: () => <CalendarLoading />,
	},
);

interface ScheduleXWrapperProps {
	events: CalendarEvent[];
	isLoading?: boolean;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onEventClick?: (event: CalendarEvent) => void;
	onRangeChange?: (range: { start: Date; end: Date }) => void;
	onTimeRangeSelect?: (range: { start: Date; end: Date }) => void;
	onRefresh?: () => void;
	workHoursData?: DailyWorkHoursSummaries;
}

/**
 * Wrapper component that ensures Temporal polyfill is loaded before Schedule-X
 */
export function ScheduleXWrapper(props: ScheduleXWrapperProps) {
	return <ScheduleXCalendarWrapper {...props} />;
}
