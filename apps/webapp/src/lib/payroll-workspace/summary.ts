import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { DateTime } from "luxon";
import { organization, user } from "@/db/auth-schema";
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
	PayrollDayPeriod,
	PayrollPeriod,
	PayrollSummaryAbsenceRow,
	PayrollSummaryEmployeeSource,
	PayrollSummaryWorkRow,
	PayrollWorkspaceSummary,
} from "./types";

type PayrollDateTimePeriod = { start: DateTime; end: DateTime };

export interface PendingTimeApprovalBlockerRow {
	id: string;
	organizationId: string;
	requestedBy: string;
	status: string;
	entityType: string;
	canonicalRecordId: string | null;
	recordId: string | null;
	recordOrganizationId: string | null;
	employeeId: string;
	startAt: DateTime;
	endAt: DateTime | null;
}

export interface MissingClockOutBlockerRow {
	id: string;
	employeeId: string;
	startAt: DateTime;
}

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
	const summaryPeriod = parsePayrollPeriod(input.period);
	const workedMinutesByEmployee = calculatePayrollWorkedMinutes(input.workRows, summaryPeriod);

	const absenceDaysByEmployee = new Map<
		string,
		Map<string, { categoryId: string; categoryName: string; days: number }>
	>();
	for (const row of input.absenceRows) {
		const employeeAbsences = absenceDaysByEmployee.get(row.employeeId) ?? new Map();
		const existing = employeeAbsences.get(row.categoryId);
		const days =
			row.days ??
			(row.startAt && row.startPeriod && row.endPeriod
				? calculatePayrollAbsenceDays({
						startAt: row.startAt,
						endAt: row.endAt ?? null,
						startPeriod: row.startPeriod,
						endPeriod: row.endPeriod,
						period: summaryPeriod,
					})
				: 0);
		employeeAbsences.set(row.categoryId, {
			categoryId: row.categoryId,
			categoryName: row.categoryName,
			days: (existing?.days ?? 0) + days,
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

export function calculatePayrollWorkedMinutes(
	workRows: PayrollSummaryWorkRow[],
	period: PayrollDateTimePeriod,
): Map<string, number> {
	const workedMinutesByEmployee = new Map<string, number>();
	for (const row of workRows) {
		const minutes = row.startAt
			? row.endAt
				? calculateOverlappingMinutes(row.startAt, row.endAt, period)
				: 0
			: (row.durationMinutes ?? 0);

		if (minutes <= 0) continue;

		workedMinutesByEmployee.set(
			row.employeeId,
			(workedMinutesByEmployee.get(row.employeeId) ?? 0) + minutes,
		);
	}

	return workedMinutesByEmployee;
}

export function calculatePayrollAbsenceDays(input: {
	startAt: DateTime;
	endAt: DateTime | null;
	startPeriod: PayrollDayPeriod;
	endPeriod: PayrollDayPeriod;
	period: PayrollDateTimePeriod;
}): number {
	const recordStartDate = input.startAt.toUTC().startOf("day");
	const recordEndDate = (input.endAt ?? input.startAt).toUTC().startOf("day");
	if (recordEndDate < recordStartDate) return 0;

	let days = 0;
	let day = recordStartDate;
	while (day <= recordEndDate) {
		for (const slot of getAbsenceSlotsForDay(
			day,
			recordStartDate,
			recordEndDate,
			input.startPeriod,
			input.endPeriod,
		)) {
			if (
				intervalsOverlap(slot.start, slot.end, input.period.start.toUTC(), input.period.end.toUTC())
			) {
				days += 0.5;
			}
		}
		day = day.plus({ days: 1 });
	}

	return roundDays(days);
}

export function filterPendingTimeApprovalBlockers(input: {
	organizationId: string;
	allowedEmployeeIds: string[];
	period: PayrollDateTimePeriod;
	rows: PendingTimeApprovalBlockerRow[];
}): PayrollBlocker[] {
	const allowedEmployeeIds = new Set(input.allowedEmployeeIds);

	return input.rows.flatMap((row) =>
		row.organizationId === input.organizationId &&
		row.recordOrganizationId === input.organizationId &&
		row.status === "pending" &&
		row.entityType === "time_entry" &&
		row.canonicalRecordId !== null &&
		row.canonicalRecordId === row.recordId &&
		allowedEmployeeIds.has(row.requestedBy) &&
		allowedEmployeeIds.has(row.employeeId) &&
		row.endAt !== null &&
		intervalsOverlap(row.startAt.toUTC(), row.endAt.toUTC(), input.period.start, input.period.end)
			? [
					{
						id: row.id,
						employeeId: row.employeeId,
						type: "pending_time_correction" as const,
						label: "Pending time correction",
					},
				]
			: [],
	);
}

export function filterMissingClockOutBlockers(input: {
	period: PayrollDateTimePeriod;
	rows: MissingClockOutBlockerRow[];
}): PayrollBlocker[] {
	return input.rows.flatMap((row) =>
		row.startAt.toUTC() <= input.period.end.toUTC()
			? [
					{
						id: row.id,
						employeeId: row.employeeId,
						type: "missing_clock_out" as const,
						label: "Missing clock-out",
					},
				]
			: [],
	);
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

	const allowedEmployeeIds = Array.from(new Set(input.allowedEmployeeIds)).toSorted();
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
			userName: user.name,
			employeeNumber: employee.employeeNumber,
			teamName: team.name,
			contractType: employee.contractType,
		})
		.from(employee)
		.innerJoin(user, eq(employee.userId, user.id))
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
		name: formatEmployeeDisplayName(row.userName, row.employeeNumber, row.id),
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
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.approvalState, "approved"),
				isNotNull(timeRecord.endAt),
				inArray(timeRecord.employeeId, allowedEmployeeIds),
				lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
				gte(timeRecord.endAt, period.start.toUTC().toJSDate()),
			),
		)
		.then((rows) =>
			rows.map((row) => ({
				employeeId: row.employeeId,
				durationMinutes: row.durationMinutes,
				startAt: DateTime.fromJSDate(row.startAt, { zone: "utc" }),
				endAt: row.endAt ? DateTime.fromJSDate(row.endAt, { zone: "utc" }) : null,
			})),
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
			startPeriod: timeRecordAbsence.startPeriod,
			endPeriod: timeRecordAbsence.endPeriod,
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
		startAt: DateTime.fromJSDate(row.startAt, { zone: "utc" }),
		endAt: row.endAt ? DateTime.fromJSDate(row.endAt, { zone: "utc" }) : null,
		startPeriod: row.startPeriod,
		endPeriod: row.endPeriod,
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
			.select({ id: timeRecord.id, employeeId: timeRecord.employeeId, startAt: timeRecord.startAt })
			.from(timeRecord)
			.where(
				and(
					eq(timeRecord.organizationId, organizationId),
					eq(timeRecord.recordKind, "work"),
					inArray(timeRecord.employeeId, allowedEmployeeIds),
					isNull(timeRecord.endAt),
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
			.select({
				id: approvalRequest.id,
				organizationId: approvalRequest.organizationId,
				requestedBy: approvalRequest.requestedBy,
				status: approvalRequest.status,
				entityType: approvalRequest.entityType,
				canonicalRecordId: approvalRequest.canonicalRecordId,
				recordId: timeRecord.id,
				recordOrganizationId: timeRecord.organizationId,
				employeeId: timeRecord.employeeId,
				startAt: timeRecord.startAt,
				endAt: timeRecord.endAt,
			})
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
					isNotNull(timeRecord.endAt),
					lte(timeRecord.startAt, period.end.toUTC().toJSDate()),
					gte(timeRecord.endAt, period.start.toUTC().toJSDate()),
				),
			),
	]);

	const pendingApprovalBlockers = filterPendingTimeApprovalBlockers({
		organizationId,
		allowedEmployeeIds,
		period,
		rows: pendingApprovalRows.map((row) => ({
			...row,
			startAt: DateTime.fromJSDate(row.startAt, { zone: "utc" }),
			endAt: row.endAt ? DateTime.fromJSDate(row.endAt, { zone: "utc" }) : null,
		})),
	});

	const missingClockOutBlockers = filterMissingClockOutBlockers({
		period,
		rows: missingClockOutRows.map((row) => ({
			...row,
			startAt: DateTime.fromJSDate(row.startAt, { zone: "utc" }),
		})),
	});

	return [
		...missingClockOutBlockers,
		...pendingAbsenceRows.map((row) => ({
			id: row.id,
			employeeId: row.employeeId,
			type: "pending_absence" as const,
			label: "Pending absence",
		})),
		...pendingApprovalBlockers,
	];
}

