import "server-only";

/**
 * Ordinary automatic break adjustment (#305 / T41, design #256 §5/§7; #1220).
 *
 * After an ordinary (not approval-routed) closure has committed consistent work, a
 * regulation may still owe a break. This module is the one owner of that adjustment
 * for the immediate post-commit path, the departure post-processing and the cron, in
 * both admissions. It states the job's policy; work records (ADR 0010) divides the
 * work period and its canonical work record by the owed break, carries vehicle use
 * across it, marks the work auto-adjusted and applies the effects.
 *
 * - Every call runs under the owner's completed-work coordination (a system actor),
 *   locks the period's intent and then the work, checks the job's own preconditions
 *   (obsolete work, the unresolved-review guard, work awaiting approval) and names the
 *   regulation in effect when the work ended. Breaks already taken are counted as
 *   "earlier breaks".
 * - Adopted organizations commit a durable intent with the closure
 *   (`closeActiveWorkGraph`). A blocker, including each work records outcome that is
 *   not an adjustment (a pair that disagrees, occupancy, a closed month, a stale
 *   revision, append review), keeps the intent `deferred`; every later run
 *   re-evaluates the current work on any date and never applies a formerly planned
 *   split. A completed adjustment writes an `automatic_break_adjustment` receipt with
 *   a system actor, the triggering human and the originating work. A receipt or an
 *   adjusted period is final: no later run regenerates the adjustment.
 * - Legacy organizations run the same policy and division without an intent or a
 *   receipt; a blocked adjustment is simply not made, and the daily check retries.
 */
