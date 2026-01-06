"use client";

import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AbsenceWithCategory, Holiday } from "@/lib/absences/types";

interface AbsenceCalendarProps {
	absences: AbsenceWithCategory[];
	holidays: Holiday[];
}

export function AbsenceCalendar({ absences, holidays }: AbsenceCalendarProps) {
	const [currentDate, setCurrentDate] = useState(new Date());

	const year = currentDate.getFullYear();
	const month = currentDate.getMonth();

	const monthNames = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
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
	const getDateStatus = (day: number) => {
		const date = new Date(year, month, day);
		const _dateStr = date.toISOString().split("T")[0];

		// Check for absences
		for (const absence of absences) {
			const start = new Date(absence.startDate);
			const end = new Date(absence.endDate);
			start.setHours(0, 0, 0, 0);
			end.setHours(23, 59, 59, 999);

			if (date >= start && date <= end) {
				return {
					type: "absence",
					status: absence.status,
					color: absence.category.color,
				};
			}
		}

		// Check for holidays
		for (const holiday of holidays) {
			const start = new Date(holiday.startDate);
			const end = new Date(holiday.endDate);
			start.setHours(0, 0, 0, 0);
			end.setHours(23, 59, 59, 999);

			if (date >= start && date <= end) {
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

		days.push(
			<div
				key={day}
				className={`
          aspect-square rounded-md p-2 text-sm
          ${isToday ? "ring-2 ring-primary" : ""}
          ${
						status?.type === "absence"
							? status.status === "approved"
								? "bg-blue-500/10 text-blue-700 dark:text-blue-300"
								: status.status === "pending"
									? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
									: "bg-red-500/10 text-red-700 dark:text-red-300"
							: ""
					}
          ${status?.type === "holiday" ? "bg-muted text-muted-foreground" : ""}
        `}
			>
				<div className="flex flex-col h-full">
					<div className="font-medium">{day}</div>
					{status && (
						<div className="mt-auto">
							<div className="h-1 rounded-full bg-current opacity-50" />
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
					{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
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
						<span className="text-muted-foreground">Approved</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-yellow-500/20" />
						<span className="text-muted-foreground">Pending</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-red-500/20" />
						<span className="text-muted-foreground">Rejected</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="size-3 rounded bg-muted" />
						<span className="text-muted-foreground">Holiday</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
