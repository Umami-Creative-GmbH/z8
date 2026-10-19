import type { ProratedAllowance } from "./prorated-allowance";

// Legacy half-day compatibility period for absence forms and stored requests.
export type DayPeriod = "full_day" | "am" | "pm";
export type SickDetail =
	| "child_sick"
	| "with_certificate"
	| "without_certificate"
	| "other";

export type AbsenceDurationKind = "full_day" | "partial_day";

export interface VacationBalance {
	year: number;
	totalDays: number; // Annual allowance (default + custom + carryover + adjustments)
	/**
	 * The days of the vacation allowance in 	otalDays: the custom or policy allowance, prorated in
	 * a start or exit year (#1110), or 0 on an accrual policy, whose accrual adjustments carry it
	 * (#1106).
	 */
	allowanceDays: number;
	/** Historical usage included in usedDays; never changes allowanceDays. */
	previouslyTakenDays?: number;
	usedDays: number; // Approved absences and historical usage taken
	pendingDays: number; // Pending requests
	remainingDays: number; // Available to request; never below 0
	/**
	 * Approved vacation taken beyond `totalDays` (overdrawn vacation, #1111). Shown to admins and
	 * managers for information only: it is never reclaimed or deducted.
	 */
	overdrawnDays: number;
	carryoverDays?: number; // From previous year
	carryoverExpiryDate?: Date;
	carryoverExpiryTimezone?: string; // When carryover expires
	/** The vacation allowance in `totalDays` and why it is prorated or full (#1110). */
	allowance?: ProratedAllowance;
}

export interface AbsenceRequest {
	categoryId: string;
	startDate: string; // YYYY-MM-DD format
	startPeriod: DayPeriod;
	endDate: string; // YYYY-MM-DD format
	endPeriod: DayPeriod;
	durationKind?: AbsenceDurationKind;
	startTime?: string;
	endTime?: string;
	notes?: string;
	sickDetail?: SickDetail;
	/** The colleague covering while the employee is away (#1011). */
	deputyEmployeeId?: string;
}

export interface EmployeeAllowanceUpdate {
	employeeId: string;
	year: number;
	customAnnualDays?: number;
	customCarryoverDays?: number;
	adjustmentDays?: number;
	adjustmentReason?: string;
}

export interface AbsenceWithCategory {
	id: string;
	employeeId: string;
	startDate: string; // YYYY-MM-DD format
	startPeriod: DayPeriod;
	endDate: string; // YYYY-MM-DD format
	endPeriod: DayPeriod;
	status: "pending" | "approved" | "rejected";
	notes: string | null;
	sickDetail: SickDetail | null;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
		countsAgainstVacation: boolean;
		/** Absences of this category must name a deputy (#1011). */
		deputyRequired?: boolean;
	};
	/** Who covers while the employee is away (#1011); loaded where it is shown. */
	deputy?: { id: string; name: string; canOpenProfile?: boolean } | null;
	approvedBy: string | null;
	approvedAt: Date | null;
	rejectionReason: string | null;
	createdAt: Date;
}

/** An absence with its absence days, resolved on the server (Absences ADR 0001). */
export interface AbsenceWithDays extends AbsenceWithCategory {
	absenceDays: number;
}

export interface Holiday {
	id: string;
	name: string;
	startDate: Date;
	endDate: Date;
	categoryId: string;
}

/** One reviewed problem period of a vacation balance configuration. */
export interface VacationConfigurationProblemPeriod {
	startDate: string;
	endDate: string;
	policyIds?: string[];
	/**
	 * `zero_working_days`: the effective work policy explicitly schedules no working days, so the
	 * allowance cannot be converted to the working week (Absences ADR 0003).
	 */
	reason?: "incompatible_transition" | "zero_working_days";
	/** The work policy of a `zero_working_days` period. */
	workPolicyId?: string | null;
}

/** Whether the required employee policy periods can produce a reliable balance. */
export type VacationBalanceConfiguration =
	| { status: "resolved" | "legacy" }
	| {
			status: "missing" | "conflict";
			periods: VacationConfigurationProblemPeriod[];
	  };

/** A conflict that comes from a work schedule without working days, not from vacation policies. */
export function hasZeroWorkingDaysSchedule(
	configuration: VacationBalanceConfiguration | undefined | null,
): boolean {
	return (
		configuration?.status === "conflict" &&
		configuration.periods.some((period) => period.reason === "zero_working_days")
	);
}

/** Human-readable refusal for reviewed operations that require a known allowance. */
export function vacationConfigurationProblem(
	configuration: VacationBalanceConfiguration | undefined | null,
): string {
	if (hasZeroWorkingDaysSchedule(configuration))
		return "A work schedule without working days requires review for the selected year.";
	return configuration?.status === "conflict"
		? "Conflicting vacation policies require review for the selected year."
		: "Missing vacation policy coverage requires review for the selected year.";
}
