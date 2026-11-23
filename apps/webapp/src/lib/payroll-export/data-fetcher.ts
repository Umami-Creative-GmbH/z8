/**
 * Data fetcher for payroll export
 * Fetches work periods, absences, and configuration from database
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
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
import { CONTRACTOR_UNAVAILABILITY_TYPE } from "@/lib/absences/absence-types";
import type { InstantRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { findOpenDepartureClockRepairs } from "@/lib/employee-lifecycle/reviews";
import { createLogger } from "@/lib/logger";
import { type EmployeeTime, loadEmployeeTime } from "@/lib/engagement/engagement-stints";
import { loadPayrollScope, type PayrollScope } from "@/lib/engagement/payroll-scope";
import { allocateEmployeeMinutes } from "@/lib/payroll-allocation/employee-minutes";
import { employeePayrollWindow } from "@/lib/payroll-allocation/protected-minutes";
import { absenceRecordDates } from "@/lib/payroll-workspace/absence-record-dates";
import {
	assertCanonicalAbsencesReady,
	assertCanonicalCutoverReady,
} from "@/lib/time-record/migration/cutover-state";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { listOvertimePayouts } from "@/lib/work-balance/adjustments/ledger";
import { buildPayrollQueryEnvelope } from "./calendar-boundaries";
import { assertNoOpenDepartureClockRepairs } from "./offboarding-repair-guard";
import type {
	AbsenceData,
	OvertimePayoutData,
	PayrollExportFilters,
	WageTypeMapping,
	WorkPeriodData,
} from "./types";
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

	// Unrepaired departure timers are neither complete nor absent: block, never omit. A timer that
	// ran in an External Contractor stint is no payroll time and blocks nothing (#1997).
	const scope = await resolveExportScope(organizationId, filters);
	await assertNoOpenDepartureClockRepairs({
		organizationId,
		employeeIds: scope.employeeIds,
		range: {
			start: dateFromInstant(queryEnvelope.start),
			endExclusive: dateFromInstant(queryEnvelope.end),
		},
		findRepairs: async (query) =>
			scope.blockingClockRepairs(await findOpenDepartureClockRepairs(db, query)),
	});

	// Build where conditions
	const whereConditions = [
		eq(timeRecord.organizationId, organizationId),
		eq(timeRecord.recordKind, "work"),
		eq(timeRecord.approvalState, "approved"),
		isNotNull(timeRecord.endAt),
		lte(timeRecord.startAt, dateFromInstant(queryEnvelope.end)),
		gte(timeRecord.endAt, dateFromInstant(queryEnvelope.start)),
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
		// The scope's candidates are every employee whose work the query above can return.
		employeeTime: scope.employeeTime,
	});

	return credited.map(({ record: p, minutes, overlap }) => ({
		id: p.id,
		sourceActorId: p.updatedBy ?? null,
		sourceRevision: p.updatedAt ? instantFromDate(p.updatedAt).toString() : null,
		employeeId: p.employeeId,
		employeeNumber: p.employee?.employeeNumber || null,
		email: p.employee?.user?.email || null,
		firstName: p.employee?.user?.firstName || null,
		lastName: p.employee?.user?.lastName || null,
		startTime: overlap.start.toZonedDateTimeISO("UTC"),
		endTime: overlap.endExclusive.toZonedDateTimeISO("UTC"),
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
		reader?: Pick<typeof db, "query" | "select">;
	} = {},
): Promise<AbsenceData[]> {
	const reader = options.reader ?? db;
	if (hasEmptyEmployeeScope(filters)) {
		return [];
	}

	if (options.canonicalReadiness === "absences") {
		await assertCanonicalAbsencesReady(organizationId, reader);
	} else {
		await assertCanonicalCutoverReady(organizationId);
	}
	const { startDate, endDate } = getLogicalDateRange(filters);
	const logicalStart = parsePlainDate(startDate).toZonedDateTime("UTC").toInstant();
	const logicalEnd = parsePlainDate(endDate)
		.add({ days: 1 })
		.toZonedDateTime("UTC")
		.toInstant()
		.subtract({ milliseconds: 1 });

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
		const teamEmployees = await reader.query.employee.findMany({
			where: and(
				eq(employee.organizationId, organizationId),
				inArray(employee.teamId, filters.teamIds),
			),
			columns: { id: true },
		});
		employeeIds = teamEmployees.map((e) => e.id);
	} else {
		// Get all employees for org
		const orgEmployees = await reader.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { id: true },
		});
		employeeIds = orgEmployees.map((e) => e.id);
	}

	if (employeeIds.length === 0) {
		return [];
	}

	const absences = await reader.query.timeRecord.findMany({
		where: and(
			eq(timeRecord.organizationId, organizationId),
			eq(timeRecord.recordKind, "absence"),
			eq(timeRecord.approvalState, "approved"),
			inArray(timeRecord.employeeId, employeeIds),
			lte(timeRecord.startAt, dateFromInstant(logicalEnd)),
			// An end exactly at the first midnight is exclusive (`absenceRecordDates`).
			or(gt(timeRecord.endAt, dateFromInstant(logicalStart)), isNull(timeRecord.endAt)),
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
					startPeriod: true,
					endPeriod: true,
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

	// An External Contractor's unavailability is a calendar marker, never a payroll absence (#1996).
	const payrollAbsences = absences.filter(
		(a) => a.absence?.absenceCategory?.type !== CONTRACTOR_UNAVAILABILITY_TYPE,
	);
	// Only the employee days of an absence are payroll absence days (#1997).
	const employeeTime = await loadEmployeeTime(
		reader,
		organizationId,
		payrollAbsences.map((a) => a.employeeId),
	);
	return payrollAbsences.flatMap((a) => {
		// Wall clock encoded as UTC; an exclusive next-midnight end (canonical backfill of
		// legacy entries) belongs to the day before.
		const recordDates = absenceRecordDates({
			startAt: a.startAt,
			endAt: a.endAt,
			startPeriod: a.absence?.startPeriod ?? "full_day",
			endPeriod: a.absence?.endPeriod ?? "full_day",
		});
		const employeeDays = employeeTime.employeeDaysOf(a.employeeId, recordDates);
		if (!employeeDays) return [];
		const { startDate, endDate } = employeeDays;
		return {
			id: a.id,
			sourceActorId: a.updatedBy ?? null,
			sourceRevision: a.updatedAt ? instantFromDate(a.updatedAt).toString() : null,
			employeeId: a.employeeId,
			employeeNumber: a.employee?.employeeNumber || null,
			email: a.employee?.user?.email || null,
			firstName: a.employee?.user?.firstName || null,
			lastName: a.employee?.user?.lastName || null,
			startDate,
			endDate,
			absenceCategoryId: a.absence?.absenceCategoryId || "",
			absenceCategoryName: a.absence?.absenceCategory?.name || null,
			absenceType: a.absence?.absenceCategory?.type || null,
			status: a.approvalState,
		};
	});
}

/**
 * The uncancelled overtime payouts (#1001) whose local day lies within the
 * export's logical dates, for the employees the export covers, with the
 * identity the payroll files name them by. Read when the job is processed,
 * like absences. A project selection does not narrow them: a payout belongs
 * to no project.
 */
