import "server-only";

/**
 * The pieces every work records operation writes a pair with (ADR 0010): the
 * locked completed work it starts from, the canonical work record's attribution
 * (detail and project allocation), the allocation inserts, the agreement check
 * on what was written and the evidence of an appended entry. One copy each, so
 * a new detail column or attribution part reaches every operation at once.
 */
import { and, eq } from "drizzle-orm";
import { timeRecordAllocation, timeRecordWork } from "@/db/schema";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { WorkRecordExpected, WorkRecordRefusal } from "./change";
import { CompletedWorkIntegrityError } from "./integrity";
import { matchesExpected } from "./read";
import { recordAgreement } from "./record-agreement";
import {
	type CanonicalWorkRows,
	selectWorkRecordRows,
	type TimeEntryRow,
	type WorkPeriodRow,
	type WorkRecordRows,
} from "./rows";
import {
	type CanonicalAllocationShape,
	type CanonicalWorkDetailColumns,
	WorkAttribution,
} from "./work-attribution";

type ChangeKey = { organizationId: string; employeeId: string; expected: WorkRecordExpected };

/** Work locked for a repair: its clock-out recorded, its period's end perhaps not. */
export type LockedWork = WorkRecordRows & { clockIn: TimeEntryRow; clockOut: TimeEntryRow };

/** Completed work locked for a change, with its end and both endpoint entries. */
export type LockedCompletedWork = LockedWork & { period: WorkPeriodRow & { endTime: Date } };

/**
 * Locks the work period of the change with its entries and canonical work
 * record (`WORK_RECORD_LOCK_ORDER`), or returns the refusal that stops the change
 * first: not found, stale, running work, a missing endpoint entry, or a
 * superseded endpoint in append admission (corrected by someone else). In
 * legacy admission a split's generated half keeps the source clock-out its new
 * clock-out superseded (#1219); it still ends that half, so it may change.
 */
export async function lockedCompletedWork(
	scope: SealedWorkTransactionScope,
	change: ChangeKey,
): Promise<LockedCompletedWork | WorkRecordRefusal> {
	const work = await locked(scope, change, { endRequired: true });
	if ("kind" in work) return work;
	const { clockIn, clockOut } = work;
	if (scope.admission === "append" && (clockIn.isSuperseded || clockOut.isSuperseded)) {
		return { kind: "endpoint_superseded" };
	}
	return work as LockedCompletedWork;
}

/**
 * The same lock for a repair, which never moves an endpoint: work whose period
 * recorded no end may still be given the end its clock-out entry records.
 */
export function lockedWork(
	scope: SealedWorkTransactionScope,
	change: ChangeKey,
): Promise<LockedWork | WorkRecordRefusal> {
	return locked(scope, change, { endRequired: false });
}

async function locked(
	scope: SealedWorkTransactionScope,
	change: ChangeKey,
	options: { endRequired: boolean },
): Promise<LockedWork | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	scope.assertEmployee(organizationId, employeeId);
	const workPeriodId = change.expected.workPeriodId;
	const rows = await selectWorkRecordRows(
		scope.db,
		{ organizationId, employeeId, workPeriodId },
		{ lock: true },
	);
	if (!rows) return { kind: "not_found", workPeriodId };
	const { period, clockIn, clockOut } = rows;
	if (!matchesExpected(change.expected, period)) {
		return { kind: "stale", current: { revision: period.graphRevision } };
	}
	if (period.isActive || (options.endRequired && !period.endTime) || !period.clockOutId) {
		return { kind: "work_running" };
	}
	if (!clockIn || !clockOut) return { kind: "endpoint_entry_missing" };
	return { ...rows, clockIn, clockOut };
}

/** One appended entry with its exact predecessor, as receipts record it. */
export type AppendedEntryEvidence = {
	entryId: string;
	hash: string;
	previousEntryId: string | null;
	previousHash: string | null;
};

