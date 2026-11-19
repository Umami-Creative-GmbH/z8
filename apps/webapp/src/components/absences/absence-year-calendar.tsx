"use client";

import { IconPlus } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { type RefObject, useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
	AbsenceWithCategory,
	AbsenceWithDays,
	DayPeriod,
	Holiday,
} from "@/lib/absences/types";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import { holidayCalendarDate } from "@/lib/holidays/recurrence";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "./category-badge";
import { DeputyName } from "./deputy-name";
import { OwnAbsenceEntryActions, useOwnAbsenceActions } from "./own-absence-actions";
import { SickNoteMarker } from "./sick-notes/sick-note-marker";

type AbsenceStatus = AbsenceWithCategory["status"];
/** What a day shows, in order of precedence: an absence's status, else a holiday. */
type DayState = AbsenceStatus | "holiday";

interface DayAbsence {
	id: string;
	categoryName: string;
	status: AbsenceStatus;
	/** The part of this day the absence covers. */
	period: DayPeriod;
	absence: AbsenceWithDays;
}

interface CalendarDay {
	absences: DayAbsence[];
	holidays: string[];
}

interface AbsenceYearCalendarProps {
	absences: AbsenceWithDays[];
	holidays: Holiday[];
	year: number;
	currentDate: string;
	/**
	 * Starts a request from a calendar day (YYYY-MM-DD). With it, a day with an approved or pending
	 * absence shows that absence and its actions instead (#1863); needs `OwnAbsenceActionsProvider`.
	 */
	onRequestDay?: (date: string) => void;
}

/** A day with an approved or pending absence shows its details; other days start a request. */
function hasActiveAbsence(day: CalendarDay | undefined): day is CalendarDay {
	return day?.absences.some((absence) => absence.status !== "rejected") ?? false;
}

const STATUS_PRECEDENCE: Record<AbsenceStatus, number> = {
	approved: 0,
	pending: 1,
	rejected: 2,
};

/** Fill and outline per state; each state also has a text label in the legend and day label. */
const DAY_STATE_CLASS: Record<DayState, string> = {
	approved: "bg-primary/15 font-medium text-foreground",
	pending:
		"bg-amber-500/15 font-medium text-foreground ring-1 ring-inset ring-amber-500/70",
	rejected:
		"text-muted-foreground line-through decoration-destructive/70 ring-1 ring-inset ring-destructive/40",
	holiday: "bg-muted font-medium text-foreground",
};

const LEGEND_SWATCH_CLASS: Record<DayState, string> = {
	approved: "bg-primary/15",
	pending: "bg-amber-500/15 ring-1 ring-inset ring-amber-500/70",
	rejected: "ring-1 ring-inset ring-destructive/40",
	holiday: "bg-muted",
};

/** The part of `day` an absence covers; mirrors the day count in `absence-days.ts`. */
function periodOnDay(
	absence: AbsenceWithCategory,
	day: Temporal.PlainDate,
	start: Temporal.PlainDate,
	end: Temporal.PlainDate,
): DayPeriod {
	if (start.equals(end)) {
		return absence.startPeriod === absence.endPeriod && absence.startPeriod
			? absence.startPeriod
			: "full_day";
	}
	if (day.equals(start) && absence.startPeriod === "pm") return "pm";
	if (day.equals(end) && absence.endPeriod === "am") return "am";
	return "full_day";
}

/**
 * The calendar days of one year, keyed YYYY-MM-DD. Absence dates are plain calendar days and
 * holidays are stored at UTC midnight, so neither depends on the viewer's device timezone.
 */
function buildCalendarDays(
	absences: AbsenceWithDays[],
	holidays: Holiday[],
	year: number,
): Map<string, CalendarDay> {
	const days = new Map<string, CalendarDay>();
	const dayAt = (key: string) => {
		let day = days.get(key);
		if (!day) {
			day = { absences: [], holidays: [] };
			days.set(key, day);
		}
		return day;
	};
	const firstDay = Temporal.PlainDate.from({ year, month: 1, day: 1 });
	const lastDay = Temporal.PlainDate.from({ year, month: 12, day: 31 });

	for (const absence of absences) {
		const start = Temporal.PlainDate.from(absence.startDate);
		const end = Temporal.PlainDate.from(absence.endDate);
		let day =
			Temporal.PlainDate.compare(start, firstDay) < 0 ? firstDay : start;
		const last = Temporal.PlainDate.compare(end, lastDay) > 0 ? lastDay : end;
		while (Temporal.PlainDate.compare(day, last) <= 0) {
			dayAt(day.toString()).absences.push({
				id: absence.id,
				categoryName: absence.category.name,
				status: absence.status,
				period: periodOnDay(absence, day, start, end),
				absence,
			});
			day = day.add({ days: 1 });
		}
	}
	for (const holiday of holidays) {
		if (!holiday.name) continue;
		const date = holidayCalendarDate(new Date(holiday.startDate));
		if (date.year === year) dayAt(date.toString()).holidays.push(holiday.name);
	}
	for (const day of days.values()) {
		day.absences.sort(
			(a, b) => STATUS_PRECEDENCE[a.status] - STATUS_PRECEDENCE[b.status],
		);
	}
	return days;
}

