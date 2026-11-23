import "server-only";

/**
 * Pruning an unreferenced canonical work record (ADR 0010): removes historical
 * `time_record` (`record_kind = 'work'`) residue left behind by pre-ADR-0010
 * dual-writes after a canonical backfill linked `work_period.canonical_record_id`
 * to a newer `system`-origin record.
 *
 * Safety invariants enforced inside a single transaction before any deletion:
 * 1. Zero references from `work_period.canonical_record_id` or `approval_request.canonical_record_id`.
 * 2. A replacement `work_period` at the same `(organizationId, employeeId, startTime)`
 *    already carries a different existing `canonical_record_id`.
 * 3. Verified interval equivalence: the orphan matches the replacement's end instant
 *    (exact or ±1m rounding) or matches `original_end_time` on an auto-adjusted period.
 * 4. Zero `time_record_allocation` rows on the orphan, and zero differing non-null
 *    `time_record_work` business fields (`work_category_id`, `work_location_type`,
 *    vehicle/odometer columns).
 * 5. Preserves `time_record_work.computation_metadata` by copying it to the linked
 *    canonical record whenever the linked record has `NULL`.
 * 6. Preserves any `time_record_approval_decision` rows by re-pointing `record_id`
 *    to the linked canonical record before deleting the orphan.
 * 7. Neither the orphan nor the replacement touches a closed month.
 *
 * Runs on a sealed work-transaction scope only; it never opens a transaction
 * and never takes guards.
 */
