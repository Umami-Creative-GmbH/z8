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
	/**
	 * Set for an employee who has left (#1894): the last working day of the effective
	 * departure, an employee-local date. Absent or null for an employee who has not left.
	 */
	departure?: PayrollPeriodDeparture | null;
}

export interface PayrollPeriodDeparture {
	lastWorkingDay: string;
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

/** How a settled day's current values differ from the copy taken at settling (#1897). */
export interface PayrollSettledDayChange {
	/** The day's values now. */
	current: PayrollSettledDayValues;
	/** Current minus paid credited minutes; positive when the day has more hours now. */
	creditedMinutesDifference: number;
	/** An approved absence was added, removed, or changed its category or day period. */
	absencesChanged: boolean;
}

type PayrollPeriodDaySettledFields = { settledDayId: string } & Omit<
	PayrollSettledDaySource,
	"id" | "employeeId" | "date"
>;

/**
 * Whether a day has been paid (#1896), and whether it changed since (#1897): a
 * settled day whose current values differ from `paid` is changed since settled.
 */
export type PayrollPeriodDaySettlement =
	| { state: "unsettled" }
	| ({ state: "settled" } & PayrollPeriodDaySettledFields)
	| ({
			state: "changed_since_settled";
			change: PayrollSettledDayChange;
	  } & PayrollPeriodDaySettledFields);

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
	/**
	 * Whether the employee recorded anything on this day: credited work touching it or an
	 * absence (pending included). A holiday alone is not an entry. Read it through
	 * `dayHasEntries`. Always set by the row builder; optional only for hand-built fixtures.
	 */
	hasEntries?: boolean;
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
	/** Days with an active settlement, changed since settled or not. */
	settledDays: number;
	/** The settled days whose values changed since settling (#1897). */
	changedSinceSettledDays: number;
	unsettledDays: number;
}

/** One work or break record touching an employee-local day (#1894 day side panel). */
export interface PayrollPeriodDayRecord {
	id: string;
	kind: "work" | "break";
	approvalState: "draft" | "pending" | "approved";
	/** Local wall clock in the employee's zone, `YYYY-MM-DDTHH:mm`. */
	start: string;
	/** Null while the record is still running. */
	end: string | null;
	/** Stored minutes of the whole record, null while it runs. */
	durationMinutes: number | null;
	/** For breaks: whether the break is paid. */
	isPaid: boolean | null;
}

/** The records behind one employee-day of a payroll period. */
export interface PayrollPeriodDayDetail {
	employeeId: string;
	/** Employee-local calendar date. */
	date: string;
	/** The zone the local times are shown in. */
	timezone: string;
	records: PayrollPeriodDayRecord[];
}

export interface PayrollPeriodRead extends PayrollPeriodRows {
	organizationId: string;
	period: PayrollPeriod;
	settlement: PayrollPeriodSettlementCounts;
	blockers: PayrollBlocker[];
	/** The Overview projection of the same read; its totals equal the rows'. */
	summary: PayrollWorkspaceSummary;
}
