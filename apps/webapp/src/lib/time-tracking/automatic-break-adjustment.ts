import "server-only";

/**
 * Ordinary automatic break adjustment (#305 / T41, design #256 §5/§7).
 *
 * After an ordinary (not approval-routed) closure has committed consistent work, a
 * regulation may still owe a break. This module is the one owner of that adjustment
 * for the immediate post-commit path, the departure post-processing and the cron:
 *
 * - Every call runs under the owner's completed-work coordination (a system actor),
 *   re-reads the current period, its revision, its canonical graph, the unresolved-
 *   review guard, occupancy and the break regulation in effect when the work ended,
 *   and then adjusts atomically or writes nothing but its intent.
 * - Adopted organizations (active append control) commit a durable intent with the
 *   closure (`closeActiveWorkGraph`). Unresolved review or another blocker keeps the
 *   intent `deferred`; every later run re-evaluates the current work on any date and
 *   never applies a formerly planned split. A completed adjustment appends both break
 *   entries through the append collaborator, rounds each segment on its own, advances
 *   the source revision, clones the canonical record with its detail and allocations
 *   and writes an `automatic_break_adjustment` receipt with a system actor, the
 *   triggering human and the originating work. A receipt or an adjusted period is
 *   final: no later run regenerates the adjustment.
 * - Legacy organizations keep the established break-enforcement writes, now inside
 *   the coordinated transaction, against a locked unchanged period and behind the
 *   review guard, so a failed adjustment leaves the committed closure intact.
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, exists, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	completedWorkOperation,
	employee,
	timeEntry,
	timeRecord,
	timeRecordAllocation,
	timeRecordApprovalDecision,
	timeRecordWork,
	userSettings,
	type WorkBreakAdjustmentBlocker,
	type WorkPeriodAutoAdjustmentReason,
	workBreakAdjustmentIntent,
	workPeriod,
} from "@/db/schema";
import { timeEntryAppendControl } from "@/db/schema/time-entry-append";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import {
	deriveAutomaticBreakIntentId,
	deriveAutomaticBreakOperationId,
} from "./automatic-break-intent";
import {
	type AutomaticBreakPlan,
	breakMinutesTakenBefore,
	planAutomaticBreak,
} from "./automatic-break-plan";
import { calculateHash } from "./blockchain";
import type { BreakPolicyRegulation } from "./break-policy-calculation";
import {
	type CompletedWorkFollowUp,
	CompletedWorkIntegrityError,
	earliestStartDate,
} from "./close-active-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { resolvePolicyClockOutBreakSnapshotInTransaction } from "./policy-clock-out-break-snapshot";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "./policy-clock-out-surcharge-snapshot";
import { admitTimeEntryAppend } from "./time-entry-append";
import { isValidIanaTimezone, resolveFallbackTimezoneCapture } from "./timezone-capture";
import { assertWorkOccupancyFree, WorkOccupancyConflictError } from "./work-occupancy";
import {
	assertNoUnresolvedWorkPeriodReview,
	isUnresolvedWorkPeriodReview,
} from "./work-period-review";
import type { WorkTransactionScope } from "./work-transaction";

export const AUTOMATIC_BREAK_ADJUSTMENT_COMMAND_VERSION = 1;
export const AUTOMATIC_BREAK_ADJUSTMENT_RESULT_VERSION = 1;
export const AUTOMATIC_BREAK_ENFORCEMENT_WRITER_VERSION = 1;

const ADJUSTMENT_NOTE = "Auto-adjusted: break enforcement";
const ADJUSTMENT_SOURCE = { ipAddress: "system", deviceInfo: "break-enforcement" } as const;
/** Intents one scheduled run re-evaluates, least recently checked first. */
const DEFAULT_INTENT_BATCH = 100;

/** The human and closure that caused the adjustment; never its executing actor. */
export type AutomaticBreakAdjustmentTrigger = {
	userId: string | null;
	closureEntryId: string | null;
};

export type AutomaticBreakAdjustmentOutcome =
	| {
			kind: "adjusted";
			/** The receipt identity; null for a legacy organization's established writes. */
			operationId: string | null;
			workPeriodId: string;
			generatedWorkPeriodId: string;
			breakMinutes: number;
			breakStartAt: string;
			regulationName: string;
			originalDurationMinutes: number;
			adjustedDurationMinutes: number;
			/** Evidence for the recovery path's surcharge refresh; null for legacy writes. */
			surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	  }
	| { kind: "not_required" }
	/** Blocked; adopted organizations keep a durable intent for a later recheck. */
	| { kind: "deferred"; blocker: WorkBreakAdjustmentBlocker }
	| {
			kind: "obsolete";
			reason: "missing" | "deleted" | "active" | "rejected" | "already_adjusted" | "changed";
	  };

/**
 * The established legacy plan (`break-enforcement.service.ts`): its arithmetic and
 * its reads stay as they were; only the writes move into the coordinated transaction.
 */
