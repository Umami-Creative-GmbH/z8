import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { organization } from "@/db/auth-schema";
import {
	absenceCategory,
	approvalRequest,
	employee,
	team,
	timeRecord,
	timeRecordAbsence,
} from "@/db/schema";
import type {
	PayrollBlocker,
	PayrollPeriod,
	PayrollSummaryAbsenceRow,
	PayrollSummaryEmployeeSource,
	PayrollSummaryWorkRow,
	PayrollWorkspaceSummary,
} from "./types";

export function buildPayrollSummaryFromRows(input: {
	organizationName: string;
	period: PayrollPeriod;
	generatedAt: DateTime;
	generatedBy: { id: string; name: string };
	employees: PayrollSummaryEmployeeSource[];
	workRows: PayrollSummaryWorkRow[];
	absenceRows: PayrollSummaryAbsenceRow[];
	blockers: PayrollBlocker[];
}): PayrollWorkspaceSummary {
	const workedMinutesByEmployee = new Map<string, number>();
	for (const row of input.workRows) {
		workedMinutesByEmployee.set(
			row.employeeId,
			(workedMinutesByEmployee.get(row.employeeId) ?? 0) + (row.durationMinutes ?? 0),
		);
	}

	const absenceDaysByEmployee = new Map<
		string,
		Map<string, { categoryId: string; categoryName: string; days: number }>
	>();
	for (const row of input.absenceRows) {
		const employeeAbsences = absenceDaysByEmployee.get(row.employeeId) ?? new Map();
		const existing = employeeAbsences.get(row.categoryId);
		employeeAbsences.set(row.categoryId, {
			categoryId: row.categoryId,
			categoryName: row.categoryName,
			days: (existing?.days ?? 0) + row.days,
		});
		absenceDaysByEmployee.set(row.employeeId, employeeAbsences);
	}

	const employeesWithBlockers = new Set(input.blockers.map((blocker) => blocker.employeeId));
	const employees = input.employees
		.map((employeeRow) => {
			const workedHours = roundHours((workedMinutesByEmployee.get(employeeRow.id) ?? 0) / 60);
			const absenceDaysByCategory = [...(absenceDaysByEmployee.get(employeeRow.id)?.values() ?? [])]
				.map((absence) => ({ ...absence, days: roundDays(absence.days) }))
				.sort((a, b) => a.categoryName.localeCompare(b.categoryName));

			return {
				...employeeRow,
				workedHours,
				absenceDaysByCategory,
				hasBlockers: employeesWithBlockers.has(employeeRow.id),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		organizationName: input.organizationName,
		period: input.period,
		generatedAt: input.generatedAt,
		generatedBy: input.generatedBy,
		totals: {
			employeeCount: employees.length,
			totalWorkedHours: roundHours(
				employees.reduce((total, employeeRow) => total + employeeRow.workedHours, 0),
			),
			blockerCount: input.blockers.length,
		},
		employees,
		blockers: input.blockers,
	};
}

export async function getPayrollWorkspaceSummary(input: {
	organizationId: string;
	allowedEmployeeIds: string[];
	period: { start: DateTime; end: DateTime; label: string };
	generatedBy: { id: string; name: string };
	generatedAt?: DateTime;
}): Promise<PayrollWorkspaceSummary> {
	const { db } = await import("@/db");
	const [organizationRow] = await db
		.select({ name: organization.name })
		.from(organization)
		.where(eq(organization.id, input.organizationId))
		.limit(1);

	const summaryInput = {
		organizationName: organizationRow?.name ?? "",
		period: toPayrollPeriod(input.period),
		generatedAt: input.generatedAt ?? DateTime.utc(),
		generatedBy: input.generatedBy,
	};

	if (input.allowedEmployeeIds.length === 0) {
		return buildPayrollSummaryFromRows({
			...summaryInput,
			employees: [],
			workRows: [],
			absenceRows: [],
			blockers: [],
		});
	}

	const allowedEmployeeIds = [...new Set(input.allowedEmployeeIds)].sort();
	const [employeeRows, workRows, absenceRows, blockers] = await Promise.all([
		getEmployeeRows(input.organizationId, allowedEmployeeIds),
		getWorkRows(input.organizationId, allowedEmployeeIds, input.period),
		getAbsenceRows(input.organizationId, allowedEmployeeIds, input.period),
		getBlockers(input.organizationId, allowedEmployeeIds, input.period),
	]);

	return buildPayrollSummaryFromRows({
		...summaryInput,
		employees: employeeRows,
		workRows,
		absenceRows,
		blockers,
	});
}

async function getEmployeeRows(
	organizationId: string,
	allowedEmployeeIds: string[],
): Promise<PayrollSummaryEmployeeSource[]> {
	const { db } = await import("@/db");
	const rows = await db
		.select({
			id: employee.id,
			firstName: employee.firstName,
			lastName: employee.lastName,
			employeeNumber: employee.employeeNumber,
			teamName: team.name,
			contractType: employee.contractType,
		})
		.from(employee)
		.leftJoin(team, and(eq(employee.teamId, team.id), eq(team.organizationId, organizationId)))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				eq(employee.isActive, true),
				inArray(employee.id, allowedEmployeeIds),
			),
		);

	return rows.map((row) => ({
		id: row.id,
		name: formatEmployeeName(row.firstName, row.lastName),
		employeeNumber: row.employeeNumber,
		teamName: row.teamName,
		contractType: row.contractType,
	}));
}

