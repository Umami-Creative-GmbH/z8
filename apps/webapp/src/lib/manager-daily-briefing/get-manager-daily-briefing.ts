import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import type { AnyAppError } from "@/lib/effect/errors";
import {
	buildSummaryCounts,
	detectAbsencesToday,
	detectAttendanceExceptions,
	detectCoverageRisks,
	sortActionItems,
} from "./logic";
import type {
	BriefingAbsence,
	BriefingActionItem,
	BriefingApproval,
	BriefingApprovalActionItem,
	BriefingCoverageRule,
	BriefingSection,
	BriefingShift,
	BriefingTimeRecord,
	ManagerDailyBriefing,
} from "./types";
import { approvalToBriefingItem } from "./types";

type CurrentEmployee = {
	id: string;
	role: "admin" | "manager" | "employee" | string;
	organizationId?: string | null;
};

type ScopedEmployee = {
	id: string;
	name: string;
	teamName: string | null;
};

type SourceScope = {
	organizationId: string;
	employeeIds: string[];
};

type DateSourceScope = SourceScope & {
	date: string;
};

type TimeRecordSourceScope = SourceScope & {
	from: Date;
	to: Date;
};

export type ManagerDailyBriefingSources = {
	getScopedEmployees(input: { organizationId: string; currentEmployeeId: string; role: string }): Promise<ScopedEmployee[]>;
	getPublishedShifts(input: DateSourceScope): Promise<BriefingShift[]>;
	getOpenTimeRecords(input: TimeRecordSourceScope): Promise<BriefingTimeRecord[]>;
	getApprovedAbsences(input: DateSourceScope): Promise<BriefingAbsence[]>;
	getCoverageRules(input: { organizationId: string }): Promise<BriefingCoverageRule[]>;
	getApprovals(input: { organizationId: string; currentEmployeeId: string }): Promise<BriefingApproval[]>;
	getOvertimeWarnings(input: SourceScope): Promise<BriefingActionItem[]>;
	getPayrollIssues(input: SourceScope): Promise<BriefingActionItem[]>;
};

type GetManagerDailyBriefingFromSourcesInput = {
	organizationId: string;
	currentEmployee: CurrentEmployee;
	now: DateTime;
	sources: ManagerDailyBriefingSources;
};

type GetManagerDailyBriefingInput = {
	currentEmployee: CurrentEmployee & { organizationId: string };
	now?: DateTime;
};

const SECTION_METADATA = {
	approvals: {
		id: "approvals",
		title: "Approvals",
		description: "Pending requests waiting for a decision.",
		emptyState: "No approvals are waiting.",
	},
	attendance: {
		id: "attendance",
		title: "Attendance",
		description: "Clock-in exceptions for today's published shifts.",
		emptyState: "No attendance exceptions detected.",
	},
	absences: {
		id: "absences",
		title: "Absences",
		description: "Approved absences overlapping today.",
		emptyState: "No approved absences today.",
	},
	coverage: {
		id: "coverage",
		title: "Coverage",
		description: "Coverage risks for today's schedule.",
		emptyState: "No coverage risks detected.",
	},
	overtime: {
		id: "overtime",
		title: "Overtime",
		description: "Employees approaching overtime thresholds.",
		emptyState: "No overtime warnings detected.",
	},
	payroll: {
		id: "payroll",
		title: "Payroll",
		description: "Payroll readiness issues that may need setup.",
		emptyState: "No payroll setup issues detected.",
	},
} as const;