function dayStateOf(day: CalendarDay | undefined): DayState | null {
	if (!day) return null;
	const absence = day.absences[0];
	if (absence) return absence.status;
	return day.holidays.length > 0 ? "holiday" : null;
}

function useDayCopy() {
	const { t } = useTranslate();
	const status = (value: AbsenceStatus) =>
		value === "approved"
			? t("absences.calendar.legend.approved", "Approved")
			: value === "pending"
				? t("absences.calendar.legend.pending", "Pending")
				: t("absences.calendar.legend.rejected", "Rejected");
	const period = (value: DayPeriod) =>
		value === "am"
			? t("absences.change.morning", "Morning")
			: value === "pm"
				? t("absences.change.afternoon", "Afternoon")
				: null;
	const describeAbsence = (absence: DayAbsence) =>
		[absence.categoryName, status(absence.status), period(absence.period)]
			.filter(Boolean)
			.join(" · ");
	return { t, status, period, describeAbsence };
}

/** The selected day's absences, holidays and actions (#1863). */
function AbsenceDayDetails({
	date,
	day,
	currentDate,
	locale,
	headingId,
	headingRef,
	onClose,
	onRequestDay,
}: {
	date: Temporal.PlainDate;
	day: CalendarDay;
	currentDate: string;
	locale: string;
	headingId: string;
	headingRef: RefObject<HTMLHeadingElement | null>;
	onClose: () => void;
	onRequestDay: (date: string) => void;
}) {
	const { t, status, period } = useDayCopy();
	const actions = useOwnAbsenceActions();

	return (
		<div className="space-y-3">
			{/* Takes focus on open: one Escape then closes the popover, not an action's tooltip. */}
			<h3
				id={headingId}
				ref={headingRef}
				tabIndex={-1}
				className="font-medium text-sm outline-none"
			>
				{formatPlainDate(date, locale, "weekdayDateLong")}
			</h3>
			<ul className="space-y-3">
				{day.absences.map(({ absence, status: dayStatus, period: dayPeriod }) => {
					const marker = actions.sickNoteMarkers[absence.id];
					const periodLabel = period(dayPeriod);
					return (
						<li
							key={absence.id}
							className="space-y-1.5 border-t pt-3 text-xs first:border-t-0 first:pt-0"
						>
							<div className="flex flex-wrap items-center gap-1.5">
								<CategoryBadge
									name={absence.category.name}
									type={absence.category.type}
									color={absence.category.color}
								/>
								<span>{status(dayStatus)}</span>
								{periodLabel ? (
									<span className="text-muted-foreground">{periodLabel}</span>
								) : null}
							</div>
							{absence.deputy ? (
								<div>
									<span className="text-muted-foreground">
										{t("absences.deputy.label", "Deputy")}
									</span>{" "}
									<DeputyName deputy={absence.deputy} className="font-medium" />
								</div>
							) : null}
							{absence.category.type === "sick" ? (
								<SickNoteMarker
									count={marker?.count ?? 0}
									onOpen={
										marker?.viewable
											? () => {
													onClose();
													actions.openSickNotes(absence);
												}
											: undefined
									}
								/>
							) : null}
							{actions.hasPendingChange(absence.id) ? (
								<p className="text-muted-foreground">
									{t("absences.table.changePending", "Change request pending")}
								</p>
							) : null}
							<OwnAbsenceEntryActions
								absence={absence}
								currentDate={currentDate}
								onAction={onClose}
							/>
						</li>
					);
				})}
			</ul>
			{day.holidays.length > 0 ? (
				<ul className="space-y-1 border-t pt-3 text-xs">
					{day.holidays.map((holiday) => (
						<li key={holiday}>{holiday}</li>
					))}
				</ul>
			) : null}
			<Button
				variant="outline"
				size="sm"
				className="w-full gap-2"
				onClick={() => {
					onClose();
					onRequestDay(date.toString());
				}}
			>
				<IconPlus className="size-4" aria-hidden="true" />
				{t(
					"absences.calendar.requestAnotherAbsence",
					"Request another absence from this day",
				)}
			</Button>
		</div>
	);
}

