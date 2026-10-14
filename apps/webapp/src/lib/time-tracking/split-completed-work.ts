import "server-only";

/**
 * Completed-work operation for calendar splits (#304 / T40, design #256).
 *
 * One call inside the completed-work work transaction splits one completed
 * period of the owner at an exact instant. The split owns its caller policy:
 * current owner authority, the unresolved-review guard, refusing work awaiting
 * approval, and the committed receipt with its exact replay. Work records
 * divides the work period and its canonical work record, appends the entries
 * and applies the effects (ADR 0010); this operation states only where to
 * divide, the notes and the odometer value at the split.
 *
 * Exact replay of a committed receipt writes nothing, and a receipt whose work
 * has since changed or been deleted is a collision. In legacy admission the
 * split runs the same policy and division without a receipt
 * (`splitLegacyCompletedWork`, #1219).
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { completedWorkOperation, timeEntry, workPeriod } from "@/db/schema";
import { type Instant, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError } from "@/lib/effect/errors";
import { lockAuthority } from "./amend-completed-work";
import { canonicalJson } from "./canonical-json";
import {
	CompletedWorkCollisionError,
	type CompletedWorkFollowUp,
	CompletedWorkIntegrityError,
} from "./close-active-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import type { TimeEntryTimezoneCapture } from "./timezone-capture";
import {
	applyWorkRecordChange,
	orRefuse,
	readWorkRecord,
	type WorkDivision,
	type WorkRecordExpected,
	type WorkSegment,
} from "./work-records";
import { assertNoUnresolvedWorkPeriodReview } from "./work-period-review";
import type { SealedWorkTransactionScope } from "./work-transaction";

export const SPLIT_COMPLETED_WORK_COMMAND_VERSION = 1;
export const SPLIT_COMPLETED_WORK_RESULT_VERSION = 1;
export const WORK_PERIOD_SPLIT_WRITER_VERSION = 1;

/**
 * Versioned request evidence: the calendar request exactly as submitted, before
 * the server resolves the wall-clock split in the owner's zone. A retry must
 * carry exactly the same command.
 */
export type SplitCompletedWorkCommand = {
	version: typeof SPLIT_COMPLETED_WORK_COMMAND_VERSION;
	operationId: string;
	request: {
		workPeriodId: string;
		splitDate: string;
		splitTime: string;
		disambiguation: "earlier" | "later" | null;
		beforeNotes: string | null;
		afterNotes: string | null;
		/**
		 * The one value asked at the split of work with vehicle use (#1126): the
		 * odometer reading at the split, or the first half's km of a directly entered
		 * distance. Present only when given, keeping earlier commands' bytes.
		 */
		vehicleSplitKm?: number;
	};
};

/** One segment by value: committed evidence, not a pointer to current rows. */
export type SplitSegment = WorkSegment;

/** Committed result (receipt version 1). Current state is a separate read. */
export type SplitCompletedWorkResult = {
	version: typeof SPLIT_COMPLETED_WORK_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actor: { kind: "human"; userId: string };
	authority: "owner";
	split: TimeEntryTimezoneCapture & { at: string };
	/** The source exactly as the operation locked it. */
	source: SplitSegment & { approvalState: string; recordCreatedBy: string };
	segments: [
		SplitSegment & { role: "retained" },
		SplitSegment & {
			role: "generated";
			origin: { workPeriodId: string; canonicalRecordId: string };
			/** Inherited from the source; no new decision is recorded. */
			approval: { state: string; basis: "split_source"; sourceDecisionIds: string[] };
		},
	];
	notes: { sourceClockOut: string | null; before: string | null; after: string | null };
	append: {
		admission: "append";
		clockOut: { entryId: string; previousEntryId: string | null; previousHash: string | null };
		clockIn: { entryId: string; previousEntryId: string; previousHash: string };
	};
	revisions: {
		source: { source: number; result: number };
		generated: { source: null; result: number };
	};
	followUps: CompletedWorkFollowUp[];
};

export type SplitCompletedWorkReceipt = {
	disposition: "executed" | "replayed";
	result: SplitCompletedWorkResult;
};

export type SplitCompletedWorkInput = {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	command: SplitCompletedWorkCommand;
	/** The resolved split instant and its capture in the zone it was resolved in. */
	splitAt: Instant;
	capture: TimeEntryTimezoneCapture;
	/**
	 * The work the caller validated and showed. Work records compares it under
	 * its locks; any difference is a stale source.
	 */
	expected: WorkRecordExpected;
	request: { ipAddress: string | null; deviceInfo: string | null };
};

type TransactionClient = SealedWorkTransactionScope["db"];

type ReplayInput = Pick<
	SplitCompletedWorkInput,
	"organizationId" | "employeeId" | "actorUserId" | "command"
>;

