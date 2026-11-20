import type { Instant } from "@/lib/datetime/temporal-core";
import type {
	PayrollAbsenceDetailPeriod,
	PayrollBlocker,
	PayrollDayPeriod,
	PayrollPeriod,
	PayrollSummaryEmployeeSource,
	PayrollWorkspaceSummary,
} from "@/lib/payroll-workspace/types";

/** Inclusive calendar dates, each read as the employee's own local days. */
export interface PayrollPeriodRange {
	startDate: string;
	endDate: string;
	label: string;
}

/** The payroll access grant holder reading the period. */
export interface PayrollPeriodActor {
	/** Employee ID of the grant holder; the grant decides who is in scope. */
	employeeId: string;
	name: string;
}

/** Narrows the grant's scope; never widens it. */
export interface PayrollPeriodScope {
	employeeIds?: readonly string[];
}

export interface PayrollPeriodEmployeeSource extends PayrollSummaryEmployeeSource {
	/** Effective zone whose local days the employee's hours are attributed to. */
	timezone: string;
}

/**
 * Work credited to the period by the payroll credit rule: the credited part of one
 * record (its overlap with the employee-local period window) and its credited minutes.
 */
export interface CreditedWorkSpan {
	recordId: string;
	employeeId: string;
	startAt: Instant;
	endExclusive: Instant;
	minutes: number;
}

export type PayrollAbsenceApprovalState = "approved" | "pending";

/** One absence record overlapping the period, with its logical (employee-local) dates. */
export interface PayrollPeriodAbsenceSource {
	id: string;
	employeeId: string;
	categoryId: string;
	categoryName: string;
	categoryType: string | null;
	categoryColor: string | null;
	startDate: string;
	endDate: string;
	startPeriod: PayrollDayPeriod;
	endPeriod: PayrollDayPeriod;
	/** Wall-clock times of a timed partial absence, HH:mm:ss. */
	startTime?: string;
	endTime?: string;
	approvalState: PayrollAbsenceApprovalState;
}

export interface PayrollPeriodHolidaySource {
	name: string;
	/** Inclusive logical dates. */
	startDate: string;
	endDate: string;
}

export interface PayrollPeriodDayAbsence {
	absenceId: string;
	categoryId: string;
	categoryName: string;
	categoryType: string | null;
	categoryColor: string | null;
	period: PayrollAbsenceDetailPeriod;
	approvalState: PayrollAbsenceApprovalState;
}

export interface PayrollPeriodDay {
	/** Employee-local calendar date. */
	date: string;
	creditedMinutes: number;
	/** Null when no daily work requirement applies to the employee. */
	requiredMinutes: number | null;
	/** `creditedMinutes - requiredMinutes`, null without a requirement. */
	differenceMinutes: number | null;
	absences: PayrollPeriodDayAbsence[];
	holiday: { name: string } | null;
}

export interface PayrollPeriodTotals {
	/** Exactly the sum of the days' credited minutes, and the period credit. */
	creditedMinutes: number;
	requiredMinutes: number | null;
	differenceMinutes: number | null;
	/** Approved absence days (full day 1, half or partial day 0.5). */
	absenceDays: number;
}

export interface PayrollPeriodEmployee extends PayrollPeriodEmployeeSource {
	days: PayrollPeriodDay[];
	totals: PayrollPeriodTotals;
}

/** One row of the period's absence list. */
export interface PayrollPeriodAbsence extends PayrollPeriodAbsenceSource {
	/** Days of this absence inside the period (half and partial days count 0.5). */
	daysInPeriod: number;
}

export interface PayrollPeriodRows {
	employees: PayrollPeriodEmployee[];
	absences: PayrollPeriodAbsence[];
}

export interface PayrollPeriodRead extends PayrollPeriodRows {
	organizationId: string;
	period: PayrollPeriod;
	blockers: PayrollBlocker[];
	/** The Overview projection of the same read; its totals equal the rows'. */
	summary: PayrollWorkspaceSummary;
}
