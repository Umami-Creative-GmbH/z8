/**
 * Data fetcher for payroll export
 * Fetches work periods, absences, and configuration from database
 */
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	absenceCategory,
	db,
	employee,
	payrollExportConfig,
	payrollExportFormat,
	payrollWageTypeMapping,
	workCategory,
} from "@/db";
import { timeRecord } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { assertCanonicalCutoverReady } from "@/lib/time-record/migration/cutover-state";
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
	legalEntityId: string,
	filters: PayrollExportFilters,
): Promise<WorkPeriodData[]> {
	await assertCanonicalCutoverReady(organizationId);

	logger.info({ organizationId, filters: serializeFilters(filters) }, "Fetching work periods for payroll export");

	const employeeIds = await getLegalEntityEmployeeIds(organizationId, legalEntityId, filters);

	if (employeeIds.length === 0) {
		return [];
	}

	// Build where conditions
	const whereConditions = [
		eq(timeRecord.organizationId, organizationId),
		inArray(timeRecord.employeeId, employeeIds),
		eq(timeRecord.recordKind, "work"),
		eq(timeRecord.approvalState, "approved"),
		gte(timeRecord.startAt, filters.dateRange.start.toJSDate()),
		lte(timeRecord.startAt, filters.dateRange.end.endOf("day").toJSDate()),
	];

	// Fetch work periods with employee and category data
	const periods = await db.query.timeRecord.findMany({
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
				with: {
					user: {
						columns: {
							email: true,
						},
					},
				},
			},
			work: {
				columns: {
					workCategoryId: true,
				},
				with: {
					workCategory: {
						columns: {
							id: true,
							name: true,
							factor: true,
						},
					},
				},
			},
			allocations: {
				columns: {
					projectId: true,
					weightPercent: true,
				},
				with: {
					project: {
						columns: {
							id: true,
							name: true,
						},
					},
				},
			},
		},
		orderBy: [asc(timeRecord.startAt)],
	});

	// Apply team filter if specified (requires filtering after fetch)
	let filteredPeriods = periods;
	if (filters.teamIds && filters.teamIds.length > 0) {
		const teamIdSet = new Set(filters.teamIds);
		filteredPeriods = periods.filter((p) => p.employee?.teamId && teamIdSet.has(p.employee.teamId));
	}

	if (filters.projectIds && filters.projectIds.length > 0) {
		const projectIdSet = new Set(filters.projectIds);
		filteredPeriods = filteredPeriods.filter((p) =>
			(p.allocations || []).some((allocation) =>
				allocation.projectId ? projectIdSet.has(allocation.projectId) : false,
			),
		);
	}

	logger.info({ count: filteredPeriods.length }, "Fetched work periods for payroll export");

	return filteredPeriods.map((p) => ({
		id: p.id,
		employeeId: p.employeeId,
		employeeNumber: p.employee?.employeeNumber || null,
		email: p.employee?.user?.email || null,
		firstName: p.employee?.firstName || null,
		lastName: p.employee?.lastName || null,
		startTime: DateTime.fromJSDate(p.startAt),
		endTime: p.endAt ? DateTime.fromJSDate(p.endAt) : null,
		durationMinutes: p.durationMinutes,
		workCategoryId: p.work?.workCategoryId || null,
		workCategoryName: p.work?.workCategory?.name || null,
		workCategoryFactor: p.work?.workCategory?.factor || null,
		projectId:
			p.allocations
				?.slice()
				.sort((a, b) => b.weightPercent - a.weightPercent)
				.find((allocation) => allocation.projectId)?.projectId || null,
		projectName:
			p.allocations
				?.slice()
				.sort((a, b) => b.weightPercent - a.weightPercent)
				.find((allocation) => allocation.projectId)?.project?.name || null,
	}));
}

/**
 * Fetch absences with filters for payroll export
 */
