import { and, eq } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import { approvalWorkflow, employee } from "@/db/schema";
import { systemClock } from "@/lib/datetime/temporal-core";
import { lockEmployeePeriodSubmissions } from "@/lib/time-tracking/period-submissions/submission-store";
import { kickApprovalDelivery } from "../delivery/kick";
import { PeriodSubmissionApprovalAdapterError } from "../domain-adapters/period-submission.adapter";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	ApprovalInvocationNotAdmittedError,
	BoundAssignmentNotCurrentError,
	findCommittedInvocationDecision,
	requireCanonicalInvocationDecision,
} from "../evidence/invocation";
import { type DecisionEvidenceRecord, loadReviewBinding } from "../evidence/store";
import { workPeriodReceiptKeyDigest } from "../evidence/work-period-evidence";
import type { ApprovalWorkflowDatabase } from "../workflow/repository";
import { ApprovalTransitionEngineError } from "../workflow/transition-engine";
import {
	admitFreshTimeInvocation,
	type BoundTimeInvocation,
	BoundTimeInvocationReplay,
	boundTimeInvocationCommand,
	boundTimeInvocationKey,
	recordTimeInvocationDecision,
} from "./bound-time-invocation";
import { createPeriodSubmissionApprovalRuntime } from "./period-submission-runtime";
import type { ApprovalAction, ApprovalDatabase } from "./types";

export type BoundPeriodSubmissionInvocationResult =
	| { status: "decided"; replayed: boolean; evidence: DecisionEvidenceRecord }
	| {
			status: "review_required";
			reason: "binding" | "stale" | "material_change" | "evidence" | "not_admitted";
	  }
	| { status: "conflict" }
	| { status: "not_found" };

/**
 * A reviewed-binding decision on a period submission from an authenticated bot invocation
 * (#1059), the same contract as the other canonical kinds (#325): an exact committed invocation
 * replays first; otherwise only the card's recipient, as the bound assignment's current approver,
 * decides exactly that assignment under the invocation's own receipt, with the binding, the
 * submitted revision and the provider's admission revalidated in the deciding transaction. A
 * card never reaches organization-wide management. Infrastructure errors propagate.
 */
