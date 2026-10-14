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
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { CompletedWorkIntegrityError } from "../close-active-work";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import { vehicleUseFromColumns } from "../vehicle-use/work-vehicle-use";
import { workVehicleUseSplitRefusal } from "../vehicle-use/work-vehicle-use-eligibility";
import { assertBillableAllowed, readProjectBillability } from "../work-billability";
import { loadWorkOccupants } from "../work-occupancy";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { DivideWorkRecord, WorkRecordExpected, WorkRecordRefusal } from "./change";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { entryWriterFor } from "./entry-writer";
import { type DivisionPlan, type PlannedHalf, planChange } from "./plan";
import { expectedOf, matchesExpected, pairOf } from "./read";
import { recordAgreement } from "./record-agreement";
import {
	type CanonicalWorkRows,
	selectWorkRecordRows,
	type TimeEntryRow,
	type WorkPeriodRow,
} from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import { type CanonicalAllocationShape, WorkAttribution } from "./work-attribution";

/** One appended entry with its exact predecessor, as receipts record it. */
export type AppendedEntryEvidence = {
	entryId: string;
	hash: string;
	previousEntryId: string | null;
	previousHash: string | null;
};

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
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const workPeriodId = change.expected.workPeriodId;
	const locked = await selectWorkRecordRows(
		tx,
		{ organizationId, employeeId, workPeriodId },
		{ lock: true },
	);
	if (!locked) return { kind: "not_found", workPeriodId };
	const { period, clockIn, clockOut, canonical } = locked;
	if (!matchesExpected(change.expected, period)) {
		return { kind: "stale", current: { revision: period.graphRevision } };
	}
	if (period.isActive || !period.endTime || !period.clockOutId) return { kind: "work_running" };
	if (!clockIn || !clockOut) return { kind: "endpoint_entry_missing" };
	if (clockIn.isSuperseded || clockOut.isSuperseded) return { kind: "endpoint_superseded" };

	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.appendOperation,
	});
	const plan = planChange(pairOf(locked), change, writer.durationArithmetic);
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
	await assertOverrideBillable(tx, change, plan);
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
			{ at: startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes ?? 0 },
			{ at: change.at, utcOffsetMinutes: newClockIn.utcOffsetMinutes ?? 0 },
		],
		dividedOff: [{ sourceWorkPeriodId: period.id, newWorkPeriodId: generated.period.id }],
	});
	const decisions = await tx
		.select({ id: timeRecordApprovalDecision.id })
		.from(timeRecordApprovalDecision)
		.where(
			and(
				eq(timeRecordApprovalDecision.organizationId, organizationId),
				eq(timeRecordApprovalDecision.recordId, canonical.record.id),
			),
		)
		.orderBy(asc(timeRecordApprovalDecision.createdAt), asc(timeRecordApprovalDecision.id));

	return {
		kind: "divided",
		at: change.at,
		source: {
			segment: workSegment({
				workPeriodId: period.id,
				canonicalRecordId: canonical.record.id,
				clockIn,
				clockOut,
				startAt,
				endAt,
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
		},
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

/** A billable override must name a project that has a customer to bill. */
async function assertOverrideBillable(
	tx: WorkTransactionClient,
	change: DivideWorkRecord,
	plan: DivisionPlan,
): Promise<void> {
	const override = change.attribution;
	if (override?.patch.billable !== true) return;
	const project = plan[override.half].attribution.project;
	assertBillableAllowed(
		await readProjectBillability(tx, change.organizationId, project?.projectId ?? null),
	);
}

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
				eq(timeEntry.isSuperseded, false),
			),
		)
		.returning({ id: timeEntry.id });
	if (updated.length !== 1) throw new CompletedWorkIntegrityError("Source clock-out changed");
}

type WrittenPair = { period: WorkPeriodRow } & CanonicalWorkRows;

/**
 * The retained half keeps the work period, its clock-in and its canonical work
 * record; it ends at the new clock-out. Compare-and-set on the revision, which
 * advances.
 */
