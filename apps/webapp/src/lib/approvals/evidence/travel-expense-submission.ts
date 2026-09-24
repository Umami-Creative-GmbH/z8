import { and, eq } from "drizzle-orm";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
	project,
	travelExpenseAttachment,
	travelExpenseClaim,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { ResolvePolicyAndCreateApprovalResult } from "../policies/chain-service";
import type { ApprovalDatabase } from "../server/types";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { loadEmployeeLabel } from "./absence-submission";
import { ApprovalEvidenceError } from "./errors";
import {
	captureLegacyTravelExpenseSubmittedRevision,
	type LegacyTravelExpenseSubmittedRevisionRecord,
	readApprovalEvidenceMode,
	recordLegacyDecisionEvidence,
} from "./store";
import {
	buildTravelExpenseSubmittedFacts,
	compareLiveTravelExpenseWithRevision,
	type TravelExpenseFactsInput,
	type TravelExpenseRevisionComparison,
} from "./travel-expense-facts";

/**
 * Expense submission evidence (#295). Expense approvals are decided only by the
 * legacy owners, so the frozen claim is a legacy submitted revision linked to
 * the approval request routing created. It runs inside the submission
 * transaction after the claim row is locked, submitted and routed.
 */

const TRAVEL_EXPENSE_SUBMISSION_COMMAND = "travel-expense-legacy-submission:v1";

export function travelExpenseRequestCycleKey(claimId: string): string {
	// A claim leaves draft exactly once; a changed claim is a new claim.
	return `travel_expense_claim:${claimId}:submission`;
}

export interface TravelExpenseSubmissionEvidenceInput {
	organizationId: string;
	claimId: string;
	submitter: { employeeId: string; userId: string };
	routing: ResolvePolicyAndCreateApprovalResult;
}

/** Persisted claim and receipt rows, scoped to one organization. */
export async function loadTravelExpenseFactsInput(
	database: ApprovalDatabase,
	scope: { organizationId: string; claimId: string },
) {
	const [claims, attachments] = await Promise.all([
		database
			.select()
			.from(travelExpenseClaim)
			.where(
				and(
					eq(travelExpenseClaim.id, scope.claimId),
					eq(travelExpenseClaim.organizationId, scope.organizationId),
				),
			)
			.limit(2),
		database
			.select()
			.from(travelExpenseAttachment)
			.where(
				and(
					eq(travelExpenseAttachment.claimId, scope.claimId),
					eq(travelExpenseAttachment.organizationId, scope.organizationId),
				),
			),
	]);
	const claim = claims[0];
	if (claims.length !== 1 || !claim) return null;
	return { claim, attachments } satisfies TravelExpenseFactsInput;
}

async function verifyLegacyLifecycle(
	database: ApprovalDatabase,
	input: TravelExpenseSubmissionEvidenceInput,
): Promise<{ chainInstanceId: string | null; chainStageId: string | null }> {
	const expectedStatus = input.routing.kind === "auto_completed" ? "approved" : "pending";
	const requests = await database
		.select({ id: approvalRequest.id, status: approvalRequest.status })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, input.routing.approvalRequestId),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "travel_expense_claim"),
				eq(approvalRequest.entityId, input.claimId),
			),
		)
		.limit(2);
	if (requests.length !== 1 || requests[0]?.status !== expectedStatus) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_lifecycle",
		});
	}
	const chainInstanceId =
		input.routing.kind === "default_created" ? null : input.routing.chainInstanceId;
	if (!chainInstanceId) return { chainInstanceId: null, chainStageId: null };

	const [chains, stages] = await Promise.all([
		database
			.select({ id: approvalChainInstance.id })
			.from(approvalChainInstance)
			.where(
				and(
					eq(approvalChainInstance.id, chainInstanceId),
					eq(approvalChainInstance.organizationId, input.organizationId),
					eq(approvalChainInstance.entityType, "travel_expense_claim"),
					eq(approvalChainInstance.entityId, input.claimId),
				),
			)
			.limit(2),
		database
			.select({ id: approvalChainStageInstance.id })
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.chainInstanceId, chainInstanceId),
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, input.routing.approvalRequestId),
				),
			)
			.limit(2),
	]);
	if (chains.length !== 1 || stages.length > 1) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "legacy_lifecycle",
		});
	}
	return { chainInstanceId, chainStageId: stages[0]?.id ?? null };
}

async function loadProjectName(
	database: ApprovalDatabase,
	organizationId: string,
	projectId: string | null,
): Promise<string | null> {
	if (!projectId) return null;
	const rows = await database
		.select({ name: project.name })
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
		.limit(1);
	// A foreign or missing project is never disclosed, even as a label.
	return rows[0]?.name ?? null;
}