import { and, asc, eq, exists, isNull, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { db } from "@/db";
import {
	completedWorkOperation,
	type WorkBreakAdjustmentBlocker,
	workBreakAdjustmentIntent,
	workPeriod,
} from "@/db/schema";
import { timeEntryAppendControl } from "@/db/schema/time-entry-append";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	deriveAutomaticBreakIntentId,
	deriveAutomaticBreakOperationId,
} from "./automatic-break-intent";
import type { BreakPolicyRegulation } from "./break-policy-calculation";
import { type CompletedWorkFollowUp, CompletedWorkIntegrityError } from "./close-active-work";
import { withCompletedWorkTransaction } from "./completed-work-transaction";
import { resolvePolicyClockOutBreakSnapshotInTransaction } from "./policy-clock-out-break-snapshot";
import {
	type PolicyClockOutSurchargeSnapshot,
	resolvePolicyClockOutSurchargeSnapshotInTransaction,
} from "./policy-clock-out-surcharge-snapshot";
import { capturedZone } from "./timezone-capture";
import {
	assertNoUnresolvedWorkPeriodReview,
	isUnresolvedWorkPeriodReview,
} from "./work-period-review";
import {
	applyWorkRecordChange,
	type OwedBreakDivision,
	orRefuse,
	readWorkRecord,
	type WorkRecordRefusal,
	type WorkSegment,
} from "./work-records";
import type { SealedWorkTransactionScope } from "./work-transaction";

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
			/** The receipt identity; null in legacy admission, which commits no receipt. */
			operationId: string | null;
			workPeriodId: string;
			generatedWorkPeriodId: string;
			breakMinutes: number;
			breakStartAt: string;
			regulationName: string;
			originalDurationMinutes: number;
			adjustedDurationMinutes: number;
			/** Evidence for the recovery path's surcharge refresh. */
			surchargeSnapshot: PolicyClockOutSurchargeSnapshot | null;
	  }
	| { kind: "not_required" }
	/** Blocked; adopted organizations keep a durable intent for a later recheck. */
	| { kind: "deferred"; blocker: WorkBreakAdjustmentBlocker }
	| {
			kind: "obsolete";
			reason: "missing" | "deleted" | "active" | "rejected" | "already_adjusted";
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

/** One segment by value: committed evidence, not a pointer to current rows. */
export type AutomaticBreakSegment = WorkSegment;

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

type PolicyBreakSnapshot = Awaited<
	ReturnType<typeof resolvePolicyClockOutBreakSnapshotInTransaction>
>;

function regulationFrom(
	snapshot: PolicyBreakSnapshot,
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
 * The blocker each work records refusal keeps the intent deferred with. Refusals a
 * division by an owed break never returns are defects, thrown as their errors.
 */
function blockerOf(refusal: WorkRecordRefusal): WorkBreakAdjustmentBlocker {
	switch (refusal.kind) {
		case "stale":
			return "work_period_stale";
		case "canonical_divergence":
			return "canonical_divergence";
		case "canonical_record_missing":
		case "endpoint_entry_missing":
		case "endpoint_superseded":
			return "completed_work_review_required";
		case "work_occupied":
			return "work_occupancy_conflict";
		case "month_closed":
			return "month_closed";
		case "append_review_required":
			return "append_review_required";
		default:
			return orRefuse<never>(refusal);
	}
}

/**
 * Evaluates one period's adjustment inside the owner's coordinated transaction, in
 * either admission. In append admission the period's intent, when there is one, is
 * locked first and resolved by the outcome: deleted once final, kept `deferred`
 * while blocked. Legacy admission keeps no intent.
 */
export async function adjustAutomaticBreakInTransaction(
	scope: SealedWorkTransactionScope,
	input: AutomaticBreakTarget & {
		trigger: AutomaticBreakAdjustmentTrigger;
		now: Instant;
		recoveringIntent?: boolean;
	},
): Promise<AutomaticBreakAdjustmentOutcome> {
	const { organizationId, employeeId, workPeriodId } = input;
	scope.assertEmployee(organizationId, employeeId);
	// Durable intents are the adopted organization's commitment: its closures commit
	// one. The job reads that here, inside the transaction; its callers never do (#1231).
	const adopted = scope.admission === "append";
	// Admission turned legacy after the intent was read: leave it for re-adoption.
	if (input.recoveringIntent && !adopted) return { kind: "not_required" };
	const tx = scope.db;
	const now = dateFromInstant(input.now);
	const intentId = deriveAutomaticBreakIntentId(input);
	// The caller's own lock comes before work records' (`WORK_RECORD_LOCK_ORDER`).
	const [intent] = adopted
		? await tx
				.select()
				.from(workBreakAdjustmentIntent)
				.where(
					and(
						eq(workBreakAdjustmentIntent.id, intentId),
						eq(workBreakAdjustmentIntent.organizationId, organizationId),
					),
				)
				.for("update")
		: [];
	if (intent && (intent.employeeId !== employeeId || intent.workPeriodId !== workPeriodId)) {
		throw new CompletedWorkIntegrityError("Break adjustment intent does not match its work");
	}
	const trigger: AutomaticBreakAdjustmentTrigger = intent
		? { userId: intent.triggeredByUserId, closureEntryId: intent.closureEntryId }
		: input.trigger;

	const resolveIntent = async <T extends AutomaticBreakAdjustmentOutcome>(
		outcome: T,
	): Promise<T> => {
		if (intent) {
			await tx.delete(workBreakAdjustmentIntent).where(eq(workBreakAdjustmentIntent.id, intent.id));
		}
		return outcome;
	};

	const current = await readWorkRecord(
		scope,
		{ organizationId, employeeId, workPeriodId },
		{ lock: true },
	);
	if (!current) {
		const [deleted] = await tx
			.select({ id: workPeriod.id })
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, workPeriodId),
					eq(workPeriod.organizationId, organizationId),
					eq(workPeriod.employeeId, employeeId),
				),
			);
		return resolveIntent({ kind: "obsolete", reason: deleted ? "deleted" : "missing" });
	}
	const { period, clockIn, clockOut, canonical } = current;
	if (period.isActive || !period.endTime || !period.clockOutId) {
		return resolveIntent({ kind: "obsolete", reason: "active" });
	}
	const operationId = deriveAutomaticBreakOperationId(input);
	const [receipt] = await tx
		.select({ id: completedWorkOperation.id })
		.from(completedWorkOperation)
		.where(
			and(
				eq(completedWorkOperation.id, operationId),
				eq(completedWorkOperation.organizationId, organizationId),
			),
		)
		.limit(1);
	// A committed adjustment is final: replaying anything never regenerates it.
	if (period.wasAutoAdjusted || receipt) {
		return resolveIntent({ kind: "obsolete", reason: "already_adjusted" });
	}
	if (period.approvalStatus === "rejected") {
		return resolveIntent({ kind: "obsolete", reason: "rejected" });
	}

	const defer = async (
		blocker: WorkBreakAdjustmentBlocker,
	): Promise<AutomaticBreakAdjustmentOutcome> => {
		if (!adopted) return { kind: "deferred", blocker };
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
	// Work still under review is review, in either record.
	if (period.approvalStatus === "pending" || canonical?.record.approvalState === "pending") {
		return defer("work_period_pending_approval");
	}
	if (!clockOut) return defer("completed_work_review_required");

	// The regulation in effect when the work ended, read now: a policy changed while the
	// adjustment was deferred applies as it stands for that work, never as planned before.
	const sourceEnd = instantFromDate(period.endTime);
	const breakPolicy = await resolvePolicyClockOutBreakSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		endTime: sourceEnd,
	});
	const regulation = regulationFrom(breakPolicy);
	// The break entries are captured like the closure they divide.
	const timezone = capturedZone(clockOut);
	const outcome = await applyWorkRecordChange(scope, {
		kind: "divide_owed_break",
		organizationId,
		employeeId,
		expected: current.expected,
		regulation,
		takenBefore: "earlier_breaks",
		notes: ADJUSTMENT_NOTE,
		actorUserId: null,
		entries: {
			// Rows need a user: the triggering human, else the human who completed the work.
			createdBy: trigger.userId ?? clockOut.createdBy,
			...ADJUSTMENT_SOURCE,
			timezone,
			timezoneSource: "historical_inference",
		},
		appendOperation: "automatic_break_adjustment",
	});
	if (outcome.kind === "not_required") return resolveIntent({ kind: "not_required" });
	if (outcome.kind !== "owed_break_divided") return defer(blockerOf(outcome));
	if (!regulation || breakPolicy.resolution === "none") {
		throw new CompletedWorkIntegrityError("A break was owed without a regulation");
	}
	if (!clockIn) throw new CompletedWorkIntegrityError("Adjusted work has no clock-in");

	const surchargeSnapshot = await resolvePolicyClockOutSurchargeSnapshotInTransaction({
		dbService: { db: tx },
		organizationId,
		employeeId,
		startTime: instantFromDate(period.startTime),
		endTime: sourceEnd,
	});
	// The receipt follows work records' outcome: only appended entries commit one.
	const receipted = outcome.appended.admission === "append";
	const adjusted = {
		kind: "adjusted",
		operationId: receipted ? operationId : null,
		workPeriodId: period.id,
		generatedWorkPeriodId: outcome.generated.segment.workPeriodId,
		breakMinutes: outcome.owedBreak.breakMinutes,
		breakStartAt: instantToCanonicalString(outcome.owedBreak.startAt),
		regulationName: outcome.owedBreak.regulation.name,
		originalDurationMinutes: outcome.source.segment.durationMinutes,
		adjustedDurationMinutes:
			outcome.retained.segment.durationMinutes + outcome.generated.segment.durationMinutes,
		surchargeSnapshot,
	} as const;
	// Legacy admission's writer commits no receipt, as before.
	if (!receipted) return resolveIntent(adjusted);

	const command: AutomaticBreakAdjustmentCommand = {
		version: AUTOMATIC_BREAK_ADJUSTMENT_COMMAND_VERSION,
		workPeriodId: period.id,
		sourceRevision: period.graphRevision,
		intent: intent ? { id: intent.id, closureEntryId: intent.closureEntryId } : null,
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
		result: adjustmentResult({
			operationId,
			employeeId,
			trigger,
			intent: intent ?? null,
			policy: { evaluatedAt: breakPolicy.evaluatedAt, policyId: regulation.policyId },
			timezone,
			division: outcome,
		}),
	});
	return resolveIntent(adjusted);
}