export async function getManagerDailyBriefingFromSources({
	organizationId,
	currentEmployee,
	now,
	sources,
}: GetManagerDailyBriefingFromSourcesInput): Promise<ManagerDailyBriefing> {
	const date = now.toISODate() ?? "";
	const scopedEmployees = await sources.getScopedEmployees({
		organizationId,
		currentEmployeeId: currentEmployee.id,
		role: currentEmployee.role,
	});
	const employeeIds = scopedEmployees.map((employee) => employee.id);
	const sourceScope = { organizationId, employeeIds };
	const timeRecordWindow = {
		from: now.startOf("day").minus({ hours: 2 }).toJSDate(),
		to: now.endOf("day").plus({ days: 1 }).toJSDate(),
	};

	const [shiftsResult, timeRecordsResult, absencesResult, coverageRulesResult, approvalsResult, overtimeResult, payrollResult] = await Promise.allSettled([
		sources.getPublishedShifts({ ...sourceScope, date }),
		sources.getOpenTimeRecords({ ...sourceScope, ...timeRecordWindow }),
		sources.getApprovedAbsences({ ...sourceScope, date }),
		sources.getCoverageRules({ organizationId }),
		sources.getApprovals({ organizationId, currentEmployeeId: currentEmployee.id }),
		sources.getOvertimeWarnings(sourceScope),
		sources.getPayrollIssues(sourceScope),
	]);

	const shifts = settledValue(shiftsResult, []);
	const timeRecords = settledValue(timeRecordsResult, []);
	const absences = settledValue(absencesResult, []);
	const coverageRules = settledValue(coverageRulesResult, []);
	const approvalItems = settledValue(approvalsResult, []).map(approvalToBriefingItem);
	const overtimeItems = settledValue(overtimeResult, []);
	const payrollItems = settledValue(payrollResult, []);

	const attendanceItems = shiftsResult.status === "fulfilled" && timeRecordsResult.status === "fulfilled"
		? detectAttendanceExceptions({ now, shifts, records: timeRecords, graceMinutes: 5 })
		: [];
	const absenceItems = absencesResult.status === "fulfilled"
		? detectAbsencesToday({ today: now, absences })
		: [];
	const coverageItems = coverageRulesResult.status === "fulfilled" && shiftsResult.status === "fulfilled"
		? detectCoverageRisks({ dayOfWeek: now.toFormat("cccc").toLowerCase(), coverageRules, publishedShifts: shifts })
		: [];

	const approvals = buildSection<BriefingApprovalActionItem>("approvals", sortActionItems(approvalItems) as BriefingApprovalActionItem[], approvalsResult);
	const attendance = buildSection("attendance", attendanceItems, firstRejected(shiftsResult, timeRecordsResult));
	const sections = {
		approvals,
		attendance,
		absences: buildSection("absences", absenceItems, absencesResult),
		coverage: buildSection("coverage", coverageItems, firstRejected(coverageRulesResult, shiftsResult)),
		overtime: buildSection("overtime", sortActionItems(overtimeItems), overtimeResult),
		payroll: buildSection("payroll", sortActionItems(payrollItems), payrollResult),
	};
	const sectionItems = {
		needsAction: sortActionItems([
			...sections.approvals.items,
			...sections.attendance.items,
			...sections.absences.items,
			...sections.coverage.items,
			...sections.overtime.items,
			...sections.payroll.items,
		]),
		approvals: sections.approvals.items,
		attendance: sections.attendance.items,
		absences: sections.absences.items,
		coverage: sections.coverage.items,
		overtime: sections.overtime.items,
		payroll: sections.payroll.items,
	};

	return {
		generatedAt: now.toISO() ?? now.toUTC().toISO() ?? "",
		date,
		summary: buildSummaryCounts(sectionItems),
		needsAction: sectionItems.needsAction,
		sections,
	};
}

export async function getManagerDailyBriefing({ currentEmployee, now = DateTime.now() }: GetManagerDailyBriefingInput): Promise<ManagerDailyBriefing> {
	return getManagerDailyBriefingFromSources({
		organizationId: currentEmployee.organizationId,
		currentEmployee,
		now,
		sources: databaseSources,
	});
}

