import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";

import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	db,
	employee,
	timeRecord,
	timeRecordAbsence,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	workPeriod,
} from "@/db";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { recordedTaskId } from "@/lib/time-tracking/task-attribution";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";

type LegacyApprovalStatus = "pending" | "approved" | "rejected";
type CanonicalDayPeriod = "full_day" | "am" | "pm";
type LegacyDayPeriod = CanonicalDayPeriod | "morning" | "afternoon";
type LegacyEntityType = "time_entry" | "absence_entry";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type LegacyWorkPeriod = {
	id: string;
	organizationId: string;
	employeeId: string;
	startTime: Date;
	endTime: Date | null;
	isActive: boolean;
	canonicalRecordId: string | null;
	durationMinutes: number | null;
	approvalStatus: LegacyApprovalStatus;
	projectId: string | null;
	/** Billable work (#900); absent reads as non-billable. */
	isBillable?: boolean;
	/** The task of the project (#873); absent from callers that predate tasks. */
	taskId?: string | null;
	workCategoryId: string | null;
	workLocationType: WorkLocationType | null;
	/** Vehicle use (#1120); absent from callers that predate it. */
	vehicleKind?: "organization" | "own" | null;
	vehicleId?: string | null;
	odometerStartKm?: number | null;
	odometerEndKm?: number | null;
	drivenDistanceKm?: number | null;
	createdAt: Date;
	updatedAt: Date;
};

export type LegacyAbsenceEntry = {
	id: string;
	organizationId: string;
	employeeId: string;
	categoryId: string;
	startDate: string;
	startPeriod: LegacyDayPeriod;
	endDate: string;
	endPeriod: LegacyDayPeriod;
	status: LegacyApprovalStatus;
	createdAt: Date;
	updatedAt: Date;
};

export type LegacyApprovalRequest = {
	id: string;
	organizationId: string;
	entityType: LegacyEntityType;
	entityId: string;
	requestedBy: string;
	approverId: string;
	status: LegacyApprovalStatus;
	reason: string | null;
	rejectionReason: string | null;
	approvedAt: Date | null;
	createdAt: Date;
};

export type BackfillAbsenceCategory = {
	id: string;
	countsAgainstVacation: boolean;
};

export type CanonicalBackfillInput = {
	organizationId: string;
	actorId: string;
	legacy: {
		workPeriods: LegacyWorkPeriod[];
		absenceEntries: LegacyAbsenceEntry[];
		approvalRequests: LegacyApprovalRequest[];
		absenceCategories: BackfillAbsenceCategory[];
	};
};

export type CanonicalBackfillRunInput = {
	organizationId: string;
	actorId: string;
	legacy?: CanonicalBackfillInput["legacy"];
};

export type CanonicalBackfillPayload = {
	timeRecords: Array<{
		id: string;
		organizationId: string;
		employeeId: string;
		recordKind: "work" | "absence";
		startAt: Date;
		endAt: Date | null;
		durationMinutes: number | null;
		approvalState: "pending" | "approved" | "rejected";
		origin: "system";
		createdAt: Date;
		createdBy: string;
		updatedAt: Date;
		updatedBy: string;
	}>;
	timeRecordWork: Array<{
		recordId: string;
		organizationId: string;
		recordKind: "work";
		workCategoryId: string | null;
		workLocationType: WorkLocationType | null;
		computationMetadata: string | null;
		vehicleKind: "organization" | "own" | null;
		vehicleId: string | null;
		odometerStartKm: number | null;
		odometerEndKm: number | null;
		drivenDistanceKm: number | null;
	}>;
	timeRecordAbsence: Array<{
		recordId: string;
		organizationId: string;
		recordKind: "absence";
		absenceCategoryId: string;
		startPeriod: CanonicalDayPeriod;
		endPeriod: CanonicalDayPeriod;
		countsAgainstVacation: boolean;
	}>;
	timeRecordAllocation: Array<{
		organizationId: string;
		recordId: string;
		allocationKind: "project";
		projectId: string;
		/** Present only when the period has a task, so the allocation and period agree. */
		taskId?: string;
		weightPercent: number;
		/** Present when the period is billable (#900); the column defaults to false. */
		isBillable?: boolean;
	}>;
	timeRecordApprovalDecision: Array<{
		organizationId: string;
		recordId: string;
		actorEmployeeId: string;
		action: "submitted" | "approved" | "rejected";
		reason: string | null;
		createdAt: Date;
	}>;
	legacyLinks: {
		workPeriod: Array<{ id: string; canonicalRecordId: string }>;
		absenceEntry: Array<{
			id: string;
			canonicalRecordId: string;
			organizationId: string;
		}>;
		approvalRequest: Array<{ id: string; canonicalRecordId: string }>;
	};
};

