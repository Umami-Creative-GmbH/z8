"use client";

import { IconChevronLeft, IconChevronRight, IconLock, IconReload } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { WorkLocationIndicator } from "@/components/time-tracking/work-location-indicator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { todayCalendarDateKey } from "@/lib/calendar/date-keys";
import {
	buildMonthWorkSummary,
	type MonthWorkDay,
	type MonthWorkWeek,
	type WorkPeriodTotal,
} from "@/lib/calendar/month-work-summary";
import type {
	CalendarEvent,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
} from "@/lib/calendar/types";
import { formatSignedMinutes, formatTimeHours } from "@/lib/calendar/work-hours-summary";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import type { ViewMode } from "./schedule-x-calendar";

interface MonthWorkSummaryViewProps {
	monthDateKey: string;
	timeZone: string;
	events: CalendarEvent[];
	workHoursData: DailyWorkHoursSummaries;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onMonthChange: (dateKey: string) => void;
	onDayClick: (dateKey: string) => void;
	onRefresh: () => void;
	isSummaryLoading?: boolean;
	/** The viewed employee's closed months (`YYYY-MM`, #762); their days carry a lock. */
	closedMonths?: readonly string[];
}

type Translate = ReturnType<typeof useTranslate>["t"];

const WEEKDAY_REFERENCE_DATES = [2, 3, 4, 5, 6, 7, 8];
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

function getShortWeekdayFormatter(locale: string) {
	const cachedFormatter = weekdayFormatters.get(locale);
	if (cachedFormatter) {
		return cachedFormatter;
	}

	const formatter = Intl.DateTimeFormat(locale, { weekday: "short" });
	weekdayFormatters.set(locale, formatter);
	return formatter;
}

function formatHoursWithoutSuffix(minutes: number): string {
	return formatTimeHours(minutes).replace(/h$/, "");
}

function formatSignedMinutesWithoutSuffix(minutes: number): string {
	return formatSignedMinutes(minutes).replace(/h$/, "");
}

function getWeekdayNames(locale: string, weekStartDay: WeekStartDay): string[] {
	const formatter = getShortWeekdayFormatter(locale);
	const names = WEEKDAY_REFERENCE_DATES.map((day) => formatter.format(new Date(2000, 0, day)));

	return weekStartDay === "monday" ? [...names.slice(1), names[0]!] : names;
}

function getWorkStatusLabel(status: DailyWorkHoursStatus, t: Translate): string {
	switch (status) {
		case "met":
			return t("calendar.workStatus.requirementMet", "requirement met");
		case "over":
			return t("calendar.workStatus.overRequirement", "over requirement");
		case "under":
			return t("calendar.workStatus.underRequirement", "under requirement");
		case "missing":
			return t("calendar.workStatus.requiredHoursMissing", "required hours missing");
	}
}

function getEventBadgeClassName(type: CalendarEvent["type"]): string {
	switch (type) {
		case "holiday":
			return "border-amber-200 bg-amber-100 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";
		case "absence":
			return "border-blue-200 bg-blue-100 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200";
		case "work_period":
			return "border-muted bg-muted/70 text-muted-foreground";
		default:
			return "border-border bg-background text-muted-foreground";
	}
}

function getTotalClassName(status: WorkPeriodTotal["status"]): string {
	switch (status) {
		case "over":
			return "text-emerald-700 dark:text-emerald-400";
		case "met":
			return "text-foreground";
		case "under":
			return "text-destructive";
	}
}

function getDailyStatusClassName(status: DailyWorkHoursStatus): string {
	switch (status) {
		case "over":
			return "text-emerald-700 dark:text-emerald-400";
		case "met":
			return "text-foreground";
		case "under":
			return "text-destructive";
		case "missing":
			return "text-muted-foreground";
	}
}

function getDayLabel(day: MonthWorkDay, locale: string, t: Translate): string {
	const dateLabel = day.date
		.setLocale(locale)
		.toLocaleString(DateTime.DATE_HUGE);
	const summary = day.isActiveMonth ? day.workHoursSummary : null;
	const eventTitles = day.events.map((event) => event.title).join(", ");
	const eventText =
		day.events.length === 0
			? ""
			: ` ${t("calendar.monthSummary.dayEvents", "{count, plural, one {# event} other {# events}}: {titles}", { count: day.events.length, titles: eventTitles })}`;

	if (!summary) {
		return eventText ? `${dateLabel}.${eventText}` : dateLabel;
	}

	const { requirement } = summary;
	const summaryText = requirement
		? t(
				"calendar.monthSummary.dayLabel",
				"{date}: {actual} recorded, {required} required, {delta} {status}.",
				{
					date: dateLabel,
					actual: formatHoursWithoutSuffix(summary.actualMinutes),
					required: formatHoursWithoutSuffix(requirement.requiredMinutes),
					delta: formatSignedMinutesWithoutSuffix(requirement.deltaMinutes),
					status: getWorkStatusLabel(requirement.status, t),
				},
			)
		: t("calendar.monthSummary.recordedOnlyDayLabel", "{date}: {actual} recorded.", {
				date: dateLabel,
				actual: formatHoursWithoutSuffix(summary.actualMinutes),
			});
	const liveText = summary.includesLiveWork ? ` ${getLiveWorkLabel(t)}.` : "";

	return `${summaryText}${liveText}${eventText}`;
}

