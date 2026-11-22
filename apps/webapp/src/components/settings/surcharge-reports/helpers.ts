import { Temporal } from "temporal-polyfill";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	type Instant,
	instantFromDate,
	parseInstant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { formatInstant, localeDefaultTimeFormat } from "@/lib/datetime/temporal-format";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";
import type { FilterValues } from "./types";

export function getDefaultFilters(): FilterValues {
	const today = Temporal.Now.plainDateISO();
	const yearMonth = today.toPlainYearMonth();

	return {
		startDate: yearMonth.toPlainDate({ day: 1 }).toString(),
		endDate: yearMonth.toPlainDate({ day: yearMonth.daysInMonth }).toString(),
		employeeId: "",
	};
}

export function parseFilterDate(value: string, boundary: "start" | "end"): Instant | null {
	try {
		const plainDate = parsePlainDate(value);
		const range = localDayRange(plainDate.toString(), Temporal.Now.timeZoneId());
		return boundary === "start" ? range.start : range.endExclusive.subtract({ milliseconds: 1 });
	} catch {
		return null;
	}
}

export function formatMinutes(minutes: number) {
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	return `${hours}h ${remainingMinutes}m`;
}

export function formatMinutesCell(minutes: number) {
	return `${minutes} min`;
}

export function formatDate(value: Date, locale = "en") {
	return formatInstant(
		instantFromDate(value),
		{
			locale,
			timezone: Temporal.Now.timeZoneId(),
			timeFormat: localeDefaultTimeFormat(locale),
		},
		"dateMedium",
	);
}

export function formatTimestamp(value: Date | string, locale = "en") {
	try {
		const instant = typeof value === "string" ? parseInstant(value) : instantFromDate(value);
		return formatInstant(
			instant,
			{
				locale,
				timezone: Temporal.Now.timeZoneId(),
				timeFormat: localeDefaultTimeFormat(locale),
			},
			"dateTimeMedium",
		);
	} catch {
		return "-";
	}
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
