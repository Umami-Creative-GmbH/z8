import type { DateTime } from "luxon";

export type PayrollDayPeriod = "full_day" | "am" | "pm";

export type PayrollAbsenceDetailPeriod = PayrollDayPeriod | "partial_day";

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

export interface PayrollSummaryAbsenceRangeRow {
	employeeId: string;
	categoryId: string;
	categoryName: string;
	startDate: string;
	endDate: string;
	startPeriod: PayrollDayPeriod;
	endPeriod: PayrollDayPeriod;
	startTime?: string;
	endTime?: string;
}

export type PayrollSummaryAbsenceRow = PayrollSummaryAbsenceRangeRow;

export interface PayrollAbsenceDetail {
	employeeId: string;
	categoryId: string;
	categoryName: string;
	date: string;
	period: PayrollAbsenceDetailPeriod;
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
	date: string | null;
	time: string | null;
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
	generatedAt: string;
	generatedBy: { id: string; name: string };
	totals: {
		employeeCount: number;
		totalWorkedHours: number;
		blockerCount: number;
	};
	employees: PayrollEmployeeSummary[];
	absenceDetails: PayrollAbsenceDetail[];
	blockers: PayrollBlocker[];
}
