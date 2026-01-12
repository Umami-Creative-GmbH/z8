// Day period for half-day absences
export type DayPeriod = "full_day" | "am" | "pm";

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
	notes?: string;
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
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
		countsAgainstVacation: boolean;
	};
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