function toPayrollPeriod(period: { start: DateTime; end: DateTime; label: string }): PayrollPeriod {
	return {
		start: period.start.toUTC().toISODate() ?? "",
		end: period.end.toUTC().toISODate() ?? "",
		label: period.label,
	};
}

function formatEmployeeDisplayName(
	userName: string | null,
	employeeNumber: string | null,
	employeeId: string,
): string {
	return userName?.trim() || employeeNumber?.trim() || employeeId;
}

function parsePayrollPeriod(period: PayrollPeriod): PayrollDateTimePeriod {
	return {
		start: parsePayrollPeriodBoundary(period.start, "start"),
		end: parsePayrollPeriodBoundary(period.end, "end"),
	};
}

function parsePayrollPeriodBoundary(value: string, edge: "start" | "end"): DateTime {
	const parsed = DateTime.fromISO(value, { zone: "utc" });
	if (value.length === 10) {
		return edge === "start" ? parsed.startOf("day") : parsed.endOf("day");
	}

	return parsed.toUTC();
}

function calculateOverlappingMinutes(
	startAt: DateTime,
	endAt: DateTime,
	period: PayrollDateTimePeriod,
): number {
	const overlapStart = DateTime.max(startAt.toUTC(), period.start.toUTC());
	const overlapEnd = DateTime.min(endAt.toUTC(), period.end.toUTC());

	return Math.max(0, Math.round(overlapEnd.diff(overlapStart, "minutes").minutes));
}

