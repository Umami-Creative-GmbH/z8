/**
 * Completed-work participation of approval-based correction lifecycles (#301 / T37).
 *
 * Correction submission, finalization (approval, rejection and business
 * deletion) and cancellation keep their established approval ownership. In an
 * organization whose append control is active they additionally commit, in the
 * same coordinated transaction:
 *
 * - pending correction entries through the internal append collaborator
 *   (operation `time_correction_submission`), never from the latest-created row;
 * - a `graph_revision` advance on the corrected period for every lifecycle
 *   transition, with a compare-and-set on the revision the transition read;
 * - a `completed_work_operation` receipt per transition (`submit_time_correction`,
 *   `finalize_time_correction`, `cancel_time_correction`) holding the baseline,
 *   the requested change mask and intent, and the actual resulting graph;
 * - retained correction entries on rejection and cancellation, whose inactive
 *   meaning (`rejected_inactive`, `cancelled_inactive`) the receipt records.
 *   Committed entries are never deleted: they may already be append predecessors.
 *
 * Organizations without an active append control keep the established writes.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Cause, Runtime } from "effect";
import { completedWorkOperation, workPeriod } from "@/db/schema";
import type { CompletedWorkWriter } from "@/db/schema/completed-work";
import type { Instant } from "@/lib/datetime/temporal-core";
import { ConflictError } from "@/lib/effect/errors";
import { canonicalJson } from "./canonical-json";
import type { CompletedWorkFollowUp } from "./close-active-work";
import { CompletedWorkCollisionError, CompletedWorkIntegrityError } from "./close-active-work";
import {
	admitTimeEntryAppend,
	type TimeEntryAppend,
	TimeEntryAppendReviewRequiredError,
} from "./time-entry-append";
import { deriveWorkDurationMinutes } from "./work-duration";
import { WorkOccupancyConflictError } from "./work-occupancy";
import {
	type WorkTransactionClient,
	type WorkTransactionScope,
	workTransactionScopeFor,
} from "./work-transaction";

export const TIME_CORRECTION_OPERATION_COMMAND_VERSION = 1;
export const TIME_CORRECTION_OPERATION_RESULT_VERSION = 1;
export const TIME_CORRECTION_WRITER_VERSION = 1;

const OPERATION_NAMESPACE = "z8:time-correction-operation:v1";

export type TimeCorrectionOperationStage = "submit" | "finalize" | "cancel";

export type TimeCorrectionIntentKind = "edit" | "metadata_only" | "delete";

/** Which fields the proposal changes, relative to its captured baseline. */
export type TimeCorrectionChangeMask = {
	clockIn: boolean;
	clockOut: boolean;
	workLocation: boolean;
	workCategory: boolean;
};

/** The approval lifecycle a transition belongs to, as the authority stores it. */
export type TimeCorrectionLifecycleReference =
	| { authority: "canonical"; workflowId: string }
	| {
			authority: "legacy";
			approvalRequestId: string;
			chainInstanceId: string | null;
			/** A shadow workflow observed alongside the legacy lifecycle, never its authority. */
			observedWorkflowId: string | null;
	  };

export type TimeCorrectionEntryMeaning =
	| "pending"
	| "active"
	| "rejected_inactive"
	| "cancelled_inactive";

export type TimeCorrectionEntryEvidence = {
	endpoint: "clock_in" | "clock_out";
	entryId: string;
	replacesEntryId: string;
	meaning: TimeCorrectionEntryMeaning;
};

/** A work segment by value: committed evidence, not a pointer to current rows. */
export type TimeCorrectionSegment = {
	clockInEntryId: string;
	clockOutEntryId: string | null;
	startAt: string;
	endAt: string | null;
	durationMinutes: number | null;
	startUtcOffsetMinutes: number | null;
	endUtcOffsetMinutes: number | null;
	attribution: {
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
	};
};

export type RequestedCorrectionEndpoint = {
	originalEntryId: string;
	at: string;
	utcOffsetMinutes: number;
	timezone: string;
	timezoneSource: string;
};

export type SubmitTimeCorrectionResult = {
	version: typeof TIME_CORRECTION_OPERATION_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	workPeriodId: string;
	canonicalRecordId: string | null;
	intent: TimeCorrectionIntentKind;
	changeMask: TimeCorrectionChangeMask;
	/** The requester-owned period exactly as the submission locked it. */
	baseline: TimeCorrectionSegment;
	/**
	 * Requested values. An endpoint is null when unchanged; metadata keys are
	 * present only when the proposal carries them (current contract), so an
	 * explicit null category stays distinct from an unchanged one.
	 */
	requested: {
		clockIn: RequestedCorrectionEndpoint | null;
		clockOut: RequestedCorrectionEndpoint | null;
		workLocationType?: string | null;
		workCategoryId?: string | null;
	};
	corrections: Array<
		TimeCorrectionEntryEvidence & { previousEntryId: string | null; previousHash: string | null }
	>;
	revisions: { workPeriod: { source: number; result: number } };
	approval: {
		lifecycle: TimeCorrectionLifecycleReference;
		outcome: "pending" | "auto_completed";
	};
};