function getLiveWorkLabel(t: Translate): string {
	return t("calendar.requirements.includesRunningWork", "Includes running work");
}

/** Marks a total that still counts running work, like the running work block. */
function LiveWorkDot({ t }: { t: Translate }) {
	const label = getLiveWorkLabel(t);

	return (
		<span
			title={label}
			className="inline-flex size-1.5 shrink-0 rounded-full bg-red-500 motion-safe:animate-pulse"
		>
			<span className="sr-only">{label}</span>
		</span>
	);
}

function MonthTotalCard({ total, t }: { total: WorkPeriodTotal | null; t: Translate }) {
	return (
		<section
			className="rounded-lg border bg-card p-4 shadow-xs"
			aria-labelledby="month-work-total-title"
		>
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 id="month-work-total-title" className="font-medium text-sm">
						{t("calendar.monthSummary.monthTotal", "Month total")}
					</h3>
					<p className="mt-1 text-muted-foreground text-sm">
						{total
							? t(
									"calendar.monthSummary.totalDescription",
									"Recorded time compared with policy hours",
								)
							: t("calendar.monthSummary.emptyMonth", "No policy hours in this month")}
					</p>
				</div>
				{total ? (
					<div className="text-right">
						<p
							className={cn("font-semibold text-2xl tabular-nums", getTotalClassName(total.status))}
						>
							{formatSignedMinutesWithoutSuffix(total.deltaMinutes)}
						</p>
						<p className="mt-1 flex items-center justify-end gap-1.5 text-muted-foreground text-sm tabular-nums">
							{total.includesLiveWork ? <LiveWorkDot t={t} /> : null}
							<span>
								{formatHoursWithoutSuffix(total.actualMinutes)} /{" "}
								{formatHoursWithoutSuffix(total.requiredMinutes)}
							</span>
						</p>
					</div>
				) : null}
			</div>
		</section>
	);
}

function EventBadges({ events }: { events: CalendarEvent[] }) {
	const { t } = useTranslate();
	if (events.length === 0) return null;

	return (
		<div className="mt-2 flex flex-col gap-1">
			{events.slice(0, 2).map((event) => (
				<span
					key={event.id}
					className={cn(
						"flex min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-left font-medium text-[10px] leading-4",
						getEventBadgeClassName(event.type),
					)}
				>
					{event.type === "work_period" ? (
						<WorkLocationIndicator
							value={event.metadata.workLocationType}
							t={t}
						/>
					) : null}
					<span className="truncate">{event.title}</span>
				</span>
			))}
			{events.length > 2 ? (
				<span className="text-muted-foreground text-[10px]">+{events.length - 2}</span>
			) : null}
		</div>
	);
}

function TotalDisplay({
	total,
	t,
	compact = false,
}: {
	total: WorkPeriodTotal | null;
	t: Translate;
	compact?: boolean;
}) {
	if (!total) return <span className="text-muted-foreground">-</span>;

	return (
		<div className={cn("space-y-0.5", compact && "text-right")}>
			<p className={cn("font-semibold tabular-nums", getTotalClassName(total.status))}>
				{formatSignedMinutesWithoutSuffix(total.deltaMinutes)}
			</p>
			<p
				className={cn(
					"flex items-center gap-1 text-muted-foreground text-xs tabular-nums",
					compact && "justify-end",
				)}
			>
				{total.includesLiveWork ? <LiveWorkDot t={t} /> : null}
				<span>
					{formatHoursWithoutSuffix(total.actualMinutes)} /{" "}
					{formatHoursWithoutSuffix(total.requiredMinutes)}
				</span>
			</p>
		</div>
	);
}

function DayCell({
	day,
	locale,
	t,
	onDayClick,
	isClosed,
}: {
	day: MonthWorkDay;
	locale: string;
	t: Translate;
	onDayClick: (dateKey: string) => void;
	isClosed: boolean;
}) {
	const summary = day.isActiveMonth ? day.workHoursSummary : null;
	const requirement = summary?.requirement ?? null;
	const label = getDayLabel(day, locale, t);

	return (
		<button
			type="button"
			aria-label={label}
			onClick={() => onDayClick(day.dateKey)}
			className={cn(
				"min-h-32 rounded-md border bg-background p-2 text-left outline-none transition-colors",
				"hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
				!day.isActiveMonth && "bg-muted/30 text-muted-foreground opacity-75",
			)}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="flex items-center gap-1 font-medium text-sm tabular-nums">
					{day.date.day}
					{isClosed ? (
						<>
							<IconLock className="size-3.5 text-muted-foreground" aria-hidden="true" />
							<span className="sr-only">
								{t("calendar.monthSummary.closedDay", "In a closed month")}
							</span>
						</>
					) : null}
				</span>
				{requirement ? (
					<span className="sr-only">{getWorkStatusLabel(requirement.status, t)}</span>
				) : null}
			</div>
			{summary ? (
				<div className="mt-3 space-y-1">
					{requirement ? (
						<p
							className={cn(
								"font-semibold text-sm tabular-nums",
								getDailyStatusClassName(requirement.status),
							)}
						>
							{formatSignedMinutesWithoutSuffix(requirement.deltaMinutes)}
						</p>
					) : null}
					<p className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums">
						{summary.includesLiveWork ? <LiveWorkDot t={t} /> : null}
						<span>
							{formatHoursWithoutSuffix(summary.actualMinutes)}
							{requirement ? ` / ${formatHoursWithoutSuffix(requirement.requiredMinutes)}` : null}
						</span>
					</p>
				</div>
			) : null}
			<EventBadges events={day.events} />
		</button>
	);
}

