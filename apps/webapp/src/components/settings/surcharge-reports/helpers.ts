import { DateTime } from "luxon";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";
import { DATE_FORMAT } from "./constants";
import type { FilterValues } from "./types";

export function getDefaultFilters(): FilterValues {
	const now = DateTime.now();

	return {
		startDate: now.startOf("month").toFormat(DATE_FORMAT),
		endDate: now.endOf("month").toFormat(DATE_FORMAT),
		employeeId: "",
	};
}

export function parseFilterDate(value: string, boundary: "start" | "end") {
	const parsed = DateTime.fromFormat(value, DATE_FORMAT, { zone: "local" });

	return boundary === "start" ? parsed.startOf("day") : parsed.endOf("day");
}

export function formatMinutes(minutes: number) {
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	return `${hours}h ${remainingMinutes}m`;
}

export function formatMinutesCell(minutes: number) {
	return `${minutes} min`;
}

export function formatDate(value: Date) {
	return DateTime.fromJSDate(value).toLocaleString(DateTime.DATE_MED);
}

export function formatTimestamp(value: Date | string) {
	const dateTime = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value);

	return dateTime.isValid ? dateTime.toLocaleString(DateTime.DATETIME_MED) : "-";
}

export function formatPercentage(value: number | string) {
	const numeric = typeof value === "string" ? Number.parseFloat(value) : value;

	if (!Number.isFinite(numeric)) {
		return "-";
	}

	return `${Math.round(numeric * 100)}%`;
}

export function getEmployeeName(calculation: SurchargeCalculationWithDetails) {
	return buildAuthUserDisplayName(calculation.employee) || calculation.employee.id;
}
