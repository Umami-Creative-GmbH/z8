import "server-only";

/**
 * The time approval decision (spec #1673): decides one time approval, whatever
 * its kind (time correction, manual time submission, policy clock-out), its
 * approval authority (legacy, shadow mirroring, canonical) or its entry point.
 *
 * The caller names the organization, one approval (a legacy request or a
 * canonical assignment), the actor, one decision right and the decision. The
 * kind is classified with plain reads before any guard, because the approval
 * write gate at rank 2 belongs to the decided kind (Time Tracking ADR 0001);
 * one work transaction then runs under that kind's gate, classifies again
 * under the guards and restarts on a mismatch. The claimed right is verified
 * from the database inside that transaction and never exchanged for another
 * (Approvals ADR 0003). After commit, the module runs the work the kind and
 * authority call for, awaits it, logs each failure and keeps the result.
 *
 * A refusal is a value. Infrastructure failures and broken invariants throw.
 */
import { and, eq } from "drizzle-orm";
import { db as applicationDatabase } from "@/db";
import {
	approvalRequest,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
	workPeriod,
} from "@/db/schema";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { monthClosedRefusalOf } from "@/lib/time-tracking/closed-months/refusal";
import type { ClosedMonthKey } from "@/lib/time-tracking/closed-months/rules";
import {
	type CorrectionOverlap,
	correctionOverlapsSchema,
} from "@/lib/time-tracking/correction-overlaps";
import { isUnresolvedWorkPeriodReview } from "@/lib/time-tracking/work-period-review";
import { readReviewBindingAuthority } from "../../authority/binding";
import { TimeCorrectionApprovalAdapterError } from "../../domain-adapters/time-correction.adapter";
import { TimeCorrectionLegacyStateCaptureError } from "../../domain-adapters/time-correction-legacy-state";
import { OrdinaryWorkPeriodApprovalAdapterError } from "../../domain-adapters/work-period.adapter";
import { OrdinaryWorkPeriodLegacyStateCaptureError } from "../../domain-adapters/work-period-legacy-state";
import type { DecisionRight } from "../../decision-right";
import { DEPUTY_FOUR_EYES_REFUSAL } from "../../deputy/deputy-decision";
import { ApprovalAssignmentReassignedError } from "../../escalation/decision-authority";
import { ApprovalEvidenceError } from "../../evidence/errors";
import { ApprovalInvocationNotAdmittedError } from "../../evidence/invocation";
import {
	type DecisionEvidenceRecord,
	type LegacyDecisionEvidenceRecord,
	loadLegacyReviewBinding,
	loadReviewBinding,
} from "../../evidence/store";
import { OWN_REQUEST_REFUSAL } from "../../policies/self-decision";
import { classifyCanonicalTimeCard, classifyLegacyTimeCard } from "../../presentation/time-card";
import { isTimeApprovalWorkflowType, type TimeApprovalWorkflowType } from "../../time-approval-kinds";
import { ApprovalCommandActorForbiddenError } from "../../workflow/runtime";
import { ApprovalTransitionEngineError } from "../../workflow/transition-engine";
import { type BoundTimeInvocation, BoundTimeInvocationReplay } from "../bound-time-invocation";
import { classifyPersistedTimeApprovalRequest } from "../time-approval-classification";
import { TimeApprovalKindChanged } from "../time-approval-kind-changed";
import { findTimeApprovalTarget } from "../time-approval-work-period";
import { decideTimeCorrectionApproval } from "../time-correction-approvals";
import type { ApprovalDatabase, CurrentApprover } from "../types";
import {
	decideOrdinaryTimeApproval,
	isOrdinaryWorkPeriodDecisionRefusal,
	OrdinaryWorkPeriodFinalizationConflict,
} from "../work-period-approvals";

/** A restart is a race with a reclassification; it settles at once. */
const MAX_ATTEMPTS = 3;

export type TimeApprovalDecisionRefusalReason =
	| "not_found"
	| "already_decided"
	| "right_not_held"
	| "reassigned"
	| "own_request"
	| "changed"
	| "evidence_required"
	| "month_closed"
	/** Legacy requests only. */
	| "unclassified"
	/** The fast-lane assessment changed. */
	| "guard_failed"
	/** Cards only. */
	| "binding_mismatch"
	| "not_admitted"
	| "invocation_conflict";

/**
 * What an entry point needs to word a refusal beyond its reason, as typed
 * data: never read from a message.
 */
