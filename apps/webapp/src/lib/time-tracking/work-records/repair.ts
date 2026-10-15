import "server-only";

/**
 * Attaching and repairing canonical work records (ADR 0010, #1226): historical
 * completed work whose canonical work record is missing, unlinked, incomplete
 * or disagrees is brought into record agreement, in either admission, in one
 * revision step, with the effects of any change to work. Runs on a sealed
 * work-transaction scope only; it never opens a transaction and never takes
 * guards. Neither appends a time entry: a repair never moves an endpoint.
 *
 * Every refusal is decided before the first write. A pair that still disagrees
 * after the writes is a defect in work records: it throws and rolls back.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
	approvalRequest,
	timeRecord,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import { legacyApprovalDecision } from "@/lib/time-record/legacy-approval-decision";
import { closedRangeTouchedByWork, type WorkInterval } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import { resolvedPatch } from "./amend";
import type { WorkRecordExpected, WorkRecordRefusal } from "./change";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { CompletedWorkIntegrityError } from "./integrity";
import {
	assertWrittenAgreement,
	insertAllocations,
	lockedWork,
	replaceProjectAllocation,
	writeCanonicalDetail,
} from "./pair-writer";
import { expectedOf } from "./read";
import type { RecordAgreementFacet } from "./record-agreement";
import type { AttachWorkRecord, RepairWorkRecord } from "./repair-change";
import { planAttachment, planRepair, type RepairPlan } from "./repair-plan";
import type { CanonicalWorkRows, TimeEntryRow, WorkPeriodRow } from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import { UnrepresentableWorkAttributionError, WorkAttribution } from "./work-attribution";

/**
 * Attaching changes no work: the period's interval, minutes and attribution
 * stay as they are, so nothing is sent back and no balance is marked (user,
 * 2026-10-15). Only the record and the revision step are written. A resolution
 * that changes the period's minutes or attribution is a change of work, with
 * its effects.
 */
export type WorkAttachment = {
	kind: "attached";
	/** The work with its new canonical work record. */
	segment: WorkSegment;
	/** The new expected state: name it to chain a further change. */
	after: WorkRecordExpected;
	/** Present only when a resolution changed the work. */
	effects?: { workBalanceDirtyFromDate: string };
};

export type WorkRepair = {
	kind: "repaired";
	/** The pair exactly as it was locked. */
	source: {
		revision: number;
		/** Whether the work period linked its canonical work record. */
		linked: boolean;
		/** Whether the canonical work record had its work detail. */
		detail: boolean;
		/** The facets on which the stored pair disagreed. */
		disagreements: RecordAgreementFacet[];
	};
	/** The repaired work. */
	segment: WorkSegment;
	after: WorkRecordExpected;
	effects: { workBalanceDirtyFromDate: string };
};

/** The canonical work record of the work, linked or of the work period's own id, locked. */
async function lockedCanonical(
	tx: WorkTransactionClient,
	period: WorkPeriodRow,
): Promise<
	(Omit<CanonicalWorkRows, "detail"> & { detail: CanonicalWorkRows["detail"] | null }) | null
> {
	const recordId = period.canonicalRecordId ?? period.id;
	const [record] = await tx
		.select()
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, recordId),
				eq(timeRecord.organizationId, period.organizationId),
				eq(timeRecord.employeeId, period.employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.for("update");
	if (!record) return null;
	const [detail] = await tx
		.select()
		.from(timeRecordWork)
		.where(
			and(
				eq(timeRecordWork.recordId, recordId),
				eq(timeRecordWork.organizationId, period.organizationId),
				eq(timeRecordWork.recordKind, "work"),
			),
		)
		.for("update");
	const allocations = await tx
		.select()
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.recordId, recordId),
				eq(timeRecordAllocation.organizationId, period.organizationId),
			),
		)
		.orderBy(asc(timeRecordAllocation.id))
		.for("update");
	return { record, detail: detail ?? null, allocations };
}

