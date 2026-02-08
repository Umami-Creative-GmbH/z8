import { createHash } from "node:crypto";
import type {
	ClockodoAbsence,
	ClockodoEntry,
	ClockodoHolidayQuota,
	ClockodoNonBusinessDay,
	ClockodoService,
	ClockodoSurcharge,
	ClockodoTargetHours,
	ClockodoTeam,
	ClockodoUser,
} from "./types";

// ============================================
// USER → EMPLOYEE MAPPING
// ============================================

/**
 * Map Clockodo absence type (1-15) to Z8 absence type enum.
 */
function mapAbsenceType(
	clockodoType: number,
):
	| "vacation"
	| "sick"
	| "home_office"
	| "personal"
	| "unpaid"
	| "parental"
	| "bereavement"
	| "custom" {
	switch (clockodoType) {
		case 1: // Regular holiday
			return "vacation";
		case 2: // Special leaves
			return "personal";
		case 3: // Reduction of overtime
			return "custom";
		case 4: // Sick day
		case 5: // Sick day of a child
		case 15: // Sick day (sickness benefit)
			return "sick";
		case 6: // School / further education
			return "custom";
		case 7: // Maternity protection
			return "parental";
		case 8: // Home office
		case 9: // Work out of office
			return "home_office";
		case 10: // Special leaves (unpaid)
		case 11: // Sick day (unpaid)
		case 12: // Sick day of a child (unpaid)
			return "unpaid";
		case 13: // Quarantine
			return "sick";
		case 14: // Military / alternative service
			return "custom";
		default:
			return "custom";
	}
}

/**
 * Get a human-readable name for a Clockodo absence type.
 */
function getAbsenceTypeName(clockodoType: number): string {
	const names: Record<number, string> = {
		1: "Regular holiday",
		2: "Special leaves",
		3: "Overtime reduction",
		4: "Sick day",
		5: "Sick day (child)",
		6: "Education / training",
		7: "Maternity protection",
		8: "Home office",
		9: "Work out of office",
		10: "Special leaves (unpaid)",
		11: "Sick day (unpaid)",
		12: "Sick day of child (unpaid)",
		13: "Quarantine",
		14: "Military / alternative service",
		15: "Sick day (sickness benefit)",
	};
	return names[clockodoType] ?? `Unknown (${clockodoType})`;
}

/**
 * Map Clockodo absence status to Z8 approval status.
 */
function mapAbsenceStatus(status: number): "pending" | "approved" | "rejected" {
	switch (status) {
		case 1: // approved
			return "approved";
		case 2: // declined
		case 3: // approval cancelled
		case 4: // request cancelled
			return "rejected";
		default:
			return "pending";
	}
}

/**
 * Split a full name into first and last name.
 */
function splitName(name: string): { firstName: string; lastName: string } {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) {
		return { firstName: parts[0], lastName: "" };
	}
	const lastName = parts.pop() ?? "";
	return { firstName: parts.join(" "), lastName };
}

/**
 * Map a Clockodo user to Z8 employee fields.
 */
export function mapUserToEmployee(user: ClockodoUser, organizationId: string, authUserId: string) {
	const { firstName, lastName } = splitName(user.name);
	return {
		userId: authUserId, // Will be set after Better Auth user creation
		organizationId,
		firstName,
		lastName,
		role: "employee" as const,
		employeeNumber: user.number,
		isActive: user.active,
		contractType: user.wage_type === 2 ? ("hourly" as const) : ("fixed" as const),
		// teamId will be set in a second pass after teams are imported
	};
}

// ============================================
// TEAM MAPPING
// ============================================

export function mapTeamToZ8(team: ClockodoTeam, organizationId: string) {
	return {
		organizationId,
		name: team.name,
	};
}

// ============================================
// SERVICE → WORK CATEGORY MAPPING
// ============================================

export function mapServiceToWorkCategory(
	service: ClockodoService,
	organizationId: string,
	createdBy: string,
) {
	return {
		organizationId,
		name: service.name,
		description: service.note,
		factor: "1.00", // Clockodo doesn't have factors
		isActive: service.active,
		createdBy,
	};
}

// ============================================
// ENTRY → WORK PERIOD + TIME ENTRIES MAPPING
// ============================================

/**
 * Create a hash for a synthetic time entry (for imported data).
 */
function createTimeEntryHash(data: {
	employeeId: string;
	organizationId: string;
	type: string;
	timestamp: string;
}): string {
	return createHash("sha256")
		.update(`${data.employeeId}:${data.organizationId}:${data.type}:${data.timestamp}:imported`)
		.digest("hex");
}