function intervalsOverlap(
	startAt: DateTime,
	endAt: DateTime,
	periodStart: DateTime,
	periodEnd: DateTime,
): boolean {
	return startAt.toUTC() <= periodEnd.toUTC() && endAt.toUTC() >= periodStart.toUTC();
}

function getAbsenceSlotsForDay(
	day: DateTime,
	recordStartDate: DateTime,
	recordEndDate: DateTime,
	startPeriod: PayrollDayPeriod,
	endPeriod: PayrollDayPeriod,
): Array<{ start: DateTime; end: DateTime }> {
	const slots = [
		{
			period: "am" as const,
			start: day.startOf("day"),
			end: day.startOf("day").plus({ hours: 12 }),
		},
		{ period: "pm" as const, start: day.startOf("day").plus({ hours: 12 }), end: day.endOf("day") },
	];
	const startSlot = day.hasSame(recordStartDate, "day") ? firstAbsenceSlot(startPeriod) : "am";
	const endSlot = day.hasSame(recordEndDate, "day") ? lastAbsenceSlot(endPeriod) : "pm";

	return slots.filter((slot) => slot.period >= startSlot && slot.period <= endSlot);
}

function firstAbsenceSlot(period: PayrollDayPeriod): "am" | "pm" {
	return period === "pm" ? "pm" : "am";
}

function lastAbsenceSlot(period: PayrollDayPeriod): "am" | "pm" {
	return period === "am" ? "am" : "pm";
}

function roundHours(hours: number): number {
	return Math.round(hours * 100) / 100;
}

function roundDays(days: number): number {
	return Math.round(days * 100) / 100;
}