export function buildCanonicalBackfillPayload(
	input: CanonicalBackfillInput,
): CanonicalBackfillPayload {
	const categoryVacationFlagById = new Map(
		input.legacy.absenceCategories.map((category) => [category.id, category.countsAgainstVacation]),
	);

	const workPeriods = input.legacy.workPeriods.filter(
		(workPeriod) =>
			workPeriod.organizationId === input.organizationId &&
			!workPeriod.isActive &&
			workPeriod.endTime !== null &&
			workPeriod.canonicalRecordId === null,
	);
	const absences = input.legacy.absenceEntries.filter(
		(absenceEntry) => absenceEntry.organizationId === input.organizationId,
	);
	const approvals = input.legacy.approvalRequests.filter(
		(approvalRequest) => approvalRequest.organizationId === input.organizationId,
	);

	const timeRecords: CanonicalBackfillPayload["timeRecords"] = [];
	const timeRecordWork: CanonicalBackfillPayload["timeRecordWork"] = [];
	const timeRecordAbsence: CanonicalBackfillPayload["timeRecordAbsence"] = [];
	const timeRecordAllocation: CanonicalBackfillPayload["timeRecordAllocation"] = [];
	const timeRecordApprovalDecision: CanonicalBackfillPayload["timeRecordApprovalDecision"] = [];

	const workPeriodRecordMap = new Map<string, string>();
	const absenceRecordMap = new Map<string, string>();

	for (const workPeriod of workPeriods) {
		timeRecords.push({
			id: workPeriod.id,
			organizationId: input.organizationId,
			employeeId: workPeriod.employeeId,
			recordKind: "work",
			startAt: workPeriod.startTime,
			endAt: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			approvalState: workPeriod.approvalStatus,
			origin: "system",
			createdAt: workPeriod.createdAt,
			createdBy: input.actorId,
			updatedAt: workPeriod.updatedAt,
			updatedBy: input.actorId,
		});

		timeRecordWork.push({
			recordId: workPeriod.id,
			organizationId: input.organizationId,
			recordKind: "work",
			workCategoryId: workPeriod.workCategoryId,
			workLocationType: workPeriod.workLocationType,
			// A work period keeps no computation metadata; only its canonical writers record it.
			computationMetadata: null,
			vehicleKind: workPeriod.vehicleKind ?? null,
			vehicleId: workPeriod.vehicleId ?? null,
			odometerStartKm: workPeriod.odometerStartKm ?? null,
			odometerEndKm: workPeriod.odometerEndKm ?? null,
			drivenDistanceKm: workPeriod.drivenDistanceKm ?? null,
		});

		if (workPeriod.projectId) {
			timeRecordAllocation.push({
				organizationId: input.organizationId,
				recordId: workPeriod.id,
				allocationKind: "project",
				projectId: workPeriod.projectId,
				...recordedTaskId(workPeriod.taskId),
				weightPercent: 100,
				...(workPeriod.isBillable ? { isBillable: true } : {}),
			});
		}

		workPeriodRecordMap.set(workPeriod.id, workPeriod.id);
	}

	for (const absenceEntry of absences) {
		const startPeriod = normalizeLegacyDayPeriod(absenceEntry.startPeriod);
		const endPeriod = normalizeLegacyDayPeriod(absenceEntry.endPeriod);

		const interval = mapAbsenceToInterval(
			absenceEntry.startDate,
			startPeriod,
			absenceEntry.endDate,
			endPeriod,
		);

		timeRecords.push({
			id: absenceEntry.id,
			organizationId: input.organizationId,
			employeeId: absenceEntry.employeeId,
			recordKind: "absence",
			startAt: interval.startAt,
			endAt: interval.endAt,
			durationMinutes: interval.durationMinutes,
			approvalState: absenceEntry.status,
			origin: "system",
			createdAt: absenceEntry.createdAt,
			createdBy: input.actorId,
			updatedAt: absenceEntry.updatedAt,
			updatedBy: input.actorId,
		});

		timeRecordAbsence.push({
			recordId: absenceEntry.id,
			organizationId: input.organizationId,
			recordKind: "absence",
			absenceCategoryId: absenceEntry.categoryId,
			startPeriod,
			endPeriod,
			countsAgainstVacation: categoryVacationFlagById.get(absenceEntry.categoryId) ?? true,
		});

		absenceRecordMap.set(absenceEntry.id, absenceEntry.id);
	}

	for (const approvalRequest of approvals) {
		const recordId =
			approvalRequest.entityType === "time_entry"
				? workPeriodRecordMap.get(approvalRequest.entityId)
				: absenceRecordMap.get(approvalRequest.entityId);

		if (!recordId) {
			continue;
		}

		timeRecordApprovalDecision.push({
			organizationId: input.organizationId,
			recordId,
			actorEmployeeId:
				approvalRequest.status === "pending"
					? approvalRequest.requestedBy
					: approvalRequest.approverId,
			action: mapApprovalStatusToAction(approvalRequest.status),
			reason: approvalRequest.rejectionReason ?? approvalRequest.reason,
			createdAt: approvalRequest.approvedAt ?? approvalRequest.createdAt,
		});
	}

	return {
		timeRecords,
		timeRecordWork,
		timeRecordAbsence,
		timeRecordAllocation,
		timeRecordApprovalDecision,
		legacyLinks: {
			workPeriod: workPeriods.map((workPeriod) => ({
				id: workPeriod.id,
				canonicalRecordId: workPeriod.id,
			})),
			absenceEntry: absences.map((absenceEntry) => ({
				id: absenceEntry.id,
				canonicalRecordId: absenceEntry.id,
				organizationId: input.organizationId,
			})),
			approvalRequest: approvals
				.map((approvalRequest) => {
					const canonicalRecordId =
						approvalRequest.entityType === "time_entry"
							? workPeriodRecordMap.get(approvalRequest.entityId)
							: absenceRecordMap.get(approvalRequest.entityId);

					if (!canonicalRecordId) {
						return null;
					}

					return {
						id: approvalRequest.id,
						canonicalRecordId,
					};
				})
				.filter((value): value is { id: string; canonicalRecordId: string } => value !== null),
		},
	};
}

