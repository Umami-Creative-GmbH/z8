// ============================================
// CLOCKODO API RESPONSE TYPES
// ============================================

/** Clockodo user object from /api/v2/users */
export interface ClockodoUser {
	id: number;
	name: string;
	number: string | null;
	email: string;
	role: string;
	active: boolean;
	teams_id: number | null;
	timezone: string;
	wage_type: number | null; // 1 = salary, 2 = hourly
	language: string; // "de", "en", "fr"
}

/** Clockodo team object from /api/v2/teams */
export interface ClockodoTeam {
	id: number;
	name: string;
	leader: number | null; // user ID of team leader
}

/** Clockodo service object from /api/v2/services */
export interface ClockodoService {
	id: number;
	name: string;
	number: string | null;
	active: boolean;
	note: string | null;
}

/** Clockodo time entry (type=1) from /api/v2/entries */
export interface ClockodoEntry {
	id: number;
	customers_id: number;
	projects_id: number | null;
	users_id: number;
	billable: number; // 0=not billable, 1=billable, 2=billed
	texts_id: number | null;
	time_since: string; // ISO 8601 UTC
	time_until: string | null; // ISO 8601 UTC
	time_insert: string; // ISO 8601 UTC
	time_last_change: string; // ISO 8601 UTC
	type: number; // 1=time, 2=lump sum value, 3=lump sum service
	services_id: number;
	duration: number; // seconds
	offset: number; // time correction in seconds
	clocked: boolean;
	clocked_offline: boolean;
	// Enhanced list mode fields (optional)
	text?: string | null;
	customers_name?: string;
	projects_name?: string | null;
	users_name?: string;
	services_name?: string;
}

/**
 * Clockodo absence object from /api/absences
 *
 * Type IDs:
 * 1 = Regular holiday
 * 2 = Special leaves
 * 3 = Reduction of overtime
 * 4 = Sick day
 * 5 = Sick day of a child
 * 6 = School / further education
 * 7 = Maternity protection
 * 8 = Home office
 * 9 = Work out of office
 * 10 = Special leaves (unpaid)
 * 11 = Sick day (unpaid)
 * 12 = Sick day of a child (unpaid)
 * 13 = Quarantine
 * 14 = Military / alternative service
 * 15 = Sick day (sickness benefit)
 */
export interface ClockodoAbsence {
	id: number;
	users_id: number;
	date_since: string; // YYYY-MM-DD
	date_until: string; // YYYY-MM-DD
	status: number; // 0=enquired, 1=approved, 2=declined, 3=approval cancelled, 4=request cancelled
	type: number; // 1-15, see above
	note: string | null;
	count_days: number;
	count_hours: number | null;
	sick_note: boolean | null;
	date_enquired: string | null;
	date_approved: string | null;
	approved_by: number | null;
}

/** Clockodo target hours (weekly variant) from /api/targethours */
export interface ClockodoTargetHoursWeekly {
	id: number;
	users_id: number;
	type: "weekly";
	date_since: string; // YYYY-MM-DD
	date_until: string | null; // YYYY-MM-DD
	monday: number;
	tuesday: number;
	wednesday: number;
	thursday: number;
	friday: number;
	saturday: number;
	sunday: number;
	compensation_monthly: number;
	compensation_daily: number;
	absence_fixed_credit: boolean;
}

/** Clockodo target hours (monthly variant) from /api/targethours */
export interface ClockodoTargetHoursMonthly {
	id: number;
	users_id: number;
	type: "monthly";
	date_since: string; // YYYY-MM-DD
	date_until: string | null; // YYYY-MM-DD
	monthly_target: number;
	workday_monday: boolean;
	workday_tuesday: boolean;
	workday_wednesday: boolean;
	workday_thursday: boolean;
	workday_friday: boolean;
	workday_saturday: boolean;
	workday_sunday: boolean;
	compensation_monthly: number;
}

export type ClockodoTargetHours = ClockodoTargetHoursWeekly | ClockodoTargetHoursMonthly;

/** Clockodo holiday quota from /api/holidaysquota */
export interface ClockodoHolidayQuota {
	id: number;
	users_id: number;
	year_since: number; // YYYY
	year_until: number | null; // YYYY
	count: number; // days (full and half values)
}

/** Clockodo non-business day from /api/nonbusinessdays */
export interface ClockodoNonBusinessDay {
	id: number;
	date: string; // date string
	name: string;
	half_day: number; // 0 or 1
	nonbusinessgroups_id: number;
}

/** Clockodo surcharge model from /api/v2/surcharges */
export interface ClockodoSurcharge {
	id: number;
	name: string;
	accumulation: boolean;
	night: number; // percentage
	night_since: string; // HH:mm
	night_until: string; // HH:mm
	nonbusiness: number; // percentage
	nonbusiness_special: boolean;
	saturday: number; // percentage
	sunday: number; // percentage
	monday: number;
	tuesday: number;
	wednesday: number;
	thursday: number;
	friday: number;
}

// ============================================
// USER MAPPING TYPES
// ============================================

export type UserMappingType = "auto_email" | "manual" | "new_employee" | "skipped";

export interface UserMappingEntry {
	clockodoUserId: number;
	clockodoUserName: string;
	clockodoUserEmail: string;
	mappingType: UserMappingType;
	/** Z8 employee ID (null when skipped or new_employee before creation) */
	employeeId: string | null;
	/** Z8 auth user ID (null when skipped) */
	userId: string | null;
	/** Display name of the matched employee (for UI) */
	employeeName: string | null;
}

// ============================================
// DATE RANGE TYPES
// ============================================

export type DateRangePreset =
	| "all_data"
	| "this_year"
	| "this_year_and_last"
	| "last_6_months"
	| "last_12_months"
	| "custom";

export interface DateRangeFilter {
	preset: DateRangePreset;
	startDate: string | null;
	endDate: string | null;
}

// ============================================
// IMPORT CONFIGURATION TYPES
// ============================================

/** What the user selected to import */
export interface ImportSelections {
	users: boolean;
	teams: boolean;
	services: boolean;
	entries: boolean;
	absences: boolean;
	targetHours: boolean;
	holidayQuotas: boolean;
	nonBusinessDays: boolean;
	surcharges: boolean;
	dateRange: DateRangeFilter;
}

/** Preview data counts returned after credential validation */
export interface ClockodoDataPreview {
	users: number;
	teams: number;
	services: number;
	entries: number;
	absences: number;
	targetHours: number;
	holidayQuotas: number;
	nonBusinessDays: number;
	surcharges: number;
}

/** Result for a single entity type import */
export interface EntityImportResult {
	imported: number;
	skipped: number;
	errors: string[];
}

/** Full import result */
export interface ImportResult {
	users: EntityImportResult;
	teams: EntityImportResult;
	services: EntityImportResult;
	entries: EntityImportResult;
	absences: EntityImportResult;
	targetHours: EntityImportResult;
	holidayQuotas: EntityImportResult;
	nonBusinessDays: EntityImportResult;
	surcharges: EntityImportResult;
	status: "success" | "partial" | "failed";
	durationMs: number;
	errorMessage?: string;
}

/** ID mapping from Clockodo IDs to Z8 UUIDs */
export interface IdMappings {
	users: Map<number, { employeeId: string; userId: string }>;
	teams: Map<number, string>;
	services: Map<number, string>;
}