export type TimeApprovalRefusalDetail =
	/** `right_not_held`: a covering deputy already decided an earlier stage (four-eyes). */
	| { kind: "deputy_four_eyes" }
	/** `evidence_required` or `changed`: the submitted evidence's verdict. */
	| { kind: "evidence"; code: "evidence_required" | "evidence_incomplete" | "material_change" }
	/** `changed`: the corrected interval now overlaps other recorded work. */
	| { kind: "work_overlap"; overlaps: CorrectionOverlap[] }
	/** `changed`: an earlier request or changed work collides with the correction. */
	| { kind: "work_collision" }
	/** `changed`: another approval of the same work period is still pending. */
	| { kind: "work_pending_review"; pending: "approval" | "time_correction" }
	/** `changed`: the work needs review before it can change. */
	| { kind: "work_review_required" }
	/** `month_closed`: the closed month. */
	| { kind: "month_closed"; month: ClosedMonthKey };

export type TimeApprovalDecisionRefusal = {
	status: "refused";
	reason: TimeApprovalDecisionRefusalReason;
	detail?: TimeApprovalRefusalDetail;
};

export type TimeApprovalDecisionResult =
	| {
			status: "decided";
			kind: TimeApprovalWorkflowType;
			workPeriodId: string;
			/** `advanced`: the next stage is now pending. */
			outcome: "approved" | "rejected" | "advanced";
			replayed: boolean;
			/** Card presses only: the decision evidence the press committed or replayed. */
			receipt?: TimeApprovalDecisionReceipt;
	  }
	| TimeApprovalDecisionRefusal;

/** A card's receipt: canonical evidence, or legacy evidence for a legacy binding. */
export type TimeApprovalDecisionReceipt = DecisionEvidenceRecord | LegacyDecisionEvidenceRecord;

/** A card press: the review binding the card carried and the provider invocation. */
export type TimeApprovalCard = BoundTimeInvocation;

/** The rights a card can convey (Approvals ADR 0003): never eligible-manager or management. */
export type CardDecisionRight = Extract<DecisionRight, { as: "approver" | "covering_deputy" }>;

interface TimeApprovalDecisionInputBase {
	organizationId: string;
	/** A legacy request id or a canonical assignment id; never a workflow id. */
	approvalId: string;
	actor: { employeeId: string; userId: string };
	decision: { kind: "approve" } | { kind: "reject"; reason: string };
	/** The database that opens the work transaction; defaults to the application database. */
	database?: ApprovalDatabase;
	clock?: Clock;
}

export type TimeApprovalDecisionInput = TimeApprovalDecisionInputBase &
	(
		| {
				right: DecisionRight;
				card?: undefined;
				/** The fast lane's guard; refusing it gives `guard_failed`. */
				fastLaneGuard?: (database: ApprovalDatabase) => Promise<void>;
				/**
				 * Confirms a decision that already committed and never makes a fresh one.
				 * Only the unbound bot card uses it; it goes with that card at cutover.
				 */
				replayOnly?: boolean;
		  }
		| {
				/** A card conveys only its recipient's right as approver or covering deputy. */
				right: CardDecisionRight;
				/**
				 * The card's review binding and invocation. The kind comes from the
				 * binding, never from classification; the decision runs under the
				 * invocation's own receipt and an exact repeat replays it.
				 */
				card: TimeApprovalCard;
				fastLaneGuard?: undefined;
				replayOnly?: undefined;
		  }
	);

type RoutedTarget =
	| {
			found: true;
			kind: TimeApprovalWorkflowType | "unclassified";
			workPeriodId: string;
			currentApproverEmployeeId: string | null;
			/** The legacy request that names this decision, if any (eligibility reads it). */
			legacyApprovalRequestId: string | null;
			pending: boolean;
	  }
	| { found: false };

/**
 * The target and its kind, from plain reads before any guard: a legacy
 * request is classified as its decision owner classifies it, a canonical
 * assignment's kind is its workflow's type. Every read is organization-scoped.
 */