function MiniMonth({
	year,
	month,
	monthName,
	weekdays,
	weekStartDay,
	calendarDays,
	currentDate,
	locale,
	onRequestDay,
	openDay,
	onOpenDayChange,
}: {
	year: number;
	/** 1–12 */
	month: number;
	monthName: string;
	weekdays: string[];
	weekStartDay: WeekStartDay;
	calendarDays: Map<string, CalendarDay>;
	currentDate: string;
	locale: string;
	onRequestDay?: (date: string) => void;
	/** The day whose details popover is open, as YYYY-MM-DD. */
	openDay: string | null;
	onOpenDayChange: (date: string | null) => void;
}) {
	const { t, describeAbsence } = useDayCopy();
	// One popover is open at a time, so one heading ref serves the month.
	const popoverHeadingRef = useRef<HTMLHeadingElement>(null);
	const firstDay = Temporal.PlainDate.from({ year, month, day: 1 });
	const offset =
		weekStartDay === "monday" ? firstDay.dayOfWeek - 1 : firstDay.dayOfWeek % 7;
	const days = Array.from({ length: firstDay.daysInMonth }, (_, index) =>
		firstDay.add({ days: index }),
	);
	const headingId = `absence-calendar-${year}-${month}`;

	return (
		<section className="min-w-0" aria-labelledby={headingId}>
			<h3 id={headingId} className="mb-2 px-1 font-medium text-sm">
				{monthName}
			</h3>
			<div
				className="mb-1 grid grid-cols-7 gap-0.5 text-center"
				aria-hidden="true"
			>
				{weekdays.map((weekday) => (
					<div key={weekday} className="font-medium text-muted-foreground text-xs">
						{weekday}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7 gap-0.5">
				{Array.from({ length: offset }, (_, index) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: fixed leading blanks of one month
						key={`blank-${index}`}
						className="aspect-square"
					/>
				))}
				{days.map((date) => {
					const dateKey = date.toString();
					const day = calendarDays.get(dateKey);
					const state = dayStateOf(day);
					const isToday = dateKey === currentDate;
					const isWeekend = date.dayOfWeek >= 6;
					const details = [
						...new Set([
							...(day?.absences.map(describeAbsence) ?? []),
							...(day?.holidays ?? []),
						]),
					];
					const label = [
						isToday ? t("common.today", "Today") : null,
						formatPlainDate(date, locale, "weekdayDateLong"),
						...details,
					]
						.filter(Boolean)
						.join(", ");
					const showsDetails = Boolean(onRequestDay) && hasActiveAbsence(day);

					const dayButton = (
						<button
							type="button"
							data-date={dateKey}
							data-state={state ?? "none"}
							aria-label={label}
							aria-current={isToday ? "date" : undefined}
							// A day with details opens its popover instead (#1863).
							onClick={
								showsDetails ? undefined : () => onRequestDay?.(dateKey)
							}
							className={cn(
								"relative flex aspect-square w-full items-center justify-center rounded-sm text-xs tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
								isWeekend && !state && "text-muted-foreground",
								state && DAY_STATE_CLASS[state],
								isToday &&
									"font-semibold outline outline-2 outline-offset-1 outline-primary",
							)}
						>
							<span aria-hidden="true">{date.day}</span>
							{day && day.holidays.length > 0 && state !== "holiday" ? (
								// A holiday under an absence keeps a mark of its own.
								<span
									aria-hidden="true"
									className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-foreground/60"
								/>
							) : null}
							{day?.absences[0] && day.absences[0].period !== "full_day" ? (
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-0.5 size-1 rounded-full bg-foreground/60",
										day.absences[0].period === "am" ? "left-0.5" : "right-0.5",
									)}
								/>
							) : null}
						</button>
					);

					if (showsDetails && onRequestDay) {
						// A popover, not a tooltip: the employee acts on the absence from it.
						const popoverHeadingId = `absence-day-${dateKey}`;
						return (
							<Popover
								key={dateKey}
								open={openDay === dateKey}
								onOpenChange={(open) => onOpenDayChange(open ? dateKey : null)}
							>
								<PopoverTrigger asChild>{dayButton}</PopoverTrigger>
								<PopoverContent
									className="w-80 max-w-[calc(100vw-2rem)]"
									aria-labelledby={popoverHeadingId}
									initialFocus={popoverHeadingRef}
								>
									<AbsenceDayDetails
										date={date}
										day={day}
										currentDate={currentDate}
										locale={locale}
										headingId={popoverHeadingId}
										headingRef={popoverHeadingRef}
										onClose={() => onOpenDayChange(null)}
										onRequestDay={onRequestDay}
									/>
								</PopoverContent>
							</Popover>
						);
					}
					if (details.length === 0) {
						return <div key={dateKey}>{dayButton}</div>;
					}
					return (
						<Tooltip key={dateKey}>
							<TooltipTrigger asChild>{dayButton}</TooltipTrigger>
							<TooltipContent className="max-w-xs">
								<div className="space-y-1">
									<div className="font-medium">
										{formatPlainDate(date, locale, "weekdayMonthDay")}
									</div>
									{details.map((detail) => (
										<div key={detail}>{detail}</div>
									))}
								</div>
							</TooltipContent>
						</Tooltip>
					);
				})}
			</div>
		</section>
	);
}

