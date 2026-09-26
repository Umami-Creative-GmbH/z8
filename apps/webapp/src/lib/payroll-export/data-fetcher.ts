/**
 * Data fetcher for payroll export
 * Fetches work periods, absences, and configuration from database
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	absenceCategory,
	db,
	employee,
	organization,
	payrollExportConfig,
	type payrollExportFormat,
	payrollWageTypeMapping,
	user,
	workCategory,
} from "@/db";
import { timeRecord } from "@/db/schema";
import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { findOpenDepartureClockRepairs } from "@/lib/employee-lifecycle/reviews";
import { createLogger } from "@/lib/logger";
import {
	allocateProtectedMinutes,
	employeePayrollWindow,
} from "@/lib/payroll-allocation/protected-minutes";
import {
	assertCanonicalAbsencesReady,
	assertCanonicalCutoverReady,
} from "@/lib/time-record/migration/cutover-state";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { buildPayrollQueryEnvelope } from "./calendar-boundaries";
import { assertNoOpenDepartureClockRepairs } from "./offboarding-repair-guard";
import type { AbsenceData, PayrollExportFilters, WageTypeMapping, WorkPeriodData } from "./types";
import {
	type BlockedPayrollWorkRecord,
	PayrollWorkAllocationBlockedError,
} from "./work-allocation-blocked-error";

const logger = createLogger("PayrollExportDataFetcher");

/**
 * Fetch work periods with filters for payroll export
 */
