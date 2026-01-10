/**
 * Report generator service
 * Aggregates data from time tracking and absences for comprehensive employee reports
 */

import { and, eq, gte, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory, absenceEntry, employee, workPeriod } from "@/db/schema";
import { calculateBusinessDays } from "@/lib/absences/date-utils";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import {
	eachDayOfInterval,
	endOfDay,
	format,
	fromJSDate,
	startOfDay,
	toJSDate,
} from "@/lib/datetime/luxon-utils";
import {
	calculateExpectedWorkHoursForEmployee,
	calculateWorkHours,
} from "@/lib/time-tracking/calculations";
import { formatDateRangeLabel } from "./date-ranges";
import type {
	AbsenceSummary,
	AbsencesData,
	ComplianceMetrics,
	HomeOfficeData,
	HomeOfficeDetail,
	ReportData,
	WorkHoursData,
	WorkHoursSummary,
} from "./types";

/**
 * Generate a comprehensive employee report
 * @param employeeId - ID of the employee
 * @param organizationId - ID of the organization
 * @param startDate - Report start date
 * @param endDate - Report end date
 * @returns Complete report data
 */
export async function generateEmployeeReport(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<ReportData> {
	// Fetch employee info
	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
		with: {
			user: true,
		},
	});

	if (!emp) {
		throw new Error("Employee not found");
	}

	// Aggregate data in parallel
	const [workHours, absences, homeOffice, expectedHours] = await Promise.all([
		aggregateWorkHours(employeeId, organizationId, startDate, endDate),
		aggregateAbsences(employeeId, startDate, endDate),
		aggregateHomeOfficeDays(employeeId, startDate, endDate),
		calculateExpectedWorkHoursForEmployee(employeeId, organizationId, startDate, endDate),
	]);

	// Calculate compliance metrics using schedule-based expected hours
	const complianceMetrics = calculateComplianceMetrics(workHours, absences, expectedHours);

	return {
		employee: {
			id: emp.id,
			name: emp.user.name || emp.user.email,
			employeeNumber: emp.employeeNumber,
			position: emp.position,
			email: emp.user.email,
		},
		period: {
			startDate,
			endDate,
			label: formatDateRangeLabel(startDate, endDate),
		},
		workHours,
		absences: {
			...absences,
			homeOffice,
		},
		complianceMetrics,
	};
}

/**
 * Aggregate work hours with monthly breakdown
 * @param employeeId - ID of the employee
 * @param organizationId - ID of the organization
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Work hours data with monthly breakdown
 */
export async function aggregateWorkHours(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<WorkHoursData> {
	// Get total work hours using existing calculation
	const summary = await calculateWorkHours(employeeId, organizationId, startDate, endDate);

	// Get work periods for monthly breakdown
	const rangeStart = dateToDB(startOfDay(fromJSDate(startDate)))!;
	const rangeEnd = dateToDB(endOfDay(fromJSDate(endDate)))!;

	const periods = await db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, rangeStart),
				lte(workPeriod.startTime, rangeEnd),
			),
		)
		.orderBy(workPeriod.startTime);

	// Group by month
	const byMonth = new Map<string, WorkHoursSummary>();

	for (const period of periods) {
		const monthKey = format(period.startTime, "yyyy-MM");
		const dateKey = format(period.startTime, "yyyy-MM-dd");

		if (!byMonth.has(monthKey)) {
			byMonth.set(monthKey, { hours: 0, days: 0 });
		}

		const monthData = byMonth.get(monthKey)!;
		monthData.hours += (period.durationMinutes || 0) / 60;

		// Track unique days (create a temporary set for each month)
		if (!byMonth.has(`${monthKey}-days`)) {
			byMonth.set(`${monthKey}-days`, { hours: 0, days: 0 });
		}
	}

	// Count unique days per month properly
	const monthDays = new Map<string, Set<string>>();
	for (const period of periods) {
		const monthKey = format(period.startTime, "yyyy-MM");
		const dateKey = format(period.startTime, "yyyy-MM-dd");

		if (!monthDays.has(monthKey)) {
			monthDays.set(monthKey, new Set());
		}
		monthDays.get(monthKey)!.add(dateKey);
	}

	// Update days count
	for (const [monthKey, dateSet] of monthDays.entries()) {
		const monthData = byMonth.get(monthKey);
		if (monthData) {
			monthData.days = dateSet.size;
		}
	}

	// Clean up temporary tracking keys
	for (const key of byMonth.keys()) {
		if (key.endsWith("-days")) {
			byMonth.delete(key);
		}
	}

	// Round hours to 2 decimals
	for (const monthData of byMonth.values()) {
		monthData.hours = Math.round(monthData.hours * 100) / 100;
	}

	return {
		totalHours: summary.totalHours,
		totalMinutes: summary.totalMinutes,
		workDays: summary.workDays,
		averagePerDay:
			summary.workDays > 0 ? Math.round((summary.totalHours / summary.workDays) * 100) / 100 : 0,
		byMonth,
	};
}

