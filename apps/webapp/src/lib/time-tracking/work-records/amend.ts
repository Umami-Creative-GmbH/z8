import "server-only";

/**
 * Amending completed work (ADR 0010, #1225): new times, a work attribution
 * patch or both, written to the work period and its canonical work record
 * together in either admission's entry writer, in one revision step, with the
 * effects of the change. Runs on a sealed work-transaction scope only; it never
 * opens a transaction and never takes guards.
 *
 * Every refusal is decided before the first write, so a refused amendment
 * writes nothing. A pair that still disagrees after the writes is a defect in
 * work records, not in the data: it throws and the transaction rolls back.
 */
import { and, eq, isNull } from "drizzle-orm";
import { timeRecord, timeRecordAllocation, timeRecordWork, workPeriod } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { CompletedWorkIntegrityError } from "../close-active-work";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import {
	assertBillableAllowed,
	projectBillableDefault,
	readProjectBillability,
} from "../work-billability";
import { loadWorkOccupants } from "../work-occupancy";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { AmendedEndpoint, AmendmentChanges, AmendWorkRecord } from "./amend-change";
import type { AmendmentPlan } from "./amend-plan";
import type { WorkRecordExpected, WorkRecordRefusal } from "./change";
import type { AppendedEntryEvidence } from "./divide";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { type EntryDraft, entryWriterFor } from "./entry-writer";
import { planChange } from "./plan";
import { expectedOf, matchesExpected, pairOf } from "./read";
import { recordAgreement } from "./record-agreement";
import {
	type CanonicalWorkRows,
	selectWorkRecordRows,
	type TimeEntryRow,
	type WorkPeriodRow,
	type WorkRecordRows,
} from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import {
	type CanonicalAllocationShape,
	WorkAttribution,
	type WorkAttributionPatch,
} from "./work-attribution";

/** One correction entry an amendment appended, with the endpoint it replaces. */
export type AmendedEntryEvidence = AppendedEntryEvidence & {
	endpoint: "clock_in" | "clock_out";
	replacesEntryId: string;
};

