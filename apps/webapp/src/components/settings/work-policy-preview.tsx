"use client";

import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";

interface ScheduleDayInput {
	dayOfWeek: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	hoursPerDay: string;
	isWorkDay: boolean;
	cycleWeek?: number;
}

interface WorkSchedulePreviewProps {
	days: ScheduleDayInput[];
	homeOfficeDaysPerCycle?: number;
	scheduleCycle?: string;
}

const DAY_LABELS: Record<string, string> = {
	monday: "Mon",
	tuesday: "Tue",
	wednesday: "Wed",
	thursday: "Thu",
	friday: "Fri",
	saturday: "Sat",
	sunday: "Sun",
};

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * Generates default days from a working days preset
 */
export function generateDaysFromPreset(
	preset: "weekdays" | "weekends" | "all_days" | "custom",
): ScheduleDayInput[] {
	return DAY_ORDER.map((day) => {
		let isWorkDay = false;
		switch (preset) {
			case "weekdays":
				isWorkDay = day !== "saturday" && day !== "sunday";
				break;
			case "weekends":
				isWorkDay = day === "saturday" || day === "sunday";
				break;
			case "all_days":
				isWorkDay = true;
				break;
			default:
				isWorkDay = day !== "saturday" && day !== "sunday";
		}
		return {
			dayOfWeek: day as ScheduleDayInput["dayOfWeek"],
			hoursPerDay: isWorkDay ? "8" : "0",
			isWorkDay,
			cycleWeek: 1,
		};
	});
}

export function WorkSchedulePreview({
	days,
	homeOfficeDaysPerCycle = 0,
	scheduleCycle = "weekly",
}: WorkSchedulePreviewProps) {
	const { t } = useTranslate();

	// Sort days by day order
	const sortedDays = [...days].sort(
		(a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek),
	);

	// Calculate totals
	const workDays = sortedDays.filter((d) => d.isWorkDay).length;
	const totalHours = sortedDays
		.filter((d) => d.isWorkDay)
		.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0);

	return (
		<div className="space-y-3">
			{/* Day indicators */}
			<div className="flex gap-1.5">
				{sortedDays.map((day) => (
					<div
						key={day.dayOfWeek}
						className={cn(
							"flex flex-col items-center justify-center p-2 rounded-md flex-1 min-w-0",
							day.isWorkDay
								? "bg-primary/10 border border-primary/20"
								: "bg-muted/50 border border-muted",
						)}
					>
						<span
							className={cn(
								"text-xs font-medium",
								day.isWorkDay ? "text-primary" : "text-muted-foreground",
							)}
						>
							{DAY_LABELS[day.dayOfWeek]}
						</span>
						{day.isWorkDay && (
							<span className="text-[10px] text-muted-foreground">{day.hoursPerDay}h</span>
						)}
					</div>
				))}
			</div>

			{/* Summary row */}
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span>
					{t("settings.workSchedules.workDays", "{count} work days", { count: workDays })}
				</span>
				<span>
					{t("settings.workSchedules.totalHoursPerCycle", "{hours}h/{cycle}", {
						hours: totalHours.toFixed(1),
						cycle: scheduleCycle,
					})}
				</span>
				{homeOfficeDaysPerCycle > 0 && (
					<span>
						{t("settings.workSchedules.homeOfficeDaysPreview", "{count} home office", {
							count: homeOfficeDaysPerCycle,
						})}
					</span>
				)}
			</div>
		</div>
	);
}
