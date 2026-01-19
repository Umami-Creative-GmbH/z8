/**
 * Data fetchers for export functionality
 * This file contains server-only code that accesses the database
 */
import { and, eq, inArray } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	auditLog,
	db,
	employee,
	employeeManagers,
	employeeVacationAllowance,
	holiday,
	holidayAssignment,
	holidayCategory,
	holidayPreset,
	holidayPresetAssignment,
	holidayPresetHoliday,
	shift,
	shiftRequest,
	shiftTemplate,
	team,
	teamPermissions,
	timeEntry,
	vacationAllowance,
	vacationPolicyAssignment,
	workPeriod,
	workScheduleAssignment,
	workScheduleTemplate,
	workScheduleTemplateDays,
} from "@/db";
import { createLogger } from "@/lib/logger";

// Import types for internal use
import type { ExportCategory } from "./types";

// Re-export types for backward compatibility with server-side code
export { CATEGORY_LABELS, EXPORT_CATEGORIES, type ExportCategory } from "./types";

const logger = createLogger("ExportDataFetchers");

/**
 * Fetch all employees for an organization
 * Format: JSON (structured data with relations)
 */
export async function fetchEmployees(organizationId: string) {
	logger.info({ organizationId }, "Fetching employees for export");

	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		with: {
			team: true,
			user: {
				columns: {
					id: true,
					name: true,
					email: true,
					image: true,
				},
			},
			userSettings: {
				columns: {
					timezone: true,
				},
			},
		},
	});

	// Extract employee IDs for filtering
	const employeeIds = employees.map((e) => e.id);

	// Fetch manager relationships using proper database-level filtering
	const relevantManagerRelations =
		employeeIds.length > 0
			? await db.query.employeeManagers.findMany({
					where: inArray(employeeManagers.employeeId, employeeIds),
				})
			: [];

	logger.info({ count: employees.length }, "Fetched employees");

	return {
		employees: employees.map((emp) => ({
			id: emp.id,
			firstName: emp.firstName,
			lastName: emp.lastName,
			gender: emp.gender,
			birthday: emp.birthday,
			role: emp.role,
			employeeNumber: emp.employeeNumber,
			position: emp.position,
			startDate: emp.startDate,
			endDate: emp.endDate,
			isActive: emp.isActive,
			teamId: emp.teamId,
			teamName: emp.team?.name,
			email: emp.user?.email,
			name: emp.user?.name,
			timezone: emp.userSettings?.timezone,
		})),
		managerRelations: relevantManagerRelations.map((mr) => ({
			employeeId: mr.employeeId,
			managerId: mr.managerId,
			isPrimary: mr.isPrimary,
			assignedAt: mr.assignedAt,
		})),
	};
}

/**
 * Fetch all teams for an organization
 * Format: JSON (hierarchical structure)
 */
export async function fetchTeams(organizationId: string) {
	logger.info({ organizationId }, "Fetching teams for export");

	const teams = await db.query.team.findMany({
		where: eq(team.organizationId, organizationId),
	});

	// Fetch team permissions
	const permissions = await db.query.teamPermissions.findMany({
		where: eq(teamPermissions.organizationId, organizationId),
	});

	logger.info({ count: teams.length }, "Fetched teams");

	return {
		teams: teams.map((t) => ({
			id: t.id,
			name: t.name,
			description: t.description,
			createdAt: t.createdAt,
		})),
		permissions: permissions.map((p) => ({
			teamId: p.teamId,
			employeeId: p.employeeId,
			canCreateTeams: p.canCreateTeams,
			canManageTeamMembers: p.canManageTeamMembers,
			canManageTeamSettings: p.canManageTeamSettings,
			canApproveTeamRequests: p.canApproveTeamRequests,
		})),
	};
}

/**
 * Fetch all time entries for an organization
 * Format: CSV (large volume, tabular)
 */
export async function fetchTimeEntries(organizationId: string) {
	logger.info({ organizationId }, "Fetching time entries for export");

	// First get all employee IDs for this org
	const orgEmployees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		columns: { id: true },
	});

	const employeeIds = orgEmployees.map((e) => e.id);

	if (employeeIds.length === 0) {
		return [];
	}

	// Fetch time entries with proper database-level filtering
	const filteredEntries = await db.query.timeEntry.findMany({
		where: inArray(timeEntry.employeeId, employeeIds),
		with: {
			employee: {
				columns: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
				},
			},
		},
	});

	logger.info({ count: filteredEntries.length }, "Fetched time entries");

	return filteredEntries.map((entry) => ({
		id: entry.id,
		employeeId: entry.employeeId,
		employeeName: `${entry.employee?.firstName || ""} ${entry.employee?.lastName || ""}`.trim(),
		employeeNumber: entry.employee?.employeeNumber,
		type: entry.type,
		timestamp: entry.timestamp,
		notes: entry.notes,
		location: entry.location,
		deviceInfo: entry.deviceInfo,
		replacesEntryId: entry.replacesEntryId,
		isSuperseded: entry.isSuperseded,
		createdAt: entry.createdAt,
	}));
}

