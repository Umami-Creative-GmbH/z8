"use client";

// Temporal polyfill must be imported before Schedule-X
import "temporal-polyfill/global";

import { createViewMonthGrid, createViewWeek } from "@schedule-x/calendar";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { ScheduleXCalendar, useCalendarApp } from "@schedule-x/react";
import "@schedule-x/theme-default/dist/index.css";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import type { DateRange, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { toScheduleXLocale } from "@/lib/calendar/schedule-x-locale";
import { parsePlainDate, type ZonedDateTime } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import { ShiftDetailsPanel } from "../shifts/shift-details-panel";
import {
	calendarRangeToDateRange,
	employeeScheduleWeek,
	employeeShiftEvent,
} from "./employee-schedule-utils";
import { EmployeeShiftAgenda } from "./employee-shift-agenda";
import { useShiftSchedulerData } from "./use-shift-scheduler-data";

interface EmployeeShiftScheduleProps {
	organizationId: string;
	organizationTimezone: string;
	/** Opens the schedule on the week of this calendar date (YYYY-MM-DD). */
	focusDate: string | null;
}

/**
 * An employee's own published shifts. Wide screens keep the week and month calendar with its own
 * navigation; at phone width a day-by-day list moves a week at a time. Days are the organization's.
 */
export function EmployeeShiftSchedule({
	organizationId,
	organizationTimezone,
	focusDate,
}: EmployeeShiftScheduleProps) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme === "dark";
	const isMobile = useIsMobile();
	const weekStartDay = useWeekStartDay();
	const today = Temporal.Now.plainDateISO(parseIanaTimeZone(organizationTimezone));
	const [anchorKey, setAnchorKey] = useState(() => focusDate ?? today.toString());
	const week = employeeScheduleWeek(parsePlainDate(anchorKey), weekStartDay);
	// What the calendar shows after its own navigation; until then, the anchor's week.
	const [calendarRange, setCalendarRange] = useState<DateRange | null>(null);
	const [selectedShift, setSelectedShift] = useState<ShiftWithRelations | null>(null);
	const [calendarControls] = useState(() => createCalendarControlsPlugin());

	const { shifts, shiftsLoading, shiftsFailed } = useShiftSchedulerData({
		organizationId,
		organizationTimezone,
		dateRange: !isMobile && calendarRange ? calendarRange : week.dateRange,
		isManager: false,
	});

	// Schedule-X keeps the callbacks of its first render, so the click handler reads shifts here.
	const shiftsRef = useRef(shifts);
	useEffect(() => {
		shiftsRef.current = shifts;
	}, [shifts]);

	const moveWeek = (weeks: number) =>
		setAnchorKey(parsePlainDate(anchorKey).add({ weeks }).toString());

	const calendar = useCalendarApp({
		views: [createViewWeek(), createViewMonthGrid()],
		selectedDate: parsePlainDate(anchorKey),
		timezone: organizationTimezone,
		firstDayOfWeek: weekStartDay === "monday" ? 1 : 7,
		locale: toScheduleXLocale(locale),
		isResponsive: false,
		events: [],
		isDark,
		calendars: {
			published: {
				colorName: "published",
				lightColors: { main: "#3b82f6", container: "#dbeafe", onContainer: "#1e40af" },
				darkColors: { main: "#60a5fa", container: "#1e3a8a", onContainer: "#bfdbfe" },
			},
		},
		plugins: [calendarControls],
		callbacks: {
			onEventClick: (event: { id: string | number }) => {
				setSelectedShift(shiftsRef.current.find((shift) => shift.id === event.id) ?? null);
			},
			onRangeUpdate: (range: { start: ZonedDateTime; end: ZonedDateTime }) => {
				setCalendarRange(calendarRangeToDateRange(range));
				setAnchorKey(range.start.toPlainDate().toString());
			},
		},
	});

	const shiftTitle = t("scheduling:scheduling.mySchedule.shift", "Shift");
	const calendarEvents = shifts.map((shift) =>
		employeeShiftEvent(shift, organizationTimezone, shiftTitle),
	);

	useEffect(() => {
		calendar?.events.set(calendarEvents);
	}, [calendar, calendarEvents]);

	useEffect(() => {
		calendar?.setTheme(isDark ? "dark" : "light");
	}, [calendar, isDark]);

	// Coming back from phone width, open the calendar on the week the list showed.
	const showAnchorInCalendar = useEffectEvent(() => {
		calendarControls.setDate(parsePlainDate(anchorKey));
	});
	useEffect(() => {
		if (calendar && !isMobile) showAnchorInCalendar();
	}, [calendar, isMobile]);

	if (!isMobile) {
		return (
			<div className="flex h-[calc(100vh-200px)] flex-col gap-4">
				{shiftsFailed && <LoadFailedNotice />}
				<div className="relative min-h-0 flex-1 overflow-hidden">
					<ScheduleXCalendar calendarApp={calendar} />
					{shiftsLoading && (
						<div
							className="absolute inset-0 flex items-center justify-center bg-background/60"
							role="status"
						>
							<span className="animate-pulse text-muted-foreground motion-reduce:animate-none">
								{t("scheduling:scheduling.scheduler.loading", "Loading schedule...")}
							</span>
						</div>
					)}
				</div>
				<ShiftDetailsPanel
					open={selectedShift !== null}
					onOpenChange={(open) => {
						if (!open) setSelectedShift(null);
					}}
					shift={selectedShift}
					organizationTimezone={organizationTimezone}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => moveWeek(-1)}
						aria-label={t("scheduling:scheduling.mySchedule.previousWeek", "Previous week")}
					>
						<IconChevronLeft className="size-4" aria-hidden="true" />
					</Button>
					<Button type="button" variant="outline" onClick={() => setAnchorKey(today.toString())}>
						{t("scheduling:scheduling.mySchedule.today", "Today")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => moveWeek(1)}
						aria-label={t("scheduling:scheduling.mySchedule.nextWeek", "Next week")}
					>
						<IconChevronRight className="size-4" aria-hidden="true" />
					</Button>
				</div>
				<h2 className="font-medium text-sm tabular-nums" aria-live="polite">
					{formatPlainDate(week.days[0], locale, "monthDay")} –{" "}
					{formatPlainDate(week.days[6], locale, "dateMedium")}
				</h2>
			</div>

			{shiftsFailed ? (
				// Without loaded shifts the days would wrongly read as free.
				<LoadFailedNotice />
			) : (
				<EmployeeShiftAgenda
					days={week.days}
					shifts={shifts}
					loading={shiftsLoading}
					today={today}
					focusDate={focusDate}
					organizationTimezone={organizationTimezone}
					onSelectShift={setSelectedShift}
					onPreviousWeek={() => moveWeek(-1)}
					onNextWeek={() => moveWeek(1)}
				/>
			)}

			<ShiftDetailsPanel
				open={selectedShift !== null}
				onOpenChange={(open) => {
					if (!open) setSelectedShift(null);
				}}
				shift={selectedShift}
				organizationTimezone={organizationTimezone}
			/>
		</div>
	);
}

function LoadFailedNotice() {
	const { t } = useTranslate();
	return (
		<p className="text-destructive text-sm" role="alert">
			{t(
				"scheduling:scheduling.mySchedule.loadFailed",
				"Your shifts could not be loaded. Please try again later.",
			)}
		</p>
	);
}
