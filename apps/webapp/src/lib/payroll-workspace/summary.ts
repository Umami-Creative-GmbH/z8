import { and, eq, gte, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import { Temporal } from "temporal-polyfill";
import { organization, user } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	employee,
	team,
	timeRecord,
	timeRecordAbsence,
	userSettings,
} from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import {
	findOpenDepartureClockRepairs,
	type OpenDepartureClockRepair,
} from "@/lib/employee-lifecycle/reviews";
import {
	allocateProtectedMinutes,
	employeePayrollWindow,
} from "@/lib/payroll-allocation/protected-minutes";
import type {
	CollectedPayrollWork,
	PayrollWorkBlockerKind,
	PayrollWorkCollection,
} from "@/lib/payroll-collection/payroll-work-collection";
import {
	isPayrollWorkCollectionActive,
	readPayrollWorkCollection,
} from "@/lib/payroll-collection/payroll-work-collection-reader";
import { buildPayrollQueryEnvelope } from "@/lib/payroll-export/calendar-boundaries";
import {
	assertCanonicalAbsencesReady,
	assertCanonicalCutoverReady,
} from "@/lib/time-record/migration/cutover-state";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { buildPayrollAbsenceDetails, payrollAbsenceDetailDays } from "./absence-details";
import { filterDismissedPayrollBlockerCandidates } from "./blocker-dismissal-loader";
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

export function buildPayrollSummaryFromRows(input: {
	organizationName: string;
	period: PayrollPeriod;
	generatedAt: DateTime;
	generatedBy: { id: string; name: string };
	employees: PayrollSummaryEmployeeSource[];
	workRows: PayrollSummaryWorkRow[];
	/** Work credited by scoped collection (#322); replaces `workRows` when present. */
	collectedWork?: readonly Pick<CollectedPayrollWork, "employeeId" | "minutes">[];
	absenceRows: PayrollSummaryAbsenceRow[];
	blockers: PayrollBlocker[];
}): PayrollWorkspaceSummary {
	const { workedMinutesByEmployee, blockers: workBlockers } = input.collectedWork
		? { workedMinutesByEmployee: sumCollectedMinutes(input.collectedWork), blockers: [] }
		: calculatePayrollWorkedMinutes(input.workRows, input.period);
	const blockers = [...workBlockers, ...input.blockers];
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

	const employeesWithBlockers = new Set(blockers.map((blocker) => blocker.employeeId));
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
			blockerCount: blockers.length,
		},
		employees,
		absenceDetails,
		blockers,
	};
}

/**
 * Credits completed work to the payroll period with the shared protected-minute rule, using each
 * employee's local payroll window. Work whose credit cannot be allocated is reported as a blocker
 * and contributes nothing, so the totals are explicitly incomplete rather than silently wrong.
 */
export function calculatePayrollWorkedMinutes(
	workRows: PayrollSummaryWorkRow[],
	period: Pick<PayrollPeriod, "start" | "end">,
): { workedMinutesByEmployee: Map<string, number>; blockers: PayrollBlocker[] } {
	const workedMinutesByEmployee = new Map<string, number>();
	const blockers: PayrollBlocker[] = [];
	for (const row of workRows) {
		const allocation = allocateProtectedMinutes(
			{ startAt: row.startAt, endAt: row.endAt, storedMinutes: row.durationMinutes },
			employeePayrollWindow(period.start, period.end, row.timezone),
		);

		if (allocation.status === "outside") continue;
		if (allocation.status === "blocked") {
			blockers.push({
				id: row.id,
				employeeId: row.employeeId,
				type: "unresolved_work_minutes",
				label: "Unresolved work minutes",
				...localizeInstant(row.startAt, row.timezone),
			});
			continue;
		}

		workedMinutesByEmployee.set(
			row.employeeId,
			(workedMinutesByEmployee.get(row.employeeId) ?? 0) + allocation.minutes,
		);
	}

	return { workedMinutesByEmployee, blockers };
}

function sumCollectedMinutes(
	work: readonly Pick<CollectedPayrollWork, "employeeId" | "minutes">[],
): Map<string, number> {
	const minutesByEmployee = new Map<string, number>();
	for (const line of work) {
		minutesByEmployee.set(
			line.employeeId,
			(minutesByEmployee.get(line.employeeId) ?? 0) + line.minutes,
		);
	}
	return minutesByEmployee;
}