async function routeTimeApproval(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string },
	/** A card's kind, from its binding: a legacy request is then never classified. */
	cardKind?: TimeApprovalWorkflowType,
): Promise<RoutedTarget> {
	const target = await findTimeApprovalTarget(database, input);
	if (!target) return { found: false };
	if (target.authority === "legacy") {
		const { request } = target;
		const period = await database.query.workPeriod.findFirst({
			where: and(
				eq(workPeriod.id, request.entityId),
				eq(workPeriod.organizationId, input.organizationId),
			),
			columns: { id: true, clockInId: true, clockOutId: true, pendingChanges: true },
		});
		if (!period) return { found: false };
		const kind =
			cardKind ??
			(await classifyPersistedTimeApprovalRequest(database, {
				organizationId: input.organizationId,
				request,
				period,
			}));
		return {
			found: true,
			kind,
			workPeriodId: period.id,
			currentApproverEmployeeId: request.approverId,
			legacyApprovalRequestId: request.id,
			pending: request.status === "pending",
		};
	}
	const { assignment, workflow } = target;
	if (!isTimeApprovalWorkflowType(workflow.workflowType)) return { found: false };
	const stage = await database.query.approvalWorkflowStage.findFirst({
		where: and(
			eq(approvalWorkflowStage.id, assignment.stageId),
			eq(approvalWorkflowStage.organizationId, input.organizationId),
		),
		columns: { legacyApprovalRequestId: true },
	});
	return {
		found: true,
		kind: workflow.workflowType,
		workPeriodId: workflow.sourceId,
		currentApproverEmployeeId: assignment.approverEmployeeId,
		legacyApprovalRequestId: stage?.legacyApprovalRequestId ?? null,
		pending: assignment.status === "pending",
	};
}

async function loadActor(
	database: ApprovalDatabase,
	input: TimeApprovalDecisionInput,
): Promise<CurrentApprover | null> {
	const row = await database.query.employee.findFirst({
		where: and(
			eq(employee.id, input.actor.employeeId),
			eq(employee.organizationId, input.organizationId),
			eq(employee.userId, input.actor.userId),
			eq(employee.isActive, true),
		),
		with: { user: true },
	});
	return row?.user ? { ...row, user: row.user } : null;
}

/**
 * How far an already committed decision got, for a replayed card press: the
 * approval's own status, or `advanced` while its time approval is still pending.
 */
async function committedOutcome(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string },
): Promise<"approved" | "rejected" | "advanced"> {
	const target = await findTimeApprovalTarget(database, input);
	if (target?.authority === "legacy") {
		const { request } = target;
		const pending = await database.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, request.entityId),
				eq(approvalRequest.status, "pending"),
			),
			columns: { id: true },
		});
		if (pending || (request.status !== "approved" && request.status !== "rejected")) {
			return "advanced";
		}
		return request.status;
	}
	const workflow = target?.workflow;
	return workflow?.status === "approved" || workflow?.status === "rejected"
		? workflow.status
		: "advanced";
}

type Refusal = Omit<TimeApprovalDecisionRefusal, "status">;

function refused(reason: TimeApprovalDecisionRefusalReason, detail?: TimeApprovalRefusalDetail) {
	return detail
		? ({ status: "refused", reason, detail } as const)
		: ({ status: "refused", reason } as const);
}

function evidenceRefusal(code: unknown): Refusal | null {
	switch (code) {
		case "evidence_required":
		case "evidence_incomplete":
			return { reason: "evidence_required", detail: { kind: "evidence", code } };
		case "material_change":
			return { reason: "changed", detail: { kind: "evidence", code } };
		case "binding_mismatch":
			return { reason: "binding_mismatch" };
		case "invocation_mismatch":
			return { reason: "invocation_conflict" };
		default:
			return null;
	}
}

/** The overlaps a correction's occupied interval names, as the routes show them. */
function overlapsOf(details: Record<string, unknown> | undefined): CorrectionOverlap[] {
	const overlaps = correctionOverlapsSchema.safeParse(details?.overlaps);
	return overlaps.success ? overlaps.data : [];
}

/**
 * The refusal an owner's error stands for: each corresponds to an error the
 * owners raised before this module, and carries what its entry points show as
 * typed detail. Anything else is a failure and throws.
 */