export async function decideBoundPeriodSubmissionInvocation(input: {
	database: ApprovalDatabase;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	bindingId: string;
	action: ApprovalAction;
	reason?: string;
	invocation: BoundTimeInvocation["invocation"];
}): Promise<BoundPeriodSubmissionInvocationResult> {
	const { database } = input;
	const bound: BoundTimeInvocation = {
		reviewedBindingId: input.bindingId,
		invocation: input.invocation,
	};
	const reason = input.action === "reject" ? (input.reason?.trim() ?? "") : null;
	const command = boundTimeInvocationCommand({
		bound,
		actorEmployeeId: input.actorEmployeeId,
		actorUserId: input.actorUserId,
		action: input.action,
		reason,
	});
	try {
		const committed = await findCommittedInvocationDecision(database, {
			identity: input.invocation.identity,
			command,
		});
		if (committed) {
			return {
				status: "decided",
				replayed: true,
				evidence: requireCanonicalInvocationDecision(committed),
			};
		}
	} catch (error) {
		return classify(error);
	}
	const [memberships, actors, binding] = await Promise.all([
		database
			.select({ id: member.id })
			.from(member)
			.where(
				and(
					eq(member.organizationId, input.organizationId),
					eq(member.userId, input.actorUserId),
					eq(member.status, "approved"),
				),
			)
			.limit(1),
		database
			.select({ id: employee.id })
			.from(employee)
			.where(
				and(
					eq(employee.id, input.actorEmployeeId),
					eq(employee.organizationId, input.organizationId),
					eq(employee.userId, input.actorUserId),
					eq(employee.isActive, true),
				),
			)
			.limit(1),
		loadReviewBinding(database, {
			organizationId: input.organizationId,
			bindingId: input.bindingId,
		}),
	]);
	if (
		memberships.length !== 1 ||
		actors.length !== 1 ||
		!binding ||
		binding.recipientEmployeeId !== input.actorEmployeeId ||
		binding.actingForEmployeeId
	) {
		return { status: "not_found" };
	}
	const [workflow] = await database
		.select({
			workflowType: approvalWorkflow.workflowType,
			requesterEmployeeId: approvalWorkflow.requesterEmployeeId,
		})
		.from(approvalWorkflow)
		.where(
			and(
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.id, binding.workflowId),
			),
		)
		.limit(1);
	if (workflow?.workflowType !== "period_submission" || !workflow.requesterEmployeeId) {
		return { status: "not_found" };
	}
	const requesterEmployeeId = workflow.requesterEmployeeId;
	const runtime = createPeriodSubmissionApprovalRuntime(
		database as unknown as ApprovalWorkflowDatabase,
		{
			clock: systemClock,
			// Only the bound assignment's current approver; management is never reached from a card.
			canManageApproval: async () => {
				throw new BoundAssignmentNotCurrentError();
			},
		},
	);
	try {
		const evidence = await runtime.repository.withTransaction(async (context) => {
			const tx = context.dbService.db as unknown as ApprovalDatabase;
			// The submission lock, as submitting and every decision take it first; then the
			// rollout gate, which the invocation lock follows (#264 §2 order).
			await lockEmployeePeriodSubmissions(tx, {
				organizationId: input.organizationId,
				employeeId: requesterEmployeeId,
			});
			await context.writeGate.acquire({
				organizationId: input.organizationId,
				workflowType: "period_submission",
			});
			await admitFreshTimeInvocation(tx, {
				organizationId: input.organizationId,
				workflowType: "period_submission",
				bound,
				command,
			});
			const snapshot = await context.repository.loadSnapshot({
				organizationId: input.organizationId,
				workflowId: binding.workflowId,
			});
			const idempotencyKey = boundTimeInvocationKey(bound);
			const execution = await runtime.transitionEngine.executeInTransactionWithDisposition(
				context,
				{
					organizationId: input.organizationId,
					workflowId: snapshot.id,
					expectedVersion: snapshot.version,
					idempotencyKey,
					reviewedBindingId: binding.id,
					principal: { kind: "employee", userId: input.actorUserId },
					command:
						input.action === "approve"
							? { type: "approve", stageId: binding.stageId, assignmentId: binding.assignmentId }
							: {
									type: "reject",
									stageId: binding.stageId,
									assignmentId: binding.assignmentId,
									reason: reason ?? "",
								},
				},
			);
			if (execution.disposition === "replayed") {
				throw new ApprovalEvidenceError("invariant", { field: "invocation_decision" });
			}
			const outcome = await recordTimeInvocationDecision(tx, {
				organizationId: input.organizationId,
				workflowId: snapshot.id,
				bound,
				command,
				receiptKeyDigest: workPeriodReceiptKeyDigest(idempotencyKey),
			});
			return requireCanonicalInvocationDecision(outcome.evidence);
		});
		kickApprovalDelivery({ organizationId: input.organizationId, workflowId: binding.workflowId });
		return { status: "decided", replayed: false, evidence };
	} catch (error) {
		return classify(error);
	}
}

function classify(error: unknown): BoundPeriodSubmissionInvocationResult {
	if (error instanceof BoundTimeInvocationReplay) {
		return {
			status: "decided",
			replayed: true,
			evidence: requireCanonicalInvocationDecision(error.evidence),
		};
	}
	if (error instanceof BoundAssignmentNotCurrentError)
		return { status: "review_required", reason: "stale" };
	if (error instanceof ApprovalInvocationNotAdmittedError) {
		return { status: "review_required", reason: "not_admitted" };
	}
	if (error instanceof ApprovalEvidenceError) {
		switch (error.code) {
			case "invocation_mismatch":
				return { status: "conflict" };
			case "binding_mismatch":
				return { status: "review_required", reason: "binding" };
			case "material_change":
				return { status: "review_required", reason: "material_change" };
			case "evidence_required":
			case "evidence_incomplete":
				return { status: "review_required", reason: "evidence" };
			case "invariant":
				throw error;
		}
	}
	if (error instanceof ApprovalTransitionEngineError) {
		switch (error.code) {
			case "idempotency_mismatch":
				return { status: "conflict" };
			case "forbidden":
			case "version_conflict":
				return { status: "review_required", reason: "stale" };
			default:
				throw error;
		}
	}
	if (error instanceof PeriodSubmissionApprovalAdapterError) {
		return { status: "review_required", reason: "stale" };
	}
	throw error;
}