/** The adjustment's receipt, built from work records' division. */
function adjustmentResult(input: {
	operationId: string;
	employeeId: string;
	trigger: AutomaticBreakAdjustmentTrigger;
	intent: typeof workBreakAdjustmentIntent.$inferSelect | null;
	policy: { evaluatedAt: string; policyId: string };
	timezone: string;
	division: OwedBreakDivision;
}): AutomaticBreakAdjustmentResult {
	const { trigger, intent, division } = input;
	const { owedBreak, source, retained, generated, appended } = division;
	const { previousEntryId, previousHash } = appended.clockIn;
	if (!previousEntryId || !previousHash) {
		throw new CompletedWorkIntegrityError("Break clock-in has no predecessor");
	}
	return {
		version: AUTOMATIC_BREAK_ADJUSTMENT_RESULT_VERSION,
		operationId: input.operationId,
		owner: { employeeId: input.employeeId },
		actors: {
			executing: { kind: "system", process: "automatic_break_adjustment" },
			triggeredBy: trigger.userId
				? { kind: "human", userId: trigger.userId, closureEntryId: trigger.closureEntryId }
				: { kind: "unknown", closureEntryId: trigger.closureEntryId },
		},
		originatingWork: {
			...source.segment,
			approvalState: source.approvalState,
			recordCreatedBy: source.recordCreatedBy,
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
			evaluatedAt: input.policy.evaluatedAt,
			policyId: input.policy.policyId,
			regulationId: owedBreak.regulation.id,
			regulationName: owedBreak.regulation.name,
			rule: owedBreak.rule,
		},
		adjustment: {
			breakMinutes: owedBreak.breakMinutes,
			alreadyTakenBreakMinutes: owedBreak.alreadyTakenBreakMinutes,
			breakStartAt: instantToCanonicalString(owedBreak.startAt),
			breakEndAt: instantToCanonicalString(owedBreak.endAt),
			timezone: input.timezone,
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
					basis: "originating_work",
					sourceDecisionIds: source.decisionIds,
				},
			},
		],
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
			originating: { source: source.revision, result: retained.after.revision },
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

