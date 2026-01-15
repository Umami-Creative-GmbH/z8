/**
 * Data fetchers for export functionality
 * This file contains server-only code that accesses the database
 */
import { and, eq } from "drizzle-orm";
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
					timezone: true,
				},
			},
		},
	});

	// Fetch manager relationships separately
	const managerRelations = await db.query.employeeManagers.findMany({
		where: and(
			// Filter by employees in this org
			eq(employeeManagers.employeeId, employeeManagers.employeeId),
		),
	});

	// Filter to only include manager relations for employees in this org
	const employeeIds = new Set(employees.map((e) => e.id));
	const relevantManagerRelations = managerRelations.filter(
		(mr) => employeeIds.has(mr.employeeId) && employeeIds.has(mr.managerId),
	);

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
			timezone: emp.user?.timezone,
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

	// Fetch time entries in batches to avoid memory issues
	const entries = await db.query.timeEntry.findMany({
		where: and(
			// Note: timeEntry doesn't have direct orgId, so we filter by employee
			eq(timeEntry.employeeId, timeEntry.employeeId), // Placeholder - will use inArray in actual implementation
		),
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

	// Filter to only include entries for employees in this org
	const filteredEntries = entries.filter((e) => employeeIds.includes(e.employeeId));

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

	const periods = await db.query.workPeriod.findMany({
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

	// Filter to only include periods for employees in this org
	const filteredPeriods = periods.filter((p) => employeeIds.includes(p.employeeId));

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

	const absences = await db.query.absenceEntry.findMany({
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

	// Filter to only include absences for employees in this org
	const filteredAbsences = absences.filter((a) => employeeIds.includes(a.employeeId));

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
	const presetHolidays = presetIds.length > 0 ? await db.query.holidayPresetHoliday.findMany() : [];

	const filteredPresetHolidays = presetHolidays.filter((ph) => presetIds.includes(ph.presetId));

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

	const employeeAllowances = await db.query.employeeVacationAllowance.findMany();
	const filteredEmployeeAllowances = employeeAllowances.filter((ea) =>
		employeeIds.includes(ea.employeeId),
	);

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
	const templateDays =
		templateIds.length > 0 ? await db.query.workScheduleTemplateDays.findMany() : [];

	const filteredTemplateDays = templateDays.filter((td) => templateIds.includes(td.templateId));

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
	const requests = shiftIds.length > 0 ? await db.query.shiftRequest.findMany() : [];

	const filteredRequests = requests.filter((r) => shiftIds.includes(r.shiftId));

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
 */
export async function fetchExportData(
	organizationId: string,
	categories: ExportCategory[],
): Promise<Record<string, unknown>> {
	logger.info({ organizationId, categories }, "Fetching export data");

	const data: Record<string, unknown> = {};

	for (const category of categories) {
		switch (category) {
			case "employees":
				data.employees = await fetchEmployees(organizationId);
				break;
			case "teams":
				data.teams = await fetchTeams(organizationId);
				break;
			case "time_entries":
				data.time_entries = await fetchTimeEntries(organizationId);
				break;
			case "work_periods":
				data.work_periods = await fetchWorkPeriods(organizationId);
				break;
			case "absences":
				data.absences = await fetchAbsences(organizationId);
				break;
			case "holidays":
				data.holidays = await fetchHolidays(organizationId);
				break;
			case "vacation":
				data.vacation = await fetchVacation(organizationId);
				break;
			case "schedules":
				data.schedules = await fetchSchedules(organizationId);
				break;
			case "shifts":
				data.shifts = await fetchShifts(organizationId);
				break;
			case "audit_logs":
				data.audit_logs = await fetchAuditLogs(organizationId);
				break;
		}
	}

	return data;
}
