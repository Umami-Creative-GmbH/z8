/**
 * Report types and interfaces for employee reports feature
 */

export type PeriodPreset =
	| "last_month"
	| "current_month"
	| "last_year"
	| "current_year"
	| "q1"
	| "q2"
	| "q3"
	| "q4"
	| "ytd"
	| "custom";

export interface DateRange {
	start: Date;
	end: Date;
}

export interface EmployeeInfo {
	id: string;
	name: string;
	employeeNumber?: string | null;
	position?: string | null;
	email?: string;
	contractType?: "fixed" | "hourly";
	currentHourlyRate?: string | null;
}

export interface PeriodInfo {
	startDate: Date;
	endDate: Date;
	label: string;
}

export interface WorkHoursSummary {
	hours: number;
	days: number;
}

export interface WorkHoursData {
	totalHours: number;
	totalMinutes: number;
	workDays: number;
	averagePerDay: number;
	byMonth: Map<string, WorkHoursSummary>;
}

export interface AbsenceSummary {
	days: number;
	hours?: number;
}

export interface HomeOfficeDetail {
	date: Date;
	hours: number;
}

export interface HomeOfficeData {
	days: number;
	hoursWorked: number;
	dateDetails: HomeOfficeDetail[];
}

export interface AbsencesData {
	totalDays: number;
	byCategory: Map<string, AbsenceSummary>;
	vacation: {
		approved: number;
		pending: number;
	};
	sick: {
		approved: number;
		pending: number;
	};
	homeOffice: HomeOfficeData;
	other: {
		approved: number;
		pending: number;
	};
}

export interface ComplianceMetrics {
	attendancePercentage: number;
	overtimeMinutes: number;
	underTimeMinutes: number;
	/** Work schedule info for context */
	scheduleInfo?: { name: string; source: string } | null;
	/** Expected work minutes based on schedule */
	expectedWorkMinutes?: number;
}

export interface RatePeriodEarnings {
	rate: number;
	currency: string;
	periodStart: Date;
	periodEnd: Date;
	hours: number;
	earnings: number;
}

export interface HourlyEarningsData {
	totalHours: number;
	totalEarnings: number;
	currency: string;
	/** Breakdown by rate period (for rate changes mid-period) */
	byRatePeriod: RatePeriodEarnings[];
}

export interface ReportData {
	employee: EmployeeInfo;
	period: PeriodInfo;
	workHours: WorkHoursData;
	absences: AbsencesData;
	complianceMetrics: ComplianceMetrics;
	/** Earnings data (only for hourly employees) */
	hourlyEarnings?: HourlyEarningsData;
}

export interface ReportFilters {
	employeeId: string;
	startDate: Date;
	endDate: Date;
	preset?: PeriodPreset;
}

export interface AccessibleEmployee {
	id: string;
	name: string;
	email: string;
	position: string | null;
	role: "admin" | "manager" | "employee";
}