/**
 * Fetch all work periods for an organization
 * Format: CSV (large volume, tabular)
 */
export async function fetchWorkPeriods(organizationId: string) {
	logger.info({ organizationId }, "Fetching work periods for export");

	// Get employee IDs for this org
	const orgEmployees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		columns: { id: true },
	});

	const employeeIds = orgEmployees.map((e) => e.id);

	if (employeeIds.length === 0) {
		return [];
	}

	// Fetch work periods with proper database-level filtering
	const filteredPeriods = await db.query.workPeriod.findMany({
		where: inArray(workPeriod.employeeId, employeeIds),
		with: {
			employee: {
				columns: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
				},
			},
		},
	});

	logger.info({ count: filteredPeriods.length }, "Fetched work periods");

	return filteredPeriods.map((period) => ({
		id: period.id,
		employeeId: period.employeeId,
		employeeName: `${period.employee?.firstName || ""} ${period.employee?.lastName || ""}`.trim(),
		employeeNumber: period.employee?.employeeNumber,
		startTime: period.startTime,
		endTime: period.endTime,
		durationMinutes: period.durationMinutes,
		isActive: period.isActive,
		clockInId: period.clockInId,
		clockOutId: period.clockOutId,
		createdAt: period.createdAt,
	}));
}

/**
 * Fetch all absences for an organization
 * Format: CSV (tabular with dates)
 */
export async function fetchAbsences(organizationId: string) {
	logger.info({ organizationId }, "Fetching absences for export");

	// Get employee IDs and absence categories
	const orgEmployees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		columns: { id: true },
	});

	const employeeIds = orgEmployees.map((e) => e.id);

	const categories = await db.query.absenceCategory.findMany({
		where: eq(absenceCategory.organizationId, organizationId),
	});

	if (employeeIds.length === 0) {
		return { absences: [], categories };
	}

	// Fetch absences with proper database-level filtering
	const filteredAbsences = await db.query.absenceEntry.findMany({
		where: inArray(absenceEntry.employeeId, employeeIds),
		with: {
			employee: {
				columns: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
				},
			},
			category: true,
		},
	});

	logger.info({ count: filteredAbsences.length }, "Fetched absences");

	return {
		absences: filteredAbsences.map((absence) => ({
			id: absence.id,
			employeeId: absence.employeeId,
			employeeName:
				`${absence.employee?.firstName || ""} ${absence.employee?.lastName || ""}`.trim(),
			employeeNumber: absence.employee?.employeeNumber,
			categoryId: absence.categoryId,
			categoryName: absence.category?.name,
			absenceType: absence.category?.type,
			startDate: absence.startDate,
			endDate: absence.endDate,
			status: absence.status,
			notes: absence.notes,
			approvedBy: absence.approvedBy,
			approvedAt: absence.approvedAt,
			rejectionReason: absence.rejectionReason,
			createdAt: absence.createdAt,
		})),
		categories: categories.map((cat) => ({
			id: cat.id,
			name: cat.name,
			type: cat.type,
			color: cat.color,
			requiresApproval: cat.requiresApproval,
			countsAgainstVacation: cat.countsAgainstVacation,
			requiresWorkTime: cat.requiresWorkTime,
			isActive: cat.isActive,
		})),
	};
}

/**
 * Fetch all holidays for an organization
 * Format: JSON (includes recurrence rules)
 */