/**
 * Captures the claim's immutable submitted facts and frozen receipt manifest.
 * Returns null while capture is inactive for the organization. Any failure
 * throws and rolls back the submission; nothing is inferred from current
 * timezone, attachment count or policy.
 */
export async function captureTravelExpenseSubmissionEvidence(
	database: ApprovalDatabase,
	input: TravelExpenseSubmissionEvidenceInput,
): Promise<LegacyTravelExpenseSubmittedRevisionRecord | null> {
	const mode = await readApprovalEvidenceMode(database, {
		organizationId: input.organizationId,
		workflowType: "travel_expense",
	});
	if (mode !== "capture") return null;

	const loaded = await loadTravelExpenseFactsInput(database, input);
	if (!loaded) {
		throw new ApprovalEvidenceError("invariant", { field: "claim" });
	}
	const { claim, attachments } = loaded;
	const expectedStatus = input.routing.kind === "auto_completed" ? "approved" : "submitted";
	if (claim.status !== expectedStatus || !claim.submittedAt) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "claim_status",
		});
	}
	const lifecycle = await verifyLegacyLifecycle(database, input);

	const [subject, submitter, projectName] = await Promise.all([
		loadEmployeeLabel(database, input.organizationId, {
			employeeId: claim.employeeId,
		}),
		loadEmployeeLabel(database, input.organizationId, {
			userId: input.submitter.userId,
		}),
		loadProjectName(database, input.organizationId, claim.projectId),
	]);
	if (
		!subject ||
		!submitter ||
		submitter.employeeId !== input.submitter.employeeId ||
		submitter.userId !== input.submitter.userId
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "roles" });
	}

	const facts = buildTravelExpenseSubmittedFacts({ claim, attachments });
	const revision = await captureLegacyTravelExpenseSubmittedRevision(database, {
		organizationId: input.organizationId,
		requestCycleKey: travelExpenseRequestCycleKey(claim.id),
		// Persisted submission instant of the claim, never a render time.
		submittedAt: instantFromDate(claim.submittedAt),
		facts,
		labels: {
			subjectName: subject.name,
			requesterName: subject.name,
			submitterName: submitter.name,
			projectName,
			receiptFileNames: Object.fromEntries(
				attachments.map((attachment) => [attachment.id, attachment.fileName]),
			),
		},
		submitter: {
			kind: "employee",
			employeeId: submitter.employeeId,
			userId: submitter.userId,
		},
		legacy: {
			approvalRequestId: input.routing.approvalRequestId,
			chainInstanceId: lifecycle.chainInstanceId,
			observedWorkflowId: null,
		},
	});

	if (input.routing.kind === "auto_completed") {
		// Routing approved the claim during submission (requester is approver).
		if (!claim.decidedAt) {
			throw new ApprovalEvidenceError("evidence_incomplete", {
				field: "activation_outcome",
			});
		}
		const systemActor = { kind: "system", employeeId: null, userId: null } as const;
		await recordLegacyDecisionEvidence(database, {
			organizationId: input.organizationId,
			submittedRevisionId: revision.id,
			operationKind: "submission_activation",
			receipt: {
				idempotencyKey: revision.requestCycleKey,
				actorFingerprint: fingerprintApprovalCommandActor(systemActor),
				commandFingerprint: TRAVEL_EXPENSE_SUBMISSION_COMMAND,
			},
			action: "approve",
			legacy: {
				approvalRequestId: input.routing.approvalRequestId,
				chainStageId: lifecycle.chainStageId,
				observedWorkflowId: null,
			},
			assignmentOutcome: null,
			requestOutcome: "approved",
			actor: systemActor,
			decidedAt: instantFromDate(claim.decidedAt),
			// Resulting statuses only; no reimbursement or payable amount is inferred.
			result: {
				claimStatus: "approved",
				legacyRequestStatus: "approved",
				decidedAtSource: "travel_expense_claim.decided_at",
				reason: input.routing.reason,
			},
			labels: { actorName: null },
		});
	}
	return revision;
}

/**
 * Fresh check for a decision on an evidenced claim: the live claim and receipt
 * rows must still equal the frozen revision.
 */
export async function compareTravelExpenseWithSubmittedRevision(
	database: ApprovalDatabase,
	revision: LegacyTravelExpenseSubmittedRevisionRecord,
): Promise<TravelExpenseRevisionComparison> {
	const live = await loadTravelExpenseFactsInput(database, {
		organizationId: revision.organizationId,
		claimId: revision.claimId,
	});
	if (!live) {
		return { kind: "material_change", changedFields: ["unverifiable:claim"] };
	}
	return compareLiveTravelExpenseWithRevision(revision.facts, live);
}
