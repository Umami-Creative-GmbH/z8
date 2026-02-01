/**
 * Data fetcher for payroll export
 * Fetches work periods, absences, and configuration from database
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	absenceCategory,
	absenceEntry,
	db,
	employee,
	payrollExportConfig,
	payrollExportFormat,
	payrollWageTypeMapping,
	workCategory,
	workPeriod,
} from "@/db";
import { createLogger } from "@/lib/logger";
import type {
	AbsenceData,
	PayrollExportFilters,
	WageTypeMapping,
	WorkPeriodData,
} from "./types";

const logger = createLogger("PayrollExportDataFetcher");

/**
 * Fetch work periods with filters for payroll export
 */
export async function fetchWorkPeriodsForExport(
	organizationId: string,
	filters: PayrollExportFilters,
): Promise<WorkPeriodData[]> {
	logger.info({ organizationId, filters: serializeFilters(filters) }, "Fetching work periods for payroll export");

	// Build where conditions
	const whereConditions = [
		eq(workPeriod.organizationId, organizationId),
		gte(workPeriod.startTime, filters.dateRange.start.toJSDate()),
		lte(workPeriod.startTime, filters.dateRange.end.endOf("day").toJSDate()),
		eq(workPeriod.isActive, false), // Only completed periods
	];

	// Add employee filter if specified
	if (filters.employeeIds && filters.employeeIds.length > 0) {
		whereConditions.push(inArray(workPeriod.employeeId, filters.employeeIds));
	}

	// Add project filter if specified
	if (filters.projectIds && filters.projectIds.length > 0) {
		whereConditions.push(inArray(workPeriod.projectId, filters.projectIds));
	}

	// Fetch work periods with employee and category data
	const periods = await db.query.workPeriod.findMany({
		where: and(...whereConditions),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
					firstName: true,
					lastName: true,
					teamId: true,
				},
			},
			workCategory: {
				columns: {
					id: true,
					name: true,
					factor: true,
				},
			},
			project: {
				columns: {
					id: true,
					name: true,
				},
			},
		},
		orderBy: (wp, { asc }) => [asc(wp.startTime)],
	});

	// Apply team filter if specified (requires filtering after fetch)
	let filteredPeriods = periods;
	if (filters.teamIds && filters.teamIds.length > 0) {
		const teamIdSet = new Set(filters.teamIds);
		filteredPeriods = periods.filter((p) => p.employee?.teamId && teamIdSet.has(p.employee.teamId));
	}

	logger.info({ count: filteredPeriods.length }, "Fetched work periods for payroll export");

	return filteredPeriods.map((p) => ({
		id: p.id,
		employeeId: p.employeeId,
		employeeNumber: p.employee?.employeeNumber || null,
		firstName: p.employee?.firstName || null,
		lastName: p.employee?.lastName || null,
		startTime: DateTime.fromJSDate(p.startTime),
		endTime: p.endTime ? DateTime.fromJSDate(p.endTime) : null,
		durationMinutes: p.durationMinutes,
		workCategoryId: p.workCategoryId,
		workCategoryName: p.workCategory?.name || null,
		workCategoryFactor: p.workCategory?.factor || null,
		projectId: p.projectId,
		projectName: p.project?.name || null,
	}));
}

/**
 * Fetch absences with filters for payroll export
 */
export async function fetchAbsencesForExport(
	organizationId: string,
	filters: PayrollExportFilters,
): Promise<AbsenceData[]> {
	logger.info({ organizationId, filters: serializeFilters(filters) }, "Fetching absences for payroll export");

	// Get employee IDs for this org (optionally filtered)
	let employeeIds: string[] = [];

	if (filters.employeeIds && filters.employeeIds.length > 0) {
		employeeIds = filters.employeeIds;
	} else if (filters.teamIds && filters.teamIds.length > 0) {
		// Get employees in specified teams
		const teamEmployees = await db.query.employee.findMany({
			where: and(
				eq(employee.organizationId, organizationId),
				inArray(employee.teamId, filters.teamIds),
			),
			columns: { id: true },
		});
		employeeIds = teamEmployees.map((e) => e.id);
	} else {
		// Get all employees for org
		const orgEmployees = await db.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { id: true },
		});
		employeeIds = orgEmployees.map((e) => e.id);
	}

	if (employeeIds.length === 0) {
		return [];
	}

	// Fetch absences in date range
	const startDateStr = filters.dateRange.start.toISODate();
	const endDateStr = filters.dateRange.end.toISODate();

	if (!startDateStr || !endDateStr) {
		throw new Error("Invalid date range: could not convert to ISO date strings");
	}

	const absences = await db.query.absenceEntry.findMany({
		where: and(
			inArray(absenceEntry.employeeId, employeeIds),
			// Overlapping date range check: absence overlaps if start <= filterEnd AND end >= filterStart
			lte(absenceEntry.startDate, endDateStr),
			gte(absenceEntry.endDate, startDateStr),
			eq(absenceEntry.status, "approved"), // Only approved absences
		),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
					firstName: true,
					lastName: true,
				},
			},
			category: {
				columns: {
					id: true,
					name: true,
					type: true,
				},
			},
		},
	});

	logger.info({ count: absences.length }, "Fetched absences for payroll export");

	return absences.map((a) => ({
		id: a.id,
		employeeId: a.employeeId,
		employeeNumber: a.employee?.employeeNumber || null,
		firstName: a.employee?.firstName || null,
		lastName: a.employee?.lastName || null,
		startDate: a.startDate,
		endDate: a.endDate,
		absenceCategoryId: a.categoryId,
		absenceCategoryName: a.category?.name || null,
		absenceType: a.category?.type || null,
		status: a.status,
	}));
}