export async function fetchHolidays(organizationId: string) {
	logger.info({ organizationId }, "Fetching holidays for export");

	const categories = await db.query.holidayCategory.findMany({
		where: eq(holidayCategory.organizationId, organizationId),
	});

	const holidays = await db.query.holiday.findMany({
		where: eq(holiday.organizationId, organizationId),
	});

	const presets = await db.query.holidayPreset.findMany({
		where: eq(holidayPreset.organizationId, organizationId),
	});

	const presetIds = presets.map((p) => p.id);
	const filteredPresetHolidays =
		presetIds.length > 0
			? await db.query.holidayPresetHoliday.findMany({
					where: inArray(holidayPresetHoliday.presetId, presetIds),
				})
			: [];

	const presetAssignments = await db.query.holidayPresetAssignment.findMany({
		where: eq(holidayPresetAssignment.organizationId, organizationId),
	});

	const holidayAssignments = await db.query.holidayAssignment.findMany({
		where: eq(holidayAssignment.organizationId, organizationId),
	});

	logger.info({ holidaysCount: holidays.length, presetsCount: presets.length }, "Fetched holidays");

	return {
		categories: categories.map((cat) => ({
			id: cat.id,
			name: cat.name,
			type: cat.type,
			color: cat.color,
		})),
		holidays: holidays.map((h) => ({
			id: h.id,
			name: h.name,
			description: h.description,
			categoryId: h.categoryId,
			startDate: h.startDate,
			endDate: h.endDate,
			recurrenceType: h.recurrenceType,
			recurrenceRule: h.recurrenceRule,
			recurrenceEndDate: h.recurrenceEndDate,
			isActive: h.isActive,
		})),
		presets: presets.map((p) => ({
			id: p.id,
			name: p.name,
			description: p.description,
			countryCode: p.countryCode,
			stateCode: p.stateCode,
			regionCode: p.regionCode,
			isActive: p.isActive,
		})),
		presetHolidays: filteredPresetHolidays.map((ph) => ({
			presetId: ph.presetId,
			name: ph.name,
			description: ph.description,
			month: ph.month,
			day: ph.day,
			durationDays: ph.durationDays,
			holidayType: ph.holidayType,
			isFloating: ph.isFloating,
			floatingRule: ph.floatingRule,
			categoryId: ph.categoryId,
			isActive: ph.isActive,
		})),
		presetAssignments: presetAssignments.map((pa) => ({
			presetId: pa.presetId,
			assignmentType: pa.assignmentType,
			teamId: pa.teamId,
			employeeId: pa.employeeId,
			priority: pa.priority,
		})),
		holidayAssignments: holidayAssignments.map((ha) => ({
			holidayId: ha.holidayId,
			assignmentType: ha.assignmentType,
			teamId: ha.teamId,
			employeeId: ha.employeeId,
		})),
	};
}

/**
 * Fetch all vacation policies and allowances for an organization
 * Format: JSON (policy configuration)
 */
export async function fetchVacation(organizationId: string) {
	logger.info({ organizationId }, "Fetching vacation data for export");

	const allowances = await db.query.vacationAllowance.findMany({
		where: eq(vacationAllowance.organizationId, organizationId),
	});

	// Get employee IDs for this org
	const orgEmployees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		columns: { id: true },
	});
	const employeeIds = orgEmployees.map((e) => e.id);

	const filteredEmployeeAllowances =
		employeeIds.length > 0
			? await db.query.employeeVacationAllowance.findMany({
					where: inArray(employeeVacationAllowance.employeeId, employeeIds),
				})
			: [];

	const policyAssignments = await db.query.vacationPolicyAssignment.findMany({
		where: eq(vacationPolicyAssignment.organizationId, organizationId),
	});

	logger.info(
		{
			allowancesCount: allowances.length,
			employeeAllowancesCount: filteredEmployeeAllowances.length,
		},
		"Fetched vacation data",
	);

	return {
		allowances: allowances.map((a) => ({
			id: a.id,
			name: a.name,
			startDate: a.startDate,
			validUntil: a.validUntil,
			isCompanyDefault: a.isCompanyDefault,
			defaultAnnualDays: a.defaultAnnualDays,
			accrualType: a.accrualType,
			accrualStartMonth: a.accrualStartMonth,
			allowCarryover: a.allowCarryover,
			maxCarryoverDays: a.maxCarryoverDays,
			carryoverExpiryMonths: a.carryoverExpiryMonths,
		})),
		employeeAllowances: filteredEmployeeAllowances.map((ea) => ({
			employeeId: ea.employeeId,
			year: ea.year,
			customAnnualDays: ea.customAnnualDays,
			customCarryoverDays: ea.customCarryoverDays,
		})),
		policyAssignments: policyAssignments.map((pa) => ({
			policyId: pa.policyId,
			assignmentType: pa.assignmentType,
			teamId: pa.teamId,
			employeeId: pa.employeeId,
			priority: pa.priority,
			effectiveFrom: pa.effectiveFrom,
			effectiveUntil: pa.effectiveUntil,
			isActive: pa.isActive,
		})),
	};
}

