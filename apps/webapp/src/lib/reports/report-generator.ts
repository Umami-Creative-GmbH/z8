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
import {
	endOfDay,
	format,
	fromJSDate,
	startOfDay,
} from "@/lib/datetime/luxon-utils";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import {
	comparePlainDates,
	dateFromInstant,
	instantFromDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { calculateExpectedWorkHoursForEmployee } from "@/lib/time-tracking/calculations";
import { formatDateRangeLabel } from "./date-ranges";
import { calculateHourlyEarningsFromIntervals } from "./hourly-earnings";
import {
	type ReportDateRange,
	resolveReportDateRange,
} from "./report-date-range";
import type {
	AbsenceSummary,
	AbsencesData,
	ComplianceMetrics,
	HomeOfficeData,
	HomeOfficeDetail,
	HourlyEarningsData,
	ReportData,
	WorkHoursData,
	WorkHoursSummary,
} from "./types";

interface ReportCalendarRange {
	startDate: string;
	endDate: string;
	timezone: string;
}

type CompletedWorkPeriod = typeof workPeriod.$inferSelect;

function getReportRange(
	startDate: Date,
	endDate: Date,
	calendarRange?: ReportCalendarRange,
): ReportDateRange {
	if (calendarRange) {
		return resolveReportDateRange(
			calendarRange.startDate,
			calendarRange.endDate,
			calendarRange.timezone,
		);
	}

	return resolveReportDateRange(
		instantFromDate(startDate)
			.toZonedDateTimeISO("UTC")
			.toPlainDate()
			.toString(),
		instantFromDate(endDate).toZonedDateTimeISO("UTC").toPlainDate().toString(),
		"UTC",
	);
}

async function loadCompletedWorkPeriods(
	employeeId: string,
	organizationId: string,
	reportRange: ReportDateRange,
): Promise<CompletedWorkPeriod[]> {
	return db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.durationMinutes),
				lt(workPeriod.startTime, dateFromInstant(reportRange.endExclusive)),
				gt(workPeriod.endTime, dateFromInstant(reportRange.start)),
			),
		)
		.orderBy(workPeriod.startTime);
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
		where: and(
			eq(employee.id, employeeId),
			eq(employee.organizationId, organizationId),
		),
		with: {
			user: true,
		},
	});

	if (!emp) {
		throw new Error("Employee not found");
	}

	// Aggregate data in parallel
	const reportRange = getReportRange(startDate, endDate, calendarRange);
	const [periods, absences, homeOffice, expectedHours] = await Promise.all([
		loadCompletedWorkPeriods(employeeId, organizationId, reportRange),
		aggregateAbsences(
			employeeId,
			organizationId,
			startDate,
			endDate,
			calendarRange,
		),
		aggregateHomeOfficeDays(
			employeeId,
			organizationId,
			startDate,
			endDate,
			calendarRange,
		),
		calculateExpectedWorkHoursForEmployee(
			employeeId,
			organizationId,
			startDate,
			endDate,
			calendarRange?.timezone,
		),
	]);
	const workHours = aggregateWorkHoursFromPeriods(periods, reportRange);

	// Calculate compliance metrics using schedule-based expected hours
	const complianceMetrics = calculateComplianceMetrics(
		workHours,
		absences,
		expectedHours,
	);

	// Calculate earnings for hourly employees
	let hourlyEarnings: HourlyEarningsData | undefined;
	if (emp.contractType === "hourly") {
		hourlyEarnings = await calculateHourlyEarnings(
			employeeId,
			organizationId,
			periods,
			reportRange,
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
	const reportRange = getReportRange(startDate, endDate, calendarRange);
	const periods = await loadCompletedWorkPeriods(
		employeeId,
		organizationId,
		reportRange,
	);
	return aggregateWorkHoursFromPeriods(periods, reportRange);
}

function aggregateWorkHoursFromPeriods(
	periods: CompletedWorkPeriod[],
	reportRange: ReportDateRange,
): WorkHoursData {
	const byMonth = new Map<string, WorkHoursSummary>();
	const workDays = new Set<string>();
	let totalMinutes = 0;
	for (const period of periods) {
		if (!period.endTime || !period.durationMinutes) continue;
		const periodStart = instantFromDate(period.startTime);
		const periodEnd = instantFromDate(period.endTime);
		const pieces = reportRange.splitPeriod(periodStart, periodEnd);
		const fullElapsedMinutes =
			Number(periodEnd.epochNanoseconds - periodStart.epochNanoseconds) /
			60_000_000_000;
		const includedElapsedMinutes = pieces.reduce(
			(sum, piece) => sum + piece.minutes,
			0,
		);
		const includedDurationMinutes =
			fullElapsedMinutes > 0
				? period.durationMinutes * (includedElapsedMinutes / fullElapsedMinutes)
				: 0;
		for (const piece of pieces) {
			const allocatedMinutes =
				includedElapsedMinutes > 0
					? includedDurationMinutes * (piece.minutes / includedElapsedMinutes)
					: 0;
			const monthKey = piece.date.slice(0, 7);
			const monthData = byMonth.get(monthKey) ?? { hours: 0, days: 0 };
			monthData.hours += allocatedMinutes / 60;
			byMonth.set(monthKey, monthData);
			workDays.add(piece.date);
			totalMinutes += allocatedMinutes;
		}
	}
	for (const [monthKey, monthData] of byMonth) {
		monthData.days = [...workDays].filter((date) =>
			date.startsWith(monthKey),
		).length;
	}

	// Round hours to 2 decimals
	for (const monthData of byMonth.values()) {
		monthData.hours = Math.round(monthData.hours * 100) / 100;
	}

	return {
		totalHours:
			Math.round(
				((totalMinutes ||
					[...byMonth.values()].reduce(
						(sum, month) => sum + month.hours * 60,
						0,
					)) /
					60) *
					100,
			) / 100,
		totalMinutes: Math.round(
			totalMinutes ||
				[...byMonth.values()].reduce((sum, month) => sum + month.hours * 60, 0),
		),
		workDays: workDays.size,
		averagePerDay:
			workDays.size > 0
				? Math.round(
						((totalMinutes ||
							[...byMonth.values()].reduce(
								(sum, month) => sum + month.hours * 60,
								0,
							)) /
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
	organizationId: string,
	startDate: Date,
	endDate: Date,
	calendarRange?: ReportCalendarRange,
): Promise<Omit<AbsencesData, "homeOffice">> {
	// Convert dates to YYYY-MM-DD strings for date column comparison
	const rangeStartStr =
		calendarRange?.startDate ??
		format(startOfDay(fromJSDate(startDate)), "yyyy-MM-dd");
	const rangeEndStr =
		calendarRange?.endDate ??
		format(endOfDay(fromJSDate(endDate)), "yyyy-MM-dd");

	// Fetch all absences in date range
	const absences = await db.query.absenceEntry.findMany({
		where: and(
			eq(absenceEntry.employeeId, employeeId),
			eq(absenceEntry.organizationId, organizationId),
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
		calendarRange?.startDate ??
		format(startOfDay(fromJSDate(startDate)), "yyyy-MM-dd");
	const rangeEndStr =
		calendarRange?.endDate ??
		format(endOfDay(fromJSDate(endDate)), "yyyy-MM-dd");

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
			eq(absenceEntry.organizationId, organizationId),
			or(
				...homeOfficeCategories.map((category) =>
					eq(absenceEntry.categoryId, category.id),
				),
			),
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
			comparePlainDates(
				parsePlainDate(absence.startDate),
				parsePlainDate(rangeStartStr),
			) < 0
				? parsePlainDate(rangeStartStr)
				: parsePlainDate(absence.startDate);
		const lastDay =
			comparePlainDates(
				parsePlainDate(absence.endDate),
				parsePlainDate(rangeEndStr),
			) > 0
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
			const dayRange = reportTimezone
				? localDayRange(dateStr, reportTimezone)
				: undefined;
			const dayStart = dayRange
				? dateToDB(fromJSDate(dateFromInstant(dayRange.start)))!
				: dateToDB(startOfDay(fromJSDate(new Date(dateStr))))!;
			const dayEndExclusive = dayRange
				? dateToDB(fromJSDate(dateFromInstant(dayRange.endExclusive)))!
				: dateToDB(
						endOfDay(fromJSDate(new Date(dateStr))).plus({ milliseconds: 1 }),
					)!;

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
								.splitPeriod(
									instantFromDate(period.startTime),
									instantFromDate(period.endTime),
								)
								.reduce((minutes, piece) => minutes + piece.minutes, 0)
						);
					}, 0)
				: dayPeriods.reduce(
						(sum, period) => sum + (period.durationMinutes || 0),
						0,
					);
			const dayHours = Math.round((dayMinutes / 60) * 100) / 100;

			return { date: dateStr, hours: dayHours };
		}),
	);

	// Aggregate results
	const dateDetails: HomeOfficeDetail[] = periodResults;
	const totalHoursWorked = periodResults.reduce(
		(sum, result) => sum + result.hours,
		0,
	);

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
		totalPossibleDays > 0
			? Math.round((workHours.workDays / totalPossibleDays) * 100)
			: 100;

	// Overtime/undertime calculation using schedule-based expected hours
	const expectedMinutes = expectedHoursData.totalMinutes;
	const overtimeMinutes = Math.max(0, workHours.totalMinutes - expectedMinutes);
	const underTimeMinutes = Math.max(
		0,
		expectedMinutes - workHours.totalMinutes,
	);

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
 * @returns Earnings data with breakdown by rate period
 */
async function calculateHourlyEarnings(
	employeeId: string,
	organizationId: string,
	workPeriods: CompletedWorkPeriod[],
	reportRange: ReportDateRange,
): Promise<HourlyEarningsData> {
	const rateHistory = await db
		.select()
		.from(employeeRateHistory)
		.where(
			and(
				eq(employeeRateHistory.employeeId, employeeId),
				eq(employeeRateHistory.organizationId, organizationId),
				lt(
					employeeRateHistory.effectiveFrom,
					dateFromInstant(reportRange.endExclusive),
				),
				or(
					isNull(employeeRateHistory.effectiveTo),
					gt(
						employeeRateHistory.effectiveTo,
						dateFromInstant(reportRange.start),
					),
				),
			),
		)
		.orderBy(employeeRateHistory.effectiveFrom);

	return calculateHourlyEarningsFromIntervals({
		workPeriods: workPeriods.flatMap((period) =>
			period.endTime && period.durationMinutes !== null
				? [
						{
							start: instantFromDate(period.startTime),
							end: instantFromDate(period.endTime),
							durationMinutes: period.durationMinutes,
						},
					]
				: [],
		),
		ratePeriods: rateHistory.map((ratePeriod) => ({
			id: ratePeriod.id,
			rate: Number(ratePeriod.hourlyRate),
			currency: ratePeriod.currency,
			effectiveFrom: instantFromDate(ratePeriod.effectiveFrom),
			effectiveTo: ratePeriod.effectiveTo
				? instantFromDate(ratePeriod.effectiveTo)
				: null,
		})),
		rangeStart: reportRange.start,
		rangeEndExclusive: reportRange.endExclusive,
		timezone: reportRange.timezone,
	});
}
