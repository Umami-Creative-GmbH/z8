import { Effect } from "effect";
import type { AnyAppError } from "@/lib/effect/errors";
import type { ApprovalDbService } from "../server/types";
import type { ApprovalPolicyDraft, ApprovalPolicyEvaluationContext } from "./types";

type ChainStatus = "pending" | "approved" | "rejected" | "cancelled";

interface CreateChainInMemoryInput {
	context: ApprovalPolicyEvaluationContext;
	policy: ApprovalPolicyDraft;
}

export interface ChainStageInMemory {
	id: string;
	policyStageId: string;
	stepOrder: number;
	labelSnapshot: string;
	resolvedApproverEmployeeId: string;
	approvalRequestId: string | null;
	status: ChainStatus;
	decidedBy: string | null;
}

export interface ChainInMemory {
	id: string;
	organizationId: string;
	policyId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	currentStageOrder: number;
	status: ChainStatus;
	stages: ChainStageInMemory[];
}

export const APPROVAL_POLICY_CHAIN_NOT_CONFIGURED = "approval_policy_chain_not_configured";

export interface CreateChainForPolicyInput {
	organizationId: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	policy: ApprovalPolicyDraft;
	resolvedStages: Array<{
		policyStageId: string;
		stepOrder: number;
		label: string;
		approverEmployeeId: string;
	}>;
}

export interface ChainProgressionInput {
	approvalRequestId: string;
	actorEmployeeId: string;
	action: "approve" | "reject";
}

export type ChainProgressionResult =
	| { kind: "not_linked" }
	| { kind: "chain_pending" }
	| { kind: "chain_completed"; completed: true }
	| { kind: "chain_rejected"; rejected: true };

function requestIdForStage(stepOrder: number) {
	return `request_stage_${stepOrder}`;
}

export function createChainInMemory(input: CreateChainInMemoryInput): ChainInMemory {
	const firstStageOrder = Math.min(...input.policy.stages.map((stage) => stage.stepOrder));

	return {
		id: "chain_1",
		organizationId: input.context.organizationId,
		policyId: input.policy.id,
		entityType: input.context.entityType,
		entityId: input.context.entityId,
		requesterEmployeeId: input.context.requesterEmployeeId,
		currentStageOrder: firstStageOrder,
		status: "pending",
		stages: input.policy.stages
			.slice()
			.sort((a, b) => a.stepOrder - b.stepOrder)
			.map((stage) => ({
				id: `stage_instance_${stage.stepOrder}`,
				policyStageId: stage.id,
				stepOrder: stage.stepOrder,
				labelSnapshot: stage.label,
				resolvedApproverEmployeeId: stage.approverEmployeeId ?? "",
				approvalRequestId:
					stage.stepOrder === firstStageOrder ? requestIdForStage(stage.stepOrder) : null,
				status: stage.stepOrder === firstStageOrder ? "pending" : "cancelled",
				decidedBy: null,
			})),
	};
}

export function approveCurrentStageInMemory(
	chain: ChainInMemory,
	decidedBy: string,
): ChainInMemory {
	const stages = chain.stages.map((stage) =>
		stage.stepOrder === chain.currentStageOrder
			? { ...stage, status: "approved" as const, decidedBy }
			: stage,
	);
	const nextStage = stages.find((stage) => stage.stepOrder > chain.currentStageOrder);

	if (!nextStage) {
		return { ...chain, status: "approved", stages };
	}

	return {
		...chain,
		currentStageOrder: nextStage.stepOrder,
		stages: stages.map((stage) =>
			stage.stepOrder === nextStage.stepOrder
				? { ...stage, status: "pending", approvalRequestId: requestIdForStage(stage.stepOrder) }
				: stage,
		),
	};
}

export function rejectCurrentStageInMemory(
	chain: ChainInMemory,
	decidedBy: string,
): ChainInMemory {
	return {
		...chain,
		status: "rejected",
		stages: chain.stages.map((stage) =>
			stage.stepOrder === chain.currentStageOrder
				? { ...stage, status: "rejected", decidedBy }
				: stage,
		),
	};
}

export function progressApprovalChainIfLinked(
	_dbService: ApprovalDbService,
	_input: ChainProgressionInput,
): Effect.Effect<ChainProgressionResult, AnyAppError, never> {
	return Effect.succeed({ kind: "not_linked" });
}
