import "server-only";

/**
 * Pruning an unreferenced canonical work record (ADR 0010): removes historical
 * `time_record` (`record_kind = 'work'`) residue that no `work_period`,
 * `approval_request`, or `time_record_approval_decision` references and that is
 * already superseded by an undeleted `work_period` carrying its own linked
 * canonical record at the same start instant.
 *
 * Runs on a sealed work-transaction scope only; it never opens a transaction
 * and never takes guards. Deleting the base `time_record` row cascades to its
 * `time_record_work` and `time_record_allocation` rows.
 */
import { and, eq, isNotNull, isNull, ne, notExists } from "drizzle-orm";
import {
	approvalRequest,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { instantFromDate, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import type { SealedWorkTransactionScope } from "../work-transaction";

export type OrphanedWorkRecordPruneResult =
	| {
			kind: "pruned";
			recordId: string;
			approvalState: string;
			origin: string;
			startAt: string;
			endAt: string | null;
	  }
	| { kind: "not_found" }
	| {
			kind: "still_referenced";
			by: "work_period" | "approval_request" | "approval_decision";
	  }
	| { kind: "no_linked_replacement" }
	| { kind: "month_closed"; month: string };

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

	const [record] = await tx
		.select({
			id: timeRecord.id,
			startAt: timeRecord.startAt,
			endAt: timeRecord.endAt,
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
		)
		.for("update");
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

	const [referencingDecision] = await tx
		.select({ id: timeRecordApprovalDecision.id })
		.from(timeRecordApprovalDecision)
		.where(
			and(
				eq(timeRecordApprovalDecision.organizationId, organizationId),
				eq(timeRecordApprovalDecision.recordId, recordId),
			),
		)
		.limit(1);
	if (referencingDecision) return { kind: "still_referenced", by: "approval_decision" };

	// Never remove a record unless an undeleted work period at the same start
	// already carries its own linked canonical record.
	const [replacement] = await tx
		.select({ id: workPeriod.id })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.startTime, record.startAt),
				isNull(workPeriod.deletedAt),
				isNotNull(workPeriod.canonicalRecordId),
				ne(workPeriod.canonicalRecordId, recordId),
			),
		)
		.limit(1);
	if (!replacement) return { kind: "no_linked_replacement" };

	const start = instantFromDate(record.startAt);
	const end = record.endAt ? instantFromDate(record.endAt) : start;
	const closed = closedRangeTouchedByWork(
		[{ start, end }],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };

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
			),
		)
		.returning({ id: timeRecord.id });

	if (deleted.length !== 1) return { kind: "still_referenced", by: "work_period" };

	return {
		kind: "pruned",
		recordId,
		approvalState: record.approvalState,
		origin: record.origin,
		startAt: instantToCanonicalString(start),
		endAt: record.endAt ? instantToCanonicalString(end) : null,
	};
}