export async function fetchAbsencesForExport(
	organizationId: string,
	legalEntityId: string,
	filters: PayrollExportFilters,
): Promise<AbsenceData[]> {
	await assertCanonicalCutoverReady(organizationId);

	logger.info({ organizationId, filters: serializeFilters(filters) }, "Fetching absences for payroll export");

	const employeeIds = await getLegalEntityEmployeeIds(organizationId, legalEntityId, filters);

	if (employeeIds.length === 0) {
		return [];
	}

	const absences = await db.query.timeRecord.findMany({
		where: and(
			eq(timeRecord.organizationId, organizationId),
			eq(timeRecord.recordKind, "absence"),
			eq(timeRecord.approvalState, "approved"),
			inArray(timeRecord.employeeId, employeeIds),
			lte(timeRecord.startAt, filters.dateRange.end.endOf("day").toJSDate()),
			or(
				gte(timeRecord.endAt, filters.dateRange.start.startOf("day").toJSDate()),
				isNull(timeRecord.endAt),
			),
		),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
					firstName: true,
					lastName: true,
				},
				with: {
					user: {
						columns: {
							email: true,
						},
					},
				},
			},
			absence: {
				columns: {
					absenceCategoryId: true,
				},
				with: {
					absenceCategory: {
						columns: {
							id: true,
							name: true,
							type: true,
						},
					},
				},
			},
		},
		orderBy: [asc(timeRecord.startAt)],
	});

	logger.info({ count: absences.length }, "Fetched absences for payroll export");

	return absences.map((a) => ({
		id: a.id,
		employeeId: a.employeeId,
		employeeNumber: a.employee?.employeeNumber || null,
		email: a.employee?.user?.email || null,
		firstName: a.employee?.firstName || null,
		lastName: a.employee?.lastName || null,
		startDate: DateTime.fromJSDate(a.startAt, { zone: "utc" }).toISODate() || "",
		endDate: DateTime.fromJSDate(a.endAt || a.startAt, { zone: "utc" }).toISODate() || "",
		absenceCategoryId: a.absence?.absenceCategoryId || "",
		absenceCategoryName: a.absence?.absenceCategory?.name || null,
		absenceType: a.absence?.absenceCategory?.type || null,
		status: a.approvalState,
	}));
}

/**
 * Get payroll export configuration for an organization
 */
export async function getPayrollExportConfig(
	organizationId: string,
	formatId: string,
	legalEntityId: string,
): Promise<{
	config: typeof payrollExportConfig.$inferSelect;
	format: typeof payrollExportFormat.$inferSelect;
} | null> {
	const result = await db.query.payrollExportConfig.findFirst({
		where: and(
			eq(payrollExportConfig.organizationId, organizationId),
			eq(payrollExportConfig.legalEntityId, legalEntityId),
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

async function getLegalEntityEmployeeIds(
	organizationId: string,
	legalEntityId: string,
	filters: PayrollExportFilters,
) {
	const whereConditions = [
		eq(employee.organizationId, organizationId),
		eq(employee.legalEntityId, legalEntityId),
	];

	if (filters.employeeIds && filters.employeeIds.length > 0) {
		whereConditions.push(inArray(employee.id, filters.employeeIds));
	}

	if (filters.teamIds && filters.teamIds.length > 0) {
		whereConditions.push(inArray(employee.teamId, filters.teamIds));
	}

	const employees = await db.query.employee.findMany({
		where: and(...whereConditions),
		columns: { id: true },
	});

	return employees.map((item) => item.id);
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
	legalEntityId: string,
	filters: PayrollExportFilters,
): Promise<number> {
	await assertCanonicalCutoverReady(organizationId);

	const employeeIds = await getLegalEntityEmployeeIds(organizationId, legalEntityId, filters);

	if (employeeIds.length === 0) {
		return 0;
	}

	const whereConditions = [
		eq(timeRecord.organizationId, organizationId),
		inArray(timeRecord.employeeId, employeeIds),
		eq(timeRecord.recordKind, "work"),
		eq(timeRecord.approvalState, "approved"),
		gte(timeRecord.startAt, filters.dateRange.start.toJSDate()),
		lte(timeRecord.startAt, filters.dateRange.end.endOf("day").toJSDate()),
	];

	const result = await db.query.timeRecord.findMany({
		where: and(...whereConditions),
		columns: { id: true },
		with: {
			employee: {
				columns: {
					teamId: true,
				},
			},
			allocations: {
				columns: {
					projectId: true,
				},
			},
		},
	});

	let filteredRecords = result;

	if (filters.teamIds && filters.teamIds.length > 0) {
		const teamIdSet = new Set(filters.teamIds);
		filteredRecords = filteredRecords.filter(
			(record) => record.employee?.teamId && teamIdSet.has(record.employee.teamId),
		);
	}

	if (filters.projectIds && filters.projectIds.length > 0) {
		const projectIdSet = new Set(filters.projectIds);
		filteredRecords = filteredRecords.filter((record) =>
			(record.allocations || []).some((allocation) =>
				allocation.projectId ? projectIdSet.has(allocation.projectId) : false,
			),
		);
	}

	return filteredRecords.length;
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
