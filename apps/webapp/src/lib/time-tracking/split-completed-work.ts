import "server-only";

/**
 * Completed-work operation for calendar splits (#304 / T40, design #256).
 *
 * One call inside the completed-work outer transaction splits one completed
 * period of the owner at an exact instant. It owns the authoritative locked
 * reads, current owner authority, the unresolved-review guard, symmetric
 * occupancy, the two split entries through the append collaborator, the
 * retained and generated periods, canonical records, work details and
 * allocations, the work revisions, the work-balance refresh intent and the
 * committed receipt. Callers supply intent and evidence, never durations,
 * links or storage patches.
 *
 * Each segment rounds its own exact UTC elapsed time (#252 §2). The generated
 * segment inherits the source's approval state and names the source's decision
 * lineage; a split never promotes pending work, because pending work is under
 * review and refused. Exact replay of a committed receipt writes nothing, and a
 * receipt whose work has since changed or been deleted is a collision.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
	completedWorkOperation,
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { CompletedWorkReviewRequiredError, lockAuthority } from "./amend-completed-work";
import { calculateHash } from "./blockchain";
import { canonicalJson } from "./canonical-json";
import {
	CompletedWorkCollisionError,
	type CompletedWorkFollowUp,
	CompletedWorkIntegrityError,
	earliestStartDate,
} from "./close-active-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { planCompletedWorkSplit } from "./split-work-period";
import { admitTimeEntryAppend, TimeEntryAppendReviewRequiredError } from "./time-entry-append";
import type { TimeEntryTimezoneCapture } from "./timezone-capture";
import { WorkIntervalError } from "./work-duration";
import { assertWorkOccupancyFree } from "./work-occupancy";
import { assertNoUnresolvedWorkPeriodReview } from "./work-period-review";
import type { WorkTransactionScope } from "./work-transaction";

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
	};
};

type AllocationEvidence = {
	allocationKind: string;
	projectId: string | null;
	costCenterId: string | null;
	weightPercent: number;
};

/** One segment by value: committed evidence, not a pointer to current rows. */
export type SplitSegment = {
	workPeriodId: string;
	canonicalRecordId: string;
	clockInEntryId: string;
	clockOutEntryId: string;
	startAt: string;
	endAt: string;
	durationMinutes: number;
	startUtcOffsetMinutes: number | null;
	endUtcOffsetMinutes: number | null;
	attribution: {
		projectId: string | null;
		workCategoryId: string | null;
		workLocationType: string | null;
		allocations: AllocationEvidence[];
	};
};

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
	 * The period state the caller validated and showed. The operation re-reads it
	 * under its locks; any difference is a stale source.
	 */
	expectedSource: { clockInId: string; clockOutId: string; startAt: Instant; endAt: Instant };
	request: { ipAddress: string | null; deviceInfo: string | null };
};

type TransactionClient = WorkTransactionScope["db"];

function staleSource(): ConflictError {
	return new ConflictError({
		message: "Work period changed while editing",
		conflictType: "time_correction_work_period_stale",
	});
}