function WeekRow({
	week,
	locale,
	t,
	onDayClick,
	closedMonths,
}: {
	week: MonthWorkWeek;
	locale: string;
	t: Translate;
	onDayClick: (dateKey: string) => void;
	closedMonths: ReadonlySet<string>;
}) {
	return (
		<div className="grid grid-cols-[48px_repeat(7,minmax(112px,1fr))_112px] gap-2">
			<div className="flex items-start justify-center rounded-md border bg-muted/40 px-2 py-3 font-medium text-muted-foreground text-xs tabular-nums">
				{week.weekNumber}
			</div>
			{week.days.map((day) => (
				<DayCell
					key={day.dateKey}
					day={day}
					locale={locale}
					t={t}
					onDayClick={onDayClick}
					isClosed={closedMonths.has(day.dateKey.slice(0, 7))}
				/>
			))}
			<div className="flex min-h-32 items-start justify-end rounded-md border bg-muted/30 p-3">
				<TotalDisplay total={week.total} t={t} compact />
			</div>
		</div>
	);
}

export function MonthWorkSummaryView({
	monthDateKey,
	timeZone,
	events,
	workHoursData,
	viewMode,
	onViewModeChange,
	onMonthChange,
	onDayClick,
	onRefresh,
	isSummaryLoading: _isSummaryLoading,
	closedMonths = [],
}: MonthWorkSummaryViewProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const weekStartDay = useWeekStartDay();
	const activeMonth = DateTime.fromISO(monthDateKey, { zone: "utc" }).startOf("month");
	const monthTitle = activeMonth.setLocale(locale).toFormat("LLLL yyyy");
	const weekdays = getWeekdayNames(locale, weekStartDay);
	const monthSummary = buildMonthWorkSummary({
		year: activeMonth.year,
		monthIndex: activeMonth.month - 1,
		weekStartDay,
		timezone: timeZone,
		workHoursData,
		events,
	});
	const closed = new Set(closedMonths);

	return (
		<div className="flex h-full flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => onMonthChange(activeMonth.minus({ months: 1 }).toISODate()!)}
						aria-label={t("calendar.monthSummary.previousMonth", "Previous month")}
					>
						<IconChevronLeft className="size-4" aria-hidden="true" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={() => onMonthChange(activeMonth.plus({ months: 1 }).toISODate()!)}
						aria-label={t("calendar.monthSummary.nextMonth", "Next month")}
					>
						<IconChevronRight className="size-4" aria-hidden="true" />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => onMonthChange(`${todayCalendarDateKey(timeZone).slice(0, 8)}01`)}
					>
						{t("calendar.view.today", "Today")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={onRefresh}
						aria-label={t("calendar.view.refresh", "Refresh")}
					>
						<IconReload className="size-4" aria-hidden="true" />
					</Button>
				</div>

				<Tabs
					value={viewMode}
					onValueChange={(value) => onViewModeChange(value as ViewMode)}
					className="w-full sm:w-auto"
				>
					<TabsList className="grid w-full grid-cols-4">
						<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
						<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
						<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
						<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="font-semibold text-xl tracking-tight">{monthTitle}</h2>
					<p className="mt-1 text-muted-foreground text-sm">
						{t("calendar.monthSummary.description", "Daily, weekly, and monthly policy hours")}
					</p>
				</div>
			</div>

			<MonthTotalCard total={monthSummary.monthTotal} t={t} />

			<div className="overflow-x-auto rounded-lg border bg-card p-3">
				<div className="min-w-[980px] space-y-2">
					<div className="grid grid-cols-[48px_repeat(7,minmax(112px,1fr))_112px] gap-2 px-1 text-muted-foreground text-xs">
						<div className="font-medium">{t("calendar.monthSummary.calendarWeek", "KW")}</div>
						{weekdays.map((weekday) => (
							<div key={weekday} className="font-medium">
								{weekday}
							</div>
						))}
						<div className="text-right font-medium">
							{t("calendar.monthSummary.weekSum", "Sum")}
						</div>
					</div>
					{monthSummary.weeks.map((week) => (
						<WeekRow
							key={`${week.weekNumber}-${week.days[0]?.dateKey}`}
							week={week}
							locale={locale}
							t={t}
							onDayClick={onDayClick}
							closedMonths={closed}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
