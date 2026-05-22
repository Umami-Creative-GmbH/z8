import { format } from "@/lib/datetime/luxon-utils";
import type {
	CalendarEvent,
	DailyWorkHoursStatus,
	DailyWorkHoursSummaries,
	DailyWorkRequirements,
} from "./types";

interface BuildDailyWorkHoursSummariesOptions {
	events: CalendarEvent[];
	dailyRequirements: DailyWorkRequirements;
}

function getStatus(actualMinutes: number, requiredMinutes: number): DailyWorkHoursStatus {
	if (actualMinutes === 0) return "missing";
	if (actualMinutes > requiredMinutes) return "over";
	if (actualMinutes === requiredMinutes) return "met";
	return "under";
}

export function buildDailyWorkHoursSummaries({
	events,
	dailyRequirements,
}: BuildDailyWorkHoursSummariesOptions): DailyWorkHoursSummaries {
	const actualByDate = new Map<string, number>();

	for (const event of events) {
		if (event.type !== "work_period") continue;
		const dateKey = format(event.date, "yyyy-MM-dd");
		const durationMinutes = Number(event.metadata.durationMinutes ?? 0);
		if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) continue;
		actualByDate.set(dateKey, (actualByDate.get(dateKey) ?? 0) + durationMinutes);
	}

	const summaries: DailyWorkHoursSummaries = new Map();

	for (const [dateKey, requirement] of Object.entries(dailyRequirements)) {
		const actualMinutes = actualByDate.get(dateKey) ?? 0;
		const deltaMinutes = actualMinutes - requirement.requiredMinutes;
		summaries.set(dateKey, {
			...requirement,
			actualMinutes,
			deltaMinutes,
			status: getStatus(actualMinutes, requirement.requiredMinutes),
		});
	}

	return summaries;
}

export function formatTimeHours(minutes: number): string {
	const safeMinutes = Math.max(0, Math.round(minutes));
	const hours = Math.floor(safeMinutes / 60);
	const mins = safeMinutes % 60;
	return `${hours}:${String(mins).padStart(2, "0")}h`;
}

export function formatSignedMinutes(minutes: number): string {
	const sign = minutes >= 0 ? "+" : "-";
	return `${sign}${formatTimeHours(Math.abs(minutes))}`;
}
