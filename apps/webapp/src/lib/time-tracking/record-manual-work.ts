import "server-only";

/**
 * Completed-work operation for strict versioned manual entries (#308 / T44,
 * designs #256 and #258).
 *
 * The manual work transaction calls it after protected preparation returned
 * normalized facts. One call either commits the whole graph or returns a typed
 * rejection with nothing written: both entries from one append admission, the
 * closed period, the canonical base/detail/allocation, required approval
 * participation, the work-balance refresh intent and the committed receipt. The
 * receipt keeps the submitted command separately from the normalized
 * interpretation. The interval is exact: nothing is trimmed, split or shifted.
 */
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
	completedWorkOperation,
	timeRecord,
	timeRecordAllocation,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { executeOrdinaryWorkPeriodSubmissionInTransaction } from "@/lib/approvals/server/work-period-submission";
import {
	comparePlainDates,
	dateFromInstant,
	type Instant,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { canonicalJson } from "./canonical-json";
import {
	appendAdmittedClockEntries,
	type ClockingInput,
	createDatabaseClockingStore,
	TimeEntryAppendReviewRequiredError,
} from "./clocking-core";
import {
	CompletedWorkCollisionError,
	type CompletedWorkFollowUp,
	CompletedWorkIntegrityError,
} from "./close-active-work";
import type {
	ManualApprovalIntent,
	ManualCaptureSource,
	ManualPolicyEvidence,
	ManualTargetZoneSource,
	ManualTimeEntryCommand,
} from "./manual-command";
import type { ManualWorkTransactionContext } from "./manual-work-transaction";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "./policy-clock-out-surcharge-snapshot";
import type { AppendReviewReason } from "./time-entry-append";
import { loadWorkOccupants } from "./work-occupancy";
import type { WorkTransactionScope } from "./work-transaction";

export const MANUAL_WORK_RESULT_VERSION = 1;
export const MANUAL_ENTRY_WRITER_VERSION = 1;

/** Normalized facts from protected preparation; the operation never re-derives them. */
export type ManualWorkFacts = {
	targetEmployeeId: string;
	targetUserId: string;
	teamId: string | null;
	organizationId: string;
	isOwnEntry: boolean;
	evaluatedAt: Instant;
	timezone: string;
	captureSource: ManualCaptureSource;
	targetZone: { timezone: string; source: ManualTargetZoneSource };
	start: Instant;
	end: Instant;
	startOffsetMinutes: number;
	endOffsetMinutes: number;
	durationMinutes: number;
	reason: string;
	projectId: string | null;
	workCategoryId: string | null;
	daysBack: number;
	policy: ManualPolicyEvidence | null;
	approval: ManualApprovalIntent;
};

export type ManualWorkApprovalParticipation =
	| { participation: "none" }
	| {
			participation: "manual_time_submission";
			disposition: "executed" | "replayed";
			outcome: string;
			approvalRequestId: string;
			submittedRevisionId: string | null;
	  };

/** Committed result (receipt version 1). Current state is a separate read. */
export type ManualWorkResult = {
	version: typeof MANUAL_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actors: {
		requester: { kind: "human"; userId: string };
		submitting: { kind: "human"; userId: string };
	};
	workPeriodId: string;
	clockInEntryId: string;
	clockOutEntryId: string;
	canonicalRecordId: string;
	/** The authoritative interpretation of the submitted command. */
	interpretation: {
		evaluatedAt: string;
		timezone: string;
		captureSource: ManualCaptureSource;
		targetZone: { timezone: string; source: ManualTargetZoneSource };
		onBehalf: boolean;
		daysBack: number;
		policy: ManualPolicyEvidence | null;
		approvalIntent: ManualApprovalIntent;
	};
	segment: {
		startAt: string;
		endAt: string;
		durationMinutes: number;
		startUtcOffsetMinutes: number;
		endUtcOffsetMinutes: number;
	};
	attribution: { projectId: string | null; workCategoryId: string | null };
	revisions: { workPeriod: { source: null; result: number } };
	append: {
		admission: "append";
		previousEntryId: string | null;
		previousHash: string | null;
		tipEntryId: string;
	};
	approvalState: "approved" | "pending";
	approval: ManualWorkApprovalParticipation;
	followUps: CompletedWorkFollowUp[];
};

/** A conflicting recorded interval, serializable for the form. */
export type ManualWorkOccupant = {
	kind: "work_period" | "time_record";
	id: string;
	startAt: string;
	endAt: string | null;
};

export type ManualWorkRejection =
	| { reason: "occupancy_conflict"; occupants: ManualWorkOccupant[] }
	| { reason: "append_review_required"; reasons: AppendReviewReason[] };

export type RecordedManualWork =
	| {
			kind: "executed";
			result: ManualWorkResult;
			approvalSubmission: Awaited<
				ReturnType<typeof executeOrdinaryWorkPeriodSubmissionInTransaction>
			> | null;
			surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	  }
	| { kind: "rejected"; rejection: ManualWorkRejection };

const MANUAL_KIND = "create_completed_work";

/**
 * Exact receipt replay, in every admission mode. Returns null when the
 * identity has no manual receipt and no work. A different writer, scope or
 * command under the identity, legacy work already saved under it, or committed
 * work that no longer stands is a collision; nothing is re-executed or repaired.
 */
export async function replayManualWork(
	scope: Pick<WorkTransactionScope, "db" | "assertEmployee">,
	input: { organizationId: string; employeeId: string; command: ManualTimeEntryCommand },
): Promise<ManualWorkResult | null> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const operationId = input.command.submissionId;
	const [receipt] = await scope.db
		.select()
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.id, operationId),
				eq(completedWorkOperation.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const [period] = await scope.db
		.select({
			id: workPeriod.id,
			organizationId: workPeriod.organizationId,
			employeeId: workPeriod.employeeId,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
			deletedAt: workPeriod.deletedAt,
		})
		.from(workPeriod)
		.where(and(eq(workPeriod.id, operationId), eq(workPeriod.organizationId, input.organizationId)))
		.limit(1);
	if (!receipt) {
		if (period) throw new CompletedWorkCollisionError();
		return null;
	}
	if (
		receipt.employeeId !== input.employeeId ||
		receipt.kind !== MANUAL_KIND ||
		receipt.writer !== "manual_entry" ||
		receipt.commandVersion !== input.command.version ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== MANUAL_WORK_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported completed-work receipt version");
	}
	const result = receipt.result as ManualWorkResult;
	// Corrected or deleted evidence keeps the conflict; it is never recreated.
	if (
		!period ||
		period.employeeId !== input.employeeId ||
		period.deletedAt !== null ||
		period.clockInId !== result.clockInEntryId ||
		period.clockOutId !== result.clockOutEntryId
	) {
		throw new CompletedWorkCollisionError();
	}
	return result;
}