function refusalOf(error: unknown): Refusal | null {
	const closed = monthClosedRefusalOf(error);
	if (closed) return { reason: "month_closed", detail: { kind: "month_closed", month: closed.month } };
	if (isUnresolvedWorkPeriodReview(error)) {
		const pending =
			error.conflictType === "pending_time_correction_approval" ? "time_correction" : "approval";
		return { reason: "changed", detail: { kind: "work_pending_review", pending } };
	}
	if (error instanceof ApprovalAssignmentReassignedError) return { reason: "reassigned" };
	if (error instanceof ApprovalInvocationNotAdmittedError) return { reason: "not_admitted" };
	if (error instanceof ApprovalEvidenceError) return evidenceRefusal(error.code);
	if (error instanceof ApprovalTransitionEngineError) {
		switch (error.code) {
			case "forbidden":
				return { reason: "right_not_held" };
			case "version_conflict":
			case "idempotency_mismatch":
				return { reason: "changed" };
			default:
				return null;
		}
	}
	if (error instanceof ApprovalCommandActorForbiddenError) return { reason: "right_not_held" };
	if (error instanceof NotFoundError) return { reason: "not_found" };
	if (error instanceof AuthorizationError) {
		if (error.refusal === OWN_REQUEST_REFUSAL) return { reason: "own_request" };
		return error.refusal === DEPUTY_FOUR_EYES_REFUSAL
			? { reason: "right_not_held", detail: { kind: "deputy_four_eyes" } }
			: { reason: "right_not_held" };
	}
	if (error instanceof ValidationError) {
		return error.field === "approvalRequest.metadata.timeRequest.kind"
			? { reason: "unclassified" }
			: null;
	}
	if (error instanceof ConflictError) {
		switch (error.conflictType) {
			case "approval_status":
				return { reason: "already_decided" };
			case "approval_reassigned":
				return { reason: "reassigned" };
			case "approval_triage":
				return { reason: "guard_failed" };
			case "approval_evidence":
				return evidenceRefusal(error.details?.code);
			case "approval_transition":
				return { reason: "changed" };
			case "completed_work_collision":
				return { reason: "changed", detail: { kind: "work_collision" } };
			case "completed_work_review_required":
				return { reason: "changed", detail: { kind: "work_review_required" } };
			case "work_interval_occupied":
				return {
					reason: "changed",
					detail: { kind: "work_overlap", overlaps: overlapsOf(error.details) },
				};
			default:
				return null;
		}
	}
	return null;
}

/**
 * The owners' failures when the live work no longer matches the approval's
 * source. The same failures also stand for broken invariants, so they are a
 * refusal only when the submitted evidence confirms the work changed.
 */
function isSourceMismatch(error: unknown): boolean {
	return (
		isOrdinaryWorkPeriodDecisionRefusal(error) ||
		error instanceof OrdinaryWorkPeriodFinalizationConflict ||
		error instanceof OrdinaryWorkPeriodApprovalAdapterError ||
		error instanceof OrdinaryWorkPeriodLegacyStateCaptureError ||
		error instanceof TimeCorrectionApprovalAdapterError ||
		error instanceof TimeCorrectionLegacyStateCaptureError ||
		(error instanceof ConflictError &&
			(error.conflictType === "approval_status" ||
				error.conflictType === "time_correction_finalization_conflict"))
	);
}

/**
 * Whether the pending approval's work changed since it was submitted, by its
 * submitted revision: the comparison review and cards show. Without captured
 * evidence nothing is known to have changed.
 */
async function workChangedSinceSubmission(
	database: ApprovalDatabase,
	input: { organizationId: string; approvalId: string },
	target: { kind: TimeApprovalWorkflowType; workPeriodId: string },
): Promise<boolean> {
	const legacy = await classifyLegacyTimeCard(database, {
		organizationId: input.organizationId,
		approvalRequestId: input.approvalId,
	});
	if (legacy) return legacy.status === "material_change";
	const workflow = await database.query.approvalWorkflow.findFirst({
		where: and(
			eq(approvalWorkflow.organizationId, input.organizationId),
			eq(approvalWorkflow.sourceType, "time_entry"),
			eq(approvalWorkflow.sourceId, target.workPeriodId),
			eq(approvalWorkflow.workflowType, target.kind),
			eq(approvalWorkflow.status, "pending"),
		),
		columns: { id: true },
	});
	if (!workflow) return false;
	return (
		(await classifyCanonicalTimeCard(database, {
			organizationId: input.organizationId,
			workflowId: workflow.id,
			workflowType: target.kind,
			sourceId: target.workPeriodId,
		})) === "material_change"
	);
}

