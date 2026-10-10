/**
 * Data fetchers for export functionality
 * This file contains server-only code that accesses the database
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
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
	project,
	shift,
	shiftRequest,
	shiftTemplate,
	team,
	teamPermissions,
	timeEntry,
	vacationAllowance,
	vacationPolicyAssignment,
	workPeriod,
	workPolicy,
	workPolicyAssignment,
	workPolicyBreakOption,
	workPolicyBreakRule,
	workPolicyRegulation,
	workPolicySchedule,
	workPolicyScheduleDay,
} from "@/db";
import { customer, projectTask } from "@/db/schema";
import { env } from "@/env";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { type PlainDate, systemClock } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	type CustomFieldReportColumn,
	readCustomFieldReportValues,
} from "@/lib/organization/custom-fields/report-reads";
import {
	type CustomFieldReportValue,
	customFieldReportText,
} from "@/lib/organization/custom-fields/report-values";
import { type CustomFieldViewer, customFieldsToday } from "@/lib/organization/custom-fields/values";
import { attachExportPositionStamps } from "@/lib/time-tracking/position-capture/export-positions";
import type { CsvTable } from "./formatters/csv-formatter";

// Import types for internal use
import type { ExportCategory } from "./types";

/**
 * Who the export is for. The time entries carry position stamps only when this
 * requester may view everyone's stamps, decided while the export is processed.
 */
export type ExportRequester = {
	exportId: string;
	/** `data_export.requested_by_id`: the requester's employee profile (a schedule's owner for scheduled exports). */
	requestedByEmployeeId: string;
	/** The addresses a scheduled export's download link is mailed to; each must be a permitted viewer too. */
	recipientEmails?: readonly string[];
};

// Re-export types for backward compatibility with server-side code
export { CATEGORY_LABELS, EXPORT_CATEGORIES, type ExportCategory } from "./types";

const logger = createLogger("ExportDataFetchers");

/**
 * How the export sees custom fields (#820): through the requester's base role
 * as it is now (for a scheduled export, its creator's role when the run
 * starts), with values as of today in the organization's business zone. A
 * requester whose employee record can't be found sees no custom fields.
 * Resolved once per requester and organization: the categories of one export
 * share it.
 */
function exportCustomFieldView(
	organizationId: string,
	requester: ExportRequester,
): Promise<CustomFieldView> {
	const byOrganization =
		customFieldViews.get(requester) ?? new Map<string, Promise<CustomFieldView>>();
	customFieldViews.set(requester, byOrganization);
	const cached = byOrganization.get(organizationId);
	if (cached) return cached;
	const view = readCustomFieldView(organizationId, requester);
	byOrganization.set(organizationId, view);
	return view;
}

type CustomFieldView = { viewer: CustomFieldViewer; asOf: PlainDate };

const customFieldViews = new WeakMap<ExportRequester, Map<string, Promise<CustomFieldView>>>();

async function readCustomFieldView(
	organizationId: string,
	requester: ExportRequester,
): Promise<CustomFieldView> {
	const [requesterEmployee, asOf] = await Promise.all([
		db.query.employee.findFirst({
			where: and(
				eq(employee.id, requester.requestedByEmployeeId),
				eq(employee.organizationId, organizationId),
			),
			columns: { userId: true },
		}),
		customFieldsToday(db, organizationId),
	]);
	return {
		viewer: requesterEmployee
			? { kind: "actor", userId: requesterEmployee.userId }
			: { kind: "level", level: null },
		asOf,
	};
}

/** Custom field values as export cells: booleans as true/false, no value as empty. */
function customFieldCells(values: readonly CustomFieldReportValue[]) {
	return Object.fromEntries(
		values.map((value) => [
			customFieldColumnKey(value.fieldId),
			customFieldReportText(value, { yes: "true", no: "false" }),
		]),
	);
}

const customFieldColumnKey = (fieldId: string) => `customField:${fieldId}`;

