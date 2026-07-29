import type { CalendarEvent } from "@/lib/calendar/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
} from "@/lib/datetime/temporal-format";

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
		ruleId: string;
		ruleName: string;
		ruleType: "day_of_week" | "time_window" | "date_based";
		percentage: number;
		qualifyingMinutes: number;
		surchargeMinutes: number;
	}>;
	approvalStatus?: "approved" | "pending" | "rejected";
}

export function getWorkPeriodDialogMetadata(
	event: CalendarEvent,
): WorkPeriodDialogMetadata {
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

export function formatEventTimeRange(
	event: CalendarEvent,
	context: DisplayContext,
): string {
	return `${formatInstant(instantFromDate(event.date), context, "time")} - ${event.endDate ? formatInstant(instantFromDate(event.endDate), context, "time") : "—"}`;
}

export function formatTimeToHHMM(date: Date, timezone: string): string {
	const time = instantFromDate(date).toZonedDateTimeISO(timezone).toPlainTime();
	return `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}