/** Work and its records touching a closed month are frozen, before or after (#762). */
async function closedMonthOf(
	tx: WorkTransactionClient,
	change: { organizationId: string; employeeId: string },
	intervals: WorkInterval[],
): Promise<WorkRecordRefusal | null> {
	const closed = closedRangeTouchedByWork(intervals, await closedRangesForEmployee(tx, change));
	return closed ? { kind: "month_closed", month: closed.month } : null;
}

export async function attachWorkRecord(
	scope: SealedWorkTransactionScope,
	change: AttachWorkRecord,
): Promise<WorkAttachment | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	const locked = await lockedWork(scope, change);
	if ("kind" in locked) return locked;
	const tx = scope.db;
	const { period, clockIn, clockOut } = locked;
	const recordId = change.record.id ?? period.id;
	if (period.canonicalRecordId !== null) return { kind: "canonical_record_present" };
	const [existing] = await tx
		.select({ id: timeRecord.id })
		.from(timeRecord)
		.where(and(eq(timeRecord.id, recordId), eq(timeRecord.organizationId, organizationId)))
		.for("update");
	if (existing) return { kind: "canonical_record_present" };
	const resolution = change.resolution ?? {};
	const plan = planAttachment(period, {
		...resolution,
		attribution: resolution.attribution
			? await resolvedPatch(
					tx,
					{ organizationId, attribution: resolution.attribution },
					period.projectId,
				)
			: undefined,
	});
	if ("kind" in plan) return plan;
	const interval = { start: plan.result.startAt, end: plan.result.endAt };
	const closed = await closedMonthOf(tx, change, [interval]);
	if (closed) return closed;
	// Only a resolution that changes the period's minutes or attribution changes work.
	const changesWork = !periodStays(period, plan);

	// Writes: nothing below refuses.
	if (changesWork) {
		await sendBackChangedWork(tx, {
			organizationId,
			employeeId,
			causedByUserId: change.actorUserId,
			before: [interval],
			after: [interval],
		});
	}
	const now = new Date();
	const planned = plan.result.canonical;
	const [record] = await tx
		.insert(timeRecord)
		.values({
			id: recordId,
			organizationId,
			employeeId,
			recordKind: "work",
			startAt: planned.record.startAt,
			endAt: planned.record.endAt,
			durationMinutes: planned.record.durationMinutes,
			approvalState: planned.record.approvalState,
			origin: change.record.origin,
			createdBy: change.record.createdBy,
			updatedAt: now,
			updatedBy: change.actorUserId,
		})
		.returning();
	const [detail] = await tx
		.insert(timeRecordWork)
		.values({
			recordId,
			organizationId,
			recordKind: "work",
			workCategoryId: planned.detail.workCategoryId,
			workLocationType: planned.detail.workLocationType,
			computationMetadata: change.record.computationMetadata,
			vehicleKind: planned.detail.vehicleKind,
			vehicleId: planned.detail.vehicleId,
			odometerStartKm: planned.detail.odometerStartKm,
			odometerEndKm: planned.detail.odometerEndKm,
			drivenDistanceKm: planned.detail.drivenDistanceKm,
		})
		.returning();
	if (!record || !detail)
		throw new CompletedWorkIntegrityError("Canonical work record insert failed");
	const allocations = await insertAllocations(tx, organizationId, recordId, planned.allocations);
	const written = await writeRepairedPeriod(tx, {
		period,
		plan,
		canonicalRecordId: recordId,
		updatedAt: now,
	});
	const pair = { period: written, record, detail, allocations };
	assertWrittenAgreement(pair);
	await linkLegacyApprovalHistory(tx, { organizationId, workPeriodId: period.id, recordId });
	const effects = changesWork
		? await applyWrittenWorkEffects(tx, {
				organizationId,
				employeeId,
				writtenStarts: [{ at: plan.result.startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes }],
			})
		: null;
	return {
		kind: "attached",
		segment: segmentOf(written, pair, plan, { clockIn, clockOut }),
		after: expectedOf(written),
		...(effects ? { effects } : {}),
	};
}