export async function fetchOvertimePayoutsForExport(
	organizationId: string,
	filters: PayrollExportFilters,
	reader: Pick<typeof db, "select" | "query"> = db,
): Promise<OvertimePayoutData[]> {
	if (hasEmptyEmployeeScope(filters)) {
		return [];
	}

	const { startDate, endDate } = getLogicalDateRange(filters);
	const scope = await resolveExportScope(organizationId, filters, reader);
	const listed = await listOvertimePayouts(reader, {
		organizationId,
		employeeIds: [...scope.employeeIds],
		fromDate: startDate,
		throughDate: endDate,
	});
	// A payout on a day of an External Contractor stint is no payroll line (#1997).
	const payouts = listed.filter((payout) =>
		scope.employeeTime.isEmployeeDay(payout.employeeId, payout.day),
	);
	if (payouts.length === 0) {
		return [];
	}

	const people = await reader.query.employee.findMany({
		where: and(
			eq(employee.organizationId, organizationId),
			inArray(employee.id, [...new Set(payouts.map((payout) => payout.employeeId))]),
		),
		columns: { id: true, employeeNumber: true },
		with: {
			user: { columns: { firstName: true, lastName: true, email: true } },
		},
	});
	const byId = new Map(people.map((person) => [person.id, person]));

	logger.info(
		{ organizationId, count: payouts.length },
		"Fetched overtime payouts for payroll export",
	);

	return payouts.map((payout) => {
		const person = byId.get(payout.employeeId);
		return {
			id: payout.id,
			sourceRevision: payout.recordedAt ? instantFromDate(payout.recordedAt).toString() : null,
			sourceReason: payout.reason ?? null,
			sourceActorId: payout.recordedBy ?? null,
			employeeId: payout.employeeId,
			employeeNumber: person?.employeeNumber || null,
			email: person?.user?.email || null,
			firstName: person?.user?.firstName || null,
			lastName: person?.user?.lastName || null,
			day: payout.day,
			// Stored negative: the payout lowers the work balance.
			minutes: -payout.minutes,
		};
	});
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
 * Get an organization's wage type mappings. One set serves every export format;
 * each format reads its own code column (`wageTypeCodeFor`).
 */
export async function getWageTypeMappings(
	organizationId: string,
	reader: Pick<typeof db, "query"> = db,
): Promise<WageTypeMapping[]> {
	const mappings = await reader.query.payrollWageTypeMapping.findMany({
		where: and(
			eq(payrollWageTypeMapping.organizationId, organizationId),
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
			// An External Contractor's unavailability is never a payroll absence (#1996).
			ne(absenceCategory.type, CONTRACTOR_UNAVAILABILITY_TYPE),
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
			// External Contractors are badged and filterable in the picker (#1995).
			engagementKind: employee.engagementKind,
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
		lte(timeRecord.startAt, dateFromInstant(queryEnvelope.end)),
		gte(timeRecord.endAt, dateFromInstant(queryEnvelope.start)),
	];

	if (filters.employeeIds && filters.employeeIds.length > 0) {
		whereConditions.push(inArray(timeRecord.employeeId, filters.employeeIds));
	}

	const result = await db.query.timeRecord.findMany({
		where: and(...whereConditions),
		columns: {
			id: true,
			employeeId: true,
			startAt: true,
			endAt: true,
			durationMinutes: true,
		},
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
		employeeTime: await loadEmployeeTime(
			db,
			organizationId,
			filteredRecords.map((record) => record.employeeId),
		),
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
 * window, within employee time only (#1997): External Contractor work is never exported and never
 * blocks. Zero-credit work contributes nothing and produces no export line; any record that cannot
 * be credited blocks the whole export.
 */
function creditExportWorkPeriods<TRecord extends ExportWorkRecord>(
	organizationId: string,
	records: TRecord[],
	range: {
		startDate: string;
		endDate: string;
		organizationTimezone: string;
		employeeTime: EmployeeTime;
	},
): Array<{ record: TRecord; minutes: number; overlap: InstantRange }> {
	const credited: Array<{
		record: TRecord;
		minutes: number;
		overlap: InstantRange;
	}> = [];
	const blocked: BlockedPayrollWorkRecord[] = [];

	for (const record of records) {
		if (!record.endAt || !record.employee) continue;

		const timezone = resolveEffectiveTimezone(
			record.employee.userSettings?.timezone,
			range.organizationTimezone,
		);
		const allocation = allocateEmployeeMinutes(
			{
				startAt: instantFromDate(record.startAt),
				endAt: instantFromDate(record.endAt),
				storedMinutes: record.durationMinutes,
			},
			employeePayrollWindow(range.startDate, range.endDate, timezone),
			range.employeeTime.stintsOf(record.employeeId),
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

/**
 * Helper to serialize filters for logging
 */
function serializeFilters(filters: PayrollExportFilters) {
	return {
		dateRange: {
			start: filters.dateRange.start.toString(),
			end: filters.dateRange.end.toString(),
		},
		employeeIds: filters.employeeIds,
		teamIds: filters.teamIds,
		projectIds: filters.projectIds,
	};
}

/**
 * The employees whose work, absences and payouts an export carries: its payroll scope, so a
 * payroll access holder's export covers only their payroll scope. An explicitly empty selection
 * covers nobody. A person with no employee time in the period is left out (#1997).
 */
export async function resolvePayrollRunEmployeeIds(
	organizationId: string,
	filters: PayrollExportFilters,
	reader: Pick<typeof db, "query" | "select"> = db,
): Promise<string[]> {
	if (hasEmptyEmployeeScope(filters)) return [];
	return [...(await resolveExportScope(organizationId, filters, reader)).employeeIds];
}

/**
 * The employees whose reports awaiting reimbursement a payroll run of the export classifies
 * (#852): everyone the export selects, with or without employee time in the period. A report goes
 * by its own days (#1997), not by the period: a converted person's report of their employee days
 * is carried even by a run of a period they spent as an External Contractor (its file then has
 * their money lines alone), and an External Contractor's report is left out of every run, which
 * says so. An explicitly empty selection covers nobody.
 */
export async function resolvePayrollRunExpenseEmployeeIds(
	organizationId: string,
	filters: PayrollExportFilters,
	reader: Pick<typeof db, "query"> = db,
): Promise<string[]> {
	if (hasEmptyEmployeeScope(filters)) return [];
	return resolveExportCandidates(organizationId, filters, reader);
}

/**
 * The payroll scope of an export: its candidates less anyone without employee time on the
 * export's dates (#1997). An External Contractor is never part of an employee payroll export,
 * even when selected by name.
 */
async function resolveExportScope(
	organizationId: string,
	filters: PayrollExportFilters,
	reader: Pick<typeof db, "query" | "select"> = db,
): Promise<PayrollScope> {
	const candidates = await resolveExportCandidates(organizationId, filters, reader);
	return loadPayrollScope(reader, organizationId, candidates, getLogicalDateRange(filters));
}

/** The explicit selection, else the organization's employees (optionally by team). */
async function resolveExportCandidates(
	organizationId: string,
	filters: PayrollExportFilters,
	reader: Pick<typeof db, "query">,
): Promise<string[]> {
	if (filters.employeeIds && filters.employeeIds.length > 0) return [...filters.employeeIds];
	const rows = await reader.query.employee.findMany({
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
	return {
		startDate: filters.dateRange.start.toString(),
		endDate: filters.dateRange.end.toString(),
	};
}

async function getOrganizationTimezone(organizationId: string) {
	const scopedOrganization = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { timezone: true },
	});
	return scopedOrganization?.timezone ?? "UTC";
}
