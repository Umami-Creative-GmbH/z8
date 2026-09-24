import type { Instant } from "@/lib/datetime/temporal-core";

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
	id: string;
	employeeId: string;
	/** Effective employee timezone that defines the employee-local payroll window. */
	timezone: string;
	startAt: Instant;
	endAt: Instant;
	durationMinutes: number | null;
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

export type DismissiblePayrollBlockerType =
	| "missing_clock_out"
	| "pending_absence"
	| "pending_time_correction";

/**
 * `unresolved_work_minutes` marks completed work whose payroll credit cannot be allocated to the
 * period. `offboarding_clock_repair` marks a departure whose running timer could not be closed
 * safely. Both block exports, so they cannot be cleared as false positives.
 */
export type PayrollBlockerType =
	| DismissiblePayrollBlockerType
	| "unresolved_work_minutes"
	| "offboarding_clock_repair";

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