async function getWorkRows(
	organizationId: string,
	allowedEmployeeIds: string[],
	period: { start: DateTime; end: DateTime },
): Promise<PayrollSummaryWorkRow[]> {
	const { db } = await import("@/db");
	return db
		.select({
			employeeId: timeRecord.employeeId,
			durationMinutes: timeRecord.durationMinutes,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.approvalState, "approved"),
				inArray(timeRecord.employeeId, allowedEmployeeIds),
				gte(timeRecord.startAt, period.start.toUTC().toJSDate()),
				lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
			),
		);
}

async function getAbsenceRows(
	organizationId: string,
	allowedEmployeeIds: string[],
	period: { start: DateTime; end: DateTime },
): Promise<PayrollSummaryAbsenceRow[]> {
	const { db } = await import("@/db");
	const rows = await db
		.select({
			employeeId: timeRecord.employeeId,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			categoryId: absenceCategory.id,
			categoryName: absenceCategory.name,
		})
		.from(timeRecord)
		.innerJoin(
			timeRecordAbsence,
			and(
				eq(timeRecord.id, timeRecordAbsence.recordId),
				eq(timeRecordAbsence.organizationId, organizationId),
			),
		)
		.innerJoin(
			absenceCategory,
			and(
				eq(timeRecordAbsence.absenceCategoryId, absenceCategory.id),
				eq(absenceCategory.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "absence"),
				eq(timeRecord.approvalState, "approved"),
				inArray(timeRecord.employeeId, allowedEmployeeIds),
				lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
				or(isNull(timeRecord.endAt), gte(timeRecord.endAt, period.start.toUTC().toJSDate())),
			),
		);

	return rows.map((row) => ({
		employeeId: row.employeeId,
		categoryId: row.categoryId,
		categoryName: row.categoryName,
		days: countOverlappingUtcDays(row.startAt, row.endAt, period),
	}));
}

async function getBlockers(
	organizationId: string,
	allowedEmployeeIds: string[],
	period: { start: DateTime; end: DateTime },
): Promise<PayrollBlocker[]> {
	const { db } = await import("@/db");
	const [missingClockOutRows, pendingAbsenceRows, pendingApprovalRows] = await Promise.all([
		db
			.select({ id: timeRecord.id, employeeId: timeRecord.employeeId })
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
					inArray(timeRecord.employeeId, allowedEmployeeIds),
					isNull(timeRecord.endAt),
					gte(timeRecord.startAt, period.start.toUTC().toJSDate()),
					lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
				),
			),
		db
			.select({ id: timeRecord.id, employeeId: timeRecord.employeeId })
			.from(timeRecord)
			.innerJoin(
				timeRecordAbsence,
				and(
					eq(timeRecord.id, timeRecordAbsence.recordId),
					eq(timeRecordAbsence.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "absence"),
					eq(timeRecord.approvalState, "pending"),
					inArray(timeRecord.employeeId, allowedEmployeeIds),
					lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
					or(isNull(timeRecord.endAt), gte(timeRecord.endAt, period.start.toUTC().toJSDate())),
				),
			),
		db
			.select({ id: approvalRequest.id, employeeId: timeRecord.employeeId })
			.from(approvalRequest)
			.innerJoin(
				timeRecord,
				and(
					eq(approvalRequest.canonicalRecordId, timeRecord.id),
					eq(timeRecord.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(approvalRequest.organizationId, organizationId),
					eq(approvalRequest.status, "pending"),
					eq(approvalRequest.entityType, "time_entry"),
					inArray(approvalRequest.requestedBy, allowedEmployeeIds),
					inArray(timeRecord.employeeId, allowedEmployeeIds),
					lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
					or(isNull(timeRecord.endAt), gte(timeRecord.endAt, period.start.toUTC().toJSDate())),
				),
			),
	]);

	return [
		...missingClockOutRows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			type: "missing_clock_out" as const,
			label: "Missing clock-out",
		})),
		...pendingAbsenceRows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			type: "pending_absence" as const,
			label: "Pending absence",
		})),
		...pendingApprovalRows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			type: "pending_time_correction" as const,
			label: "Pending time correction",
		})),
	];
}

function toPayrollPeriod(period: { start: DateTime; end: DateTime; label: string }): PayrollPeriod {
	return {
		start: period.start.toUTC().toISODate() ?? "",
		end: period.end.toUTC().toISODate() ?? "",
		label: period.label,
	};
}

function countOverlappingUtcDays(
	startAt: Date,
	endAt: Date | null,
	period: { start: DateTime; end: DateTime },
): number {
	const recordStart = DateTime.fromJSDate(startAt, { zone: "utc" }).startOf("day");
	const recordEnd = DateTime.fromJSDate(endAt ?? startAt, { zone: "utc" }).startOf("day");
	const overlapStart = DateTime.max(recordStart, period.start.toUTC().startOf("day"));
	const overlapEnd = DateTime.min(recordEnd, period.end.toUTC().startOf("day"));
	const inclusiveDays = Math.floor(overlapEnd.diff(overlapStart, "days").days) + 1;

	return Math.max(1, inclusiveDays);
}

function formatEmployeeName(firstName: string | null, lastName: string | null): string {
	return [firstName, lastName].filter(Boolean).join(" ") || "Unnamed employee";
}

function roundHours(hours: number): number {
	return Math.round(hours * 100) / 100;
}

function roundDays(days: number): number {
	return Math.round(days * 100) / 100;
}
