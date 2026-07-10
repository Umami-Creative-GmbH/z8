/**
 * Report generator service
 * Aggregates data from time tracking and absences for comprehensive employee reports
 */

import { and, eq, gt, gte, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
	absenceCategory,
	absenceEntry,
	employee,
	employeeRateHistory,
	workPeriod,
} from "@/db/schema";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { endOfDay, format, fromJSDate, startOfDay } from "@/lib/datetime/luxon-utils";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { calculateExpectedWorkHoursForEmployee } from "@/lib/time-tracking/calculations";
import { formatDateRangeLabel } from "./date-ranges";
import { resolveReportDateRange } from "./report-date-range";
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

interface ReportCalendarRange {
	startDate: string;
	endDate: string;
	timezone: string;
}

function clippedBusinessDays(
	startDate: string,
	endDate: string,
	rangeStart: string,
	rangeEnd: string,
): number {
	let date =
		comparePlainDates(parsePlainDate(startDate), parsePlainDate(rangeStart)) < 0
			? parsePlainDate(rangeStart)
			: parsePlainDate(startDate);
	const end =
		comparePlainDates(parsePlainDate(endDate), parsePlainDate(rangeEnd)) > 0
			? parsePlainDate(rangeEnd)
			: parsePlainDate(endDate);
	let days = 0;
	while (comparePlainDates(date, end) <= 0) {
		if (date.dayOfWeek < 6) days += 1;
		date = date.add({ days: 1 });
	}
	return days;
}

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
	calendarRange?: ReportCalendarRange,
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
		aggregateWorkHours(employeeId, organizationId, startDate, endDate, calendarRange),
		aggregateAbsences(employeeId, startDate, endDate, calendarRange),
		aggregateHomeOfficeDays(employeeId, organizationId, startDate, endDate, calendarRange),
		calculateExpectedWorkHoursForEmployee(
			employeeId,
			organizationId,
			startDate,
			endDate,
			calendarRange?.timezone,
		),
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
			calendarRange?.timezone ?? "UTC",
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
			startDate: calendarRange?.startDate ?? format(startDate, "yyyy-MM-dd"),
			endDate: calendarRange?.endDate ?? format(endDate, "yyyy-MM-dd"),
			label: formatDateRangeLabel(
				calendarRange?.startDate ?? format(startDate, "yyyy-MM-dd"),
				calendarRange?.endDate ?? format(endDate, "yyyy-MM-dd"),
			),
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
	calendarRange?: ReportCalendarRange,
): Promise<WorkHoursData> {
	const reportRange = calendarRange
		? resolveReportDateRange(calendarRange.startDate, calendarRange.endDate, calendarRange.timezone)
		: undefined;
	const rangeStart = reportRange
		? dateToDB(fromJSDate(dateFromInstant(reportRange.start)))!
		: dateToDB(startOfDay(fromJSDate(startDate)))!;
	const rangeEndExclusive = reportRange
		? dateToDB(fromJSDate(dateFromInstant(reportRange.endExclusive)))!
		: dateToDB(endOfDay(fromJSDate(endDate)).plus({ milliseconds: 1 }))!;

	const periods = await db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				lt(workPeriod.startTime, rangeEndExclusive),
				gt(workPeriod.endTime, rangeStart),
			),
		)
		.orderBy(workPeriod.startTime);

	const byMonth = new Map<string, WorkHoursSummary>();
	const workDays = new Set<string>();
	let totalMinutes = 0;
	for (const period of periods) {
		if (!period.endTime) continue;
		const pieces = reportRange
			? reportRange.splitPeriod(instantFromDate(period.startTime), instantFromDate(period.endTime))
			: [{ date: format(period.startTime, "yyyy-MM-dd"), minutes: period.durationMinutes || 0 }];
		for (const piece of pieces) {
			const monthKey = piece.date.slice(0, 7);
			const monthData = byMonth.get(monthKey) ?? { hours: 0, days: 0 };
			monthData.hours += piece.minutes / 60;
			byMonth.set(monthKey, monthData);
			workDays.add(piece.date);
			totalMinutes += piece.minutes;
		}
	}
	for (const [monthKey, monthData] of byMonth) {
		monthData.days = [...workDays].filter((date) => date.startsWith(monthKey)).length;
	}

	// Round hours to 2 decimals
	for (const monthData of byMonth.values()) {
		monthData.hours = Math.round(monthData.hours * 100) / 100;
	}

	return {
		totalHours:
			Math.round(
				((totalMinutes || [...byMonth.values()].reduce((sum, month) => sum + month.hours * 60, 0)) /
					60) *
					100,
			) / 100,
		totalMinutes:
			totalMinutes || [...byMonth.values()].reduce((sum, month) => sum + month.hours * 60, 0),
		workDays: workDays.size,
		averagePerDay:
			workDays.size > 0
				? Math.round(
						((totalMinutes ||
							[...byMonth.values()].reduce((sum, month) => sum + month.hours * 60, 0)) /
							60 /
							workDays.size) *
							100,
					) / 100
				: 0,
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
	calendarRange?: ReportCalendarRange,
): Promise<Omit<AbsencesData, "homeOffice">> {
	// Convert dates to YYYY-MM-DD strings for date column comparison
	const rangeStartStr =
		calendarRange?.startDate ?? format(startOfDay(fromJSDate(startDate)), "yyyy-MM-dd");
	const rangeEndStr = calendarRange?.endDate ?? format(endOfDay(fromJSDate(endDate)), "yyyy-MM-dd");

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

		const days = clippedBusinessDays(
			absence.startDate,
			absence.endDate,
			rangeStartStr,
			rangeEndStr,
		);

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
 * @param organizationId - ID of the organization
 * @param startDate - Start date
 * @param endDate - End date
 * @returns Home office data with hours worked
 */
export async function aggregateHomeOfficeDays(
	employeeId: string,
	organizationId: string,
	startDate: Date,
	endDate: Date,
	calendarRange?: ReportCalendarRange,
): Promise<HomeOfficeData> {
	// Convert dates to YYYY-MM-DD strings for date column comparison
	const rangeStartStr =
		calendarRange?.startDate ?? format(startOfDay(fromJSDate(startDate)), "yyyy-MM-dd");
	const rangeEndStr = calendarRange?.endDate ?? format(endOfDay(fromJSDate(endDate)), "yyyy-MM-dd");

	// Step 1: Get approved home office absences
	const homeOfficeCategories = await db.query.absenceCategory.findMany({
		where: and(
			eq(absenceCategory.type, "home_office"),
			eq(absenceCategory.organizationId, organizationId),
		),
	});

	if (homeOfficeCategories.length === 0) {
		return {
			days: 0,
			hoursWorked: 0,
			dateDetails: [],
		};
	}

	const homeOfficeAbsences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			or(...homeOfficeCategories.map((category) => eq(absenceEntry.categoryId, category.id))),
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
		let day =
			comparePlainDates(parsePlainDate(absence.startDate), parsePlainDate(rangeStartStr)) < 0
				? parsePlainDate(rangeStartStr)
				: parsePlainDate(absence.startDate);
		const lastDay =
			comparePlainDates(parsePlainDate(absence.endDate), parsePlainDate(rangeEndStr)) > 0
				? parsePlainDate(rangeEndStr)
				: parsePlainDate(absence.endDate);
		while (comparePlainDates(day, lastDay) <= 0) {
			homeOfficeDates.add(day.toString());
			day = day.add({ days: 1 });
		}
	}

	// Step 3: For each home office day, get actual hours worked (parallelized)
	const sortedDates = Array.from(homeOfficeDates).sort();

	// Fetch all work periods in parallel instead of sequential loop
	const reportTimezone = calendarRange?.timezone;
	const periodResults = await Promise.all(
		sortedDates.map(async (dateStr) => {
			const dayRange = reportTimezone ? localDayRange(dateStr, reportTimezone) : undefined;
			const dayStart = dayRange
				? dateToDB(fromJSDate(dateFromInstant(dayRange.start)))!
				: dateToDB(startOfDay(fromJSDate(new Date(dateStr))))!;
			const dayEndExclusive = dayRange
				? dateToDB(fromJSDate(dateFromInstant(dayRange.endExclusive)))!
				: dateToDB(endOfDay(fromJSDate(new Date(dateStr))).plus({ milliseconds: 1 }))!;

			const dayPeriods = await db
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.employeeId, employeeId),
						eq(workPeriod.organizationId, organizationId),
						eq(workPeriod.isActive, false),
						isNotNull(workPeriod.durationMinutes),
						lt(workPeriod.startTime, dayEndExclusive),
						gt(workPeriod.endTime, dayStart),
					),
				);

			// Calculate total hours for this day
			const dayMinutes = dayRange
				? dayPeriods.reduce((sum, period) => {
						if (!period.endTime) return sum;
						return (
							sum +
							resolveReportDateRange(dateStr, dateStr, reportTimezone!)
								.splitPeriod(instantFromDate(period.startTime), instantFromDate(period.endTime))
								.reduce((minutes, piece) => minutes + piece.minutes, 0)
						);
					}, 0)
				: dayPeriods.reduce((sum, period) => sum + (period.durationMinutes || 0), 0);
			const dayHours = Math.round((dayMinutes / 60) * 100) / 100;

			return { date: dateStr, hours: dayHours };
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
	_organizationId: string,
	startDate: Date,
	endDate: Date,
	totalHours: number,
	timezone: string,
): Promise<HourlyEarningsData> {
	const calendarDate = (date: Date) =>
		instantFromDate(date).toZonedDateTimeISO(timezone).toPlainDate().toString();
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
					periodStart: calendarDate(startDate),
					periodEnd: calendarDate(endDate),
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
			periodStart: calendarDate(startDate),
			periodEnd: calendarDate(endDate),
			hours: totalHours,
			earnings,
		});
	} else {
		// Multiple rate periods - need to calculate hours per period
		// This is an approximation based on the proportion of days in each period
		const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

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
				totalDays > 0 ? Math.round((periodDays / totalDays) * totalHours * 100) / 100 : 0;
			const earnings = Math.round(periodHours * rate * 100) / 100;

			totalEarnings += earnings;

			byRatePeriod.push({
				rate,
				currency: rateEntry.currency,
				periodStart: calendarDate(periodStart),
				periodEnd: calendarDate(periodEnd),
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