/**
 * Aggregate absences by category
 * @param employeeId - ID of the employee
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Absences data by category
 */
export async function aggregateAbsences(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<Omit<AbsencesData, "homeOffice">> {
	const rangeStart = dateToDB(startOfDay(fromJSDate(startDate)))!;
	const rangeEnd = dateToDB(endOfDay(fromJSDate(endDate)))!;

	// Fetch all absences in date range
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			lte(absenceEntry.startDate, rangeEnd),
			gte(absenceEntry.endDate, rangeStart),
		),
		with: {
			category: true,
		},
		orderBy: (absences, { asc }) => [asc(absences.startDate)],
	});

	const byCategory = new Map<string, AbsenceSummary>();
	let totalDays = 0;
	let vacationApproved = 0;
	let vacationPending = 0;
	let sickApproved = 0;
	let sickPending = 0;
	let otherApproved = 0;
	let otherPending = 0;

	for (const absence of absences) {
		const categoryName = absence.category.name;
		const categoryType = absence.category.type;

		// Calculate business days for this absence
		const days = calculateBusinessDays(absence.startDate, absence.endDate);

		// Update category totals
		if (!byCategory.has(categoryName)) {
			byCategory.set(categoryName, { days: 0 });
		}

		const categorySummary = byCategory.get(categoryName)!;
		if (absence.status === "approved") {
			categorySummary.days += days;
			totalDays += days;
		}

		// Track specific categories
		if (categoryType === "vacation") {
			if (absence.status === "approved") {
				vacationApproved += days;
			} else if (absence.status === "pending") {
				vacationPending += days;
			}
		} else if (categoryType === "sick") {
			if (absence.status === "approved") {
				sickApproved += days;
			} else if (absence.status === "pending") {
				sickPending += days;
			}
		} else if (categoryType !== "home_office") {
			// Don't count home_office as "other" - it has its own section
			if (absence.status === "approved") {
				otherApproved += days;
			} else if (absence.status === "pending") {
				otherPending += days;
			}
		}
	}

	return {
		totalDays,
		byCategory,
		vacation: {
			approved: vacationApproved,
			pending: vacationPending,
		},
		sick: {
			approved: sickApproved,
			pending: sickPending,
		},
		other: {
			approved: otherApproved,
			pending: otherPending,
		},
	};
}

/**
 * Aggregate home office days with actual hours worked
 * CRITICAL for German tax purposes
 * @param employeeId - ID of the employee
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Home office data with hours worked
 */