/** The employee's absences and holidays for one calendar year, one mini month per month. */
export function AbsenceYearCalendar({
	absences,
	holidays,
	year,
	currentDate,
	onRequestDay,
}: AbsenceYearCalendarProps) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() || "en";
	const weekStartDay = useWeekStartDay();
	const [openDay, setOpenDay] = useState<string | null>(null);

	const monthNames = [
		t("common.months.january", "January"),
		t("common.months.february", "February"),
		t("common.months.march", "March"),
		t("common.months.april", "April"),
		t("common.months.may", "May"),
		t("common.months.june", "June"),
		t("common.months.july", "July"),
		t("common.months.august", "August"),
		t("common.months.september", "September"),
		t("common.months.october", "October"),
		t("common.months.november", "November"),
		t("common.months.december", "December"),
	];
	const sundayFirst = [
		t("common.weekdays.su", "Su"),
		t("common.weekdays.mo", "Mo"),
		t("common.weekdays.tu", "Tu"),
		t("common.weekdays.we", "We"),
		t("common.weekdays.th", "Th"),
		t("common.weekdays.fr", "Fr"),
		t("common.weekdays.sa", "Sa"),
	];
	const weekdays =
		weekStartDay === "monday"
			? [...sundayFirst.slice(1), sundayFirst[0]]
			: sundayFirst;
	const calendarDays = buildCalendarDays(absences, holidays, year);
	const legend: Array<{ state: DayState; label: string }> = [
		{
			state: "approved",
			label: t("absences.calendar.legend.approved", "Approved"),
		},
		{ state: "pending", label: t("absences.calendar.legend.pending", "Pending") },
		{
			state: "rejected",
			label: t("absences.calendar.legend.rejected", "Rejected"),
		},
		{ state: "holiday", label: t("absences.calendar.legend.holiday", "Holiday") },
	];

	return (
		<div className="rounded-xl border bg-card p-4">
			<div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
				<ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
					{legend.map((item) => (
						<li key={item.state} className="flex items-center gap-1.5">
							<span
								aria-hidden="true"
								className={cn(
									"size-3 rounded-sm",
									LEGEND_SWATCH_CLASS[item.state],
								)}
							/>
							{item.label}
						</li>
					))}
					<li className="flex items-center gap-1.5">
						<span
							aria-hidden="true"
							className="relative size-3 rounded-sm border"
						>
							<span className="absolute top-px left-px size-1 rounded-full bg-foreground/60" />
						</span>
						{t("absences.calendar.legend.halfDay", "Half day")}
					</li>
				</ul>
				{onRequestDay ? (
					<p className="text-muted-foreground">
						{t(
							"absences.calendar.selectDayDetailsHint",
							"Select a day to request an absence from it. A day with an approved or pending absence shows its details instead.",
						)}
					</p>
				) : null}
			</div>

			<TooltipProvider delayDuration={150}>
				<div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-5 min-[420px]:grid-cols-2 @3xl/main:grid-cols-3 @5xl/main:grid-cols-4 @7xl/main:grid-cols-6">
					{monthNames.map((monthName, index) => (
						<MiniMonth
							key={monthName}
							year={year}
							month={index + 1}
							monthName={monthName}
							weekdays={weekdays}
							weekStartDay={weekStartDay}
							calendarDays={calendarDays}
							currentDate={currentDate}
							locale={locale}
							onRequestDay={onRequestDay}
							openDay={openDay}
							onOpenDayChange={setOpenDay}
						/>
					))}
				</div>
			</TooltipProvider>
		</div>
	);
}