/** One JSON property per column, in column order: `customField:<name>` -> value or null. */
function customFieldProperties(
	columns: readonly CustomFieldReportColumn[],
	values: readonly CustomFieldReportValue[],
) {
	const valueByField = new Map(values.map((value) => [value.fieldId, value.value]));
	return Object.fromEntries(
		columns.map((column) => [
			`customField:${column.name}`,
			valueByField.get(column.fieldId) ?? null,
		]),
	);
}

/**
 * Fetch all employees for an organization
 * Format: JSON (structured data with relations). After its built-in
 * properties, each row carries one property per active employee custom field
 * the requester sees (#820), in the fields' defined order, keyed
 * `customField:<field name>` (null without a value). The prefix keeps the keys
 * apart from the built-in ones and never integer-like, so JSON keeps them in
 * field order.
 */
export async function fetchEmployees(organizationId: string, requester: ExportRequester) {
	logger.info({ organizationId }, "Fetching employees for export");

	const employees = await db.query.employee.findMany({
		where: eq(employee.organizationId, organizationId),
		with: {
			team: true,
			user: {
				columns: {
					id: true,
					firstName: true,
					lastName: true,
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

	const { viewer, asOf } = await exportCustomFieldView(organizationId, requester);
	const customFields = await readCustomFieldReportValues(db, {
		organizationId,
		entity: "employee",
		recordIds: employeeIds,
		asOf,
		viewer,
	});

	logger.info({ count: employees.length }, "Fetched employees");

	return {
		employees: employees.map((emp) => ({
			id: emp.id,
			firstName: emp.user?.firstName ?? null,
			lastName: emp.user?.lastName ?? null,
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
			...customFieldProperties(customFields.columns, customFields.byRecord[emp.id] ?? []),
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

	const [teams, permissions] = await Promise.all([
		db.query.team.findMany({
			where: eq(team.organizationId, organizationId),
		}),
		db.query.teamPermissions.findMany({
			where: eq(teamPermissions.organizationId, organizationId),
		}),
	]);

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
 * Fetch all projects of an organization (#820)
 * Format: CSV table. Built-in columns, then one column per active project
 * custom field the requester sees, labelled with the field name, in order.
 */
export async function fetchProjects(
	organizationId: string,
	requester: ExportRequester,
): Promise<CsvTable> {
	logger.info({ organizationId }, "Fetching projects for export");

	const rows = await db
		.select({ project, customerName: customer.name })
		.from(project)
		.leftJoin(
			customer,
			and(eq(customer.id, project.customerId), eq(customer.organizationId, organizationId)),
		)
		.where(eq(project.organizationId, organizationId))
		.orderBy(asc(project.name));
	const { viewer, asOf } = await exportCustomFieldView(organizationId, requester);
	const customFields = await readCustomFieldReportValues(db, {
		organizationId,
		entity: "project",
		recordIds: rows.map((row) => row.project.id),
		asOf,
		viewer,
	});

	logger.info({ count: rows.length }, "Fetched projects");

	return {
		format: "csv-table",
		columns: [
			...[
				"id",
				"name",
				"description",
				"status",
				"customerId",
				"customerName",
				"budgetHours",
				"deadline",
				"isActive",
				"createdAt",
			].map((key) => ({ key, header: key })),
			...customFieldColumns(customFields.columns),
		],
		rows: rows.map(({ project: p, customerName }) => ({
			id: p.id,
			name: p.name,
			description: p.description,
			status: p.status,
			customerId: customerName === null ? null : p.customerId,
			customerName,
			budgetHours: p.budgetHours === null ? null : Number(p.budgetHours),
			deadline: p.deadline,
			isActive: p.isActive,
			createdAt: p.createdAt,
			...customFieldCells(customFields.byRecord[p.id] ?? []),
		})),
	};
}

/**
 * Fetch all customers of an organization (#820)
 * Format: CSV table. Built-in columns, then one column per active customer
 * custom field the requester sees, labelled with the field name, in order.
 */
export async function fetchCustomers(
	organizationId: string,
	requester: ExportRequester,
): Promise<CsvTable> {
	logger.info({ organizationId }, "Fetching customers for export");

	const customers = await db
		.select()
		.from(customer)
		.where(eq(customer.organizationId, organizationId))
		.orderBy(asc(customer.name));
	const { viewer, asOf } = await exportCustomFieldView(organizationId, requester);
	const customFields = await readCustomFieldReportValues(db, {
		organizationId,
		entity: "customer",
		recordIds: customers.map((row) => row.id),
		asOf,
		viewer,
	});

	logger.info({ count: customers.length }, "Fetched customers");

	return {
		format: "csv-table",
		columns: [
			...[
				"id",
				"name",
				"address",
				"vatId",
				"email",
				"contactPerson",
				"phone",
				"website",
				"isActive",
				"createdAt",
			].map((key) => ({ key, header: key })),
			...customFieldColumns(customFields.columns),
		],
		rows: customers.map((c) => ({
			id: c.id,
			name: c.name,
			address: c.address,
			vatId: c.vatId,
			email: c.email,
			contactPerson: c.contactPerson,
			phone: c.phone,
			website: c.website,
			isActive: c.isActive,
			createdAt: c.createdAt,
			...customFieldCells(customFields.byRecord[c.id] ?? []),
		})),
	};
}

function customFieldColumns(columns: readonly CustomFieldReportColumn[]) {
	return columns.map((column) => ({
		key: customFieldColumnKey(column.fieldId),
		header: column.name,
	}));
}

/**
 * Fetch all time entries for an organization
 * Format: CSV (large volume, tabular)
 */
export async function fetchTimeEntries(organizationId: string, requester: ExportRequester) {
	logger.info({ organizationId }, "Fetching time entries for export");

	// Fetch time entries directly by organizationId
	const filteredEntries = await db.query.timeEntry.findMany({
		where: eq(timeEntry.organizationId, organizationId),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
				},
				with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
			},
		},
	});

	logger.info({ count: filteredEntries.length }, "Fetched time entries");

	const rows = filteredEntries.map((entry) => ({
		id: entry.id,
		employeeId: entry.employeeId,
		employeeName: entry.employee?.user ? buildAuthUserDisplayName(entry.employee.user) : "",
		employeeNumber: entry.employee?.employeeNumber,
		type: entry.type,
		timestamp: entry.timestamp,
		notes: entry.notes,
		deviceInfo: entry.deviceInfo,
		replacesEntryId: entry.replacesEntryId,
		isSuperseded: entry.isSuperseded,
		createdAt: entry.createdAt,
	}));

	// Position stamps replace the legacy, always-empty location column (#835).
	const positions = await attachExportPositionStamps(db, {
		organizationId,
		exportId: requester.exportId,
		requestedByEmployeeId: requester.requestedByEmployeeId,
		recipientEmails: requester.recipientEmails,
		now: systemClock.nowInstant(),
		rows,
	});
	logger.info({ positionsIncluded: positions.included }, "Resolved time entry positions");
	return positions.rows;
}

/**
 * Fetch all work periods for an organization
 * Format: CSV (large volume, tabular)
 */
export async function fetchWorkPeriods(organizationId: string) {
	logger.info({ organizationId }, "Fetching work periods for export");

	// Fetch work periods directly by organizationId, with the organization's
	// project and task names for the project and task columns. Work deleted by an
	// approved correction is no longer work (#794); running periods stay, flagged by isActive.
	const [filteredPeriods, projectNames, taskNames] = await Promise.all([
		db.query.workPeriod.findMany({
			where: and(eq(workPeriod.organizationId, organizationId), isNull(workPeriod.deletedAt)),
			with: {
				employee: {
					columns: {
						id: true,
						employeeNumber: true,
					},
					with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
				},
			},
		}),
		db
			.select({ id: project.id, name: project.name })
			.from(project)
			.where(eq(project.organizationId, organizationId))
			.then((rows) => new Map(rows.map((row) => [row.id, row.name]))),
		db
			.select({ id: projectTask.id, name: projectTask.name })
			.from(projectTask)
			.where(eq(projectTask.organizationId, organizationId))
			.then((rows) => new Map(rows.map((row) => [row.id, row.name]))),
	]);

	logger.info({ count: filteredPeriods.length }, "Fetched work periods");

	return filteredPeriods.map((period) => ({
		id: period.id,
		employeeId: period.employeeId,
		employeeName: period.employee?.user ? buildAuthUserDisplayName(period.employee.user) : "",
		employeeNumber: period.employee?.employeeNumber,
		startTime: period.startTime,
		endTime: period.endTime,
		durationMinutes: period.durationMinutes,
		isActive: period.isActive,
		clockInId: period.clockInId,
		clockOutId: period.clockOutId,
		createdAt: period.createdAt,
		projectId: period.projectId,
		projectName: period.projectId ? (projectNames.get(period.projectId) ?? null) : null,
		taskId: period.taskId,
		taskName: period.taskId ? (taskNames.get(period.taskId) ?? null) : null,
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
		where: and(
			eq(absenceEntry.organizationId, organizationId),
			inArray(absenceEntry.employeeId, employeeIds),
		),
		with: {
			employee: {
				columns: {
					id: true,
					employeeNumber: true,
				},
				with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
			},
			category: true,
			// The deputy (#1012): an employee of the same organization, by the composite relation.
			deputy: {
				columns: { id: true },
				with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
			},
		},
	});

	logger.info({ count: filteredAbsences.length }, "Fetched absences");

	return {
		absences: filteredAbsences.map((absence) => ({
			id: absence.id,
			employeeId: absence.employeeId,
			employeeName: absence.employee?.user ? buildAuthUserDisplayName(absence.employee.user) : "",
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
			deputyEmployeeId: absence.deputy?.id ?? null,
			deputyName: absence.deputy?.user ? buildAuthUserDisplayName(absence.deputy.user) : null,
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

	const [categories, holidays, presets, presetAssignments, holidayAssignments] = await Promise.all([
		db.query.holidayCategory.findMany({
			where: eq(holidayCategory.organizationId, organizationId),
		}),
		db.query.holiday.findMany({
			where: eq(holiday.organizationId, organizationId),
		}),
		db.query.holidayPreset.findMany({
			where: eq(holidayPreset.organizationId, organizationId),
		}),
		db.query.holidayPresetAssignment.findMany({
			where: eq(holidayPresetAssignment.organizationId, organizationId),
		}),
		db.query.holidayAssignment.findMany({
			where: eq(holidayAssignment.organizationId, organizationId),
		}),
	]);

	const presetIds = presets.map((p) => p.id);
	const filteredPresetHolidays =
		presetIds.length > 0
			? await db.query.holidayPresetHoliday.findMany({
					where: inArray(holidayPresetHoliday.presetId, presetIds),
				})
			: [];

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

	const [allowances, orgEmployees, policyAssignments] = await Promise.all([
		db.query.vacationAllowance.findMany({
			where: eq(vacationAllowance.organizationId, organizationId),
		}),
		db.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { id: true },
		}),
		db.query.vacationPolicyAssignment.findMany({
			where: eq(vacationPolicyAssignment.organizationId, organizationId),
		}),
	]);
	const employeeIds = orgEmployees.map((e) => e.id);

	const filteredEmployeeAllowances =
		employeeIds.length > 0
			? await db.query.employeeVacationAllowance.findMany({
					where: inArray(employeeVacationAllowance.employeeId, employeeIds),
				})
			: [];

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
 * Fetch all work policies for an organization
 * Format: JSON (complex nested structure)
 */
export async function fetchSchedules(organizationId: string) {
	logger.info({ organizationId }, "Fetching work policies for export");

	const policies = await db.query.workPolicy.findMany({
		where: eq(workPolicy.organizationId, organizationId),
	});

	const policyIds = policies.map((p) => p.id);

	const schedules =
		policyIds.length > 0
			? await db.query.workPolicySchedule.findMany({
					where: inArray(workPolicySchedule.policyId, policyIds),
				})
			: [];

	const scheduleIds = schedules.map((s) => s.id);
	const scheduleDays =
		scheduleIds.length > 0
			? await db.query.workPolicyScheduleDay.findMany({
					where: inArray(workPolicyScheduleDay.scheduleId, scheduleIds),
				})
			: [];

	const regulations =
		policyIds.length > 0
			? await db.query.workPolicyRegulation.findMany({
					where: inArray(workPolicyRegulation.policyId, policyIds),
				})
			: [];

	const regulationIds = regulations.map((r) => r.id);
	const breakRules =
		regulationIds.length > 0
			? await db.query.workPolicyBreakRule.findMany({
					where: inArray(workPolicyBreakRule.regulationId, regulationIds),
				})
			: [];

	const breakRuleIds = breakRules.map((r) => r.id);
	const breakOptions =
		breakRuleIds.length > 0
			? await db.query.workPolicyBreakOption.findMany({
					where: inArray(workPolicyBreakOption.breakRuleId, breakRuleIds),
				})
			: [];

	const assignments = await db.query.workPolicyAssignment.findMany({
		where: eq(workPolicyAssignment.organizationId, organizationId),
	});

	logger.info(
		{ policiesCount: policies.length, assignmentsCount: assignments.length },
		"Fetched work policies",
	);

	return {
		policies: policies.map((p) => ({
			id: p.id,
			name: p.name,
			description: p.description,
			scheduleEnabled: p.scheduleEnabled,
			regulationEnabled: p.regulationEnabled,
			isDefault: p.isDefault,
			isActive: p.isActive,
		})),
		schedules: schedules.map((s) => ({
			policyId: s.policyId,
			scheduleCycle: s.scheduleCycle,
			scheduleType: s.scheduleType,
			hoursPerCycle: s.hoursPerCycle,
			homeOfficeDaysPerCycle: s.homeOfficeDaysPerCycle,
			workingDaysPreset: s.workingDaysPreset,
		})),
		scheduleDays: scheduleDays.map((sd) => ({
			scheduleId: sd.scheduleId,
			dayOfWeek: sd.dayOfWeek,
			hoursPerDay: sd.hoursPerDay,
			isWorkDay: sd.isWorkDay,
			cycleWeek: sd.cycleWeek,
			latestClockIn: sd.latestClockIn,
		})),
		regulations: regulations.map((r) => ({
			policyId: r.policyId,
			maxDailyMinutes: r.maxDailyMinutes,
			maxWeeklyMinutes: r.maxWeeklyMinutes,
			maxUninterruptedMinutes: r.maxUninterruptedMinutes,
		})),
		breakRules: breakRules.map((br) => ({
			regulationId: br.regulationId,
			workingMinutesThreshold: br.workingMinutesThreshold,
			requiredBreakMinutes: br.requiredBreakMinutes,
		})),
		breakOptions: breakOptions.map((bo) => ({
			breakRuleId: bo.breakRuleId,
			splitCount: bo.splitCount,
			minimumSplitMinutes: bo.minimumSplitMinutes,
			minimumLongestSplitMinutes: bo.minimumLongestSplitMinutes,
		})),
		assignments: assignments.map((a) => ({
			policyId: a.policyId,
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

	const [templates, shifts] = await Promise.all([
		db.query.shiftTemplate.findMany({
			where: eq(shiftTemplate.organizationId, organizationId),
		}),
		db.query.shift.findMany({
			where: eq(shift.organizationId, organizationId),
			with: {
				employee: {
					columns: {
						id: true,
						employeeNumber: true,
					},
					with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
				},
				template: true,
			},
		}),
	]);

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
			employeeName: s.employee?.user ? buildAuthUserDisplayName(s.employee.user) : null,
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
	const [orgEmployees, orgTeams] = await Promise.all([
		db.query.employee.findMany({
			where: eq(employee.organizationId, organizationId),
			columns: { id: true, userId: true },
		}),
		db.query.team.findMany({
			where: eq(team.organizationId, organizationId),
			columns: { id: true },
		}),
	]);

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
	requester: ExportRequester,
): Promise<Record<string, unknown>> {
	logger.info({ organizationId, categories }, "Fetching export data");

	// Map categories to their fetch functions
	const categoryFetchers: Record<ExportCategory, () => Promise<unknown>> = {
		employees: () => fetchEmployees(organizationId, requester),
		teams: () => fetchTeams(organizationId),
		time_entries: () => fetchTimeEntries(organizationId, requester),
		work_periods: () => fetchWorkPeriods(organizationId),
		absences: () => fetchAbsences(organizationId),
		holidays: () => fetchHolidays(organizationId),
		vacation: () => fetchVacation(organizationId),
		schedules: () => fetchSchedules(organizationId),
		shifts: () => fetchShifts(organizationId),
		audit_logs: () => fetchAuditLogs(organizationId),
		projects: () => fetchProjects(organizationId, requester),
		customers: () => fetchCustomers(organizationId, requester),
	};

	// Fetch all requested categories in parallel
	const fetchPromises = categories.map((category) =>
		categoryFetchers[category]().then((data) => ({ category, data })),
	);

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

const BATCH_SIZE = Number(env.EXPORT_FETCH_BATCH_SIZE);

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
		notes: string | null;
	}>
> {
	let offset = 0;
	let hasMore = true;

	// Build where clause - use organizationId directly, optionally filter by employeeIds
	const whereClause =
		employeeIds.length > 0
			? and(
					eq(timeEntry.organizationId, organizationId),
					inArray(timeEntry.employeeId, employeeIds),
				)
			: eq(timeEntry.organizationId, organizationId);

	while (hasMore) {
		const batch = await db.query.timeEntry.findMany({
			where: whereClause,
			with: {
				employee: {
					columns: {
						id: true,
						employeeNumber: true,
					},
					with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
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
			employeeName: e.employee?.user ? buildAuthUserDisplayName(e.employee.user) : null,
			employeeNumber: e.employee?.employeeNumber || null,
			type: e.type,
			timestamp: e.timestamp,
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
		isActive: boolean;
	}>
> {
	let offset = 0;
	let hasMore = true;

	// Build where clause - use organizationId directly, optionally filter by employeeIds.
	// Work deleted by an approved correction is no longer work (#794).
	const whereClause =
		employeeIds.length > 0
			? and(
					eq(workPeriod.organizationId, organizationId),
					isNull(workPeriod.deletedAt),
					inArray(workPeriod.employeeId, employeeIds),
				)
			: and(eq(workPeriod.organizationId, organizationId), isNull(workPeriod.deletedAt));

	while (hasMore) {
		const batch = await db.query.workPeriod.findMany({
			where: whereClause,
			with: {
				employee: {
					columns: {
						id: true,
						employeeNumber: true,
					},
					with: { user: { columns: { firstName: true, lastName: true, name: true, email: true } } },
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
			employeeName: p.employee?.user ? buildAuthUserDisplayName(p.employee.user) : null,
			employeeNumber: p.employee?.employeeNumber || null,
			startTime: p.startTime,
			endTime: p.endTime,
			durationMinutes: p.durationMinutes,
			isActive: p.isActive,
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
