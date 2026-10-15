import "server-only";

/**
 * Attaching the canonical work records history left missing (#1224, spec #1212):
 * every completed work period has one, and the database checks it for every new
 * and changed row (migration 0234, `NOT VALID`). Half pairs written before the
 * check get theirs here, through work records' attach, from the canonical
 * backfill behind the payroll export and the payroll workspace and from
 * reopening a month.
 *
 * One period at a time, each in its own work transaction: a period whose work
 * touches a closed month is skipped (the pre-check's `month_closed`, or the
 * database refusal, Time Tracking ADR-0004) and stays a half pair, which nothing
 * may change; every other period is still attached. No closed-month exemption
 * exists. Any other failure stops the run; the periods attached before it stay
 * attached.
 *
 * The record is the work period's own id, origin `system`, created by the user
 * who recorded the work's clock-out (the original actor, never the executor).
 * The work period stores no computation metadata, so none is known to copy. The
 * period's legacy approval history is linked to the new record in the same
 * transaction.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { organization } from "@/db/auth-schema";
import { approvalRequest, timeRecordApprovalDecision, workPeriod } from "@/db/schema";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import { withCompletedWorkTransaction } from "@/lib/time-tracking/completed-work-transaction";
import {
	applyWorkRecordChange,
	isWorkRecordRefusal,
	readWorkRecord,
	type WorkRecordRefusal,
	type WorkRecordRefusalKind,
} from "@/lib/time-tracking/work-records";
import type { WorkTransactionClient } from "@/lib/time-tracking/work-transaction";

/** A work period attach refused, with why, for the operator to list. */
export type RefusedWorkRecordAttachment = {
	workPeriodId: string;
	employeeId: string;
	startAt: string;
	endAt: string;
	refusal: WorkRecordRefusalKind;
	/** The refusal's reason in words a run report lists. */
	reason: string;
};

export type MissingWorkRecordAttachment = {
	/** The work periods that got their canonical work record. */
	attached: string[];
	/** Work periods left half pairs because their work touches a closed month. */
	closedMonthSkips: Array<{ workPeriodId: string; month: string }>;
	/**
	 * Work periods work records refused to attach for another reason: a record of
	 * the period's id already exists unlinked (`canonical_record_present`, a
	 * repair), an endpoint entry is missing, or the work cannot be represented.
	 * They stay for work diagnostics and its repairs.
	 */
	refused: RefusedWorkRecordAttachment[];
};