export type RunAutomaticBreakAdjustmentInput = AutomaticBreakTarget & {
	trigger: AutomaticBreakAdjustmentTrigger;
	/**
	 * The scheduled recovery of a committed intent. An organization that returned to
	 * legacy admission keeps its intents for re-adoption, untouched.
	 */
	recoveringIntent?: boolean;
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
	if (!input.recoveringIntent && !(await mayOweBreak(input))) return { kind: "not_required" };
	try {
		return await withCompletedWorkTransaction(
			{
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				actorUserId: null,
			},
			(scope) => adjustAutomaticBreakInTransaction(scope, { ...input, now: now() }),
		);
	} catch (error) {
		await recordAutomaticBreakFailure(input, error, now());
		throw error;
	}
}

/**
 * A hint from plain reads, so that work with no committed intent to resolve and no
 * break regulation opens no coordinated transaction. It never reads admission (#1231):
 * the transaction re-reads everything, and a committed intent always runs it.
 */
async function mayOweBreak(target: AutomaticBreakTarget): Promise<boolean> {
	const [intent] = await db
		.select({ id: workBreakAdjustmentIntent.id })
		.from(workBreakAdjustmentIntent)
		.where(
			and(
				eq(workBreakAdjustmentIntent.id, deriveAutomaticBreakIntentId(target)),
				eq(workBreakAdjustmentIntent.organizationId, target.organizationId),
			),
		)
		.limit(1);
	if (intent) return true;
	const [period] = await db
		.select({ endTime: workPeriod.endTime, wasAutoAdjusted: workPeriod.wasAutoAdjusted })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, target.workPeriodId),
				eq(workPeriod.organizationId, target.organizationId),
				eq(workPeriod.employeeId, target.employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period?.endTime || period.wasAutoAdjusted) return false;
	const breakPolicy = await resolvePolicyClockOutBreakSnapshotInTransaction({
		dbService: { db },
		organizationId: target.organizationId,
		employeeId: target.employeeId,
		endTime: instantFromDate(period.endTime),
	});
	return regulationFrom(breakPolicy) !== null;
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

/**
 * Whether the organization's closures commit adjustment intents: those organizations'
 * work is recovered by `processAutomaticBreakIntents`, so the daily check of a day's
 * work leaves them out. A selection by it never names admission (#1231).
 */
export function recoveredByIntent(organizationId: SQLWrapper): SQL {
	return sql`exists (select 1 from time_entry_append_control control where control.organization_id = ${organizationId} and control.mode = 'active')`;
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
				recoveringIntent: true,
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