export type CanonicalBackfillResult = CanonicalBackfillPayload & {
	/**
	 * Completed work periods left without a canonical work record because their work touches
	 * a closed month (#1213). The database refuses the record (Time Tracking ADR-0004), and a
	 * half pair in a closed month can't change, so it stays as it is until the month reopens.
	 */
	closedMonthSkips: Array<{ workPeriodId: string; month: string }>;
};

export async function runCanonicalBackfill(
	input: CanonicalBackfillRunInput,
): Promise<CanonicalBackfillResult> {
	const resolvedInput = input.legacy
		? { organizationId: input.organizationId, actorId: input.actorId, legacy: input.legacy }
		: await loadCanonicalBackfillInput(input);
	const payload = buildCanonicalBackfillPayload(resolvedInput);
	const sourceWork = new Map(resolvedInput.legacy.workPeriods.map((period) => [period.id, period]));
	const workRecordIds = new Set(
		payload.legacyLinks.workPeriod.map((link) => link.canonicalRecordId),
	);
	const isWork = (row: { recordId: string }) => workRecordIds.has(row.recordId);
	const work = {
		records: new Map(
			payload.timeRecords
				.filter((record) => record.recordKind === "work")
				.map((record) => [record.id, record]),
		),
		details: groupByRecordId(payload.timeRecordWork),
		allocations: groupByRecordId(payload.timeRecordAllocation),
		decisions: groupByRecordId(payload.timeRecordApprovalDecision.filter(isWork)),
		approvalLinks: groupByRecordId(
			payload.legacyLinks.approvalRequest
				.filter((link) => workRecordIds.has(link.canonicalRecordId))
				.map((link) => ({ ...link, recordId: link.canonicalRecordId })),
		),
	};
	const closedMonthSkips: CanonicalBackfillResult["closedMonthSkips"] = [];

	await db.transaction(async (tx) => {
		// One savepoint per work period: a closed-month refusal (Z8M01) rolls back only that
		// period, which keeps its half pair, and the rest of the organization is still attached.
		// Any other failure still aborts the whole backfill.
		for (const link of payload.legacyLinks.workPeriod) {
			const recordId = link.canonicalRecordId;
			const record = work.records.get(recordId);
			try {
				await tx.transaction(async (savepoint) => {
					await upsertCanonicalTimeRecords(savepoint, record ? [record] : []);
					await insertIfPresent(savepoint, timeRecordWork, work.details.get(recordId) ?? []);

					const allocations = work.allocations.get(recordId) ?? [];
					if (allocations.length > 0) {
						await savepoint
							.delete(timeRecordAllocation)
							.where(eq(timeRecordAllocation.recordId, recordId));
						await savepoint.insert(timeRecordAllocation).values(allocations);
					}

					const decisions = work.decisions.get(recordId) ?? [];
					if (decisions.length > 0) {
						await savepoint
							.delete(timeRecordApprovalDecision)
							.where(eq(timeRecordApprovalDecision.recordId, recordId));
						await savepoint.insert(timeRecordApprovalDecision).values(decisions);
					}

					const source = sourceWork.get(link.id);
					if (!source || source.endTime === null) throw new Error("Invalid work backfill source");
					// A clock-out or correction may have established work since the read.
					// Reject the stale snapshot and roll back every representation written here.
					const linked = await savepoint
						.update(workPeriod)
						.set({ canonicalRecordId: recordId })
						.where(
							and(
								eq(workPeriod.id, link.id),
								eq(workPeriod.organizationId, input.organizationId),
								isNull(workPeriod.canonicalRecordId),
								eq(workPeriod.isActive, false),
								eq(workPeriod.startTime, source.startTime),
								eq(workPeriod.endTime, source.endTime),
								eq(workPeriod.updatedAt, source.updatedAt),
							),
						)
						.returning({ id: workPeriod.id });
					if (linked.length !== 1) throw new Error("Work changed during canonical backfill");

					for (const approvalLink of work.approvalLinks.get(recordId) ?? []) {
						await savepoint
							.update(approvalRequest)
							.set({ canonicalRecordId: recordId })
							.where(eq(approvalRequest.id, approvalLink.id));
					}
				});
			} catch (error) {
				const refusal = monthClosedRefusalOf(error);
				if (!refusal) throw error;
				closedMonthSkips.push({ workPeriodId: link.id, month: refusal.month });
			}
		}

		// Absences: the closed-month refusal guards an absence by its entry's local days, and
		// neither its canonical record nor the entry's link and organization are frozen.
		await upsertCanonicalTimeRecords(
			tx,
			payload.timeRecords.filter((record) => record.recordKind === "absence"),
		);
		await insertIfPresent(tx, timeRecordAbsence, payload.timeRecordAbsence);

		const absenceDecisions = payload.timeRecordApprovalDecision.filter(
			(decision) => !isWork(decision),
		);
		if (absenceDecisions.length > 0) {
			await tx.delete(timeRecordApprovalDecision).where(
				inArray(
					timeRecordApprovalDecision.recordId,
					absenceDecisions.map((decision) => decision.recordId),
				),
			);
			await tx.insert(timeRecordApprovalDecision).values(absenceDecisions);
		}

		for (const link of payload.legacyLinks.absenceEntry) {
			await tx
				.update(absenceEntry)
				.set({
					canonicalRecordId: link.canonicalRecordId,
					organizationId: link.organizationId,
				})
				.where(eq(absenceEntry.id, link.id));
		}

		for (const link of payload.legacyLinks.approvalRequest) {
			if (workRecordIds.has(link.canonicalRecordId)) continue;
			await tx
				.update(approvalRequest)
				.set({ canonicalRecordId: link.canonicalRecordId })
				.where(eq(approvalRequest.id, link.id));
		}
	});

	return { ...payload, closedMonthSkips };
}