export type FinalizeTimeCorrectionResult = {
	version: typeof TIME_CORRECTION_OPERATION_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	workPeriodId: string;
	canonicalRecordId: string | null;
	lifecycle: TimeCorrectionLifecycleReference;
	transition: "approved" | "rejected";
	intent: TimeCorrectionIntentKind;
	source: TimeCorrectionSegment;
	/** The actual resulting graph, read from what this transition wrote. */
	result:
		| { kind: "unchanged" }
		| { kind: "amended"; segment: TimeCorrectionSegment }
		| {
				kind: "deleted";
				deletedAt: string;
				/** The zero-length canonical sentinel the deletion leaves. */
				sentinel: TimeCorrectionSegment;
		  };
	corrections: TimeCorrectionEntryEvidence[];
	revisions: { workPeriod: { source: number; result: number } };
	followUps: CompletedWorkFollowUp[];
};

export type CancelTimeCorrectionResult = {
	version: typeof TIME_CORRECTION_OPERATION_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	workPeriodId: string;
	lifecycle: TimeCorrectionLifecycleReference;
	/** Committed entries kept as append evidence with inactive meaning. */
	retained: TimeCorrectionEntryEvidence[];
	revisions: { workPeriod: { source: number; result: number } };
};

type ReceiptKind = "submit_time_correction" | "finalize_time_correction" | "cancel_time_correction";

const RECEIPT: Record<
	TimeCorrectionOperationStage,
	{ kind: ReceiptKind; writer: CompletedWorkWriter }
> = {
	submit: { kind: "submit_time_correction", writer: "time_correction_request" },
	finalize: { kind: "finalize_time_correction", writer: "time_correction_decision" },
	cancel: { kind: "cancel_time_correction", writer: "time_correction_cancellation" },
};

function uuidFromDigest(value: string): string {
	const bytes = new Uint8Array(createHash("sha1").update(value).digest().subarray(0, 16));
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = Buffer.from(bytes).toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Stable receipt identity of one lifecycle transition. Each lifecycle submits,
 * finalizes and cancels at most once, so a second fresh write of the same
 * transition is a primary-key collision that rolls the transaction back.
 */
export function deriveTimeCorrectionOperationId(input: {
	organizationId: string;
	stage: TimeCorrectionOperationStage;
	/** Submission: the submission key. Otherwise: the lifecycle key. */
	key: string;
}): string {
	return uuidFromDigest(
		`${OPERATION_NAMESPACE}\0${input.organizationId}\0${input.stage}\0${input.key}`,
	);
}

export function timeCorrectionLifecycleKey(lifecycle: TimeCorrectionLifecycleReference): string {
	return lifecycle.authority === "canonical"
		? `canonical:${lifecycle.workflowId}`
		: `legacy:${lifecycle.chainInstanceId ?? lifecycle.approvalRequestId}`;
}

/**
 * The adopted scope a correction transition runs in, or null for the legacy
 * writes. Every production caller opens the coordinated transaction, which
 * registers its scope; the approval engine's adapter entry additionally refuses
 * an adopted organization without one (`correction-work-fence.ts`).
 */
export function resolveCorrectionWorkScope(
	client: object,
	input: { organizationId: string; employeeId: string },
): WorkTransactionScope | null {
	const scope = workTransactionScopeFor(client);
	if (!scope) return null;
	scope.assertEmployee(input.organizationId, input.employeeId);
	return scope.admission === "append" ? scope : null;
}

/** The exact predecessor for pending correction entries, from append evidence. */
export async function admitTimeCorrectionAppend(
	scope: WorkTransactionScope,
	input: { organizationId: string; employeeId: string },
): Promise<TimeEntryAppend> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const admission = await admitTimeEntryAppend(scope.db, input, "time_correction_submission");
	if (admission.kind === "review_required") {
		throw new TimeEntryAppendReviewRequiredError(admission.requirement);
	}
	return admission.append;
}

/** Approved correction minutes: fresh half-up rounding when adopted, legacy floor otherwise. */
export function correctedDurationMinutes(adopted: boolean, start: Instant, end: Instant): number {
	if (adopted) return deriveWorkDurationMinutes(start, end);
	return Math.floor(start.until(end).total("minutes"));
}

/**
 * Advances the period's work revision by one, compare-and-set on the revision
 * the transition read under its locks. Deleted periods advance too: deletion is
 * the transition that changes them.
 */
