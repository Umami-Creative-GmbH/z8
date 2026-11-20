import type {
	PayrollSettledDayAbsence,
	PayrollSettlementMethod,
} from "@/db/schema/payroll-settlement";
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

/** A day's values as settling pays them: credited minutes and approved absences. */
export interface PayrollSettledDayValues {
	creditedMinutes: number;
	/** Sorted by category and day period, so two copies compare as equal values. */
	absences: PayrollSettledDayAbsence[];
}

/** An active settlement of one employee-day, as the database part reads it. */
export interface PayrollSettledDaySource {
	id: string;
	employeeId: string;
	/** Employee-local calendar date. */
	date: string;
	method: PayrollSettlementMethod;
	payrollExportJobId: string | null;
	/** ISO instant. */
	settledAt: string;
	/** The copy taken at settling. */
	paid: PayrollSettledDayValues;
}

/**
 * Whether a day has been paid (#1896). #1897 adds the changed-since-settled state,
 * comparing the day's current values with `paid`.
 */
export type PayrollPeriodDaySettlement =
	| { state: "unsettled" }
	| ({ state: "settled"; settledDayId: string } & Omit<
			PayrollSettledDaySource,
			"id" | "employeeId" | "date"
	  >);

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
	/** Always set by the row builder; optional only for hand-built fixtures. */
	settlement?: PayrollPeriodDaySettlement;
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

/** Employee-days of the read by settlement state, for the status strip. */
export interface PayrollPeriodSettlementCounts {
	settledDays: number;
	unsettledDays: number;
}

export interface PayrollPeriodRead extends PayrollPeriodRows {
	organizationId: string;
	period: PayrollPeriod;
	settlement: PayrollPeriodSettlementCounts;
	blockers: PayrollBlocker[];
	/** The Overview projection of the same read; its totals equal the rows'. */
	summary: PayrollWorkspaceSummary;
}
