import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { approvalChainStageInstance, approvalRequest, travelExpenseClaim } from "@/db/schema";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalWorkflowStatus } from "../workflow/ports";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { ApprovalEvidenceError } from "./errors";
import {
	findLegacyDecisionEvidenceByRequest,
	isLegacyRequestInRevisionLifecycle,
	type LegacyDecisionEvidenceRecord,
	type LegacyTravelExpenseSubmittedRevisionRecord,
	loadEvidenceActorLabel,
	loadLegacyTravelExpenseSubmittedRevision,
	readApprovalEvidenceMode,
	recordLegacyDecisionEvidence,
} from "./store";
import { compareTravelExpenseWithSubmittedRevision } from "./travel-expense-submission";

/**
 * Expense decision evidence (#296). Expense claims are decided only by the
 * legacy owners, so a decision is recorded as legacy evidence of the frozen
 * submission (#295), in the transaction that commits the legacy mutation. The
 * row doubles as the operation receipt for the one legacy request it decided.
 * Outcome, stage and time come from the persisted legacy rows afterwards,
 * never from the requested action or a clock.
 */

const COMMAND_VERSION = "travel-expense-legacy-decision:v1";

type DecisionAction = "approve" | "reject";

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** Versioned identity of one decision command; reason text enters as a hash only. */
export function fingerprintLegacyTravelExpenseDecisionCommand(input: {
	action: DecisionAction;
	approvalRequestId: string;
	reason: string | undefined;
}): string {
	return `${COMMAND_VERSION}:${sha256(
		JSON.stringify([input.action, input.approvalRequestId, sha256(input.reason ?? "")]),
	)}`;
}

/**
 * Receipt key of a semantic (authenticated web) decision. A bound card
 * decision is keyed by its provider invocation instead, so neither can ever
 * replay the other.
 */
export function travelExpenseDecisionIdempotencyKey(input: {
	claimId: string;
	approvalRequestId: string;
	action: DecisionAction;
	reason: string | undefined;
}): string {
	return `travel_expense_claim:${input.claimId}:${input.approvalRequestId}:${input.action}:${sha256(input.reason ?? "")}`;
}

/** The persisted legacy rows of one decided request, read after the mutation. */
export interface LegacyTravelExpenseDecisionRows {
	request: {
		id: string;
		status: string;
		approverId: string;
		approvedAt: Date | null;
		updatedAt: Date | null;
	};
	chainStage: {
		id: string;
		status: string;
		decidedAt: Date | null;
		decidedBy: string | null;
	} | null;
	claim: { status: string; decidedAt: Date | null };
}

export interface LegacyTravelExpenseDecisionOutcome {
	assignmentOutcome: "approved" | "rejected";
	/** The claim's outcome as of this operation; an intermediate stage stays pending. */
	requestOutcome: ApprovalWorkflowStatus;
	decidedAt: Instant;
	decidedAtSource: string;
	chainStageId: string | null;
	/**
	 * A single-stage request keeps its assigned approver when another authorized
	 * approver decides it, so its row cannot name the decider.
	 */
	actorAuthority: "assigned_approver" | "other_authorized_approver";
	claimStatus: string;
	legacyRequestStatus: string;
}

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

/**
 * Derives the committed outcome from the persisted rows. Anything the rows do
 * not confirm (another outcome, another decider, a missing persisted time, a
 * claim state that cannot follow from this operation) throws and rolls the
 * decision back; nothing is inferred from the requested action.
 */