/**
 * Map a Clockodo time entry to Z8 time entries + work period.
 * Returns the data needed to create both clock-in/out time entries and the work period.
 */
export function mapEntryToWorkPeriod(
	entry: ClockodoEntry,
	employeeId: string,
	organizationId: string,
	createdBy: string,
	workCategoryId: string | null,
) {
	const startTime = new Date(entry.time_since);
	const endTime = entry.time_until ? new Date(entry.time_until) : null;
	const durationMinutes = endTime ? Math.round(entry.duration / 60) : null;

	const clockInHash = createTimeEntryHash({
		employeeId,
		organizationId,
		type: "clock_in",
		timestamp: entry.time_since,
	});

	const clockIn = {
		employeeId,
		organizationId,
		type: "clock_in" as const,
		timestamp: startTime,
		hash: clockInHash,
		notes: entry.text || null,
		createdBy,
		createdAt: new Date(entry.time_insert),
	};

	const clockOut = endTime
		? {
				employeeId,
				organizationId,
				type: "clock_out" as const,
				timestamp: endTime,
				hash: createTimeEntryHash({
					employeeId,
					organizationId,
					type: "clock_out",
					timestamp: entry.time_until!,
				}),
				previousHash: clockInHash,
				createdBy,
				createdAt: new Date(entry.time_insert),
			}
		: null;

	const workPeriod = {
		employeeId,
		organizationId,
		startTime,
		endTime,
		durationMinutes,
		isActive: !endTime,
		projectId: null as string | null, // Projects excluded from import
		workCategoryId,
		approvalStatus: "approved" as const,
	};

	return { clockIn, clockOut, workPeriod };
}

// ============================================
// ABSENCE MAPPING
// ============================================

/**
 * Map a Clockodo absence to Z8 absence entry fields.
 * Returns both the absence category info and the entry data.
 */
export function mapAbsenceToZ8(
	absence: ClockodoAbsence,
	employeeId: string,
	absenceCategoryId: string,
) {
	return {
		employeeId,
		categoryId: absenceCategoryId,
		startDate: absence.date_since,
		startPeriod: "full_day" as const,
		endDate: absence.date_until,
		endPeriod: "full_day" as const,
		status: mapAbsenceStatus(absence.status),
		notes: absence.note,
	};
}

/**
 * Get absence category info from a Clockodo absence type.
 */
export function getAbsenceCategoryInfo(clockodoType: number) {
	return {
		type: mapAbsenceType(clockodoType),
		name: getAbsenceTypeName(clockodoType),
	};
}

// ============================================
// TARGET HOURS → WORK POLICY MAPPING
// ============================================

/**
 * Map Clockodo target hours to a Z8 work policy + schedule.
 */
