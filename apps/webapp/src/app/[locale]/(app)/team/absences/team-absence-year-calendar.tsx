"use client";

import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useWeekStartDay } from "@/components/providers/user-preferences-provider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import { buildManagerAbsenceCalendarDays } from "./manager-absence-calendar-helpers";
import type {
	ManagerAbsenceCalendarDay,
	ManagerAbsenceCalendarResult,
} from "./manager-absence-types";

type TeamAbsenceYearCalendarProps = {
	data: ManagerAbsenceCalendarResult;
};

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

function getMonthDays(year: number, month: number): DateTime[] {
	const firstDay = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" });

	return Array.from({ length: firstDay.daysInMonth ?? 0 }, (_value, dayIndex) =>
		firstDay.plus({ days: dayIndex }),
	);
}

function getFirstDayOffset(year: number, month: number, weekStartDay: WeekStartDay): number {
	const weekday = DateTime.fromObject({ year, month, day: 1 }, { zone: "utc" }).weekday;

	return weekStartDay === "monday" ? weekday - 1 : weekday % 7;
}

function formatDateLabel(date: DateTime): string {
	return date.toLocaleString({ month: "long", day: "numeric", year: "numeric" });
}

function buildDayLabel(day: ManagerAbsenceCalendarDay | undefined, date: DateTime): string {
	if (!day) {
		return formatDateLabel(date);
	}

	const pendingPart = day.pendingCount > 0 ? `, ${day.pendingCount} pending` : "";

	return `${formatDateLabel(date)}: ${day.totalCount} absent${pendingPart}`;
}

function TeamAbsenceDayDetails({
	dateKey,
	day,
	date,
}: {
	dateKey: string;
	day: ManagerAbsenceCalendarDay;
	date: DateTime;
}) {
	const { t } = useTranslate();

	return (
		<div className="space-y-2" data-testid={`team-absence-calendar-details-${dateKey}`}>
			<p className="font-medium">{buildDayLabel(day, date)}</p>
			{day.entries.map((entry) => (
				<div key={`${entry.id}-${dateKey}`} className="text-sm">
					<p className="font-medium">{entry.employeeName}</p>
					<p className="text-muted-foreground">
						<span>{entry.category.name}</span>
						<span className="sr-only"> </span>
						<span aria-hidden="true"> · </span>
						<span>
							{entry.status === "pending"
								? t("team.absences.calendar.pending", "Pending")
								: t("team.absences.calendar.approved", "Approved")}
						</span>
					</p>
				</div>
			))}
		</div>
	);
}