/**
 * Fetch all work schedules for an organization
 * Format: JSON (complex nested structure)
 */
export async function fetchSchedules(organizationId: string) {
	logger.info({ organizationId }, "Fetching work schedules for export");

	const templates = await db.query.workScheduleTemplate.findMany({
		where: eq(workScheduleTemplate.organizationId, organizationId),
	});

	const templateIds = templates.map((t) => t.id);
	const filteredTemplateDays =
		templateIds.length > 0
			? await db.query.workScheduleTemplateDays.findMany({
					where: inArray(workScheduleTemplateDays.templateId, templateIds),
				})
			: [];

	const assignments = await db.query.workScheduleAssignment.findMany({
		where: eq(workScheduleAssignment.organizationId, organizationId),
	});

	logger.info(
		{ templatesCount: templates.length, assignmentsCount: assignments.length },
		"Fetched work schedules",
	);

	return {
		templates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			description: t.description,
			scheduleCycle: t.scheduleCycle,
			scheduleType: t.scheduleType,
			hoursPerCycle: t.hoursPerCycle,
			homeOfficeDaysPerCycle: t.homeOfficeDaysPerCycle,
			workingDaysPreset: t.workingDaysPreset,
			isDefault: t.isDefault,
			isActive: t.isActive,
		})),
		templateDays: filteredTemplateDays.map((td) => ({
			templateId: td.templateId,
			dayOfWeek: td.dayOfWeek,
			hoursPerDay: td.hoursPerDay,
			isWorkDay: td.isWorkDay,
			cycleWeek: td.cycleWeek,
		})),
		assignments: assignments.map((a) => ({
			templateId: a.templateId,
			employeeId: a.employeeId,
			teamId: a.teamId,
			priority: a.priority,
			effectiveFrom: a.effectiveFrom,
			effectiveUntil: a.effectiveUntil,
		})),
	};
}

/**
 * Fetch all shifts for an organization
 * Format: CSV (large volume, date-based)
 */
export async function fetchShifts(organizationId: string) {
	logger.info({ organizationId }, "Fetching shifts for export");

	const templates = await db.query.shiftTemplate.findMany({
		where: eq(shiftTemplate.organizationId, organizationId),
	});

	const shifts = await db.query.shift.findMany({
		where: eq(shift.organizationId, organizationId),
		with: {
			employee: {
				columns: {
					id: true,
					firstName: true,
					lastName: true,
					employeeNumber: true,
				},
			},
			template: true,
		},
	});

	const shiftIds = shifts.map((s) => s.id);
	const filteredRequests =
		shiftIds.length > 0
			? await db.query.shiftRequest.findMany({
					where: inArray(shiftRequest.shiftId, shiftIds),
				})
			: [];

	logger.info(
		{ shiftsCount: shifts.length, requestsCount: filteredRequests.length },
		"Fetched shifts",
	);

	return {
		templates: templates.map((t) => ({
			id: t.id,
			name: t.name,
			startTime: t.startTime,
			endTime: t.endTime,
			color: t.color,
			isActive: t.isActive,
		})),
		shifts: shifts.map((s) => ({
			id: s.id,
			templateId: s.templateId,
			templateName: s.template?.name,
			employeeId: s.employeeId,
			employeeName: s.employee
				? `${s.employee.firstName || ""} ${s.employee.lastName || ""}`.trim()
				: null,
			date: s.date,
			startTime: s.startTime,
			endTime: s.endTime,
			status: s.status,
			publishedAt: s.publishedAt,
			notes: s.notes,
		})),
		requests: filteredRequests.map((r) => ({
			id: r.id,
			shiftId: r.shiftId,
			requesterId: r.requesterId,
			type: r.type,
			targetEmployeeId: r.targetEmployeeId,
			status: r.status,
			reason: r.reason,
			reasonCategory: r.reasonCategory,
			notes: r.notes,
			approverId: r.approverId,
			approvedAt: r.approvedAt,
			rejectionReason: r.rejectionReason,
			createdAt: r.createdAt,
		})),
	};
}

/**
 * Fetch audit logs for an organization
 * Format: CSV (large volume, tabular)
 * Note: We filter by entity types that are org-scoped
 */