/**
 * Exact receipt replay, in every admission mode. Returns null when no receipt
 * exists for the identity. Any mismatch in scope, kind, writer, actor or command
 * is a collision, and so is committed work that no longer stands as committed.
 */
export async function replaySplitCompletedWork(
	scope: SealedWorkTransactionScope,
	input: ReplayInput,
): Promise<SplitCompletedWorkReceipt | null> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	const [receipt] = await scope.db
		.select()
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, input.command.operationId))
		.limit(1);
	if (!receipt) return null;
	if (
		receipt.organizationId !== input.organizationId ||
		receipt.employeeId !== input.employeeId ||
		receipt.kind !== "split_completed_work" ||
		receipt.writer !== "work_period_split" ||
		receipt.actorUserId !== input.actorUserId ||
		receipt.commandVersion !== input.command.version ||
		canonicalJson(receipt.command) !== canonicalJson(input.command)
	) {
		throw new CompletedWorkCollisionError();
	}
	if (receipt.resultVersion !== SPLIT_COMPLETED_WORK_RESULT_VERSION) {
		throw new CompletedWorkIntegrityError("Unsupported completed-work receipt version");
	}
	const result = receipt.result as SplitCompletedWorkResult;
	// Replay keeps current access rules: the actor must still own the work.
	await lockAuthority(scope.db, { ...input, authority: "owner" });
	if (!(await isSplitStanding(scope.db, input, result))) {
		throw new CompletedWorkCollisionError();
	}
	return { disposition: "replayed", result };
}

/** Whether both committed segments still stand with the entries the receipt names. */
async function isSplitStanding(
	tx: TransactionClient,
	scope: { organizationId: string; employeeId: string },
	result: SplitCompletedWorkResult,
): Promise<boolean> {
	const periods = await tx
		.select({
			id: workPeriod.id,
			clockInId: workPeriod.clockInId,
			clockOutId: workPeriod.clockOutId,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, scope.organizationId),
				eq(workPeriod.employeeId, scope.employeeId),
				isNull(workPeriod.deletedAt),
				inArray(
					workPeriod.id,
					result.segments.map(({ workPeriodId }) => workPeriodId),
				),
			),
		);
	const entryIds = [result.append.clockOut.entryId, result.append.clockIn.entryId];
	const entries = await tx
		.select({ id: timeEntry.id, isSuperseded: timeEntry.isSuperseded })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, scope.organizationId),
				eq(timeEntry.employeeId, scope.employeeId),
				inArray(timeEntry.id, entryIds),
			),
		);
	return (
		result.segments.every((segment) =>
			periods.some(
				(period) =>
					period.id === segment.workPeriodId &&
					period.clockInId === segment.clockInEntryId &&
					period.clockOutId === segment.clockOutEntryId,
			),
		) &&
		entries.length === entryIds.length &&
		entries.every((entry) => !entry.isSuperseded)
	);
}

/**
 * Lookup-only replay before an adapter's fresh preflight: finds a committed
 * receipt for the identity in the organization and replays it under the
 * coordinated transaction of the receipt's employee. Returns null when nothing
 * was committed with this identity; never creates or repairs anything.
 */
export async function replayCommittedSplit(
	input: Omit<ReplayInput, "employeeId">,
): Promise<SplitCompletedWorkReceipt | null> {
	const [receipt] = await db
		.select({ employeeId: completedWorkOperation.employeeId })
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.id, input.command.operationId),
				eq(completedWorkOperation.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!receipt) return null;
	return withCompletedWorkTransaction(
		{
			organizationId: input.organizationId,
			employeeId: receipt.employeeId,
			actorUserId: input.actorUserId,
		},
		(scope) => replaySplitCompletedWork(scope, { ...input, employeeId: receipt.employeeId }),
	);
}

/**
 * Fresh split. The caller has already ruled out committed replay under the same
 * transaction, so an existing receipt with this identity is a collision.
 */
export async function splitCompletedWork(
	scope: SealedWorkTransactionScope,
	input: SplitCompletedWorkInput,
): Promise<SplitCompletedWorkReceipt> {
	const { organizationId, employeeId, command } = input;
	scope.assertEmployee(organizationId, employeeId);
	if (scope.admission !== "append") {
		throw new Error("Completed-work split requires the adopted work transaction");
	}
	const tx = scope.db;
	const [existing] = await tx
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, command.operationId))
		.limit(1);
	if (existing) throw new CompletedWorkCollisionError();

	const division = await divideForSplit(scope, input);
	const result = splitResult(input, division);
	await tx.insert(completedWorkOperation).values({
		id: command.operationId,
		organizationId,
		employeeId,
		kind: "split_completed_work",
		writer: "work_period_split",
		writerVersion: WORK_PERIOD_SPLIT_WRITER_VERSION,
		commandVersion: command.version,
		command,
		appendAdmission: "append",
		actorKind: "human",
		actorUserId: input.actorUserId,
		// The split source; the generated period is in the result.
		workPeriodId: division.source.segment.workPeriodId,
		resultVersion: SPLIT_COMPLETED_WORK_RESULT_VERSION,
		result,
	});
	return { disposition: "executed", result };
}