const COLLECTION_BLOCKER_LABELS: Record<PayrollWorkBlockerKind, string> = {
	open_work: "Work without clock-out",
	pending_work_approval: "Work awaiting approval",
	pending_work_correction: "Pending time correction",
	unresolved_work_minutes: "Unresolved work minutes",
	uncertain_historical_work: "Historical work needs review",
	offboarding_clock_repair: "Offboarding clock-out needs repair",
};

/**
 * Workspace blockers from scoped collection (#322). They are the ones an export
 * would be refused for, so none of them can be dismissed. A historical finding that
 * affects several employees yields one blocker per employee. Its ID is an opaque
 * digest: a finding ID can name work outside the reader's payroll scope.
 */
export function payrollBlockersFromCollection(
	collection: Pick<PayrollWorkCollection, "blockers" | "employeeTimezones">,
): PayrollBlocker[] {
	return collection.blockers.map((blocker) => {
		const timezone = collection.employeeTimezones[blocker.employeeId];
		return {
			id:
				blocker.kind === "uncertain_historical_work"
					? createHash("sha256")
							.update(`${blocker.sourceId}\u0000${blocker.employeeId}`)
							.digest("hex")
							.slice(0, 32)
					: blocker.sourceId,
			employeeId: blocker.employeeId,
			type: blocker.kind,
			label: COLLECTION_BLOCKER_LABELS[blocker.kind],
			...(blocker.at && timezone
				? localizeInstant(Temporal.Instant.from(blocker.at), timezone)
				: { date: null, time: null }),
		};
	});
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

/**
 * Unresolved departure timer repairs. Localized at the cutoff in the
 * employee's zone; they block exports and cannot be dismissed.
 */
export function buildOffboardingClockRepairBlockers(input: {
	timezoneByEmployeeId: ReadonlyMap<string, string>;
	repairs: ReadonlyArray<Pick<OpenDepartureClockRepair, "reviewId" | "employeeId" | "affectedEndAt">>;
}): PayrollBlocker[] {
	return input.repairs.map((repair) => {
		const timezone = input.timezoneByEmployeeId.get(repair.employeeId);
		return {
			id: repair.reviewId,
			employeeId: repair.employeeId,
			type: "offboarding_clock_repair",
			label: "Offboarding clock-out needs repair",
			...(repair.affectedEndAt && timezone
				? localizeInstant(instantFromDate(repair.affectedEndAt), timezone)
				: { date: null, time: null }),
		};
	});
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

export async function getPayrollWorkspaceSummary(input: {
	organizationId: string;
	allowedEmployeeIds: string[];
	period: { start: DateTime; end: DateTime; label: string };
	generatedBy: { id: string; name: string };
	generatedAt?: DateTime;
}): Promise<PayrollWorkspaceSummary> {
	const { db } = await import("@/db");
	// Scoped collection (#322) owns work readiness; the organization-wide backfill must
	// not run for it, so only absences keep their organization-wide (read-only) check.
	const scopedCollection = await isPayrollWorkCollectionActive(db, input.organizationId);
	if (scopedCollection) {
		await assertCanonicalAbsencesReady(input.organizationId);
	} else {
		await assertCanonicalCutoverReady(input.organizationId);
	}

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
	if (scopedCollection) {
		const [employeeRows, collection, absenceRows, blockers] = await Promise.all([
			getEmployeeRows(input.organizationId, allowedEmployeeIds),
			readPayrollWorkCollection(db, input.organizationId, {
				startDate: summaryInput.period.start,
				endDate: summaryInput.period.end,
				employeeIds: allowedEmployeeIds,
			}),
			getAbsenceRows(input.organizationId, allowedEmployeeIds, input.period),
			getBlockers(
				input.organizationId,
				allowedEmployeeIds,
				input.period,
				organizationRow?.timezone ?? null,
				{ collectionOwnsWorkBlockers: true },
			),
		]);

		// Explicitly incomplete: unaffected work is credited, uncertain work is listed.
		return buildPayrollSummaryFromRows({
			...summaryInput,
			employees: employeeRows,
			workRows: [],
			collectedWork: collection.input.work,
			absenceRows,
			blockers: [...blockers, ...payrollBlockersFromCollection(collection)],
		});
	}

	const [employeeRows, workRows, absenceRows, blockers] = await Promise.all([
		getEmployeeRows(input.organizationId, allowedEmployeeIds),
		getWorkRows(
			input.organizationId,
			allowedEmployeeIds,
			summaryInput.period,
			organizationRow?.timezone ?? null,
		),
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
	period: PayrollPeriod,
	organizationTimezone: string | null,
): Promise<PayrollSummaryWorkRow[]> {
	const { db } = await import("@/db");
	// Every employee-local window lies inside this UTC envelope; allocation clips per employee.
	const queryEnvelope = buildPayrollQueryEnvelope(period.start, period.end);
	const rows = await db
		.select({
			id: timeRecord.id,
			employeeId: timeRecord.employeeId,
			durationMinutes: timeRecord.durationMinutes,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			userTimezone: userSettings.timezone,
		})
		.from(timeRecord)
		.innerJoin(
			employee,
			and(eq(employee.id, timeRecord.employeeId), eq(employee.organizationId, organizationId)),
		)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(
			and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.approvalState, "approved"),
				isNotNull(timeRecord.endAt),
				inArray(timeRecord.employeeId, allowedEmployeeIds),
				lte(timeRecord.startAt, queryEnvelope.end.toJSDate()),
				gte(timeRecord.endAt, queryEnvelope.start.toJSDate()),
			),
		);

	return rows.flatMap((row) =>
		row.endAt
			? [
					{
						id: row.id,
						employeeId: row.employeeId,
						timezone: resolveEffectiveTimezone(row.userTimezone, organizationTimezone),
						startAt: instantFromDate(row.startAt),
						endAt: instantFromDate(row.endAt),
						durationMinutes: row.durationMinutes,
					},
				]
			: [],
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
	options: {
		/** Scoped collection reports open work, corrections and departure timers itself (#322). */
		collectionOwnsWorkBlockers?: boolean;
	} = {},
): Promise<PayrollBlocker[]> {
	const { db } = await import("@/db");
	const collectionOwnsWorkBlockers = options.collectionOwnsWorkBlockers === true;
	const [missingClockOutRows, pendingAbsenceRows, pendingApprovalRows, clockRepairs] =
		await Promise.all([
		collectionOwnsWorkBlockers
			? []
			: db
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
		collectionOwnsWorkBlockers
			? []
			: db
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
		collectionOwnsWorkBlockers
			? []
			: findOpenDepartureClockRepairs(db, {
					organizationId,
					employeeIds: allowedEmployeeIds,
					rangeStart: period.start.toUTC().toJSDate(),
					rangeEndExclusive: period.end.toUTC().plus({ milliseconds: 1 }).toJSDate(),
				}),
	]);

	const affectedEmployeeIds = Array.from(
		new Set(
			[...missingClockOutRows, ...pendingAbsenceRows, ...pendingApprovalRows, ...clockRepairs].map(
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

	const dismissible = await filterDismissedPayrollBlockerCandidates({
		organizationId,
		blockerCandidates,
		findDismissals: (query) =>
			db.query.payrollBlockerDismissal.findMany(query),
	});
	// Added after dismissal filtering: an unresolved departure timer can never be dismissed.
	return [
		...dismissible,
		...buildOffboardingClockRepairBlockers({ timezoneByEmployeeId, repairs: clockRepairs }),
	];
}

function localizeBlockerInstant(
	instant: DateTime,
	timezone: string | undefined,
): Pick<PayrollBlocker, "date" | "time"> {
	const instantIso = instant.isValid ? instant.toUTC().toISO() : null;
	if (!(instantIso && timezone)) return { date: null, time: null };

	return localizeInstant(Temporal.Instant.from(instantIso), timezone);
}

function localizeInstant(instant: Instant, timezone: string): Pick<PayrollBlocker, "date" | "time"> {
	try {
		const local = instant.toZonedDateTimeISO(timezone);
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