export function appendedEvidence(entry: TimeEntryRow): AppendedEntryEvidence {
	return {
		entryId: entry.id,
		hash: entry.hash,
		previousEntryId: entry.previousEntryId,
		previousHash: entry.previousHash,
	};
}

/** A work period and its canonical work record as written. */
export type WrittenPair = { period: WorkPeriodRow } & CanonicalWorkRows;

/** The written rows must agree; anything else is a defect of work records. */
export function assertWrittenAgreement(written: WrittenPair): void {
	const agreement = recordAgreement(written.period, written);
	if (!agreement.agrees) {
		throw new CompletedWorkIntegrityError(
			`Work records wrote a pair that disagrees on ${agreement.disagreements.join(", ")}`,
		);
	}
}

export async function insertAllocations(
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

/**
 * An existing canonical work record's work attribution, as planned: its detail
 * changes only when the detail's attribution does, and its project allocation is
 * replaced only when the allocations differ. Cost-centre allocations are not
 * attribution and stay as they are.
 */
export async function writeCanonicalAttribution(
	tx: WorkTransactionClient,
	input: {
		organizationId: string;
		recordId: string;
		stored: Pick<CanonicalWorkRows, "detail" | "allocations">;
		planned: {
			detail: CanonicalWorkDetailColumns;
			allocations: readonly CanonicalAllocationShape[];
		};
	},
): Promise<Pick<CanonicalWorkRows, "detail" | "allocations">> {
	const { organizationId, recordId, stored, planned } = input;
	return {
		detail: await writeCanonicalDetail(
			tx,
			{ organizationId, recordId },
			stored.detail,
			planned.detail,
		),
		allocations: await replaceProjectAllocation(
			tx,
			{ organizationId, recordId },
			stored.allocations,
			planned.allocations,
		),
	};
}

/** The detail as planned, updated only when its attribution differs. */
export async function writeCanonicalDetail(
	tx: WorkTransactionClient,
	key: { organizationId: string; recordId: string },
	stored: CanonicalWorkRows["detail"],
	planned: CanonicalWorkDetailColumns,
): Promise<CanonicalWorkRows["detail"]> {
	if (
		WorkAttribution.fromCanonical(stored, []).equals(WorkAttribution.fromCanonical(planned, []))
	) {
		return stored;
	}
	const [written] = await tx
		.update(timeRecordWork)
		.set({
			workCategoryId: planned.workCategoryId,
			workLocationType: planned.workLocationType,
			vehicleKind: planned.vehicleKind,
			vehicleId: planned.vehicleId,
			odometerStartKm: planned.odometerStartKm,
			odometerEndKm: planned.odometerEndKm,
			drivenDistanceKm: planned.drivenDistanceKm,
		})
		.where(
			and(
				eq(timeRecordWork.recordId, key.recordId),
				eq(timeRecordWork.organizationId, key.organizationId),
				eq(timeRecordWork.recordKind, "work"),
			),
		)
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Canonical work detail update failed");
	return written;
}

/**
 * The project allocation as planned, replaced only when the allocations differ.
 * Only the project allocation is attribution; cost-centre rows stay as they are.
 */
export async function replaceProjectAllocation(
	tx: WorkTransactionClient,
	key: { organizationId: string; recordId: string },
	stored: CanonicalWorkRows["allocations"],
	planned: readonly CanonicalAllocationShape[],
): Promise<CanonicalWorkRows["allocations"]> {
	if (sameAllocations(stored, planned)) return stored;
	await tx
		.delete(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.recordId, key.recordId),
				eq(timeRecordAllocation.organizationId, key.organizationId),
				eq(timeRecordAllocation.allocationKind, "project"),
			),
		);
	const inserted = await insertAllocations(
		tx,
		key.organizationId,
		key.recordId,
		planned.filter(({ allocationKind }) => allocationKind === "project"),
	);
	return [...stored.filter(({ allocationKind }) => allocationKind !== "project"), ...inserted];
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