function groupByRecordId<T extends { recordId: string }>(rows: T[]): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const group = groups.get(row.recordId);
		if (group) group.push(row);
		else groups.set(row.recordId, [row]);
	}
	return groups;
}

async function loadCanonicalBackfillInput(
	input: CanonicalBackfillRunInput,
): Promise<CanonicalBackfillInput> {
	const [
		targetEmployees,
		workPeriods,
		scopedAbsenceEntries,
		nullOrgAbsenceEntries,
		approvalRequests,
		absenceCategories,
	] = await Promise.all([
		db.query.employee.findMany({
			where: eq(employee.organizationId, input.organizationId),
			columns: { id: true },
		}),
		db.query.workPeriod.findMany({
			where: eq(workPeriod.organizationId, input.organizationId),
		}),
		db.query.absenceEntry.findMany({
			where: eq(absenceEntry.organizationId, input.organizationId),
		}),
		db.query.absenceEntry.findMany({
			where: isNull(absenceEntry.organizationId),
		}),
		db.query.approvalRequest.findMany({
			where: eq(approvalRequest.organizationId, input.organizationId),
		}),
		db.query.absenceCategory.findMany({
			where: eq(absenceCategory.organizationId, input.organizationId),
			columns: { id: true, countsAgainstVacation: true },
		}),
	]);

	const targetEmployeeIds = new Set(targetEmployees.map((record) => record.id));
	const normalizedScopedAbsenceEntries: LegacyAbsenceEntry[] = scopedAbsenceEntries
		.filter(
			(record): record is typeof record & { organizationId: string } =>
				record.organizationId !== null,
		)
		.map((record) => ({
			...record,
			organizationId: record.organizationId,
		}));
	const attributedNullOrgAbsenceEntries: LegacyAbsenceEntry[] = nullOrgAbsenceEntries
		.filter((record) => targetEmployeeIds.has(record.employeeId))
		.map((record) => ({
			...record,
			organizationId: input.organizationId,
		}));
	const normalizedApprovalRequests: LegacyApprovalRequest[] = approvalRequests.filter(
		(record): record is typeof record & { entityType: LegacyEntityType } =>
			record.entityType === "time_entry" || record.entityType === "absence_entry",
	);

	return {
		organizationId: input.organizationId,
		actorId: input.actorId,
		legacy: {
			workPeriods,
			absenceEntries: [...normalizedScopedAbsenceEntries, ...attributedNullOrgAbsenceEntries],
			approvalRequests: normalizedApprovalRequests,
			absenceCategories,
		},
	};
}