export async function fetchAuditLogs(organizationId: string) {
	logger.info({ organizationId }, "Fetching audit logs for export");

	// Get all employee IDs and team IDs for this org to filter audit logs
	const orgEmployees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		columns: { id: true, userId: true },
	});

	const orgTeams = await db.query.team.findMany({
		where: eq(team.organizationId, organizationId),
		columns: { id: true },
	});

	const employeeIds = new Set(orgEmployees.map((e) => e.id));
	const userIds = new Set(orgEmployees.map((e) => e.userId));
	const teamIds = new Set(orgTeams.map((t) => t.id));

	// Fetch audit logs - we'll need to filter them
	const logs = await db.query.auditLog.findMany({
		orderBy: (auditLog, { desc }) => [desc(auditLog.timestamp)],
		limit: 10000, // Limit to prevent massive exports
	});

	// Filter to logs related to this organization's entities
	const filteredLogs = logs.filter((log) => {
		// Direct org reference
		if (log.entityType === "organization" && log.entityId === organizationId) {
			return true;
		}
		// Employee-related
		if (log.entityType === "employee" && employeeIds.has(log.entityId)) {
			return true;
		}
		// Team-related
		if (log.entityType === "team" && teamIds.has(log.entityId)) {
			return true;
		}
		// Performed by users in this org
		if (log.performedBy && userIds.has(log.performedBy)) {
			return true;
		}
		return false;
	});

	logger.info({ count: filteredLogs.length }, "Fetched audit logs");

	return filteredLogs.map((log) => ({
		id: log.id,
		entityType: log.entityType,
		entityId: log.entityId,
		action: log.action,
		performedBy: log.performedBy,
		changes: log.changes, // JSON string
		metadata: log.metadata, // JSON string
		timestamp: log.timestamp,
	}));
}

/**
 * Fetch data for specified categories
 * Uses Promise.all for parallel fetching to eliminate waterfalls
 */
export async function fetchExportData(
	organizationId: string,
	categories: ExportCategory[],
): Promise<Record<string, unknown>> {
	logger.info({ organizationId, categories }, "Fetching export data");

	// Map categories to their fetch functions
	const categoryFetchers: Record<ExportCategory, () => Promise<unknown>> = {
		employees: () => fetchEmployees(organizationId),
		teams: () => fetchTeams(organizationId),
		time_entries: () => fetchTimeEntries(organizationId),
		work_periods: () => fetchWorkPeriods(organizationId),
		absences: () => fetchAbsences(organizationId),
		holidays: () => fetchHolidays(organizationId),
		vacation: () => fetchVacation(organizationId),
		schedules: () => fetchSchedules(organizationId),
		shifts: () => fetchShifts(organizationId),
		audit_logs: () => fetchAuditLogs(organizationId),
	};

	// Fetch all requested categories in parallel
	const fetchPromises = categories.map(async (category) => ({
		category,
		data: await categoryFetchers[category](),
	}));

	const results = await Promise.all(fetchPromises);

	// Build result object from parallel results
	const data: Record<string, unknown> = {};
	for (const { category, data: categoryData } of results) {
		data[category] = categoryData;
	}

	return data;
}

// ============================================================================
// STREAMING GENERATORS FOR LARGE DATASETS
// ============================================================================
// These generator functions fetch data in batches to prevent memory issues
// with large organizations (5,000-7,000 employees)

const BATCH_SIZE = 1000;

/**
 * Stream time entries in batches using a generator
 * Yields batches of time entries to prevent memory exhaustion
 */
export async function* streamTimeEntries(
	organizationId: string,
	employeeIds: string[],
): AsyncGenerator<
	Array<{
		id: string;
		employeeId: string;
		employeeName: string | null;
		employeeNumber: string | null;
		type: string;
		timestamp: Date;
		source: string | null;
		method: string | null;
		notes: string | null;
	}>
> {
	if (employeeIds.length === 0) return;

	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const batch = await db.query.timeEntry.findMany({
			where: inArray(timeEntry.employeeId, employeeIds),
			with: {
				employee: {
					columns: {
						id: true,
						firstName: true,
						lastName: true,
						employeeNumber: true,
					},
				},
			},
			limit: BATCH_SIZE,
			offset,
			orderBy: (timeEntry, { desc }) => [desc(timeEntry.timestamp)],
		});

		if (batch.length === 0) {
			hasMore = false;
			break;
		}

		yield batch.map((e) => ({
			id: e.id,
			employeeId: e.employeeId,
			employeeName: e.employee
				? `${e.employee.firstName || ""} ${e.employee.lastName || ""}`.trim()
				: null,
			employeeNumber: e.employee?.employeeNumber || null,
			type: e.type,
			timestamp: e.timestamp,
			source: e.source,
			method: e.method,
			notes: e.notes,
		}));

		offset += BATCH_SIZE;
		hasMore = batch.length === BATCH_SIZE;
	}

	logger.info({ organizationId, totalOffset: offset }, "Streamed time entries");
}

