import type { ApprovalTerminalFinalizationResult } from "../domain-adapters/types";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalCommandResult, ApprovalWorkflowSnapshot } from "../workflow/ports";
import type { ApprovalWorkflowCommand } from "../workflow/state-machine";
import { deriveCommandDecisionOutcome } from "./decision-outcome";
import { ApprovalEvidenceError } from "./errors";
import {
	loadEvidenceActorLabel,
	loadPeriodSubmissionSubmittedRevision,
	type PeriodSubmissionSubmittedRevisionRecord,
	recordDecisionEvidence,
} from "./store";
import {
	assertTimeReviewBinding,
	type ReviewedDecisionTarget,
	timeEvidenceCommandFingerprintDigest,
	workPeriodReceiptKeyDigest,
} from "./work-period-evidence";

/**
 * Decision evidence of period submissions (#1059). Every submission captures its revision, so a
 * decision without one is held. A reviewed binding (a bot card) must name the deciding actor,
 * the exact assignment and the revision, as for every canonical kind (#325).
 */

async function loadDecisionRevision(
	database: ApprovalDatabase,
	input: { organizationId: string; workflow: ApprovalWorkflowSnapshot },
): Promise<PeriodSubmissionSubmittedRevisionRecord> {
	const revision = await loadPeriodSubmissionSubmittedRevision(database, {
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
	});
	if (!revision) throw new ApprovalEvidenceError("evidence_required");
	if (
		revision.periodSubmissionId !== input.workflow.sourceId ||
		revision.subjectEmployeeId !== input.workflow.requesterEmployeeId
	) {
		throw new ApprovalEvidenceError("invariant", { field: "revision_scope" });
	}
	return revision;
}

export async function preflightPeriodSubmissionDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		reviewedBindingId: string | null;
		target: ReviewedDecisionTarget;
	},
): Promise<void> {
	const revision = await loadDecisionRevision(database, input);
	await assertTimeReviewBinding(database, { ...input, submittedRevisionId: revision.id });
}

/**
 * Records one executed decision in the engine's transaction. The receipt key and command
 * fingerprint are kept as digests, like the time kinds, so a bound card's invocation finds its
 * evidence by `workPeriodReceiptKeyDigest`.
 */
export async function recordPeriodSubmissionDecisionEvidence(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		workflow: ApprovalWorkflowSnapshot;
		command: Extract<ApprovalWorkflowCommand, { type: "approve" | "reject" }>;
		receipt: { idempotencyKey: string; actorFingerprint: string; commandFingerprint: string };
		result: ApprovalCommandResult;
		finalization: ApprovalTerminalFinalizationResult | null;
		reviewedBindingId: string | null;
	},
): Promise<void> {
	const revision = await loadDecisionRevision(database, input);
	const outcome = deriveCommandDecisionOutcome(input);
	const actor = await loadEvidenceActorLabel(database, {
		organizationId: input.organizationId,
		employeeId: outcome.actor.employeeId,
	});
	if (!actor) throw new ApprovalEvidenceError("evidence_incomplete", { field: "actor" });
	await recordDecisionEvidence(database, {
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
		submittedRevisionId: revision.id,
		operationKind: "command",
		receipt: {
			...input.receipt,
			idempotencyKey: workPeriodReceiptKeyDigest(input.receipt.idempotencyKey),
			commandFingerprint: timeEvidenceCommandFingerprintDigest(input.receipt.commandFingerprint),
		},
		action: input.command.type,
		stageId: outcome.stageId,
		assignmentId: outcome.assignmentId,
		assignmentOutcome: outcome.assignmentOutcome,
		requestOutcome: outcome.requestOutcome,
		actor: { kind: "employee", employeeId: outcome.actor.employeeId, userId: outcome.actor.userId },
		decidedAt: outcome.decidedAt,
		eventIds: outcome.eventIds,
		result: {
			periodSubmissionStatus: input.finalization?.terminalStatus ?? ("pending" as const),
		},
		labels: { actorName: actor.name },
		reviewedBindingId: input.reviewedBindingId,
	});
}
