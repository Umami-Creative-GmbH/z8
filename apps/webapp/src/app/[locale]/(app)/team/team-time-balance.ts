import { DateTime } from "luxon";
import type { absenceEntry } from "@/db/schema";

type DayPeriod = typeof absenceEntry.$inferSelect.startPeriod;

export type EmployeeTimeBalancePayload = {
	year: number;
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
	balanceMinutes: number;
	calculatedAt: Date;
};

export function getCurrentYearRange(now: DateTime = DateTime.utc()) {
	const current = now.toUTC();
	const start = current.startOf("year");
	const end = current.endOf("year");
	return { year: current.year, start, end };
}

export function calculateBalanceMinutes(input: {
	actualMinutes: number;
	expectedMinutes: number;
	absenceAdjustedMinutes: number;
}) {
	const adjustedExpectedMinutes = Math.max(0, input.expectedMinutes - input.absenceAdjustedMinutes);
	return input.actualMinutes - adjustedExpectedMinutes;
}

export function calculateDayAbsenceAdjustmentMinutes(expectedDayMinutes: number, period: DayPeriod) {
	if (period === "morning" || period === "afternoon") return Math.round(expectedDayMinutes / 2);
	return expectedDayMinutes;
}

export function formatSignedBalance(balanceMinutes: number) {
	if (balanceMinutes === 0) return "0h";
	const sign = balanceMinutes > 0 ? "+" : "-";
	const absoluteMinutes = Math.abs(balanceMinutes);
	const hours = Math.floor(absoluteMinutes / 60);
	const minutes = absoluteMinutes % 60;
	return minutes === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${minutes}m`;
}
