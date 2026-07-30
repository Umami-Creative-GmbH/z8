import {
	and,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	type SQL,
} from "drizzle-orm";
import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { organization, user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	employee,
	payrollBlockerDismissal,
	team,
	timeRecord,
	timeRecordAbsence,
	userSettings,
} from "@/db/schema";
import { assertCanonicalCutoverReady } from "@/lib/time-record/migration/cutover-state";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { buildPayrollAbsenceDetails, payrollAbsenceDetailDays } from "./absence-details";
import {
	filterDismissedPayrollBlockers,
	type PayrollBlockerDismissalKey,
} from "./blocker-dismissals";
import type {
	PayrollBlocker,
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

interface PayrollBlockerDismissalQuery {
	where: SQL | undefined;
	columns: { blockerType: true; sourceId: true };
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
	const absenceDetails = buildPayrollAbsenceDetails(input.absenceRows, input.period);

	const absenceDaysByEmployee = new Map<
		string,
		Map<string, { categoryId: string; categoryName: string; days: number }>
	>();
	for (const detail of absenceDetails) {
		const employeeAbsences = absenceDaysByEmployee.get(detail.employeeId) ?? new Map();
		const existing = employeeAbsences.get(detail.categoryId);
		employeeAbsences.set(detail.categoryId, {
			categoryId: detail.categoryId,
			categoryName: detail.categoryName,
			days: (existing?.days ?? 0) + payrollAbsenceDetailDays(detail.period),
		});
		absenceDaysByEmployee.set(detail.employeeId, employeeAbsences);
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
		.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

	return {
		organizationName: input.organizationName,
		period: input.period,
		generatedAt: input.generatedAt.toUTC().toISO() ?? input.generatedAt.toISO() ?? "",
		generatedBy: input.generatedBy,
		totals: {
			employeeCount: employees.length,
			totalWorkedHours: roundHours(
				employees.reduce((total, employeeRow) => total + employeeRow.workedHours, 0),
			),
			blockerCount: input.blockers.length,
		},
		employees,
		absenceDetails,
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

export function filterPendingTimeApprovalBlockers(input: {
	organizationId: string;
	allowedEmployeeIds: string[];
	period: PayrollDateTimePeriod;
	timezoneByEmployeeId: ReadonlyMap<string, string>;
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
		(!row.startAt.isValid ||
			!row.endAt.isValid ||
			intervalsOverlap(
				row.startAt.toUTC(),
				row.endAt.toUTC(),
				input.period.start,
				input.period.end,
			))
			? [
					{
						id: row.id,
						employeeId: row.employeeId,
						type: "pending_time_correction" as const,
						label: "Pending time correction",
						...localizeBlockerInstant(
							row.startAt,
							input.timezoneByEmployeeId.get(row.employeeId),
						),
					},
				]
			: [],
	);
}

export function filterMissingClockOutBlockers(input: {
	period: PayrollDateTimePeriod;
	timezoneByEmployeeId: ReadonlyMap<string, string>;
	rows: MissingClockOutBlockerRow[];
}): PayrollBlocker[] {
	return input.rows.flatMap((row) =>
		!row.startAt.isValid || row.startAt.toUTC() <= input.period.end.toUTC()
			? [
					{
						id: row.id,
						employeeId: row.employeeId,
						type: "missing_clock_out" as const,
						label: "Missing clock-out",
						...localizeBlockerInstant(
							row.startAt,
							input.timezoneByEmployeeId.get(row.employeeId),
						),
					},
				]
			: [],
	);
}

export function buildPendingAbsenceBlockers(
	rows: ReadonlyArray<{
		id: string;
		employeeId: string;
		startDate: string | null;
	}>,
): PayrollBlocker[] {
	return rows.map((row) => ({
		id: row.id,
		employeeId: row.employeeId,
		type: "pending_absence",
		label: "Pending absence",
		date: row.startDate,
		time: null,
	}));
}

export async function filterDismissedPayrollBlockerCandidates(input: {
	organizationId: string;
	blockerCandidates: PayrollBlocker[];
	findDismissals: (
		query: PayrollBlockerDismissalQuery,
	) => Promise<PayrollBlockerDismissalKey[]>;
}): Promise<PayrollBlocker[]> {
	if (input.blockerCandidates.length === 0) return input.blockerCandidates;

	const candidateSourceIds = Array.from(
		new Set(input.blockerCandidates.map((blocker) => blocker.id)),
	);
	const dismissals = await input.findDismissals({
		where: and(
			eq(payrollBlockerDismissal.organizationId, input.organizationId),
			inArray(payrollBlockerDismissal.sourceId, candidateSourceIds),
		),
		columns: { blockerType: true, sourceId: true },
	});

	return filterDismissedPayrollBlockers(input.blockerCandidates, dismissals);
}

export async function getPayrollWorkspaceSummary(input: {
	organizationId: string;
	allowedEmployeeIds: string[];
	period: { start: DateTime; end: DateTime; label: string };
	generatedBy: { id: string; name: string };
	generatedAt?: DateTime;
}): Promise<PayrollWorkspaceSummary> {
	await assertCanonicalCutoverReady(input.organizationId);

	const { db } = await import("@/db");
	const [organizationRow] = await db
		.select({ name: organization.name, timezone: organization.timezone })
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
		getBlockers(
			input.organizationId,
			allowedEmployeeIds,
			input.period,
			organizationRow?.timezone ?? null,
		),
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
		startDate: row.startAt.toISOString().slice(0, 10),
		endDate: (row.endAt ?? row.startAt).toISOString().slice(0, 10),
		startPeriod: row.startPeriod,
		endPeriod: row.endPeriod,
		startTime: row.startAt.toISOString().slice(11, 19),
		endTime: (row.endAt ?? row.startAt).toISOString().slice(11, 19),
	}));
}

async function getBlockers(
	organizationId: string,
	allowedEmployeeIds: string[],
	period: { start: DateTime; end: DateTime },
	organizationTimezone: string | null,
): Promise<PayrollBlocker[]> {
	const { db } = await import("@/db");
	const [missingClockOutRows, pendingAbsenceRows, pendingApprovalRows] = await Promise.all([
		db
			.select({
				id: timeRecord.id,
				employeeId: timeRecord.employeeId,
				startAt: timeRecord.startAt,
			})
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
			.select({
				id: timeRecord.id,
				employeeId: timeRecord.employeeId,
				startDate: absenceEntry.startDate,
			})
			.from(timeRecord)
			.innerJoin(
				timeRecordAbsence,
				and(
					eq(timeRecord.id, timeRecordAbsence.recordId),
					eq(timeRecordAbsence.organizationId, organizationId),
				),
			)
			.leftJoin(
				absenceEntry,
				and(
					eq(absenceEntry.canonicalRecordId, timeRecord.id),
					eq(absenceEntry.organizationId, organizationId),
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

	const affectedEmployeeIds = Array.from(
		new Set(
			[...missingClockOutRows, ...pendingAbsenceRows, ...pendingApprovalRows].map(
				(row) => row.employeeId,
			),
		),
	);
	const timezoneByEmployeeId = new Map<string, string>();
	if (affectedEmployeeIds.length > 0) {
		const affectedEmployees = await db
			.select({ id: employee.id, userId: employee.userId })
			.from(employee)
			.where(
				and(
					eq(employee.organizationId, organizationId),
					inArray(employee.id, affectedEmployeeIds),
				),
			);
		const affectedUserIds = Array.from(
			new Set(affectedEmployees.map((employeeRow) => employeeRow.userId)),
		);
		const timezoneByUserId = new Map<string, string>();
		if (affectedUserIds.length > 0) {
			const timezoneRows = await db
				.select({
					userId: userSettings.userId,
					timezone: userSettings.timezone,
				})
				.from(userSettings)
				.where(inArray(userSettings.userId, affectedUserIds));
			for (const row of timezoneRows) {
				timezoneByUserId.set(row.userId, row.timezone);
			}
		}
		for (const employeeRow of affectedEmployees) {
			timezoneByEmployeeId.set(
				employeeRow.id,
				resolveEffectiveTimezone(
					timezoneByUserId.get(employeeRow.userId),
					organizationTimezone,
				),
			);
		}
	}

	const pendingApprovalBlockers = filterPendingTimeApprovalBlockers({
		organizationId,
		allowedEmployeeIds,
		period,
		timezoneByEmployeeId,
		rows: pendingApprovalRows.map((row) => ({
			...row,
			startAt: DateTime.fromJSDate(row.startAt, { zone: "utc" }),
			endAt: row.endAt ? DateTime.fromJSDate(row.endAt, { zone: "utc" }) : null,
		})),
	});

	const missingClockOutBlockers = filterMissingClockOutBlockers({
		period,
		timezoneByEmployeeId,
		rows: missingClockOutRows.map((row) => ({
			...row,
			startAt: DateTime.fromJSDate(row.startAt, { zone: "utc" }),
		})),
	});

	const blockerCandidates = [
		...missingClockOutBlockers,
		...buildPendingAbsenceBlockers(pendingAbsenceRows),
		...pendingApprovalBlockers,
	];

	return filterDismissedPayrollBlockerCandidates({
		organizationId,
		blockerCandidates,
		findDismissals: (query) =>
			db.query.payrollBlockerDismissal.findMany(query),
	});
}

function localizeBlockerInstant(
	instant: DateTime,
	timezone: string | undefined,
): Pick<PayrollBlocker, "date" | "time"> {
	const instantIso = instant.isValid ? instant.toUTC().toISO() : null;
	if (!(instantIso && timezone)) return { date: null, time: null };

	try {
		const local = Temporal.Instant.from(instantIso).toZonedDateTimeISO(timezone);
		return {
			date: local.toPlainDate().toString(),
			time: `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`,
		};
	} catch {
		return { date: null, time: null };
	}
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

function roundHours(hours: number): number {
	return Math.round(hours * 100) / 100;
}

function roundDays(days: number): number {
	return Math.round(days * 100) / 100;
}