import { and, asc, eq, isNotNull, isNull, ne, notExists } from "drizzle-orm";
import type { db } from "@/db";
import {
	approvalRequest,
	timeRecord,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";

export type OrphanedWorkRecordMatchKind = "exact" | "rounding_1m" | "pre_auto_adjustment";

export type OrphanedWorkRecordSkipResult =
	| { kind: "not_found" }
	| {
			kind: "still_referenced";
			by: "work_period" | "approval_request" | "approval_decision";
	  }
	| { kind: "no_linked_replacement" }
	| { kind: "interval_mismatch" }
	| { kind: "has_allocations" }
	| { kind: "detail_mismatch"; field: string }
	| { kind: "month_closed"; month: string };

export type OrphanedWorkRecordEligiblePlan = {
	kind: "eligible";
	recordId: string;
	approvalState: string;
	origin: string;
	startAt: string;
	endAt: string;
	replacementWorkPeriodId: string;
	replacementCanonicalRecordId: string;
	replacementSoftDeleted: boolean;
	matchKind: OrphanedWorkRecordMatchKind;
	willMigrateComputationMetadata: boolean;
	orphanComputationMetadata: string | null;
	decisionCount: number;
};

export type OrphanedWorkRecordInspection =
	| OrphanedWorkRecordEligiblePlan
	| OrphanedWorkRecordSkipResult;

export type OrphanedWorkRecordPruneResult =
	| {
			kind: "pruned";
			recordId: string;
			approvalState: string;
			origin: string;
			startAt: string;
			endAt: string;
			replacementWorkPeriodId: string;
			replacementCanonicalRecordId: string;
			replacementSoftDeleted: boolean;
			matchKind: OrphanedWorkRecordMatchKind;
			migratedComputationMetadata: boolean;
			migratedDecisionCount: number;
	  }
	| OrphanedWorkRecordSkipResult;

const WORK_DETAIL_BUSINESS_FIELDS = [
	"workCategoryId",
	"workLocationType",
	"vehicleKind",
	"vehicleId",
	"odometerStartKm",
	"odometerEndKm",
	"drivenDistanceKm",
] as const;

type WorkDetailBusinessField = (typeof WORK_DETAIL_BUSINESS_FIELDS)[number];

type WorkDetailComparable = Record<WorkDetailBusinessField, string | number | null> & {
	computationMetadata: string | null;
};

function classifyDuplicateInterval(
	record: { endAt: Date | null; durationMinutes: number | null },
	replacement: {
		endTime: Date | null;
		durationMinutes: number | null;
		wasAutoAdjusted: boolean;
		originalEndTime: Date | null;
		originalDurationMinutes: number | null;
	},
): OrphanedWorkRecordMatchKind | null {
	if (!record.endAt || !replacement.endTime) return null;
	const orphanEnd = instantFromDate(record.endAt);
	const periodEnd = instantFromDate(replacement.endTime);

	if (compareInstants(orphanEnd, periodEnd) === 0) {
		if (
			record.durationMinutes === null ||
			replacement.durationMinutes === null ||
			record.durationMinutes === replacement.durationMinutes
		) {
			return "exact";
		}
		if (Math.abs(record.durationMinutes - replacement.durationMinutes) <= 1) {
			return "rounding_1m";
		}
		return null;
	}

	if (replacement.wasAutoAdjusted && replacement.originalEndTime !== null) {
		const originalEnd = instantFromDate(replacement.originalEndTime);
		if (compareInstants(orphanEnd, originalEnd) === 0) {
			if (
				record.durationMinutes === null ||
				replacement.originalDurationMinutes === null ||
				Math.abs(record.durationMinutes - replacement.originalDurationMinutes) <= 1
			) {
				return "pre_auto_adjustment";
			}
		}
	}

	return null;
}

function firstDetailMismatch(
	orphanDetail: WorkDetailComparable | undefined,
	linkedDetail: WorkDetailComparable | undefined,
): string | null {
	if (!orphanDetail) return null;
	for (const field of WORK_DETAIL_BUSINESS_FIELDS) {
		const orphanValue = orphanDetail[field];
		const linkedValue = linkedDetail?.[field] ?? null;
		if (orphanValue !== null && orphanValue !== linkedValue) {
			return field;
		}
	}
	if (orphanDetail.computationMetadata !== null && !linkedDetail) {
		return "computationMetadata";
	}
	return null;
}

export async function inspectOrphanedWorkRecord(
	tx: typeof db | WorkTransactionClient,
	input: {
		organizationId: string;
		employeeId: string;
		recordId: string;
		lock?: boolean;
	},
): Promise<OrphanedWorkRecordInspection> {
	const { organizationId, employeeId, recordId, lock = false } = input;

	const recordBaseQuery = tx
		.select({
			id: timeRecord.id,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
			durationMinutes: timeRecord.durationMinutes,
			approvalState: timeRecord.approvalState,
			origin: timeRecord.origin,
		})
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, recordId),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		);
	const [record] = await (lock ? recordBaseQuery.for("update") : recordBaseQuery.limit(1));
	if (!record) return { kind: "not_found" };

	const [referencingPeriod] = await tx
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.canonicalRecordId, recordId),
			),
		)
		.limit(1);
	if (referencingPeriod) return { kind: "still_referenced", by: "work_period" };

	const [referencingApproval] = await tx
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.canonicalRecordId, recordId),
			),
		)
		.limit(1);
	if (referencingApproval) return { kind: "still_referenced", by: "approval_request" };

	const replacements = await tx
		.select({
			id: workPeriod.id,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
			wasAutoAdjusted: workPeriod.wasAutoAdjusted,
			originalEndTime: workPeriod.originalEndTime,
			originalDurationMinutes: workPeriod.originalDurationMinutes,
			deletedAt: workPeriod.deletedAt,
			canonicalRecordId: workPeriod.canonicalRecordId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.startTime, record.startAt),
				isNotNull(workPeriod.canonicalRecordId),
				ne(workPeriod.canonicalRecordId, recordId),
			),
		)
		.orderBy(asc(workPeriod.id));

	// Prefer an undeleted replacement period over a soft-deleted one.
	const replacement =
		replacements.find((candidate) => candidate.deletedAt === null) ?? replacements[0];
	if (!replacement?.canonicalRecordId) return { kind: "no_linked_replacement" };
	const replacementCanonicalRecordId = replacement.canonicalRecordId;

	const linkedCanonicalBaseQuery = tx
		.select({ id: timeRecord.id })
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, replacementCanonicalRecordId),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		);
	const [linkedCanonical] = await (lock
		? linkedCanonicalBaseQuery.for("update")
		: linkedCanonicalBaseQuery.limit(1));
	if (!linkedCanonical) return { kind: "no_linked_replacement" };

	const matchKind = classifyDuplicateInterval(record, replacement);
	if (!matchKind || !record.endAt || !replacement.endTime) {
		return { kind: "interval_mismatch" };
	}

	const [allocation] = await tx
		.select({ id: timeRecordAllocation.id })
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.organizationId, organizationId),
				eq(timeRecordAllocation.recordId, recordId),
			),
		)
		.limit(1);
	if (allocation) return { kind: "has_allocations" };

	const [orphanDetail] = await tx
		.select({
			workCategoryId: timeRecordWork.workCategoryId,
			workLocationType: timeRecordWork.workLocationType,
			computationMetadata: timeRecordWork.computationMetadata,
			vehicleKind: timeRecordWork.vehicleKind,
			vehicleId: timeRecordWork.vehicleId,
			odometerStartKm: timeRecordWork.odometerStartKm,
			odometerEndKm: timeRecordWork.odometerEndKm,
			drivenDistanceKm: timeRecordWork.drivenDistanceKm,
		})
		.from(timeRecordWork)
		.where(
			and(
				eq(timeRecordWork.organizationId, organizationId),
				eq(timeRecordWork.recordId, recordId),
				eq(timeRecordWork.recordKind, "work"),
			),
		)
		.limit(1);

	const [linkedDetail] = await tx
		.select({
			workCategoryId: timeRecordWork.workCategoryId,
			workLocationType: timeRecordWork.workLocationType,
			computationMetadata: timeRecordWork.computationMetadata,
			vehicleKind: timeRecordWork.vehicleKind,
			vehicleId: timeRecordWork.vehicleId,
			odometerStartKm: timeRecordWork.odometerStartKm,
			odometerEndKm: timeRecordWork.odometerEndKm,
			drivenDistanceKm: timeRecordWork.drivenDistanceKm,
		})
		.from(timeRecordWork)
		.where(
			and(
				eq(timeRecordWork.organizationId, organizationId),
				eq(timeRecordWork.recordId, replacementCanonicalRecordId),
				eq(timeRecordWork.recordKind, "work"),
			),
		)
		.limit(1);

	const detailMismatch = firstDetailMismatch(orphanDetail, linkedDetail);
	if (detailMismatch) return { kind: "detail_mismatch", field: detailMismatch };

	const decisions = await tx
		.select({ id: timeRecordApprovalDecision.id })
		.from(timeRecordApprovalDecision)
		.where(
			and(
				eq(timeRecordApprovalDecision.organizationId, organizationId),
				eq(timeRecordApprovalDecision.recordId, recordId),
			),
		);

	const start = instantFromDate(record.startAt);
	const orphanEnd = instantFromDate(record.endAt);
	const replacementEnd = instantFromDate(replacement.endTime);
	const closed = closedRangeTouchedByWork(
		[
			{ start, end: orphanEnd },
			{ start, end: replacementEnd },
		],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };

	const orphanComputationMetadata = orphanDetail?.computationMetadata ?? null;
	const willMigrateComputationMetadata =
		orphanComputationMetadata !== null &&
		linkedDetail !== undefined &&
		linkedDetail.computationMetadata === null;

	return {
		kind: "eligible",
		recordId,
		approvalState: record.approvalState,
		origin: record.origin,
		startAt: instantToCanonicalString(start),
		endAt: instantToCanonicalString(orphanEnd),
		replacementWorkPeriodId: replacement.id,
		replacementCanonicalRecordId,
		replacementSoftDeleted: replacement.deletedAt !== null,
		matchKind,
		willMigrateComputationMetadata,
		orphanComputationMetadata,
		decisionCount: decisions.length,
	};
}

