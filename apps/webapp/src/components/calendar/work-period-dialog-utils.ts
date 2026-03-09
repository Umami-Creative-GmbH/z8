import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";

export interface WorkPeriodDialogMetadata {
	durationMinutes: number;
	employeeName: string;
	notes?: string;
	projectId?: string;
	projectName?: string;
	projectColor?: string;
	surchargeMinutes?: number;
	totalCreditedMinutes?: number;
	surchargeBreakdown?: Array<{
		ruleName: string;
		ruleType: "day_of_week" | "time_window" | "date_based";
		percentage: number;
		qualifyingMinutes: number;
		surchargeMinutes: number;
	}>;
	approvalStatus?: "approved" | "pending" | "rejected";
}

export function getWorkPeriodDialogMetadata(event: CalendarEvent): WorkPeriodDialogMetadata {
	return event.metadata as WorkPeriodDialogMetadata;
}

export function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;

	if (hours === 0) {
		return `${mins}m`;
	}

	if (mins === 0) {
		return `${hours}h`;
	}

	return `${hours}h ${mins}m`;
}

export function formatEventTimeRange(event: CalendarEvent): string {
	return `${format(event.date, "p")} - ${event.endDate ? format(event.endDate, "p") : "—"}`;
}

export function formatTimeToHHMM(date: Date): string {
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");

	return `${hours}:${minutes}`;
}