export function deriveLegacyTravelExpenseDecisionOutcome(
	input: { action: DecisionAction; actorEmployeeId: string },
	rows: LegacyTravelExpenseDecisionRows,
): LegacyTravelExpenseDecisionOutcome {
	const expected = input.action === "approve" ? "approved" : "rejected";
	if (rows.request.status !== expected) incomplete("assignment_outcome");
	let decidedAt: Date | null;
	let decidedAtSource: string;
	if (rows.chainStage) {
		if (
			rows.chainStage.status !== expected ||
			rows.chainStage.decidedBy !== input.actorEmployeeId
		) {
			incomplete("assignment_outcome");
		}
		decidedAt = rows.chainStage.decidedAt;
		decidedAtSource = "approval_chain_stage_instance.decided_at";
	} else if (expected === "approved") {
		decidedAt = rows.request.approvedAt;
		decidedAtSource = "approval_request.approved_at";
	} else {
		// Rejection writes updated_at in the statement that changes the status.
		decidedAt = rows.request.updatedAt;
		decidedAtSource = "approval_request.updated_at";
	}
	if (!decidedAt) incomplete("assignment_outcome");

	let requestOutcome: ApprovalWorkflowStatus;
	switch (rows.claim.status) {
		case "approved":
		case "rejected":
			if (rows.claim.status !== expected || !rows.claim.decidedAt) {
				incomplete("request_outcome");
			}
			requestOutcome = rows.claim.status;
			break;
		case "submitted":
			// Only an intermediate chain approval leaves the claim undecided.
			if (!rows.chainStage || expected !== "approved") incomplete("request_outcome");
			requestOutcome = "pending";
			break;
		default:
			incomplete("request_outcome");
	}
	return {
		assignmentOutcome: expected,
		requestOutcome,
		decidedAt: instantFromDate(decidedAt),
		decidedAtSource,
		chainStageId: rows.chainStage?.id ?? null,
		actorAuthority:
			rows.request.approverId === input.actorEmployeeId
				? "assigned_approver"
				: "other_authorized_approver",
		claimStatus: rows.claim.status,
		legacyRequestStatus: rows.request.status,
	};
}

async function readDecisionRows(
	database: ApprovalDatabase,
	input: { organizationId: string; claimId: string; approvalRequestId: string },
): Promise<LegacyTravelExpenseDecisionRows> {
	const [requests, stages, claims] = await Promise.all([
		database
			.select({
				id: approvalRequest.id,
				status: approvalRequest.status,
				approverId: approvalRequest.approverId,
				approvedAt: approvalRequest.approvedAt,
				updatedAt: approvalRequest.updatedAt,
				entityType: approvalRequest.entityType,
				entityId: approvalRequest.entityId,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.id, input.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
				),
			)
			.limit(2),
		database
			.select({
				id: approvalChainStageInstance.id,
				status: approvalChainStageInstance.status,
				decidedAt: approvalChainStageInstance.decidedAt,
				decidedBy: approvalChainStageInstance.decidedBy,
			})
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
				),
			)
			.limit(2),
		database
			.select({
				status: travelExpenseClaim.status,
				decidedAt: travelExpenseClaim.decidedAt,
			})
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.id, input.claimId),
					eq(travelExpenseClaim.organizationId, input.organizationId),
				),
			)
			.limit(2),
	]);
	const request = requests[0];
	const claim = claims[0];
	if (
		requests.length !== 1 ||
		!request ||
		request.entityType !== "travel_expense_claim" ||
		request.entityId !== input.claimId ||
		stages.length > 1 ||
		claims.length !== 1 ||
		!claim
	) {
		incomplete("legacy_request");
	}
	return {
		request: {
			id: request.id,
			status: request.status,
			approverId: request.approverId,
			approvedAt: request.approvedAt,
			updatedAt: request.updatedAt,
		},
		chainStage: stages[0] ?? null,
		claim,
	};
}

function employeeActorFingerprint(actor: { employeeId: string; userId: string }): string {
	return fingerprintApprovalCommandActor({ kind: "employee", ...actor });
}

/**
 * Receipt before fresh checks for an authenticated decision: the committed
 * operation of this exact request, with the same semantic key, actor and
 * command, returns its historical evidence. A bound card decision (keyed by
 * its invocation) is never matched here, and nothing is matched without the
 * exact request.
 */
export async function findLegacyTravelExpenseDecisionReplay(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		claimId: string;
		approvalRequestId: string;
		action: DecisionAction;
		reason: string | undefined;
		actor: { employeeId: string; userId: string };
	},
): Promise<LegacyDecisionEvidenceRecord | null> {
	const evidence = await findLegacyDecisionEvidenceByRequest(database, {
		organizationId: input.organizationId,
		approvalRequestId: input.approvalRequestId,
	});
	if (evidence?.operationKind !== "command") return null;
	const revision = await loadLegacyTravelExpenseSubmittedRevision(database, {
		organizationId: input.organizationId,
		claimId: input.claimId,
	});
	if (revision?.id !== evidence.submittedRevisionId) return null;
	const matches =
		evidence.receipt.idempotencyKey === travelExpenseDecisionIdempotencyKey(input) &&
		evidence.receipt.actorFingerprint === employeeActorFingerprint(input.actor) &&
		evidence.receipt.commandFingerprint === fingerprintLegacyTravelExpenseDecisionCommand(input);
	return matches ? evidence : null;
}