function sameInstant(left: Date | null, right: Instant): boolean {
	return left !== null && compareInstants(instantFromDate(left), right) === 0;
}

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
	scope: WorkTransactionScope,
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
	scope: WorkTransactionScope,
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

	await lockAuthority(tx, { ...input, authority: "owner" });

	// Authoritative source: the routed period, its entries and its canonical graph, locked.
	const [period] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, command.request.workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.for("update");
	if (!period) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: command.request.workPeriodId,
		});
	}
	if (
		period.clockInId !== input.expectedSource.clockInId ||
		period.clockOutId !== input.expectedSource.clockOutId ||
		!sameInstant(period.startTime, input.expectedSource.startAt) ||
		!sameInstant(period.endTime, input.expectedSource.endAt)
	) {
		throw staleSource();
	}
	if (period.isActive || !period.endTime || !period.clockOutId) {
		throw new ConflictError({
			message: "Cannot split an active work period",
			conflictType: "work_period_running",
		});
	}
	// A split is a structural change: it waits while any review of the period is open.
	await assertNoUnresolvedWorkPeriodReview(tx, organizationId, period);

	const originals = await tx
		.select()
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.organizationId, organizationId),
				eq(timeEntry.employeeId, employeeId),
				inArray(timeEntry.id, [period.clockInId, period.clockOutId]),
			),
		)
		.orderBy(asc(timeEntry.id))
		.for("update");
	const sourceClockIn = originals.find(({ id }) => id === period.clockInId);
	const sourceClockOut = originals.find(({ id }) => id === period.clockOutId);
	if (!sourceClockIn || !sourceClockOut) {
		throw new CompletedWorkReviewRequiredError("endpoint_entry_missing");
	}
	if (sourceClockIn.isSuperseded || sourceClockOut.isSuperseded) {
		throw new ConflictError({
			message: "Time entry was already corrected by another process",
			conflictType: "time_entry_already_corrected",
		});
	}

	// The period and its canonical record must describe the same segment before
	// this operation divides both; divergence is evidence for review, not repair.
	if (!period.canonicalRecordId) {
		throw new CompletedWorkReviewRequiredError("canonical_record_missing");
	}
	const [record] = await tx
		.select()
		.from(timeRecord)
		.where(
			and(
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.for("update");
	const [detail] = await tx
		.select()
		.from(timeRecordWork)
		.where(
			and(
				eq(timeRecordWork.recordId, period.canonicalRecordId),
				eq(timeRecordWork.organizationId, organizationId),
				eq(timeRecordWork.recordKind, "work"),
			),
		)
		.for("update");
	const allocations = await tx
		.select()
		.from(timeRecordAllocation)
		.where(
			and(
				eq(timeRecordAllocation.recordId, period.canonicalRecordId),
				eq(timeRecordAllocation.organizationId, organizationId),
			),
		)
		.orderBy(asc(timeRecordAllocation.id))
		.for("update");
	if (!record || !detail) throw new CompletedWorkReviewRequiredError("canonical_record_missing");
	// A canonical record still under review is review, even when the period lags.
	if (record.approvalState === "pending") {
		throw new ConflictError({
			message: "This work period is awaiting approval and cannot be edited",
			conflictType: "work_period_pending_approval",
		});
	}
	const projectAllocations = allocations.filter(
		({ allocationKind }) => allocationKind === "project",
	);
	const allocationAgrees = period.projectId
		? projectAllocations.length === 1 &&
			projectAllocations[0]?.projectId === period.projectId &&
			projectAllocations[0]?.weightPercent === 100
		: projectAllocations.length === 0;
	const sourceStart = instantFromDate(period.startTime);
	const sourceEnd = instantFromDate(period.endTime);
	if (
		!sameInstant(record.startAt, sourceStart) ||
		!sameInstant(record.endAt, sourceEnd) ||
		detail.workCategoryId !== period.workCategoryId ||
		detail.workLocationType !== period.workLocationType ||
		!allocationAgrees
	) {
		throw new CompletedWorkReviewRequiredError("canonical_divergence");
	}
	if (period.durationMinutes === null) {
		throw new CompletedWorkReviewRequiredError("canonical_divergence");
	}

	let plan: ReturnType<typeof planCompletedWorkSplit>;
	try {
		plan = planCompletedWorkSplit({
			startAt: sourceStart,
			endAt: sourceEnd,
			splitAt: input.splitAt,
		});
	} catch (error) {
		if (error instanceof WorkIntervalError) {
			throw new ValidationError({
				message: "Split time must be between work period start and end times",
				field: "splitTime",
			});
		}
		throw error;
	}
	// Symmetric occupancy: both resulting segments, which together cover the
	// source interval, against every other work of the owner.
	await assertWorkOccupancyFree(tx, {
		organizationId,
		employeeId,
		interval: { startAt: sourceStart, endAt: sourceEnd },
		excludeWorkPeriodIds: [period.id],
	});

	const decisions = await tx
		.select({ id: timeRecordApprovalDecision.id })
		.from(timeRecordApprovalDecision)
		.where(
			and(
				eq(timeRecordApprovalDecision.organizationId, organizationId),
				eq(timeRecordApprovalDecision.recordId, record.id),
			),
		)
		.orderBy(asc(timeRecordApprovalDecision.createdAt), asc(timeRecordApprovalDecision.id));

	// Split entries: exact predecessor from the append collaborator.
	const admission = await admitTimeEntryAppend(
		tx,
		{ organizationId, employeeId },
		"completed_work_split",
	);
	if (admission.kind === "review_required") {
		throw new TimeEntryAppendReviewRequiredError(admission.requirement);
	}
	const append = admission.append;
	const splitAtDate = dateFromInstant(input.splitAt);
	const insertEntry = async (
		type: "clock_out" | "clock_in",
		notes: string | null,
		previous: { id: string | null; hash: string | null },
	) => {
		const [entry] = await tx
			.insert(timeEntry)
			.values({
				employeeId,
				organizationId,
				type,
				timestamp: splitAtDate,
				hash: calculateHash({
					employeeId,
					type,
					timestamp: splitAtDate.toISOString(),
					previousHash: previous.hash,
				}),
				previousHash: previous.hash,
				previousEntryId: previous.id,
				notes,
				ipAddress: input.request.ipAddress,
				deviceInfo: input.request.deviceInfo,
				createdBy: input.actorUserId,
				utcOffsetMinutes: input.capture.utcOffsetMinutes,
				timezone: input.capture.timezone,
				timezoneSource: input.capture.timezoneSource,
			})
			.returning();
		if (!entry) throw new Error("Split entry insert failed");
		await append.record({
			id: entry.id,
			hash: entry.hash,
			previousEntryId: previous.id,
			previousHash: previous.hash,
		});
		return entry;
	};
	const { beforeNotes, afterNotes } = command.request;
	const splitClockOut = await insertEntry("clock_out", beforeNotes, {
		id: append.predecessor?.id ?? null,
		hash: append.predecessor?.hash ?? null,
	});
	const splitClockIn = await insertEntry("clock_in", afterNotes, {
		id: splitClockOut.id,
		hash: splitClockOut.hash,
	});
	// Period notes are read from the clock-out entry, and the generated period
	// keeps the source clock-out; notes are not part of the entry hash.
	if (afterNotes !== null) {
		const updatedNotes = await tx
			.update(timeEntry)
			.set({ notes: afterNotes })
			.where(
				and(
					eq(timeEntry.id, sourceClockOut.id),
					eq(timeEntry.organizationId, organizationId),
					eq(timeEntry.employeeId, employeeId),
					eq(timeEntry.isSuperseded, false),
				),
			)
			.returning({ id: timeEntry.id });
		if (updatedNotes.length !== 1) throw staleSource();
	}

	const updatedAt = new Date();
	const sourceRevision = period.graphRevision + 1;
	const updatedPeriods = await tx
		.update(workPeriod)
		.set({
			clockOutId: splitClockOut.id,
			endTime: splitAtDate,
			durationMinutes: plan.first.durationMinutes,
			graphRevision: sourceRevision,
			updatedAt,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.clockInId, period.clockInId),
				eq(workPeriod.clockOutId, period.clockOutId),
				eq(workPeriod.graphRevision, period.graphRevision),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (updatedPeriods.length !== 1) throw staleSource();

	const updatedRecords = await tx
		.update(timeRecord)
		.set({
			endAt: splitAtDate,
			durationMinutes: plan.first.durationMinutes,
			updatedAt,
			updatedBy: input.actorUserId,
		})
		.where(
			and(
				eq(timeRecord.id, record.id),
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.employeeId, employeeId),
				eq(timeRecord.recordKind, "work"),
			),
		)
		.returning({ id: timeRecord.id });
	if (updatedRecords.length !== 1) {
		throw new CompletedWorkIntegrityError("Canonical work record update failed");
	}

	// The generated record keeps the source's origin, approval state and
	// recording actor; the splitting human is its updater.
	const generatedRecordId = randomUUID();
	await tx.insert(timeRecord).values({
		id: generatedRecordId,
		organizationId,
		employeeId,
		recordKind: "work",
		startAt: splitAtDate,
		endAt: period.endTime,
		durationMinutes: plan.second.durationMinutes,
		approvalState: record.approvalState,
		origin: record.origin,
		createdBy: record.createdBy,
		updatedAt,
		updatedBy: input.actorUserId,
	});
	await tx.insert(timeRecordWork).values({
		recordId: generatedRecordId,
		organizationId,
		recordKind: "work",
		workCategoryId: detail.workCategoryId,
		workLocationType: detail.workLocationType,
		computationMetadata: detail.computationMetadata,
	});
	for (const allocation of allocations) {
		await tx.insert(timeRecordAllocation).values({
			organizationId,
			recordId: generatedRecordId,
			allocationKind: allocation.allocationKind,
			projectId: allocation.projectId,
			costCenterId: allocation.costCenterId,
			weightPercent: allocation.weightPercent,
		});
	}
	const [generated] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: splitClockIn.id,
			clockOutId: period.clockOutId,
			projectId: period.projectId,
			workCategoryId: period.workCategoryId,
			workLocationType: period.workLocationType,
			startTime: splitAtDate,
			endTime: period.endTime,
			durationMinutes: plan.second.durationMinutes,
			isActive: false,
			approvalStatus: period.approvalStatus,
			canonicalRecordId: generatedRecordId,
			graphRevision: 1,
			updatedAt,
		})
		.returning({ id: workPeriod.id, graphRevision: workPeriod.graphRevision });
	if (!generated) throw new Error("Generated work period insert failed");

	// Independent rounding can change the total: the refresh commits with the work,
	// from the earliest UTC or captured-offset local date of the affected endpoints.
	const [dirtyFromDate] = [
		earliestStartDate(sourceStart, sourceClockIn.utcOffsetMinutes ?? 0),
		earliestStartDate(input.splitAt, input.capture.utcOffsetMinutes),
	].sort();
	if (!dirtyFromDate) throw new Error("Work balance refresh date is missing");
	await markEmployeeWorkBalanceDirty({ employeeId, organizationId, dirtyFromDate }, tx);
	const followUps: CompletedWorkFollowUp[] = [
		{ kind: "work_balance_refresh", delivery: "committed_intent", dirtyFromDate },
		{ kind: "surcharge_calculation", delivery: "post_commit_best_effort" },
	];

	const attribution = {
		projectId: period.projectId,
		workCategoryId: period.workCategoryId,
		workLocationType: period.workLocationType,
		allocations: allocations.map((allocation) => ({
			allocationKind: allocation.allocationKind,
			projectId: allocation.projectId,
			costCenterId: allocation.costCenterId,
			weightPercent: allocation.weightPercent,
		})),
	};
	const segment = (values: {
		workPeriodId: string;
		canonicalRecordId: string;
		clockIn: typeof timeEntry.$inferSelect;
		clockOut: typeof timeEntry.$inferSelect;
		startAt: Instant;
		endAt: Instant;
		durationMinutes: number;
	}): SplitSegment => ({
		workPeriodId: values.workPeriodId,
		canonicalRecordId: values.canonicalRecordId,
		clockInEntryId: values.clockIn.id,
		clockOutEntryId: values.clockOut.id,
		startAt: instantToCanonicalString(values.startAt),
		endAt: instantToCanonicalString(values.endAt),
		durationMinutes: values.durationMinutes,
		startUtcOffsetMinutes: values.clockIn.utcOffsetMinutes ?? null,
		endUtcOffsetMinutes: values.clockOut.utcOffsetMinutes ?? null,
		attribution,
	});
	const result: SplitCompletedWorkResult = {
		version: SPLIT_COMPLETED_WORK_RESULT_VERSION,
		operationId: command.operationId,
		owner: { employeeId },
		actor: { kind: "human", userId: input.actorUserId },
		authority: "owner",
		split: { at: instantToCanonicalString(input.splitAt), ...input.capture },
		source: {
			...segment({
				workPeriodId: period.id,
				canonicalRecordId: record.id,
				clockIn: sourceClockIn,
				clockOut: sourceClockOut,
				startAt: sourceStart,
				endAt: sourceEnd,
				durationMinutes: period.durationMinutes,
			}),
			approvalState: period.approvalStatus,
			recordCreatedBy: record.createdBy,
		},
		segments: [
			{
				role: "retained",
				...segment({
					workPeriodId: period.id,
					canonicalRecordId: record.id,
					clockIn: sourceClockIn,
					clockOut: splitClockOut,
					...plan.first,
				}),
			},
			{
				role: "generated",
				...segment({
					workPeriodId: generated.id,
					canonicalRecordId: generatedRecordId,
					clockIn: splitClockIn,
					clockOut: sourceClockOut,
					...plan.second,
				}),
				origin: { workPeriodId: period.id, canonicalRecordId: record.id },
				approval: {
					state: record.approvalState,
					basis: "split_source",
					sourceDecisionIds: decisions.map(({ id }) => id),
				},
			},
		],
		notes: { sourceClockOut: sourceClockOut.notes ?? null, before: beforeNotes, after: afterNotes },
		append: {
			admission: "append",
			clockOut: {
				entryId: splitClockOut.id,
				previousEntryId: splitClockOut.previousEntryId,
				previousHash: splitClockOut.previousHash,
			},
			clockIn: {
				entryId: splitClockIn.id,
				previousEntryId: splitClockOut.id,
				previousHash: splitClockOut.hash,
			},
		},
		revisions: {
			source: { source: period.graphRevision, result: sourceRevision },
			generated: { source: null, result: generated.graphRevision },
		},
		followUps,
	};
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
		workPeriodId: period.id,
		resultVersion: SPLIT_COMPLETED_WORK_RESULT_VERSION,
		result,
	});
	return { disposition: "executed", result };
}
