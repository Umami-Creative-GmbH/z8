import type { DateTime } from "luxon";

export type PayrollDayPeriod = "full_day" | "am" | "pm";

export type PayrollDateRangeMode = "month" | "week" | "custom";

export interface PayrollPeriod {
	start: string;
	end: string;
	label: string;
}

export interface PayrollSummaryEmployeeSource {
	id: string;
	name: string;
	employeeNumber: string | null;
	teamName: string | null;
	contractType: "fixed" | "hourly";
}

export interface PayrollSummaryWorkRow {
	employeeId: string;
	durationMinutes: number | null;
	startAt?: DateTime;
	endAt?: DateTime | null;
}

export interface PayrollSummaryAbsenceRow {
	employeeId: string;
	categoryId: string;
	categoryName: string;
	days?: number;
	startAt?: DateTime;
	endAt?: DateTime | null;
	startPeriod?: PayrollDayPeriod;
	endPeriod?: PayrollDayPeriod;
}

export type PayrollBlockerType =
	| "missing_clock_out"
	| "pending_absence"
	| "pending_time_correction";

export interface PayrollBlocker {
	id: string;
	employeeId: string;
	type: PayrollBlockerType;
	label: string;
}

export interface PayrollAbsenceDaysByCategory {
	categoryId: string;
	categoryName: string;
	days: number;
}

export interface PayrollEmployeeSummary extends PayrollSummaryEmployeeSource {
	workedHours: number;
	absenceDaysByCategory: PayrollAbsenceDaysByCategory[];
	hasBlockers: boolean;
}

export interface PayrollWorkspaceSummary {
	organizationName: string;
	period: PayrollPeriod;
	generatedAt: DateTime;
	generatedBy: { id: string; name: string };
	totals: {
		employeeCount: number;
		totalWorkedHours: number;
		blockerCount: number;
	};
	employees: PayrollEmployeeSummary[];
	blockers: PayrollBlocker[];
}
