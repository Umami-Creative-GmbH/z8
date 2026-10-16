import "server-only";

/**
 * Dividing completed work at an instant (ADR 0010): the work period and its
 * canonical work record are divided together, in either admission's entry
 * writer, with the effects of the change. Runs on a sealed work-transaction
 * scope only; it never opens a transaction and never takes guards.
 *
 * Every refusal is decided before the first write, so a refused division
 * writes nothing. A pair that still disagrees after the writes is a defect in
 * work records, not in the data: it throws and the transaction rolls back.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
	timeEntry,
	timeRecord,
	timeRecordApprovalDecision,
	timeRecordWork,
	type WorkPeriodAutoAdjustmentReason,
	workPeriod,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import { vehicleUseFromColumns } from "../vehicle-use/work-vehicle-use";
import { workVehicleUseSplitRefusal } from "../vehicle-use/work-vehicle-use-eligibility";
import { loadWorkOccupants } from "../work-occupancy";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import { resolvedPatch } from "./amend";
import type { DivideWorkRecord, WorkRecordExpected, WorkRecordRefusal } from "./change";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { entryWriterFor } from "./entry-writer";
import { CompletedWorkIntegrityError } from "./integrity";
import {
	type AppendedEntryEvidence,
	appendedEvidence,
	assertWrittenAgreement,
	insertAllocations,
	lockedCompletedWork,
	type WrittenPair,
	writeCanonicalAttribution,
} from "./pair-writer";
import { type PlannedHalf, planChange } from "./plan";
import { expectedOf, pairOf } from "./read";
import type { CanonicalWorkRows, TimeEntryRow, WorkPeriodRow } from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import { WorkAttribution } from "./work-attribution";

export type DividedHalf = {
	segment: WorkSegment;
	/** The half's new expected state: name it to chain a further change. */
	after: WorkRecordExpected;
};

export type WorkDivision = {
	kind: "divided";
	at: DivideWorkRecord["at"];
	/** The source exactly as it was locked. */
	source: {
		segment: WorkSegment;
		revision: number;
		approvalState: WorkPeriodRow["approvalStatus"];
		recordApprovalState: CanonicalWorkRows["record"]["approvalState"];
		recordCreatedBy: string;
		/** The source clock-out's notes before the change. */
		clockOutNotes: string | null;
		/** Decisions recorded on the source's canonical work record, oldest first. */
		decisionIds: string[];
	};
	retained: DividedHalf;
	generated: DividedHalf;
	appended: {
		admission: "append" | "legacy";
		clockOut: AppendedEntryEvidence;
		clockIn: AppendedEntryEvidence;
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function divideWorkRecord(
	scope: SealedWorkTransactionScope,
	change: DivideWorkRecord,
): Promise<WorkDivision | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	const locked = await lockedCompletedWork(scope, change);
	if ("kind" in locked) return locked;
	const tx = scope.db;
	const workPeriodId = change.expected.workPeriodId;
	const { period, clockIn, clockOut, canonical } = locked;

	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.appendOperation,
	});
	// An override's project takes its billable default, read here as an amendment reads it.
	const override = change.attribution;
	const plan = planChange(
		pairOf(locked),
		{
			kind: "divide",
			at: change.at,
			odometerKm: change.odometerKm,
			...(override
				? {
						attribution: {
							half: override.half,
							patch:
								(await resolvedPatch(
									tx,
									{ organizationId, attribution: override.patch },
									period.projectId,
								)) ?? {},
						},
					}
				: {}),
		},
		writer.durationArithmetic,
	);
	if (plan.kind !== "divide") return plan;
	if (!canonical) return { kind: "canonical_record_missing" };

	// What the database says against the plan.
	const vehicleRefusal = await workVehicleUseSplitRefusal(tx, {
		organizationId,
		employeeId,
		workPeriodId,
		use: vehicleUseFromColumns(period),
		value: change.odometerKm,
	});
	if (vehicleRefusal) return { kind: "vehicle_use_refused", code: vehicleRefusal };
	const startAt = instantFromDate(period.startTime);
	const endAt = instantFromDate(period.endTime);
	// Symmetric occupancy: the halves cover the source, against every other work.
	const occupants = await loadWorkOccupants(tx, {
		organizationId,
		employeeId,
		interval: { startAt, endAt },
		excludeWorkPeriodIds: [period.id],
	});
	if (occupants.length > 0) return { kind: "work_occupied", occupants };
	// Dividing work that touches a closed month changes it (#762).
	const closed = closedRangeTouchedByWork(
		[{ start: startAt, end: endAt }],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };
	const admission = await writer.admit();
	if (admission.kind === "review_required") {
		return { kind: "append_review_required", requirement: admission.requirement };
	}

	// Writes: nothing below refuses.
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: change.actorUserId,
		before: [{ start: startAt, end: endAt }],
		after: [plan.retained, plan.generated].map((half) => ({
			start: half.startAt,
			end: half.endAt,
		})),
	});
	// The generated half keeps the source clock-out, whose notes its period shows;
	// notes are not part of the entry hash.
	if (change.notes.after !== null) {
		await replaceClockOutNotes(tx, clockOut, change.notes.after);
	}
	const [newClockOut, newClockIn] = await admission.entries.append([
		{
			type: "clock_out",
			at: change.at,
			notes: change.notes.before,
			provenance: change.entries,
			takesOverFrom: clockOut,
		},
		{ type: "clock_in", at: change.at, notes: change.notes.after, provenance: change.entries },
	]);
	if (!newClockOut || !newClockIn) throw new Error("Work records entries were not appended");
	const updatedAt = new Date();
	const retained = await writeRetainedHalf(tx, {
		period,
		canonical,
		half: plan.retained,
		clockOut: newClockOut,
		updatedAt,
		updatedBy: change.actorUserId,
	});
	const generated = await writeGeneratedHalf(tx, {
		period,
		canonical,
		half: plan.generated,
		clockIn: newClockIn,
		updatedAt,
		updatedBy: change.actorUserId,
	});
	for (const written of [retained, generated]) assertWrittenAgreement(written);

	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [
			{ at: startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes },
			{ at: change.at, utcOffsetMinutes: newClockIn.utcOffsetMinutes },
		],
		dividedOff: [{ sourceWorkPeriodId: period.id, newWorkPeriodId: generated.period.id }],
	});

	return {
		kind: "divided",
		at: change.at,
		source: await divisionSource(tx, { period, clockIn, clockOut, canonical }),
		retained: dividedHalf(retained, plan.retained, { clockIn, clockOut: newClockOut }),
		generated: dividedHalf(generated, plan.generated, { clockIn: newClockIn, clockOut }),
		appended: {
			admission: writer.admission,
			clockOut: appendedEvidence(newClockOut),
			clockIn: appendedEvidence(newClockIn),
		},
		effects,
	};
}