async function writeRetainedHalf(
	tx: WorkTransactionClient,
	input: {
		period: WorkPeriodRow;
		canonical: CanonicalWorkRows;
		half: PlannedHalf;
		clockOut: TimeEntryRow;
		updatedAt: Date;
		updatedBy: string | null;
	},
): Promise<WrittenPair> {
	const { period, canonical, half } = input;
	const columns = half.period;
	const [written] = await tx
		.update(workPeriod)
		.set({
			clockOutId: input.clockOut.id,
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

	let detail = canonical.detail;
	const plannedDetail = half.canonical.detail;
	if (
		!WorkAttribution.fromCanonical(detail, []).equals(
			WorkAttribution.fromCanonical(plannedDetail, []),
		)
	) {
		const [writtenDetail] = await tx
			.update(timeRecordWork)
			.set({
				workCategoryId: plannedDetail.workCategoryId,
				workLocationType: plannedDetail.workLocationType,
				vehicleKind: plannedDetail.vehicleKind,
				vehicleId: plannedDetail.vehicleId,
				odometerStartKm: plannedDetail.odometerStartKm,
				odometerEndKm: plannedDetail.odometerEndKm,
				drivenDistanceKm: plannedDetail.drivenDistanceKm,
			})
			.where(
				and(
					eq(timeRecordWork.recordId, canonical.record.id),
					eq(timeRecordWork.organizationId, period.organizationId),
					eq(timeRecordWork.recordKind, "work"),
				),
			)
			.returning();
		if (!writtenDetail) {
			throw new CompletedWorkIntegrityError("Canonical work detail update failed");
		}
		detail = writtenDetail;
	}

	let allocations = canonical.allocations;
	if (!sameAllocations(allocations, half.canonical.allocations)) {
		// Only the project allocation is attribution; cost-centre rows stay as they are.
		await tx
			.delete(timeRecordAllocation)
			.where(
				and(
					eq(timeRecordAllocation.recordId, canonical.record.id),
					eq(timeRecordAllocation.organizationId, period.organizationId),
					eq(timeRecordAllocation.allocationKind, "project"),
				),
			);
		const inserted = await insertAllocations(
			tx,
			period.organizationId,
			canonical.record.id,
			half.canonical.allocations.filter(({ allocationKind }) => allocationKind === "project"),
		);
		allocations = [
			...allocations.filter(({ allocationKind }) => allocationKind !== "project"),
			...inserted,
		];
	}
	return { period: written, record: writtenRecord, detail, allocations };
}

/**
 * The generated half: a new canonical work record (keeping the source's
 * origin, approval state and recording actor) and a new work period from the
 * new clock-in to the source clock-out, at revision 1.
 */
async function writeGeneratedHalf(
	tx: WorkTransactionClient,
	input: {
		period: WorkPeriodRow;
		canonical: CanonicalWorkRows;
		half: PlannedHalf;
		clockIn: TimeEntryRow;
		updatedAt: Date;
		updatedBy: string | null;
	},
): Promise<WrittenPair> {
	const { period, canonical, half } = input;
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
			workCategoryId: columns.workCategoryId,
			workLocationType: columns.workLocationType,
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
			canonicalRecordId: recordId,
			graphRevision: 1,
			updatedAt: input.updatedAt,
		})
		.returning();
	if (!record || !detail || !written) {
		throw new CompletedWorkIntegrityError("Generated work insert failed");
	}
	return { period: written, record, detail, allocations };
}

async function insertAllocations(
	tx: WorkTransactionClient,
	organizationId: string,
	recordId: string,
	allocations: readonly CanonicalAllocationShape[],
): Promise<CanonicalWorkRows["allocations"]> {
	const written: CanonicalWorkRows["allocations"] = [];
	for (const allocation of allocations) {
		const [row] = await tx
			.insert(timeRecordAllocation)
			.values({
				organizationId,
				recordId,
				allocationKind: allocation.allocationKind,
				projectId: allocation.projectId,
				taskId: allocation.taskId,
				costCenterId: allocation.costCenterId,
				weightPercent: allocation.weightPercent,
				isBillable: allocation.isBillable,
			})
			.returning();
		if (!row) throw new CompletedWorkIntegrityError("Canonical allocation insert failed");
		written.push(row);
	}
	return written;
}

/** The written rows must agree; anything else is a defect of work records. */
function assertWrittenAgreement(written: WrittenPair): void {
	const agreement = recordAgreement(written.period, written);
	if (!agreement.agrees) {
		throw new CompletedWorkIntegrityError(
			`Work records wrote a pair that disagrees on ${agreement.disagreements.join(", ")}`,
		);
	}
}

function sameAllocations(
	stored: readonly CanonicalAllocationShape[],
	planned: readonly CanonicalAllocationShape[],
): boolean {
	const key = (allocation: CanonicalAllocationShape) =>
		[
			allocation.allocationKind,
			allocation.projectId,
			allocation.taskId,
			allocation.costCenterId,
			allocation.weightPercent,
			allocation.isBillable,
		].join("|");
	const left = stored.map(key).sort();
	const right = planned.map(key).sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function dividedHalf(
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

function appendedEvidence(entry: TimeEntryRow): AppendedEntryEvidence {
	return {
		entryId: entry.id,
		hash: entry.hash,
		previousEntryId: entry.previousEntryId,
		previousHash: entry.previousHash,
	};
}