export async function pruneOrphanedWorkRecord(
	scope: SealedWorkTransactionScope,
	input: {
		organizationId: string;
		employeeId: string;
		recordId: string;
	},
): Promise<OrphanedWorkRecordPruneResult> {
	const { organizationId, employeeId, recordId } = input;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;

	const plan = await inspectOrphanedWorkRecord(tx, {
		organizationId,
		employeeId,
		recordId,
		lock: true,
	});
	if (plan.kind !== "eligible") return plan;

	if (plan.willMigrateComputationMetadata && plan.orphanComputationMetadata !== null) {
		await tx
			.update(timeRecordWork)
			.set({ computationMetadata: plan.orphanComputationMetadata })
			.where(
				and(
					eq(timeRecordWork.recordId, plan.replacementCanonicalRecordId),
					eq(timeRecordWork.organizationId, organizationId),
					eq(timeRecordWork.recordKind, "work"),
					isNull(timeRecordWork.computationMetadata),
				),
			);
	}

	if (plan.decisionCount > 0) {
		await tx
			.update(timeRecordApprovalDecision)
			.set({ recordId: plan.replacementCanonicalRecordId })
			.where(
				and(
					eq(timeRecordApprovalDecision.organizationId, organizationId),
					eq(timeRecordApprovalDecision.recordId, recordId),
				),
			);
	}

	const deleted = await tx
		.delete(timeRecord)
		.where(
			and(
				eq(timeRecord.id, recordId),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
				notExists(
					tx
						.select({ id: workPeriod.id })
						.from(workPeriod)
						.where(
							and(
								eq(workPeriod.organizationId, timeRecord.organizationId),
								eq(workPeriod.canonicalRecordId, timeRecord.id),
							),
						),
				),
				notExists(
					tx
						.select({ id: approvalRequest.id })
						.from(approvalRequest)
						.where(
							and(
								eq(approvalRequest.organizationId, timeRecord.organizationId),
								eq(approvalRequest.canonicalRecordId, timeRecord.id),
							),
						),
				),
				notExists(
					tx
						.select({ id: timeRecordApprovalDecision.id })
						.from(timeRecordApprovalDecision)
						.where(
							and(
								eq(timeRecordApprovalDecision.organizationId, timeRecord.organizationId),
								eq(timeRecordApprovalDecision.recordId, timeRecord.id),
							),
						),
				),
			),
		)
		.returning({ id: timeRecord.id });

	if (deleted.length !== 1) return { kind: "still_referenced", by: "work_period" };

	return {
		kind: "pruned",
		recordId,
		approvalState: plan.approvalState,
		origin: plan.origin,
		startAt: plan.startAt,
		endAt: plan.endAt,
		replacementWorkPeriodId: plan.replacementWorkPeriodId,
		replacementCanonicalRecordId: plan.replacementCanonicalRecordId,
		replacementSoftDeleted: plan.replacementSoftDeleted,
		matchKind: plan.matchKind,
		migratedComputationMetadata: plan.willMigrateComputationMetadata,
		migratedDecisionCount: plan.decisionCount,
	};
}