/**
 * Stream work periods in batches using a generator
 * Yields batches of work periods to prevent memory exhaustion
 */
export async function* streamWorkPeriods(
	organizationId: string,
	employeeIds: string[],
): AsyncGenerator<
	Array<{
		id: string;
		employeeId: string;
		employeeName: string | null;
		employeeNumber: string | null;
		startTime: Date;
		endTime: Date | null;
		durationMinutes: number | null;
		breakDurationMinutes: number | null;
		isActive: boolean;
		source: string | null;
	}>
> {
	if (employeeIds.length === 0) return;

	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const batch = await db.query.workPeriod.findMany({
			where: inArray(workPeriod.employeeId, employeeIds),
			with: {
				employee: {
					columns: {
						id: true,
						firstName: true,
						lastName: true,
						employeeNumber: true,
					},
				},
			},
			limit: BATCH_SIZE,
			offset,
			orderBy: (workPeriod, { desc }) => [desc(workPeriod.startTime)],
		});

		if (batch.length === 0) {
			hasMore = false;
			break;
		}

		yield batch.map((p) => ({
			id: p.id,
			employeeId: p.employeeId,
			employeeName: p.employee
				? `${p.employee.firstName || ""} ${p.employee.lastName || ""}`.trim()
				: null,
			employeeNumber: p.employee?.employeeNumber || null,
			startTime: p.startTime,
			endTime: p.endTime,
			durationMinutes: p.durationMinutes,
			breakDurationMinutes: p.breakDurationMinutes,
			isActive: p.isActive,
			source: p.source,
		}));

		offset += BATCH_SIZE;
		hasMore = batch.length === BATCH_SIZE;
	}

	logger.info({ organizationId, totalOffset: offset }, "Streamed work periods");
}

/**
 * Stream audit logs in batches using a generator
 * Yields batches of audit logs to prevent memory exhaustion
 */
export async function* streamAuditLogs(
	organizationId: string,
	employeeIds: Set<string>,
	userIds: Set<string>,
	teamIds: Set<string>,
): AsyncGenerator<
	Array<{
		id: string;
		entityType: string;
		entityId: string;
		action: string;
		performedBy: string | null;
		changes: unknown;
		metadata: unknown;
		timestamp: Date;
	}>
> {
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const batch = await db.query.auditLog.findMany({
			limit: BATCH_SIZE,
			offset,
			orderBy: (auditLog, { desc }) => [desc(auditLog.timestamp)],
		});

		if (batch.length === 0) {
			hasMore = false;
			break;
		}

		// Filter to logs related to this organization's entities
		const filteredBatch = batch.filter((log) => {
			if (log.entityType === "organization" && log.entityId === organizationId) {
				return true;
			}
			if (log.entityType === "employee" && employeeIds.has(log.entityId)) {
				return true;
			}
			if (log.entityType === "team" && teamIds.has(log.entityId)) {
				return true;
			}
			if (log.performedBy && userIds.has(log.performedBy)) {
				return true;
			}
			return false;
		});

		if (filteredBatch.length > 0) {
			yield filteredBatch.map((log) => ({
				id: log.id,
				entityType: log.entityType,
				entityId: log.entityId,
				action: log.action,
				performedBy: log.performedBy,
				changes: log.changes,
				metadata: log.metadata,
				timestamp: log.timestamp,
			}));
		}

		offset += BATCH_SIZE;
		hasMore = batch.length === BATCH_SIZE;
	}

	logger.info({ organizationId, totalOffset: offset }, "Streamed audit logs");
}

/**
 * Helper to collect all items from a generator into an array
 * Use this when you need all data at once (small-medium datasets)
 */
export async function collectGenerator<T>(generator: AsyncGenerator<T[]>): Promise<T[]> {
	const results: T[] = [];
	for await (const batch of generator) {
		results.push(...batch);
	}
	return results;
}

/**
 * Get employee IDs for an organization (helper for streaming functions)
 */
export async function getOrganizationEmployeeIds(organizationId: string): Promise<string[]> {
	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		columns: { id: true },
	});
	return employees.map((e) => e.id);
}