export function mapTargetHoursToWorkPolicy(
	targetHours: ClockodoTargetHours,
	organizationId: string,
	createdBy: string,
) {
	if (targetHours.type === "weekly") {
		const totalHours =
			targetHours.monday +
			targetHours.tuesday +
			targetHours.wednesday +
			targetHours.thursday +
			targetHours.friday +
			targetHours.saturday +
			targetHours.sunday;

		return {
			policy: {
				organizationId,
				name: `Imported ${totalHours}h/week (from ${targetHours.date_since})`,
				scheduleEnabled: true,
				regulationEnabled: false,
				createdBy,
			},
			schedule: {
				scheduleCycle: "weekly" as const,
				scheduleType: "detailed" as const,
				workingDaysPreset: "custom" as const,
				hoursPerCycle: String(totalHours),
			},
			days: [
				{
					dayOfWeek: "monday" as const,
					hoursPerDay: String(targetHours.monday),
					isWorkDay: targetHours.monday > 0,
				},
				{
					dayOfWeek: "tuesday" as const,
					hoursPerDay: String(targetHours.tuesday),
					isWorkDay: targetHours.tuesday > 0,
				},
				{
					dayOfWeek: "wednesday" as const,
					hoursPerDay: String(targetHours.wednesday),
					isWorkDay: targetHours.wednesday > 0,
				},
				{
					dayOfWeek: "thursday" as const,
					hoursPerDay: String(targetHours.thursday),
					isWorkDay: targetHours.thursday > 0,
				},
				{
					dayOfWeek: "friday" as const,
					hoursPerDay: String(targetHours.friday),
					isWorkDay: targetHours.friday > 0,
				},
				{
					dayOfWeek: "saturday" as const,
					hoursPerDay: String(targetHours.saturday),
					isWorkDay: targetHours.saturday > 0,
				},
				{
					dayOfWeek: "sunday" as const,
					hoursPerDay: String(targetHours.sunday),
					isWorkDay: targetHours.sunday > 0,
				},
			],
			dateSince: targetHours.date_since,
			dateUntil: targetHours.date_until,
			clockodoUserId: targetHours.users_id,
		};
	}

	// Monthly type
	return {
		policy: {
			organizationId,
			name: `Imported ${targetHours.monthly_target}h/month (from ${targetHours.date_since})`,
			scheduleEnabled: true,
			regulationEnabled: false,
			createdBy,
		},
		schedule: {
			scheduleCycle: "monthly" as const,
			scheduleType: "simple" as const,
			workingDaysPreset: "custom" as const,
			hoursPerCycle: String(targetHours.monthly_target),
		},
		days: [
			{ dayOfWeek: "monday" as const, hoursPerDay: "0", isWorkDay: targetHours.workday_monday },
			{ dayOfWeek: "tuesday" as const, hoursPerDay: "0", isWorkDay: targetHours.workday_tuesday },
			{
				dayOfWeek: "wednesday" as const,
				hoursPerDay: "0",
				isWorkDay: targetHours.workday_wednesday,
			},
			{ dayOfWeek: "thursday" as const, hoursPerDay: "0", isWorkDay: targetHours.workday_thursday },
			{ dayOfWeek: "friday" as const, hoursPerDay: "0", isWorkDay: targetHours.workday_friday },
			{ dayOfWeek: "saturday" as const, hoursPerDay: "0", isWorkDay: targetHours.workday_saturday },
			{ dayOfWeek: "sunday" as const, hoursPerDay: "0", isWorkDay: targetHours.workday_sunday },
		],
		dateSince: targetHours.date_since,
		dateUntil: targetHours.date_until,
		clockodoUserId: targetHours.users_id,
	};
}

// ============================================
// HOLIDAY QUOTA → VACATION ALLOWANCE MAPPING
// ============================================

export function mapHolidayQuotaToVacationAllowance(
	quota: ClockodoHolidayQuota,
	employeeId: string,
) {
	return {
		employeeId,
		year: quota.year_since,
		customAnnualDays: String(quota.count),
	};
}

// ============================================
// NON-BUSINESS DAY → HOLIDAY MAPPING
// ============================================

export function mapNonBusinessDayToHoliday(
	day: ClockodoNonBusinessDay,
	organizationId: string,
	categoryId: string,
	createdBy: string,
) {
	const date = new Date(day.date);
	return {
		organizationId,
		categoryId,
		name: day.name,
		startDate: date,
		endDate: date,
		recurrenceType: "none" as const,
		isActive: true,
		createdBy,
	};
}

// ============================================
// SURCHARGE MAPPING
// ============================================

/**
 * Map a Clockodo surcharge to Z8 surcharge model + rules.
 */
export function mapSurchargeToZ8(
	surcharge: ClockodoSurcharge,
	organizationId: string,
	createdBy: string,
) {
	const model = {
		organizationId,
		name: surcharge.name,
		isActive: true,
		createdBy,
	};

	const rules: Array<{
		name: string;
		ruleType: "day_of_week" | "time_window";
		percentage: string;
		dayOfWeek?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
		windowStartTime?: string;
		windowEndTime?: string;
		createdBy: string;
	}> = [];

	// Night surcharge → time_window rule
	if (surcharge.night > 0) {
		rules.push({
			name: `${surcharge.name} - Night`,
			ruleType: "time_window",
			percentage: String(surcharge.night / 100),
			windowStartTime: surcharge.night_since,
			windowEndTime: surcharge.night_until,
			createdBy,
		});
	}

	// Day-specific surcharges
	const dayMap = {
		monday: surcharge.monday,
		tuesday: surcharge.tuesday,
		wednesday: surcharge.wednesday,
		thursday: surcharge.thursday,
		friday: surcharge.friday,
		saturday: surcharge.saturday,
		sunday: surcharge.sunday,
	} as const;

	for (const [day, percentage] of Object.entries(dayMap)) {
		if (percentage > 0) {
			rules.push({
				name: `${surcharge.name} - ${day.charAt(0).toUpperCase() + day.slice(1)}`,
				ruleType: "day_of_week",
				percentage: String(percentage / 100),
				dayOfWeek: day as
					| "monday"
					| "tuesday"
					| "wednesday"
					| "thursday"
					| "friday"
					| "saturday"
					| "sunday",
				createdBy,
			});
		}
	}

	return { model, rules };
}