/** The card's bound kind, or a refusal when the card cannot decide this approval. */
async function cardKindOf(
	database: ApprovalDatabase,
	input: TimeApprovalDecisionInput & { card: TimeApprovalCard },
): Promise<TimeApprovalWorkflowType | TimeApprovalDecisionRefusal> {
	// A card conveys only its recipient's own right (Approvals ADR 0003).
	const right: DecisionRight = input.right;
	if (right.as !== "approver" && right.as !== "covering_deputy") {
		return refused("right_not_held");
	}
	// The card's kind is its binding's, never a classification.
	const bindingQuery = {
		organizationId: input.organizationId,
		bindingId: input.card.reviewedBindingId,
	};
	const binding = await readReviewBindingAuthority(database, bindingQuery);
	// The card decides exactly the approval its binding names.
	const boundApprovalId =
		binding?.authority === "legacy"
			? (await loadLegacyReviewBinding(database, bindingQuery))?.legacyApprovalRequestId
			: (await loadReviewBinding(database, bindingQuery))?.assignmentId;
	if (
		!binding?.kind ||
		!isTimeApprovalWorkflowType(binding.kind) ||
		boundApprovalId !== input.approvalId
	) {
		return refused("binding_mismatch");
	}
	return binding.kind;
}

/** One time approval decision; a refusal is a value. */
export async function decideTimeApproval(
	input: TimeApprovalDecisionInput,
): Promise<TimeApprovalDecisionResult> {
	const database = input.database ?? applicationDatabase;
	const clock = input.clock ?? systemClock;
	const actor = await loadActor(database, input);
	if (!actor) return refused("not_found");
	let cardKind: TimeApprovalWorkflowType | undefined;
	if (input.card) {
		const kind = await cardKindOf(database, { ...input, card: input.card });
		if (typeof kind !== "string") return kind;
		cardKind = kind;
	}
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
		const target = await routeTimeApproval(database, input, cardKind);
		if (!target.found) return refused("not_found");
		if (cardKind && target.kind !== cardKind) return refused("binding_mismatch");
		if (target.kind === "unclassified") return refused("unclassified");
		// `replayOnly` confirms only its approver's own committed decision.
		if (input.replayOnly && target.currentApproverEmployeeId !== actor.id) {
			return refused("right_not_held");
		}
		try {
			if (target.kind === "time_correction") {
				// Only a committed manual or policy decision can be confirmed by replay.
				if (input.replayOnly) return refused("changed");
				return await decideTimeCorrectionApproval(
					input,
					actor,
					database,
					clock,
					target.workPeriodId,
				);
			}
			return await decideOrdinaryTimeApproval(
				input,
				actor,
				database,
				clock,
				target.kind,
				target.workPeriodId,
			);
		} catch (error) {
			if (error instanceof BoundTimeInvocationReplay) {
				// The card's invocation had already committed: its original decision.
				return {
					status: "decided",
					kind: target.kind,
					workPeriodId: target.workPeriodId,
					outcome: await committedOutcome(database, input),
					replayed: true,
					receipt: error.evidence,
				};
			}
			if (error instanceof TimeApprovalKindChanged) {
				// A card decides only the kind its binding names.
				if (input.card) return refused("binding_mismatch");
				continue;
			}
			if (
				input.card &&
				error instanceof ApprovalTransitionEngineError &&
				error.code === "idempotency_mismatch"
			) {
				// The card's invocation is the receipt key: another command under it.
				return refused("invocation_conflict");
			}
			const refusal = refusalOf(error);
			const statusConflict =
				error instanceof ConflictError && error.conflictType === "approval_status";
			if (refusal && !statusConflict) return refused(refusal.reason, refusal.detail);
			const now = await routeTimeApproval(database, input);
			// Work changed in place since submission: the source no longer is the reviewed one.
			if (
				now.found &&
				now.pending &&
				isSourceMismatch(error) &&
				(await workChangedSinceSubmission(database, input, {
					kind: target.kind,
					workPeriodId: target.workPeriodId,
				}))
			) {
				return refused("changed");
			}
			// A status conflict on an approval that is still pending is a broken
			// invariant, not a refusal. The legacy owners raise it when the request
			// they locked is no longer pending, which cannot be once it reads
			// pending again after the rollback; and the ordinary legacy finalizer
			// raises it for any failed write. No refusal reason stands for either.
			if (statusConflict && now.found && now.pending) throw error;
			if (refusal) return refused(refusal.reason, refusal.detail);
			if (isOrdinaryWorkPeriodDecisionRefusal(error)) {
				// The ordinary owner's generic refusal: the current state names it.
				return refused(!now.found ? "not_found" : now.pending ? "changed" : "already_decided");
			}
			// A decided approval is never decided again, however its owner refused it.
			if (now.found && !now.pending) return refused("already_decided");
			throw error;
		}
	}
	throw new Error("Time approval kind did not settle under the work transaction's guards");
}