const databaseSources: ManagerDailyBriefingSources = {
	async getScopedEmployees({ organizationId, currentEmployeeId, role }) {
		const { db, employee, employeeManagers, team, user } = await import("@/db");

		if (role === "admin") {
			const rows = await db
				.select({ id: employee.id, firstName: employee.firstName, lastName: employee.lastName, userName: user.name, teamName: team.name })
				.from(employee)
				.leftJoin(user, eq(employee.userId, user.id))
				.leftJoin(team, eq(employee.teamId, team.id))
				.where(and(eq(employee.organizationId, organizationId), eq(employee.isActive, true)));

			return rows.map((row) => ({ id: row.id, name: employeeDisplayName(row), teamName: row.teamName }));
		}

		if (role === "manager") {
			const rows = await db
				.select({ id: employee.id, firstName: employee.firstName, lastName: employee.lastName, userName: user.name, teamName: team.name })
				.from(employeeManagers)
				.innerJoin(employee, eq(employeeManagers.employeeId, employee.id))
				.leftJoin(user, eq(employee.userId, user.id))
				.leftJoin(team, eq(employee.teamId, team.id))
				.where(and(
					eq(employeeManagers.managerId, currentEmployeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				));

			return rows.map((row) => ({ id: row.id, name: employeeDisplayName(row), teamName: row.teamName }));
		}

		const rows = await db
			.select({ id: employee.id, firstName: employee.firstName, lastName: employee.lastName, userName: user.name, teamName: team.name })
			.from(employee)
			.leftJoin(user, eq(employee.userId, user.id))
			.leftJoin(team, eq(employee.teamId, team.id))
			.where(and(eq(employee.id, currentEmployeeId), eq(employee.organizationId, organizationId), eq(employee.isActive, true)));

		return rows.map((row) => ({ id: row.id, name: employeeDisplayName(row), teamName: row.teamName }));
	},

	async getPublishedShifts({ organizationId, employeeIds, date }) {
		const { db, employee, shift, team, user } = await import("@/db");
		const { locationSubarea } = await import("@/db/schema");

		if (employeeIds.length === 0) {
			return [];
		}

		const rows = await db
			.select({
				id: shift.id,
				employeeId: shift.employeeId,
				firstName: employee.firstName,
				lastName: employee.lastName,
				userName: user.name,
				teamName: team.name,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
				status: shift.status,
				subareaId: shift.subareaId,
				subareaName: locationSubarea.name,
			})
			.from(shift)
			.innerJoin(employee, eq(shift.employeeId, employee.id))
			.leftJoin(user, eq(employee.userId, user.id))
			.leftJoin(team, eq(employee.teamId, team.id))
			.leftJoin(locationSubarea, eq(shift.subareaId, locationSubarea.id))
			.where(and(
				eq(shift.organizationId, organizationId),
				eq(shift.status, "published"),
				eq(shift.date, DateTime.fromISO(date).toJSDate()),
				inArray(shift.employeeId, employeeIds),
			));

		return rows.flatMap((row): BriefingShift[] => row.employeeId ? [{
			id: row.id,
			employeeId: row.employeeId,
			employeeName: employeeDisplayName(row),
			teamName: row.teamName,
			date: DateTime.fromJSDate(row.date).toISODate() ?? date,
			startTime: row.startTime,
			endTime: row.endTime,
			status: row.status,
			subareaId: row.subareaId,
			subareaName: row.subareaName,
		}] : []);
	},

	async getOpenTimeRecords({ organizationId, employeeIds, from, to }) {
		const { db, workPeriod } = await import("@/db");

		if (employeeIds.length === 0) {
			return [];
		}

		const rows = await db
			.select({ id: workPeriod.id, employeeId: workPeriod.employeeId, startAt: workPeriod.startTime, endAt: workPeriod.endTime })
			.from(workPeriod)
			.where(and(
				eq(workPeriod.organizationId, organizationId),
				inArray(workPeriod.employeeId, employeeIds),
				gte(workPeriod.startTime, from),
				lte(workPeriod.startTime, to),
			));

		return rows.map((row) => ({ id: row.id, employeeId: row.employeeId, startAt: row.startAt, endAt: row.endAt }));
	},

	async getApprovedAbsences({ organizationId, employeeIds, date }) {
		const { absenceCategory, absenceEntry, db, employee, team, user } = await import("@/db");

		if (employeeIds.length === 0) {
			return [];
		}

		const rows = await db
			.select({
				id: absenceEntry.id,
				employeeId: absenceEntry.employeeId,
				firstName: employee.firstName,
				lastName: employee.lastName,
				userName: user.name,
				teamName: team.name,
				categoryName: absenceCategory.name,
				startDate: absenceEntry.startDate,
				endDate: absenceEntry.endDate,
				status: absenceEntry.status,
			})
			.from(absenceEntry)
			.innerJoin(employee, eq(absenceEntry.employeeId, employee.id))
			.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
			.leftJoin(user, eq(employee.userId, user.id))
			.leftJoin(team, eq(employee.teamId, team.id))
			.where(and(
				eq(absenceEntry.organizationId, organizationId),
				inArray(absenceEntry.employeeId, employeeIds),
				eq(absenceEntry.status, "approved"),
				lte(absenceEntry.startDate, date),
				gte(absenceEntry.endDate, date),
			));

		return rows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			employeeName: employeeDisplayName(row),
			teamName: row.teamName,
			categoryName: row.categoryName,
			startDate: row.startDate,
			endDate: row.endDate,
			status: row.status,
		}));
	},

	async getCoverageRules({ organizationId }) {
		const { db } = await import("@/db");
		const { coverageRule, locationSubarea } = await import("@/db/schema");

		const rows = await db
			.select({
				id: coverageRule.id,
				subareaId: coverageRule.subareaId,
				subareaName: locationSubarea.name,
				dayOfWeek: coverageRule.dayOfWeek,
				startTime: coverageRule.startTime,
				endTime: coverageRule.endTime,
				minimumStaffCount: coverageRule.minimumStaffCount,
			})
			.from(coverageRule)
			.innerJoin(locationSubarea, eq(coverageRule.subareaId, locationSubarea.id))
			.where(eq(coverageRule.organizationId, organizationId));

		return rows;
	},

	async getApprovals({ organizationId, currentEmployeeId }) {
		await import("@/lib/approvals/init");
		const { ApprovalQueryService, ApprovalQueryServiceLive } = await import("@/lib/approvals/application/approval-query.service");

		const result = await Effect.runPromise(
			Effect.gen(function* (_) {
				const approvalQueryService = yield* _(ApprovalQueryService);
				return yield* _(approvalQueryService.getApprovals({
					approverId: currentEmployeeId,
					organizationId,
					status: "pending",
					limit: 25,
				}));
			}).pipe(Effect.provide(ApprovalQueryServiceLive)) as Effect.Effect<import("@/lib/approvals/domain/types").PaginatedApprovalResult, AnyAppError, never>,
		);

		return result.items;
	},

	async getOvertimeWarnings() {
		return [];
	},

	async getPayrollIssues({ organizationId }) {
		const { db, payrollExportConfig, payrollWageTypeMapping } = await import("@/db");

		const rows = await db
			.select({ id: payrollWageTypeMapping.id })
			.from(payrollWageTypeMapping)
			.innerJoin(payrollExportConfig, eq(payrollWageTypeMapping.configId, payrollExportConfig.id))
			.where(and(eq(payrollExportConfig.organizationId, organizationId), eq(payrollExportConfig.isActive, true), eq(payrollWageTypeMapping.isActive, true)))
			.limit(1);

		if (rows.length > 0) {
			return [];
		}

		return [{
			id: "payroll:wage-mappings",
			category: "payroll",
			severity: "warning",
			title: "Payroll wage mappings are missing",
			description: "No active wage type mappings are configured for the active payroll export setup.",
			href: "/settings/payroll-readiness",
		}];
	},
};

function buildSection<TItem extends BriefingActionItem>(
	sectionId: keyof typeof SECTION_METADATA,
	items: TItem[],
	result?: PromiseSettledResult<unknown>,
): BriefingSection<TItem> {
	const metadata = SECTION_METADATA[sectionId];

	return {
		...metadata,
		items,
		...(result?.status === "rejected" ? { error: errorMessage(result.reason) } : {}),
	};
}

function settledValue<T>(result: PromiseSettledResult<T>, fallback: T): T {
	return result.status === "fulfilled" ? result.value : fallback;
}

function firstRejected(...results: PromiseSettledResult<unknown>[]): PromiseSettledResult<unknown> | undefined {
	return results.find((result) => result.status === "rejected");
}

function errorMessage(reason: unknown): string {
	return reason instanceof Error ? reason.message : "Unable to load this section";
}

function employeeDisplayName(row: { firstName: string | null; lastName: string | null; userName: string | null; id: string }): string {
	return [row.firstName, row.lastName].filter(Boolean).join(" ") || row.userName || row.id;
}