/** The divided source exactly as it was locked, with the decisions on its record. */
export async function divisionSource(
	tx: WorkTransactionClient,
	locked: {
		period: WorkPeriodRow;
		clockIn: TimeEntryRow;
		clockOut: TimeEntryRow;
		canonical: CanonicalWorkRows;
	},
): Promise<WorkDivision["source"]> {
	const { period, clockIn, clockOut, canonical } = locked;
	if (!period.endTime) throw new CompletedWorkIntegrityError("Divided work has no end");
	const decisions = await tx
		.select({ id: timeRecordApprovalDecision.id })
		.from(timeRecordApprovalDecision)
		.where(
			and(
				eq(timeRecordApprovalDecision.organizationId, period.organizationId),
				eq(timeRecordApprovalDecision.recordId, canonical.record.id),
			),
		)
		.orderBy(asc(timeRecordApprovalDecision.createdAt), asc(timeRecordApprovalDecision.id));
	return {
		segment: workSegment({
			workPeriodId: period.id,
			canonicalRecordId: canonical.record.id,
			clockIn,
			clockOut,
			startAt: instantFromDate(period.startTime),
			endAt: instantFromDate(period.endTime),
			durationMinutes: period.durationMinutes ?? 0,
			attribution: WorkAttribution.fromWorkPeriod(period),
			allocations: canonical.allocations,
		}),
		revision: period.graphRevision,
		approvalState: period.approvalStatus,
		recordApprovalState: canonical.record.approvalState,
		recordCreatedBy: canonical.record.createdBy,
		clockOutNotes: clockOut.notes ?? null,
		decisionIds: decisions.map(({ id }) => id),
	};
}

/**
 * The source clock-out's notes, compare-and-set on its supersession as locked: a
 * legacy split's generated half keeps a clock-out an earlier split superseded.
 */
async function replaceClockOutNotes(
	tx: WorkTransactionClient,
	entry: TimeEntryRow,
	notes: string,
): Promise<void> {
	const updated = await tx
		.update(timeEntry)
		.set({ notes })
		.where(
			and(
				eq(timeEntry.id, entry.id),
				eq(timeEntry.organizationId, entry.organizationId),
				eq(timeEntry.employeeId, entry.employeeId),
				eq(timeEntry.isSuperseded, entry.isSuperseded),
			),
		)
		.returning({ id: timeEntry.id });
	if (updated.length !== 1) throw new CompletedWorkIntegrityError("Source clock-out changed");
}

/**
 * The retained half keeps the work period, its clock-in and its canonical work
 * record; it ends at the new clock-out. Compare-and-set on the revision, which
 * advances. With `autoAdjustment` (an owed break) the work period is marked
 * auto-adjusted and keeps its original end and minutes.
 */