function TeamAbsenceMonth({
	month,
	year,
	monthName,
	weekdays,
	weekStartDay,
	daysByDate,
}: {
	month: number;
	year: number;
	monthName: string;
	weekdays: string[];
	weekStartDay: WeekStartDay;
	daysByDate: Map<string, ManagerAbsenceCalendarDay>;
}) {
	const days = getMonthDays(year, month);
	const paddingDays = Array.from(
		{ length: getFirstDayOffset(year, month, weekStartDay) },
		(_, index) => `padding-${month}-${index}`,
	);

	return (
		<section className="rounded-lg border bg-card p-2" aria-label={monthName}>
			<h3 className="mb-2 text-center font-medium text-sm">{monthName}</h3>
			<div className="mb-1 grid grid-cols-7 gap-0.5 text-center">
				{weekdays.map((weekday) => (
					<div key={weekday} className="font-medium text-[10px] text-muted-foreground">
						{weekday}
					</div>
				))}
			</div>
			<div className="grid grid-cols-7 gap-0.5">
				{paddingDays.map((key) => (
					<div key={key} className="aspect-square" />
				))}
				{days.map((date) => {
					const dateKey = date.toISODate() ?? "";
					const day = daysByDate.get(dateKey);
					const hasApproved = (day?.approvedCount ?? 0) > 0;
					const hasPending = (day?.pendingCount ?? 0) > 0;
					const dayButton = (
						<button
							type="button"
							className={cn(
								"relative flex aspect-square w-full flex-col items-center justify-center rounded-sm text-[10px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
								hasApproved && "bg-blue-100 text-blue-950 dark:bg-blue-900/30 dark:text-blue-100",
								hasPending && "ring-1 ring-yellow-500",
							)}
							aria-label={buildDayLabel(day, date)}
						>
							<span>{date.day}</span>
							{day ? <span className="font-semibold leading-none">{day.totalCount}</span> : null}
							{hasPending ? (
								<span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-yellow-500" />
							) : null}
						</button>
					);

					if (!day) {
						return <div key={dateKey}>{dayButton}</div>;
					}

					return (
						<div key={dateKey}>
							<Tooltip>
								<TooltipTrigger asChild>{dayButton}</TooltipTrigger>
								<TooltipContent className="max-w-xs">
									<TeamAbsenceDayDetails dateKey={dateKey} day={day} date={date} />
								</TooltipContent>
							</Tooltip>
							<div className="sr-only">
								<TeamAbsenceDayDetails dateKey={dateKey} day={day} date={date} />
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

export function TeamAbsenceYearCalendar({ data }: TeamAbsenceYearCalendarProps) {
	const { t } = useTranslate();
	const weekStartDay = useWeekStartDay();
	const calendarDays = buildManagerAbsenceCalendarDays(data.entries, data.year);
	const daysByDate = new Map(calendarDays.map((day) => [day.date, day]));
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
	const sundayFirstWeekdays = [
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
			? [...sundayFirstWeekdays.slice(1), sundayFirstWeekdays[0]]
			: sundayFirstWeekdays;
	const totalAbsenceDays = calendarDays.reduce((sum, day) => sum + day.totalCount, 0);
	const pendingAbsenceDays = calendarDays.reduce((sum, day) => sum + day.pendingCount, 0);

	return (
		<section
			className="rounded-lg border bg-card p-4"
			aria-labelledby="team-absence-year-calendar-title"
		>
			<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h2 id="team-absence-year-calendar-title" className="font-semibold text-lg">
						{t("team.absences.calendar.title", "Year calendar")}
					</h2>
					<p className="text-muted-foreground text-sm">
						{t(
							"team.absences.calendar.description",
							"Approved and pending absences for the selected team and year.",
						)}
					</p>
				</div>
				<div className="flex gap-2 text-left sm:text-right">
					<div className="rounded-md border bg-background px-3 py-2">
						<p className="font-semibold tabular-nums">{data.year}</p>
						<p className="text-muted-foreground text-xs">
							{t("team.absences.calendar.totalDays", "{count} absent", {
								count: totalAbsenceDays,
							})}
						</p>
					</div>
					<div className="rounded-md border bg-background px-3 py-2">
						<p className="font-semibold tabular-nums">{pendingAbsenceDays}</p>
						<p className="text-muted-foreground text-xs">
							{t("team.absences.calendar.pendingDays", "{count} pending", {
								count: pendingAbsenceDays,
							})}
						</p>
					</div>
				</div>
			</div>

			<div className="mb-4 flex flex-wrap items-center gap-4 text-xs">
				<div className="flex items-center gap-1">
					<div className="size-3 rounded border border-blue-500 bg-blue-100 dark:bg-blue-900/30" />
					<span>{t("team.absences.calendar.legend.approved", "Approved")}</span>
				</div>
				<div className="flex items-center gap-1">
					<div className="size-3 rounded border border-yellow-500" />
					<span>{t("team.absences.calendar.legend.pending", "Pending")}</span>
				</div>
			</div>

			<TooltipProvider delayDuration={150}>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
					{MONTH_NUMBERS.map((month) => (
						<TeamAbsenceMonth
							key={month}
							month={month}
							year={data.year}
							monthName={monthNames[month - 1] ?? String(month)}
							weekdays={weekdays}
							weekStartDay={weekStartDay}
							daysByDate={daysByDate}
						/>
					))}
				</div>
			</TooltipProvider>
		</section>
	);
}
