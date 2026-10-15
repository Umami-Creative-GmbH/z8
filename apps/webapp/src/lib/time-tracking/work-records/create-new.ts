import "server-only";

/**
 * Creating new completed work (ADR 0010, #1223) in either admission's entry
 * writer, with the effects of the change: a manual entry, imported work and demo
 * data. Runs on a sealed work-transaction scope only; it never opens a
 * transaction and never takes guards.
 *
 * Every refusal is decided before the first write, so a refused creation writes
 * nothing. A pair that disagrees after the writes is a defect in work records:
 * it throws and the transaction rolls back.
 */
import { workPeriod } from "@/db/schema";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import { loadWorkOccupants } from "../work-occupancy";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { WorkRecordExpected, WorkRecordRefusal } from "./change";
import { insertCanonicalRecord } from "./create";
import { type CreateNewWork, planNewWork } from "./create-new-plan";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { entryWriterFor } from "./entry-writer";
import { CompletedWorkIntegrityError } from "./integrity";
import {
	type AppendedEntryEvidence,
	appendedEvidence,
	assertWrittenAgreement,
} from "./pair-writer";
import type { PlannedHalf } from "./plan";
import { expectedOf } from "./read";
import type { TimeEntryRow, WorkPeriodRow } from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import type { WorkAttribution } from "./work-attribution";

export type NewWorkCreation = {
	kind: "created";
	/** The new completed work as written. */
	segment: WorkSegment;
	attribution: WorkAttribution;
	/** The new work's expected state: name it to chain a further change. */
	after: WorkRecordExpected;
	appended: {
		admission: "append" | "legacy";
		clockIn: AppendedEntryEvidence;
		clockOut: AppendedEntryEvidence;
		/** The appended entries as written, clock-in first. */
		entries: [TimeEntryRow, TimeEntryRow];
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function createNewWorkRecord(
	scope: SealedWorkTransactionScope,
	change: CreateNewWork,
): Promise<NewWorkCreation | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.appendOperation,
	});
	const plan = planNewWork(change, writer.durationArithmetic);
	if (plan.kind !== "create_new") return plan;
	const { completed } = plan;
	const occupants = await loadWorkOccupants(tx, {
		organizationId,
		employeeId,
		interval: { startAt: completed.startAt, endAt: completed.endAt },
		excludeWorkPeriodIds: [],
	});
	if (occupants.length > 0) return { kind: "work_occupied", occupants };
	const work = { start: completed.startAt, end: completed.endAt };
	// New work touching a closed month changes it (#762).
	const closed = closedRangeTouchedByWork(
		[work],
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
		before: [],
		after: [work],
	});
	const [clockIn, clockOut] = await admission.entries.append(
		(["start", "end"] as const).map((endpoint) => ({
			type: endpoint === "start" ? ("clock_in" as const) : ("clock_out" as const),
			at: change[endpoint].at,
			notes: change[endpoint].notes,
			provenance: { ...change.entries, capture: change[endpoint].capture },
		})),
	);
	if (!clockIn || !clockOut) throw new Error("Work records entries were not appended");
	const canonical = await insertCanonicalRecord(tx, {
		organizationId,
		employeeId,
		half: completed,
		origin: change.origin,
		recordedBy: change.recordedBy,
		computationMetadata: change.computationMetadata ?? null,
	});
	const written = await insertNewWorkPeriod(tx, {
		change,
		half: completed,
		clockIn,
		clockOut,
		canonicalRecordId: canonical.record.id,
	});
	assertWrittenAgreement({ period: written, ...canonical });

	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [{ at: completed.startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes }],
	});
	return {
		kind: "created",
		segment: workSegment({
			workPeriodId: written.id,
			canonicalRecordId: canonical.record.id,
			clockIn,
			clockOut,
			startAt: completed.startAt,
			endAt: completed.endAt,
			durationMinutes: completed.durationMinutes,
			attribution: completed.attribution,
			allocations: canonical.allocations,
		}),
		attribution: completed.attribution,
		after: expectedOf(written),
		appended: {
			admission: writer.admission,
			clockIn: appendedEvidence(clockIn),
			clockOut: appendedEvidence(clockOut),
			entries: [clockIn, clockOut],
		},
		effects,
	};
}

/** The new closed work period, linked to its canonical work record; a created pair starts at revision 1. */
async function insertNewWorkPeriod(
	tx: WorkTransactionClient,
	input: {
		change: CreateNewWork;
		half: PlannedHalf;
		clockIn: TimeEntryRow;
		clockOut: TimeEntryRow;
		canonicalRecordId: string;
	},
): Promise<WorkPeriodRow> {
	const { change } = input;
	const columns = input.half.period;
	const [written] = await tx
		.insert(workPeriod)
		.values({
			...(change.workPeriodId === undefined ? {} : { id: change.workPeriodId }),
			organizationId: change.organizationId,
			employeeId: change.employeeId,
			clockInId: input.clockIn.id,
			clockOutId: input.clockOut.id,
			startTime: columns.startTime,
			endTime: columns.endTime,
			durationMinutes: columns.durationMinutes,
			isActive: false,
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
			canonicalRecordId: input.canonicalRecordId,
			approvalStatus: columns.approvalStatus,
			pendingChanges: change.approval.state === "pending" ? change.approval.pendingChanges : null,
			graphRevision: 1,
		})
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Work period insert failed");
	return written;
}