export async function aggregateHomeOfficeDays(
	employeeId: string,
	startDate: Date,
	endDate: Date,
): Promise<HomeOfficeData> {
	const rangeStart = dateToDB(startOfDay(fromJSDate(startDate)))!;
	const rangeEnd = dateToDB(endOfDay(fromJSDate(endDate)))!;

	// Step 1: Get approved home office absences
	const homeOfficeCategory = await db.query.absenceCategory.findFirst({
		where: eq(absenceCategory.type, "home_office"),
	});

	if (!homeOfficeCategory) {
		return {
			days: 0,
			hoursWorked: 0,
			dateDetails: [],
		};
	}

	const homeOfficeAbsences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			eq(absenceEntry.categoryId, homeOfficeCategory.id),
			eq(absenceEntry.status, "approved"),
			lte(absenceEntry.startDate, rangeEnd),
			gte(absenceEntry.endDate, rangeStart),
		),
		orderBy: (absences, { asc }) => [asc(absences.startDate)],
	});

	// Step 2: Extract all home office dates
	const homeOfficeDates = new Set<string>();
	for (const absence of homeOfficeAbsences) {
		const days = eachDayOfInterval(fromJSDate(absence.startDate), fromJSDate(absence.endDate));

		for (const day of days) {
			// Only include dates within our report range
			const dayJS = toJSDate(day);
			if (dayJS >= rangeStart && dayJS <= rangeEnd) {
				homeOfficeDates.add(format(day, "yyyy-MM-dd"));
			}
		}
	}

	// Step 3: For each home office day, get actual hours worked
	const dateDetails: HomeOfficeDetail[] = [];
	let totalHoursWorked = 0;

	for (const dateStr of Array.from(homeOfficeDates).sort()) {
		const date = new Date(dateStr);
		const dayStart = dateToDB(startOfDay(fromJSDate(date)))!;
		const dayEnd = dateToDB(endOfDay(fromJSDate(date)))!;

		// Get work periods for this day
		const dayPeriods = await db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.employeeId, employeeId),
					eq(workPeriod.isActive, false),
					isNotNull(workPeriod.durationMinutes),
					gte(workPeriod.startTime, dayStart),
					lte(workPeriod.startTime, dayEnd),
				),
			);

		// Calculate total hours for this day
		const dayMinutes = dayPeriods.reduce((sum, period) => sum + (period.durationMinutes || 0), 0);
		const dayHours = Math.round((dayMinutes / 60) * 100) / 100;

		totalHoursWorked += dayHours;

		dateDetails.push({
			date,
			hours: dayHours,
		});
	}

	return {
		days: homeOfficeDates.size,
		hoursWorked: Math.round(totalHoursWorked * 100) / 100,
		dateDetails,
	};
}

/**
 * Calculate compliance metrics
 * Uses employee's work schedule for accurate expected hours calculation
 * @param workHours - Work hours data
 * @param absences - Absences data
 * @param expectedHoursData - Expected hours based on employee's schedule
 * @returns Compliance metrics
 */
function calculateComplianceMetrics(
	workHours: WorkHoursData,
	absences: Omit<AbsencesData, "homeOffice">,
	expectedHoursData: {
		totalMinutes: number;
		workDays: number;
		scheduleInfo: { name: string; source: string } | null;
	},
): ComplianceMetrics {
	// Simple attendance percentage based on expected vs actual work days
	const totalPossibleDays = workHours.workDays + absences.totalDays;
	const attendancePercentage =
		totalPossibleDays > 0 ? Math.round((workHours.workDays / totalPossibleDays) * 100) : 100;

	// Overtime/undertime calculation using schedule-based expected hours
	const expectedMinutes = expectedHoursData.totalMinutes;
	const overtimeMinutes = Math.max(0, workHours.totalMinutes - expectedMinutes);
	const underTimeMinutes = Math.max(0, expectedMinutes - workHours.totalMinutes);

	return {
		attendancePercentage,
		overtimeMinutes: Math.round(overtimeMinutes),
		underTimeMinutes: Math.round(underTimeMinutes),
		// Add schedule info for context in reports
		scheduleInfo: expectedHoursData.scheduleInfo,
		expectedWorkMinutes: expectedMinutes,
	};
}