export async function writeRetainedHalf(
	tx: WorkTransactionClient,
	input: {
		period: WorkPeriodRow;
		canonical: CanonicalWorkRows;
		half: PlannedHalf;
		clockOut: TimeEntryRow;
		updatedAt: Date;
		updatedBy: string | null;
		autoAdjustment?: WorkPeriodAutoAdjustmentReason;
	},
): Promise<WrittenPair> {
	const { period, canonical, half } = input;
	const columns = half.period;
	const adjusted = input.autoAdjustment;
	const [written] = await tx
		.update(workPeriod)
		.set({
			wasAutoAdjusted: adjusted ? true : undefined,
			autoAdjustmentReason: adjusted,
			autoAdjustedAt: adjusted ? input.updatedAt : undefined,
			originalEndTime: adjusted ? period.endTime : undefined,
			originalDurationMinutes: adjusted ? period.durationMinutes : undefined,
			clockOutId: input.clockOut.id,
			endTime: columns.endTime,
			durationMinutes: columns.durationMinutes,
			projectId: columns.projectId,
			taskId: columns.taskId,
			isBillable: columns.isBillable,
			missingTask: columns.missingTask,
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

	const record = half.canonical.record;
	const [writtenRecord] = await tx
		.update(timeRecord)
		.set({
			endAt: record.endAt,
			durationMinutes: record.durationMinutes,
			updatedAt: input.updatedAt,
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, canonical.record.id),
				eq(timeRecord.organizationId, period.organizationId),
				eq(timeRecord.employeeId, period.employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.returning();
	if (!writtenRecord) throw new CompletedWorkIntegrityError("Canonical work record update failed");

	const { detail, allocations } = await writeCanonicalAttribution(tx, {
		organizationId: period.organizationId,
		recordId: canonical.record.id,
		stored: canonical,
		planned: half.canonical,
	});
	return { period: written, record: writtenRecord, detail, allocations };
}

/**
 * The generated half: a new canonical work record (keeping the source's
 * origin, approval state and recording actor) and a new work period from the
 * new clock-in to the source clock-out, at revision 1, marked auto-adjusted
 * with `autoAdjustment`.
 */
export async function writeGeneratedHalf(
	tx: WorkTransactionClient,
	input: {
		period: WorkPeriodRow;
		canonical: CanonicalWorkRows;
		half: PlannedHalf;
		clockIn: TimeEntryRow;
		updatedAt: Date;
		updatedBy: string | null;
		autoAdjustment?: WorkPeriodAutoAdjustmentReason;
	},
): Promise<WrittenPair> {
	const { period, canonical, half } = input;
	const adjusted = input.autoAdjustment;
	const recordId = randomUUID();
	const [record] = await tx
		.insert(timeRecord)
		.values({
			id: recordId,
			organizationId: period.organizationId,
			employeeId: period.employeeId,
			recordKind: "work",
			startAt: half.canonical.record.startAt,
			endAt: half.canonical.record.endAt,
			durationMinutes: half.canonical.record.durationMinutes,
			approvalState: canonical.record.approvalState,
			origin: canonical.record.origin,
			createdBy: canonical.record.createdBy,
			updatedAt: input.updatedAt,
			updatedBy: input.updatedBy,
		})
		.returning();
	const detailColumns = half.canonical.detail;
	const [detail] = await tx
		.insert(timeRecordWork)
		.values({
			recordId,
			organizationId: period.organizationId,
			recordKind: "work",
			workCategoryId: detailColumns.workCategoryId,
			workLocationType: detailColumns.workLocationType,
			computationMetadata: canonical.detail.computationMetadata,
			vehicleKind: detailColumns.vehicleKind,
			vehicleId: detailColumns.vehicleId,
			odometerStartKm: detailColumns.odometerStartKm,
			odometerEndKm: detailColumns.odometerEndKm,
			drivenDistanceKm: detailColumns.drivenDistanceKm,
		})
		.returning();
	const allocations = await insertAllocations(
		tx,
		period.organizationId,
		recordId,
		half.canonical.allocations,
	);
	const columns = half.period;
	const [written] = await tx
		.insert(workPeriod)
		.values({
			organizationId: period.organizationId,
			employeeId: period.employeeId,
			clockInId: input.clockIn.id,
			clockOutId: period.clockOutId,
			startTime: columns.startTime,
			endTime: columns.endTime,
			durationMinutes: columns.durationMinutes,
			isActive: false,
			approvalStatus: columns.approvalStatus,
			projectId: columns.projectId,
			taskId: columns.taskId,
			isBillable: columns.isBillable,
			missingTask: columns.missingTask,
			workCategoryId: columns.workCategoryId,
			workLocationType: columns.workLocationType,
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
			canonicalRecordId: recordId,
			graphRevision: 1,
			wasAutoAdjusted: adjusted ? true : undefined,
			autoAdjustmentReason: adjusted,
			autoAdjustedAt: adjusted ? input.updatedAt : undefined,
			updatedAt: input.updatedAt,
		})
		.returning();
	if (!record || !detail || !written) {
		throw new CompletedWorkIntegrityError("Generated work insert failed");
	}
	return { period: written, record, detail, allocations };
}

export function dividedHalf(
	written: WrittenPair,
	half: PlannedHalf,
	entries: { clockIn: TimeEntryRow; clockOut: TimeEntryRow },
): DividedHalf {
	return {
		segment: workSegment({
			workPeriodId: written.period.id,
			canonicalRecordId: written.record.id,
			clockIn: entries.clockIn,
			clockOut: entries.clockOut,
			startAt: half.startAt,
			endAt: half.endAt,
			durationMinutes: half.durationMinutes,
			attribution: half.attribution,
			allocations: written.allocations,
		}),
		after: expectedOf(written.period),
	};
}