export type LegacyBreakPlan = {
	expected: {
		clockInId: string;
		clockOutId: string;
		startTime: Date;
		endTime: Date;
		durationMinutes: number | null;
	};
	breakStart: Date;
	breakEnd: Date;
	timezone: string;
	firstDurationMinutes: number;
	secondDurationMinutes: number;
	reason: WorkPeriodAutoAdjustmentReason;
};

export type AutomaticBreakTarget = {
	organizationId: string;
	employeeId: string;
	workPeriodId: string;
};

export type AutomaticBreakAdjustmentCommand = {
	version: typeof AUTOMATIC_BREAK_ADJUSTMENT_COMMAND_VERSION;
	workPeriodId: string;
	sourceRevision: number;
	intent: { id: string; closureEntryId: string | null } | null;
};

type AllocationEvidence = {
	allocationKind: string;
	projectId: string | null;
	costCenterId: string | null;
	weightPercent: number;
};

/** One segment by value: committed evidence, not a pointer to current rows. */
export type AutomaticBreakSegment = {
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
export type AutomaticBreakAdjustmentResult = {
	version: typeof AUTOMATIC_BREAK_ADJUSTMENT_RESULT_VERSION;
	operationId: string;
	owner: { employeeId: string };
	actors: {
		executing: { kind: "system"; process: "automatic_break_adjustment" };
		triggeredBy:
			| { kind: "human"; userId: string; closureEntryId: string | null }
			| { kind: "unknown"; closureEntryId: string | null };
	};
	/** The completed work exactly as the adjustment locked it. */
	originatingWork: AutomaticBreakSegment & { approvalState: string; recordCreatedBy: string };
	/** The review that held the adjustment, when it was deferred first. */
	deferral: {
		blocker: WorkBreakAdjustmentBlocker;
		observedGraphRevision: number;
		deferredAt: string;
	} | null;
	policy: {
		evaluatedAt: string;
		policyId: string;
		regulationId: string;
		regulationName: string;
		rule: { workingMinutesThreshold: number; requiredBreakMinutes: number };
	};
	adjustment: {
		breakMinutes: number;
		alreadyTakenBreakMinutes: number;
		breakStartAt: string;
		breakEndAt: string;
		timezone: string;
	};
	segments: [
		AutomaticBreakSegment & { role: "retained" },
		AutomaticBreakSegment & {
			role: "generated";
			origin: { workPeriodId: string; canonicalRecordId: string };
			/** Inherited from the originating work; no new decision is recorded. */
			approval: { state: string; basis: "originating_work"; sourceDecisionIds: string[] };
		},
	];
	append: {
		admission: "append";
		clockOut: { entryId: string; previousEntryId: string | null; previousHash: string | null };
		clockIn: { entryId: string; previousEntryId: string; previousHash: string };
	};
	revisions: {
		originating: { source: number; result: number };
		generated: { source: null; result: number };
	};
	followUps: CompletedWorkFollowUp[];
};

function zoneFor(value: string | null | undefined, fallbackOffsetMinutes: number): string {
	return isValidIanaTimezone(value) ? value : offsetMinutesToTimeZoneId(fallbackOffsetMinutes);
}

function regulationFrom(
	snapshot: Awaited<ReturnType<typeof resolvePolicyClockOutBreakSnapshotInTransaction>>,
): (BreakPolicyRegulation & { policyId: string }) | null {
	if (
		snapshot.resolution === "none" ||
		!snapshot.regulationEnabled ||
		snapshot.breakRules.length === 0
	) {
		return null;
	}
	const { id, name, maxUninterruptedMinutes } = snapshot.regulation;
	if (id === null || name === null) {
		throw new CompletedWorkIntegrityError("Break regulation evidence is incomplete");
	}
	return {
		policyId: snapshot.policy.id,
		id,
		name,
		maxUninterruptedMinutes,
		breakRules: snapshot.breakRules.map((rule) => ({
			workingMinutesThreshold: rule.workingMinutesThreshold,
			requiredBreakMinutes: rule.requiredBreakMinutes,
		})),
	};
}

/**
 * Evaluates one period's adjustment in an adopted organization, inside the owner's
 * coordinated transaction. The period's intent, when there is one, is locked first
 * and resolved by the outcome: deleted once final, kept `deferred` while blocked.
 */
export async function adjustAutomaticBreakInTransaction(
	scope: WorkTransactionScope,
	input: AutomaticBreakTarget & { trigger: AutomaticBreakAdjustmentTrigger; now: Instant },
): Promise<AutomaticBreakAdjustmentOutcome> {
	const { organizationId, employeeId, workPeriodId } = input;
	scope.assertEmployee(organizationId, employeeId);
	if (scope.admission !== "append") {
		throw new Error("Automatic break adjustment operation requires the adopted work transaction");
	}
	const tx = scope.db;
	const now = dateFromInstant(input.now);
	const intentId = deriveAutomaticBreakIntentId(input);
	const [intent] = await tx
		.select()
		.from(workBreakAdjustmentIntent)
		.where(
			and(
				eq(workBreakAdjustmentIntent.id, intentId),
				eq(workBreakAdjustmentIntent.organizationId, organizationId),
			),
		)
		.for("update");
	if (intent && (intent.employeeId !== employeeId || intent.workPeriodId !== workPeriodId)) {
		throw new CompletedWorkIntegrityError("Break adjustment intent does not match its work");
	}
	const trigger: AutomaticBreakAdjustmentTrigger = intent
		? { userId: intent.triggeredByUserId, closureEntryId: intent.closureEntryId }
		: input.trigger;

	const complete = async <T extends AutomaticBreakAdjustmentOutcome>(outcome: T): Promise<T> => {
		if (intent) {
			await tx.delete(workBreakAdjustmentIntent).where(eq(workBreakAdjustmentIntent.id, intent.id));
		}
		return outcome;
	};

	const [period] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
			),
		)
		.for("update");
	if (!period) return complete({ kind: "obsolete", reason: "missing" });
	if (period.deletedAt) return complete({ kind: "obsolete", reason: "deleted" });
	if (period.isActive || !period.endTime || !period.clockOutId) {
		return complete({ kind: "obsolete", reason: "active" });
	}
	const operationId = deriveAutomaticBreakOperationId(input);
	const [receipt] = await tx
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, operationId))
		.limit(1);
	// A committed adjustment is final: replaying anything never regenerates it.
	if (period.wasAutoAdjusted || receipt) {
		return complete({ kind: "obsolete", reason: "already_adjusted" });
	}
	if (period.approvalStatus === "rejected")
		return complete({ kind: "obsolete", reason: "rejected" });

	const defer = async (
		blocker: WorkBreakAdjustmentBlocker,
	): Promise<AutomaticBreakAdjustmentOutcome> => {
		const unchanged =
			intent?.status === "deferred" &&
			intent.blocker === blocker &&
			intent.observedGraphRevision === period.graphRevision;
		if (intent) {
			await tx
				.update(workBreakAdjustmentIntent)
				.set({
					status: "deferred",
					blocker,
					observedGraphRevision: period.graphRevision,
					deferredAt: unchanged && intent.deferredAt ? intent.deferredAt : now,
					checkedAt: now,
				})
				.where(eq(workBreakAdjustmentIntent.id, intent.id));
		} else {
			await tx.insert(workBreakAdjustmentIntent).values({
				id: intentId,
				organizationId,
				employeeId,
				workPeriodId,
				closureEntryId: trigger.closureEntryId,
				triggeredByUserId: trigger.userId,
				status: "deferred",
				blocker,
				observedGraphRevision: period.graphRevision,
				requestedAt: now,
				deferredAt: now,
				checkedAt: now,
			});
		}
		return { kind: "deferred", blocker };
	};

	// A structural change waits while any review of the period is open (#256 §7).
	try {
		await assertNoUnresolvedWorkPeriodReview(tx, organizationId, period);
	} catch (error) {
		if (!isUnresolvedWorkPeriodReview(error)) throw error;
		return defer(error.conflictType as WorkBreakAdjustmentBlocker);
	}

	const endpoints = await tx
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
	const sourceClockIn = endpoints.find(({ id }) => id === period.clockInId);
	const sourceClockOut = endpoints.find(({ id }) => id === period.clockOutId);
	if (
		!sourceClockIn ||
		!sourceClockOut ||
		sourceClockIn.isSuperseded ||
		sourceClockOut.isSuperseded ||
		!period.canonicalRecordId ||
		period.durationMinutes === null
	) {
		return defer("completed_work_review_required");
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
	if (!record || !detail) return defer("completed_work_review_required");
	// A canonical record still under review is review, even when the period lags.
	if (record.approvalState === "pending") return defer("work_period_pending_approval");
	const sourceStart = instantFromDate(period.startTime);
	const sourceEnd = instantFromDate(period.endTime);
	const projectAllocations = allocations.filter(
		({ allocationKind }) => allocationKind === "project",
	);
	const allocationAgrees = period.projectId
		? projectAllocations.length === 1 &&
			projectAllocations[0]?.projectId === period.projectId &&
			projectAllocations[0]?.weightPercent === 100
		: projectAllocations.length === 0;
	// Divergence between the period and its canonical record is evidence for review,
	// never repaired by an automatic process.
	if (
		!record.endAt ||
		compareInstants(instantFromDate(record.startAt), sourceStart) !== 0 ||
		compareInstants(instantFromDate(record.endAt), sourceEnd) !== 0 ||
		record.durationMinutes !== period.durationMinutes ||
		detail.workCategoryId !== period.workCategoryId ||
		detail.workLocationType !== period.workLocationType ||
		!allocationAgrees ||
		compareInstants(instantFromDate(sourceClockIn.timestamp), sourceStart) !== 0 ||
		compareInstants(instantFromDate(sourceClockOut.timestamp), sourceEnd) !== 0
	) {
		return defer("completed_work_review_required");
	}

	// The regulation in effect when the work ended, read now: a policy changed while the
	// adjustment was deferred applies as it stands for that work, never as planned before.
	const breakPolicy = await resolvePolicyClockOutBreakSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		endTime: sourceEnd,
	});
	const regulation = regulationFrom(breakPolicy);
	if (!regulation || breakPolicy.resolution === "none") {
		return complete({ kind: "not_required" });
	}

	// Breaks already taken on the work's local start day, in the zone the work was
	// captured in; the plan depends on the work's facts, not on today's date.
	const [owner] = await tx
		.select({ timezone: userSettings.timezone })
		.from(employee)
		.leftJoin(userSettings, eq(userSettings.userId, employee.userId))
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);
	const timezone = isValidIanaTimezone(sourceClockOut.timezone)
		? sourceClockOut.timezone
		: zoneFor(owner?.timezone, sourceClockOut.utcOffsetMinutes ?? 0);
	const dayStart = sourceStart.toZonedDateTimeISO(timezone).startOfDay().toInstant();
	const dayWork = await tx
		.select({ id: workPeriod.id, startTime: workPeriod.startTime, endTime: workPeriod.endTime })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
				ne(workPeriod.approvalStatus, "rejected"),
				gte(workPeriod.startTime, dateFromInstant(dayStart)),
				lte(workPeriod.startTime, period.endTime),
			),
		);
	const intervals = [
		...dayWork.flatMap((work) =>
			work.id !== period.id && work.endTime
				? [{ startAt: instantFromDate(work.startTime), endAt: instantFromDate(work.endTime) }]
				: [],
		),
		{ startAt: sourceStart, endAt: sourceEnd },
	];
	const plan = planAutomaticBreak({
		sourceStart,
		sourceEnd,
		sourceDurationMinutes: period.durationMinutes,
		alreadyTakenBreakMinutes: breakMinutesTakenBefore(intervals, sourceEnd),
		regulation,
	});
	if (!plan) return complete({ kind: "not_required" });

	// Symmetric occupancy: both resulting segments lie inside the source interval.
	try {
		await assertWorkOccupancyFree(tx, {
			organizationId,
			employeeId,
			interval: { startAt: sourceStart, endAt: sourceEnd },
			excludeWorkPeriodIds: [period.id],
		});
	} catch (error) {
		if (!(error instanceof WorkOccupancyConflictError)) throw error;
		return defer("work_occupancy_conflict");
	}

	const admission = await admitTimeEntryAppend(
		tx,
		{ organizationId, employeeId },
		"automatic_break_adjustment",
	);
	if (admission.kind === "review_required") return defer("append_review_required");
	const append = admission.append;

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
	const surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		startTime: sourceStart,
		endTime: sourceEnd,
	});

	// Rows need a user: the triggering human, else the human who completed the work.
	const writtenBy = trigger.userId ?? sourceClockOut.createdBy;
	const insertEntry = async (
		type: "clock_out" | "clock_in",
		instant: Instant,
		previous: { id: string | null; hash: string | null },
	) => {
		const timestamp = dateFromInstant(instant);
		const capture = resolveFallbackTimezoneCapture({
			timestamp,
			timezone,
			timezoneSource: "historical_inference",
		});
		const [entry] = await tx
			.insert(timeEntry)
			.values({
				employeeId,
				organizationId,
				type,
				timestamp,
				hash: calculateHash({
					employeeId,
					type,
					timestamp: timestamp.toISOString(),
					previousHash: previous.hash,
				}),
				previousHash: previous.hash,
				previousEntryId: previous.id,
				notes: ADJUSTMENT_NOTE,
				...ADJUSTMENT_SOURCE,
				createdBy: writtenBy,
				...capture,
			})
			.returning();
		if (!entry) throw new Error("Break adjustment entry insert failed");
		await append.record({
			id: entry.id,
			hash: entry.hash,
			previousEntryId: previous.id,
			previousHash: previous.hash,
		});
		return entry;
	};
	const breakClockOut = await insertEntry("clock_out", plan.breakStartAt, {
		id: append.predecessor?.id ?? null,
		hash: append.predecessor?.hash ?? null,
	});
	const breakClockIn = await insertEntry("clock_in", plan.breakEndAt, {
		id: breakClockOut.id,
		hash: breakClockOut.hash,
	});

	const adjustedDurationMinutes = plan.retainedMinutes + plan.generatedMinutes;
	const reason: WorkPeriodAutoAdjustmentReason = {
		type: "break_enforcement",
		regulationId: plan.regulation.id,
		regulationName: plan.regulation.name,
		breakInsertedMinutes: plan.breakMinutes,
		breakInsertedAt: instantToCanonicalString(plan.breakStartAt),
		originalDurationMinutes: period.durationMinutes,
		adjustedDurationMinutes,
		ruleApplied: plan.rule,
	};
	const breakStartDate = dateFromInstant(plan.breakStartAt);
	const breakEndDate = dateFromInstant(plan.breakEndAt);
	const sourceRevision = period.graphRevision + 1;
	const updatedPeriods = await tx
		.update(workPeriod)
		.set({
			clockOutId: breakClockOut.id,
			endTime: breakStartDate,
			durationMinutes: plan.retainedMinutes,
			wasAutoAdjusted: true,
			autoAdjustmentReason: reason,
			autoAdjustedAt: now,
			originalEndTime: period.endTime,
			originalDurationMinutes: period.durationMinutes,
			graphRevision: sourceRevision,
			updatedAt: now,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.clockInId, period.clockInId),
				eq(workPeriod.clockOutId, period.clockOutId),
				eq(workPeriod.graphRevision, period.graphRevision),
				eq(workPeriod.wasAutoAdjusted, false),
				eq(workPeriod.isActive, false),
				isNull(workPeriod.deletedAt),
			),
		)
		.returning({ id: workPeriod.id });
	if (updatedPeriods.length !== 1) {
		throw new CompletedWorkIntegrityError("Adjusted work period changed");
	}
	const updatedRecords = await tx
		.update(timeRecord)
		.set({
			endAt: breakStartDate,
			durationMinutes: plan.retainedMinutes,
			updatedAt: now,
			updatedBy: writtenBy,
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

	// The generated record keeps the originating work's origin, approval state and
	// recording actor; no new decision is recorded for it.
	const generatedRecordId = randomUUID();
	await tx.insert(timeRecord).values({
		id: generatedRecordId,
		organizationId,
		employeeId,
		recordKind: "work",
		startAt: breakEndDate,
		endAt: period.endTime,
		durationMinutes: plan.generatedMinutes,
		approvalState: record.approvalState,
		origin: record.origin,
		createdBy: record.createdBy,
		updatedAt: now,
		updatedBy: writtenBy,
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
			clockInId: breakClockIn.id,
			clockOutId: period.clockOutId,
			projectId: period.projectId,
			workCategoryId: period.workCategoryId,
			workLocationType: period.workLocationType,
			startTime: breakEndDate,
			endTime: period.endTime,
			durationMinutes: plan.generatedMinutes,
			isActive: false,
			approvalStatus: period.approvalStatus,
			wasAutoAdjusted: true,
			autoAdjustmentReason: reason,
			autoAdjustedAt: now,
			canonicalRecordId: generatedRecordId,
			graphRevision: 1,
			updatedAt: now,
		})
		.returning({ id: workPeriod.id, graphRevision: workPeriod.graphRevision });
	if (!generated) throw new Error("Generated work period insert failed");

	// Independent rounding can change the total: the refresh commits with the work.
	const dirtyFromDate = earliestStartDate(sourceStart, sourceClockIn.utcOffsetMinutes ?? 0);
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
	}): AutomaticBreakSegment => ({
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
	const command: AutomaticBreakAdjustmentCommand = {
		version: AUTOMATIC_BREAK_ADJUSTMENT_COMMAND_VERSION,
		workPeriodId: period.id,
		sourceRevision: period.graphRevision,
		intent: intent ? { id: intent.id, closureEntryId: intent.closureEntryId } : null,
	};
	const result: AutomaticBreakAdjustmentResult = {
		version: AUTOMATIC_BREAK_ADJUSTMENT_RESULT_VERSION,
		operationId,
		owner: { employeeId },
		actors: {
			executing: { kind: "system", process: "automatic_break_adjustment" },
			triggeredBy: trigger.userId
				? { kind: "human", userId: trigger.userId, closureEntryId: trigger.closureEntryId }
				: { kind: "unknown", closureEntryId: trigger.closureEntryId },
		},
		originatingWork: {
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
		deferral:
			intent?.status === "deferred" &&
			intent.blocker &&
			intent.observedGraphRevision !== null &&
			intent.deferredAt
				? {
						blocker: intent.blocker,
						observedGraphRevision: intent.observedGraphRevision,
						deferredAt: instantToCanonicalString(instantFromDate(intent.deferredAt)),
					}
				: null,
		policy: {
			evaluatedAt: breakPolicy.evaluatedAt,
			policyId: regulation.policyId,
			regulationId: plan.regulation.id,
			regulationName: plan.regulation.name,
			rule: plan.rule,
		},
		adjustment: {
			breakMinutes: plan.breakMinutes,
			alreadyTakenBreakMinutes: plan.alreadyTakenBreakMinutes,
			breakStartAt: instantToCanonicalString(plan.breakStartAt),
			breakEndAt: instantToCanonicalString(plan.breakEndAt),
			timezone,
		},
		segments: [
			{
				role: "retained",
				...segment({
					workPeriodId: period.id,
					canonicalRecordId: record.id,
					clockIn: sourceClockIn,
					clockOut: breakClockOut,
					startAt: sourceStart,
					endAt: plan.breakStartAt,
					durationMinutes: plan.retainedMinutes,
				}),
			},
			{
				role: "generated",
				...segment({
					workPeriodId: generated.id,
					canonicalRecordId: generatedRecordId,
					clockIn: breakClockIn,
					clockOut: sourceClockOut,
					startAt: plan.breakEndAt,
					endAt: sourceEnd,
					durationMinutes: plan.generatedMinutes,
				}),
				origin: { workPeriodId: period.id, canonicalRecordId: record.id },
				approval: {
					state: record.approvalState,
					basis: "originating_work",
					sourceDecisionIds: decisions.map(({ id }) => id),
				},
			},
		],
		append: {
			admission: "append",
			clockOut: {
				entryId: breakClockOut.id,
				previousEntryId: breakClockOut.previousEntryId,
				previousHash: breakClockOut.previousHash,
			},
			clockIn: {
				entryId: breakClockIn.id,
				previousEntryId: breakClockOut.id,
				previousHash: breakClockOut.hash,
			},
		},
		revisions: {
			originating: { source: period.graphRevision, result: sourceRevision },
			generated: { source: null, result: generated.graphRevision },
		},
		followUps,
	};
	await tx.insert(completedWorkOperation).values({
		id: operationId,
		organizationId,
		employeeId,
		kind: "automatic_break_adjustment",
		writer: "automatic_break_enforcement",
		writerVersion: AUTOMATIC_BREAK_ENFORCEMENT_WRITER_VERSION,
		commandVersion: command.version,
		command,
		appendAdmission: "append",
		actorKind: "system",
		actorUserId: null,
		// The originating work; the generated period is in the result.
		workPeriodId: period.id,
		resultVersion: AUTOMATIC_BREAK_ADJUSTMENT_RESULT_VERSION,
		result,
	});
	return complete({
		kind: "adjusted",
		operationId,
		workPeriodId: period.id,
		generatedWorkPeriodId: generated.id,
		breakMinutes: plan.breakMinutes,
		breakStartAt: instantToCanonicalString(plan.breakStartAt),
		regulationName: plan.regulation.name,
		originalDurationMinutes: period.durationMinutes,
		adjustedDurationMinutes,
		surchargeSnapshot,
	});
}

/**
 * A legacy organization's established break-enforcement writes, now inside the
 * owner's coordinated transaction: the period must still be exactly the one the plan
 * was made from, and an unresolved review refuses the adjustment without writes.
 */
export async function applyLegacyAutomaticBreakInTransaction(
	scope: WorkTransactionScope,
	input: AutomaticBreakTarget & {
		trigger: AutomaticBreakAdjustmentTrigger;
		plan: LegacyBreakPlan;
		now: Instant;
	},
): Promise<AutomaticBreakAdjustmentOutcome> {
	const { organizationId, employeeId, workPeriodId, plan } = input;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const now = dateFromInstant(input.now);
	const [period] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.employeeId, employeeId),
			),
		)
		.for("update");
	if (!period) return { kind: "obsolete", reason: "missing" };
	if (period.deletedAt) return { kind: "obsolete", reason: "deleted" };
	if (period.wasAutoAdjusted) return { kind: "obsolete", reason: "already_adjusted" };
	if (
		period.isActive ||
		period.clockInId !== plan.expected.clockInId ||
		period.clockOutId !== plan.expected.clockOutId ||
		period.startTime.getTime() !== plan.expected.startTime.getTime() ||
		period.endTime?.getTime() !== plan.expected.endTime.getTime() ||
		period.durationMinutes !== plan.expected.durationMinutes
	) {
		return { kind: "obsolete", reason: "changed" };
	}
	try {
		await assertNoUnresolvedWorkPeriodReview(tx, organizationId, period);
	} catch (error) {
		if (!isUnresolvedWorkPeriodReview(error)) throw error;
		return { kind: "deferred", blocker: error.conflictType as WorkBreakAdjustmentBlocker };
	}
	const [sourceClockOut] = await tx
		.select({ createdBy: timeEntry.createdBy })
		.from(timeEntry)
		.where(
			and(
				eq(timeEntry.id, plan.expected.clockOutId),
				eq(timeEntry.organizationId, organizationId),
				eq(timeEntry.employeeId, employeeId),
			),
		)
		.limit(1);
	if (!sourceClockOut) return { kind: "obsolete", reason: "changed" };
	// Established head selection: the latest-created entry of the employee.
	const [head] = await tx
		.select({ hash: timeEntry.hash })
		.from(timeEntry)
		.where(and(eq(timeEntry.employeeId, employeeId), eq(timeEntry.organizationId, organizationId)))
		.orderBy(desc(timeEntry.createdAt))
		.limit(1)
		.for("update");
	const writtenBy = input.trigger.userId ?? sourceClockOut.createdBy;
	const insertEntry = async (
		type: "clock_out" | "clock_in",
		timestamp: Date,
		previousHash: string | null,
	) => {
		const [entry] = await tx
			.insert(timeEntry)
			.values({
				employeeId,
				organizationId,
				type,
				timestamp,
				hash: calculateHash({ employeeId, type, timestamp: timestamp.toISOString(), previousHash }),
				previousHash,
				notes: ADJUSTMENT_NOTE,
				...ADJUSTMENT_SOURCE,
				createdBy: writtenBy,
				...resolveFallbackTimezoneCapture({
					timestamp,
					timezone: plan.timezone,
					timezoneSource: "user_setting",
				}),
			})
			.returning();
		if (!entry) throw new Error("Break adjustment entry insert failed");
		return entry;
	};
	const firstClockOut = await insertEntry("clock_out", plan.breakStart, head?.hash ?? null);
	const secondClockIn = await insertEntry("clock_in", plan.breakEnd, firstClockOut.hash);
	const updated = await tx
		.update(workPeriod)
		.set({
			clockOutId: firstClockOut.id,
			endTime: plan.breakStart,
			durationMinutes: plan.firstDurationMinutes,
			wasAutoAdjusted: true,
			autoAdjustmentReason: plan.reason,
			autoAdjustedAt: now,
			originalEndTime: plan.expected.endTime,
			originalDurationMinutes: plan.reason.originalDurationMinutes,
			updatedAt: now,
		})
		.where(
			and(
				eq(workPeriod.id, period.id),
				eq(workPeriod.organizationId, organizationId),
				eq(workPeriod.wasAutoAdjusted, false),
			),
		)
		.returning({ id: workPeriod.id });
	if (updated.length !== 1) throw new CompletedWorkIntegrityError("Adjusted work period changed");
	const [inserted] = await tx
		.insert(workPeriod)
		.values({
			employeeId,
			organizationId,
			clockInId: secondClockIn.id,
			clockOutId: plan.expected.clockOutId,
			startTime: plan.breakEnd,
			endTime: plan.expected.endTime,
			durationMinutes: plan.secondDurationMinutes,
			projectId: period.projectId,
			isActive: false,
			wasAutoAdjusted: true,
			autoAdjustmentReason: plan.reason,
			autoAdjustedAt: now,
			originalEndTime: null,
			originalDurationMinutes: null,
		})
		.returning({ id: workPeriod.id });
	if (!inserted) throw new Error("Break enforcement did not create a second work period");
	return {
		kind: "adjusted",
		operationId: null,
		workPeriodId: period.id,
		generatedWorkPeriodId: inserted.id,
		breakMinutes: plan.reason.breakInsertedMinutes,
		breakStartAt: plan.reason.breakInsertedAt,
		regulationName: plan.reason.regulationName,
		originalDurationMinutes: plan.reason.originalDurationMinutes,
		adjustedDurationMinutes: plan.reason.adjustedDurationMinutes,
		surchargeSnapshot: null,
	};
}