/**
 * The split of an organization in legacy admission (#1219): the same caller
 * policy and the same division through work records, whose legacy writer
 * appends the entries. Legacy admission commits no receipt, so a retry is not
 * recognized; the split action chooses by admission until admission is hidden.
 */
export async function splitLegacyCompletedWork(
	scope: SealedWorkTransactionScope,
	input: SplitCompletedWorkInput,
): Promise<WorkDivision> {
	scope.assertEmployee(input.organizationId, input.employeeId);
	if (scope.admission !== "legacy") {
		throw new Error("Legacy completed-work split requires the legacy work transaction");
	}
	return divideForSplit(scope, input);
}

/**
 * The split's caller policy, then the division: current owner authority, the
 * unresolved-review guard and refusing work awaiting approval, on exactly the
 * rows work records will change, locked.
 */
async function divideForSplit(
	scope: SealedWorkTransactionScope,
	input: SplitCompletedWorkInput,
): Promise<WorkDivision> {
	const { organizationId, employeeId, command } = input;
	const tx = scope.db;
	await lockAuthority(tx, { ...input, authority: "owner" });

	const current = await readWorkRecord(
		scope,
		{ organizationId, employeeId, workPeriodId: command.request.workPeriodId },
		{ lock: true },
	);
	if (!current) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: command.request.workPeriodId,
		});
	}
	// A split is a structural change: it waits while any review of the period is open.
	await assertNoUnresolvedWorkPeriodReview(tx, organizationId, current.period);
	// Work under review is never split; a split never promotes pending work.
	if (
		current.period.approvalStatus === "pending" ||
		current.canonical?.record.approvalState === "pending"
	) {
		throw new ConflictError({
			message: "This work period is awaiting approval and cannot be edited",
			conflictType: "work_period_pending_approval",
		});
	}

	const { beforeNotes, afterNotes } = command.request;
	return orRefuse(
		await applyWorkRecordChange(scope, {
			kind: "divide",
			organizationId,
			employeeId,
			expected: input.expected,
			at: input.splitAt,
			notes: { before: beforeNotes, after: afterNotes },
			odometerKm: command.request.vehicleSplitKm,
			actorUserId: input.actorUserId,
			entries: {
				createdBy: input.actorUserId,
				ipAddress: input.request.ipAddress,
				deviceInfo: input.request.deviceInfo,
				capture: input.capture,
			},
			appendOperation: "completed_work_split",
		}),
	);
}

/** The split's receipt, built from work records' division. */
function splitResult(
	input: SplitCompletedWorkInput,
	division: WorkDivision,
): SplitCompletedWorkResult {
	const { source, retained, generated, appended } = division;
	const { previousEntryId, previousHash } = appended.clockIn;
	if (!previousEntryId || !previousHash) {
		throw new CompletedWorkIntegrityError("Split clock-in has no predecessor");
	}
	return {
		version: SPLIT_COMPLETED_WORK_RESULT_VERSION,
		operationId: input.command.operationId,
		owner: { employeeId: input.employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		authority: "owner",
		split: { at: instantToCanonicalString(input.splitAt), ...input.capture },
		source: {
			...source.segment,
			approvalState: source.approvalState,
			recordCreatedBy: source.recordCreatedBy,
		},
		segments: [
			{ role: "retained", ...retained.segment },
			{
				role: "generated",
				...generated.segment,
				origin: {
					workPeriodId: source.segment.workPeriodId,
					canonicalRecordId: source.segment.canonicalRecordId,
				},
				approval: {
					state: source.recordApprovalState,
					basis: "split_source",
					sourceDecisionIds: source.decisionIds,
				},
			},
		],
		notes: {
			sourceClockOut: source.clockOutNotes,
			before: input.command.request.beforeNotes,
			after: input.command.request.afterNotes,
		},
		append: {
			admission: "append",
			clockOut: {
				entryId: appended.clockOut.entryId,
				previousEntryId: appended.clockOut.previousEntryId,
				previousHash: appended.clockOut.previousHash,
			},
			clockIn: { entryId: appended.clockIn.entryId, previousEntryId, previousHash },
		},
		revisions: {
			source: { source: source.revision, result: retained.after.revision },
			generated: { source: null, result: generated.after.revision },
		},
		followUps: [
			{
				kind: "work_balance_refresh",
				delivery: "committed_intent",
				dirtyFromDate: division.effects.workBalanceDirtyFromDate,
			},
			{ kind: "surcharge_calculation", delivery: "post_commit_best_effort" },
		],
	};
}