/**
 * The work period's legacy approval requests: each becomes a decision on the
 * attached canonical work record and links to it, for every caller of attach
 * (the deploy and lazy backfills, reopening a month, gap and field repairs).
 */
async function linkLegacyApprovalHistory(
	tx: WorkTransactionClient,
	input: { organizationId: string; workPeriodId: string; recordId: string },
): Promise<void> {
	const requests = await tx
		.select()
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.workPeriodId),
			),
		)
		.orderBy(asc(approvalRequest.createdAt), asc(approvalRequest.id));
	if (requests.length === 0) return;
	await tx.insert(timeRecordApprovalDecision).values(
		requests.map((request) => ({
			organizationId: input.organizationId,
			recordId: input.recordId,
			...legacyApprovalDecision(request),
		})),
	);
	await tx
		.update(approvalRequest)
		.set({ canonicalRecordId: input.recordId })
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				inArray(
					approvalRequest.id,
					requests.map(({ id }) => id),
				),
			),
		);
}

/** Whether the planned work keeps the period's minutes and attribution as stored. */
function periodStays(period: WorkPeriodRow, plan: RepairPlan): boolean {
	if (period.durationMinutes !== plan.result.durationMinutes) return false;
	try {
		return WorkAttribution.fromWorkPeriod(period).equals(plan.result.attribution);
	} catch (error) {
		// A period the resolution made representable changed.
		if (error instanceof UnrepresentableWorkAttributionError) return false;
		throw error;
	}
}

export async function repairWorkRecord(
	scope: SealedWorkTransactionScope,
	change: RepairWorkRecord,
): Promise<WorkRepair | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	const locked = await lockedWork(scope, change);
	if ("kind" in locked) return locked;
	const tx = scope.db;
	const { period, clockIn, clockOut } = locked;
	const canonical = await lockedCanonical(tx, period);
	if (!canonical) return { kind: "canonical_record_missing" };
	const linked = period.canonicalRecordId !== null;
	const { endAt } = change.resolution;
	if (period.endTime === null && (!endAt || !instantFromDate(clockOut.timestamp).equals(endAt))) {
		return { kind: "endpoint_entry_missing" };
	}
	if (period.endTime !== null && endAt && !instantFromDate(period.endTime).equals(endAt)) {
		return { kind: "interval_invalid" };
	}

	const patch = await resolvedPatch(
		tx,
		{ organizationId, attribution: change.resolution.attribution },
		period.projectId,
	);
	const plan = planRepair(
		period,
		{ ...canonical, linked },
		{ ...change.resolution, attribution: patch },
	);
	if ("kind" in plan) return plan;
	const intervals = (from: { startTime: Date; endTime: Date | null }) =>
		from.endTime ? [interval(from.startTime, from.endTime)] : [];
	const before = [
		...intervals(period),
		...intervals({ startTime: canonical.record.startAt, endTime: canonical.record.endAt }),
	];
	const after = { start: plan.result.startAt, end: plan.result.endAt };
	const closed = await closedMonthOf(tx, change, [...before, after]);
	if (closed) return closed;

	// Writes: nothing below refuses.
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: change.actorUserId,
		before,
		after: [after],
	});
	const now = new Date();
	const planned = plan.result.canonical;
	const [record] = await tx
		.update(timeRecord)
		.set({
			startAt: planned.record.startAt,
			endAt: planned.record.endAt,
			durationMinutes: planned.record.durationMinutes,
			updatedAt: now,
			updatedBy: change.actorUserId,
		})
		.where(
			and(
				eq(timeRecord.id, canonical.record.id),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.returning();
	if (!record) throw new CompletedWorkIntegrityError("Canonical work record update failed");
	const key = { organizationId: record.organizationId, recordId: record.id };
	const detail = canonical.detail
		? await writeCanonicalDetail(tx, key, canonical.detail, planned.detail)
		: await insertDetail(tx, record, planned.detail);
	const allocations = await replaceProjectAllocation(
		tx,
		key,
		canonical.allocations,
		planned.allocations,
	);
	const written = await writeRepairedPeriod(tx, {
		period,
		plan,
		canonicalRecordId: record.id,
		updatedAt: now,
	});
	const pair = { period: written, record, detail, allocations };
	assertWrittenAgreement(pair);
	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [
			{
				at: instantFromDate(canonical.record.startAt),
				utcOffsetMinutes: clockIn.utcOffsetMinutes,
			},
			{ at: plan.result.startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes },
		],
	});
	return {
		kind: "repaired",
		source: {
			revision: period.graphRevision,
			linked,
			detail: canonical.detail !== null,
			disagreements: plan.disagreements,
		},
		segment: segmentOf(written, pair, plan, { clockIn, clockOut }),
		after: expectedOf(written),
		effects,
	};
}

