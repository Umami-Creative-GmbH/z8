"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AbsenceWithCategory, DayPeriod, Holiday } from "@/lib/absences/types";

interface AbsenceCalendarProps {
	absences: AbsenceWithCategory[];
	holidays: Holiday[];
}

interface DateStatus {
	type: "absence" | "holiday";
	status?: "approved" | "pending" | "rejected";
	color?: string | null;
	period?: "full_day" | "am" | "pm"; // For half-day display
	isFirstDay?: boolean;
	isLastDay?: boolean;
	startPeriod?: DayPeriod;
	endPeriod?: DayPeriod;
}

export function AbsenceCalendar({ absences, holidays }: AbsenceCalendarProps) {
	const { t } = useTranslate();
	const [currentDate, setCurrentDate] = useState(new Date());

	const year = currentDate.getFullYear();
	const month = currentDate.getMonth();

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

	const weekdays = [
		t("common.weekdays.sun", "Sun"),
		t("common.weekdays.mon", "Mon"),
		t("common.weekdays.tue", "Tue"),
		t("common.weekdays.wed", "Wed"),
		t("common.weekdays.thu", "Thu"),
		t("common.weekdays.fri", "Fri"),
		t("common.weekdays.sat", "Sat"),
	];

	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const firstDayOfMonth = new Date(year, month, 1).getDay();

	// Navigate months
	const previousMonth = () => {
		setCurrentDate(new Date(year, month - 1, 1));
	};

	const nextMonth = () => {
		setCurrentDate(new Date(year, month + 1, 1));
	};

	// Check if a date has an absence
	const getDateStatus = (day: number): DateStatus | null => {
		// Create YYYY-MM-DD string for comparison
		const dateStr = DateTime.local(year, month + 1, day).toFormat("yyyy-MM-dd");

		// Check for absences (dates are now YYYY-MM-DD strings)
		for (const absence of absences) {
			if (dateStr >= absence.startDate && dateStr <= absence.endDate) {
				const isFirstDay = dateStr === absence.startDate;
				const isLastDay = dateStr === absence.endDate;
				const isSingleDay = isFirstDay && isLastDay;

				// Determine which period of the day is affected
				let period: "full_day" | "am" | "pm" = "full_day";

				if (isSingleDay) {
					// Single day: use the combined period logic
					if (
						absence.startPeriod === "full_day" ||
						absence.endPeriod === "full_day" ||
						(absence.startPeriod === "am" && absence.endPeriod === "pm")
					) {
						period = "full_day";
					} else if (absence.startPeriod === "am" && absence.endPeriod === "am") {
						period = "am";
					} else if (absence.startPeriod === "pm" && absence.endPeriod === "pm") {
						period = "pm";
					}
				} else if (isFirstDay) {
					// First day of multi-day absence
					period = absence.startPeriod === "pm" ? "pm" : "full_day";
				} else if (isLastDay) {
					// Last day of multi-day absence
					period = absence.endPeriod === "am" ? "am" : "full_day";
				}

				return {
					type: "absence",
					status: absence.status,
					color: absence.category.color,
					period,
					isFirstDay,
					isLastDay,
					startPeriod: absence.startPeriod,
					endPeriod: absence.endPeriod,
				};
			}
		}

		// Check for holidays
		for (const holiday of holidays) {
			const start = DateTime.fromJSDate(holiday.startDate);
			const end = DateTime.fromJSDate(holiday.endDate);
			const date = DateTime.local(year, month + 1, day);

			if (date >= start.startOf("day") && date <= end.endOf("day")) {
				return { type: "holiday" };
			}
		}

		return null;
	};

	// Generate calendar days
	const days = [];
	for (let i = 0; i < firstDayOfMonth; i++) {
		days.push(<div key={`empty-${i}`} className="aspect-square" />);
	}

	for (let day = 1; day <= daysInMonth; day++) {
		const status = getDateStatus(day);
		const isToday =
			new Date().getDate() === day &&
			new Date().getMonth() === month &&
			new Date().getFullYear() === year;

		// Determine background style based on period
		const getBackgroundClass = () => {
			if (status?.type !== "absence") return "";

			const baseColor =
				status.status === "approved"
					? "from-blue-500/20 to-blue-500/20"
					: status.status === "pending"
						? "from-yellow-500/20 to-yellow-500/20"
						: "from-red-500/20 to-red-500/20";

			// For half-days, use gradient to show only half
			if (status.period === "am") {
				return `bg-gradient-to-b ${baseColor.replace("to-blue", "to-transparent").replace("to-yellow", "to-transparent").replace("to-red", "to-transparent")}`;
			}
			if (status.period === "pm") {
				return `bg-gradient-to-t ${baseColor.replace("to-blue", "to-transparent").replace("to-yellow", "to-transparent").replace("to-red", "to-transparent")}`;
			}
			return "";
		};

		const getBackgroundStyle = () => {
			if (status?.type !== "absence") return {};

			const opacity = status.status === "approved" ? 0.15 : status.status === "pending" ? 0.1 : 0.1;
			const color =
				status.status === "approved"
					? "59, 130, 246" // blue
					: status.status === "pending"
						? "234, 179, 8" // yellow
						: "239, 68, 68"; // red

			if (status.period === "am") {
				// Top half only
				return {
					background: `linear-gradient(to bottom, rgba(${color}, ${opacity}) 50%, transparent 50%)`,
				};
			}
			if (status.period === "pm") {
				// Bottom half only
				return {
					background: `linear-gradient(to top, rgba(${color}, ${opacity}) 50%, transparent 50%)`,
				};
			}
			// Full day
			return {
				background: `rgba(${color}, ${opacity})`,
			};
		};

		const getTextClass = () => {
			if (status?.type === "absence") {
				return status.status === "approved"
					? "text-blue-700 dark:text-blue-300"
					: status.status === "pending"
						? "text-yellow-700 dark:text-yellow-300"
						: "text-red-700 dark:text-red-300";
			}
			if (status?.type === "holiday") {
				return "text-muted-foreground";
			}
			return "";
		};

		days.push(
			<div
				key={day}
				className={`
          aspect-square rounded-md p-2 text-sm relative
          ${isToday ? "ring-2 ring-primary" : ""}
          ${status?.type === "holiday" ? "bg-muted" : ""}
          ${getTextClass()}
        `}
				style={status?.type === "absence" ? getBackgroundStyle() : {}}
			>
				<div className="flex flex-col h-full">
					<div className="font-medium">{day}</div>
					{status && (
						<div className="mt-auto flex items-center gap-1">
							<div className="h-1 flex-1 rounded-full bg-current opacity-50" />
							{status.type === "absence" && status.period !== "full_day" && (
								<span className="text-[10px] uppercase opacity-70">
									{status.period === "am" ? t("absences.period.am", "AM") : t("absences.period.pm", "PM")}
								</span>
							)}
						</div>
					)}
				</div>
			</div>,
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<CardTitle>
						{monthNames[month]} {year}
					</CardTitle>
					<div className="flex gap-2">
						<Button variant="outline" size="icon" onClick={previousMonth}>
							<IconChevronLeft className="size-4" />
						</Button>
						<Button variant="outline" size="icon" onClick={nextMonth}>
							<IconChevronRight className="size-4" />
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className="grid grid-cols-7 gap-2">
					{/* Day Headers */}
					{weekdays.map((day) => (
						<div key={day} className="text-center text-sm font-medium text-muted-foreground pb-2">
							{day}
						</div>
					))}

					{/* Calendar Days */}
					{days}
				</div>

				{/* Legend */}
				<div className="mt-6 pt-6 border-t flex flex-wrap gap-4 text-sm">
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-blue-500/20" />
						<span className="text-muted-foreground">{t("absences.calendar.legend.approved", "Approved")}</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-yellow-500/20" />
						<span className="text-muted-foreground">{t("absences.calendar.legend.pending", "Pending")}</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-red-500/20" />
						<span className="text-muted-foreground">{t("absences.calendar.legend.rejected", "Rejected")}</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-muted" />
						<span className="text-muted-foreground">{t("absences.calendar.legend.holiday", "Holiday")}</span>
					</div>
					<div className="flex items-center gap-2">
						<div
							className="size-3 rounded"
							style={{
								background: "linear-gradient(to bottom, rgba(59, 130, 246, 0.2) 50%, transparent 50%)",
							}}
						/>
						<span className="text-muted-foreground">{t("absences.calendar.legend.halfDayAm", "Half day (AM)")}</span>
					</div>
					<div className="flex items-center gap-2">
						<div
							className="size-3 rounded"
							style={{
								background: "linear-gradient(to top, rgba(59, 130, 246, 0.2) 50%, transparent 50%)",
							}}
						/>
						<span className="text-muted-foreground">{t("absences.calendar.legend.halfDayPm", "Half day (PM)")}</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