export type WorkAmendment = {
	kind: "amended";
	/** The work exactly as it was locked. */
	source: {
		segment: WorkSegment;
		revision: number;
		approvalState: WorkPeriodRow["approvalStatus"];
		recordApprovalState: CanonicalWorkRows["record"]["approvalState"];
	};
	/** The amended work. */
	segment: WorkSegment;
	/** The new expected state: name it to chain a further change. */
	after: WorkRecordExpected;
	changes: AmendmentChanges;
	appended: {
		admission: "append" | "legacy";
		/** Clock-in first; empty when the times stayed. */
		corrections: AmendedEntryEvidence[];
		entries: TimeEntryRow[];
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function amendWorkRecord(
	scope: SealedWorkTransactionScope,
	change: AmendWorkRecord,
): Promise<WorkAmendment | WorkRecordRefusal> {
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

	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.times?.appendOperation ?? "completed_work_correction",
	});
	// In append admission a superseded endpoint was corrected by someone else. In
	// legacy admission a split's generated half keeps the source clock-out its
	// new clock-out superseded (#1219): it still ends that half, so it is amendable.
	if (writer.admission === "append" && (clockIn.isSuperseded || clockOut.isSuperseded)) {
		return { kind: "endpoint_superseded" };
	}
	const patch = await resolvedPatch(tx, change, WorkAttribution.fromWorkPeriod(period));
	const plan = planChange(
		pairOf(locked),
		{ kind: "amend", times: change.times, attribution: patch },
		writer.durationArithmetic,
	);
	if (plan.kind !== "amend") return plan;
	if (!canonical) return { kind: "canonical_record_missing" };

	// What the database says against the plan.
	const before = {
		startAt: instantFromDate(period.startTime),
		endAt: instantFromDate(period.endTime),
	};
	const after = plan.result;
	const timesChanged = plan.changes.clockIn || plan.changes.clockOut;
	if (timesChanged) {
		const occupants = await loadWorkOccupants(tx, {
			organizationId,
			employeeId,
			interval: { startAt: after.startAt, endAt: after.endAt },
			excludeWorkPeriodIds: [period.id],
		});
		if (occupants.length > 0) return { kind: "work_occupied", occupants };
	}
	// Work and attribution touching a closed month are frozen, before or after the change (#762).
	const closed = closedRangeTouchedByWork(
		[
			{ start: before.startAt, end: before.endAt },
			{ start: after.startAt, end: after.endAt },
		],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };
	const admission = timesChanged ? await writer.admit() : null;
	if (admission?.kind === "review_required") {
		return { kind: "append_review_required", requirement: admission.requirement };
	}

	// Writes: nothing below refuses.
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: change.actorUserId,
		before: [{ start: before.startAt, end: before.endAt }],
		after: [{ start: after.startAt, end: after.endAt }],
	});
	const drafts = correctionDrafts(change, plan, { clockIn, clockOut });
	const corrections = admission
		? await admission.entries.append(drafts.map(({ draft }) => draft))
		: [];
	if (corrections.length !== drafts.length)
		throw new Error("Work records corrections were not appended");
	const appendedOf = (endpoint: AmendedEntryEvidence["endpoint"]) =>
		corrections[drafts.findIndex((draft) => draft.endpoint === endpoint)];
	const newClockIn = plan.changes.clockIn ? appendedOf("clock_in") : clockIn;
	const newClockOut = plan.changes.clockOut ? appendedOf("clock_out") : clockOut;
	if (!newClockIn || !newClockOut) throw new Error("Work records corrections were not appended");
	const written = await writeAmendedPair(tx, {
		locked: { ...locked, canonical },
		plan,
		clockIn: newClockIn,
		clockOut: newClockOut,
		updatedAt: new Date(),
		updatedBy: change.actorUserId,
	});
	assertWrittenAgreement(written);

	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [
			{ at: before.startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes ?? 0 },
			{ at: after.startAt, utcOffsetMinutes: newClockIn.utcOffsetMinutes ?? 0 },
		],
	});

	return {
		kind: "amended",
		source: {
			segment: workSegment({
				workPeriodId: period.id,
				canonicalRecordId: canonical.record.id,
				clockIn,
				clockOut,
				startAt: before.startAt,
				endAt: before.endAt,
				durationMinutes: period.durationMinutes ?? 0,
				attribution: WorkAttribution.fromWorkPeriod(period),
				allocations: canonical.allocations,
			}),
			revision: period.graphRevision,
			approvalState: period.approvalStatus,
			recordApprovalState: canonical.record.approvalState,
		},
		segment: workSegment({
			workPeriodId: period.id,
			canonicalRecordId: canonical.record.id,
			clockIn: newClockIn,
			clockOut: newClockOut,
			startAt: after.startAt,
			endAt: after.endAt,
			durationMinutes: after.durationMinutes,
			attribution: after.attribution,
			allocations: written.allocations,
		}),
		after: expectedOf(written.period),
		changes: plan.changes,
		appended: {
			admission: writer.admission,
			corrections: corrections.map((entry, index) => ({
				endpoint: drafts[index]?.endpoint ?? "clock_out",
				replacesEntryId: drafts[index]?.draft.replaces?.id ?? "",
				entryId: entry.id,
				hash: entry.hash,
				previousEntryId: entry.previousEntryId,
				previousHash: entry.previousHash,
			})),
			entries: corrections,
		},
		effects,
	};
}

/**
 * The caller's patch with the project's billable default (#900): a changed
 * project takes it unless `billable` is named, and billable work needs a
 * project with a customer to bill.
 */
