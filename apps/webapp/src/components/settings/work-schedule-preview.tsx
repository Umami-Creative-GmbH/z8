"use client";

import { IconHome } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface ScheduleDay {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
}

interface WorkSchedulePreviewProps {
	days: ScheduleDay[];
	homeOfficeDaysPerCycle?: number;
	scheduleCycle?: string;
	className?: string;
	compact?: boolean;
}

const DAY_LABELS = {
	monday: { short: "Mon", full: "Monday" },
	tuesday: { short: "Tue", full: "Tuesday" },
	wednesday: { short: "Wed", full: "Wednesday" },
	thursday: { short: "Thu", full: "Thursday" },
	friday: { short: "Fri", full: "Friday" },
	saturday: { short: "Sat", full: "Saturday" },
	sunday: { short: "Sun", full: "Sunday" },
};

const DAY_ORDER: ScheduleDay["dayOfWeek"][] = [
	"monday",
	"tuesday",
	"wednesday",
	"thursday",
	"friday",
	"saturday",
	"sunday",
];

/**
 * Visual preview of a work schedule showing work days and hours
 */
export function WorkSchedulePreview({
	days,
	homeOfficeDaysPerCycle = 0,
	scheduleCycle = "weekly",
	className,
	compact = false,
}: WorkSchedulePreviewProps) {
	// Create a map for quick day lookup
	const dayMap = new Map(days.map((d) => [d.dayOfWeek, d]));

	// Calculate total weekly hours
	const totalHours = days
		.filter((d) => d.isWorkDay)
		.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);

	const workDaysCount = days.filter((d) => d.isWorkDay).length;

	if (compact) {
		return (
			<div className={cn("flex flex-wrap gap-1", className)}>
				{DAY_ORDER.map((dayKey) => {
					const day = dayMap.get(dayKey);
					const isWorkDay = day?.isWorkDay ?? false;
					const hours = day?.hoursPerDay ? parseFloat(day.hoursPerDay) : 0;

					return (
						<div
							key={dayKey}
							className={cn(
								"rounded px-2 py-1 text-xs font-medium transition-colors",
								isWorkDay ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
							)}
							title={`${DAY_LABELS[dayKey].full}: ${isWorkDay ? `${hours}h` : "Off"}`}
						>
							{DAY_LABELS[dayKey].short}
						</div>
					);
				})}
			</div>
		);
	}

	return (
		<div className={cn("space-y-3", className)}>
			{/* Week grid */}
			<div className="grid grid-cols-7 gap-1">
				{DAY_ORDER.map((dayKey) => {
					const day = dayMap.get(dayKey);
					const isWorkDay = day?.isWorkDay ?? false;
					const hours = day?.hoursPerDay ? parseFloat(day.hoursPerDay) : 0;

					return (
						<div
							key={dayKey}
							className={cn(
								"flex flex-col items-center rounded-md border p-2 transition-colors",
								isWorkDay ? "border-primary/30 bg-primary/5" : "border-muted bg-muted/50",
							)}
						>
							<span
								className={cn(
									"text-xs font-medium",
									isWorkDay ? "text-primary" : "text-muted-foreground",
								)}
							>
								{DAY_LABELS[dayKey].short}
							</span>
							<span
								className={cn(
									"mt-1 text-lg font-semibold",
									isWorkDay ? "text-foreground" : "text-muted-foreground/50",
								)}
							>
								{isWorkDay ? `${hours}h` : "—"}
							</span>
						</div>
					);
				})}
			</div>

			{/* Summary row */}
			<div className="flex items-center justify-between text-sm">
				<div className="flex items-center gap-4">
					<span className="text-muted-foreground">
						{workDaysCount} work day{workDaysCount !== 1 ? "s" : ""} · {totalHours}h/{scheduleCycle}
					</span>
				</div>
				{homeOfficeDaysPerCycle > 0 && (
					<div className="flex items-center gap-1 text-muted-foreground">
						<IconHome className="size-4" />
						<span>
							{homeOfficeDaysPerCycle} home office day{homeOfficeDaysPerCycle !== 1 ? "s" : ""}
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * Generates default days array for a schedule preset
 */
export function generateDaysFromPreset(
	preset: "weekdays" | "weekends" | "all_days" | "custom",
	defaultHoursPerDay = "8",
): ScheduleDay[] {
	const weekdaySet = new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]);
	const weekendSet = new Set(["saturday", "sunday"]);

	return DAY_ORDER.map((dayOfWeek) => {
		let isWorkDay = false;

		if (preset === "weekdays") {
			isWorkDay = weekdaySet.has(dayOfWeek);
		} else if (preset === "weekends") {
			isWorkDay = weekendSet.has(dayOfWeek);
		} else if (preset === "all_days") {
			isWorkDay = true;
		}
		// "custom" starts with no days selected

		return {
			dayOfWeek,
			hoursPerDay: isWorkDay ? defaultHoursPerDay : "0",
			isWorkDay,
		};
	});
}