export async function attachMissingWorkRecords(input: {
	organizationId: string;
	/** Only these employees' work; all of the organization's when absent. */
	employeeIds?: readonly string[];
	/** The user whose action attaches (the record's updater); null for the system. */
	actorUserId: string | null;
}): Promise<MissingWorkRecordAttachment> {
	const { organizationId, actorUserId } = input;
	const outcome: MissingWorkRecordAttachment = { attached: [], closedMonthSkips: [], refused: [] };
	if (input.employeeIds?.length === 0) return outcome;
	const candidates = await db
		.select({
			id: workPeriod.id,
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			// A closed month's half pair is skipped here, without a work transaction (#762).
			closedMonth: sql<
				string | null
			>`to_char(public.closed_month_touching_work(${workPeriod.employeeId}, ${workPeriod.startTime}, ${workPeriod.endTime}), 'YYYY-MM')`,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.isActive, false),
				isNotNull(workPeriod.endTime),
				isNull(workPeriod.canonicalRecordId),
				isNull(workPeriod.deletedAt),
				input.employeeIds ? inArray(workPeriod.employeeId, [...input.employeeIds]) : undefined,
			),
		)
		.orderBy(asc(workPeriod.employeeId), asc(workPeriod.startTime), asc(workPeriod.id));

	for (const candidate of candidates) {
		const { id: workPeriodId, employeeId } = candidate;
		if (candidate.closedMonth !== null) {
			outcome.closedMonthSkips.push({ workPeriodId, month: candidate.closedMonth });
			continue;
		}
		try {
			const result = await withCompletedWorkTransaction(
				{ organizationId, employeeId, actorUserId },
				async (scope) => {
					const key = { organizationId, employeeId, workPeriodId };
					const work = await readWorkRecord(scope, key, { lock: true });
					// Deleted, or attached by another writer since the read.
					if (!work || work.period.canonicalRecordId !== null) return null;
					const recordedBy = work.clockOut?.createdBy ?? work.clockIn?.createdBy;
					if (!recordedBy) return { kind: "endpoint_entry_missing" as const };
					const attached = await applyWorkRecordChange(scope, {
						kind: "attach",
						organizationId,
						employeeId,
						expected: work.expected,
						record: { origin: "system", createdBy: recordedBy, computationMetadata: null },
						actorUserId,
					});
					if (isWorkRecordRefusal(attached)) return attached;
					await linkApprovalHistory(scope.db, {
						organizationId,
						workPeriodId,
						recordId: attached.segment.canonicalRecordId,
					});
					return attached;
				},
			);
			if (result === null) continue;
			if (!isWorkRecordRefusal(result)) outcome.attached.push(workPeriodId);
			else if (result.kind === "month_closed") {
				outcome.closedMonthSkips.push({ workPeriodId, month: result.month });
			} else {
				outcome.refused.push({
					workPeriodId,
					employeeId,
					startAt: candidate.startTime.toISOString(),
					endAt: (candidate.endTime ?? candidate.startTime).toISOString(),
					refusal: result.kind,
					reason: refusalReason(result),
				});
			}
		} catch (error) {
			const refusal = monthClosedRefusalOf(error);
			if (!refusal) throw error;
			outcome.closedMonthSkips.push({ workPeriodId, month: refusal.month });
		}
	}
	return outcome;
}

/** Why attach refused, as a run report lists it. */
function refusalReason(refusal: WorkRecordRefusal): string {
	switch (refusal.kind) {
		case "attribution_unrepresentable":
			return refusal.reason;
		case "canonical_divergence":
			return refusal.disagreements.includes("duration")
				? "duration_missing"
				: `disagrees_on_${refusal.disagreements.join("_and_")}`;
		// Every candidate has an end, so a running refusal is an end without its clock-out.
		case "work_running":
			return "end_without_clock_out";
		default:
			return refusal.kind;
	}
}

export type OrganizationWorkRecordAttachment = MissingWorkRecordAttachment & {
	organizationId: string;
};

/**
 * The deploy backfill of migration 0234 (`pnpm work-records:attach-missing`):
 * every organization's missing canonical work records, one organization after
 * another, closed months skipped. A system process, so the records are created
 * by each work's original actor.
 */
export async function attachMissingWorkRecordsInEveryOrganization(
	options: { organizationIds?: readonly string[] } = {},
): Promise<OrganizationWorkRecordAttachment[]> {
	const organizationIds =
		options.organizationIds ??
		(await db.select({ id: organization.id }).from(organization).orderBy(asc(organization.id))).map(
			({ id }) => id,
		);
	const reports: OrganizationWorkRecordAttachment[] = [];
	for (const organizationId of organizationIds) {
		reports.push({
			organizationId,
			...(await attachMissingWorkRecords({ organizationId, actorUserId: null })),
		});
	}
	return reports;
}

/**
 * The work period's legacy approval requests: each becomes a decision on the
 * new canonical work record and links to it.
 */
async function linkApprovalHistory(
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
			actorEmployeeId: request.status === "pending" ? request.requestedBy : request.approverId,
			action:
				request.status === "pending"
					? ("submitted" as const)
					: request.status === "approved"
						? ("approved" as const)
						: ("rejected" as const),
			reason: request.rejectionReason ?? request.reason,
			createdAt: request.approvedAt ?? request.createdAt,
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