/**
 * Get payroll export configuration for an organization
 */
export async function getPayrollExportConfig(
	organizationId: string,
	formatId: string,
): Promise<{
	config: typeof payrollExportConfig.$inferSelect;
	format: typeof payrollExportFormat.$inferSelect;
} | null> {
	const result = await db.query.payrollExportConfig.findFirst({
		where: and(
			eq(payrollExportConfig.organizationId, organizationId),
			eq(payrollExportConfig.formatId, formatId),
			eq(payrollExportConfig.isActive, true),
		),
		with: {
			format: true,
		},
	});

	if (!result) {
		return null;
	}

	return {
		config: result,
		format: result.format,
	};
}

/**
 * Get wage type mappings for a configuration
 */
export async function getWageTypeMappings(configId: string): Promise<WageTypeMapping[]> {
	const mappings = await db.query.payrollWageTypeMapping.findMany({
		where: and(
			eq(payrollWageTypeMapping.configId, configId),
			eq(payrollWageTypeMapping.isActive, true),
		),
		with: {
			workCategory: {
				columns: {
					id: true,
					name: true,
				},
			},
			absenceCategory: {
				columns: {
					id: true,
					name: true,
				},
			},
		},
	});

	return mappings.map((m) => ({
		id: m.id,
		workCategoryId: m.workCategoryId,
		workCategoryName: m.workCategory?.name || null,
		absenceCategoryId: m.absenceCategoryId,
		absenceCategoryName: m.absenceCategory?.name || null,
		specialCategory: m.specialCategory,
		wageTypeCode: m.wageTypeCode,
		wageTypeName: m.wageTypeName,
		// Format-specific codes
		datevWageTypeCode: m.datevWageTypeCode,
		datevWageTypeName: m.datevWageTypeName,
		lexwareWageTypeCode: m.lexwareWageTypeCode,
		lexwareWageTypeName: m.lexwareWageTypeName,
		sageWageTypeCode: m.sageWageTypeCode,
		sageWageTypeName: m.sageWageTypeName,
		successFactorsTimeTypeCode: m.successFactorsTimeTypeCode,
		successFactorsTimeTypeName: m.successFactorsTimeTypeName,
		factor: m.factor || "1.00",
		isActive: m.isActive,
	}));
}

/**
 * Get work categories for an organization (for mapping UI)
 */
export async function getWorkCategories(organizationId: string) {
	return db.query.workCategory.findMany({
		where: and(eq(workCategory.organizationId, organizationId), eq(workCategory.isActive, true)),
		columns: {
			id: true,
			name: true,
			factor: true,
		},
		orderBy: (wc, { asc }) => [asc(wc.name)],
	});
}

/**
 * Get absence categories for an organization (for mapping UI)
 */
export async function getAbsenceCategories(organizationId: string) {
	return db.query.absenceCategory.findMany({
		where: and(
			eq(absenceCategory.organizationId, organizationId),
			eq(absenceCategory.isActive, true),
		),
		columns: {
			id: true,
			name: true,
			type: true,
		},
		orderBy: (ac, { asc }) => [asc(ac.name)],
	});
}

/**
 * Get employees for filter options
 */
export async function getEmployeesForFilter(organizationId: string) {
	return db.query.employee.findMany({
		where: and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)),
		columns: {
			id: true,
			firstName: true,
			lastName: true,
			employeeNumber: true,
		},
		orderBy: (e, { asc }) => [asc(e.lastName), asc(e.firstName)],
	});
}

/**
 * Get teams for filter options
 */
export async function getTeamsForFilter(organizationId: string) {
	const { team } = await import("@/db");
	return db.query.team.findMany({
		where: eq(team.organizationId, organizationId),
		columns: {
			id: true,
			name: true,
		},
		orderBy: (t, { asc }) => [asc(t.name)],
	});
}

/**
 * Get projects for filter options
 */
export async function getProjectsForFilter(organizationId: string) {
	const { project } = await import("@/db");
	return db.query.project.findMany({
		where: and(eq(project.organizationId, organizationId), eq(project.isActive, true)),
		columns: {
			id: true,
			name: true,
		},
		orderBy: (p, { asc }) => [asc(p.name)],
	});
}

/**
 * Count work periods for sync/async decision
 */
export async function countWorkPeriods(
	organizationId: string,
	filters: PayrollExportFilters,
): Promise<number> {
	const whereConditions = [
		eq(workPeriod.organizationId, organizationId),
		gte(workPeriod.startTime, filters.dateRange.start.toJSDate()),
		lte(workPeriod.startTime, filters.dateRange.end.endOf("day").toJSDate()),
		eq(workPeriod.isActive, false),
	];

	if (filters.employeeIds && filters.employeeIds.length > 0) {
		whereConditions.push(inArray(workPeriod.employeeId, filters.employeeIds));
	}

	if (filters.projectIds && filters.projectIds.length > 0) {
		whereConditions.push(inArray(workPeriod.projectId, filters.projectIds));
	}

	const result = await db.query.workPeriod.findMany({
		where: and(...whereConditions),
		columns: { id: true },
	});

	return result.length;
}

/**
 * Helper to serialize filters for logging
 */
function serializeFilters(filters: PayrollExportFilters) {
	return {
		dateRange: {
			start: filters.dateRange.start.toISO(),
			end: filters.dateRange.end.toISO(),
		},
		employeeIds: filters.employeeIds,
		teamIds: filters.teamIds,
		projectIds: filters.projectIds,
	};
}