export async function fetchWorkPeriodsForExport(
	organizationId: string,
	filters: PayrollExportFilters,
): Promise<WorkPeriodData[]> {
	if (hasEmptyEmployeeScope(filters)) {
		return [];
	}

	await assertCanonicalCutoverReady(organizationId);

	logger.info(
		{ organizationId, filters: serializeFilters(filters) },
		"Fetching work periods for payroll export",
	);

	const { startDate, endDate } = getLogicalDateRange(filters);
	const queryEnvelope = buildPayrollQueryEnvelope(startDate, endDate);
	const organizationTimezone = await getOrganizationTimezone(organizationId);

	// Unrepaired departure timers are neither complete nor absent: block, never omit.
	await assertNoOpenDepartureClockRepairs({
		organizationId,
		employeeIds: await resolveExportEmployeeIds(organizationId, filters),
		range: { start: queryEnvelope.start.toJSDate(), endExclusive: queryEnvelope.end.toJSDate() },
		findRepairs: (query) => findOpenDepartureClockRepairs(db, query),
	});

	// Build where conditions
	const whereConditions = [
		eq(timeRecord.organizationId, organizationId),
		eq(timeRecord.recordKind, "work"),
		eq(timeRecord.approvalState, "approved"),
		isNotNull(timeRecord.endAt),
		lte(timeRecord.startAt, queryEnvelope.end.toJSDate()),
		gte(timeRecord.endAt, queryEnvelope.start.toJSDate()),
	];

	// Add employee filter if specified
	if (filters.employeeIds && filters.employeeIds.length > 0) {
		whereConditions.push(inArray(timeRecord.employeeId, filters.employeeIds));
	}

	// Fetch work periods with employee and category data
	const periods = await db.query.timeRecord.findMany({
		where: and(...whereConditions),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
					teamId: true,
				},
				with: {
					user: {
						columns: {
							firstName: true,
							lastName: true,
							email: true,
						},
					},
					userSettings: {
						columns: { timezone: true },
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

	const credited = creditExportWorkPeriods(organizationId, filteredPeriods, {
		startDate,
		endDate,
		organizationTimezone,
	});

	return credited.map(({ record: p, minutes, overlap }) => ({
		id: p.id,
		employeeId: p.employeeId,
		employeeNumber: p.employee?.employeeNumber || null,
		email: p.employee?.user?.email || null,
		firstName: p.employee?.user?.firstName || null,
		lastName: p.employee?.user?.lastName || null,
		startTime: dateTimeFromInstant(overlap.start),
		endTime: dateTimeFromInstant(overlap.endExclusive),
		durationMinutes: minutes,
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
	filters: PayrollExportFilters,
	options: {
		/** `absences`: read-only absence check for jobs with collected work input (#322). */
		canonicalReadiness?: "cutover" | "absences";
	} = {},
): Promise<AbsenceData[]> {
	if (hasEmptyEmployeeScope(filters)) {
		return [];
	}

	if (options.canonicalReadiness === "absences") {
		await assertCanonicalAbsencesReady(organizationId);
	} else {
		await assertCanonicalCutoverReady(organizationId);
	}
	const { startDate, endDate } = getLogicalDateRange(filters);
	const logicalStart = DateTime.fromISO(startDate, { zone: "utc" }).startOf("day");
	const logicalEnd = DateTime.fromISO(endDate, { zone: "utc" }).endOf("day");

	logger.info(
		{ organizationId, filters: serializeFilters(filters) },
		"Fetching absences for payroll export",
	);

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

	const absences = await db.query.timeRecord.findMany({
		where: and(
			eq(timeRecord.organizationId, organizationId),
			eq(timeRecord.recordKind, "absence"),
			eq(timeRecord.approvalState, "approved"),
			inArray(timeRecord.employeeId, employeeIds),
			lte(timeRecord.startAt, logicalEnd.toJSDate()),
			or(gte(timeRecord.endAt, logicalStart.toJSDate()), isNull(timeRecord.endAt)),
		),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
				},
				with: {
					user: {
						columns: {
							firstName: true,
							lastName: true,
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
		firstName: a.employee?.user?.firstName || null,
		lastName: a.employee?.user?.lastName || null,
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
	return db
		.select({
			id: employee.id,
			firstName: user.firstName,
			lastName: user.lastName,
			employeeNumber: employee.employeeNumber,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
		.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)))
		.orderBy(asc(user.lastName), asc(user.firstName));
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
	if (hasEmptyEmployeeScope(filters)) {
		return 0;
	}

	await assertCanonicalCutoverReady(organizationId);

	const { startDate, endDate } = getLogicalDateRange(filters);
	const queryEnvelope = buildPayrollQueryEnvelope(startDate, endDate);
	const organizationTimezone = await getOrganizationTimezone(organizationId);

	const whereConditions = [
		eq(timeRecord.organizationId, organizationId),
		eq(timeRecord.recordKind, "work"),
		eq(timeRecord.approvalState, "approved"),
		isNotNull(timeRecord.endAt),
		lte(timeRecord.startAt, queryEnvelope.end.toJSDate()),
		gte(timeRecord.endAt, queryEnvelope.start.toJSDate()),
	];

	if (filters.employeeIds && filters.employeeIds.length > 0) {
		whereConditions.push(inArray(timeRecord.employeeId, filters.employeeIds));
	}

	const result = await db.query.timeRecord.findMany({
		where: and(...whereConditions),
		columns: { id: true, employeeId: true, startAt: true, endAt: true, durationMinutes: true },
		with: {
			employee: {
				columns: {
					teamId: true,
				},
				with: {
					userSettings: { columns: { timezone: true } },
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

	return creditExportWorkPeriods(organizationId, filteredRecords, {
		startDate,
		endDate,
		organizationTimezone,
	}).length;
}

interface ExportWorkRecord {
	id: string;
	employeeId: string;
	startAt: Date;
	endAt: Date | null;
	durationMinutes: number | null;
	employee: { userSettings?: { timezone: string | null } | null } | null;
}

/**
 * Credits export work with the shared protected-minute rule in each employee's local payroll
 * window. Zero-credit work contributes nothing and produces no export line; any record that cannot
 * be credited blocks the whole export.
 */
function creditExportWorkPeriods<TRecord extends ExportWorkRecord>(
	organizationId: string,
	records: TRecord[],
	range: { startDate: string; endDate: string; organizationTimezone: string },
): Array<{ record: TRecord; minutes: number; overlap: InstantRange }> {
	const credited: Array<{ record: TRecord; minutes: number; overlap: InstantRange }> = [];
	const blocked: BlockedPayrollWorkRecord[] = [];

	for (const record of records) {
		if (!record.endAt || !record.employee) continue;

		const timezone = resolveEffectiveTimezone(
			record.employee.userSettings?.timezone,
			range.organizationTimezone,
		);
		const allocation = allocateProtectedMinutes(
			{
				startAt: instantFromDate(record.startAt),
				endAt: instantFromDate(record.endAt),
				storedMinutes: record.durationMinutes,
			},
			employeePayrollWindow(range.startDate, range.endDate, timezone),
		);

		if (allocation.status === "blocked") {
			blocked.push({
				recordId: record.id,
				employeeId: record.employeeId,
				reason: allocation.reason,
			});
		} else if (allocation.status === "allocated" && allocation.minutes > 0) {
			credited.push({
				record,
				minutes: allocation.minutes,
				overlap: allocation.overlap,
			});
		}
	}

	if (blocked.length > 0) {
		logger.warn(
			{ organizationId, blockedRecords: blocked },
			"Payroll export blocked by unresolved work minutes",
		);
		throw new PayrollWorkAllocationBlockedError(organizationId, blocked);
	}

	return credited;
}

function dateTimeFromInstant(instant: Instant): DateTime {
	return DateTime.fromMillis(instant.epochMilliseconds, { zone: "utc" });
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

/** Employees an export covers: the explicit selection, else the organization (optionally by team). */
async function resolveExportEmployeeIds(
	organizationId: string,
	filters: PayrollExportFilters,
): Promise<string[]> {
	if (filters.employeeIds && filters.employeeIds.length > 0) return filters.employeeIds;
	const rows = await db.query.employee.findMany({
		where:
			filters.teamIds && filters.teamIds.length > 0
				? and(
						eq(employee.organizationId, organizationId),
						inArray(employee.teamId, filters.teamIds),
					)
				: eq(employee.organizationId, organizationId),
		columns: { id: true },
	});
	return rows.map((row) => row.id);
}

function hasEmptyEmployeeScope(filters: PayrollExportFilters) {
	return filters.employeeIds !== undefined && filters.employeeIds.length === 0;
}

function getLogicalDateRange(filters: PayrollExportFilters) {
	const startDate = filters.dateRange.start.toISODate();
	const endDate = filters.dateRange.end.toISODate();
	if (!startDate || !endDate) {
		throw new Error("Invalid payroll export date range");
	}
	return { startDate, endDate };
}

async function getOrganizationTimezone(organizationId: string) {
	const scopedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	return scopedOrganization?.timezone ?? "UTC";
}