async function resolvedPatch(
	tx: WorkTransactionClient,
	change: AmendWorkRecord,
	source: WorkAttribution,
): Promise<WorkAttributionPatch | undefined> {
	if (!change.attribution) return undefined;
	const { project, ...rest } = change.attribution;
	const projectId = project === undefined ? (source.project?.projectId ?? null) : project;
	const projectChanged = projectId !== (source.project?.projectId ?? null);
	const needsProject = (projectChanged && rest.billable === undefined) || rest.billable === true;
	const facts = needsProject
		? await readProjectBillability(tx, change.organizationId, projectId)
		: null;
	if (rest.billable === true) assertBillableAllowed(facts);
	if (project === undefined) return rest;
	return {
		...rest,
		project:
			project === null
				? null
				: { projectId: project, billableDefault: projectBillableDefault(facts) },
	};
}

/** The correction entries for the endpoints that move, clock-in first. */
function correctionDrafts(
	change: AmendWorkRecord,
	plan: AmendmentPlan,
	endpoints: { clockIn: TimeEntryRow; clockOut: TimeEntryRow },
): { endpoint: AmendedEntryEvidence["endpoint"]; draft: EntryDraft }[] {
	const times = change.times;
	if (!times) return [];
	const draft = (endpoint: AmendedEndpoint, replaces: TimeEntryRow): EntryDraft => ({
		type: "correction",
		at: endpoint.at,
		notes: times.notes,
		provenance: { ...times.entries, capture: endpoint.capture },
		replaces,
	});
	return [
		...(plan.changes.clockIn && times.clockIn
			? [{ endpoint: "clock_in" as const, draft: draft(times.clockIn, endpoints.clockIn) }]
			: []),
		...(plan.changes.clockOut && times.clockOut
			? [{ endpoint: "clock_out" as const, draft: draft(times.clockOut, endpoints.clockOut) }]
			: []),
	];
}

type WrittenPair = { period: WorkPeriodRow } & CanonicalWorkRows;

/**
 * The amended pair: compare-and-set on the work period's revision, which
 * advances; the canonical work record takes the same interval and minutes,
 * and its detail and project allocation change only when the attribution does.
 */
async function writeAmendedPair(
	tx: WorkTransactionClient,
	input: {
		locked: WorkRecordRows & { canonical: CanonicalWorkRows };
		plan: AmendmentPlan;
		clockIn: TimeEntryRow;
		clockOut: TimeEntryRow;
		updatedAt: Date;
		updatedBy: string | null;
	},
): Promise<WrittenPair> {
	const { period, canonical } = input.locked;
	const half = input.plan.result;
	const columns = half.period;
	const [written] = await tx
		.update(workPeriod)
		.set({
			clockInId: input.clockIn.id,
			clockOutId: input.clockOut.id,
			startTime: columns.startTime,
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
			startAt: record.startAt,
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
		if (!writtenDetail)
			throw new CompletedWorkIntegrityError("Canonical work detail update failed");
		detail = writtenDetail;
	}

	let allocations = canonical.allocations;
	const plannedProject = half.canonical.allocations.filter(
		({ allocationKind }) => allocationKind === "project",
	);
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
		const inserted: CanonicalWorkRows["allocations"] = [];
		for (const allocation of plannedProject) {
			const [row] = await tx
				.insert(timeRecordAllocation)
				.values({
					organizationId: period.organizationId,
					recordId: canonical.record.id,
					allocationKind: allocation.allocationKind,
					projectId: allocation.projectId,
					taskId: allocation.taskId,
					costCenterId: allocation.costCenterId,
					weightPercent: allocation.weightPercent,
					isBillable: allocation.isBillable,
				})
				.returning();
			if (!row) throw new CompletedWorkIntegrityError("Canonical allocation insert failed");
			inserted.push(row);
		}
		allocations = [
			...allocations.filter(({ allocationKind }) => allocationKind !== "project"),
			...inserted,
		];
	}
	return { period: written, record: writtenRecord, detail, allocations };
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