function approvalDbService(context: ManualWorkTransactionContext): ApprovalDbService {
	return {
		db: context.approval.dbService.db as ApprovalDbService["db"],
		query: <T>(_name: string, operation: () => Promise<T>) => Effect.promise(operation),
	};
}

/**
 * Fresh manual work. The caller has ruled out replay, runs in the adopted
 * (`append`) admission mode and passes prepared facts sampled at one instant.
 */
export async function recordManualWork(
	context: ManualWorkTransactionContext,
	input: { actorUserId: string; command: ManualTimeEntryCommand; facts: ManualWorkFacts },
): Promise<RecordedManualWork> {
	const { command, facts } = input;
	const { organizationId, targetEmployeeId: employeeId } = facts;
	context.assertEmployee(organizationId, employeeId);
	if (context.admission !== "append") {
		throw new Error("Manual commands use the operation only in adopted organizations");
	}
	const requiresApproval = facts.approval.intent === "approval";
	// Participants must be protected before any write; this may restart the attempt.
	if (requiresApproval) context.requireApprovalScope();
	const tx = context.db;

	const occupants = await loadWorkOccupants(tx, {
		organizationId,
		employeeId,
		interval: { startAt: facts.start, endAt: facts.end },
		excludeWorkPeriodIds: [],
	});
	if (occupants.length > 0) {
		return {
			kind: "rejected",
			rejection: {
				reason: "occupancy_conflict",
				occupants: occupants.map((occupant) => ({
					kind: occupant.kind,
					id: occupant.id,
					startAt: instantToCanonicalString(occupant.startAt),
					endAt: occupant.endAt ? instantToCanonicalString(occupant.endAt) : null,
				})),
			},
		};
	}

	const entryInput = (
		instant: Instant,
		utcOffsetMinutes: number,
		notes: string,
	): ClockingInput => ({
		employeeId,
		organizationId,
		createdBy: input.actorUserId,
		action: {
			instant,
			utcOffsetMinutes,
			timezone: facts.timezone,
			timezoneSource: facts.captureSource,
		},
		source: { ipAddress: null, deviceInfo: null },
		notes,
	});
	let appended: Awaited<ReturnType<typeof appendAdmittedClockEntries>>;
	try {
		appended = await appendAdmittedClockEntries(createDatabaseClockingStore(tx), "manual_entry", [
			{
				input: entryInput(facts.start, facts.startOffsetMinutes, `Manual entry: ${facts.reason}`),
				type: "clock_in",
			},
			{ input: entryInput(facts.end, facts.endOffsetMinutes, facts.reason), type: "clock_out" },
		]);
	} catch (error) {
		if (!(error instanceof TimeEntryAppendReviewRequiredError)) throw error;
		return {
			kind: "rejected",
			rejection: { reason: "append_review_required", reasons: error.requirement.reasons },
		};
	}
	const [clockIn, clockOut] = appended;
	if (!clockIn || !clockOut)
		throw new CompletedWorkIntegrityError("Manual work needs both entries");

	const startAt = dateFromInstant(facts.start);
	const endAt = dateFromInstant(facts.end);
	const approvalState = requiresApproval ? "pending" : "approved";
	// Surcharge evidence keeps its existing event-time semantics.
	const surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		startTime: facts.start,
		endTime: facts.end,
	});
	const [record] = await tx
		.insert(timeRecord)
		.values({
			organizationId,
			employeeId,
			recordKind: "work",
			startAt,
			endAt,
			durationMinutes: facts.durationMinutes,
			approvalState,
			origin: "manual",
			createdBy: input.actorUserId,
			updatedBy: input.actorUserId,
		})
		.returning({ id: timeRecord.id });
	if (!record) throw new Error("Failed to create canonical work record");
	await tx.insert(timeRecordWork).values({
		recordId: record.id,
		organizationId,
		recordKind: "work",
		workCategoryId: facts.workCategoryId,
		workLocationType: null,
		computationMetadata: null,
	});
	if (facts.projectId) {
		await tx.insert(timeRecordAllocation).values({
			organizationId,
			recordId: record.id,
			allocationKind: "project",
			projectId: facts.projectId,
			weightPercent: 100,
		});
	}

	const resultRevision = 1;
	const [period] = await tx
		.insert(workPeriod)
		.values({
			id: command.submissionId,
			employeeId,
			organizationId,
			clockInId: clockIn.entry.id,
			clockOutId: clockOut.entry.id,
			startTime: startAt,
			endTime: endAt,
			durationMinutes: facts.durationMinutes,
			projectId: facts.projectId,
			workCategoryId: facts.workCategoryId,
			canonicalRecordId: record.id,
			isActive: false,
			approvalStatus: approvalState,
			pendingChanges: requiresApproval
				? {
						ordinarySubmission: {
							submissionId: command.submissionId,
							kind: "manual_time_submission" as const,
						},
						originalStartTime: startAt.toISOString(),
						originalEndTime: endAt.toISOString(),
						originalDurationMinutes: facts.durationMinutes,
						requestedAt: dateFromInstant(facts.evaluatedAt).toISOString(),
						requestedBy: input.actorUserId,
						reason: facts.reason,
						isManualEntry: true,
						surchargeSnapshot,
					}
				: null,
			graphRevision: resultRevision,
		})
		.returning({ id: workPeriod.id });
	if (!period) throw new Error("Failed to create manual work period");

	let approvalSubmission: Extract<RecordedManualWork, { kind: "executed" }>["approvalSubmission"] =
		null;
	let approval: ManualWorkApprovalParticipation = { participation: "none" };
	let committedApprovalState: "approved" | "pending" = approvalState;
	if (requiresApproval) {
		approvalSubmission = await executeOrdinaryWorkPeriodSubmissionInTransaction({
			dbService: approvalDbService(context),
			context: context.approval,
			coordination: context,
			organizationId,
			workPeriodId: period.id,
			submissionId: command.submissionId,
			requesterEmployeeId: employeeId,
			requesterUserId: facts.targetUserId,
			teamId: facts.teamId,
			defaultApproverId: null,
			reason: `Manual time entry: ${facts.reason}`,
			overtimeRisk: "none",
			kind: "manual_time_submission",
			metadata: {},
			submitterUserId: input.actorUserId,
		});
		approval = {
			participation: "manual_time_submission",
			disposition: approvalSubmission.disposition,
			outcome: approvalSubmission.result.kind,
			approvalRequestId: approvalSubmission.result.approvalRequestId,
			submittedRevisionId: approvalSubmission.evidence?.submittedRevisionId ?? null,
		};
		const [after] = await tx
			.select({ approvalStatus: workPeriod.approvalStatus })
			.from(workPeriod)
			.where(and(eq(workPeriod.id, period.id), eq(workPeriod.organizationId, organizationId)))
			.limit(1);
		if (after?.approvalStatus !== "approved" && after?.approvalStatus !== "pending") {
			throw new CompletedWorkIntegrityError("Approval participation left an invalid state");
		}
		committedApprovalState = after.approvalStatus;
	}

	// The earlier of the UTC and captured local start date covers the work's day.
	const utcDate = facts.start.toZonedDateTimeISO("UTC").toPlainDate();
	const localDate = facts.start.toZonedDateTimeISO(facts.timezone).toPlainDate();
	const dirtyFromDate = (
		comparePlainDates(localDate, utcDate) < 0 ? localDate : utcDate
	).toString();
	await markEmployeeWorkBalanceDirty({ employeeId, organizationId, dirtyFromDate }, tx);

	const followUps: CompletedWorkFollowUp[] = [
		{ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate },
		...(requiresApproval
			? [{ kind: "approval_notification" as const, delivery: "approval_owner" as const }]
			: [{ kind: "surcharge_calculation" as const, delivery: "post_commit_best_effort" as const }]),
	];
	const result: ManualWorkResult = {
		version: MANUAL_WORK_RESULT_VERSION,
		operationId: command.submissionId,
		owner: { employeeId },
		actors: {
			requester: { kind: "human", userId: facts.targetUserId },
			submitting: { kind: "human", userId: input.actorUserId },
		},
		workPeriodId: period.id,
		clockInEntryId: clockIn.entry.id,
		clockOutEntryId: clockOut.entry.id,
		canonicalRecordId: record.id,
		interpretation: {
			evaluatedAt: instantToCanonicalString(facts.evaluatedAt),
			timezone: facts.timezone,
			captureSource: facts.captureSource,
			targetZone: facts.targetZone,
			onBehalf: !facts.isOwnEntry,
			daysBack: facts.daysBack,
			policy: facts.policy,
			approvalIntent: facts.approval,
		},
		segment: {
			startAt: instantToCanonicalString(facts.start),
			endAt: instantToCanonicalString(facts.end),
			durationMinutes: facts.durationMinutes,
			startUtcOffsetMinutes: facts.startOffsetMinutes,
			endUtcOffsetMinutes: facts.endOffsetMinutes,
		},
		attribution: { projectId: facts.projectId, workCategoryId: facts.workCategoryId },
		revisions: { workPeriod: { source: null, result: resultRevision } },
		append: {
			admission: "append",
			previousEntryId: clockIn.previousEntryId,
			previousHash: clockIn.previousHash,
			tipEntryId: clockOut.entry.id,
		},
		approvalState: committedApprovalState,
		approval,
		followUps,
	};
	await tx.insert(completedWorkOperation).values({
		id: command.submissionId,
		organizationId,
		employeeId,
		kind: MANUAL_KIND,
		writer: "manual_entry",
		writerVersion: MANUAL_ENTRY_WRITER_VERSION,
		commandVersion: command.version,
		command,
		appendAdmission: "append",
		actorKind: "human",
		actorUserId: input.actorUserId,
		workPeriodId: period.id,
		resultVersion: MANUAL_WORK_RESULT_VERSION,
		result,
	});
	return {
		kind: "executed",
		result,
		approvalSubmission,
		surchargeSnapshot: requiresApproval ? null : surchargeSnapshot,
	};
}
