/**
 * Report generator service
 * Aggregates data from time tracking and absences for comprehensive employee reports
 */

import { and, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { absenceCategory, absenceEntry, employee, employeeRateHistory, workPeriod } from "@/db/schema";
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
	HourlyEarningsData,
	RatePeriodEarnings,
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

	// Calculate earnings for hourly employees
	let hourlyEarnings: HourlyEarningsData | undefined;
	if (emp.contractType === "hourly") {
		hourlyEarnings = await calculateHourlyEarnings(
			employeeId,
			organizationId,
			startDate,
			endDate,
			workHours.totalHours,
		);
	}

	return {
		employee: {
			id: emp.id,
			name: emp.user.name || emp.user.email,
			employeeNumber: emp.employeeNumber,
			position: emp.position,
			email: emp.user.email,
			contractType: emp.contractType,
			currentHourlyRate: emp.currentHourlyRate,
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
		hourlyEarnings,
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
		const _dateKey = format(period.startTime, "yyyy-MM-dd");

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
		monthDays.get(monthKey)?.add(dateKey);
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
	// Convert dates to YYYY-MM-DD strings for date column comparison
	const rangeStartStr = format(startOfDay(fromJSDate(startDate)), "yyyy-MM-dd");
	const rangeEndStr = format(endOfDay(fromJSDate(endDate)), "yyyy-MM-dd");

	// Fetch all absences in date range
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			lte(absenceEntry.startDate, rangeEndStr),
			gte(absenceEntry.endDate, rangeStartStr),
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
		const days = calculateBusinessDays(new Date(absence.startDate), new Date(absence.endDate));

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
	// Convert dates to YYYY-MM-DD strings for date column comparison
	const rangeStartStr = format(startOfDay(fromJSDate(startDate)), "yyyy-MM-dd");
	const rangeEndStr = format(endOfDay(fromJSDate(endDate)), "yyyy-MM-dd");
	// Keep Date versions for comparison in iteration
	const rangeStartDT = startOfDay(fromJSDate(startDate));
	const rangeEndDT = endOfDay(fromJSDate(endDate));

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
			lte(absenceEntry.startDate, rangeEndStr),
			gte(absenceEntry.endDate, rangeStartStr),
		),
		orderBy: (absences, { asc }) => [asc(absences.startDate)],
	});

	// Step 2: Extract all home office dates
	// Note: absence.startDate and absence.endDate are now YYYY-MM-DD strings
	const homeOfficeDates = new Set<string>();
	for (const absence of homeOfficeAbsences) {
		const absenceStart = fromJSDate(new Date(absence.startDate));
		const absenceEnd = fromJSDate(new Date(absence.endDate));
		const days = eachDayOfInterval(absenceStart, absenceEnd);

		for (const day of days) {
			// Only include dates within our report range
			if (day >= rangeStartDT && day <= rangeEndDT) {
				homeOfficeDates.add(format(day, "yyyy-MM-dd"));
			}
		}
	}

	// Step 3: For each home office day, get actual hours worked (parallelized)
	const sortedDates = Array.from(homeOfficeDates).sort();

	// Fetch all work periods in parallel instead of sequential loop
	const periodResults = await Promise.all(
		sortedDates.map(async (dateStr) => {
			const date = new Date(dateStr);
			const dayStart = dateToDB(startOfDay(fromJSDate(date)))!;
			const dayEnd = dateToDB(endOfDay(fromJSDate(date)))!;

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

			return { date, hours: dayHours };
		}),
	);

	// Aggregate results
	const dateDetails: HomeOfficeDetail[] = periodResults;
	const totalHoursWorked = periodResults.reduce((sum, result) => sum + result.hours, 0);

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

/**
 * Calculate earnings for hourly employees
 * Handles rate changes during the period by breaking down earnings by rate period
 * @param employeeId - ID of the employee
 * @param organizationId - ID of the organization
 * @param startDate - Report start date
 * @param endDate - Report end date
 * @param totalHours - Total hours worked in the period
 * @returns Earnings data with breakdown by rate period
 */
async function calculateHourlyEarnings(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
	totalHours: number,
): Promise<HourlyEarningsData> {
	// Get rate history for the period
	// A rate applies if: effectiveFrom <= endDate AND (effectiveTo > startDate OR effectiveTo is null)
	const rateHistory = await db
		.select()
		.from(employeeRateHistory)
		.where(
			and(
				eq(employeeRateHistory.employeeId, employeeId),
				lte(employeeRateHistory.effectiveFrom, endDate),
				or(
					isNull(employeeRateHistory.effectiveTo),
					gte(employeeRateHistory.effectiveTo, startDate),
				),
			),
		)
		.orderBy(employeeRateHistory.effectiveFrom);

	// If no rate history, use current rate from employee record
	if (rateHistory.length === 0) {
		const emp = await db.query.employee.findFirst({
			where: eq(employee.id, employeeId),
		});

		if (!emp?.currentHourlyRate) {
			return {
				totalHours,
				totalEarnings: 0,
				currency: "EUR",
				byRatePeriod: [],
			};
		}

		const rate = parseFloat(emp.currentHourlyRate);
		return {
			totalHours,
			totalEarnings: Math.round(totalHours * rate * 100) / 100,
			currency: "EUR",
			byRatePeriod: [
				{
					rate,
					currency: "EUR",
					periodStart: startDate,
					periodEnd: endDate,
					hours: totalHours,
					earnings: Math.round(totalHours * rate * 100) / 100,
				},
			],
		};
	}

	// Calculate earnings for each rate period
	const byRatePeriod: RatePeriodEarnings[] = [];
	let totalEarnings = 0;
	const currency = rateHistory[0]?.currency || "EUR";

	// For simple case with single rate, just use it
	if (rateHistory.length === 1) {
		const rate = parseFloat(rateHistory[0].hourlyRate);
		const earnings = Math.round(totalHours * rate * 100) / 100;
		totalEarnings = earnings;

		byRatePeriod.push({
			rate,
			currency: rateHistory[0].currency,
			periodStart: startDate,
			periodEnd: endDate,
			hours: totalHours,
			earnings,
		});
	} else {
		// Multiple rate periods - need to calculate hours per period
		// This is an approximation based on the proportion of days in each period
		const totalDays = Math.ceil(
			(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
		);

		for (let i = 0; i < rateHistory.length; i++) {
			const rateEntry = rateHistory[i];
			const rate = parseFloat(rateEntry.hourlyRate);

			// Calculate the effective period for this rate within our report range
			const periodStart = new Date(
				Math.max(new Date(rateEntry.effectiveFrom).getTime(), startDate.getTime()),
			);
			const periodEnd = rateEntry.effectiveTo
				? new Date(Math.min(new Date(rateEntry.effectiveTo).getTime(), endDate.getTime()))
				: endDate;

			// Calculate days in this period
			const periodDays = Math.ceil(
				(periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24),
			);

			// Estimate hours for this period based on proportion of days
			const periodHours =
				totalDays > 0 ? Math.round(((periodDays / totalDays) * totalHours) * 100) / 100 : 0;
			const earnings = Math.round(periodHours * rate * 100) / 100;

			totalEarnings += earnings;

			byRatePeriod.push({
				rate,
				currency: rateEntry.currency,
				periodStart,
				periodEnd,
				hours: periodHours,
				earnings,
			});
		}
	}

	return {
		totalHours,
		totalEarnings: Math.round(totalEarnings * 100) / 100,
		currency,
		byRatePeriod,
	};
}