function interval(start: Date, end: Date): { start: Instant; end: Instant } {
	return { start: instantFromDate(start), end: instantFromDate(end) };
}

/** A record history left without its work detail gets it; no computation metadata is known. */
async function insertDetail(
	tx: WorkTransactionClient,
	record: CanonicalWorkRows["record"],
	planned: RepairPlan["result"]["canonical"]["detail"],
): Promise<CanonicalWorkRows["detail"]> {
	const [written] = await tx
		.insert(timeRecordWork)
		.values({
			recordId: record.id,
			organizationId: record.organizationId,
			recordKind: "work",
			workCategoryId: planned.workCategoryId,
			workLocationType: planned.workLocationType,
			computationMetadata: null,
			vehicleKind: planned.vehicleKind,
			vehicleId: planned.vehicleId,
			odometerStartKm: planned.odometerStartKm,
			odometerEndKm: planned.odometerEndKm,
			drivenDistanceKm: planned.drivenDistanceKm,
		})
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Canonical work detail insert failed");
	return written;
}

/**
 * The repaired work period: compare-and-set on its revision, which advances,
 * linked to its canonical work record, with the planned end, minutes and
 * attribution. Its endpoints never move.
 */
async function writeRepairedPeriod(
	tx: WorkTransactionClient,
	input: {
		period: WorkPeriodRow;
		plan: RepairPlan;
		canonicalRecordId: string;
		updatedAt: Date;
	},
): Promise<WorkPeriodRow> {
	const { period } = input;
	const columns = input.plan.result.period;
	const [written] = await tx
		.update(workPeriod)
		.set({
			canonicalRecordId: input.canonicalRecordId,
			endTime: columns.endTime,
			durationMinutes: columns.durationMinutes,
			projectId: columns.projectId,
			taskId: columns.taskId,
			isBillable: columns.isBillable,
			workCategoryId: columns.workCategoryId,
			workLocationType: columns.workLocationType,
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
			graphRevision: period.graphRevision + 1,
			updatedAt: input.updatedAt,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, period.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				eq(workPeriod.graphRevision, period.graphRevision),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Work period changed under its lock");
	return written;
}

function segmentOf(
	period: WorkPeriodRow,
	pair: CanonicalWorkRows,
	plan: RepairPlan,
	entries: { clockIn: TimeEntryRow; clockOut: TimeEntryRow },
): WorkSegment {
	return workSegment({
		workPeriodId: period.id,
		canonicalRecordId: pair.record.id,
		clockIn: entries.clockIn,
		clockOut: entries.clockOut,
		startAt: plan.result.startAt,
		endAt: plan.result.endAt,
		durationMinutes: plan.result.durationMinutes,
		attribution: plan.result.attribution,
		allocations: pair.allocations,
	});
}