async function upsertCanonicalTimeRecords(
	tx: Transaction,
	values: CanonicalBackfillPayload["timeRecords"],
) {
	const work = values.filter((record) => record.recordKind === "work");
	if (work.length > 0) {
		const inserted = await tx
			.insert(timeRecord)
			.values(work)
			.onConflictDoNothing({
				target: [timeRecord.id, timeRecord.organizationId],
			})
			.returning({ id: timeRecord.id });
		// An existing same-ID copy needs evidence-based repair, not an automatic rewrite.
		if (inserted.length !== work.length) throw new Error("Canonical work backfill conflict");
	}

	const absences = values.filter((record) => record.recordKind === "absence");
	if (absences.length === 0) return;
	await tx
		.insert(timeRecord)
		.values(absences)
		.onConflictDoUpdate({
			target: [timeRecord.id, timeRecord.organizationId],
			set: {
				durationMinutes: sql.raw("excluded.duration_minutes"),
				approvalState: sql.raw("excluded.approval_state"),
			},
		});
}

async function insertIfPresent<TTable, TValue>(
	tx: {
		insert: (table: TTable) => {
			values: (values: TValue[]) => {
				onConflictDoNothing: () => Promise<unknown>;
			};
		};
	},
	table: TTable,
	values: TValue[],
) {
	if (values.length === 0) {
		return;
	}

	await tx.insert(table).values(values).onConflictDoNothing();
}

function mapApprovalStatusToAction(
	status: LegacyApprovalStatus,
): "submitted" | "approved" | "rejected" {
	if (status === "pending") {
		return "submitted";
	}

	return status;
}

function mapAbsenceToInterval(
	startDate: string,
	startPeriod: CanonicalDayPeriod,
	endDate: string,
	endPeriod: CanonicalDayPeriod,
): {
	startAt: Date;
	endAt: Date;
	durationMinutes: number;
} {
	const startAt = dateWithPeriod(startDate, startPeriod, "start");
	const endAt = dateWithPeriod(endDate, endPeriod, "end");

	const durationMinutes = Math.max(0, Math.round(endAt.diff(startAt, "minutes").minutes));

	return {
		startAt: startAt.toJSDate(),
		endAt: endAt.toJSDate(),
		durationMinutes,
	};
}

function dateWithPeriod(
	dateIso: string,
	period: CanonicalDayPeriod,
	edge: "start" | "end",
): DateTime {
	const day = DateTime.fromISO(dateIso, { zone: "utc" });

	if (!day.isValid) {
		throw new Error(`Invalid absence date for backfill: ${dateIso}`);
	}

	if (period === "am") {
		return edge === "start" ? day.startOf("day") : day.startOf("day").plus({ hours: 12 });
	}

	if (period === "pm") {
		return edge === "start"
			? day.startOf("day").plus({ hours: 12 })
			: day.endOf("day").plus({ millisecond: 1 });
	}

	return edge === "start" ? day.startOf("day") : day.endOf("day").plus({ millisecond: 1 });
}

function normalizeLegacyDayPeriod(period: LegacyDayPeriod): CanonicalDayPeriod {
	if (period === "morning") {
		return "am";
	}

	if (period === "afternoon") {
		return "pm";
	}

	return period;
}
