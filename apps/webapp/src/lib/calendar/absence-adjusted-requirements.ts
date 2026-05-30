import { DateTime } from "luxon";
import type { DailyWorkRequirements } from "./types";

export type AbsenceDayPeriod = "full_day" | "am" | "pm";

export interface ApprovedAbsenceRange {
	startDate: string;
	startPeriod: AbsenceDayPeriod;
	endDate: string;
	endPeriod: AbsenceDayPeriod;
}

interface AbsenceDayFractionInput extends ApprovedAbsenceRange {
	date: string;
}

export function getAbsenceDayFraction(input: AbsenceDayFractionInput): number {
	const date = DateTime.fromISO(input.date, { zone: "utc" }).startOf("day");
	const start = DateTime.fromISO(input.startDate, { zone: "utc" }).startOf("day");
	const end = DateTime.fromISO(input.endDate, { zone: "utc" }).startOf("day");
	if (!date.isValid || !start.isValid || !end.isValid || end < start || date < start || date > end)
		return 0;

	if (input.startDate === input.endDate) {
		if (input.startPeriod === "full_day" || input.endPeriod === "full_day") return 1;
		return input.startPeriod === input.endPeriod ? 0.5 : 1;
	}

	if (input.date === input.startDate) return input.startPeriod === "pm" ? 0.5 : 1;
	if (input.date === input.endDate) return input.endPeriod === "am" ? 0.5 : 1;
	return 1;
}

function eachAbsenceDate(absence: ApprovedAbsenceRange): string[] {
	const dates: string[] = [];
	let cursor = DateTime.fromISO(absence.startDate, { zone: "utc" }).startOf("day");
	const end = DateTime.fromISO(absence.endDate, { zone: "utc" }).startOf("day");
	if (!cursor.isValid || !end.isValid || end < cursor) return dates;

	while (cursor <= end) {
		const dateKey = cursor.toISODate();
		if (dateKey) dates.push(dateKey);
		cursor = cursor.plus({ days: 1 });
	}

	return dates;
}

export function applyAbsenceAdjustmentsToRequirements(
	requirements: DailyWorkRequirements,
	absences: ApprovedAbsenceRange[],
): DailyWorkRequirements {
	const reductionByDate = new Map<string, number>();

	for (const absence of absences) {
		for (const date of eachAbsenceDate(absence)) {
			if (!requirements[date]) continue;
			const current = reductionByDate.get(date) ?? 0;
			const next = current + getAbsenceDayFraction({ date, ...absence });
			reductionByDate.set(date, Math.min(1, next));
		}
	}

	const adjusted: DailyWorkRequirements = {};
	for (const [dateKey, requirement] of Object.entries(requirements)) {
		const reduction = reductionByDate.get(dateKey) ?? 0;
		adjusted[dateKey] = {
			...requirement,
			requiredMinutes: Math.max(0, Math.round(requirement.requiredMinutes * (1 - reduction))),
		};
	}

	return adjusted;
}