/** Routing hint only; the coordinated transaction re-reads the mode under the gate. */
async function readAdmissionHint(organizationId: string): Promise<"legacy" | "append"> {
	const [control] = await db
		.select({ mode: timeEntryAppendControl.mode })
		.from(timeEntryAppendControl)
		.where(eq(timeEntryAppendControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active" ? "append" : "legacy";
}

const MODE_CHANGED = Symbol("append mode changed");

export type RunAutomaticBreakAdjustmentInput = AutomaticBreakTarget & {
	trigger: AutomaticBreakAdjustmentTrigger;
	/** The established legacy plan, made from plain reads before the transaction. */
	planLegacy: () => Promise<LegacyBreakPlan | null>;
	now?: () => Instant;
};

/**
 * The one entry for every automatic break adjustment: the immediate post-commit
 * path, departure post-processing and the scheduled recovery. A failure never
 * touches the committed closure; an adopted intent records it and stays for retry.
 */
export async function runAutomaticBreakAdjustment(
	input: RunAutomaticBreakAdjustmentInput,
): Promise<AutomaticBreakAdjustmentOutcome> {
	const now = input.now ?? (() => systemClock.nowInstant());
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const hint = await readAdmissionHint(input.organizationId);
		const legacyPlan = hint === "legacy" ? await input.planLegacy() : null;
		if (hint === "legacy" && !legacyPlan) return { kind: "not_required" };
		let outcome: AutomaticBreakAdjustmentOutcome | typeof MODE_CHANGED;
		try {
			outcome = await withCompletedWorkTransaction(
				{
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					actorUserId: null,
				},
				async (scope) => {
					if (scope.admission === "append") {
						return adjustAutomaticBreakInTransaction(scope, { ...input, now: now() });
					}
					if (!legacyPlan) return MODE_CHANGED;
					return applyLegacyAutomaticBreakInTransaction(scope, {
						...input,
						plan: legacyPlan,
						now: now(),
					});
				},
			);
		} catch (error) {
			await recordAutomaticBreakFailure(input, error, now());
			throw error;
		}
		if (outcome !== MODE_CHANGED) return outcome;
	}
	throw new Error("Append mode changed during the automatic break adjustment");
}

/**
 * The innermost cause's own message (the database's, for a failed statement),
 * without the failed statement or its parameters.
 */
function failureMessage(error: unknown): string {
	let current = error;
	while (current instanceof Error && current.cause instanceof Error) current = current.cause;
	return current instanceof Error ? current.message.slice(0, 1000) : "Unknown error";
}

/** Failure evidence on the intent, outside the rolled-back adjustment. */
async function recordAutomaticBreakFailure(
	target: AutomaticBreakTarget,
	error: unknown,
	now: Instant,
): Promise<void> {
	try {
		await db
			.update(workBreakAdjustmentIntent)
			.set({
				attempts: sql`${workBreakAdjustmentIntent.attempts} + 1`,
				lastAttemptAt: dateFromInstant(now),
				checkedAt: dateFromInstant(now),
				lastError: failureMessage(error),
			})
			.where(
				and(
					eq(workBreakAdjustmentIntent.id, deriveAutomaticBreakIntentId(target)),
					eq(workBreakAdjustmentIntent.organizationId, target.organizationId),
				),
			);
	} catch {
		// The adjustment's own error is the one to report.
	}
}

export type AutomaticBreakIntentRun = {
	processed: number;
	adjusted: number;
	deferred: number;
	completed: number;
	errors: Array<{ workPeriodId: string; error: string }>;
};

/**
 * Scheduled recovery of committed intents, whatever the work's date. Each intent
 * is evaluated under its owner's coordination, so concurrent workers serialize on the
 * employee and the later one finds the intent resolved. Only adopted organizations'
 * intents run: an organization returned to legacy admission keeps its intents until it
 * is adopted again, and its work is covered by the legacy daily check meanwhile.
 * `afterAdjusted` runs the best-effort post-commit follow-ups of a completed adjustment.
 */
export async function processAutomaticBreakIntents(input: {
	organizationId?: string;
	limit?: number;
	afterAdjusted?: (
		outcome: Extract<AutomaticBreakAdjustmentOutcome, { kind: "adjusted" }>,
		target: AutomaticBreakTarget,
	) => Promise<void>;
	now?: () => Instant;
}): Promise<AutomaticBreakIntentRun> {
	const intents = await db
		.select()
		.from(workBreakAdjustmentIntent)
		.where(
			and(
				input.organizationId
					? eq(workBreakAdjustmentIntent.organizationId, input.organizationId)
					: undefined,
				exists(
					db
						.select({ organizationId: timeEntryAppendControl.organizationId })
						.from(timeEntryAppendControl)
						.where(
							and(
								eq(timeEntryAppendControl.organizationId, workBreakAdjustmentIntent.organizationId),
								eq(timeEntryAppendControl.mode, "active"),
							),
						),
				),
			),
		)
		.orderBy(
			sql`${workBreakAdjustmentIntent.checkedAt} asc nulls first`,
			asc(workBreakAdjustmentIntent.requestedAt),
			asc(workBreakAdjustmentIntent.id),
		)
		.limit(input.limit ?? DEFAULT_INTENT_BATCH);
	const run: AutomaticBreakIntentRun = {
		processed: 0,
		adjusted: 0,
		deferred: 0,
		completed: 0,
		errors: [],
	};
	for (const intent of intents) {
		run.processed += 1;
		const target = {
			organizationId: intent.organizationId,
			employeeId: intent.employeeId,
			workPeriodId: intent.workPeriodId,
		};
		try {
			const outcome = await runAutomaticBreakAdjustment({
				...target,
				trigger: { userId: intent.triggeredByUserId, closureEntryId: intent.closureEntryId },
				// Admission turned legacy after the read: leave the intent for re-adoption.
				planLegacy: async () => null,
				now: input.now,
			});
			if (outcome.kind === "adjusted") {
				run.adjusted += 1;
				try {
					await input.afterAdjusted?.(outcome, target);
				} catch {
					// Best effort: the committed adjustment stays adjusted.
				}
			} else if (outcome.kind === "deferred") {
				run.deferred += 1;
			} else {
				run.completed += 1;
			}
		} catch (error) {
			run.errors.push({
				workPeriodId: intent.workPeriodId,
				error: failureMessage(error),
			});
		}
	}
	return run;
}

export {
	commitAutomaticBreakIntent,
	deriveAutomaticBreakIntentId,
	deriveAutomaticBreakOperationId,
} from "./automatic-break-intent";
export type { AutomaticBreakPlan };
