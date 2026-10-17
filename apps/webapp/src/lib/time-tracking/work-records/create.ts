import "server-only";

/**
 * Creating completed work from live work (ADR 0010, #1222), in either
 * admission's entry writer, with the effects of the change. Runs on a sealed
 * work-transaction scope only; it never opens a transaction and never takes
 * guards. The live work is Clocking's (ADR 0002) until this hands it over: every
 * clock-out, break and automatic, departure or kiosk closure ends here.
 *
 * Every refusal is decided before the first write, so a refused creation writes
 * nothing. A pair that disagrees after the writes is a defect in work records:
 * it throws and the transaction rolls back.
 */
import { and, eq, isNull } from "drizzle-orm";
import { timeRecord, timeRecordWork, workPeriod } from "@/db/schema";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { WorkRecordExpected, WorkRecordRefusal } from "./change";
import { type CreateWorkRecord, planCreation } from "./create-plan";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { entryWriterFor } from "./entry-writer";
import { CompletedWorkIntegrityError } from "./integrity";
import {
	type AppendedEntryEvidence,
	appendedEvidence,
	assertWrittenAgreement,
	insertAllocations,
} from "./pair-writer";
import type { PlannedHalf } from "./plan";
import { expectedOf, matchesExpected } from "./read";
import type { CanonicalWorkRows, TimeEntryRow, WorkPeriodRow } from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import type { WorkAttribution } from "./work-attribution";

export type WorkCreation = {
	kind: "created";
	/** The completed work as written. */
	segment: WorkSegment;
	attribution: WorkAttribution;
	/** The completed work's expected state: name it to chain a further change. */
	after: WorkRecordExpected;
	/** The live work's revision as it was locked. */
	source: { revision: number };
	/** The live work's clock-in, which now starts the completed work. */
	clockIn: TimeEntryRow;
	appended: {
		admission: "append" | "legacy";
		clockOut: AppendedEntryEvidence;
		/** The appended clock-out entry as written. */
		entry: TimeEntryRow;
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function createWorkRecord(
	scope: SealedWorkTransactionScope,
	change: CreateWorkRecord,
): Promise<WorkCreation | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const { period, clockIn } = change.completing;
	if (
		period.organizationId !== organizationId ||
		period.employeeId !== employeeId ||
		period.id !== change.expected.workPeriodId
	) {
		return { kind: "not_found", workPeriodId: change.expected.workPeriodId };
	}
	if (!matchesExpected(change.expected, period)) {
		return { kind: "stale", current: { revision: period.graphRevision } };
	}
	if (!period.isActive || period.endTime !== null || period.deletedAt !== null) {
		return { kind: "work_not_live" };
	}
	if (clockIn?.type !== "clock_in" || clockIn.id !== period.clockInId) {
		return { kind: "endpoint_entry_missing" };
	}
	if (clockIn.isSuperseded) return { kind: "endpoint_superseded" };

	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.appendOperation,
	});
	const plan = planCreation(change.completing, change, writer.admission);
	if (plan.kind !== "create") return plan;
	const { completed } = plan;
	const work = { start: completed.startAt, end: completed.endAt };
	// Completing work that touches a closed month changes it (#762).
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
	const [clockOut] = await admission.entries.append([
		{
			...(change.clockOutEntryId === undefined ? {} : { id: change.clockOutEntryId }),
			type: "clock_out",
			at: change.at,
			notes: null,
			provenance: change.entries,
		},
	]);
	if (!clockOut) throw new Error("Work records clock-out was not appended");
	const canonical = await insertCanonicalRecord(tx, {
		organizationId,
		employeeId,
		half: completed,
		origin: "clock",
		recordedBy: change.recordedBy,
	});
	const written = await closeLiveWorkPeriod(tx, {
		period,
		half: completed,
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
		source: { revision: period.graphRevision },
		clockIn,
		appended: {
			admission: writer.admission,
			clockOut: appendedEvidence(clockOut),
			entry: clockOut,
		},
		effects,
	};
}

/**
 * A created work's canonical work record: base record, detail and project
 * allocation, as the plan says. Shared by both creations (#1222, #1223).
 */
export async function insertCanonicalRecord(
	tx: WorkTransactionClient,
	input: {
		organizationId: string;
		employeeId: string;
		half: PlannedHalf;
		origin: "clock" | "manual" | "import";
		recordedBy: string;
		computationMetadata?: string | null;
	},
): Promise<CanonicalWorkRows> {
	const { organizationId, half } = input;
	const [record] = await tx
		.insert(timeRecord)
		.values({
			organizationId,
			employeeId: input.employeeId,
			recordKind: "work",
			startAt: half.canonical.record.startAt,
			endAt: half.canonical.record.endAt,
			durationMinutes: half.canonical.record.durationMinutes,
			approvalState: half.canonical.record.approvalState,
			origin: input.origin,
			createdBy: input.recordedBy,
			updatedBy: input.recordedBy,
		})
		.returning();
	if (!record) throw new CompletedWorkIntegrityError("Canonical work record insert failed");
	const columns = half.canonical.detail;
	const [detail] = await tx
		.insert(timeRecordWork)
		.values({
			recordId: record.id,
			organizationId,
			recordKind: "work",
			workCategoryId: columns.workCategoryId,
			workLocationType: columns.workLocationType,
			computationMetadata: input.computationMetadata ?? null,
			vehicleKind: columns.vehicleKind,
			vehicleId: columns.vehicleId,
			odometerStartKm: columns.odometerStartKm,
			odometerEndKm: columns.odometerEndKm,
			drivenDistanceKm: columns.drivenDistanceKm,
		})
		.returning();
	if (!detail) throw new CompletedWorkIntegrityError("Canonical work detail insert failed");
	const allocations = await insertAllocations(
		tx,
		organizationId,
		record.id,
		half.canonical.allocations,
	);
	return { record, detail, allocations };
}

/**
 * Closes the live work period at the new clock-out, linked to its canonical work
 * record, and clears any break in progress. Compare-and-set on the revision and on
 * the work still being live; the revision advances in both admissions.
 */
async function closeLiveWorkPeriod(
	tx: WorkTransactionClient,
	input: {
		period: WorkPeriodRow;
		half: PlannedHalf;
		clockOut: TimeEntryRow;
		canonicalRecordId: string;
	},
): Promise<WorkPeriodRow> {
	const { period, half } = input;
	const columns = half.period;
	const [written] = await tx
		.update(workPeriod)
		.set({
			clockOutId: input.clockOut.id,
			endTime: columns.endTime,
			durationMinutes: columns.durationMinutes,
			isActive: false,
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
			canonicalRecordId: input.canonicalRecordId,
			approvalStatus: columns.approvalStatus,
			pendingChanges: null,
			// Completed work has no break in progress: a closure ends the work at an open
			// break's start (#861), and its start operation stays for the break's replay.
			breakStartedAt: null,
			breakStartedZone: null,
			graphRevision: period.graphRevision + 1,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, period.organizationId),
				eq(workPeriod.employeeId, period.employeeId),
				eq(workPeriod.graphRevision, period.graphRevision),
				eq(workPeriod.isActive, true),
				isNull(workPeriod.endTime),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Live work changed under its lock");
	return written;
}