/**
 * Fresh evidence checks before the legacy mutation. A frozen submission is
 * always enforced (a changed receipt set, amount, date or identity needs a new
 * claim); while capture is active a claim without one is held.
 */
export async function prepareLegacyTravelExpenseDecisionEvidence(
	database: ApprovalDatabase,
	input: { organizationId: string; claimId: string },
): Promise<LegacyTravelExpenseSubmittedRevisionRecord | null> {
	const [mode, revision] = await Promise.all([
		readApprovalEvidenceMode(database, {
			organizationId: input.organizationId,
			workflowType: "travel_expense",
		}),
		loadLegacyTravelExpenseSubmittedRevision(database, input),
	]);
	if (!revision) {
		if (mode === "capture") throw new ApprovalEvidenceError("evidence_required");
		return null;
	}
	const comparison = await compareTravelExpenseWithSubmittedRevision(database, revision);
	if (comparison.kind === "material_change") {
		throw new ApprovalEvidenceError("material_change", {
			fields: comparison.changedFields.join(","),
		});
	}
	return revision;
}

/**
 * Records the committed decision in the transaction of the legacy mutation.
 * A contradiction rolls the whole decision back.
 */
export async function recordLegacyTravelExpenseDecisionEvidence(
	database: ApprovalDatabase,
	revision: LegacyTravelExpenseSubmittedRevisionRecord,
	input: {
		organizationId: string;
		claimId: string;
		action: DecisionAction;
		reason: string | undefined;
		approvalRequestId: string;
		idempotencyKey: string;
		actor: { employeeId: string; userId: string };
		reviewedBindingId: string | null;
	},
): Promise<LegacyDecisionEvidenceRecord> {
	if (
		revision.organizationId !== input.organizationId ||
		revision.claimId !== input.claimId ||
		!(await isLegacyRequestInRevisionLifecycle(database, {
			organizationId: input.organizationId,
			approvalRequestId: input.approvalRequestId,
			revision: {
				sourceType: "travel_expense_claim",
				sourceId: revision.claimId,
				legacy: revision.legacy,
			},
		}))
	) {
		// The decided request is not part of the evidenced lifecycle.
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_lifecycle",
		});
	}
	const outcome = deriveLegacyTravelExpenseDecisionOutcome(
		{ action: input.action, actorEmployeeId: input.actor.employeeId },
		await readDecisionRows(database, input),
	);
	const actor = await loadEvidenceActorLabel(database, {
		organizationId: input.organizationId,
		employeeId: input.actor.employeeId,
	});
	if (!actor) throw new ApprovalEvidenceError("evidence_incomplete", { field: "actor" });
	return await recordLegacyDecisionEvidence(database, {
		organizationId: input.organizationId,
		submittedRevisionId: revision.id,
		operationKind: "command",
		receipt: {
			idempotencyKey: input.idempotencyKey,
			actorFingerprint: employeeActorFingerprint(input.actor),
			commandFingerprint: fingerprintLegacyTravelExpenseDecisionCommand(input),
		},
		action: input.action,
		legacy: {
			approvalRequestId: input.approvalRequestId,
			chainStageId: outcome.chainStageId,
			observedWorkflowId: null,
		},
		assignmentOutcome: outcome.assignmentOutcome,
		requestOutcome: outcome.requestOutcome,
		actor: {
			kind: "employee",
			employeeId: input.actor.employeeId,
			userId: input.actor.userId,
		},
		decidedAt: outcome.decidedAt,
		// Resulting statuses only; no reimbursement or payable amount is inferred.
		result: {
			claimStatus: outcome.claimStatus,
			legacyRequestStatus: outcome.legacyRequestStatus,
			decidedAtSource: outcome.decidedAtSource,
			actorAuthority: outcome.actorAuthority,
		},
		labels: { actorName: actor.name },
		reviewedBindingId: input.reviewedBindingId,
	});
}
