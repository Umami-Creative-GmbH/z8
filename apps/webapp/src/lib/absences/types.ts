// Legacy half-day compatibility period for absence forms and stored requests.
export type DayPeriod = "full_day" | "am" | "pm";
export type SickDetail = "child_sick" | "with_certificate" | "without_certificate" | "other";

export type AbsenceDurationKind = "full_day" | "partial_day";

export interface VacationBalance {
	year: number;
	totalDays: number; // Annual allowance (default + custom + carryover + adjustments)
	usedDays: number; // Approved absences taken
	pendingDays: number; // Pending requests
	remainingDays: number; // Available to request
	carryoverDays?: number; // From previous year
	carryoverExpiryDate?: Date; // When carryover expires
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

export interface Holiday {
	id: string;
	name: string;
	startDate: Date;
	endDate: Date;
	categoryId: string;
}
