"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

import { weekDates, workdayHref } from "./workday-date-helpers";

/** Civil date navigation. Every link selects the actual server timeline, in employee context. */
export function WorkdayWeekStrip({
	dateKey,
	weekStartDay,
}: {
	dateKey: string;
	weekStartDay: WeekStartDay;
}) {
	const locale = useLocale();
	const { t } = useTranslate();
	return (
		<nav
			aria-label={t(
				"timeTracking.timeline.weekPicker",
				"Select a day of the week",
			)}
			className="grid grid-cols-7 gap-1 border-b pb-5"
		>
			{weekDates(dateKey, weekStartDay).map((date) => (
				<Link
					key={date.toString()}
					href={workdayHref(date.toString())}
					aria-current={date.toString() === dateKey ? "date" : undefined}
					aria-label={date.toLocaleString(locale, { dateStyle: "full" })}
					className={cn(
						"flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-transparent py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
						date.toString() === dateKey
							? "border-primary bg-primary/10 text-primary"
							: "text-muted-foreground hover:bg-muted hover:text-foreground",
					)}
				>
					<span>{date.toLocaleString(locale, { weekday: "short" })}</span>
					<span className="font-semibold tabular-nums">{date.day}</span>
				</Link>
			))}
		</nav>
	);
}

export function WorkdayMonthPicker({
	dateKey,
	todayDateKey,
	weekStartDay,
}: {
	dateKey: string;
	todayDateKey: string;
	weekStartDay: WeekStartDay;
}) {
	const locale = useLocale();
	const { t } = useTranslate();
	const [month, setMonth] = useState(() =>
		Temporal.PlainDate.from(dateKey).with({ day: 1 }),
	);
	const start = weekDates(month.toString(), weekStartDay)[0];
	const dayCount =
		Math.ceil((month.daysInMonth + month.since(start).days) / 7) * 7;
	return (
		<Card className="rounded-xl shadow-none">
			<CardHeader className="flex flex-row items-center justify-between gap-2">
				<CardTitle className="text-base">
					{t("timeTracking.table.viewCalendar", "View Calendar")}
				</CardTitle>
				<Button asChild size="sm" variant="ghost">
					<Link href={workdayHref(todayDateKey)}>
						{t("timeTracking.timeline.today", "Today")}
					</Link>
				</Button>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between gap-1">
					<Button
						size="icon"
						variant="ghost"
						aria-label={t("calendar.previousMonth", "Previous month")}
						onClick={() => setMonth(month.subtract({ months: 1 }))}
					>
						<IconChevronLeft aria-hidden="true" className="size-4" />
					</Button>
					<p className="text-center text-sm font-medium" aria-live="polite">
						{month.toLocaleString(locale, { month: "long", year: "numeric" })}
					</p>
					<Button
						size="icon"
						variant="ghost"
						aria-label={t("calendar.nextMonth", "Next month")}
						onClick={() => setMonth(month.add({ months: 1 }))}
					>
						<IconChevronRight aria-hidden="true" className="size-4" />
					</Button>
				</div>
				<nav
					aria-label={t(
						"timeTracking.timeline.monthPicker",
						"Select a calendar day",
					)}
					className="grid grid-cols-7 gap-1 text-center text-sm"
				>
					{weekDates(month.toString(), weekStartDay).map((date) => (
						<span className="py-2 text-muted-foreground" key={date.dayOfWeek}>
							{date.toLocaleString(locale, { weekday: "narrow" })}
						</span>
					))}
					{Array.from({ length: dayCount }, (_, index) =>
						start.add({ days: index }),
					).map((date) => (
						<Link
							key={date.toString()}
							href={workdayHref(date.toString())}
							aria-current={date.toString() === dateKey ? "date" : undefined}
							aria-label={date.toLocaleString(locale, { dateStyle: "full" })}
							className={cn(
								"flex min-h-10 min-w-0 items-center justify-center rounded-md tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								date.month !== month.month && "text-muted-foreground",
								date.toString() === todayDateKey && "font-semibold",
								date.toString() === dateKey &&
									"bg-primary text-primary-foreground hover:bg-primary/90",
							)}
						>
							{date.day}
						</Link>
					))}
				</nav>
			</CardContent>
		</Card>
	);
}
