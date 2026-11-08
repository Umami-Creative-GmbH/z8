import { ValidationError } from "@/lib/effect/errors";
import { ApprovalRoutingPolicyValidationError } from "../routing/policy-matcher";
import { resolveApproverFromDirectory } from "./approver-resolution";
import { findMatchingPolicy } from "./matcher";
import {
	classifyLegacyStage,
	type LegacyStageDisposition,
} from "./requester-auto-approval";
import type {
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
	ApprovalPolicyStageDraft,
} from "./types";

type ApproverDirectoryInput = Parameters<
	typeof resolveApproverFromDirectory
>[0];

export type LegacyRouteDecisionInput = Pick<
	ApproverDirectoryInput,
	"employees" | "managerLinks" | "teamMemberships" | "teams"
> & {
	/** The request being routed, with the requester's active employee groups. */
	context: ApprovalPolicyEvaluationContext;
	policies: ApprovalPolicyDraft[];
	defaultApproverId: string | null;
};

/** Why submitting would fail, with the error it raises. */
export type LegacyRouteFailure = { kind: "failure" } & (
	| {
			/** An active policy is malformed; submitting throws the matcher's error. */
			reason: "invalid_policies";
			error: ApprovalRoutingPolicyValidationError;
	  }
	| LegacyRouteValidationFailure
);

type LegacyRouteValidationFailure = { error: ValidationError } & (
	| { reason: "no_default_approver" }
	| {
			reason: "stage_unresolvable";
			policy: ApprovalPolicyDraft;
			stage: ApprovalPolicyStageDraft;
	  }
	| { reason: "policy_has_no_stages"; policy: ApprovalPolicyDraft }
);

export interface LegacyRouteStage {
	stage: ApprovalPolicyStageDraft;
	approverEmployeeId: string;
	disposition: LegacyStageDisposition;
}

export type LegacyRouteDecision =
	| {
			kind: "default";
			approverEmployeeId: string;
			disposition: LegacyStageDisposition;
	  }
	| {
			kind: "policy";
			policy: ApprovalPolicyDraft;
			/** In step order. */
			stages: [LegacyRouteStage, ...LegacyRouteStage[]];
			/** Every stage resolves to the requester, so the chain completes on creation. */
			autoCompleted: boolean;
	  }
	| LegacyRouteFailure;

export function decideLegacyRoute(
	input: LegacyRouteDecisionInput,
): LegacyRouteDecision {
	const { context, defaultApproverId } = input;
	let matched: ApprovalPolicyDraft | null;
	try {
		matched = findMatchingPolicy(context, input.policies);
	} catch (error) {
		if (error instanceof ApprovalRoutingPolicyValidationError) {
			return { kind: "failure", reason: "invalid_policies", error };
		}
		throw error;
	}

	if (!matched) {
		if (!defaultApproverId) {
			return {
				kind: "failure",
				reason: "no_default_approver",
				error: new ValidationError({
					message: "No manager assigned to approve time changes",
					field: "managerId",
				}),
			};
		}
		return {
			kind: "default",
			approverEmployeeId: defaultApproverId,
			disposition: classifyLegacyStage({
				requesterEmployeeId: context.requesterEmployeeId,
				approverEmployeeId: defaultApproverId,
			}),
		};
	}

	const stages: LegacyRouteStage[] = [];
	for (const stage of matched.stages.toSorted(
		(left, right) => left.stepOrder - right.stepOrder,
	)) {
		const resolved = resolveApproverFromDirectory({
			organizationId: context.organizationId,
			requesterEmployeeId: context.requesterEmployeeId,
			stage,
			employees: input.employees,
			managerLinks: input.managerLinks,
			teamMemberships: input.teamMemberships,
			teams: input.teams,
		});
		if (!resolved.ok) {
			return {
				kind: "failure",
				reason: "stage_unresolvable",
				policy: matched,
				stage,
				error: new ValidationError({
					message: resolved.reason,
					field: "approvalPolicyStage.approverType",
					value: stage.approverType,
				}),
			};
		}
		stages.push({
			stage,
			approverEmployeeId: resolved.approverEmployeeId,
			disposition: classifyLegacyStage({
				requesterEmployeeId: context.requesterEmployeeId,
				approverEmployeeId: resolved.approverEmployeeId,
			}),
		});
	}

	const [firstStage, ...laterStages] = stages;
	if (!firstStage) {
		return {
			kind: "failure",
			reason: "policy_has_no_stages",
			policy: matched,
			error: new ValidationError({
				message: "Matched approval policy has no stages.",
				field: "approvalPolicy.stages",
				value: matched.id,
			}),
		};
	}

	return {
		kind: "policy",
		policy: matched,
		stages: [firstStage, ...laterStages],
		autoCompleted: stages.every(
			(resolved) => resolved.disposition.kind === "auto_approve",
		),
	};
}
