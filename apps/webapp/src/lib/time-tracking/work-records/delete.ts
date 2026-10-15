import "server-only";

/**
 * Deleting completed work (ADR 0010, #1227): the soft delete an approved
 * business deletion makes, in either admission. The deletion's recorded
 * markers are adopted in place of both endpoints, and the work period is
 * marked deleted with both records shrunk to the markers' zero-length
 * sentinel, in one revision step with the effects of the change. Runs on a
 * sealed work-transaction scope only; it never opens a transaction and never
 * takes guards.
 *
 * Every refusal is decided before the first write, so a refused deletion
 * writes nothing.
 */
import { and, eq, isNull } from "drizzle-orm";
import { timeRecord, workPeriod } from "@/db/schema";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { CompletedWorkIntegrityError } from "../close-active-work";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import type { SealedWorkTransactionScope } from "../work-transaction";
import {
	type AmendedEntryEvidence,
	adoptRecordedEntry,
	assertWrittenAgreement,
	resolvedEndpoints,
} from "./amend";
import type { WorkRecordRefusal } from "./change";
import type { DeleteWorkRecord } from "./delete-change";
import { planDeletion } from "./delete-plan";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { matchesExpected, pairOf } from "./read";
import { type CanonicalWorkRows, selectWorkRecordRows, type WorkPeriodRow } from "./rows";
import { type WorkSegment, workSegment } from "./segment";
import { WorkAttribution } from "./work-attribution";

export type WorkDeletion = {
	kind: "deleted";
	/** The work exactly as it was locked. */
	source: {
		segment: WorkSegment;
		revision: number;
		approvalState: WorkPeriodRow["approvalStatus"];
		recordApprovalState: CanonicalWorkRows["record"]["approvalState"];
	};
	/** What both records keep: zero minutes between the adopted markers. */
	sentinel: WorkSegment;
	/** The deleted work period's revision. */
	revision: number;
	appended: {
		admission: "append" | "legacy";
		/** The adopted markers, clock-in first; nothing is appended. */
		corrections: AmendedEntryEvidence[];
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function deleteWorkRecord(
	scope: SealedWorkTransactionScope,
	change: DeleteWorkRecord,
): Promise<WorkDeletion | WorkRecordRefusal> {
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
	// Nothing is appended; the admission decides only how a superseded endpoint
	// reads, as for an amendment.
	const admission = scope.admission;
	if (admission === "append" && (clockIn.isSuperseded || clockOut.isSuperseded)) {
		return { kind: "endpoint_superseded" };
	}
	const markers = await resolvedEndpoints(tx, change, change.markers, { clockIn, clockOut });
	if (markers === "adopted_entry_mismatch") return { kind: "adopted_entry_mismatch" };
	const markedIn = markers.clockIn?.adopted;
	const markedOut = markers.clockOut?.adopted;
	if (!markedIn || !markedOut) return { kind: "adopted_entry_mismatch" };
	const plan = planDeletion(pairOf(locked), {
		clockInAt: instantFromDate(markedIn.timestamp),
		clockOutAt: instantFromDate(markedOut.timestamp),
		toleratedDrift: change.toleratedDrift,
	});
	if (plan.kind !== "delete") return plan;
	if (!canonical) return { kind: "canonical_record_missing" };

	const before = { start: instantFromDate(period.startTime), end: instantFromDate(period.endTime) };
	const sentinel = plan.sentinel;
	const closed = closedRangeTouchedByWork(
		[before, { start: sentinel.startAt, end: sentinel.endAt }],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };

	// Writes: nothing below refuses. Deleted work occupies nothing afterwards.
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: change.actorUserId,
		before: [before],
		after: [],
	});
	const adoptedIn = await adoptRecordedEntry(tx, markedIn, clockIn);
	const adoptedOut = await adoptRecordedEntry(tx, markedOut, clockOut);
	const deletedAt = dateFromInstant(change.deletion.at);
	const [written] = await tx
		.update(workPeriod)
		.set({
			clockInId: adoptedIn.id,
			clockOutId: adoptedOut.id,
			startTime: sentinel.period.startTime,
			endTime: sentinel.period.endTime,
			durationMinutes: sentinel.period.durationMinutes,
			graphRevision: period.graphRevision + 1,
			updatedAt: deletedAt,
			deletedAt,
			deletedBy: change.actorUserId,
			deletionReason: change.deletion.reason,
			deletionApprovalRequestId: change.deletion.approvalRequestId,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.graphRevision, period.graphRevision),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning();
	if (!written) throw new CompletedWorkIntegrityError("Work period changed under its lock");
	const [writtenRecord] = await tx
		.update(timeRecord)
		.set({
			startAt: sentinel.canonical.record.startAt,
			endAt: sentinel.canonical.record.endAt,
			durationMinutes: sentinel.canonical.record.durationMinutes,
			updatedAt: deletedAt,
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
	if (!writtenRecord) throw new CompletedWorkIntegrityError("Canonical work record update failed");
	assertWrittenAgreement({
		period: written,
		record: writtenRecord,
		detail: canonical.detail,
		allocations: canonical.allocations,
	});

	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [
			{ at: before.start, utcOffsetMinutes: clockIn.utcOffsetMinutes ?? 0 },
			{ at: sentinel.startAt, utcOffsetMinutes: adoptedIn.utcOffsetMinutes ?? 0 },
		],
	});

	const attribution = WorkAttribution.fromWorkPeriod(period);
	const evidence = (
		endpoint: AmendedEntryEvidence["endpoint"],
		entry: typeof adoptedIn,
		replaces: typeof clockIn,
	): AmendedEntryEvidence => ({
		endpoint,
		replacesEntryId: replaces.id,
		adopted: true,
		entryId: entry.id,
		hash: entry.hash,
		previousEntryId: entry.previousEntryId,
		previousHash: entry.previousHash,
	});
	return {
		kind: "deleted",
		source: {
			segment: workSegment({
				workPeriodId: period.id,
				canonicalRecordId: canonical.record.id,
				clockIn,
				clockOut,
				startAt: before.start,
				endAt: before.end,
				durationMinutes: period.durationMinutes ?? 0,
				attribution,
				allocations: canonical.allocations,
			}),
			revision: period.graphRevision,
			approvalState: period.approvalStatus,
			recordApprovalState: canonical.record.approvalState,
		},
		sentinel: workSegment({
			workPeriodId: period.id,
			canonicalRecordId: canonical.record.id,
			clockIn: adoptedIn,
			clockOut: adoptedOut,
			startAt: sentinel.startAt,
			endAt: sentinel.endAt,
			durationMinutes: 0,
			attribution,
			allocations: canonical.allocations,
		}),
		revision: written.graphRevision,
		appended: {
			admission,
			corrections: [
				evidence("clock_in", adoptedIn, clockIn),
				evidence("clock_out", adoptedOut, clockOut),
			],
		},
		effects,
	};
}