export async function advanceCorrectionWorkRevision(
	tx: Pick<WorkTransactionClient, "update">,
	input: {
		organizationId: string;
		employeeId: string;
		workPeriodId: string;
		expectedRevision: number;
	},
): Promise<number> {
	const next = input.expectedRevision + 1;
	const updated = await tx
		.update(workPeriod)
		.set({ graphRevision: next })
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.graphRevision, input.expectedRevision),
			),
		)
		.returning({ id: workPeriod.id });
	if (updated.length !== 1) {
		throw new ConflictError({
			message: "Work period changed while processing the correction",
			conflictType: "time_correction_work_period_stale",
		});
	}
	return next;
}

/** The locked period's current revision; the caller already holds the period row lock. */
export async function readCorrectionWorkRevision(
	tx: Pick<WorkTransactionClient, "select">,
	input: { organizationId: string; employeeId: string; workPeriodId: string },
): Promise<number> {
	const [row] = await tx
		.select({ graphRevision: workPeriod.graphRevision })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.employeeId),
			),
		)
		.limit(1);
	if (!row) throw new CompletedWorkIntegrityError("Corrected work period is missing");
	return row.graphRevision;
}

export async function insertTimeCorrectionReceipt(
	tx: Pick<WorkTransactionClient, "insert" | "select">,
	input: {
		organizationId: string;
		employeeId: string;
		actorUserId: string;
		stage: TimeCorrectionOperationStage;
		operationId: string;
		workPeriodId: string;
		command: Record<string, unknown>;
		result: SubmitTimeCorrectionResult | FinalizeTimeCorrectionResult | CancelTimeCorrectionResult;
	},
): Promise<void> {
	const [existing] = await tx
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.operationId))
		.limit(1);
	if (existing) throw new CompletedWorkCollisionError();
	const { kind, writer } = RECEIPT[input.stage];
	await tx.insert(completedWorkOperation).values({
		id: input.operationId,
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		kind,
		writer,
		writerVersion: TIME_CORRECTION_WRITER_VERSION,
		commandVersion: TIME_CORRECTION_OPERATION_COMMAND_VERSION,
		command: { version: TIME_CORRECTION_OPERATION_COMMAND_VERSION, ...input.command },
		appendAdmission: "append",
		actorKind: "human",
		actorUserId: input.actorUserId,
		workPeriodId: input.workPeriodId,
		resultVersion: TIME_CORRECTION_OPERATION_RESULT_VERSION,
		result: input.result as unknown as Record<string, unknown>,
	});
}

/**
 * A committed transition receipt, verified against the scope it must belong to.
 * Returns null when nothing was committed with this identity.
 */
export async function loadTimeCorrectionReceipt(
	tx: Pick<WorkTransactionClient, "select">,
	input: {
		organizationId: string;
		employeeId: string;
		stage: TimeCorrectionOperationStage;
		operationId: string;
		workPeriodId: string;
	},
): Promise<typeof completedWorkOperation.$inferSelect | null> {
	const [receipt] = await tx
		.select()
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.operationId))
		.limit(1);
	if (!receipt) return null;
	const { kind, writer } = RECEIPT[input.stage];
	if (
		receipt.organizationId !== input.organizationId ||
		receipt.employeeId !== input.employeeId ||
		receipt.kind !== kind ||
		receipt.writer !== writer ||
		receipt.workPeriodId !== input.workPeriodId
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== TIME_CORRECTION_OPERATION_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported time correction receipt version");
	}
	return receipt;
}

/**
 * Adopted completed-work outcomes as the established typed conflicts, with the
 * same messages and codes as the direct amendment (#286). Other errors pass.
 */
export function translateCorrectionWorkError(error: unknown): unknown {
	// The legacy decision runs the finalizer inside an Effect program.
	if (Runtime.isFiberFailure(error)) {
		const failure = Cause.squash(error[Runtime.FiberFailureCauseId]);
		const translated = translateCorrectionWorkError(failure);
		return translated === failure ? error : translated;
	}
	if (error instanceof CompletedWorkCollisionError) {
		return new ConflictError({
			message:
				"This change conflicts with an earlier request or changed work. Please refresh and try again.",
			conflictType: "completed_work_collision",
		});
	}
	if (error instanceof WorkOccupancyConflictError) {
		return new ConflictError({ message: error.message, conflictType: "work_interval_occupied" });
	}
	if (error instanceof TimeEntryAppendReviewRequiredError) {
		return new ConflictError({
			message: "This work needs review before it can be changed",
			conflictType: "completed_work_review_required",
		});
	}
	return error;
}

/** Exact command equality for replay matching. */
export function sameCorrectionCommand(
	receipt: typeof completedWorkOperation.$inferSelect,
	command: Record<string, unknown>,
): boolean {
	return (
		canonicalJson(receipt.command) ===
		canonicalJson({ version: TIME_CORRECTION_OPERATION_COMMAND_VERSION, ...command })
	);
}
